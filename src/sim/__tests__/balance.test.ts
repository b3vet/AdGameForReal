/**
 * The balance contract from docs/06-milestone-2-plan.md ("Feel and difficulty"):
 * the campaign has to reward playing well, punish playing badly, and give every
 * boss a fight worth the walk. Measured by three scripted players over a fixed
 * seed set.
 */

import { describe, expect, it } from 'vitest';

import { playLevel, summarise } from './harness';
import { levelConfig, levelCount } from '@/data';

const SEEDS = [1, 2, 3, 4, 5];

/** How far a level's realised peak may drift from the size it was designed for. */
const PEAK_MIN_RATIO = 0.6;
const PEAK_MAX_RATIO = 1.4;

/** A good player ends the level with this share of the squad they peaked at. */
const SURVIVOR_MIN = 0.35;
const SURVIVOR_MAX = 0.65;

/** Seconds of boss fight a good squad should be signing up for. */
const BOSS_MIN_SECONDS = 18;
const BOSS_MAX_SECONDS = 32;

describe('balance', () => {
  it('lets the greedy bot clear all ten levels on every seed', () => {
    const greedy = summarise('greedy', SEEDS);
    expect(greedy.winsByLevel).toEqual(new Array<number>(levelCount).fill(SEEDS.length));
    expect(greedy.meanLosses).toBe(0);
  });

  it('leaves a good player between a third and two thirds of their peak', () => {
    // The M1 build ended every level at full strength; the plan asks for a
    // squad that arrives at the result screen visibly thinned.
    const greedy = summarise('greedy', SEEDS);
    expect(greedy.meanSurvivorShare).toBeGreaterThanOrEqual(SURVIVOR_MIN);
    expect(greedy.meanSurvivorShare).toBeLessThanOrEqual(SURVIVOR_MAX);

    for (let level = 1; level <= levelCount; level++) {
      let share = 0;
      for (const seed of SEEDS) {
        const result = playLevel(level, seed, 'greedy');
        share += result.survivors / Math.max(1, result.peakCount);
      }
      const average = share / SEEDS.length;
      expect(`L${String(level)}: ${(average >= SURVIVOR_MIN).toString()}`).toBe(`L${String(level)}: true`);
      expect(`L${String(level)}: ${(average <= SURVIVOR_MAX).toString()}`).toBe(`L${String(level)}: true`);
    }
  });

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
  });

  it('makes every boss a fight of twenty-odd seconds, not a formality', () => {
    for (let level = 1; level <= levelCount; level++) {
      let seconds = 0;
      for (const seed of SEEDS) seconds += playLevel(level, seed, 'greedy').bossSeconds;
      const average = seconds / SEEDS.length;

      expect(`L${String(level)}: ${(average >= BOSS_MIN_SECONDS).toString()}`).toBe(`L${String(level)}: true`);
      expect(`L${String(level)}: ${(average <= BOSS_MAX_SECONDS).toString()}`).toBe(`L${String(level)}: true`);
    }
  });

  it('makes the random bot lose at least six levels of ten', () => {
    const random = summarise('random', SEEDS);
    expect(random.meanLosses).toBeGreaterThanOrEqual(6);
  });

  it('makes the worst-gate bot lose every level', () => {
    const worst = summarise('worst', SEEDS);
    expect(worst.meanLosses).toBe(levelCount);
  });
});
