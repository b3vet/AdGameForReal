/**
 * Level generation.
 *
 * Every gate value and block size is scaled by `squadCurve`: how big the squad
 * is expected to be by the time it reaches that row. A level therefore plays
 * the same shape whether the player arrives with 20 units or 400, and
 * `hpScale` in `levels.json` is the difficulty dial on top of it — it says how
 * much of the expected squad one block is worth.
 */

import { countAfterGate } from './gates';
import { mulberry32, randomInt, randomRange, weightedIndex } from './rng';
import type { EnemyKind, GateDef, GateKind, Lane } from './types';
import { balance } from '@/data';
import type { LevelGenConfig, ValueRange } from '@/data/types';

export type { LevelGenConfig };

export interface RowEnemyDef {
  kind: EnemyKind;
  lane: Lane;
  units: number;
  /**
   * Meters from the row's own `z`. Mixed rows stand their block short of the
   * gate row (a negative `dz`) so the block's HP label and the gate's number
   * are never on the same spot on screen. Omitted means "on the row".
   */
  dz?: number;
}

export interface RowDef {
  z: number;
  /** One slot per lane, in lane order `-1, 0, +1`. `null` means no gate there. */
  gates: [GateDef | null, GateDef | null, GateDef | null];
  enemies: RowEnemyDef[];
}

export interface LevelDef {
  index: number;
  seed: number;
  runSpeed: number;
  startCount: number;
  rows: RowDef[];
  /** Where the squad stops advancing to fight the boss. */
  arenaZ: number;
  boss: { hp: number; units: number };
}

const LANES: readonly Lane[] = [-1, 0, 1];

/** How much a `fireRate` gate is notionally worth, in units. Bots agree (bots.ts). */
export const FIRE_RATE_GATE_WORTH = 0.15;

export const BOSS_Z_OFFSET = balance.level.bossOffset;

/** Lane centre in meters. `laneWidth` is 2, so lanes sit at `x = -2, 0, +2`. */
export function laneCenter(lane: Lane, laneWidth = balance.road.laneWidth): number {
  return lane * laneWidth;
}

type Rng = () => number;

function clampToRange(value: number, range: ValueRange): number {
  return Math.min(Math.max(value, range.min), range.max);
}

function shuffle<T>(rng: Rng, items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = items[i];
    const b = items[j];
    if (a === undefined || b === undefined) continue;
    items[i] = b;
    items[j] = a;
  }
}

/** What a gate is worth to a player holding `count` units, for ranking gates. */
function gateWorth(def: GateDef, count: number): number {
  if (def.kind === 'fireRate') return count + count * FIRE_RATE_GATE_WORTH;
  return countAfterGate(def.kind, def.value, count);
}

/**
 * How big the squad is expected to be at row `i`.
 *
 * Squads grow by shooting gates, not by the number printed on them, so the
 * generator cannot work the size out from gate values: it follows a curve
 * instead. The curve runs geometrically from `startCount` to the level's
 * `peakTarget`, and every threat, gate value and gate cap on the row is sized
 * against it. That is what makes level 1 peak near 60 and level 10 near 480
 * instead of every level saturating at the shared count cap: the curve, not the
 * cap, is the level's ambition. A player who keeps up is fine; one who falls
 * behind meets blocks built for a squad they no longer have.
 */
export function squadCurve(config: LevelGenConfig, rowIndex: number): number {
  const start = curveStart(config);
  const top = curveTop(config);
  return Math.min(top, start * Math.pow(curveGrowth(config), rowIndex));
}

function curveStart(config: LevelGenConfig): number {
  return Math.max(1, config.startCount);
}

function curveTop(config: LevelGenConfig): number {
  return Math.min(balance.squad.maxCount, Math.max(curveStart(config), config.peakTarget));
}

/** Factor the curve grows by from one row to the next. */
function curveGrowth(config: LevelGenConfig): number {
  const span = Math.max(1, Math.floor(config.rows) - 1);
  return Math.pow(curveTop(config) / curveStart(config), 1 / span);
}

/** Share of this level's rows that carry at least one gate. */
function gateRowShare(config: LevelGenConfig): number {
  const weights = config.rowWeights;
  const total = weights.gate + weights.enemy + weights.mixed;
  if (total <= 0) return 1;
  return Math.max(0.2, (weights.gate + weights.mixed) / total);
}

/**
 * How far shooting can pump a gate on this row.
 *
 * Not a flat number and not a flat fraction. A gate row has to carry the growth
 * of the enemy rows around it as well as its own, and the `mul` gates sprinkled
 * through the level already carry part of that growth by themselves — so the
 * budget left for add gates is the curve's per-row growth, raised to "one row in
 * every `gateRowShare`", with the expected `mul` payout divided out. That is
 * what lets one set of dials serve a level that grows 5 into 60 and one that
 * grows 12 into 480 with half its rows full of blocks.
 */
function addCap(config: LevelGenConfig, estimate: number): number {
  const perGateRow = Math.log(curveGrowth(config)) / gateRowShare(config);
  const mulMean = (config.gateValues.mul.min + config.gateValues.mul.max) / 2;
  const mulChance = Math.min(0.9, Math.max(0, balance.gen.mulChance));
  const fromAdds = (perGateRow - mulChance * Math.log(Math.max(1, mulMean))) / (1 - mulChance);
  // Floor: on a level whose multipliers already outrun the curve, add gates
  // still have to be worth walking into.
  const frac = Math.max(balance.gen.addCapFloor, Math.exp(fromAdds) - 1);
  const raw = Math.round(estimate * frac * balance.gen.addCapShare);
  return Math.round(clampToRange(raw, config.gateValues.add));
}

function makeGate(kind: GateKind, rng: Rng, config: LevelGenConfig, estimate: number): GateDef {
  const gen = balance.gen;
  switch (kind) {
    case 'mul': {
      const value = randomInt(rng, config.gateValues.mul.min, config.gateValues.mul.max);
      // `mul` is not shootable, so its cap is its value: nothing can raise it.
      return { kind, value, cap: value };
    }
    case 'add': {
      const raw = Math.round(estimate * randomRange(rng, gen.addFrac.min, gen.addFrac.max));
      const value = Math.round(clampToRange(raw, config.gateValues.add));
      return { kind, value, cap: Math.max(value, addCap(config, estimate)) };
    }
    case 'sub': {
      const raw = Math.round(estimate * randomRange(rng, gen.subFrac.min, gen.subFrac.max));
      // The cap is what the gate pays *after* it flips to `add`.
      return {
        kind,
        value: Math.round(clampToRange(raw, config.gateValues.sub)),
        cap: addCap(config, estimate),
      };
    }
    case 'fireRate': {
      const raw = randomRange(rng, config.gateValues.fireRate.min, config.gateValues.fireRate.max);
      return { kind, value: Math.round(raw * 100) / 100, cap: balance.gates.caps.fireRate };
    }
  }
}

/**
 * Kinds for one gate row: at most one `mul`, at least one non-negative choice,
 * and no `sub` at all before `gen.negativeFromLevel`.
 */
function rowGateKinds(rng: Rng, index: number, slots: number): GateKind[] {
  const gen = balance.gen;
  const kinds: GateKind[] = [];

  if (rng() < gen.mulChance) kinds.push('mul');

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

  shuffle(rng, kinds);
  return kinds;
}

function emptyGates(): [GateDef | null, GateDef | null, GateDef | null] {
  return [null, null, null];
}

/** Lanes that carry a gate this row, in ascending lane order. */
function pickLanes(rng: Rng, count: number): Lane[] {
  const lanes = [...LANES];
  shuffle(rng, lanes);
  const chosen = lanes.slice(0, count);
  chosen.sort((a, b) => a - b);
  return chosen;
}

function blockUnits(
  rng: Rng,
  config: LevelGenConfig,
  estimate: number,
  kind: EnemyKind,
  scale: number,
): number {
  const gen = balance.gen;
  const frac = randomRange(rng, gen.enemyFrac.min, gen.enemyFrac.max);
  const gruntUnits = estimate * frac * config.hpScale * scale;
  const kindScale = kind === 'brute' ? gen.bruteUnitFrac : 1;
  return Math.max(1, Math.round(gruntUnits * kindScale));
}

function pickEnemyKind(rng: Rng): EnemyKind {
  return rng() < balance.gen.bruteChance ? 'brute' : 'grunt';
}

function gateRow(rng: Rng, config: LevelGenConfig, z: number, estimate: number): RowDef {
  const slots = rng() < balance.gen.thirdGateChance ? 3 : 2;
  const lanes = pickLanes(rng, slots);
  const kinds = rowGateKinds(rng, config.index, slots);

  const gates = emptyGates();
  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i];
    const kind = kinds[i];
    if (lane === undefined || kind === undefined) continue;
    gates[lane + 1] = makeGate(kind, rng, config, estimate);
  }

  return { z, gates, enemies: [] };
}

/**
 * A wall of blocks. The row's threat is one budget split across its lanes, not
 * one budget per lane: a wide squad overlaps every lane at once, so three
 * full-sized blocks on one row is not three times the choice, it is a wipe.
 */
function enemyRow(rng: Rng, config: LevelGenConfig, z: number, estimate: number): RowDef {
  const lanes = pickLanes(rng, randomInt(rng, 1, 3));
  const share = 1 / lanes.length;
  const enemies: RowEnemyDef[] = [];
  for (const lane of lanes) {
    const kind = pickEnemyKind(rng);
    enemies.push({ kind, lane, units: blockUnits(rng, config, estimate, kind, share) });
  }
  return { z, gates: emptyGates(), enemies };
}

/**
 * Gates in two lanes with a block standing in the better lane, so the gate the
 * player wants is the one that costs them something to reach.
 */
function mixedRow(rng: Rng, config: LevelGenConfig, z: number, estimate: number): RowDef {
  const lanes = pickLanes(rng, 2);
  const kinds = rowGateKinds(rng, config.index, 2);

  const gates = emptyGates();
  let guardedLane: Lane = lanes[0] ?? 0;
  let guardedWorth = -Infinity;
  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i];
    const kind = kinds[i];
    if (lane === undefined || kind === undefined) continue;
    const def = makeGate(kind, rng, config, estimate);
    gates[lane + 1] = def;
    // The block guards the lane a player actually wants, so the good gate costs
    // something to take.
    const worth = gateWorth(def, estimate);
    if (def.kind !== 'sub' && worth > guardedWorth) {
      guardedWorth = worth;
      guardedLane = lane;
    }
  }

  const kind = pickEnemyKind(rng);
  const enemies: RowEnemyDef[] = [
    {
      kind,
      lane: guardedLane,
      units: blockUnits(rng, config, estimate, kind, balance.gen.mixedBlockFrac),
      // Short of the gate, not on it: the block is something to clear on the way
      // in, and its HP label keeps well clear of the gate's number on screen.
      dz: -balance.gen.mixedEnemyOffset,
    },
  ];

  return { z, gates, enemies };
}

/**
 * Deterministic: the same `index`, `config` and `seed` always produce the same
 * level. `seed` defaults to the config's own seed so callers can omit it.
 */
export function generateLevel(index: number, config: LevelGenConfig, seed?: number): LevelDef {
  const resolvedSeed = seed ?? config.seed;
  const rng = mulberry32(resolvedSeed);
  const rowCount = Math.max(1, Math.floor(config.rows));
  const spacing = balance.level.rowSpacing;

  const weights = [config.rowWeights.gate, config.rowWeights.enemy, config.rowWeights.mixed];
  const rows: RowDef[] = [];
  let enemyRun = 0;

  for (let i = 0; i < rowCount; i++) {
    const z = spacing * (i + 1);
    const estimate = squadCurve(config, i);
    // The first row is always a plain gate row: the player needs units before
    // anything is allowed to take units away.
    let kind = i === 0 ? 0 : weightedIndex(rng, weights);
    // A long run of pure enemy rows is a dead zone: the squad cannot grow while
    // the curve behind the next row's blocks keeps rising, so the level walks
    // the player into a wall they were never given the units for.
    if (kind === 1 && enemyRun >= balance.gen.maxEnemyRun) kind = 2;
    enemyRun = kind === 1 ? enemyRun + 1 : 0;

    if (kind === 1) rows.push(enemyRow(rng, config, z, estimate));
    else if (kind === 2) rows.push(mixedRow(rng, config, z, estimate));
    else rows.push(gateRow(rng, config, z, estimate));
  }

  const lastRow = rows[rows.length - 1];
  const arenaZ = (lastRow?.z ?? spacing) + spacing;

  return {
    index,
    seed: resolvedSeed,
    runSpeed: balance.squad.runSpeed,
    startCount: config.startCount,
    rows,
    arenaZ,
    boss: {
      hp: config.boss.hp,
      units: Math.max(1, Math.ceil(config.boss.hp / balance.enemies.boss.hpPerUnit)),
    },
  };
}
