/**
 * The backing store's arithmetic (docs/27-device-playtest-fixes.md, section A).
 *
 * The numbers are the product owner's phone: a 440x956 box at 3x, which should
 * be a 1320x2868 buffer and in the first device build was a 1320x1320 one.
 */

import { describe, expect, it } from 'vitest';

import {
  backingLength,
  fittedPixelRatio,
  learnedLimit,
  readoutInShape,
  sameShape,
} from '../backingFit';
import type { CanvasReadout } from '../backingFit';

function readout(backing: [number, number], buffer: [number, number]): CanvasReadout {
  return {
    cssWidth: 440,
    cssHeight: 956,
    backingWidth: backing[0],
    backingHeight: backing[1],
    bufferWidth: buffer[0],
    bufferHeight: buffer[1],
    inShape: false,
  };
}

describe('backingLength', () => {
  it("matches Babylon's own truncation at every rung of the ladder", () => {
    expect(backingLength(440, 3)).toBe(1320);
    expect(backingLength(956, 3)).toBe(2868);
    expect(backingLength(956, 2)).toBe(1912);
    expect(backingLength(956, 1.5)).toBe(1434);
    expect(backingLength(956, 1)).toBe(956);
    // Babylon divides by the scaling level; a product can round differently.
    expect(backingLength(393, 1.5)).toBe((393 / (1 / 1.5)) | 0);
  });
});

describe('sameShape', () => {
  it("passes a truncated backing store and fails the owner's square buffer", () => {
    expect(sameShape(1320, 2868, 440, 956)).toBe(true);
    expect(sameShape(589, 1278, 393, 852)).toBe(true);
    expect(sameShape(1320, 1320, 440, 956)).toBe(false);
    // A landscape buffer under a portrait box is the other way to be wrong.
    expect(sameShape(2868, 1320, 440, 956)).toBe(false);
  });

  it('never calls an empty or unreadable size in shape', () => {
    expect(sameShape(0, 0, 440, 956)).toBe(false);
    expect(sameShape(1320, 2868, 0, 956)).toBe(false);
    expect(sameShape(Number.NaN, 2868, 440, 956)).toBe(false);
  });
});

describe('readoutInShape', () => {
  it('needs both the backing store and the buffer to be the box shape', () => {
    expect(readoutInShape(readout([1320, 2868], [1320, 2868]))).toBe(true);
    // The first device build.
    expect(readoutInShape(readout([1320, 1320], [1320, 1320]))).toBe(false);
    // A clamp: the backing store is right and the buffer is not.
    expect(readoutInShape(readout([1320, 2868], [1320, 2048]))).toBe(false);
    // A lost context reads zeroes, which is not a shape at all.
    expect(readoutInShape(readout([1320, 2868], [0, 0]))).toBe(false);
  });
});

describe('fittedPixelRatio', () => {
  it('hands back exactly what was wanted when it fits', () => {
    expect(fittedPixelRatio(440, 956, 3, 16384, 16384)).toBe(3);
    expect(fittedPixelRatio(440, 956, 3, Infinity, Infinity)).toBe(3);
    // Float and all: a desktop zoom's ratio is not rounded when nothing binds.
    expect(fittedPixelRatio(1280, 720, 1.100000023841858, 8192, 8192)).toBe(1.100000023841858);
  });

  it('lowers both sides together when one side is clamped', () => {
    const ratio = fittedPixelRatio(440, 956, 3, 16384, 2048);
    expect(ratio).toBeLessThan(3);
    const width = backingLength(440, ratio);
    const height = backingLength(956, ratio);
    expect(height).toBeLessThanOrEqual(2048);
    expect(sameShape(width, height, 440, 956)).toBe(true);
    // As high as it can be: one step more would not fit.
    expect(backingLength(956, ratio + 0.002)).toBeGreaterThan(2048);
  });

  it('can go under 1 for a box bigger than the buffer, but never to nothing', () => {
    expect(fittedPixelRatio(5120, 2880, 1, 4096, 4096)).toBeCloseTo(0.8, 3);
    expect(fittedPixelRatio(5120, 2880, 1, 1, 1)).toBe(0.25);
  });

  it('leaves the ratio alone for a box that is not laid out', () => {
    expect(fittedPixelRatio(0, 0, 3, 100, 100)).toBe(3);
  });
});

describe('learnedLimit', () => {
  it('learns a ceiling only from a smaller answer', () => {
    expect(learnedLimit(2868, 2048, Infinity)).toBe(2048);
    expect(learnedLimit(2868, 2868, Infinity)).toBe(Infinity);
    // Never raised again once a device has said no.
    expect(learnedLimit(1000, 900, 800)).toBe(800);
  });

  it('does not mistake a lost context for a limit', () => {
    expect(learnedLimit(2868, 0, Infinity)).toBe(Infinity);
  });
});
