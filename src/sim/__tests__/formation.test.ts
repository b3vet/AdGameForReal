import { describe, expect, it } from 'vitest';

import { formationOffsets, halfWidth, unitSpacing } from '../formation';

/** Units may pack tighter as the squad grows, but never tighter than this share
 *  of the spacing that squad size is built around. */
const MIN_SEPARATION_FRACTION = 0.8;

/** The road spans `x in [-3, 3]`; a wider crowd than this stands in the grass. */
const MAX_HALF_WIDTH = 2.4;

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

function maxAbs(offsets: ReadonlyArray<{ x: number; z: number }>, axis: 'x' | 'z'): number {
  let max = 0;
  for (const offset of offsets) {
    const value = Math.abs(offset[axis]);
    if (value > max) max = value;
  }
  return max;
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
      const floor = MIN_SEPARATION_FRACTION * unitSpacing(count);
      expect(minPairDistance(formationOffsets(count))).toBeGreaterThanOrEqual(floor);
    }
  });

  it('is an ellipse pointing down the road, never a disc wider than the lane', () => {
    for (const count of COUNTS) {
      if (count < 8) continue;
      const offsets = formationOffsets(count);
      // Elongated along z: the crowd grows down the road, not across it.
      expect(maxAbs(offsets, 'z')).toBeGreaterThan(maxAbs(offsets, 'x'));
      expect(maxAbs(offsets, 'x')).toBeLessThanOrEqual(MAX_HALF_WIDTH);
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

  it('keeps each unit on its own ray as the squad tightens around it', () => {
    // Spacing shrinks with the count, so a growing squad contracts toward the
    // centre rather than reshuffling: unit `i` keeps its bearing, and the whole
    // formation scales by one factor.
    const small = formationOffsets(10);
    const large = formationOffsets(40);
    const scale = unitSpacing(40) / unitSpacing(10);
    for (let i = 1; i < small.length; i++) {
      const a = small[i];
      const b = large[i];
      if (a === undefined || b === undefined) throw new Error('missing offset');
      expect(b.x).toBeCloseTo(a.x * scale, 9);
      expect(b.z).toBeCloseTo(a.z * scale, 9);
    }
  });
});

describe('unitSpacing', () => {
  it('shrinks as the crowd grows, from 0.35 down to roughly a third of that', () => {
    expect(unitSpacing(1)).toBeCloseTo(0.35, 6);
    expect(unitSpacing(500)).toBeLessThan(unitSpacing(100));
    expect(unitSpacing(100)).toBeLessThan(unitSpacing(10));
    expect(unitSpacing(500)).toBeGreaterThan(0.05);
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

  it('keeps even a maximum squad on the road', () => {
    expect(halfWidth(500)).toBeLessThanOrEqual(MAX_HALF_WIDTH);
    // And nothing between here and there is wider, by monotonicity above.
    for (const count of COUNTS) expect(halfWidth(count)).toBeLessThanOrEqual(MAX_HALF_WIDTH);
  });

  it('grows strictly over the range the game actually spans', () => {
    expect(halfWidth(500)).toBeGreaterThan(halfWidth(100));
    expect(halfWidth(100)).toBeGreaterThan(halfWidth(10));
    expect(halfWidth(10)).toBeGreaterThan(halfWidth(1));
  });

  it('covers every unit in the formation plus padding', () => {
    for (const count of COUNTS) {
      expect(halfWidth(count)).toBeGreaterThan(maxAbs(formationOffsets(count), 'x'));
    }
  });

  it('is zero for an empty squad', () => {
    expect(halfWidth(0)).toBe(0);
  });
});
