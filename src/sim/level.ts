/**
 * Level generation: the shape of a level. The curve every number is sized
 * against lives in `curve.ts`, the kind of every row in `rowKinds.ts`, the
 * gates themselves in `gateGen.ts`, one row's contents in `rows.ts`, stream
 * sizing in `pressure.ts` and the fences in `walls.ts`.
 *
 * Milestone 3's shape (D31), stretched to twenty levels by Milestone 4 (D32):
 * rows every 18 m, eight of them carrying gates on level 1 rising to fourteen
 * by level 20, and every other row a threat — a stream, a horde of two, or a
 * brute block. Sixty to seventy-five seconds of road before the arena, and from
 * level 4 a lane wall in front of some of the gate rows.
 */

import { addValueAt, squadCurve } from './curve';
import { gateCap } from './gates';
import { emptyLane, growsTheSquad, shuffle, staffLane, weaponGate } from './gateGen';
import type { RowBudget } from './gateGen';
import { playerMods } from './player';
import type { PlayerMods } from './player';
import {
  countGateRows,
  dealRowKinds,
  BRUTE_ROW,
  GATE_ROW,
  HORDE_ROW,
  MIXED_ROW,
  STREAM_ROW,
} from './rowKinds';
import { bruteRow, gateRow, hordeRow, mixedRow, streamRow } from './rows';
import type { RowDef, RowEnemyDef, RowPermits } from './rows';
import { mulberry32 } from './rng';
import type { GateDef, StreamDef } from './types';
import { generateWalls } from './walls';
import type { WallDef } from './walls';
import { balance } from '@/data';
import type { LevelGenConfig, PlayerState } from '@/data/types';

export { FIRE_RATE_GATE_WORTH } from './gates';
export { addValueAt, squadCurve } from './curve';
export { laneCenter, laneOf } from './lanes';
export type { LevelGenConfig, RowDef, RowEnemyDef, StreamDef, WallDef };

/**
 * Which boss stands in the arena. One entry for now (D33's bestiary wants the
 * id on the level rather than looked up from the level index).
 */
export type BossId = 'demon';

export interface LevelDef {
  index: number;
  seed: number;
  runSpeed: number;
  startCount: number;
  rows: RowDef[];
  /** Where the squad stops advancing to fight the boss. */
  arenaZ: number;
  /**
   * `bite` is the level's share of the boss's stomp and contact damage (D31).
   * Optional for the same reason as `RowDef.streams`: hand-made levels in the
   * render fixtures predate it and take the full Milestone 2 numbers.
   */
  boss: { hp: number; units: number; bite?: number };
  /**
   * Always `demon` today; the bestiary records whatever stands here (D33).
   * Optional for the same reason as `boss.bite`: the render fixtures and the
   * stress scene build a `LevelDef` by hand. `generateLevel` always writes it.
   */
  bossId?: BossId;
  /**
   * Lane walls (D32). Empty below `balance.walls.fromLevel`; optional for the
   * same reason as `bossId`, and `generateLevel` always writes it.
   */
  walls?: WallDef[];
}

export const BOSS_Z_OFFSET = balance.level.bossOffset;

/** Mixed into the seed for the staff-gate stream, so it is not the level's. */
const WEAPON_STREAM_SALT = 0x57_af_f0_0d;

type Rng = () => number;

function budgetFor(config: LevelGenConfig, rowIndex: number): RowBudget {
  const estimate = squadCurve(config, rowIndex);
  return {
    estimate,
    addValue: addValueAt(config, estimate),
    // Floored at two: the plan's own level-1 curses read 2 to 6, and a row
    // cannot hold two distinct curses if the ceiling is one.
    curseCeiling: Math.max(2, Math.floor(estimate * balance.gen.curseShare)),
  };
}

/**
 * How many `mul` gates this level should carry.
 *
 * A budget rather than a coin flip per row: multiplied growth is the loudest
 * term in the curve, and a level that rolled three multipliers played nothing
 * like the same level that rolled none.
 */
function mulBudget(index: number, gateRows: number): number {
  if (index < balance.gen.mulFromLevel) return 0;
  return Math.round(balance.gen.mulChance * gateRows);
}

/** How many staff gates this level may carry, and whether they are on at all. */
function weaponBudget(index: number): number {
  const gen = balance.gen;
  if (!gen.weaponGatesEnabled || index < gen.weaponFromLevel) return 0;
  return index >= gen.weaponGateManyFromLevel ? gen.weaponGatesLate : gen.weaponGatesEarly;
}

/** One lane of one row a staff gate could take over. */
interface StaffSlot {
  row: number;
  lane: number;
}

/**
 * Lanes of rows past the first that `pick` says a staff may take, shuffled.
 * Never the first row: the plan's rule, and the player has not seen a staff
 * work yet when they are asked to trade for another one.
 */
function staffCandidates(
  rows: readonly RowDef[],
  rng: Rng,
  pick: (gates: ReadonlyArray<GateDef | null>) => number,
): StaffSlot[] {
  const candidates: StaffSlot[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row === undefined) continue;
    const lane = pick(row.gates);
    if (lane >= 0) candidates.push({ row: i, lane });
  }
  shuffle(rng, candidates);
  return candidates;
}

/** Converts lanes to staff gates until the budget is spent. Returns how many. */
function convert(
  rows: RowDef[],
  candidates: readonly StaffSlot[],
  rng: Rng,
  budget: number,
): number {
  let placed = 0;
  for (const candidate of candidates) {
    if (placed >= budget) break;
    const row = rows[candidate.row];
    // One staff per row (plan, "Weapons"): the second tier may offer a row the
    // first tier has already taken.
    if (row === undefined || row.gates.some((gate) => gate?.kind === 'weapon')) continue;
    row.gates[candidate.lane] = weaponGate(rng);
    placed++;
  }
  return placed;
}

/**
 * Turns up to `weaponBudget` spare lanes into staff gates, on a stream of its
 * own, after the level is laid out — so turning staff gates on moves only the
 * lanes it converts and cannot re-roll the campaign (Phase C, Milestone 2).
 *
 * Two tiers, in order. First a lane the row can give up — a `fireRate` bonus, a
 * second grower, a second curse (`staffLane`). Then, only if the budget is not
 * spent, a lane that is already empty (`emptyLane`), which costs the row
 * nothing at all.
 */
function placeWeaponGates(rows: RowDef[], index: number, seed: number): void {
  const budget = weaponBudget(index);
  if (budget <= 0) return;

  // A separate stream, salted, so the level's own sequence is untouched.
  const rng = mulberry32((seed ^ WEAPON_STREAM_SALT) >>> 0);

  const placed = convert(rows, staffCandidates(rows, rng, staffLane), rng, budget);
  if (placed >= budget) return;
  convert(rows, staffCandidates(rows, rng, emptyLane), rng, budget - placed);
}

function buildRow(
  kind: number,
  rng: Rng,
  config: LevelGenConfig,
  rowIndex: number,
  z: number,
  budget: RowBudget,
  permits: RowPermits,
): RowDef {
  switch (kind) {
    case MIXED_ROW:
      return mixedRow(rng, config, z, budget, permits);
    case STREAM_ROW:
      return streamRow(rng, config, rowIndex, z);
    case HORDE_ROW:
      return hordeRow(rng, config, rowIndex, z);
    case BRUTE_ROW:
      return bruteRow(rng, config, z, budget);
    default:
      return gateRow(rng, config, z, budget, permits);
  }
}

/**
 * The gate-bonus upgrade (D35), applied after the level is laid out.
 *
 * Only `add` gates and only their printed value, so the level itself — its
 * rows, its curses, its streams and every random draw behind them — is the one
 * the campaign was tuned as, whatever the player has bought. A player with the
 * upgrade at zero multiplies by exactly one and this returns without touching a
 * thing, which is what keeps a no-upgrade run byte-identical.
 */
function applyGateBonus(rows: readonly RowDef[], bonus: number): void {
  if (bonus === 1) return;
  for (const row of rows) {
    for (let slot = 0; slot < row.gates.length; slot++) {
      const gate = row.gates[slot];
      if (gate === null || gate === undefined || gate.kind !== 'add') continue;
      gate.value = Math.max(1, Math.round(gate.value * bonus));
      gate.cap = gateCap('add', gate.value, balance);
    }
  }
}

/**
 * Deterministic: the same `index`, `config`, `seed` and `player` always produce
 * the same level. `seed` defaults to the config's own seed so callers can omit
 * it, and `player` is optional because the balance bands are defined for a
 * player who has bought nothing (D35).
 *
 * Two of the five upgrades are the level's business rather than the squad's:
 * the units the player starts with and what an `add` gate prints. The other
 * three are multipliers on the squad and belong to `Run`.
 */
export function generateLevel(
  index: number,
  config: LevelGenConfig,
  seed?: number,
  player?: PlayerState,
): LevelDef {
  const mods: PlayerMods = playerMods(player);
  const resolvedSeed = seed ?? config.seed;
  const rng = mulberry32(resolvedSeed);
  const rowCount = Math.max(1, Math.floor(config.rows));
  const spacing = balance.level.rowSpacing;

  // Held inside the clearance rule rather than trusted to it: a threat row may
  // be nudged off the grid by at most `spacing - gateClearance`, so no stream
  // and no block can ever end up within `gateClearance` of a gate row's `z`
  // however the tuning is edited.
  const jitter = Math.max(
    0,
    Math.min(balance.streams.zJitter, spacing - balance.streams.gateClearance),
  );

  const rows: RowDef[] = [];
  const kinds = dealRowKinds(rng, config, rowCount);
  let mulsLeft = mulBudget(index, Math.round(config.gateRows));

  for (let i = 0; i < rowCount; i++) {
    const grid = spacing * (i + 1);
    const budget = budgetFor(config, i);
    const kind = kinds[i] ?? GATE_ROW;
    // Spread the multiplier budget over the gate rows that are actually left,
    // counted from the dealt row kinds: rolling it against every row wasted the
    // budget on threat rows, which have no lane to put a multiplier in.
    const gateRowsLeft = countGateRows(kinds, i);
    const permits: RowPermits = {
      mul: i > 0 && kind <= MIXED_ROW && mulsLeft > 0 && rng() < mulsLeft / gateRowsLeft,
    };

    // Gate rows stand on the grid; a threat row is nudged off it so the road
    // does not read as a metronome. The nudge is held well inside half the
    // spacing, which is what keeps every stream and every block clear of a gate
    // row's `z` by more than `streams.gateClearance`.
    const z = kind <= MIXED_ROW ? grid : grid + (rng() * 2 - 1) * jitter;

    const row = buildRow(kind, rng, config, i, z, budget, permits);
    if (row.gates.some((g) => g?.kind === 'mul')) mulsLeft--;
    rows.push(row);
  }

  placeWeaponGates(rows, index, resolvedSeed);
  applyGateBonus(rows, mods.gateBonus);

  // From the grid, not from the last row: a nudged final threat row must not
  // move the arena, because the level's length is the sixty-to-seventy-five
  // second budget the plan sets.
  const arenaZ = spacing * (rowCount + 1);

  return {
    index,
    seed: resolvedSeed,
    runSpeed: balance.squad.runSpeed,
    startCount: config.startCount + mods.startCount,
    rows,
    arenaZ,
    bossId: 'demon',
    walls: generateWalls(rows, index, resolvedSeed, arenaZ, config.wallRows),
    boss: {
      hp: config.boss.hp,
      units: Math.max(1, Math.ceil(config.boss.hp / balance.enemies.boss.hpPerUnit)),
      bite: config.boss.bite,
    },
  };
}

/** True when a row hands the player some way to come out of it bigger. */
export function rowOffersGrowth(row: RowDef): boolean {
  const gates: ReadonlyArray<GateDef | null> = row.gates;
  if (gates.some((g) => g === null)) return true;
  return gates.some((g) => g !== null && growsTheSquad(g.kind));
}
