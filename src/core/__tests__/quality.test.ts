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
    // The product owner's screen, so the rung line's effective ratio is the
    // rung's own rather than whatever the test runner claims to be.
    deviceRatio: 3,
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
    expect(h.ladder.reason).toBe('start 3x');
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

    // The second one is. The first step keeps the resolution: it is the
    // crowd's low-polygon copy (docs/28, note 5).
    expect(h.window(FRAME_SLOW)).toBe(1);
    expect(h.ladder.rung).toBe(1);
    expect(h.ladder.reason).toBe('p95 3x');
    expect(QUALITY_RUNGS[1]?.crowdDetail).toBe(0);
  });

  it('never drops two stops of resolution at once', () => {
    const h = harness();
    settle(h);
    const ratios: number[] = [];
    for (let i = 0; i < 2 * MAX_QUALITY_RUNG; i++) {
      h.window(FRAME_SLOW);
      ratios.push(QUALITY_RUNGS[h.ladder.rung]?.pixelRatio ?? 0);
    }
    for (let i = 1; i < ratios.length; i++) {
      const drop = (ratios[i - 1] ?? 0) - (ratios[i] ?? 0);
      expect(drop).toBeLessThanOrEqual(0.5);
    }
  });

  it('steps on a steady share of late frames that the p95 lets through', () => {
    const h = harness();
    settle(h);
    // One frame in twenty misses a refresh: 57 fps, and a p95 that is the
    // ordinary frame.
    const lateOne = (i: number): number => (i % 20 === 19 ? 1 / 30 : FRAME_60);
    expect(h.patternWindow(lateOne)).toBe(0);
    expect(h.ladder.p95Ms).toBeLessThan(20);
    expect(h.patternWindow(lateOne)).toBe(1);
    expect(h.ladder.reason).toBe('late 3x');
  });

  it('leaves a device alone that misses a refresh now and then', () => {
    const h = harness();
    settle(h);
    // One in fifty: under the share, however long it goes on.
    const rare = (i: number): number => (i % 50 === 49 ? 1 / 30 : FRAME_60);
    for (let window = 0; window < 4; window++) expect(h.patternWindow(rare)).toBe(0);
    expect(h.ladder.rung).toBe(0);
  });

  it('does not count a stall as a late frame', () => {
    const h = harness();
    settle(h);
    // Four percent of frames are 60 ms stalls: past the late ceiling, so they
    // are hitches a lower rung would not cure, and the p95 is still ordinary.
    const stalls = (i: number): number => (i % 25 === 24 ? 0.06 : FRAME_60);
    for (let window = 0; window < 4; window++) expect(h.patternWindow(stalls)).toBe(0);
    expect(h.ladder.rung).toBe(0);
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
    expect(h.ladder.reason).toBe('level 3x');
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
    expect(h.ladder.reason).toBe('pinned 2x');
    expect(h.feed(FRAME_SLOW, 1000)).toBe(0);
    expect(h.ladder.rung).toBe(3);
    h.ladder.beginLevel();
    expect(h.ladder.rung).toBe(3);
  });

  it('is the crowd, then resolution, then the ragdolls (D38, docs/28)', () => {
    // The table itself, because it is the promise: native first with the
    // whole crowd, the least visible step next, one stop of resolution at a
    // time, and only then fewer bodies.
    expect(QUALITY_RUNGS.map((rung) => rung.pixelRatio)).toEqual([3, 3, 2.5, 2, 1.5, 1, 1, 1]);
    expect(QUALITY_RUNGS.map((rung) => rung.crowdDetail)).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(QUALITY_RUNGS.map((rung) => rung.physics)).toEqual([2, 2, 2, 2, 2, 2, 1, 0]);
  });

  it('reports the effective ratio, which the screen can cap', () => {
    // A 2x screen never renders at 3, whatever the rung says, so the panel has
    // to print what the backing store actually is.
    const ladder = new QualityLadder({ deviceRatio: 2, apply: () => {} });
    expect(ladder.effectiveRatio).toBe(2);
    expect(ladder.reason).toBe('start 2x');
  });

  it('clamps a rung from the query string', () => {
    expect(clampRung(-4)).toBe(0);
    expect(clampRung(99)).toBe(MAX_QUALITY_RUNG);
    expect(clampRung(Number.NaN)).toBe(0);
  });
});
