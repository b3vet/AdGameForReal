/**
 * Dust at a fence.
 *
 * A unit the sim is holding on a fence line (`CROWD_ON_FENCE`) scuffs the road
 * where it stands. The puffs go into the shared sprite batch (`./sprites.ts`),
 * so a hundred units leaning on a wall cost no draw call of their own and no
 * material — one quad each out of the same buffer the spells are drawn from.
 *
 * Doubly capped, because the flag is not rare: a five-hundred column driven
 * sideways into a fence has most of a rank on the line every step for seconds.
 * A puff a unit would be a fog bank across the road, so the ring holds
 * `DUST_POOL` and takes at most `DUST_PER_FRAME` new ones — which reads as a
 * scuffle where the crowd is pressing, which is the thing worth seeing.
 *
 * Preallocated in full and written in place: this is on the frame path.
 */

import { bookCell } from './spriteSheets';
import type { SpriteLayer } from './sprites';
import {
  DUST_DURATION,
  DUST_PER_FRAME,
  DUST_POOL,
  DUST_RISE,
  DUST_SIZE,
  DUST_Y,
  paletteColor,
} from './theme';

/** Road dust over this palette's stone: the light end of it, so it reads. */
const DUST_COLOR = paletteColor('stone.light');

export class SquadDust {
  private readonly x = new Float32Array(DUST_POOL);
  private readonly z = new Float32Array(DUST_POOL);
  private readonly age = new Float32Array(DUST_POOL);
  /** Which way the puff drifts: away from the fence the unit is against. */
  private readonly drift = new Float32Array(DUST_POOL);
  private count = 0;
  /** New puffs taken this frame, reset by `beginFrame`. */
  private taken = 0;

  /** A new level: no dust hanging over the road behind the loading frame. */
  clear(): void {
    this.count = 0;
    this.taken = 0;
  }

  /** Once a frame, before the units are walked. */
  beginFrame(): void {
    this.taken = 0;
  }

  /**
   * A unit is being held at a fence, at `(x, z)`; `away` is the direction off
   * the line, which is the way the dust is thrown.
   *
   * Dropped silently once the frame's two are gone: a puff that is not drawn is
   * invisible, which is exactly what a cap is for.
   */
  scuff(x: number, z: number, away: number): void {
    if (this.taken >= DUST_PER_FRAME || this.count >= DUST_POOL) return;
    const at = this.count++;
    this.taken++;
    this.x[at] = x;
    this.z[at] = z;
    this.age[at] = 0;
    this.drift[at] = away < 0 ? -1 : 1;
  }

  /**
   * Ages every puff and draws the live ones, compacting the ring as it goes.
   * Called between the sprite layer's `begin` and `end`.
   */
  draw(sprites: SpriteLayer, dt: number): void {
    let write = 0;
    for (let i = 0; i < this.count; i++) {
      const age = (this.age[i] ?? 0) + dt;
      if (age >= DUST_DURATION) continue;
      const phase = age / DUST_DURATION;
      const x = this.x[i] ?? 0;
      const z = this.z[i] ?? 0;
      const away = this.drift[i] ?? 1;
      sprites.add(
        bookCell('sparkle', phase),
        // Drifting out from the line and up: a scuff throws its dust away from
        // whatever it scraped against.
        x + away * phase * DUST_SIZE * 0.5,
        DUST_Y + phase * DUST_RISE,
        z,
        DUST_SIZE * (0.6 + phase * 0.8),
        DUST_COLOR.r,
        DUST_COLOR.g,
        DUST_COLOR.b,
        (1 - phase) * 0.7,
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
