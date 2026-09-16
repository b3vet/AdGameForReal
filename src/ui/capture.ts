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
 * layout (`src/core/report.ts`), and the panel's block is composed from the
 * same value (`./captureText.ts`).
 *
 * After the second device playtest (docs/28, note 5) it says where a phone's
 * frame goes as well as how long it took: the frame's JavaScript in its four
 * phases (sim, the views, `scene.render`, physics), the triangles and draw
 * calls the GPU was handed, how much of the crowd was drawn from its
 * low-polygon copy, and the display's own refresh rate — which on a ProMotion
 * phone says whether the loop is skipping every other refresh
 * (`src/core/framePacer.ts`). Every phase is quoted as a mean as well as a
 * median: Safari's clock is coarse, and a mean of whole milliseconds over a
 * thousand frames is still a good number where a median of them is not.
 *
 * Samples land in typed arrays allocated once and re-used by every later
 * capture, so a recording frame costs a dozen stores and no allocation
 * (CLAUDE.md: nothing allocates per frame).
 */

import type { RunState } from '@/sim';

import { composeCapture } from './captureText';
import type { DebugStats } from './debugStats';
import { SPIKE_MS } from './spikeWindow';

export { SPIKE_MS } from './spikeWindow';

export const CAPTURE_SECONDS = 10;

/**
 * The longest window anything asks for: `?perf`'s scripted run (`src/core/
 * perf.ts`), which covers the road and the boss of level 20. It is here
 * because it is what sizes the sample buffers.
 */
export const MAX_CAPTURE_SECONDS = 45;

/** Where in a sorted window the "worst realistic frame" is read. */
const PERCENTILE = 0.95;

/**
 * Sample slots: the longest window at 180 frames a second, which no phone will
 * reach — the loop draws at most sixty (`src/core/framePacer.ts`). A capture
 * that somehow overruns it stops sampling rather than growing the buffer.
 */
const CAPACITY = 8192;

/** One column per number sampled every drawn frame. */
type Column =
  | 'sim'
  | 'render'
  | 'physics'
  | 'views'
  | 'draw'
  | 'js'
  | 'draws'
  | 'triangles'
  | 'crowdWhole'
  | 'crowdSmall'
  | 'crowdCulled';

interface Buffers {
  /** Wall-clock milliseconds between drawn frames; the frame rate comes off it. */
  frame: Float32Array;
  columns: Record<Column, Float32Array>;
}

/** Mean, min, median, 95th percentile and max of one column of samples. */
export interface Spread {
  mean: number;
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
  /** Drawn frames per second over the window: the number the target is set in. */
  fpsAverage: number;
  /** The frame rate it felt like: the median interval, as fps. */
  fpsMedian: number;
  /**
   * The frame rate at the slow end: the 95th-percentile *interval*, as fps.
   * Reading it off the intervals rather than off a second array of frame rates
   * is exact — fps is a monotonic function of the interval, so the 95th
   * percentile of one is the 5th percentile of the other.
   */
  fpsP95: number;
  /**
   * `requestAnimationFrame` callbacks per second over the window, drawn or
   * not: the display's refresh rate as the page sees it. 0 when the frame loop
   * did not report its count.
   */
  rafHz: number;
  /** Frames over `SPIKE_MS` in the window; the milestone's hitch counter. */
  over20: number;
  drawPeak: number;
  rungPeak: number;
  pixelRatio: number;
  /** The lowest ratio the window was drawn at: a ladder step shows here. */
  pixelRatioMin: number;
  devicePixelRatio: number;
  sim: Spread;
  /** `views` and `draw` together; kept for comparison with older captures. */
  render: Spread;
  physics: Spread;
  /** The views writing the frame: `render` without `scene.render`. */
  views: Spread;
  /** `scene.render` alone. */
  draw: Spread;
  /** The whole frame callback, before the panel's own work. */
  js: Spread;
  draws: Spread;
  triangles: Spread;
  /** Crowd units drawn whole, from the copy, and culled: medians. */
  crowd: { whole: number; small: number; culled: number };
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
  private pixelRatioMin = 0;
  private devicePixelRatio = 1;
  private level = 0;
  private squadMin = 0;
  private squadMax = 0;
  private sawRun = false;
  private over20 = 0;
  /** The loop's callback count at the first and last sample, for `rafHz`. */
  private firstCallbacks = -1;
  private lastCallbacks = 0;
  private firstCallbackAt = 0;
  private lastCallbackAt = 0;

  get active(): boolean {
    return this.recording;
  }

  /** `seconds` is clamped to what the buffers hold; see `CAPACITY`. */
  start(nowMs: number, seconds: number = CAPTURE_SECONDS): void {
    this.buffers ??= allocate();
    this.wanted = Math.min(MAX_CAPTURE_SECONDS, Math.max(1, seconds));
    this.recording = true;
    this.samples = 0;
    this.frameSamples = 0;
    this.startedAt = nowMs;
    this.lastSampleAt = 0;
    this.drawCallsPeak = 0;
    this.rungPeak = 0;
    this.pixelRatio = 0;
    this.pixelRatioMin = 0;
    this.devicePixelRatio = 1;
    this.level = 0;
    this.squadMin = 0;
    this.squadMax = 0;
    this.sawRun = false;
    this.over20 = 0;
    this.firstCallbacks = -1;
    this.lastCallbacks = 0;
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
      const columns = buffers.columns;
      columns.sim[i] = stats.simMs;
      columns.render[i] = stats.renderMs;
      columns.physics[i] = stats.physicsMs;
      columns.views[i] = stats.viewsMs;
      columns.draw[i] = stats.drawMs;
      columns.js[i] = stats.frameMs;
      columns.draws[i] = stats.drawCalls;
      columns.triangles[i] = stats.triangles;
      columns.crowdWhole[i] = stats.crowdWhole;
      columns.crowdSmall[i] = stats.crowdSmall;
      columns.crowdCulled[i] = stats.crowdCulled;

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

      if (stats.rafCallbacks > 0) {
        if (this.firstCallbacks < 0) {
          this.firstCallbacks = stats.rafCallbacks;
          this.firstCallbackAt = nowMs;
        }
        this.lastCallbacks = stats.rafCallbacks;
        this.lastCallbackAt = nowMs;
      }
    }

    if (stats.drawCalls > this.drawCallsPeak) this.drawCallsPeak = stats.drawCalls;
    if (stats.qualityRung > this.rungPeak) this.rungPeak = stats.qualityRung;
    this.pixelRatio = stats.pixelRatio;
    if (this.pixelRatioMin === 0 || stats.pixelRatio < this.pixelRatioMin) {
      this.pixelRatioMin = stats.pixelRatio;
    }
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
    const column = (name: Column): Spread =>
      buffers === null ? EMPTY : spread(buffers.columns[name], count);
    const frameMs = buffers === null ? EMPTY : spread(buffers.frame, this.frameSamples);
    const callbackSeconds = (this.lastCallbackAt - this.firstCallbackAt) / 1000;
    const summary: CaptureSummary = {
      seconds: elapsed,
      frames: count,
      frameMs,
      fpsAverage: elapsed > 0 ? count / elapsed : 0,
      fpsMedian: rate(frameMs.median),
      fpsP95: rate(frameMs.p95),
      rafHz:
        this.firstCallbacks >= 0 && callbackSeconds > 0
          ? (this.lastCallbacks - this.firstCallbacks) / callbackSeconds
          : 0,
      over20: this.over20,
      drawPeak: this.drawCallsPeak,
      rungPeak: this.rungPeak,
      pixelRatio: this.pixelRatio,
      pixelRatioMin: this.pixelRatioMin,
      devicePixelRatio: this.devicePixelRatio,
      sim: column('sim'),
      render: column('render'),
      physics: column('physics'),
      views: column('views'),
      draw: column('draw'),
      js: column('js'),
      draws: column('draws'),
      triangles: column('triangles'),
      crowd: {
        whole: column('crowdWhole').median,
        small: column('crowdSmall').median,
        culled: column('crowdCulled').median,
      },
      run: this.sawRun
        ? { level: this.level, squadMin: this.squadMin, squadMax: this.squadMax }
        : null,
      text: '',
    };
    summary.text = composeCapture(summary, count > 0);
    return summary;
  }
}

const EMPTY: Spread = { mean: 0, min: 0, median: 0, p95: 0, max: 0 };

function allocate(): Buffers {
  const column = (): Float32Array => new Float32Array(CAPACITY);
  return {
    frame: column(),
    columns: {
      sim: column(),
      render: column(),
      physics: column(),
      views: column(),
      draw: column(),
      js: column(),
      draws: column(),
      triangles: column(),
      crowdWhole: column(),
      crowdSmall: column(),
      crowdCulled: column(),
    },
  };
}

/**
 * Sorts the filled prefix in place — the samples are not needed again once a
 * capture is being summarised, and `subarray` is a view, so this costs no copy.
 */
function spread(values: Float32Array, count: number): Spread {
  if (count <= 0) return EMPTY;
  const view = values.subarray(0, count);
  let sum = 0;
  for (let i = 0; i < count; i++) sum += view[i] ?? 0;
  view.sort();
  return {
    mean: sum / count,
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
