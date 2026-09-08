import { describe, expect, it } from 'vitest';

import { formationOffsets, halfWidth } from '../formation';

/** The formation spiral's radial constant; units must never pack tighter than this. */
const MIN_SEPARATION = 0.3;

const COUNTS = [1, 2, 3, 5, 8, 13, 21, 50, 100, 250, 500];

function minPairDistance(offsets: ReadonlyArray<{ x: number; z: number }>): number {
  let min = Infinity;
  for (let i = 0; i < offsets.length; i++) {
    for (let j = i + 1; j < offsets.length; j++) {
      const a = offsets[i];
      const b = offsets[j];
      if (a === undefined || b === undefined) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < min) min = d;
    }
  }
  return min;
}

describe('formationOffsets', () => {
  it('returns exactly one offset per unit', () => {
    for (const count of COUNTS) {
      expect(formationOffsets(count)).toHaveLength(count);
    }
  });

  it('returns an empty formation for a wiped-out squad', () => {
    expect(formationOffsets(0)).toHaveLength(0);
    expect(formationOffsets(-5)).toHaveLength(0);
  });

  it('never places two units closer than the minimum separation', () => {
    for (const count of COUNTS) {
      if (count < 2) continue;
      expect(minPairDistance(formationOffsets(count))).toBeGreaterThanOrEqual(MIN_SEPARATION);
    }
  });

  it('is cached, so the same count returns the same array instance', () => {
    expect(formationOffsets(37)).toBe(formationOffsets(37));
  });

  it('is deterministic: the same count always produces the same positions', () => {
    const first = formationOffsets(12).map((o) => `${o.x.toFixed(6)},${o.z.toFixed(6)}`);
    const second = formationOffsets(12).map((o) => `${o.x.toFixed(6)},${o.z.toFixed(6)}`);
    expect(second).toEqual(first);
  });

  it('is a prefix sequence: growing the squad keeps existing units in place', () => {
    const small = formationOffsets(10);
    const large = formationOffsets(40);
    for (let i = 0; i < small.length; i++) {
      expect(large[i]).toEqual(small[i]);
    }
  });
});

describe('halfWidth', () => {
  it('grows monotonically with the squad count', () => {
    let previous = halfWidth(1);
    for (let count = 2; count <= 500; count++) {
      const current = halfWidth(count);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('grows strictly over the range the game actually spans', () => {
    expect(halfWidth(500)).toBeGreaterThan(halfWidth(100));
    expect(halfWidth(100)).toBeGreaterThan(halfWidth(10));
    expect(halfWidth(10)).toBeGreaterThan(halfWidth(1));
  });

  it('covers every unit in the formation plus padding', () => {
    for (const count of COUNTS) {
      const widest = Math.max(...formationOffsets(count).map((o) => Math.abs(o.x)));
      expect(halfWidth(count)).toBeGreaterThan(widest);
    }
  });

  it('is zero for an empty squad', () => {
    expect(halfWidth(0)).toBe(0);
  });
});
