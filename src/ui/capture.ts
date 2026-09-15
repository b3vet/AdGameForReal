/**
 * The timed readout behind the debug panel's "Capture" button.
 *
 * A window of per-frame numbers reduced to one summary — short enough to paste
 * into a chat message, which is the whole point: the product owner plays a
 * hosted link on a phone and needs one block of text that says whether it ran
 * (docs/09-milestone-3-plan.md, "Performance plan" item 6).
 *
 * Milestone 9 made the summary a *value* as well as a block of text
 * (`CaptureSummary`): the device report quotes the same numbers in its own
 * layout (`src/core/report.ts`), and re-parsing the text would have been two
 * formats to keep in step. The text is still composed here, because it is
 * composed to fit a 390 px panel and nothing else knows that.
 *
 * Samples land in typed arrays allocated once and re-used by every later
 * capture, so a recording frame costs four stores and no allocation (CLAUDE.md:
 * nothing allocates per frame).
 */

import type { RunState } from '@/sim';

import type { DebugStats } from './debugStats';

export const CAPTURE_SECONDS = 10;

/**
 * The longest window anything asks for: `?perf`'s scripted run (`src/core/
 * perf.ts`). It is here because it is what sizes the sample buffers.
 */
export const MAX_CAPTURE_SECONDS = 30;

/**
 * A frame longer than this is a hitch (Milestone 4, "Polish"). Sixty frames a
 * second is 16.7 ms, so 20 ms is the first frame the eye can see stumble; the
 * product owner's capture is meant to report under three of them.
 */
export const SPIKE_MS = 20;

/** How far back the panel's live spike count looks. */
export const SPIKE_WINDOW_SECONDS = 10;

/** Where in a sorted window the "worst realistic frame" is read. */
const PERCENTILE = 0.95;

/**
 * Spike timestamps kept for the live count. A window with more spikes than
 * this is already a broken frame rate, so the ring forgets its oldest rather
 * than growing — the number it reports stops being exact long after it has
 * stopped being useful.
 */
const SPIKE_CAPACITY = 512;

/**
 * How many of the last `SPIKE_WINDOW_SECONDS` of frames took longer than
 * `SPIKE_MS`, as a rolling count.
 *
 * The capture answers the same question for its own window; this one is for the
 * panel, which is up the whole time the product owner is playing. One
 * `Float64Array` allocated once, a head and a length: recording a frame is two
 * stores and no allocation, which matters because the thing being measured is
 * allocation-driven hitching.
 */
export class SpikeWindow {
  private readonly times = new Float64Array(SPIKE_CAPACITY);
  private start = 0;
  private length = 0;
  private last = 0;

  reset(): void {
    this.start = 0;
    this.length = 0;
    this.last = 0;
  }

  /** Records one drawn frame and returns the spikes now inside the window. */
  add(nowMs: number): number {
    if (this.last > 0 && nowMs - this.last > SPIKE_MS) this.push(nowMs);
    this.last = nowMs;
    this.trim(nowMs);
    return this.length;
  }

  private push(at: number): void {
    const index = (this.start + this.length) % SPIKE_CAPACITY;
    this.times[index] = at;
    if (this.length < SPIKE_CAPACITY) this.length++;
    // Full: the newest sample took the oldest one's slot, so the window starts
    // one later.
    else this.start = (this.start + 1) % SPIKE_CAPACITY;
  }

  private trim(nowMs: number): void {
    const floor = nowMs - SPIKE_WINDOW_SECONDS * 1000;
    while (this.length > 0 && (this.times[this.start] ?? 0) < floor) {
      this.start = (this.start + 1) % SPIKE_CAPACITY;
      this.length--;
    }
  }
}

/**
 * Sample slots: the longest window at 270 frames a second, which no phone will
 * reach. A capture that somehow overruns it stops sampling rather than growing
 * the buffer.
 */
const CAPACITY = 8192;

interface Buffers {
  /** Wall-clock milliseconds between drawn frames; the frame rate comes off it. */
  frame: Float32Array;
  sim: Float32Array;
  render: Float32Array;
  physics: Float32Array;
}

/** Min, median, 95th percentile and max of one column of samples. */
export interface Spread {
  min: number;
  median: number;
  p95: number;
  max: number;
}

/**
 * One finished capture, as numbers. `text` is the same capture composed for the
 * panel; the device report lays the numbers out its own way.
 */
export interface CaptureSummary {
  seconds: number;
  frames: number;
  /** Wall-clock frame intervals, in milliseconds. */
  frameMs: Spread;
  /** The frame rate it felt like: the median interval, as fps. */
  fpsMedian: number;
  /**
   * The frame rate at the slow end: the 95th-percentile *interval*, as fps.
   * Reading it off the intervals rather than off a second array of frame rates
   * is exact — fps is a monotonic function of the interval, so the 95th
   * percentile of one is the 5th percentile of the other.
   */
  fpsP95: number;
  /** Frames over `SPIKE_MS` in the window; the milestone's hitch counter. */
  over20: number;
  drawPeak: number;
  rungPeak: number;
  pixelRatio: number;
  devicePixelRatio: number;
  sim: Spread;
  render: Spread;
  physics: Spread;
  /** Null when the capture never saw a run (taken on a menu). */
  run: { level: number; squadMin: number; squadMax: number } | null;
  /** The pasteable block, composed to fit a 390 px panel. */
  text: string;
}

export class CaptureRecorder {
  private buffers: Buffers | null = null;
  private recording = false;
  private samples = 0;
  /** One behind `samples`: an interval needs the frame before it. */
  private frameSamples = 0;
  private startedAt = 0;
  private lastSampleAt = 0;
  private wanted = CAPTURE_SECONDS;

  private drawCallsPeak = 0;
  private rungPeak = 0;
  private pixelRatio = 0;
  private devicePixelRatio = 1;
  private level = 0;
  private squadMin = 0;
  private squadMax = 0;
  private sawRun = false;
  private over20 = 0;

  get active(): boolean {
    return this.recording;
  }

  /** `seconds` is clamped to what the buffers hold; see `CAPACITY`. */
  start(nowMs: number, seconds: number = CAPTURE_SECONDS): void {
    this.buffers ??= {
      frame: new Float32Array(CAPACITY),
      sim: new Float32Array(CAPACITY),
      render: new Float32Array(CAPACITY),
      physics: new Float32Array(CAPACITY),
    };
    this.wanted = Math.min(MAX_CAPTURE_SECONDS, Math.max(1, seconds));
    this.recording = true;
    this.samples = 0;
    this.frameSamples = 0;
    this.startedAt = nowMs;
    this.lastSampleAt = 0;
    this.drawCallsPeak = 0;
    this.rungPeak = 0;
    this.pixelRatio = 0;
    this.devicePixelRatio = 1;
    this.level = 0;
    this.squadMin = 0;
    this.squadMax = 0;
    this.sawRun = false;
    this.over20 = 0;
  }

  cancel(): void {
    this.recording = false;
  }

  /** Whole seconds still to run, for the button's label. */
  secondsLeft(nowMs: number): number {
    const left = this.wanted - (nowMs - this.startedAt) / 1000;
    return Math.max(0, Math.ceil(left));
  }

  /**
   * One frame. Returns the summary on the frame the window closes and null
   * before that, so the caller has exactly one place to react.
   *
   * `dt` is zero on the intermediate chunks of a `?turbo` frame — those drew
   * nothing, so they are not frames and must not enter the sample set.
   */
  add(
    nowMs: number,
    dt: number,
    state: Readonly<RunState> | null,
    stats: DebugStats,
  ): CaptureSummary | null {
    if (!this.recording) return null;

    const buffers = this.buffers;
    if (dt > 0 && buffers !== null && this.samples < CAPACITY) {
      const i = this.samples++;
      buffers.sim[i] = stats.simMs;
      buffers.render[i] = stats.renderMs;
      buffers.physics[i] = stats.physicsMs;

      // Wall clock rather than `dt`: the frame loop clamps its delta so a
      // backgrounded tab cannot teleport the squad, which also means a 460 ms
      // frame reports itself as 20 fps. The worst frame is the whole point of
      // a capture, so this one number is measured, not inherited.
      const since = nowMs - this.lastSampleAt;
      if (this.lastSampleAt > 0 && since > 0) {
        buffers.frame[this.frameSamples++] = since;
        if (since > SPIKE_MS) this.over20++;
      }
      this.lastSampleAt = nowMs;
    }

    if (stats.drawCalls > this.drawCallsPeak) this.drawCallsPeak = stats.drawCalls;
    if (stats.qualityRung > this.rungPeak) this.rungPeak = stats.qualityRung;
    this.pixelRatio = stats.pixelRatio;
    this.devicePixelRatio = stats.devicePixelRatio;

    if (state !== null) {
      const count = Math.max(0, Math.round(state.squad.count));
      if (!this.sawRun) {
        this.sawRun = true;
        this.squadMin = count;
        this.squadMax = count;
      } else if (count < this.squadMin) this.squadMin = count;
      else if (count > this.squadMax) this.squadMax = count;
      this.level = state.levelIndex;
    }

    const elapsed = (nowMs - this.startedAt) / 1000;
    if (elapsed < this.wanted) return null;

    this.recording = false;
    return this.summarise(elapsed);
  }

  private summarise(elapsed: number): CaptureSummary {
    const buffers = this.buffers;
    const count = this.samples;
    const empty: Spread = { min: 0, median: 0, p95: 0, max: 0 };
    const frameMs = buffers === null ? empty : spread(buffers.frame, this.frameSamples);
    const summary: CaptureSummary = {
      seconds: elapsed,
      frames: count,
      frameMs,
      fpsMedian: rate(frameMs.median),
      fpsP95: rate(frameMs.p95),
      over20: this.over20,
      drawPeak: this.drawCallsPeak,
      rungPeak: this.rungPeak,
      pixelRatio: this.pixelRatio,
      devicePixelRatio: this.devicePixelRatio,
      sim: buffers === null ? empty : spread(buffers.sim, count),
      render: buffers === null ? empty : spread(buffers.render, count),
      physics: buffers === null ? empty : spread(buffers.physics, count),
      run: this.sawRun
        ? { level: this.level, squadMin: this.squadMin, squadMax: this.squadMax }
        : null,
      text: '',
    };
    summary.text = compose(summary, count > 0);
    return summary;
  }
}

/**
 * Eight short lines: nothing here may be wider than the panel is at 390 px,
 * because a readout that needs a horizontal scroll is not a readout.
 */
function compose(summary: CaptureSummary, drew: boolean): string {
  const header = `arcane-rush ${summary.seconds.toFixed(1)}s / ${String(summary.frames)} frames`;
  if (!drew) return `${header}\nno frames drawn`;

  const run =
    summary.run === null
      ? 'no run'
      : `lvl ${String(summary.run.level)} squad ${String(summary.run.squadMin)}-` +
        `${String(summary.run.squadMax)}`;

  return [
    header,
    `fps med ${summary.fpsMedian.toFixed(0)} p95 ${summary.fpsP95.toFixed(0)}` +
      `  >${String(SPIKE_MS)}ms ${String(summary.over20)}`,
    `frm ${triple(summary.frameMs, 1)} ms`,
    `sim ${triple(summary.sim, 2)} ms`,
    `rnd ${triple(summary.render, 2)} ms`,
    `phy ${triple(summary.physics, 2)} ms`,
    `draws peak ${String(summary.drawPeak)} rung ${String(summary.rungPeak)} ` +
      `px ${summary.pixelRatio.toFixed(2)}/${summary.devicePixelRatio.toFixed(2)}`,
    `${run} (med/p95/max)`,
  ].join('\n');
}

/**
 * Sorts the filled prefix in place — the samples are not needed again once a
 * capture is being summarised, and `subarray` is a view, so this costs no copy.
 */
function spread(values: Float32Array, count: number): Spread {
  if (count <= 0) return { min: 0, median: 0, p95: 0, max: 0 };
  const view = values.subarray(0, count);
  view.sort();
  return {
    min: view[0] ?? 0,
    median: view[count >> 1] ?? 0,
    p95: view[Math.min(count - 1, Math.floor(PERCENTILE * (count - 1)))] ?? 0,
    max: view[count - 1] ?? 0,
  };
}

/** Milliseconds per frame as frames per second; 0 for an empty window. */
function rate(intervalMs: number): number {
  return intervalMs > 0 ? 1000 / intervalMs : 0;
}

/** The three the panel has room for: the middle, the bad, and the worst. */
function triple(value: Spread, digits: number): string {
  return (
    `${value.median.toFixed(digits)}/${value.p95.toFixed(digits)}/${value.max.toFixed(digits)}`
  );
}
