/**
 * Spell effects: muzzle flashes, per-weapon impacts, the shield break, and the
 * puff a leaked enemy leaves behind.
 *
 * All of them are flipbook sprites written into the shared `SpriteLayer`
 * (`./sprites.ts`), so they cost no draw call of their own — they land in the
 * same batch as the projectiles. The two effects that are *not* quads, ember's
 * splash ring and storm's chain arc, are `./effectsGeometry.ts`, which this
 * view owns and drives; the split is the file-size rule (CLAUDE.md) on the seam
 * the effects already had.
 *
 * Everything is pooled and capped at `POOL.impacts` live effects (the plan's
 * 24), and nothing here allocates per frame.
 */

import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';

import { EffectGeometry } from './effectsGeometry';
import type { SpriteLayer } from './sprites';
import { bookCell, type SpriteBook } from './spriteSheets';
import {
  EMBER_COLOR,
  FROST_COLOR,
  IMPACT_DURATION,
  IMPACT_GLOW_BOOST,
  IMPACT_SIZE,
  IMPACT_Y,
  MUZZLE_DURATION,
  MUZZLE_SIZE,
  MUZZLE_Y,
  POOL,
  SHATTER_PUFF_DURATION,
  SHATTER_PUFF_SIZE,
  SHATTER_PUFF_SPOKES,
  SHIELD_BREAK_COLOR,
  SHIELD_BREAK_DURATION,
  SHIELD_BREAK_RADIUS,
  SHIELD_BREAK_SIZE,
  SHIELD_BREAK_SPOKES,
  STORM_COLOR,
  paletteColor,
} from './theme';
import { startWeapon } from '@/sim';
import type { WeaponId } from '@/sim';

/**
 * The boss's death: one ring and a circle of bursts around the body. Three
 * metres, not five: the ring is additive, and the Phase B2 frames had it
 * filling the arena over the body it was celebrating.
 */
const BOSS_DEATH_RING = 3;
const BOSS_DEATH_BURSTS = 8;
const BOSS_DEATH_SPREAD = 1.4;

/** Which impact flipbook each staff throws. */
const IMPACT_BOOKS: Record<WeaponId, SpriteBook> = {
  ember: 'emberImpact',
  storm: 'stormImpact',
  frost: 'frostImpact',
};

/**
 * The puff a leaked stream body leaves. Pale and short: it is an apology for a
 * body that vanished, not an event — the unit the leak cost is the event, and
 * the HUD counts that.
 */
const PUFF_DURATION = 0.28;
const PUFF_SIZE = 0.85;
const PUFF_COLOR = paletteColor('bone.deep');

interface Burst {
  x: number;
  y: number;
  z: number;
  roll: number;
  age: number;
  /** Which sheet book this one plays, so a staff swap cannot recolour it. */
  book: SpriteBook;
  red: number;
  green: number;
  blue: number;
  /** Seconds the flipbook runs for, and how big it grows. */
  life: number;
  size: number;
}

export class EffectsView {
  private readonly sprites: SpriteLayer;

  /** One pool for impacts, flashes and puffs: they differ only in their fields. */
  private readonly bursts: Burst[] = [];
  private burstCount = 0;

  /** The ring and the arc, which are meshes rather than quads. */
  private readonly geometry: EffectGeometry;

  private active: WeaponId = startWeapon;

  constructor(scene: Scene, sprites: SpriteLayer) {
    this.sprites = sprites;
    // Impacts, muzzles and puffs share one ring; the plan's cap is on effects
    // alive at once, and a flash is an effect.
    for (let i = 0; i < POOL.impacts * 2; i++) {
      this.bursts.push({
        x: 0,
        y: 0,
        z: 0,
        roll: 0,
        age: 0,
        book: 'emberImpact',
        red: 1,
        green: 1,
        blue: 1,
        life: IMPACT_DURATION,
        size: IMPACT_SIZE,
      });
    }

    this.geometry = new EffectGeometry(scene);
  }

  /** The staff decides which impact book is played and what colour a shot is. */
  setWeapon(weaponId: WeaponId): void {
    this.active = weaponId;
  }

  /**
   * The flash at a staff's tip. A sparkle rather than a small impact: a muzzle
   * happens twice a second per unit, so at three hundred units there are a
   * dozen live at any moment *inside the crowd* — an impact burst at that rate
   * buries the squad under its own fire.
   */
  onMuzzle(x: number, z: number): void {
    const tint = tintOf(this.active);
    this.push('sparkle', x, MUZZLE_Y, z, MUZZLE_SIZE, MUZZLE_DURATION, tint.r, tint.g, tint.b);
  }

  onImpact(weaponId: WeaponId, x: number, z: number): void {
    this.setWeapon(weaponId);
    const tint = tintOf(weaponId);
    this.push(
      IMPACT_BOOKS[weaponId],
      x,
      IMPACT_Y,
      z,
      IMPACT_SIZE,
      IMPACT_DURATION,
      tint.r * IMPACT_GLOW_BOOST,
      tint.g * IMPACT_GLOW_BOOST,
      tint.b * IMPACT_GLOW_BOOST,
    );
  }

  /** A stream body walked into the squad: it is gone, and this is where. */
  onPuff(x: number, z: number): void {
    this.push(
      'sparkle',
      x,
      IMPACT_Y,
      z,
      PUFF_SIZE,
      PUFF_DURATION,
      PUFF_COLOR.r,
      PUFF_COLOR.g,
      PUFF_COLOR.b,
    );
  }

  /**
   * Frost's evolution (D33, tier 2): the body came apart and took its
   * neighbours with it.
   *
   * A ring of chips thrown out to the shatter's own radius rather than the
   * ember splash ring, which is a torus in the ember hue and would read as a
   * fire blast on an ice kill. The radius is the sim's — it comes off the
   * `splash` event the shatter emits — so what the player sees is exactly how
   * far the damage reached.
   */
  onShatterPuff(x: number, z: number, radius: number): void {
    const tint = tintOf('frost');
    for (let i = 0; i < SHATTER_PUFF_SPOKES; i++) {
      const angle = (i / SHATTER_PUFF_SPOKES) * Math.PI * 2 + 0.4;
      this.push(
        'frostImpact',
        x + Math.cos(angle) * radius * 0.75,
        IMPACT_Y,
        z + Math.sin(angle) * radius * 0.75,
        SHATTER_PUFF_SIZE,
        SHATTER_PUFF_DURATION,
        tint.r * IMPACT_GLOW_BOOST,
        tint.g * IMPACT_GLOW_BOOST,
        tint.b * IMPACT_GLOW_BOOST,
      );
    }
  }

  /**
   * A shielded brute's shield came apart (D49): a ring of ice chips thrown out
   * from the body, in the frost role.
   *
   * It is drawn whatever the physics quality is, unlike the real shards the
   * layer throws on top of it (`src/physics/bursts.ts`), because at quality 0
   * there is no Havok at all — and the break is the one moment that has to read
   * on every device, since it is what says the block's number will move now.
   * Brighter than the frost impacts it sits among, so the break is not lost in
   * the volley that caused it.
   */
  onShieldBreak(x: number, z: number): void {
    for (let i = 0; i < SHIELD_BREAK_SPOKES; i++) {
      const angle = (i / SHIELD_BREAK_SPOKES) * Math.PI * 2 + 0.2;
      this.push(
        'frostImpact',
        x + Math.cos(angle) * SHIELD_BREAK_RADIUS,
        IMPACT_Y,
        z + Math.sin(angle) * SHIELD_BREAK_RADIUS * 0.6,
        SHIELD_BREAK_SIZE,
        SHIELD_BREAK_DURATION,
        SHIELD_BREAK_COLOR.r * IMPACT_GLOW_BOOST,
        SHIELD_BREAK_COLOR.g * IMPACT_GLOW_BOOST,
        SHIELD_BREAK_COLOR.b * IMPACT_GLOW_BOOST,
      );
    }
  }

  /** Ember's blast ring, on the ground at the radius the sim resolved it at. */
  onSplash(x: number, z: number, radius: number): void {
    this.geometry.onSplash(x, z, radius);
  }

  /** Storm's arc between two blocks. */
  onChain(fromX: number, fromZ: number, toX: number, toZ: number): void {
    this.geometry.onChain(fromX, fromZ, toX, toZ);
  }

  /**
   * The one moment the scene is allowed to shout: a ring and a circle of bursts
   * around the body.
   */
  onBossDeath(weaponId: WeaponId, x: number, z: number): void {
    this.onSplash(x, z, BOSS_DEATH_RING);
    for (let i = 0; i < BOSS_DEATH_BURSTS; i++) {
      const angle = (i / BOSS_DEATH_BURSTS) * Math.PI * 2;
      this.onImpact(
        weaponId,
        x + Math.cos(angle) * BOSS_DEATH_SPREAD,
        z + Math.sin(angle) * BOSS_DEATH_SPREAD,
      );
    }
  }

  reset(): void {
    this.burstCount = 0;
    this.geometry.reset();
  }

  update(dt: number): void {
    this.updateBursts(dt);
    this.geometry.update(dt);
  }

  dispose(): void {
    this.geometry.dispose();
    this.bursts.length = 0;
  }

  private push(
    book: SpriteBook,
    x: number,
    y: number,
    z: number,
    size: number,
    life: number,
    red: number,
    green: number,
    blue: number,
  ): void {
    if (this.burstCount >= this.bursts.length) return;
    const burst = this.bursts[this.burstCount];
    if (burst === undefined) return;
    burst.x = x;
    burst.y = y;
    burst.z = z;
    // A different angle per slot, so eight impacts on one block are eight
    // shapes rather than the same stamp eight times.
    burst.roll = (this.burstCount % 8) * 0.79;
    burst.age = 0;
    burst.book = book;
    burst.red = red;
    burst.green = green;
    burst.blue = blue;
    burst.life = life;
    burst.size = size;
    this.burstCount++;
  }

  private updateBursts(dt: number): void {
    let write = 0;
    for (let i = 0; i < this.burstCount; i++) {
      const burst = this.bursts[i];
      if (burst === undefined) continue;
      burst.age += dt;
      if (burst.age >= burst.life) continue;

      const phase = burst.age / burst.life;
      // The flipbook carries the shape of the burst; the quad grows a little on
      // top of it so the frames do not read as a slideshow in one place.
      const size = burst.size * (0.7 + phase * 0.55);
      this.sprites.add(
        bookCell(burst.book, phase),
        burst.x,
        burst.y,
        burst.z,
        size,
        burst.red,
        burst.green,
        burst.blue,
        1,
        burst.roll,
      );

      const kept = this.bursts[write];
      if (kept !== undefined && write !== i) copyBurst(burst, kept);
      write++;
    }
    this.burstCount = write;
  }
}

function copyBurst(from: Burst, to: Burst): void {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.roll = from.roll;
  to.age = from.age;
  to.book = from.book;
  to.red = from.red;
  to.green = from.green;
  to.blue = from.blue;
  to.life = from.life;
  to.size = from.size;
}

function tintOf(id: WeaponId): Color3 {
  return id === 'ember' ? EMBER_COLOR : id === 'storm' ? STORM_COLOR : FROST_COLOR;
}
