/**
 * The floors under the reference player: a random thumb and a thumb that takes
 * the worst panel on every row, on the scripted campaign with nothing bought.
 *
 * Neither is a band from document 31; both are older promises that the
 * scripts still have to keep. D31: level 1 is generous enough that collecting
 * soldiers clears it. Milestone 2: choices matter, so a player who picks at
 * random loses most of the campaign and one who picks the worst panel loses
 * every level that prints a curse — every level from 2 on the scripts, whose
 * curse budget is at least two (3.5). A worst-gate clear means the boss is
 * too soft for a crowd that never took a prize; the fix is the boss or the
 * prep beat, not this test.
 *
 * Runtime: about 400 runs, two to three minutes on a quiet box.
 */

import { describe, it } from 'vitest';

import { Findings, expectTrue } from './balanceRuns';
import { playLevel, summarise } from './harness';
import { levelConfig, levelCount } from '@/data';

const SEEDS = [1, 2, 3, 4, 5];
const TEN_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const TIMEOUT_MS = 900_000;

describe('balance: the floor bots', () => {
  it('lets even a random player clear level 1 eight times in ten', () => {
    let losses = 0;
    for (const seed of TEN_SEEDS) {
      if (playLevel(1, seed, 'random').status !== 'won') losses++;
    }
    expectTrue(`L1 random losses ${String(losses)} of 10, at most 2`, losses <= 2);
  }, TIMEOUT_MS);

  it('still makes the random bot lose most of the campaign', () => {
    const random = summarise('random', SEEDS);
    expectTrue(
      `random loses ${random.meanLosses.toFixed(1)} of ${String(levelCount)} levels, floor 6`,
      random.meanLosses >= 6,
    );
  }, TIMEOUT_MS);

  it('makes the worst-gate bot lose every level that prints a curse', () => {
    const findings = new Findings();
    for (let level = 1; level <= levelCount; level++) {
      if ((levelConfig(level).curses ?? 0) <= 0) continue;
      for (const seed of SEEDS) {
        const run = playLevel(level, seed, 'worst');
        findings.check(
          `L${String(level)} s${String(seed)} worst cleared with ${String(run.survivors)} of ` +
            `${String(run.peakCount)} after a ${run.bossSeconds.toFixed(1)} s boss`,
          run.status === 'lost',
        );
      }
    }
    findings.assert();
  }, TIMEOUT_MS);
});
