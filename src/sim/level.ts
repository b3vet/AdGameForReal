/**
 * Level generation: the shape of a level and the curve every number on it is
 * sized against. The gates themselves are built in `gateGen.ts`.
 *
 * Every gate value and block size is scaled by `squadCurve`: how big the squad
 * is expected to be by the time it reaches that row. A level therefore plays
 * the same shape whether the player arrives with 20 units or 400, and
 * `hpScale` in `levels.json` is the difficulty dial on top of it — it says how
 * much of the expected squad one block is worth.
 */

import { growsTheSquad, shuffle } from './gateGen';
import type { RowBudget } from './gateGen';
import { enemyRow, gateRow, mixedRow } from './rows';
import type { RowDef, RowEnemyDef, RowPermits } from './rows';
import { mulberry32 } from './rng';
import type { GateDef, Lane } from './types';
import { balance } from '@/data';
import type { LevelGenConfig } from '@/data/types';

export { FIRE_RATE_GATE_WORTH } from './gates';
export type { LevelGenConfig, RowDef, RowEnemyDef };

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

export const BOSS_Z_OFFSET = balance.level.bossOffset;

/** Lane centre in meters. `laneWidth` is 2, so lanes sit at `x = -2, 0, +2`. */
export function laneCenter(lane: Lane, laneWidth = balance.road.laneWidth): number {
  return lane * laneWidth;
}

/**
 * Which lane a point stands in. Rounded on `|x|` so the two boundaries are
 * mirror images: plain `Math.round` breaks ties toward `+infinity`, which put
 * `x = +1` in the right lane but `x = -1` in the middle one — visible the
 * moment a wide squad is clamped to exactly `±road.clampMin`.
 */
export function laneOf(x: number, laneWidth = balance.road.laneWidth): Lane {
  const raw = Math.sign(x) * Math.round(Math.abs(x) / laneWidth);
  return Math.min(1, Math.max(-1, raw)) as Lane;
}

type Rng = () => number;

/** Row kinds, as `dealRowKinds` deals them. */
const GATE_ROW = 0;
const ENEMY_ROW = 1;
const MIXED_ROW = 2;

/**
 * How big the squad is expected to be at row `i`.
 *
 * Squads grow by walking through gates, not by shooting them — shoot-to-grow is
 * a rate now (D19), worth a couple of units a second whatever the squad size —
 * so the generator follows a curve. It runs geometrically from `startCount` to
 * the level's `peakTarget`, and every threat, gate value and gate cap on the row
 * is sized against it. That is what makes level 1 peak near 60 and level 10 near
 * 450 instead of every level saturating at the shared count cap: the curve, not
 * the cap, is the level's ambition. A player who keeps up is fine; one who falls
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
 * What one `add` gate has to hand over for the level to reach its `peakTarget`.
 *
 * A gate row carries the growth of the enemy rows around it as well as its own,
 * and the `mul` gates sprinkled through the level already carry part of that by
 * themselves — so the budget left for add gates is the curve's per-row growth,
 * raised to "one row in every `gateRowShare`", with the expected `mul` payout
 * divided out, and then the share a player shoots in on the way (`addShotBonus`)
 * taken off the top. One set of dials then serves a level that grows 5 into 60
 * and one that grows 12 into 450 with half its rows full of blocks.
 */
export function addValueAt(config: LevelGenConfig, estimate: number): number {
  const gen = balance.gen;
  const perGateRow = Math.log(curveGrowth(config)) / gateRowShare(config);
  const mulMean = (config.gateValues.mul.min + config.gateValues.mul.max) / 2;
  const mulChance = config.index >= gen.mulFromLevel ? Math.min(0.9, Math.max(0, gen.mulChance)) : 0;
  const fromAdds = (perGateRow - mulChance * Math.log(Math.max(1, mulMean))) / (1 - mulChance);
  const frac = Math.max(gen.addFracFloor, (Math.exp(fromAdds) - 1) / (1 + gen.addShotBonus));
  return estimate * frac * gen.addValueShare;
}

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
 * The kind of every row, dealt rather than rolled: `0` gate, `1` enemy,
 * `2` mixed.
 *
 * The weights in `levels.json` are a mix, not a per-row probability. Rolling
 * them row by row made the number of gate rows a coin-flip — a level of sixteen
 * rows swung between six and eleven of them — and since every gate row is a
 * multiplicative step, two rows either way was the difference between a squad
 * of 90 and a squad of 290 on the same level. So the mix is dealt out and
 * shuffled, and only the order is random.
 *
 * The first row is always a plain gate row: the player needs units before
 * anything is allowed to take units away.
 */
function dealRowKinds(rng: Rng, config: LevelGenConfig, rowCount: number): number[] {
  const weights = config.rowWeights;
  const total = Math.max(1, weights.gate + weights.enemy + weights.mixed);
  const rest = Math.max(0, rowCount - 1);
  const enemies = Math.round((rest * weights.enemy) / total);
  const mixed = Math.round((rest * weights.mixed) / total);
  const gates = Math.max(0, rest - enemies - mixed);

  const tail: number[] = [];
  for (let i = 0; i < gates; i++) tail.push(GATE_ROW);
  for (let i = 0; i < enemies; i++) tail.push(ENEMY_ROW);
  for (let i = 0; i < mixed; i++) tail.push(MIXED_ROW);
  shuffle(rng, tail);

  // A long run of pure enemy rows is a dead zone: the squad cannot grow while
  // the curve behind the next row's blocks keeps rising, so the level walks the
  // player into a wall they were never given the units for. Broken by swapping
  // rather than rewriting, so the mix the level was dealt survives.
  const maxRun = Math.max(1, balance.gen.maxEnemyRun);
  let run = 0;
  for (let i = 0; i < tail.length; i++) {
    if (tail[i] !== ENEMY_ROW) {
      run = 0;
      continue;
    }
    run++;
    if (run <= maxRun) continue;
    let j = i + 1;
    while (j < tail.length && tail[j] === ENEMY_ROW) j++;
    if (j < tail.length) {
      tail[i] = tail[j] ?? GATE_ROW;
      tail[j] = ENEMY_ROW;
    } else {
      tail[i] = MIXED_ROW;
    }
    run = 0;
  }

  return [GATE_ROW, ...tail];
}

/** Rows from `from` onward that will carry gates. Never zero, so it divides. */
function countGateRows(kinds: readonly number[], from: number): number {
  let count = 0;
  for (let i = from; i < kinds.length; i++) {
    if (kinds[i] !== ENEMY_ROW) count++;
  }
  return Math.max(1, count);
}

/**
 * How many `mul` gates this level should carry.
 *
 * A budget rather than a coin flip per row: multiplied growth is the loudest
 * term in the curve, and a level that rolled three multipliers played nothing
 * like the same level that rolled none — which showed up as the greedy bot
 * arriving at some bosses with half the squad the level was built for.
 */
function mulBudget(index: number, rowCount: number, config: LevelGenConfig): number {
  if (index < balance.gen.mulFromLevel) return 0;
  return Math.round(balance.gen.mulChance * rowCount * gateRowShare(config));
}

/** How many staff gates this level may carry, and whether they are on at all. */
function weaponBudget(index: number): number {
  const gen = balance.gen;
  if (!gen.weaponGatesEnabled) return 0;
  return index >= gen.weaponGateManyFromLevel ? gen.weaponGatesLate : gen.weaponGatesEarly;
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

  const rows: RowDef[] = [];
  const kinds = dealRowKinds(rng, config, rowCount);
  let weaponsLeft = weaponBudget(index);
  let mulsLeft = mulBudget(index, rowCount, config);

  for (let i = 0; i < rowCount; i++) {
    const z = spacing * (i + 1);
    const budget = budgetFor(config, i);
    const kind = kinds[i] ?? GATE_ROW;
    // Spread the multiplier budget over the gate rows that are actually left,
    // counted from the dealt row kinds: rolling it against every row wasted the
    // budget on enemy rows, which have no lane to put a multiplier in.
    const gateRowsLeft = countGateRows(kinds, i);
    const permits: RowPermits = {
      mul: i > 0 && kind !== ENEMY_ROW && mulsLeft > 0 && rng() < mulsLeft / gateRowsLeft,
      weapon: i > 0 && kind !== ENEMY_ROW && weaponsLeft > 0,
    };

    const row =
      kind === ENEMY_ROW
        ? enemyRow(rng, config, z, budget)
        : kind === MIXED_ROW
          ? mixedRow(rng, config, z, budget, permits)
          : gateRow(rng, config, z, budget, permits);
    if (row.gates.some((g) => g?.kind === 'weapon')) weaponsLeft--;
    if (row.gates.some((g) => g?.kind === 'mul')) mulsLeft--;
    rows.push(row);
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

/** True when a row hands the player some way to come out of it bigger. */
export function rowOffersGrowth(row: RowDef): boolean {
  const gates: ReadonlyArray<GateDef | null> = row.gates;
  if (gates.some((g) => g === null)) return true;
  return gates.some((g) => g !== null && growsTheSquad(g.kind));
}
