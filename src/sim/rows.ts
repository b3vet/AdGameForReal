/**
 * Building one row of a level: what stands in it and where.
 *
 * Split out of `level.ts` with the gate rules in `gateGen.ts`, so `level.ts` is
 * only the curve, the row mix and the assembly.
 */

import { emptyGates, rowGateKinds, rowGates, shuffle } from './gateGen';
import type { RowBudget, RowPermits } from './gateGen';
import { countAfterGate, FIRE_RATE_GATE_WORTH } from './gates';
import { randomInt, randomRange } from './rng';
import type { EnemyKind, GateDef, Lane } from './types';
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
}

/** What a gate is worth to a player holding `count` units, for ranking gates. */
function gateWorth(def: GateDef, count: number): number {
  if (def.kind === 'fireRate') return count * (1 + def.value * FIRE_RATE_GATE_WORTH);
  return countAfterGate(def.kind, def.value, count);
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

/** A block standing short of a gate row, so the player meets it on the way in. */
function guardBlock(rng: Rng, config: LevelGenConfig, budget: RowBudget, lane: Lane): RowEnemyDef {
  const kind = pickEnemyKind(rng);
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
  const slots = rng() < balance.gen.thirdGateChance ? 3 : 2;
  const lanes = pickLanes(rng, slots);
  const kinds = rowGateKinds(rng, config.index, slots, permits);

  const row: RowDef = { z, gates: rowGates(rng, config, budget, lanes, kinds), enemies: [] };
  pairMultiplier(row, rng, config, budget);
  return row;
}

/**
 * A wall of blocks. The row's threat is one budget split across its lanes, not
 * one budget per lane: a wide squad overlaps every lane at once, so three
 * full-sized blocks on one row is not three times the choice, it is a wipe.
 */
export function enemyRow(rng: Rng, config: LevelGenConfig, z: number, budget: RowBudget): RowDef {
  const lanes = pickLanes(rng, randomInt(rng, 1, 3));
  const share = 1 / lanes.length;
  const enemies: RowEnemyDef[] = [];
  for (const lane of lanes) {
    const kind = pickEnemyKind(rng);
    enemies.push({ kind, lane, units: blockUnits(rng, config, budget.estimate, kind, share) });
  }
  return { z, gates: emptyGates(), enemies };
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
  const lanes = pickLanes(rng, 2);
  const kinds = rowGateKinds(rng, config.index, 2, permits);
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

  const row: RowDef = { z, gates, enemies: [guardBlock(rng, config, budget, guardedLane)] };
  pairMultiplier(row, rng, config, budget);
  return row;
}

