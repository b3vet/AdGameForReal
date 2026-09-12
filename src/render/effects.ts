/**
 * Spell effects: muzzle flashes, per-weapon impacts, the ember splash ring, the
 * storm chain arc and the puff a leaked enemy leaves behind.
 *
 * The bursts and flashes are flipbook sprites written into the shared
 * `SpriteLayer` (`./sprites.ts`), so they cost no draw call of their own — they
 * land in the same batch as the projectiles. The ring and the arc stay
 * geometry, because a ring that has to be exactly `radius` metres across on the
 * ground is a torus, not a billboard; both are restyled brighter for the
 * daylight palette, where an additive shape on a light road has to work harder
 * than it did on a near-black one.
 *
 * Everything is pooled and capped at `POOL.impacts` live effects (the plan's
 * 24), and nothing here allocates per frame.
 */

import { Constants } from '@babylonjs/core/Engines/constants';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { commitInstances, createMatrixBuffer, writeRotatedInstance } from './instanceBuffer';
import { RingPool } from './rings';
import type { SpriteLayer } from './sprites';
import { bookCell, type SpriteBook } from './spriteSheets';
import {
  CHAIN_DURATION,
  CHAIN_Y,
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
  SPLASH_DURATION,
  STORM_COLOR,
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
const PUFF_COLOR = new Color3(0.85, 0.8, 0.72);

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

interface Splash {
  x: number;
  z: number;
  radius: number;
  age: number;
}

interface Chain {
  x: number;
  z: number;
  yaw: number;
  length: number;
  age: number;
}

export class EffectsView {
  private readonly sprites: SpriteLayer;

  /** One pool for impacts, flashes and puffs: they differ only in their fields. */
  private readonly bursts: Burst[] = [];
  private burstCount = 0;

  private readonly chainMesh: Mesh;
  private readonly chainMatrices: Float32Array;
  private readonly chains: Chain[] = [];
  private chainCount = 0;

  private readonly splashRings: RingPool;
  private readonly splashes: Splash[] = [];
  private splashCount = 0;

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

    // A unit-length bar along +z, stretched between the two blocks it links.
    this.chainMesh = CreateBox('chain', { width: 0.12, height: 0.12, depth: 1 }, scene);
    this.chainMesh.material = unlit(scene, 'chainMat', STORM_COLOR);
    this.chainMatrices = createMatrixBuffer(this.chainMesh, POOL.chains);
    for (let i = 0; i < POOL.chains; i++) {
      this.chains.push({ x: 0, z: 0, yaw: 0, length: 1, age: 0 });
    }

    this.splashRings = new RingPool(scene, 'splash', EMBER_COLOR, POOL.splashes, {
      thickness: 0.13,
      alpha: 0.8,
      additive: true,
      y: 0.5,
    });
    for (let i = 0; i < POOL.splashes; i++) {
      this.splashes.push({ x: 0, z: 0, radius: 1, age: 0 });
    }
  }

  /** The staff decides which impact book is played and what colour a shot is. */
  setWeapon(weaponId: WeaponId): void {
    this.active = weaponId;
  }

  /** Only the two mesh effects are left for a glow pass to bloom, if one is
   *  ever turned back on; the sprites carry their own brightness. */
  glowMeshes(): Mesh[] {
    return [this.chainMesh, this.splashRings.mesh];
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

  onSplash(x: number, z: number, radius: number): void {
    if (this.splashCount >= POOL.splashes) return;
    const splash = this.splashes[this.splashCount];
    if (splash === undefined) return;
    splash.x = x;
    splash.z = z;
    splash.radius = radius;
    splash.age = 0;
    this.splashCount++;
  }

  onChain(fromX: number, fromZ: number, toX: number, toZ: number): void {
    if (this.chainCount >= POOL.chains) return;
    const chain = this.chains[this.chainCount];
    if (chain === undefined) return;
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    chain.length = Math.max(0.2, Math.hypot(dx, dz));
    chain.x = (fromX + toX) / 2;
    chain.z = (fromZ + toZ) / 2;
    chain.yaw = Math.atan2(dx, dz);
    chain.age = 0;
    this.chainCount++;
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
    this.chainCount = 0;
    this.splashCount = 0;
    commitInstances(this.chainMesh, 0);
    this.splashRings.reset();
  }

  update(dt: number): void {
    this.updateBursts(dt);
    this.updateChains(dt);
    this.updateSplashes(dt);
  }

  dispose(): void {
    this.chainMesh.material?.dispose();
    this.chainMesh.dispose();
    this.splashRings.dispose();
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

  private updateChains(dt: number): void {
    let write = 0;
    for (let i = 0; i < this.chainCount; i++) {
      const chain = this.chains[i];
      if (chain === undefined) continue;
      chain.age += dt;
      if (chain.age >= CHAIN_DURATION) continue;
      const thickness = 1 - chain.age / CHAIN_DURATION;
      writeRotatedInstance(
        this.chainMatrices,
        write,
        thickness,
        thickness,
        chain.length,
        chain.yaw,
        chain.x,
        CHAIN_Y,
        chain.z,
      );
      const kept = this.chains[write];
      if (kept !== undefined && write !== i) {
        kept.x = chain.x;
        kept.z = chain.z;
        kept.yaw = chain.yaw;
        kept.length = chain.length;
        kept.age = chain.age;
      }
      write++;
    }
    this.chainCount = write;
    commitInstances(this.chainMesh, write);
  }

  private updateSplashes(dt: number): void {
    this.splashRings.begin();
    let write = 0;
    for (let i = 0; i < this.splashCount; i++) {
      const splash = this.splashes[i];
      if (splash === undefined) continue;
      splash.age += dt;
      if (splash.age >= SPLASH_DURATION) continue;
      const p = splash.age / SPLASH_DURATION;
      this.splashRings.add(splash.x, splash.z, splash.radius * (0.3 + p * 0.9), 1 - p);
      const kept = this.splashes[write];
      if (kept !== undefined && write !== i) {
        kept.x = splash.x;
        kept.z = splash.z;
        kept.radius = splash.radius;
        kept.age = splash.age;
      }
      write++;
    }
    this.splashCount = write;
    this.splashRings.end();
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

function unlit(scene: Scene, name: string, color: Color3): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  // Scaled above 1 because the glow pass no longer blooms these (plan,
  // performance step 4); additive blending turns the excess into a white core.
  material.emissiveColor = color.scale(IMPACT_GLOW_BOOST);
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.disableLighting = true;
  material.alpha = 0.95;
  material.alphaMode = Constants.ALPHA_ADD;
  return material;
}
