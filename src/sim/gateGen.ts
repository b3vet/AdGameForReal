/**
 * Building one row's gates.
 *
 * Split out of `level.ts` in Milestone 2. Everything here works from a
 * `RowBudget` the level curve hands down — the expected squad at this row, the
 * `add` value that keeps the curve on track, and the ceiling on a curse — so
 * the gate rules never have to know the shape of the level around them.
 */

import { gateCap } from './gates';
import { randomInt, randomRange } from './rng';
import type { GateDef, GateKind, Lane, WeaponId } from './types';
import { startWeapon, weaponIds } from './weapons';
import { balance } from '@/data';
import type { LevelGenConfig, ValueRange } from '@/data/types';

type Rng = () => number;

/** What the curve expects of one row, computed in `level.ts`. */
export interface RowBudget {
  /** Squad size the row is built for. */
  estimate: number;
  /** Value an `add` gate on this row should print, before jitter. */
  addValue: number;
  /** Hard ceiling on a curse here: 35 percent of the expected squad. */
  curseCeiling: number;
}

/**
 * Which extra kinds a row is allowed to offer this time round. Staff gates are
 * not here: they are placed after the level is laid out (`level.ts`).
 */
export interface RowPermits {
  mul: boolean;
}

function clampToRange(value: number, range: ValueRange): number {
  return Math.min(Math.max(value, range.min), range.max);
}

export function shuffle<T>(rng: Rng, items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = items[i];
    const b = items[j];
    if (a === undefined || b === undefined) continue;
    items[i] = b;
    items[j] = a;
  }
}

/**
 * A gate a player can come out of bigger. A staff gate counts, because the plan
 * counts it, but it hands over no units — see `handsOverUnits`.
 */
export function growsTheSquad(kind: GateKind): boolean {
  return kind === 'add' || kind === 'mul' || kind === 'weapon';
}

/** A gate that actually adds bodies. What the level's curve is built out of. */
function handsOverUnits(kind: GateKind): boolean {
  return kind === 'add' || kind === 'mul';
}

/**
 * Staff gates never offer the staff the run starts with: two of the three are
 * always a real change, and the generator has no way to know what the player is
 * carrying by the time they get here.
 */
function pickWeapon(rng: Rng): WeaponId {
  const options = weaponIds.filter((id) => id !== startWeapon);
  return options[Math.floor(rng() * options.length)] ?? 'storm';
}

function makeGate(kind: GateKind, rng: Rng, config: LevelGenConfig, budget: RowBudget): GateDef {
  const gen = balance.gen;
  switch (kind) {
    case 'mul': {
      const value = randomInt(rng, config.gateValues.mul.min, config.gateValues.mul.max);
      // `mul` is not shootable, so its cap is its value: nothing can raise it.
      return { kind, value, cap: value };
    }
    case 'weapon':
      // Staff gates are not dealt with the row; `level.ts` converts a spare
      // lane after the level is laid out (`placeWeaponGates`).
      return weaponGate(rng);
    case 'add': {
      const raw = budget.addValue * randomRange(rng, gen.addJitter.min, gen.addJitter.max);
      const value = Math.round(clampToRange(raw, config.gateValues.add));
      return { kind, value, cap: gateCap('add', value, balance) };
    }
    case 'sub': {
      // The curse the level wants, but never more than the ceiling the plan
      // sets: a curse you cannot shoot down is a wall, not a choice.
      const raw = randomInt(rng, config.gateValues.sub.min, config.gateValues.sub.max);
      const value = Math.max(1, Math.min(raw, budget.curseCeiling));
      // The cap is what the gate pays *after* it flips to `add`.
      return { kind, value, cap: gateCap('sub', value, balance) };
    }
    case 'fireRate': {
      const raw = randomRange(rng, config.gateValues.fireRate.min, config.gateValues.fireRate.max);
      const value = Math.round(raw * 100) / 100;
      return { kind, value, cap: gateCap('fireRate', value, balance) };
    }
  }
}

/**
 * Kinds for one gate row: at most one `mul`, at most one staff, no `sub` at all
 * before `gen.negativeFromLevel`, and always something to grow on — either an
 * `add`, `mul` or staff gate, or an empty lane to walk through.
 */
export function rowGateKinds(
  rng: Rng,
  index: number,
  slots: number,
  permits: RowPermits,
): GateKind[] {
  const gen = balance.gen;
  const kinds: GateKind[] = [];

  // The level's own budget decides which rows may carry one (see `mulBudget`).
  if (permits.mul) kinds.push('mul');

  const negativesAllowed = index >= gen.negativeFromLevel;
  let subs = 0;
  if (negativesAllowed) {
    // Never fill the row with penalties: at least one lane must be worth taking.
    const maxSubs = slots - Math.max(1, kinds.length);
    subs = Math.min(maxSubs, rng() < gen.doubleSubChance ? 2 : 1);
  }
  for (let i = 0; i < subs; i++) kinds.push('sub');

  while (kinds.length < slots) {
    kinds.push(rng() < gen.fireRateChance ? 'fireRate' : 'add');
  }

  // Every row with gates on it hands out bodies somewhere. An empty lane
  // satisfies the letter of the plan's rule and a staff gate satisfies the
  // spirit of it, but neither makes the squad bigger, and a level that deals a
  // few such rows walks an otherwise perfect run into a boss it has no squad
  // for. So one lane on every gate row is always an `add` or a `mul`.
  if (!kinds.some(handsOverUnits)) {
    const swap = kinds.lastIndexOf('fireRate');
    kinds[swap < 0 ? kinds.length - 1 : swap] = 'add';
  }

  shuffle(rng, kinds);
  return kinds;
}

/**
 * Which lane of a finished row a staff gate may take over, or -1.
 *
 * The order is what the row can spare: a `fireRate` bonus first, then a second
 * grower, then a second curse — so the row always comes out of it with a way to
 * grow and with whatever pressure it had. `level.ts` calls this after the level
 * is laid out; see `placeWeaponGates` for why it happens there.
 */
export function staffLane(gates: ReadonlyArray<GateDef | null>): number {
  let fireRate = -1;
  let add = -1;
  let sub = -1;
  let growers = 0;
  let curses = 0;
  for (let i = 0; i < gates.length; i++) {
    const gate = gates[i];
    if (gate === null || gate === undefined) continue;
    if (gate.kind === 'fireRate') fireRate = i;
    if (gate.kind === 'add') add = i;
    if (gate.kind === 'sub') sub = i;
    if (handsOverUnits(gate.kind)) growers++;
    if (gate.kind === 'sub') curses++;
  }
  if (fireRate >= 0) return fireRate;
  if (growers > 1 && add >= 0) return add;
  if (curses > 1 && sub >= 0) return sub;
  // No lane to spare: most late rows are one curse and one grower, and neither
  // may go. Handing over the `add` cost the greedy bot two levels of the ten
  // when it was tried, so this row keeps everything it has and `emptyLane`
  // below is what the level falls back on.
  return -1;
}

/**
 * An empty lane of a row that already carries gates, or -1.
 *
 * The fallback behind `staffLane`. A row of two gates leaves one lane clear for
 * the player to walk through, and putting the staff there takes nothing away —
 * the row keeps its grower, its curse and its pressure, and the walk-through
 * lane becomes an offer rather than a shrug. Nine of the forty-five level-seed
 * pairs in the balance set had no row `staffLane` would touch (every row one
 * curse and one grower) and therefore no staff gate at all; with this every
 * level from `gen.weaponFromLevel` on carries one.
 *
 * Enemy rows are not candidates even though all three of their lanes are empty:
 * their whole job is to be a wall the player picks a way through, and a panel
 * standing in one of those lanes narrows the gap rather than widening a choice.
 */
export function emptyLane(gates: ReadonlyArray<GateDef | null>): number {
  let empty = -1;
  let carriesGates = false;
  for (let i = 0; i < gates.length; i++) {
    const gate = gates[i];
    if (gate === null || gate === undefined) {
      if (empty < 0) empty = i;
      continue;
    }
    carriesGates = true;
  }
  return carriesGates ? empty : -1;
}

/** The staff gate itself: not shootable, changes no counts. */
export function weaponGate(rng: Rng): GateDef {
  return { kind: 'weapon', value: 0, cap: 0, weaponId: pickWeapon(rng) };
}

/** What the player reads off a panel: two gates printing this are one choice. */
function gateKey(def: GateDef): string {
  const id = def.weaponId ?? '';
  return `${def.kind}:${String(Math.round(def.value * 100) / 100)}:${id}`;
}

/** The smallest step that visibly separates two gates of this kind. */
function nudgeStep(kind: GateKind): number {
  const step = balance.gates.hitStep;
  if (kind === 'fireRate') return step.fireRate;
  if (kind === 'sub') return step.sub;
  return step.add;
}

/** Rounded the way `makeGate` rounds this kind, so the nudge stays printable. */
function roundValue(kind: GateKind, value: number): number {
  return kind === 'fireRate' ? Math.round(value * 100) / 100 : Math.round(value);
}

/**
 * Moves `def` off any value already taken on this row.
 *
 * Two panels printing `+3` side by side are not a choice, they are a wasted
 * row, so the second one steps away by a shot's worth at a time — outward while
 * the kind's range allows it, inward once it does not. Purely arithmetic: it
 * draws no randomness, so the level stays a function of its seed.
 */
function makeDistinct(
  def: GateDef,
  taken: ReadonlySet<string>,
  config: LevelGenConfig,
  budget: RowBudget,
): void {
  if (!taken.has(gateKey(def))) return;
  if (def.kind === 'mul' || def.kind === 'weapon') return;

  const range = config.gateValues[def.kind];
  const step = nudgeStep(def.kind);
  const original = def.value;
  // A curse steps down first: its printed value is already held under the
  // 35 percent ceiling, and stepping up would push it back over.
  const directions = def.kind === 'sub' ? [-1, 1] : [1, -1];
  // The curse ceiling can pull a value under its own range's floor, and a gate
  // that is already outside its range still has to be separable from its
  // neighbour, so the window opens down to one. It never opens upward past the
  // ceiling: a nudge must not put a curse back over what the row can take.
  const low = def.kind === 'sub' || original < range.min ? 1 : range.min;
  const high =
    def.kind === 'sub'
      ? Math.min(Math.max(range.max, original), budget.curseCeiling)
      : Math.max(range.max, original);

  for (const direction of directions) {
    for (let i = 1; i <= 3; i++) {
      const candidate = roundValue(def.kind, original + direction * i * step);
      if (candidate < low || candidate > high) break;
      def.value = candidate;
      if (!taken.has(gateKey(def))) {
        // The cap follows the printed value for every kind that can be shot up:
        // for `add` and `fireRate` it bounds this very number, and for `sub` it
        // is the budget the flipped gate then grows into.
        def.cap = gateCap(def.kind, def.value, balance);
        return;
      }
    }
  }

  // A range too narrow to separate them (level 1's `mul` is a single value):
  // leave the gate as it was rather than pushing it outside its own range.
  def.value = original;
}

export function emptyGates(): [GateDef | null, GateDef | null, GateDef | null] {
  return [null, null, null];
}

/** Builds one row's gates, keeping the numbers on it distinct. */
export function rowGates(
  rng: Rng,
  config: LevelGenConfig,
  budget: RowBudget,
  lanes: readonly Lane[],
  kinds: readonly GateKind[],
): [GateDef | null, GateDef | null, GateDef | null] {
  const gates = emptyGates();
  const taken = new Set<string>();

  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i];
    const kind = kinds[i];
    if (lane === undefined || kind === undefined) continue;
    const def = makeGate(kind, rng, config, budget);
    makeDistinct(def, taken, config, budget);
    taken.add(gateKey(def));
    gates[lane + 1] = def;
  }

  return gates;
}
