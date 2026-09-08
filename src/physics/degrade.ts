/**
 * The degrade ladder's clock.
 *
 * One number matters: the mean of the last sixty frame times. Once that has sat
 * above the 20 ms budget for a full second, the layer drops a quality step. It
 * never climbs back — a device that stuttered once will stutter again, and a
 * ladder that hunts up and down is worse to play than one that gives up.
 *
 * Kept apart from `PhysicsLayer` because it is the one piece of that class with
 * no opinion about physics at all: it is a ring buffer and a threshold.
 */

import { DEGRADE_AFTER, FRAME_BUDGET, FRAME_WINDOW } from './tuning';

export class FrameBudget {
  private readonly frames = new Float32Array(FRAME_WINDOW);
  private at = 0;
  private sum = 0;
  private filled = 0;
  private over = 0;

  /** True when the caller should step quality down one level. */
  push(dt: number): boolean {
    this.sum -= this.frames[this.at] ?? 0;
    this.frames[this.at] = dt;
    this.sum += dt;
    this.at = (this.at + 1) % FRAME_WINDOW;

    // Nothing is judged until the window has a full second in it, so the load
    // of the first frames — shaders, textures, the Havok warm-up — is ignored.
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

  /** Mean frame time over the window, in seconds. For the debug overlay. */
  get average(): number {
    return this.filled === 0 ? 0 : this.sum / this.filled;
  }
}
