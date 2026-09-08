/**
 * The app-level time scale: hit-stop, slow-mo and the defeat crawl.
 *
 * `App` multiplies the frame's real delta by `value` before it hands it to the
 * sim and to the renderer, so every one of these effects is a change to how
 * fast the *whole game* runs, not an animation somebody has to write. The sim
 * stays deterministic for a given sequence of deltas (docs/06-milestone-2-plan.md,
 * juice checklist), the bots keep steering, and `?turbo` multiplies whatever
 * comes out of here.
 *
 * Physics never sees this: debris runs on real time or a hit-stop would fling
 * it (see `PhysicsLayer.update`).
 *
 * Every number here is tuning, so it lives in `balance.json`'s `ui` block
 * (CLAUDE.md); these are the named reads of it.
 */

import { balance } from '@/data';

/** How long the game freezes when a block dies. */
export const HIT_STOP_SECONDS = balance.ui.hitStopSeconds;

/** Minimum gap between two hit-stops, so a wiped row is one hitch and not ten. */
export const HIT_STOP_COOLDOWN = balance.ui.hitStopCooldown;

/** Boss kill: the plan's 0.3x for 0.6 s. */
export const BOSS_KILL_SCALE = balance.ui.bossKillScale;
export const BOSS_KILL_SECONDS = balance.ui.bossKillSeconds;

/** Defeat: held until the result screen replaces the run. */
export const DEFEAT_SCALE = balance.ui.defeatScale;

export class TimeScale {
  private stopFor = 0;
  private sinceStop = HIT_STOP_COOLDOWN;
  private slowFor = 0;
  private slowScale = 1;
  private hold = 1;

  /** What this frame's real delta must be multiplied by. */
  get value(): number {
    if (this.stopFor > 0) return 0;
    const transient = this.slowFor > 0 ? this.slowScale : 1;
    return Math.min(transient, this.hold);
  }

  /** True while anything but normal speed is in effect. For the debug panel. */
  get active(): boolean {
    return this.value !== 1;
  }

  /**
   * Ages every timer by one frame of *real* time. Called once per frame before
   * `value` is read, so an effect started by this frame's events begins on the
   * next one and a 40 ms stop lasts 40 ms of wall clock at any frame rate.
   */
  advance(frameDt: number): void {
    this.sinceStop += frameDt;
    if (this.stopFor > 0) this.stopFor = Math.max(0, this.stopFor - frameDt);
    if (this.slowFor > 0) this.slowFor = Math.max(0, this.slowFor - frameDt);
  }

  /** Freezes the game briefly. Returns false when the throttle swallowed it. */
  hitStop(seconds = HIT_STOP_SECONDS): boolean {
    if (this.sinceStop < HIT_STOP_COOLDOWN) return false;
    this.sinceStop = 0;
    this.stopFor = seconds;
    return true;
  }

  /** Slow motion for a fixed span. A longer or slower request wins. */
  slowMo(scale: number, seconds: number): void {
    if (this.slowFor > 0) {
      this.slowScale = Math.min(this.slowScale, scale);
      this.slowFor = Math.max(this.slowFor, seconds);
      return;
    }
    this.slowScale = scale;
    this.slowFor = seconds;
  }

  /** A scale that stays until it is cleared with `hold(1)` — the defeat crawl. */
  setHold(scale: number): void {
    this.hold = scale;
  }

  /** Back to normal speed, with every timer cleared. */
  reset(): void {
    this.stopFor = 0;
    this.sinceStop = HIT_STOP_COOLDOWN;
    this.slowFor = 0;
    this.slowScale = 1;
    this.hold = 1;
  }
}
