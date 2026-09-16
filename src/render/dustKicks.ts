/**
 * One-shot rings of dust thrown out from a point on the road: the kick a block
 * gives the road the step it wakes, and the burst a portal throws as it opens
 * (document 31, 4.1).
 *
 * The same marks as the charger's dust (`./frostSpray.ts`) — blended discs in
 * the shared ground-decal batch, spreading and fading where they fell — laid
 * down all at once on a circle instead of one at a time along a track. So no
 * draw call and no material of its own, and nothing that has to be warmed up.
 *
 * A ring of `KICK_POOL` marks, preallocated in full and written in place: this
 * is on the frame path. A kick that finds the ring full is dropped whole rather
 * than drawn in part, since half a ring reads as a mark on one side of the body.
 */

import type { Color3 } from '@babylonjs/core/Maths/math.color';

import type { GroundDecals } from './groundDecals';
import { KICK_POOL } from './theme';

/** What one kick looks like; the callers pass one of two fixed shapes. */
export interface KickShape {
  /** Marks thrown out on the circle. */
  puffs: number;
  /** Seconds each mark lives. */
  seconds: number;
  /** A mark's diameter at birth, as a share of the kick's radius. */
  size: number;
  /** How far out a mark travels, as a share of the kick's radius. */
  drift: number;
  alpha: number;
  /** Read at the kick, so a biome switch mid-mark cannot recolour it. */
  color: Color3;
}

export class DustKicks {
  private readonly x = new Float32Array(KICK_POOL);
  private readonly z = new Float32Array(KICK_POOL);
  /** Unit direction out from the kick's centre. */
  private readonly dirX = new Float32Array(KICK_POOL);
  private readonly dirZ = new Float32Array(KICK_POOL);
  /** How far out along it the mark ends, in metres. */
  private readonly reach = new Float32Array(KICK_POOL);
  private readonly size = new Float32Array(KICK_POOL);
  private readonly age = new Float32Array(KICK_POOL);
  private readonly life = new Float32Array(KICK_POOL);
  private readonly alpha = new Float32Array(KICK_POOL);
  /** Three floats a mark. */
  private readonly rgb = new Float32Array(KICK_POOL * 3);
  private count = 0;
  /** Turns the next kick's circle, so two kicks side by side are not stamps. */
  private turn = 0;

  /** A new level: nothing hanging over the road behind the loading frame. */
  clear(): void {
    this.count = 0;
  }

  /** Throws `shape.puffs` marks out from `(x, z)`, starting `radius` out. */
  kick(x: number, z: number, radius: number, shape: KickShape): void {
    if (this.count + shape.puffs > KICK_POOL) return;
    this.turn = (this.turn + 0.61) % (Math.PI * 2);
    for (let i = 0; i < shape.puffs; i++) {
      const at = this.count++;
      const angle = this.turn + (i / shape.puffs) * Math.PI * 2;
      const dx = Math.cos(angle);
      // Squeezed along the road: the camera looks up it, so a circle of marks
      // at its true depth reads as a line of dots on either side of the body.
      const dz = Math.sin(angle) * 0.6;
      this.dirX[at] = dx;
      this.dirZ[at] = dz;
      this.x[at] = x + dx * radius * 0.5;
      this.z[at] = z + dz * radius * 0.5;
      this.reach[at] = radius * shape.drift;
      this.size[at] = radius * shape.size;
      this.age[at] = 0;
      this.life[at] = shape.seconds;
      this.alpha[at] = shape.alpha;
      this.rgb[at * 3] = shape.color.r;
      this.rgb[at * 3 + 1] = shape.color.g;
      this.rgb[at * 3 + 2] = shape.color.b;
    }
  }

  /**
   * Ages every mark and draws the live ones, compacting the ring as it goes.
   * Called between the decal layer's `begin` and `end`.
   */
  draw(decals: GroundDecals, dt: number): void {
    let write = 0;
    for (let i = 0; i < this.count; i++) {
      const life = this.life[i] ?? 1;
      const age = (this.age[i] ?? 0) + dt;
      if (age >= life) continue;
      const phase = age / life;
      // Out fast and settling, the way a kicked-up cloud slows as it spreads.
      const out = (this.reach[i] ?? 0) * (1 - (1 - phase) * (1 - phase));
      const fade = 1 - phase;
      decals.add(
        (this.x[i] ?? 0) + (this.dirX[i] ?? 0) * out,
        (this.z[i] ?? 0) + (this.dirZ[i] ?? 0) * out,
        (this.size[i] ?? 0) * (0.6 + phase * 0.9),
        this.rgb[i * 3] ?? 0,
        this.rgb[i * 3 + 1] ?? 0,
        this.rgb[i * 3 + 2] ?? 0,
        (this.alpha[i] ?? 0) * fade * fade,
      );
      if (write !== i) this.move(i, write);
      this.age[write] = age;
      write++;
    }
    this.count = write;
  }

  /** Marks alive right now, for the dev harness. */
  get live(): number {
    return this.count;
  }

  private move(from: number, to: number): void {
    this.x[to] = this.x[from] ?? 0;
    this.z[to] = this.z[from] ?? 0;
    this.dirX[to] = this.dirX[from] ?? 0;
    this.dirZ[to] = this.dirZ[from] ?? 0;
    this.reach[to] = this.reach[from] ?? 0;
    this.size[to] = this.size[from] ?? 0;
    this.life[to] = this.life[from] ?? 1;
    this.alpha[to] = this.alpha[from] ?? 0;
    this.rgb[to * 3] = this.rgb[from * 3] ?? 0;
    this.rgb[to * 3 + 1] = this.rgb[from * 3 + 1] ?? 0;
    this.rgb[to * 3 + 2] = this.rgb[from * 3 + 2] ?? 0;
  }
}
