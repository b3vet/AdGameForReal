/**
 * The degrade ladder's judgement, driven by synthetic frame-time sequences.
 *
 * The rule the iPhone baseline bought (docs/10-milestone-3-log.md): a burst of
 * spikes is not a reason to give up resolution, sustained lateness is. These
 * tests are that sentence, written twice.
 *
 * Frames are fed one window at a time rather than by the second, so a window is
 * never a mixture of the fast frames of one phase and the slow ones of the
 * next. Alignment is the test's business, not the ladder's.
 */

import { describe, expect, it } from 'vitest';

import { MAX_QUALITY_RUNG, QUALITY_RUNGS, QualityLadder, clampRung } from '../quality';

const FRAME_60 = 1 / 60;
/** Comfortably over the 20 ms budget: a device drawing about 40 fps. */
const FRAME_SLOW = 0.025;
/** Enough frames to close any window; the loop stops at the boundary. */
const FRAME_CAP = 4000;

interface Harness {
  ladder: QualityLadder;
  /** Rungs applied, in order, starting with the one applied on construction. */
  applied: number[];
  /** Feeds `frames` frames of `dt` and answers how many steps they caused. */
  feed: (dt: number, frames: number) => number;
  /** Feeds until exactly one more window has been judged. */
  window: (dt: number) => number;
  /** Feeds one window's worth of frames drawn from `pattern`. */
  patternWindow: (pattern: (index: number) => number) => number;
}

function harness(forced: number | null = null): Harness {
  const applied: number[] = [];
  const ladder = new QualityLadder({
    forced,
    apply: (_rung, index) => {
      applied.push(index);
    },
  });

  const feed = (dt: number, frames: number): number => {
    let steps = 0;
    for (let i = 0; i < frames; i++) {
      if (ladder.track(dt)) steps++;
    }
    return steps;
  };

  const patternWindow = (pattern: (index: number) => number): number => {
    const before = ladder.windows;
    let steps = 0;
    for (let i = 0; i < FRAME_CAP && ladder.windows === before; i++) {
      if (ladder.track(pattern(i))) steps++;
    }
    return steps;
  };

  return {
    ladder,
    applied,
    feed,
    window: (dt) => patternWindow(() => dt),
    patternWindow,
  };
}

/** Past the settle window, with nothing left over in the first real window. */
function settle(h: Harness): void {
  h.feed(FRAME_60, Math.ceil(2 / FRAME_60) + 1);
}

describe('QualityLadder', () => {
  it('applies rung 0 on construction and reports why', () => {
    const h = harness();
    expect(h.applied).toEqual([0]);
    expect(h.ladder.rung).toBe(0);
    expect(h.ladder.reason).toBe('start');
  });

  it('ignores the first seconds after a level start', () => {
    const h = harness();
    // Two seconds of terrible frames, all inside the settle window.
    expect(h.feed(0.1, 19)).toBe(0);
    expect(h.ladder.windows).toBe(0);
    expect(h.ladder.rung).toBe(0);
    expect(h.ladder.p95Ms).toBe(0);
  });

  it('does not step on a burst of spikes inside a healthy window', () => {
    const h = harness();
    settle(h);
    // 60 fps with five 200 ms hitches per window. The mean Milestone 2 judged
    // is about 22 ms — over budget, and it would have stepped; the p95 is the
    // ordinary frame, because the hitches are under three percent of them.
    const spiky = (i: number): number => (i % 36 === 35 ? 0.2 : FRAME_60);
    for (let window = 0; window < 4; window++) {
      expect(h.patternWindow(spiky)).toBe(0);
      expect(h.ladder.p95Ms).toBeLessThan(20);
    }
    expect(h.ladder.rung).toBe(0);
  });

  it('steps once sustained slow frames hold for two windows', () => {
    const h = harness();
    settle(h);

    // One window over budget is not a decision.
    expect(h.window(FRAME_SLOW)).toBe(0);
    expect(h.ladder.rung).toBe(0);
    expect(h.ladder.p95Ms).toBeGreaterThan(20);

    // The second one is.
    expect(h.window(FRAME_SLOW)).toBe(1);
    expect(h.ladder.rung).toBe(1);
    expect(h.ladder.reason).toBe('p95');
  });

  it('never drops two stops of resolution at once', () => {
    const h = harness();
    settle(h);
    h.window(FRAME_SLOW);
    h.window(FRAME_SLOW);
    expect(QUALITY_RUNGS[h.ladder.rung]?.pixelRatio).toBe(1.5);
  });

  it('forgets a bad window once the device catches up', () => {
    const h = harness();
    settle(h);
    expect(h.window(FRAME_SLOW)).toBe(0);
    // A good window in between resets the count, so the next bad one is a
    // first strike again rather than the second.
    expect(h.window(FRAME_60)).toBe(0);
    expect(h.window(FRAME_SLOW)).toBe(0);
    expect(h.ladder.rung).toBe(0);
    expect(h.window(FRAME_SLOW)).toBe(1);
  });

  it('resets to rung 0 at a level start and measures again from scratch', () => {
    const h = harness();
    settle(h);
    h.window(FRAME_SLOW);
    h.window(FRAME_SLOW);
    expect(h.ladder.rung).toBe(1);

    h.ladder.beginLevel();
    expect(h.ladder.rung).toBe(0);
    expect(h.ladder.reason).toBe('level');
    expect(h.applied[h.applied.length - 1]).toBe(0);
    expect(h.ladder.windows).toBe(0);

    // The strike from the last level is gone with it: the settle window is
    // back, and two fresh bad windows are needed again.
    settle(h);
    expect(h.window(FRAME_SLOW)).toBe(0);
    expect(h.ladder.rung).toBe(0);
  });

  it('never climbs within a level', () => {
    const h = harness();
    settle(h);
    h.window(FRAME_SLOW);
    h.window(FRAME_SLOW);
    expect(h.ladder.rung).toBe(1);
    for (let i = 0; i < 4; i++) h.window(FRAME_60);
    expect(h.ladder.rung).toBe(1);
  });

  it('walks to the bottom rung and stops there', () => {
    const h = harness();
    settle(h);
    for (let i = 0; i < 2 * MAX_QUALITY_RUNG; i++) h.window(FRAME_SLOW);
    expect(h.ladder.rung).toBe(MAX_QUALITY_RUNG);
    // At the bottom the monitor stops entirely: no more windows, no more steps.
    expect(h.feed(FRAME_SLOW, 500)).toBe(0);
  });

  it('a pinned ladder never steps and says so', () => {
    const h = harness(3);
    expect(h.ladder.rung).toBe(3);
    expect(h.ladder.isPinned).toBe(true);
    expect(h.ladder.reason).toBe('pinned');
    expect(h.feed(FRAME_SLOW, 1000)).toBe(0);
    expect(h.ladder.rung).toBe(3);
    h.ladder.beginLevel();
    expect(h.ladder.rung).toBe(3);
  });

  it('clamps a rung from the query string', () => {
    expect(clampRung(-4)).toBe(0);
    expect(clampRung(99)).toBe(MAX_QUALITY_RUNG);
    expect(clampRung(Number.NaN)).toBe(0);
  });
});
