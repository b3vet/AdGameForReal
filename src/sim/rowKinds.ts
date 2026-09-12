/**
 * What kind of row goes where.
 *
 * Split out of `level.ts` in Milestone 4: the deal grew two rules of its own
 * (no long run of threat rows, no two hordes back to back) and they are about
 * the *shape* of a level rather than about building one.
 *
 * Nothing here draws randomness except the one shuffle: the rules that follow
 * it work by swapping, so a level stays a function of its seed however the
 * rules are edited.
 */

import { shuffle } from './gateGen';
import { balance } from '@/data';
import type { LevelGenConfig } from '@/data/types';

type Rng = () => number;

/** Row kinds, as `dealRowKinds` deals them. */
export const GATE_ROW = 0;
export const MIXED_ROW = 1;
export const STREAM_ROW = 2;
export const HORDE_ROW = 3;
export const BRUTE_ROW = 4;

/**
 * The kind of every row, dealt rather than rolled.
 *
 * `levels.json` names the counts outright now — how many gate rows, how many of
 * those also guard a block, how many threat rows pour two streams and how many
 * stand a brute — because those counts *are* the level's shape and a per-row
 * roll made them a coin flip (Milestone 2 found the same thing for gates). Only
 * the order is random, and only within the rules below.
 *
 * Two rules on the order. The first row is always a plain gate row: the player
 * needs units before anything is allowed to take units away, and on level 1 the
 * plan goes further and forbids a stream before the first gate row. And no two
 * threat rows in a row past `gen.maxEnemyRun`, so a level never walks the
 * player through a dead zone they cannot grow out of.
 */
export function dealRowKinds(rng: Rng, config: LevelGenConfig, rowCount: number): number[] {
  const gateRows = Math.min(rowCount, Math.max(1, Math.round(config.gateRows)));
  const mixed = Math.min(gateRows - 1, Math.max(0, Math.round(config.mixedRows)));
  const threats = rowCount - gateRows;
  const hordes = Math.min(threats, Math.max(0, Math.round(config.hordeRows)));
  const brutes = Math.min(threats - hordes, Math.max(0, Math.round(config.bruteRows)));

  const tail: number[] = [];
  for (let i = 0; i < gateRows - 1 - mixed; i++) tail.push(GATE_ROW);
  for (let i = 0; i < mixed; i++) tail.push(MIXED_ROW);
  for (let i = 0; i < hordes; i++) tail.push(HORDE_ROW);
  for (let i = 0; i < brutes; i++) tail.push(BRUTE_ROW);
  for (let i = 0; i < threats - hordes - brutes; i++) tail.push(STREAM_ROW);
  shuffle(rng, tail);

  // A long run of threat rows is a dead zone: the squad cannot grow while the
  // curve behind the next row's numbers keeps rising, so the level walks the
  // player into a wall they were never given the units for. Broken by swapping
  // rather than rewriting, so the mix the level was dealt survives.
  const maxRun = Math.max(1, balance.gen.maxEnemyRun);
  let run = 0;
  for (let i = 0; i < tail.length; i++) {
    if ((tail[i] ?? GATE_ROW) <= MIXED_ROW) {
      run = 0;
      continue;
    }
    run++;
    if (run <= maxRun) continue;
    let j = i + 1;
    while (j < tail.length && (tail[j] ?? GATE_ROW) > MIXED_ROW) j++;
    if (j < tail.length) {
      const threat = tail[i] ?? STREAM_ROW;
      tail[i] = tail[j] ?? GATE_ROW;
      tail[j] = threat;
    } else {
      tail[i] = MIXED_ROW;
    }
    run = 0;
  }

  separateHordes(tail);
  return [GATE_ROW, ...tail];
}

/**
 * Pulls two horde rows apart.
 *
 * A horde is two streams at once and a late-campaign stream is capped at three
 * hundred bodies, so two horde rows in a row is twelve hundred bodies arriving
 * over a few seconds in the same two lanes — not a hard row, a wipe, and it is
 * what cost the greedy bot levels 16 and 17 when the twenty-level curve was
 * first dealt. Threat rows only ever swap with *other* threat rows, so the
 * gate-row pattern the `maxEnemyRun` rule just fixed is untouched, and the swap
 * draws no randomness: the level stays a function of its seed.
 */
function separateHordes(tail: number[]): void {
  for (let i = 1; i < tail.length; i++) {
    if (tail[i] !== HORDE_ROW || tail[i - 1] !== HORDE_ROW) continue;
    for (let j = 0; j < tail.length; j++) {
      const candidate = tail[j];
      if (j === i || j === i - 1) continue;
      if (candidate === undefined || candidate <= MIXED_ROW || candidate === HORDE_ROW) continue;
      // Never swap into a slot that only moves the pair along. The slot the
      // horde is leaving does not count: it stops being a horde in the swap.
      if (j > 0 && tail[j - 1] === HORDE_ROW && j - 1 !== i) continue;
      if (j + 1 < tail.length && tail[j + 1] === HORDE_ROW && j + 1 !== i) continue;
      tail[j] = HORDE_ROW;
      tail[i] = candidate;
      break;
    }
  }
}

/** Rows from `from` onward that will carry gates. Never zero, so it divides. */
export function countGateRows(kinds: readonly number[], from: number): number {
  let count = 0;
  for (let i = from; i < kinds.length; i++) {
    if ((kinds[i] ?? GATE_ROW) <= MIXED_ROW) count++;
  }
  return Math.max(1, count);
}

