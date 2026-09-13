/**
 * The two sim steps render draws between.
 *
 * The sim steps at a fixed 1/60 s behind an accumulator (`Run.tick`) while the
 * display runs at whatever the device offers — 120 Hz on the product owner's
 * phone. Drawing `crowd.x` straight shows every step's position on *two*
 * consecutive frames and then jumps two steps' worth on the third, which is
 * exactly the judder the owner reads as "not smooth": the crowd is correct
 * sixty times a second and wrong the other sixty.
 *
 * So the view never draws a sim step. It keeps the last two — the one just
 * taken and the one before it — and draws `prev + (cur - prev) * alpha`, where
 * alpha is how far through the current step the display clock has got. A frame
 * then moves every unit by exactly the fraction of a step that has elapsed, at
 * any refresh rate, and the cost of it is one lerp per unit per axis.
 *
 * What it buys is smoothness; what it costs is that the crowd is drawn up to
 * one step (16.7 ms) behind the sim, which is the standard trade and is well
 * inside the 150 ms the plan asks the head to answer a finger in.
 *
 * The buffers are swapped, never copied, and nothing here allocates after the
 * constructor (CLAUDE.md): one `set` per array per *sim step* — not per frame —
 * and one integer scan for the frame's births and deaths.
 */

import { CROWD_JUST_SPAWNED } from '@/sim';
import type { CrowdState } from '@/sim';

/**
 * The sim's fixed step, mirrored from `Run.FIXED_DT`.
 *
 * Not tuning and not a knob: it is the sim's contract, and the sim is the one
 * place that may change it. Render only ever measures against it — a `state.time`
 * that moved by one of these is one step taken.
 */
export const SIM_STEP = 1 / 60;

/**
 * A frame that carried the sim more than this many steps is a cut, not a step:
 * `?turbo` (up to sixty steps in a frame), a level start, a tab coming back.
 * Interpolating across one would drag the whole crowd through a metre of road,
 * so the snapshot snaps and the frame draws the sim exactly.
 */
const SNAP_STEPS = 1.5;

export class AgentFrame {
  readonly capacity: number;

  /** The step before the one just taken. Swapped with `cur`, never copied. */
  prevX: Float32Array;
  prevZ: Float32Array;
  prevVX: Float32Array;
  prevVZ: Float32Array;

  /** The step just taken: what the sim holds right now. */
  curX: Float32Array;
  curZ: Float32Array;
  curVX: Float32Array;
  curVZ: Float32Array;

  /** `alive` and `flags` as of the current step, and as of the step before. */
  alive: Uint8Array;
  wasAlive: Uint8Array;
  flags: Uint8Array;
  wasFlags: Uint8Array;

  /** Indices that died since the last advance, for the corpse ring. */
  readonly dead: Int32Array;
  deadCount = 0;

  /** Indices that appeared since the last advance, for the pop. */
  readonly born: Int32Array;
  bornCount = 0;

  /** One past the highest live index: how many instance slots are in play. */
  limit = 0;
  /** How many units are alive, for the callers that reserve a slot each. */
  live = 0;
  /** True on a frame the sim actually took a step; false on one between two. */
  stepped = false;

  /** How far through the current step the display clock has got, 0 to 1. */
  alpha = 1;

  /** `state.time` at the last advance; `NaN` until the first crowd is seen. */
  private simTime = Number.NaN;
  /** The sim time the frame is actually drawn at, always inside one step of it. */
  private drawTime = 0;

  constructor(capacity: number) {
    this.capacity = Math.max(0, Math.floor(capacity));
    const size = this.capacity;
    this.prevX = new Float32Array(size);
    this.prevZ = new Float32Array(size);
    this.prevVX = new Float32Array(size);
    this.prevVZ = new Float32Array(size);
    this.curX = new Float32Array(size);
    this.curZ = new Float32Array(size);
    this.curVX = new Float32Array(size);
    this.curVZ = new Float32Array(size);
    this.alive = new Uint8Array(size);
    this.wasAlive = new Uint8Array(size);
    this.flags = new Uint8Array(size);
    this.wasFlags = new Uint8Array(size);
    this.dead = new Int32Array(size);
    this.born = new Int32Array(size);
  }

  /** A new level: forget both steps, so the first frame of it primes instead
   *  of interpolating out of the last level's positions. */
  reset(): void {
    this.simTime = Number.NaN;
    this.deadCount = 0;
    this.bornCount = 0;
    this.limit = 0;
    this.live = 0;
    this.stepped = false;
    this.alpha = 1;
    this.alive.fill(0);
    this.wasAlive.fill(0);
  }

  /**
   * Takes the frame's snapshot and answers the `alpha` to draw at.
   *
   * `time` is `state.time`, which is the only clock that says whether the sim
   * moved: it advances by exactly `SIM_STEP` per step and by nothing at all on
   * a frame that fell between two. `dt` is the frame's own sim-seconds, which
   * is what carries the draw clock forward between steps.
   */
  beginFrame(crowd: CrowdState, time: number, dt: number): void {
    this.deadCount = 0;
    this.bornCount = 0;
    this.stepped = false;

    if (Number.isNaN(this.simTime)) {
      this.prime(crowd, time);
      return;
    }

    const moved = time - this.simTime;
    if (moved > 0) {
      this.simTime = time;
      this.stepped = true;
      this.swap();
      this.read(crowd);
      this.scan();
      if (moved > SNAP_STEPS * SIM_STEP) this.snap();
    }

    // The draw clock runs on the frame's own time and is held inside the step
    // the sim has just taken. The clamp is what makes this self-correcting: a
    // dropped frame, a hitch or `?turbo` cannot leave the two clocks apart.
    const low = time - SIM_STEP;
    let draw = this.drawTime + dt;
    if (draw < low) draw = low;
    else if (draw > time) draw = time;
    this.drawTime = draw;
    this.alpha = (draw - low) / SIM_STEP;
  }

  /** The first crowd this view has seen: both steps are the state as it stands. */
  private prime(crowd: CrowdState, time: number): void {
    this.simTime = time;
    this.drawTime = time;
    this.alpha = 1;
    this.read(crowd);
    this.snap();
    this.wasAlive.set(this.alive);
    this.wasFlags.set(this.flags);
    let limit = 0;
    let live = 0;
    for (let i = 0; i < this.capacity; i++) {
      if ((this.alive[i] ?? 0) === 0) continue;
      limit = i + 1;
      live++;
    }
    this.limit = limit;
    this.live = live;
  }

  /** The old `cur` becomes `prev`; the buffer it displaces is rewritten. */
  private swap(): void {
    let x = this.prevX;
    this.prevX = this.curX;
    this.curX = x;
    x = this.prevZ;
    this.prevZ = this.curZ;
    this.curZ = x;
    x = this.prevVX;
    this.prevVX = this.curVX;
    this.curVX = x;
    x = this.prevVZ;
    this.prevVZ = this.curVZ;
    this.curVZ = x;

    const alive = this.wasAlive;
    this.wasAlive = this.alive;
    this.alive = alive;
    const flags = this.wasFlags;
    this.wasFlags = this.flags;
    this.flags = flags;
  }

  /** One `set` per array: the sim's `Float64Array`s narrowed to draw floats. */
  private read(crowd: CrowdState): void {
    const n = Math.min(this.capacity, crowd.capacity);
    this.curX.set(crowd.x.subarray(0, n));
    this.curZ.set(crowd.z.subarray(0, n));
    this.curVX.set(crowd.vx.subarray(0, n));
    this.curVZ.set(crowd.vz.subarray(0, n));
    this.alive.set(crowd.alive.subarray(0, n));
    this.flags.set(crowd.flags.subarray(0, n));
  }

  /**
   * Births, deaths and the draw limit, in one pass over the capacity.
   *
   * A unit that appeared has no previous position — its index may have held
   * somebody else a moment ago, three metres away — so its `prev` is set to its
   * `cur` and it pops in where it stands rather than sliding in from the dead.
   * A unit that died keeps its `prev`, which is the last place it was alive and
   * therefore the place its corpse belongs.
   */
  private scan(): void {
    const alive = this.alive;
    const wasAlive = this.wasAlive;
    const flags = this.flags;
    let limit = 0;
    let live = 0;
    let dead = 0;
    let born = 0;
    for (let i = 0; i < this.capacity; i++) {
      const now = alive[i] ?? 0;
      const was = wasAlive[i] ?? 0;
      if (now !== 0) {
        limit = i + 1;
        live++;
        // The flag as well as the transition: an index freed and refilled
        // inside one frame reads as "alive throughout", and the sim's own
        // `JUST_SPAWNED` is the only thing that can tell those apart.
        if (was === 0 || ((flags[i] ?? 0) & CROWD_JUST_SPAWNED) !== 0) {
          this.prevX[i] = this.curX[i] ?? 0;
          this.prevZ[i] = this.curZ[i] ?? 0;
          this.prevVX[i] = this.curVX[i] ?? 0;
          this.prevVZ[i] = this.curVZ[i] ?? 0;
          this.born[born++] = i;
        }
      } else if (was !== 0) {
        this.dead[dead++] = i;
      }
    }
    this.limit = limit;
    this.live = live;
    this.deadCount = dead;
    this.bornCount = born;
  }

  /** No step to interpolate across: draw the sim exactly. */
  private snap(): void {
    this.prevX.set(this.curX);
    this.prevZ.set(this.curZ);
    this.prevVX.set(this.curVX);
    this.prevVZ.set(this.curVZ);
    this.drawTime = this.simTime;
    this.alpha = 1;
  }
}
