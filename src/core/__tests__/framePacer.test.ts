/**
 * The frame loop's cap (`../framePacer.ts`): which display refreshes are drawn.
 *
 * Driven with the timestamps each kind of display hands
 * `requestAnimationFrame`: whole multiples of its refresh period, rounded the
 * way browsers round them.
 */

import { describe, expect, it } from 'vitest';

import { FramePacer } from '../framePacer';

/** Feeds `seconds` of callbacks at `hz` and answers how many drew. */
function drawnPerSecond(pacer: FramePacer, hz: number, seconds = 10, start = 1000): number {
  const period = 1000 / hz;
  const callbacks = Math.round(seconds * hz);
  let drawn = 0;
  for (let i = 0; i < callbacks; i++) {
    // Rounded to a tenth of a millisecond, as a page without cross-origin
    // isolation sees them.
    const time = Math.round((start + i * period) * 10) / 10;
    if (pacer.due(time)) drawn++;
  }
  return drawn / seconds;
}

describe('FramePacer', () => {
  it('draws every refresh of a 60 Hz display, for as long as it runs', () => {
    const pacer = new FramePacer(60, 4);
    // Ten minutes: a cadence that drifted by a rounding would start skipping.
    expect(drawnPerSecond(pacer, 60, 600)).toBe(60);
  });

  it('draws every other refresh of a 120 Hz display, evenly', () => {
    const pacer = new FramePacer(60, 4);
    const pattern: boolean[] = [];
    for (let i = 0; i < 12; i++) pattern.push(pacer.due(1000 + (i * 1000) / 120));
    expect(pattern).toEqual([true, false, true, false, true, false, true, false, true, false, true, false]);
    expect(drawnPerSecond(new FramePacer(60, 4), 120)).toBe(60);
  });

  it('holds sixty a second on a 90 Hz display, and every other refresh at 144', () => {
    expect(drawnPerSecond(new FramePacer(60, 4), 90)).toBeCloseTo(60, 0);
    // Two 144 Hz refreshes are 13.9 ms, inside the slack of a 60 Hz period:
    // even pacing at 72 beats uneven pacing at 60.
    expect(drawnPerSecond(new FramePacer(60, 4), 144)).toBe(72);
  });

  it('draws every refresh of a display slower than the cap', () => {
    expect(drawnPerSecond(new FramePacer(60, 4), 50)).toBe(50);
    expect(drawnPerSecond(new FramePacer(60, 4), 30)).toBe(30);
  });

  it('draws the first callback after a start, and after a stall, at once', () => {
    const pacer = new FramePacer(60, 4);
    expect(pacer.due(1000)).toBe(true);
    expect(pacer.due(1008.3)).toBe(false);
    pacer.reset();
    expect(pacer.due(1016.7)).toBe(true);
    // A long frame: the next refresh draws, and the cadence starts from it
    // rather than trying to catch up with two quick frames.
    expect(pacer.due(1300)).toBe(true);
    expect(pacer.due(1308.3)).toBe(false);
    expect(pacer.due(1316.7)).toBe(true);
  });

  it('counts every callback, drawn or skipped', () => {
    const pacer = new FramePacer(60, 4);
    drawnPerSecond(pacer, 120, 2);
    expect(pacer.callbacks).toBe(240);
  });
});
