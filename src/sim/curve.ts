/**
 * The curve every number on a level is sized against.
 *
 * Squads grow by walking through gates, not by shooting them — shoot-to-grow is
 * a rate now (D19), worth a couple of units a second whatever the squad size —
 * so the generator follows a curve. It runs geometrically from `startCount` to
 * the level's `peakTarget`, and every threat, gate value and gate cap on the row
 * is sized against it. That is what makes level 1 peak near 100 and level 10
 * near 400 instead of every level saturating at the shared count cap: the
 * curve, not the cap, is the level's ambition.
 *
 * Split out of `level.ts` in Milestone 3 so the stream sizing in `pressure.ts`
 * can read the curve without importing the level assembler that uses it.
 */

import { balance } from '@/data';
import type { LevelGenConfig } from '@/data/types';

/** How big the squad is expected to be at row `i`. */
export function squadCurve(config: LevelGenConfig, rowIndex: number): number {
  const start = curveStart(config);
  const top = curveTop(config);
  return Math.min(top, start * Math.pow(curveGrowth(config), rowIndex));
}

export function curveStart(config: LevelGenConfig): number {
  return Math.max(1, config.startCount);
}

export function curveTop(config: LevelGenConfig): number {
  return Math.min(balance.squad.maxCount, Math.max(curveStart(config), config.peakTarget));
}

/** Factor the curve grows by from one row to the next. */
export function curveGrowth(config: LevelGenConfig): number {
  const span = Math.max(1, Math.floor(config.rows) - 1);
  return Math.pow(curveTop(config) / curveStart(config), 1 / span);
}

/** Share of this level's rows that carry at least one gate. */
export function gateRowShare(config: LevelGenConfig): number {
  const rows = Math.max(1, Math.floor(config.rows));
  return Math.min(1, Math.max(0.2, config.gateRows / rows));
}

/**
 * What one `add` gate has to hand over for the level to reach its `peakTarget`.
 *
 * A gate row carries the growth of the threat rows around it as well as its own,
 * and the `mul` gates sprinkled through the level already carry part of that by
 * themselves — so the budget left for add gates is the curve's per-row growth,
 * raised to "one row in every `gateRowShare`", with the expected `mul` payout
 * divided out, and then the share a player shoots in on the way (`addShotBonus`)
 * taken off the top. One set of dials then serves a level that grows 5 into 105
 * and one that grows 12 into 400 with half its rows full of enemies.
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
