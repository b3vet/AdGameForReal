/**
 * The volley's own brightness (`../spellLook.ts`).
 *
 * The first test in `src/render`, and it is here because the rule it pins is a
 * promise about a *picture*: the Milestone 6 review dimmed the volley so five
 * hundred Storm shots stop washing a third of the frame to white, on the
 * condition that the look at the sizes the first levels are played at does not
 * move at all. "Does not move at all" is a number — the multiplier is exactly
 * 1 — and a number is something a test can hold.
 *
 * Pure TypeScript: `spellLook.ts` imports nothing, so this needs no Babylon and
 * no DOM.
 */

import { describe, expect, it } from 'vitest';

import { VOLLEY_FULL_BOLTS, VOLLEY_MIN_DIM, volleyDim } from '../spellLook';

/**
 * The most bolts a twenty-unit squad was ever measured with in the air: the
 * sim, greedy, levels 1 seed 1, 6 seed 3 and 16 seed 1. The threshold has to
 * stay above it or a twenty-strong squad starts being dimmed.
 */
const BOLTS_AT_TWENTY_UNITS = 39;

describe('volleyDim', () => {
  it('leaves a small squad exactly as it was drawn', () => {
    expect(VOLLEY_FULL_BOLTS).toBeGreaterThanOrEqual(BOLTS_AT_TWENTY_UNITS);
    for (const bolts of [0, 1, 12, BOLTS_AT_TWENTY_UNITS, VOLLEY_FULL_BOLTS]) {
      expect(volleyDim(bolts)).toBe(1);
    }
  });

  it('falls with the square root of the volley past that', () => {
    // Four times the bolts is half the alpha, so the sum over a pixel grows as
    // sqrt(n): twice as much fire reads as brighter, not as white.
    expect(volleyDim(4 * VOLLEY_FULL_BOLTS)).toBeCloseTo(0.5, 6);
    // And it leaves the threshold continuously: one bolt over is a per cent
    // and a bit, not a step the eye can catch.
    expect(volleyDim(VOLLEY_FULL_BOLTS + 1)).toBeLessThan(1);
    expect(volleyDim(VOLLEY_FULL_BOLTS + 1)).toBeGreaterThan(0.98);
  });

  it('never dims past the floor, whatever the crowd does', () => {
    expect(volleyDim(1e6)).toBe(VOLLEY_MIN_DIM);
    expect(volleyDim(400)).toBeGreaterThanOrEqual(VOLLEY_MIN_DIM);
  });

  it('is monotone, so a growing squad is never drawn brighter', () => {
    let last = volleyDim(0);
    for (let bolts = 1; bolts <= 500; bolts++) {
      const dim = volleyDim(bolts);
      expect(dim).toBeLessThanOrEqual(last);
      last = dim;
    }
  });
});
