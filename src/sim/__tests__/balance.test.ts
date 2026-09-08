/**
 * The balance contract from docs/03-milestone-1-plan.md: the level curve has to
 * reward playing well and punish playing badly, measured by three scripted
 * players over a fixed seed set.
 */

import { describe, expect, it } from 'vitest';

import { playLevel, summarise } from './harness';
import { levelConfig, levelCount } from '@/data';

const SEEDS = [1, 2, 3, 4, 5];

/** How far a level's realised peak may drift from the size it was designed for. */
const PEAK_MIN_RATIO = 0.6;
const PEAK_MAX_RATIO = 1.4;

describe('balance', () => {
  it('lets the greedy bot clear all ten levels on every seed', () => {
    const greedy = summarise('greedy', SEEDS);
    expect(greedy.winsByLevel).toEqual(new Array<number>(levelCount).fill(SEEDS.length));
    expect(greedy.meanLosses).toBe(0);
  });

  it('leaves the greedy bot with a real squad at the end, not a remnant', () => {
    const greedy = summarise('greedy', SEEDS);
    expect(greedy.meanSurvivorShare).toBeGreaterThanOrEqual(0.15);
  });

  it('grows the greedy bot to about each level\'s peak target, not to the cap', () => {
    // The point of `peakTarget`: level 1 is a squad of dozens and level 10 a
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

  it('makes the random bot lose at least three levels of ten', () => {
    const random = summarise('random', SEEDS);
    expect(random.meanLosses).toBeGreaterThanOrEqual(3);
  });

  it('makes the worst-gate bot lose at least seven levels of ten', () => {
    const worst = summarise('worst', SEEDS);
    expect(worst.meanLosses).toBeGreaterThanOrEqual(7);
  });
});
