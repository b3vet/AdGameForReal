import { describe, expect, it } from 'vitest';

import { mulberry32, randomInt, randomRange, weightedIndex } from '../rng';

describe('mulberry32', () => {
  it('is deterministic: the same seed replays the same sequence', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const first = Array.from({ length: 100 }, () => a());
    const second = Array.from({ length: 100 }, () => b());
    expect(second).toEqual(first);
  });

  it('produces different sequences for different seeds', () => {
    const a = Array.from({ length: 20 }, mulberry32(1));
    const b = Array.from({ length: 20 }, mulberry32(2));
    expect(a).not.toEqual(b);
  });

  it('stays within [0, 1)', () => {
    const rng = mulberry32(9876);
    for (let i = 0; i < 10000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('is roughly uniform across ten buckets', () => {
    const rng = mulberry32(42);
    const buckets = new Array<number>(10).fill(0);
    const samples = 100000;
    for (let i = 0; i < samples; i++) {
      const bucket = Math.floor(rng() * 10);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(samples / 10 - samples / 100);
      expect(count).toBeLessThan(samples / 10 + samples / 100);
    }
  });

  it('is unaffected by the seed being passed as a negative or float', () => {
    const a = mulberry32(-1 >>> 0);
    const b = mulberry32(-1);
    expect(a()).toBe(b());
  });
});

describe('helpers', () => {
  it('randomInt stays inside the inclusive range', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const value = randomInt(rng, 3, 6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(6);
    }
  });

  it('randomRange stays inside the half-open range', () => {
    const rng = mulberry32(8);
    for (let i = 0; i < 1000; i++) {
      const value = randomRange(rng, -2.5, 2.5);
      expect(value).toBeGreaterThanOrEqual(-2.5);
      expect(value).toBeLessThan(2.5);
    }
  });

  it('weightedIndex respects the weights and handles degenerate tables', () => {
    const rng = mulberry32(11);
    const hits = [0, 0, 0];
    for (let i = 0; i < 10000; i++) {
      const index = weightedIndex(rng, [0, 1, 3]);
      hits[index] = (hits[index] ?? 0) + 1;
    }
    expect(hits[0]).toBe(0);
    expect(hits[2]).toBeGreaterThan(hits[1] ?? 0);
    expect(weightedIndex(rng, [])).toBe(0);
    expect(weightedIndex(rng, [0, 0])).toBe(0);
  });
});
