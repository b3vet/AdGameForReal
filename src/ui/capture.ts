/**
 * The ten-second readout behind the debug panel's "Capture" button.
 *
 * Ten seconds of per-frame numbers reduced to min / median / max — short enough
 * to paste into a chat message, which is the whole point: the product owner
 * plays a hosted link on a phone and needs one block of text that says whether
 * it ran (docs/09-milestone-3-plan.md, "Performance plan" item 6).
 *
 * Samples land in typed arrays allocated once and re-used by every later
 * capture, so a recording frame costs four stores and no allocation (CLAUDE.md:
 * nothing allocates per frame).
 */

import type { RunState } from '@/sim';

import type { DebugStats } from './debug';

export const CAPTURE_SECONDS = 10;

/**
 * A frame longer than this is a hitch (Milestone 4, "Polish"). Sixty frames a
 * second is 16.7 ms, so 20 ms is the first frame the eye can see stumble; the
 * product owner's capture is meant to report under three of them.
 */
export const SPIKE_MS = 20;

/** How far back the panel's live spike count looks. */
export const SPIKE_WINDOW_SECONDS = 10;

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
 * The capture answers the same question for its own ten seconds; this one is
 * for the panel, which is up the whole time the product owner is playing. One
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
 * Sample slots: ten seconds at 240 fps, which no phone will reach. A capture
 * that somehow overruns it stops sampling rather than growing the buffer.
 */
const CAPACITY = 2600;

interface Buffers {
  fps: Float32Array;
  sim: Float32Array;
  render: Float32Array;
  physics: Float32Array;
}

export class CaptureRecorder {
  private buffers: Buffers | null = null;
  private recording = false;
  private samples = 0;
  /** One behind `samples`: a frame rate needs the frame before it. */
  private fpsSamples = 0;
  private startedAt = 0;
  private lastSampleAt = 0;

  private drawCallsPeak = 0;
  private rungPeak = 0;
  private pixelRatio = 0;
  private devicePixelRatio = 1;
  private level = 0;
  private squadMin = 0;
  private squadMax = 0;
  private sawRun = false;
  /** Frames over `SPIKE_MS` in this capture; the milestone's hitch counter. */
  private over20 = 0;

  get active(): boolean {
    return this.recording;
  }

  start(nowMs: number): void {
    this.buffers ??= {
      fps: new Float32Array(CAPACITY),
      sim: new Float32Array(CAPACITY),
      render: new Float32Array(CAPACITY),
      physics: new Float32Array(CAPACITY),
    };
    this.recording = true;
    this.samples = 0;
    this.fpsSamples = 0;
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
    const left = CAPTURE_SECONDS - (nowMs - this.startedAt) / 1000;
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
  ): string | null {
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
        buffers.fps[this.fpsSamples++] = 1000 / since;
        // The same wall-clock gap the frame rate is computed from: a hitch is
        // a frame that took too long, not a frame the loop clamped.
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
    if (elapsed < CAPTURE_SECONDS) return null;

    this.recording = false;
    return this.summarise(elapsed);
  }

  /**
   * Seven short lines: nothing here may be wider than the panel is at 390 px,
   * because a readout that needs a horizontal scroll is not a readout.
   */
  private summarise(elapsed: number): string {
    const buffers = this.buffers;
    const count = this.samples;
    const header = `arcane-rush ${elapsed.toFixed(1)}s / ${String(count)} frames`;
    if (buffers === null || count === 0) return `${header}\nno frames drawn`;

    const fps = spread(buffers.fps, this.fpsSamples);
    const sim = spread(buffers.sim, count);
    const render = spread(buffers.render, count);
    const physics = spread(buffers.physics, count);
    const run = this.sawRun
      ? `lvl ${String(this.level)} squad ${String(this.squadMin)}-${String(this.squadMax)}`
      : 'no run';

    return [
      header,
      `fps ${triple(fps, 0)}  over20 ${String(this.over20)}`,
      `sim ${triple(sim, 2)} ms`,
      `rnd ${triple(render, 2)} ms`,
      `phy ${triple(physics, 2)} ms`,
      `draws peak ${String(this.drawCallsPeak)} rung ${String(this.rungPeak)} ` +
        `px ${this.pixelRatio.toFixed(2)}/${this.devicePixelRatio.toFixed(2)}`,
      `${run} (min/med/max)`,
    ].join('\n');
  }
}

interface Spread {
  min: number;
  median: number;
  max: number;
}

/**
 * Sorts the filled prefix in place — the samples are not needed again once a
 * capture is being summarised, and `subarray` is a view, so this costs no copy.
 */
function spread(values: Float32Array, count: number): Spread {
  const view = values.subarray(0, count);
  view.sort();
  return {
    min: view[0] ?? 0,
    median: view[count >> 1] ?? 0,
    max: view[count - 1] ?? 0,
  };
}

function triple(value: Spread, digits: number): string {
  return (
    `${value.min.toFixed(digits)}/${value.median.toFixed(digits)}/${value.max.toFixed(digits)}`
  );
}
