/**
 * The spray a body running down a lane kicks up (D49): the charger's dust and
 * the Rime Fiend's frost wake.
 *
 * One class, two instances, because they are the same effect at two sizes and
 * two hues — a mark left behind a moving body, spreading and fading where it
 * fell. Both go into the shared ground-decal batch (`./groundDecals.ts`), so
 * neither costs a draw call of its own and neither needs a material.
 *
 * Doubly capped, exactly as the squad's fence dust is (`./squadDust.ts`): a
 * ring of `SPRAY_POOL` and at most one new puff every `SPRAY_EVERY` seconds. A
 * charge is two seconds of a body crossing the road at 9 m/s, and a puff per
 * frame is a fog bank down the lane rather than a trail.
 *
 * Preallocated in full and written in place: this is on the frame path.
 */

import type { GroundDecals } from './groundDecals';
import {
  SPRAY_ALPHA,
  SPRAY_DRIFT,
  SPRAY_DURATION,
  SPRAY_EVERY,
  SPRAY_POOL,
  SPRAY_SIZE_END,
  SPRAY_SIZE_START,
} from './theme';

export class FrostSpray {
  private readonly x = new Float32Array(SPRAY_POOL);
  private readonly z = new Float32Array(SPRAY_POOL);
  private readonly age = new Float32Array(SPRAY_POOL);
  /** Which way this puff drifts across the road; ±1, from the body's motion. */
  private readonly drift = new Float32Array(SPRAY_POOL);
  private count = 0;
  /** Seconds until the next puff may be shed; one clock per emitter. */
  private cooldown = 0;
  /** Which side of the body the next puff is thrown from; ±1, alternating. */
  private side = 1;

  /**
   * `size` is the puff's own diameter in metres and `(r, g, b)` its hue — both
   * fixed for the life of the emitter, because one emitter is one thing
   * running. The colour is read every frame rather than copied, so a biome
   * switch moves it with the rest of the palette.
   *
   * `spread` is how far either side of the body a mark is thrown, and it is a
   * framing number rather than a physical one: the camera looks *up* the road,
   * so a trail left directly behind a body running at it is hidden by that
   * body. Thrown out from under alternate feet it reads as spray and stays in
   * frame — which is also what a heavy thing running through snow does.
   */
  constructor(
    private readonly size: number,
    private readonly color: { r: number; g: number; b: number },
    private readonly spread = 0,
  ) {}

  /** A new level, or a body that stopped: nothing hanging over the road. */
  clear(): void {
    this.count = 0;
    this.cooldown = 0;
  }

  /**
   * A body is at `(x, z)` moving across the road at `lateral` metres a second.
   * Call it every frame the body is running; the clock inside decides whether
   * this frame actually sheds anything.
   */
  emit(x: number, z: number, lateral: number, dt: number): void {
    this.cooldown -= dt;
    if (this.cooldown > 0 || this.count >= SPRAY_POOL) return;
    this.cooldown = SPRAY_EVERY;
    this.side = -this.side;
    const at = this.count++;
    this.x[at] = x + this.side * this.spread;
    this.z[at] = z;
    this.age[at] = 0;
    // Outward: away from the body, and away from wherever it is heading when it
    // is crossing the road, so a turn throws its spray to the outside of it.
    this.drift[at] = lateral === 0 ? this.side : lateral < 0 ? 1 : -1;
  }

  /**
   * Ages every mark and draws the live ones, compacting the ring as it goes.
   * Called between the decal layer's `begin` and `end`.
   */
  draw(decals: GroundDecals, dt: number): void {
    let write = 0;
    for (let i = 0; i < this.count; i++) {
      const age = (this.age[i] ?? 0) + dt;
      if (age >= SPRAY_DURATION) continue;
      const phase = age / SPRAY_DURATION;
      const x = this.x[i] ?? 0;
      const z = this.z[i] ?? 0;
      const away = this.drift[i] ?? 1;
      decals.add(
        x + away * phase * SPRAY_DRIFT,
        z,
        this.size * (SPRAY_SIZE_START + phase * (SPRAY_SIZE_END - SPRAY_SIZE_START)),
        this.color.r,
        this.color.g,
        this.color.b,
        // Squared rather than linear, so a mark holds most of its opacity for
        // the first half of its life and then goes quickly: a linear fade left
        // everything but the newest puff too faint to see on an ice road, which
        // is a trail that is only ever one disc long.
        (1 - phase * phase) * SPRAY_ALPHA,
      );

      if (write !== i) {
        this.x[write] = x;
        this.z[write] = z;
        this.drift[write] = away;
      }
      this.age[write] = age;
      write++;
    }
    this.count = write;
  }
}
