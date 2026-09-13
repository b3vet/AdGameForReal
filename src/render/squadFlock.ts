/**
 * The flock: where each mage is actually drawn (D37).
 *
 * The sim's formation is exact — every unit on its slot, the whole sheet
 * sliding sideways together — and a crowd drawn that way reads as one rigid
 * object. So each unit keeps a drawn position that chases its slot through a
 * first-order spring whose rate falls with the unit's row: the front line is
 * nearly pinned, the rows behind it arrive a beat later, and a turn ripples
 * backward through the crowd. Units lean into the direction they are sliding,
 * which is the cheapest thing that reads as weight on a crowd whose instances
 * carry a yaw and nothing else.
 *
 * A lag cannot overshoot, which is why this is first-order and not a damped
 * second-order spring like the squad's own steering: a back row that bounced
 * past its slot would read as a mistake rather than as weight.
 *
 * Everything is a preallocated `Float32Array` written in place — this runs five
 * hundred times a frame and must not allocate (CLAUDE.md) — and none of it
 * touches the sim, which still sees the formation it built.
 */

import {
  UNIT_FOLLOW_BACK,
  UNIT_FOLLOW_FRONT,
  UNIT_FOLLOW_ROWS,
  UNIT_LEAN_MAX,
  UNIT_LEAN_PER_SPEED,
  UNIT_LEAN_SMOOTHING,
  UNIT_SNAP_GAP,
} from './crowdLook';

export class UnitFlock {
  private readonly x: Float32Array;
  private readonly z: Float32Array;
  private readonly lean: Float32Array;

  /** How much of a lean gap this frame closes; set once per frame, not per unit. */
  private leanEase = 1;

  constructor(capacity: number) {
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.lean = new Float32Array(capacity);
  }

  /** Called once a frame, before the units are walked. */
  beginFrame(dt: number): void {
    this.leanEase = dt <= 0 ? 1 : 1 - Math.exp(-dt / UNIT_LEAN_SMOOTHING);
  }

  /** Puts a unit on its slot with no lean: a recruit popping in, or a reset. */
  place(index: number, x: number, z: number): void {
    this.x[index] = x;
    this.z[index] = z;
    this.lean[index] = 0;
  }

  /**
   * Moves unit `index` of row `row` toward `(targetX, targetZ)`.
   *
   * A unit further than `UNIT_SNAP_GAP` from its slot is placed instead of
   * sprung: that covers `?turbo` (the sim runs several steps per frame while
   * this clock does not, so every slot leaps forward), a level start and any
   * other teleport, and it is far enough out that a real turn never reaches it.
   */
  follow(index: number, row: number, targetX: number, targetZ: number, dt: number): void {
    const fromX = this.x[index] ?? targetX;
    const fromZ = this.z[index] ?? targetZ;
    const gapX = targetX - fromX;
    const gapZ = targetZ - fromZ;

    if (dt <= 0 || Math.abs(gapX) > UNIT_SNAP_GAP || Math.abs(gapZ) > UNIT_SNAP_GAP) {
      this.place(index, targetX, targetZ);
      return;
    }

    const lag = Math.min(1, row / UNIT_FOLLOW_ROWS);
    const rate = UNIT_FOLLOW_FRONT + (UNIT_FOLLOW_BACK - UNIT_FOLLOW_FRONT) * lag;
    const ease = 1 - Math.exp(-rate * dt);
    const movedX = gapX * ease;
    this.x[index] = fromX + movedX;
    this.z[index] = fromZ + gapZ * ease;

    const want = Math.min(
      UNIT_LEAN_MAX,
      Math.max(-UNIT_LEAN_MAX, (movedX / dt) * UNIT_LEAN_PER_SPEED),
    );
    const was = this.lean[index] ?? 0;
    this.lean[index] = was + (want - was) * this.leanEase;
  }

  drawnX(index: number, fallback: number): number {
    return this.x[index] ?? fallback;
  }

  drawnZ(index: number, fallback: number): number {
    return this.z[index] ?? fallback;
  }

  leanOf(index: number): number {
    return this.lean[index] ?? 0;
  }
}
