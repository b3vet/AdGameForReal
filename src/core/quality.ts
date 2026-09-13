/**
 * The degrade ladder, and the frame-time monitor that walks it.
 *
 * One ladder for the whole app: pixel ratio 3 → 2 → 1.5 → 1, then the ragdolls
 * 8 → 4 → 0. It lives here rather than in `src/physics` because the first
 * four steps are the renderer's and only the app can see all of them; the
 * physics layer keeps `setQuality` and no opinion about when it is called.
 *
 * Milestone 3 dropped the glow rung entirely (plan, performance step 4): the
 * pass is gone from the renderer, the bolts and impacts carry their own
 * brightness, and a rung is now a pixel ratio and a physics quality.
 *
 * ## What the monitor judges, and why it changed
 *
 * Milestone 2 judged the *mean* of the last sixty frames and stepped after one
 * second over budget. The iPhone 17 Pro Max baseline
 * (docs/10-milestone-3-log.md) is what that costs: a median of 59 fps with
 * minimums of 23, and a ladder that had walked to pixel ratio 1.0 on a 3×
 * screen by level 8. A mean is dragged over the line by a handful of hitches,
 * and the ladder never climbs back, so a session gets blurrier the longer it
 * runs while the device was never actually short of time.
 *
 * So: the 95th percentile of a three-second window, which a burst of spikes
 * cannot move but a device that is genuinely late every frame can; two
 * consecutive windows before a step, so one bad window is not a decision; the
 * first two seconds after a level start ignored, because that is level
 * generation, pool hand-out and the first frames of a crowd; and a reset to
 * rung 0 at every level start, because a level is a fresh measurement and the
 * last one's verdict should not be inherited.
 *
 * It still never climbs *within* a level. A ladder that hunts up and down
 * mid-run is worse to play than one that settles: every rung is a decision the
 * player only notices once.
 *
 * `?quality=n` pins a rung, for testing a phone's worst case on a desktop; a
 * pinned ladder never steps on its own.
 */

import type { PhysicsQuality } from '@/physics';

/**
 * What a rung asks of the two layers. `physics` is the quality the physics
 * layer is set to, which is what decides how many ragdolls a kill spawns.
 */
export interface QualityRung {
  readonly pixelRatio: number;
  readonly physics: PhysicsQuality;
}

/**
 * The ladder itself, best first. Index into this is the "rung" everywhere.
 *
 * Rung 0 is the screen's own pixel ratio, up to 3 (D38). Milestone 3 capped it
 * at 2 on the theory that the extra pixels buy nothing; the product owner's
 * verdict on that build was "resolution very low", and they are right — a 3×
 * phone rendering at 2 is 44 percent of the pixels the screen has, and the gate
 * numbers and the road's rune lines are exactly the thin high-contrast edges
 * that shows on. So the top of the ladder is native, and the ladder is what
 * decides whether the device can hold it.
 *
 * That is the whole guard, and it is deliberate: there is no device list and no
 * "3× only above N cores" rule, because both would be wrong on a phone nobody
 * on this team owns. A device that cannot hold native renders two windows —
 * six seconds — at 3 and then steps to 2, which is where Milestone 3 started.
 * Every step is one stop of resolution, never two: dropping straight from 3 to
 * 1.5 is what made the Milestone 2 build look soft, and the p95 rule steps
 * again in another six seconds if one stop was not enough.
 *
 * The tail is the ragdolls: physics 2 spawns eight per kill, 1 spawns four and
 * 0 none at all (`RAGDOLL_LIVE_CAP` in `src/physics`), so the last two rungs
 * buy frames by drawing fewer bodies once there is no resolution left to give.
 */
export const QUALITY_RUNGS: readonly QualityRung[] = [
  { pixelRatio: 3, physics: 2 },
  { pixelRatio: 2, physics: 2 },
  { pixelRatio: 1.5, physics: 2 },
  { pixelRatio: 1, physics: 2 },
  { pixelRatio: 1, physics: 1 },
  { pixelRatio: 1, physics: 0 },
];

export const MAX_QUALITY_RUNG = QUALITY_RUNGS.length - 1;

/**
 * Frame-time budget, in seconds: the p95 a window has to beat.
 *
 * 20 ms is 50 fps, the floor the milestone's re-measurement target names for
 * level 8. A 60 fps device that misses a vsync here and there sits at 16.7 ms
 * at p95 and is left alone; one that is genuinely drawing 40 fps is at 25 and
 * is not.
 */
const FRAME_BUDGET = 0.02;
/** Seconds of frames each verdict is taken over. */
const WINDOW_SECONDS = 3;
/** Consecutive over-budget windows before the ladder steps. */
const WINDOWS_TO_STEP = 2;
/**
 * Seconds after a level start that are not measured at all: the generator, the
 * pools being handed out, the first crowd upload and whatever the browser was
 * doing while the level screen was up.
 */
const SETTLE_SECONDS = 2;
/**
 * Frames one window can hold. Three seconds at 170 fps, so a ProMotion phone
 * never overflows it; a longer window simply stops sampling, which biases
 * nothing because the samples it kept are the window's first three seconds.
 */
const WINDOW_SAMPLES = 512;
/** Where in the sorted window the verdict is read. */
const PERCENTILE = 0.95;

export interface QualityLadderOptions {
  /** Pin a rung and stop the monitor. `?quality=`; null means automatic. */
  forced?: number | null;
  /** Applied on construction and on every step. */
  apply: (rung: QualityRung, index: number) => void;
  /**
   * What the screen offers, for the rung line's effective ratio. Defaults to
   * the window's; passed explicitly by the tests, which have no window worth
   * asking.
   */
  deviceRatio?: number;
}

/** The screen's pixel ratio, or 1 where there is no window to ask. */
function readDeviceRatio(): number {
  if (typeof window === 'undefined') return 1;
  const ratio = window.devicePixelRatio;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

export class QualityLadder {
  private readonly apply: (rung: QualityRung, index: number) => void;
  private readonly forced: boolean;
  private readonly deviceRatio: number;

  private index = 0;

  /** The window being filled, and a scratch copy `p95` sorts in place. */
  private readonly samples = new Float32Array(WINDOW_SAMPLES);
  private readonly sorted = new Float32Array(WINDOW_SAMPLES);
  private count = 0;
  /** Seconds of frames in the window so far. */
  private elapsed = 0;
  /** Seconds since the level started; nothing is judged below `SETTLE_SECONDS`. */
  private sinceLevel = 0;
  /** Consecutive windows whose p95 was over budget. */
  private overWindows = 0;

  /** The last completed window's p95, in seconds. 0 before the first one. */
  private lastP95 = 0;
  /** Verdicts taken since the level started; the tests step window by window. */
  private windowCount = 0;
  /** Why the ladder last moved, for the debug panel. */
  private lastReason = 'start';

  constructor(options: QualityLadderOptions) {
    this.apply = options.apply;
    this.deviceRatio = options.deviceRatio ?? readDeviceRatio();
    const forced = options.forced ?? null;
    this.forced = forced !== null;
    if (forced !== null) {
      this.index = clampRung(forced);
      this.lastReason = 'pinned';
    }
    this.applyCurrent();
  }

  /** Which rung the app is on. 0 is everything on. */
  get rung(): number {
    return this.index;
  }

  get current(): QualityRung {
    // The index is clamped on every write, so this is never undefined; the
    // fallback is here because `noUncheckedIndexedAccess` cannot know that.
    return QUALITY_RUNGS[this.index] ?? { pixelRatio: 1, physics: 0 };
  }

  /** True while the rung came from `?quality=` rather than from the clock. */
  get isPinned(): boolean {
    return this.forced;
  }

  /** The last completed window's 95th percentile frame time, in milliseconds. */
  get p95Ms(): number {
    return this.lastP95 * 1000;
  }

  /** How many windows have been judged since the level started. */
  get windows(): number {
    return this.windowCount;
  }

  /**
   * Why the rung is where it is and what it renders at: `start 3x`, `p95 2x`.
   *
   * The ratio rides on the reason because it is what a rung *means* and the
   * debug panel's rung line is where the two belong together (`src/ui/debug.ts`
   * prints `rung 1 p95 2x  p95 24.1ms`). It is the effective ratio, not the
   * rung's — a rung of 3 on a 2× screen renders at 2 — which is the number a
   * capture from the product owner's phone has to be read against.
   */
  get reason(): string {
    return `${this.lastReason} ${formatRatio(this.effectiveRatio)}x`;
  }

  /** What the scene actually renders at on this screen: the rung under the device. */
  get effectiveRatio(): number {
    return Math.min(this.deviceRatio, this.current.pixelRatio);
  }

  /**
   * A level is starting: back to rung 0 and a fresh measurement.
   *
   * Not a climb — it is the *end* of the measurement the last level made. The
   * device's verdict from a 300-unit level 8 has nothing to say about level 1,
   * and inheriting it is what left the Milestone 2 build rendering every later
   * session at pixel ratio 1.
   */
  beginLevel(): void {
    this.resetWindow();
    this.sinceLevel = 0;
    this.overWindows = 0;
    this.lastP95 = 0;
    this.windowCount = 0;
    if (this.forced || this.index === 0) return;
    this.index = 0;
    this.lastReason = 'level';
    this.applyCurrent();
  }

  /**
   * One frame of wall-clock time. Returns true on the frame it steps down.
   * `dt` is real seconds — never the app's scaled time, or hit-stop would read
   * as a slow device.
   */
  track(dt: number): boolean {
    if (this.forced || this.index >= MAX_QUALITY_RUNG) return false;

    this.sinceLevel += dt;
    if (this.sinceLevel < SETTLE_SECONDS) return false;

    if (this.count < WINDOW_SAMPLES) this.samples[this.count++] = dt;
    this.elapsed += dt;
    if (this.elapsed < WINDOW_SECONDS) return false;

    const p95 = this.percentile();
    this.lastP95 = p95;
    this.windowCount++;
    this.resetWindow();

    if (p95 <= FRAME_BUDGET) {
      this.overWindows = 0;
      return false;
    }
    this.overWindows++;
    if (this.overWindows < WINDOWS_TO_STEP) return false;

    this.overWindows = 0;
    this.index++;
    this.lastReason = 'p95';
    this.applyCurrent();
    return true;
  }

  /** Re-applies the current rung; for a layer that arrived after the ladder. */
  applyCurrent(): void {
    this.apply(this.current, this.index);
  }

  /** The window's 95th percentile, in seconds. 0 for an empty window. */
  private percentile(): number {
    const count = this.count;
    if (count === 0) return 0;
    this.sorted.set(this.samples);
    // Everything past the live samples sorts to the end rather than to the
    // front, where a run of zeros would drag the percentile down.
    this.sorted.fill(Number.POSITIVE_INFINITY, count);
    this.sorted.sort();
    const at = Math.min(count - 1, Math.floor(PERCENTILE * (count - 1)));
    return this.sorted[at] ?? 0;
  }

  private resetWindow(): void {
    this.count = 0;
    this.elapsed = 0;
  }
}

/** `3`, `1.5` — a ratio with no trailing zero, because the panel is 390 px wide. */
function formatRatio(ratio: number): string {
  return Number.isInteger(ratio) ? ratio.toFixed(0) : ratio.toFixed(1);
}

export function clampRung(rung: number): number {
  if (!Number.isFinite(rung)) return 0;
  return Math.min(MAX_QUALITY_RUNG, Math.max(0, Math.floor(rung)));
}
