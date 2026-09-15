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

  it('clamps the window to what the buffers hold', () => {
    const recorder = new CaptureRecorder();
    recorder.start(0, MAX_CAPTURE_SECONDS * 10);

    expect(recorder.secondsLeft(0)).toBe(MAX_CAPTURE_SECONDS);
  });
});
