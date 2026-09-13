/**
 * What a unit is doing on top of walking: the lean it carries, the stumble a
 * shove left it with, the shoulder it has against a fence, the pop it came in
 * with, and the break in its stride.
 *
 * One `Float32Array` per quantity, all at the crowd's capacity, all written in
 * place. The view's draw loop reads them straight rather than through a getter
 * — this runs five hundred times a frame — so the fields are public and the
 * methods here are only the ones that *set* them, which fire on a flag's edge
 * and therefore a handful of times a frame at most.
 *
 * The two reaction timers count *down*, which is what lets the sim re-arm one
 * every step it is still true without the pose flickering: a unit leaning on a
 * fence for two seconds holds its shoulder there, and the moment the fence lets
 * go the pose runs out on its own.
 *
 * Split out of `./squad.ts` for the file-size rule (CLAUDE.md), on the same
 * seam the corpse ring was: that file decides what a unit looks like this
 * frame, this one remembers what happened to it.
 */

import {
  BUMP_DURATION,
  POP_DURATION,
  STUMBLE_CLIP_KICK,
  STUMBLE_DURATION,
  UNIT_LEAN_MAX,
  UNIT_LEAN_PER_SPEED,
  UNIT_LEAN_SMOOTHING,
} from './crowdLook';

/** Sentinel in `pop`: this unit has finished popping in and needs no scale. */
const SETTLED = -1;

export class AgentLook {
  /** Yaw a unit carries from sliding sideways, smoothed. */
  readonly lean: Float32Array;
  /** Seconds of stumble left, 0 when there is none; the side it twists to. */
  readonly stumble: Float32Array;
  readonly stumbleSide: Float32Array;
  /** Seconds of shoulder bump left, and which side the fence is on. */
  readonly bump: Float32Array;
  readonly bumpSide: Float32Array;
  /** Seconds since this unit popped in, or `SETTLED`. */
  readonly pop: Float32Array;
  /** Seconds added to this unit's clip phase, so a shove breaks its stride. */
  readonly clipKick: Float32Array;

  /** Share of the lean's gap this frame closes; one `exp` a frame, not 500. */
  private ease = 1;

  constructor(capacity: number) {
    const size = Math.max(0, Math.floor(capacity));
    this.lean = new Float32Array(size);
    this.stumble = new Float32Array(size);
    this.stumbleSide = new Float32Array(size);
    this.bump = new Float32Array(size);
    this.bumpSide = new Float32Array(size);
    this.pop = new Float32Array(size).fill(SETTLED);
    this.clipKick = new Float32Array(size);
  }

  /** A new level: nobody is mid-anything. */
  clear(): void {
    this.lean.fill(0);
    this.stumble.fill(0);
    this.bump.fill(0);
    this.pop.fill(SETTLED);
    this.clipKick.fill(0);
  }

  /** Once a frame, before the units are walked. */
  beginFrame(dt: number): void {
    this.ease = dt <= 0 ? 1 : 1 - Math.exp(-dt / UNIT_LEAN_SMOOTHING);
  }

  /** A unit took this index: no history, no lean, and a pop on the way in. */
  spawn(index: number): void {
    this.lean[index] = 0;
    this.stumble[index] = 0;
    this.bump[index] = 0;
    this.pop[index] = 0;
    this.clipKick[index] = 0;
  }

  /**
   * A body shoved this unit (`CROWD_SHOVED`). Restarted rather than extended,
   * so a unit held inside a block's footprint keeps catching its footing
   * instead of crouching there for a second; the stride is kicked with it.
   */
  shove(index: number, side: number): void {
    this.stumble[index] = STUMBLE_DURATION;
    this.stumbleSide[index] = side < 0 ? -1 : 1;
    // Wrapped inside the clip's own spread, so the kick is a different phase
    // and not a growing offset on a unit shoved every step for a second.
    this.clipKick[index] = ((this.clipKick[index] ?? 0) + STUMBLE_CLIP_KICK) % 1;
  }

  /** The fence is holding this unit (`CROWD_ON_FENCE`), on `side`. */
  press(index: number, side: number): void {
    this.bump[index] = BUMP_DURATION;
    this.bumpSide[index] = side < 0 ? -1 : 1;
  }

  /**
   * Ages one unit's timers and answers its lean for this frame.
   *
   * Called once per live unit per frame, which is the only reason the timers
   * are aged here rather than in a pass of their own: a second walk of five
   * hundred entries to subtract `dt` from three floats is a second cache sweep
   * for nothing.
   */
  advance(index: number, lateralSpeed: number, dt: number): number {
    const stumble = this.stumble[index] ?? 0;
    if (stumble > 0) this.stumble[index] = stumble > dt ? stumble - dt : 0;
    const bump = this.bump[index] ?? 0;
    if (bump > 0) this.bump[index] = bump > dt ? bump - dt : 0;
    const pop = this.pop[index] ?? SETTLED;
    if (pop >= 0) this.pop[index] = pop + dt >= POP_DURATION ? SETTLED : pop + dt;

    const want =
      lateralSpeed > 0
        ? Math.min(UNIT_LEAN_MAX, lateralSpeed * UNIT_LEAN_PER_SPEED)
        : Math.max(-UNIT_LEAN_MAX, lateralSpeed * UNIT_LEAN_PER_SPEED);
    const was = this.lean[index] ?? 0;
    const now = was + (want - was) * this.ease;
    this.lean[index] = now;
    return now;
  }
}
