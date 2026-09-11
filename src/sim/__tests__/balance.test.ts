/**
 * The balance contract. Milestone 2 asked the campaign to reward playing well,
 * punish playing badly and give every boss a fight worth the walk; Milestone 3
 * adds the stream pressure bands and splits the targets by level band, because
 * the first levels are now deliberately generous and the Milestone 2 numbers
 * only come back at level 6 (D31).
 *
 * Measured by three scripted players over a fixed seed set, so every number
 * below is deterministic: a failure here is a design change, not a flake.
 */

import { describe, expect, it } from 'vitest';

import { playLevel, summarise } from './harness';
import { levelConfig, levelCount } from '@/data';

const SEEDS = [1, 2, 3, 4, 5];

/** Ten seeds where the target is itself "of ten". */
const TEN_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** How far a level's realised peak may drift from the size it was designed for. */
const PEAK_MIN_RATIO = 0.6;
const PEAK_MAX_RATIO = 1.4;

/**
 * A campaign of fifty bot runs at sixty-odd seconds of road each is minutes of
 * simulated time, and Milestone 3's levels are twice the length of Milestone
 * 2's. Well past vitest's five-second default, and not a hang.
 */
const CAMPAIGN_TIMEOUT_MS = 120_000;

/** Seconds of boss fight a good squad should be signing up for. */
const BOSS_MIN_SECONDS = 18;
const BOSS_MAX_SECONDS = 32;

interface Band {
  /** Levels this band covers, inclusive. */
  from: number;
  to: number;
  /** What share of their peak a good player walks away with. */
  survivors: [number, number];
  /** Ceiling on the share of one stream that reaches the squad. */
  leak: number;
  /** True where a stream that never leaks would mean the level is too soft. */
  mustLeak: boolean;
}

/** docs/09-milestone-3-plan.md, "Stream pressure", plus D31's survivor split. */
const LATE: Band = { from: 6, to: 10, survivors: [0.35, 0.65], leak: 0.1, mustLeak: true };
const BANDS: readonly Band[] = [
  { from: 1, to: 3, survivors: [0.7, 0.8], leak: 0.03, mustLeak: false },
  { from: 4, to: 5, survivors: [0.55, 0.7], leak: 0.06, mustLeak: false },
  LATE,
];

function bandOf(level: number): Band {
  return BANDS.find((band) => level >= band.from && level <= band.to) ?? LATE;
}

/** `expect` on a labelled string, so a failure names the level that broke. */
function expectTrue(where: string, value: boolean): void {
  expect(`${where}: ${String(value)}`).toBe(`${where}: true`);
}

describe('balance', () => {
  it('lets the greedy bot clear all ten levels on every seed', () => {
    const greedy = summarise('greedy', SEEDS);
    expect(greedy.winsByLevel).toEqual(new Array<number>(levelCount).fill(SEEDS.length));
    expect(greedy.meanLosses).toBe(0);
  }, CAMPAIGN_TIMEOUT_MS);

  it('leaves a good player the share of their peak their level band promises', () => {
    // Levels 1 to 3 are generous (D31), 4 and 5 ramp, and 6 on are the
    // Milestone 2 numbers: a squad that arrives at the result screen thinned.
    for (let level = 1; level <= levelCount; level++) {
      const band = bandOf(level);
      let share = 0;
      for (const seed of SEEDS) {
        const result = playLevel(level, seed, 'greedy');
        share += result.survivors / Math.max(1, result.peakCount);
      }
      const average = share / SEEDS.length;
      const where = `L${String(level)} survivors ${average.toFixed(2)}`;
      expectTrue(where, average >= band.survivors[0] && average <= band.survivors[1]);
    }
  }, CAMPAIGN_TIMEOUT_MS);

  it("grows the greedy bot to about each level's peak target, not to the cap", () => {
    // The point of `peakTarget`: level 1 is a squad of a hundred and level 10 a
    // squad of hundreds. If every level saturated at `maxCount` instead, growth
    // across the campaign would read as one flat wall of units.
    for (let level = 1; level <= levelCount; level++) {
      const target = levelConfig(level).peakTarget;
      let total = 0;
      for (const seed of SEEDS) total += playLevel(level, seed, 'greedy').peakCount;
      const average = total / SEEDS.length;

      expect(average).toBeGreaterThanOrEqual(target * PEAK_MIN_RATIO);
      expect(average).toBeLessThanOrEqual(target * PEAK_MAX_RATIO);
    }
  }, CAMPAIGN_TIMEOUT_MS);

  it('makes every boss a fight of twenty-odd seconds, not a formality', () => {
    for (let level = 1; level <= levelCount; level++) {
      let seconds = 0;
      for (const seed of SEEDS) seconds += playLevel(level, seed, 'greedy').bossSeconds;
      const average = seconds / SEEDS.length;
      const where = `L${String(level)} boss ${average.toFixed(1)}s`;
      expectTrue(where, average >= BOSS_MIN_SECONDS && average <= BOSS_MAX_SECONDS);
    }
  }, CAMPAIGN_TIMEOUT_MS);

  it('lets a stream through the greedy bot only as much as its band allows', () => {
    // The "barely clear" rule (D29). A leak is one soldier, so the share of a
    // stream that reaches the squad is the whole difficulty dial on the road.
    for (let level = 1; level <= levelCount; level++) {
      const band = bandOf(level);
      let share = 0;
      let streams = 0;
      for (const seed of SEEDS) {
        const result = playLevel(level, seed, 'greedy');
        share += result.leakShare * result.streamsSeen;
        streams += result.streamsSeen;
      }
      expect(streams).toBeGreaterThan(0);
      const average = share / streams;
      const where = `L${String(level)} leak ${(average * 100).toFixed(1)}%`;
      expectTrue(where, average <= band.leak);
      // From level 6 a stream the squad never leaks at all is not "barely".
      if (band.mustLeak) expectTrue(`${where} nonzero`, average > 0);
    }
  }, CAMPAIGN_TIMEOUT_MS);

  it('lets even a random player clear level 1 eight times in ten', () => {
    // D31: the first levels are generous. Collecting soldiers should be enough
    // on level 1 — no curses, every gate row full, a boss that bites softly.
    let losses = 0;
    for (const seed of TEN_SEEDS) {
      if (playLevel(1, seed, 'random').status !== 'won') losses++;
    }
    expectTrue(`L1 random losses ${String(losses)}`, losses <= 2);
  }, CAMPAIGN_TIMEOUT_MS);

  it('still makes the random bot lose most of the campaign', () => {
    const random = summarise('random', SEEDS);
    expect(random.meanLosses).toBeGreaterThanOrEqual(6);
  }, CAMPAIGN_TIMEOUT_MS);

  it('makes the worst-gate bot lose every level that has a curse on it', () => {
    // Level 1 has no penalties at all, so "the worst gate" there is still a
    // gate that hands over units and the bot can scrape a win. Every level from
    // 2 on it loses, which is the Milestone 2 target where the curses live.
    for (let level = 2; level <= levelCount; level++) {
      for (const seed of SEEDS) {
        expectTrue(
          `L${String(level)} s${String(seed)} worst lost`,
          playLevel(level, seed, 'worst').status === 'lost',
        );
      }
    }
  }, CAMPAIGN_TIMEOUT_MS);
});
