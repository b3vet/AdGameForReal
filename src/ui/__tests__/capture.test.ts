/**
 * The capture recorder's arithmetic (`src/ui/capture.ts`).
 *
 * It became worth a test in Milestone 9, when the summary stopped being a
 * string and started being numbers the device report quotes: a frame rate that
 * is a percentile of the wrong end reads as a phone that is fine when it is
 * not. The intervals are the measurement and the frame rate is derived from
 * them, so what is checked here is that the derivation points the right way —
 * the p95 *frame* is the slow one, and the p95 *fps* is therefore the low one.
 */

import { describe, expect, it } from 'vitest';

import { CaptureRecorder, MAX_CAPTURE_SECONDS, SPIKE_MS } from '../capture';
import type { DebugStats } from '../debugStats';

function stats(): DebugStats {
  return {
    simMs: 1,
    renderMs: 8,
    physicsMs: 0.5,
    viewsMs: 2,
    drawMs: 6,
    frameMs: 10,
    rafCallbacks: 0,
    activeMeshes: 40,
    triangles: 600_000,
    crowdWhole: 40,
    crowdSmall: 100,
    crowdCulled: 60,
    drawCalls: 30,
    drawCallsPeak: 30,
    streamBodies: 0,
    chargers: 0,
    labels: 0,
    labelGlyphs: 0,
    labelsDropped: 0,
    walls: 0,
    wisp: false,
    sparks: 0,
    burning: 0,
    timeScale: 1,
    ragdolls: 0,
    shards: 0,
    physicsBodies: 0,
    physicsQuality: 2,
    qualityRung: 0,
    qualityP95: 0,
    qualityReason: 'start 3x',
    heapMb: 0,
    heapDrops: 0,
    pixelRatio: 3,
    devicePixelRatio: 3,
    canvas: {
      cssWidth: 440,
      cssHeight: 956,
      backingWidth: 1320,
      backingHeight: 2868,
      bufferWidth: 1320,
      bufferHeight: 2868,
      inShape: true,
    },
    audio: 'unlocked',
    audioClips: 20,
  };
}

/**
 * Feeds `intervals` (ms) as drawn frames and returns the closing summary.
 *
 * The window is sized so the *last* interval is the one that closes it: a
 * capture is closed by the frame that fills it, and a helper that fed one extra
 * frame afterwards would be measuring its own bookkeeping.
 */
function record(intervals: readonly number[]) {
  const total = intervals.reduce((sum, interval) => sum + interval, 0);
  const last = intervals[intervals.length - 1] ?? 0;
  const recorder = new CaptureRecorder();
  let now = 1000;
  recorder.start(now, (total - last / 2) / 1000);
  for (const interval of intervals) {
    now += interval;
    const summary = recorder.add(now, interval / 1000, null, stats());
    if (summary !== null) return summary;
  }
  return null;
}

describe('CaptureRecorder', () => {
  it('reads the frame rate off the slow end of the intervals', () => {
    // Ninety steady frames and ten slow ones: the median is the steady frame
    // and the p95 is one of the slow ones.
    const intervals = [...Array<number>(90).fill(16), ...Array<number>(10).fill(50)];
    const summary = record(intervals);

    expect(summary).not.toBeNull();
    expect(summary?.frameMs.median).toBe(16);
    expect(summary?.frameMs.p95).toBe(50);
    expect(summary?.fpsMedian).toBeCloseTo(1000 / 16, 3);
    // The p95 frame rate is the *low* one — it is the p95 frame, as fps.
    expect(summary?.fpsP95).toBeCloseTo(20, 3);
    expect(summary?.fpsP95).toBeLessThan(summary?.fpsMedian ?? 0);
  });

  it('counts the frames over 20 ms and nothing else', () => {
    // A second of steady frames is the floor a window can be asked for, so the
    // steady half has to be at least that long.
    const summary = record([
      ...Array<number>(100).fill(16),
      ...Array<number>(7).fill(SPIKE_MS + 1),
    ]);

    expect(summary?.over20).toBe(7);
  });

  it('holds a run-less capture and a `?turbo` chunk out of the samples', () => {
    const recorder = new CaptureRecorder();
    recorder.start(0, 1);
    // dt 0 is an intermediate turbo chunk: it drew no frame, so it is not one.
    expect(recorder.add(10, 0, null, stats())).toBeNull();
    const summary = recorder.add(2000, 0.016, null, stats());

    expect(summary?.frames).toBe(1);
    expect(summary?.run).toBeNull();
    expect(summary?.text).toContain('no run');
  });

  it('reads the display rate off the callbacks, not the drawn frames', () => {
    // A 120 Hz display drawn at 60: two callbacks for every frame.
    const recorder = new CaptureRecorder();
    recorder.start(1000, 2);
    let summary = null;
    let callbacks = 500;
    for (let frame = 1; frame <= 130 && summary === null; frame++) {
      callbacks += 2;
      const now = 1000 + (frame * 1000) / 60;
      summary = recorder.add(now, 1 / 60, null, { ...stats(), rafCallbacks: callbacks });
    }
    expect(summary?.rafHz).toBeCloseTo(120, 0);
    expect(summary?.fpsAverage).toBeCloseTo(60, 0);
    expect(summary?.text).toContain('raf 120Hz');
  });

  it('quotes each phase as a mean and the crowd as medians', () => {
    const summary = record(Array<number>(100).fill(16));

    expect(summary?.views.mean).toBeCloseTo(2, 5);
    expect(summary?.draw.mean).toBeCloseTo(6, 5);
    expect(summary?.js.p95).toBeCloseTo(10, 5);
    expect(summary?.triangles.median).toBe(600_000);
    expect(summary?.crowd).toEqual({ whole: 40, small: 100, culled: 60 });
    expect(summary?.text).toContain('tris 600k');
    // A frame loop that never reported its callbacks has no display rate.
    expect(summary?.rafHz).toBe(0);
  });

  it('clamps the window to what the buffers hold', () => {
    const recorder = new CaptureRecorder();
    recorder.start(0, MAX_CAPTURE_SECONDS * 10);

    expect(recorder.secondsLeft(0)).toBe(MAX_CAPTURE_SECONDS);
  });
});
