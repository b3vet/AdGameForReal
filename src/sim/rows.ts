/**
 * Building one row of a level: what stands in it and where.
 *
 * Milestone 3 splits a level's rows in two. A *gate row* is the old thing: two
 * or three panels, sometimes with a block standing short of the best of them. A
 * *threat row* is what the 18 m spacing bought — a stream of bodies pouring
 * down one lane, a horde pouring down two, or a brute block to shoot through.
 * Gate rows and threat rows alternate on the same grid, so a stream always
 * lives between gates and never on top of one.
 */

import { emptyGates, rowGateKinds, rowGates, shuffle } from './gateGen';
import type { RowBudget, RowPermits } from './gateGen';
import { countAfterGate, FIRE_RATE_GATE_WORTH } from './gates';
import { sizeStream } from './pressure';
import { randomInt, randomRange } from './rng';
import type { EnemyKind, GateDef, Lane, StreamDef } from './types';
import { balance } from '@/data';
import type { LevelGenConfig } from '@/data/types';

export type { RowPermits };

type Rng = () => number;

const LANES: readonly Lane[] = [-1, 0, 1];

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
  /**
   * Streams triggered by this row. A horde row carries two (D29). Optional for
   * the same reason as `RowEnemyDef.dz`: hand-made rows in the render fixtures
   * and the tests predate streams and carry none.
   */
  streams?: StreamDef[];
}

/** What a gate is worth to a player holding `count` units, for ranking gates. */
function gateWorth(def: GateDef, count: number): number {
  if (def.kind === 'fireRate') return count * (1 + def.value * FIRE_RATE_GATE_WORTH);
  return countAfterGate(def.kind, def.value, count);
}

/**
 * How many lanes a gate row fills.
 *
 * The earliest levels fill all three (D31, "levels 1 to 3 are generous"): with
 * no curses to dodge there, an empty lane is the only way a row can hand a
 * player nothing, and it is exactly what a player who is not yet steering well
 * walks into. From `gen.fullGateRowsFromLevel` on, a row keeps a lane clear
 * most of the time and the third gate is the exception again.
 */
function gateSlots(rng: Rng, config: LevelGenConfig): number {
  if (config.index < balance.gen.fullGateRowsFromLevel) return 3;
  return rng() < balance.gen.thirdGateChance ? 3 : 2;
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

/** A block standing short of a gate row, so the player meets it on the way in. */
function guardBlock(rng: Rng, config: LevelGenConfig, budget: RowBudget, lane: Lane): RowEnemyDef {
  const kind = rng() < balance.gen.bruteChance ? 'brute' : 'grunt';
  return {
    kind,
    lane,
    units: blockUnits(rng, config, budget.estimate, kind, balance.gen.mixedBlockFrac),
    // Short of the gate, not on it: the block is something to clear on the way
    // in, and its HP label keeps well clear of the gate's number on screen.
    dz: -balance.gen.mixedEnemyOffset,
  };
}

function laneOfKind(row: RowDef, kind: string): Lane | null {
  for (const lane of LANES) {
    if (row.gates[lane + 1]?.kind === kind) return lane;
  }
  return null;
}

/**
 * A multiplier is the biggest swing on the board, so it never comes free: the
 * row it sits on carries a curse in another lane, or a block in front of the
 * multiplier itself (docs/06-milestone-2-plan.md, "Feel and difficulty").
 */
function pairMultiplier(row: RowDef, rng: Rng, config: LevelGenConfig, budget: RowBudget): void {
  const lane = laneOfKind(row, 'mul');
  if (lane === null) return;
  if (row.gates.some((g) => g?.kind === 'sub')) return;
  if (row.enemies.some((e) => e.lane === lane)) return;
  row.enemies.push(guardBlock(rng, config, budget, lane));
}

export function gateRow(
  rng: Rng,
  config: LevelGenConfig,
  z: number,
  budget: RowBudget,
  permits: RowPermits,
): RowDef {
  const slots = gateSlots(rng, config);
  const lanes = pickLanes(rng, slots);
  const kinds = rowGateKinds(rng, config.index, slots, permits);

  const row: RowDef = {
    z,
    gates: rowGates(rng, config, budget, lanes, kinds),
    enemies: [],
    streams: [],
  };
  pairMultiplier(row, rng, config, budget);
  return row;
}

/**
 * Gates in two lanes with a block standing in the better lane, so the gate the
 * player wants is the one that costs them something to reach.
 */
export function mixedRow(
  rng: Rng,
  config: LevelGenConfig,
  z: number,
  budget: RowBudget,
  permits: RowPermits,
): RowDef {
  const slots = Math.min(gateSlots(rng, config), 3);
  const lanes = pickLanes(rng, slots);
  const kinds = rowGateKinds(rng, config.index, slots, permits);
  const gates = rowGates(rng, config, budget, lanes, kinds);

  let guardedLane: Lane = lanes[0] ?? 0;
  let guardedWorth = -Infinity;
  for (const lane of lanes) {
    const def = gates[lane + 1];
    if (def === null || def === undefined) continue;
    // The block guards the lane a player actually wants, so the good gate costs
    // something to take.
    const worth = gateWorth(def, budget.estimate);
    if (def.kind !== 'sub' && worth > guardedWorth) {
      guardedWorth = worth;
      guardedLane = lane;
    }
  }

  const row: RowDef = {
    z,
    gates,
    enemies: [guardBlock(rng, config, budget, guardedLane)],
    streams: [],
  };
  pairMultiplier(row, rng, config, budget);
  return row;
}

/**
 * A wall of brutes: the Milestone 2 enemy row, kept because a stream is a rate
 * and a brute is a lump, and the road wants both (D29).
 *
 * The row's threat is one budget split across its lanes, not one budget per
 * lane: a wide squad overlaps every lane at once, so three full-sized blocks on
 * one row is not three times the choice, it is a wipe.
 */
export function bruteRow(rng: Rng, config: LevelGenConfig, z: number, budget: RowBudget): RowDef {
  const lanes = pickLanes(rng, randomInt(rng, 1, 2));
  const share = 1 / lanes.length;
  const enemies: RowEnemyDef[] = [];
  for (const lane of lanes) {
    enemies.push({ kind: 'brute', lane, units: blockUnits(rng, config, budget.estimate, 'brute', share) });
  }
  return { z, gates: emptyGates(), enemies, streams: [] };
}

function streamDuration(rng: Rng): number {
  const range = balance.streams.duration;
  return randomRange(rng, range.min, range.max);
}

/** One lane's river. `rowIndex` is what the stream's size is scaled against. */
export function streamRow(rng: Rng, config: LevelGenConfig, rowIndex: number, z: number): RowDef {
  const lane = LANES[Math.min(2, Math.floor(rng() * 3))] ?? 0;
  const def = sizeStream(config, rowIndex, lane, 'single', streamDuration(rng));
  return { z, gates: emptyGates(), enemies: [], streams: [def] };
}

/** Two lanes `gen.hordeLaneGap` apart, or the widest pair the road allows. */
function hordeLanes(rng: Rng): [Lane, Lane] {
  const gap = Math.max(1, Math.round(balance.gen.hordeLaneGap));
  const pairs: Array<[Lane, Lane]> = [];
  for (const a of LANES) {
    for (const b of LANES) if (b - a === gap) pairs.push([a, b]);
  }
  if (pairs.length === 0) return [-1, 1];
  return pairs[Math.min(pairs.length - 1, Math.floor(rng() * pairs.length))] ?? [-1, 1];
}

/**
 * Two lanes at once. The lanes are `gen.hordeLaneGap` apart, so the squad has
 * to split its fire or give one of them up and eat the leaks.
 */
export function hordeRow(rng: Rng, config: LevelGenConfig, rowIndex: number, z: number): RowDef {
  const [first, second] = hordeLanes(rng);
  const duration = streamDuration(rng);
  return {
    z,
    gates: emptyGates(),
    enemies: [],
    streams: [
      sizeStream(config, rowIndex, first, 'horde', duration),
      sizeStream(config, rowIndex, second, 'horde', duration),
    ],
  };
}
