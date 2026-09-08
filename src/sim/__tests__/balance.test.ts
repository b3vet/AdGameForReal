/**
 * The balance contract from docs/03-milestone-1-plan.md: the level curve has to
 * reward playing well and punish playing badly, measured by three scripted
 * players over a fixed seed set.
 */

import { describe, expect, it } from 'vitest';

import { summarise } from './harness';
import { levelCount } from '@/data';

const SEEDS = [1, 2, 3, 4, 5];

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

  it('makes the random bot lose at least three levels of ten', () => {
    const random = summarise('random', SEEDS);
    expect(random.meanLosses).toBeGreaterThanOrEqual(3);
  });

  it('makes the worst-gate bot lose at least seven levels of ten', () => {
    const worst = summarise('worst', SEEDS);
    expect(worst.meanLosses).toBeGreaterThanOrEqual(7);
  });
});
