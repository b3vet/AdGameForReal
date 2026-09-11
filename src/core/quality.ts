/**
 * The degrade ladder, and the frame-time monitor that walks it.
 *
 * One ladder for the whole app: pixel ratio 2 → 1.5 → 1, then the ragdolls
 * 8 → 4 → 0. It lives here rather than in `src/physics` because the first
 * three steps are the renderer's and only the app can see all of them; the
 * physics layer keeps `setQuality` and no opinion about when it is called.
 *
 * Milestone 3 dropped the glow rung: the pass is off on every rung now
 * (plan, performance step 4), so `rung.glow` is the flag that says so rather
 * than a step the ladder can take. The renderer does not even build the layer
 * unless something sets it, and the bolts and impacts carry their own
 * brightness instead.
 *
 * It never climbs. A device that spent a second over budget will spend another
 * one, and a ladder that hunts up and down is worse to play than one that gives
 * up: every rung is a decision the player only notices once.
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
  /**
   * Whether the glow pass runs. False on every rung as of Milestone 3; kept on
   * the rung rather than deleted because it is still the renderer's switch and
   * a future rung may want to offer it back on a desktop.
   */
  readonly glow: boolean;
  readonly physics: PhysicsQuality;
}

/** The ladder itself, best first. Index into this is the "rung" everywhere. */
export const QUALITY_RUNGS: readonly QualityRung[] = [
  { pixelRatio: 2, glow: false, physics: 2 },
  { pixelRatio: 1.5, glow: false, physics: 2 },
  { pixelRatio: 1, glow: false, physics: 2 },
  { pixelRatio: 1, glow: false, physics: 1 },
  { pixelRatio: 1, glow: false, physics: 0 },
];

export const MAX_QUALITY_RUNG = QUALITY_RUNGS.length - 1;

/**
 * Frame-time budget. The mean of the last second of frames has to stay above
 * `FRAME_BUDGET` for `DEGRADE_AFTER` seconds before the ladder takes a step —
 * one bad frame is a garbage collection, a bad second is a device that cannot
 * keep up.
 */
const FRAME_WINDOW = 60;
const FRAME_BUDGET = 0.02;
const DEGRADE_AFTER = 1;

export interface QualityLadderOptions {
  /** Pin a rung and stop the monitor. `?quality=`; null means automatic. */
  forced?: number | null;
  /** Applied on construction and on every step. */
  apply: (rung: QualityRung, index: number) => void;
}

export class QualityLadder {
  private readonly apply: (rung: QualityRung, index: number) => void;
  private readonly forced: boolean;

  private index = 0;

  /** Ring buffer of the last `FRAME_WINDOW` frame times, and its running sum. */
  private readonly frames = new Float32Array(FRAME_WINDOW);
  private at = 0;
  private filled = 0;
  private sum = 0;
  private over = 0;

  constructor(options: QualityLadderOptions) {
    this.apply = options.apply;
    const forced = options.forced ?? null;
    this.forced = forced !== null;
    if (forced !== null) this.index = clampRung(forced);
    this.applyCurrent();
  }

  /** Which rung the app is on. 0 is everything on. */
  get rung(): number {
    return this.index;
  }

  get current(): QualityRung {
    // The index is clamped on every write, so this is never undefined; the
    // fallback is here because `noUncheckedIndexedAccess` cannot know that.
    return QUALITY_RUNGS[this.index] ?? { pixelRatio: 1, glow: false, physics: 0 };
  }

  /** True while the rung came from `?quality=` rather than from the clock. */
  get isPinned(): boolean {
    return this.forced;
  }

  /**
   * One frame of wall-clock time. Returns true on the frame it steps down.
   * `dt` is real seconds — never the app's scaled time, or hit-stop would read
   * as a slow device.
   */
  track(dt: number): boolean {
    if (this.forced || this.index >= MAX_QUALITY_RUNG) return false;
    if (!this.overBudget(dt)) return false;
    this.index++;
    this.applyCurrent();
    return true;
  }

  /** Re-applies the current rung; for a layer that arrived after the ladder. */
  applyCurrent(): void {
    this.apply(this.current, this.index);
  }

  /** The ring buffer, and whether it has been over budget for long enough. */
  private overBudget(dt: number): boolean {
    this.sum -= this.frames[this.at] ?? 0;
    this.frames[this.at] = dt;
    this.sum += dt;
    this.at = (this.at + 1) % FRAME_WINDOW;

    // Nothing is judged until the window holds a full second, so the cost of
    // the first frames — shaders, textures, the Havok warm-up — is ignored.
    if (this.filled < FRAME_WINDOW) {
      this.filled++;
      return false;
    }
    if (this.sum / FRAME_WINDOW <= FRAME_BUDGET) {
      this.over = 0;
      return false;
    }
    this.over += dt;
    if (this.over < DEGRADE_AFTER) return false;
    this.over = 0;
    return true;
  }
}

export function clampRung(rung: number): number {
  if (!Number.isFinite(rung)) return 0;
  return Math.min(MAX_QUALITY_RUNG, Math.max(0, Math.floor(rung)));
}
