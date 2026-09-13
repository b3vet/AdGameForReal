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
  gauntletLast(tail, Math.max(0, Math.round(balance.gen.gauntletRows)));
  return [GATE_ROW, ...tail];
}

/**
 * The gauntlet: the last `count` rows before the arena carry no gates.
 *
 * A level's crowd peaks at its last gate row, so whatever the road costs before
 * that is paid for by the gates that follow and never shows on the result
 * screen. `survivors / peak` is therefore a measure of what happens *after* the
 * peak — and with gate rows running to the arena, that is the boss fight and
 * nothing else, which is why D45's survivor band and its clear band pulled
 * against each other: measured on the human bot, a boss that takes half the
 * crowd is a boss half the runs lose to, and the two numbers moved together
 * whatever the boss's hp and bite were set to.
 *
 * A gauntlet gives the road its share of the answer. The squad stops growing,
 * walks the last stretch through rivers and blocks, and the fight starts from
 * whatever that leaves — which is the shape the plan asks for in words ("a
 * squad that arrives at the result screen thinned") and could not reach in
 * numbers.
 *
 * It is the last rule applied, and it overrides `maxEnemyRun` on purpose: that
 * rule exists because a run of threat rows is a dead zone the curve behind the
 * *next* row's numbers has already left behind, and at the end of a level there
 * is no next row. Swapped rather than rewritten, like the rules above, and it
 * draws no randomness, so a level stays a function of its seed.
 */
function gauntletLast(tail: number[], count: number): void {
  for (let k = 0; k < count; k++) {
    const last = tail.length - 1 - k;
    if (last < 1 || (tail[last] ?? GATE_ROW) > MIXED_ROW) continue;
    for (let j = last - 1; j >= 0; j--) {
      const candidate = tail[j];
      if (candidate === undefined || candidate <= MIXED_ROW) continue;
      tail[j] = tail[last] ?? GATE_ROW;
      tail[last] = candidate;
      break;
    }
  }
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

