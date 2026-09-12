/**
 * Projectiles: one animated magic sprite per shot in the air, plus the tail and
 * the sparkles behind it.
 *
 * Milestone 2 drew a small emissive mesh per bolt — a sphere for ember and
 * storm, a rolled box for frost — and let a glow pass smear a halo round it.
 * The pass is gone (Milestone 3, performance step 4) and the shapes read as
 * pellets, so a spell is now a billboarded flipbook quad cut out of the
 * procedural spell sheet: a fireball with a flame licking off it, a crackling
 * zigzag, a spinning ice crystal in a puff of mist (`./spriteSheets.ts`).
 *
 * Everything here writes into the shared `SpriteLayer`, so the whole volley —
 * heads, tails, sparkles, and the impacts and flashes in `./effects.ts` — is
 * one draw call whatever the squad is carrying.
 *
 * "Bigger and slightly slower" (plan, "Shots look like bullets") is entirely a
 * matter of `BOLT_SIZE`, the tail and the flipbook rate. The sim owns how fast
 * a projectile actually travels and nothing here may pretend otherwise.
 */

import type { SpriteLayer } from './sprites';
import { bookCell, bookCellLooping, type SpriteBook } from './spriteSheets';
import {
  BOLT_FLIPBOOK_FPS,
  BOLT_GLOW_BOOST,
  BOLT_SIZE,
  BOLT_TAIL,
  BOLT_TAIL_GAP,
  BOLT_Y,
  EMBER_COLOR,
  FROST_COLOR,
  POOL,
  SPARKLE_DURATION,
  SPARKLE_EVERY,
  SPARKLE_SIZE,
  STORM_COLOR,
  TRAIL_GLOW_BOOST,
} from './theme';
import { startWeapon } from '@/sim';
import type { ProjectileState, WeaponId } from '@/sim';

/** Which flipbook each staff flies. */
const BOOKS: Record<WeaponId, SpriteBook> = {
  ember: 'ember',
  storm: 'storm',
  frost: 'frost',
};

/** A sparkle in the air behind the volley. Pooled, never allocated in flight. */
interface Sparkle {
  x: number;
  y: number;
  z: number;
  age: number;
  /** The roll it was born with, so it does not spin while it fades. */
  roll: number;
}

export class ProjectileView {
  private readonly sprites: SpriteLayer;
  private active: WeaponId = startWeapon;

  /** Flipbook clock, advanced on sim time so hit-stop holds the spells too. */
  private phase = 0;
  /** Frame counter: which slice of the volley sheds a sparkle this frame. */
  private frame = 0;

  private readonly sparkles: Sparkle[] = [];
  private sparkleCount = 0;

  constructor(sprites: SpriteLayer) {
    this.sprites = sprites;
    for (let i = 0; i < POOL.sparkles; i++) {
      this.sparkles.push({ x: 0, y: 0, z: 0, age: 0, roll: 0 });
    }
  }

  setWeapon(weaponId: WeaponId): void {
    this.active = weaponId;
  }

  reset(): void {
    this.sparkleCount = 0;
    this.phase = 0;
  }

  update(projectiles: readonly ProjectileState[], weaponId: WeaponId, dt: number): void {
    this.setWeapon(weaponId);
    this.frame++;
    this.phase += dt * BOLT_FLIPBOOK_FPS;

    const book = BOOKS[this.active];
    const tint = tintOf(this.active);
    const headRed = tint.r * BOLT_GLOW_BOOST;
    const headGreen = tint.g * BOLT_GLOW_BOOST;
    const headBlue = tint.b * BOLT_GLOW_BOOST;
    const tailRed = tint.r * TRAIL_GLOW_BOOST;
    const tailGreen = tint.g * TRAIL_GLOW_BOOST;
    const tailBlue = tint.b * TRAIL_GLOW_BOOST;

    let live = 0;
    for (const projectile of projectiles) {
      if (!projectile.alive) continue;
      if (live >= POOL.projectiles) break;
      live++;

      // Each shot runs its own point in the flipbook, keyed off its id, so a
      // river of four hundred bolts is not four hundred copies of one frame.
      const cell = bookCellLooping(book, (this.phase + projectile.id * 0.37) / 12);
      this.sprites.add(
        cell,
        projectile.x,
        BOLT_Y,
        projectile.z,
        BOLT_SIZE,
        headRed,
        headGreen,
        headBlue,
        1,
        // A slow roll, per shot: the frost crystal spins in its own frames, and
        // this is what keeps ember and storm from looking stamped.
        projectile.id * 0.7 + this.phase * 0.04,
      );

      // The tail: the same flipbook a frame or two behind, smaller and dimmer.
      for (let i = 0; i < BOLT_TAIL.length; i++) {
        const step = BOLT_TAIL[i];
        if (step === undefined) continue;
        const [scale, alpha] = step;
        this.sprites.add(
          bookCellLooping(book, (this.phase + projectile.id * 0.37 - (i + 1) * 1.5) / 12),
          projectile.x,
          BOLT_Y,
          projectile.z - BOLT_TAIL_GAP * (i + 1),
          BOLT_SIZE * scale,
          tailRed,
          tailGreen,
          tailBlue,
          alpha,
        );
      }

      // One shot in `SPARKLE_EVERY` sheds a twinkle this frame, and which ones
      // rotates with the frame counter, so the whole volley trails without the
      // pool ever being asked for four hundred sparkles at once.
      if ((projectile.id + this.frame) % SPARKLE_EVERY === 0) {
        this.pushSparkle(projectile.x, projectile.z);
      }
    }

    this.drawSparkles(dt, tailRed, tailGreen, tailBlue);
  }

  dispose(): void {
    this.sparkles.length = 0;
  }

  private pushSparkle(x: number, z: number): void {
    if (this.sparkleCount >= POOL.sparkles) return;
    const sparkle = this.sparkles[this.sparkleCount];
    if (sparkle === undefined) return;
    sparkle.x = x;
    sparkle.z = z - BOLT_TAIL_GAP;
    // A little scatter off the flight line, derived from the slot rather than
    // from a random number, so the trail does not shimmer between frames.
    sparkle.y = BOLT_Y + ((this.sparkleCount % 5) - 2) * 0.045;
    sparkle.age = 0;
    sparkle.roll = this.sparkleCount * 0.9;
    this.sparkleCount++;
  }

  /** Ages the pool and draws what is left, compacting as it goes. */
  private drawSparkles(dt: number, red: number, green: number, blue: number): void {
    let write = 0;
    for (let i = 0; i < this.sparkleCount; i++) {
      const sparkle = this.sparkles[i];
      if (sparkle === undefined) continue;
      sparkle.age += dt;
      if (sparkle.age >= SPARKLE_DURATION) continue;

      const left = 1 - sparkle.age / SPARKLE_DURATION;
      this.sprites.add(
        bookCell('sparkle', 1 - left),
        sparkle.x,
        sparkle.y,
        sparkle.z,
        SPARKLE_SIZE * left,
        red,
        green,
        blue,
        left * 0.4,
        sparkle.roll,
      );

      const kept = this.sparkles[write];
      if (kept !== undefined && write !== i) {
        kept.x = sparkle.x;
        kept.y = sparkle.y;
        kept.z = sparkle.z;
        kept.age = sparkle.age;
        kept.roll = sparkle.roll;
      }
      write++;
    }
    this.sparkleCount = write;
  }
}

function tintOf(id: WeaponId): typeof EMBER_COLOR {
  return id === 'ember' ? EMBER_COLOR : id === 'storm' ? STORM_COLOR : FROST_COLOR;
}
