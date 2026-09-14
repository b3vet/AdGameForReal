/**
 * What the stress scene reports and how it measures it.
 *
 * Split out of `./stress.ts` for the file-size rule (CLAUDE.md), on the seam
 * between *building and driving* the worst-case frame and *what a window of it
 * costs*: the scene owns the crowd, the river and the physics script, and this
 * owns the sample window the smoke's tripwire is read off
 * (`scripts/smoke-stress.mjs`).
 */

export interface StressStats {
  drawCalls: number;
  /**
   * Median cost of the `scene.render` call, in milliseconds, over every frame
   * but the first.
   *
   * A median and not an average: the frame a ragdoll first appears on compiles
   * its shader and is worth hundreds of times a steady frame. With only a
   * handful of frames in the window — a software rasteriser gets three or four
   * into eight seconds — one such spike would own an average.
   */
  renderMs: number;
  /**
   * The worst frame of the run, which is usually one of those compiles. Over
   * every window, not the current one: a window that drew no frames used to
   * report the worst frame of the whole scene as 0.
   */
  renderMsMax: number;
  /**
   * The first frame, kept out of the median and reported on its own: it is the
   * crowd's shader compilation, which is hundreds of milliseconds and says
   * nothing about the cost of drawing a frame.
   */
  renderMsFirst: number;
  /** How many frames the median is taken over. Single digits under SwiftShader. */
  renderSamples: number;
  /**
   * The same median over *every* frame the scene has drawn, which no
   * `resetSamples` clears, and how many frames that is.
   *
   * A window's median is only a median if the window holds frames. Measured on
   * the box that runs the smoke today, an eight-second window holds one to
   * three: `scene.render` returns in single-digit milliseconds and the software
   * rasteriser then takes three to six *seconds* to finish the frame. So the
   * per-window numbers drift by a factor of three between windows of one and
   * two samples, and the tripwire that reads them is a coin flip. This is the
   * number with the evidence behind it, and `scripts/smoke-stress.mjs` fails on
   * the two together rather than on the windows alone.
   */
  renderMsRun: number;
  renderSamplesRun: number;
  /**
   * Rolling wall-clock gap between frames, in milliseconds. On a real GPU this
   * tracks `renderMs`; under SwiftShader it is several times larger, because
   * `scene.render` only queues the work and the rasteriser finishes it before
   * the next frame is scheduled. Both numbers are reported so a regression in
   * either is visible.
   */
  frameMs: number;
  fps: number;
  frames: number;
  mages: number;
  skeletons: number;
  /** Stream bodies on their feet in the measured frame. */
  streamBodies: number;
  ragdolls: number;
  shards: number;
  quality: number;
  /** Wall-clock seconds since the first frame. */
  seconds: number;
}

export interface StressHandle {
  ready: boolean;
  stats: () => StressStats;
  /**
   * Stops the frame loop and leaves the last frame on the canvas.
   *
   * A screenshot tool asks the compositor for a fresh frame and waits for it;
   * a scene that takes over a second per frame under SwiftShader starves that
   * request until the tool gives up, so the smoke pauses before it shoots.
   */
  pause: () => void;
  /**
   * Throws away the render costs collected so far, so the next `stats()` reads
   * a fresh window.
   *
   * The smoke samples three windows and fails only if two of them are over
   * budget *and* the run's own median is (`scripts/smoke-stress.mjs`): one busy
   * machine hiccup lands in one window, and a cumulative median would carry it
   * into the next two. `renderMsRun` is the one this does not clear.
   */
  resetSamples: () => void;
  dispose: () => void;
}

/** How many render costs the median is taken over, at most. */
const RENDER_SAMPLE_LIMIT = 64;

/**
 * One sampling window's worth of `scene.render` costs.
 *
 * The first frame is held apart rather than dropped: it is the scene's shader
 * compilation and it is worth knowing, it is just not worth averaging.
 */
export class RenderCosts {
  /** Post-first-frame costs, newest last. Bounded, so it never grows. */
  private readonly costs: number[] = [];
  /** The same, across every window: `reset` does not clear this one. */
  private readonly all: number[] = [];
  private first = 0;
  private seen = 0;

  push(ms: number): void {
    this.seen++;
    if (this.seen === 1) {
      this.first = ms;
      return;
    }
    push(this.costs, ms);
    push(this.all, ms);
  }

  /** A fresh window. The first frame stays: it happened once, at the start. */
  reset(): void {
    this.costs.length = 0;
  }

  get samples(): number {
    return this.costs.length;
  }

  get firstMs(): number {
    return this.first;
  }

  get maxMs(): number {
    return this.all.length === 0 ? 0 : Math.max(...this.all);
  }

  get medianMs(): number {
    return median(this.costs);
  }

  /** Over every frame since the scene started; see `StressStats.renderMsRun`. */
  get runMedianMs(): number {
    return median(this.all);
  }

  get runSamples(): number {
    return this.all.length;
  }
}

/** Newest last, oldest dropped: a sample list that never grows. */
function push(values: number[], ms: number): void {
  values.push(ms);
  if (values.length > RENDER_SAMPLE_LIMIT) values.shift();
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const low = sorted[middle - 1] ?? 0;
  const high = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? high : (low + high) / 2;
}
