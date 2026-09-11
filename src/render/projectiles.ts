/**
 * Projectiles, one look per staff: an ember bolt with a glowing tail, a violet
 * storm bolt, a cyan frost shard.
 *
 * Each staff owns two meshes — a bright core and a longer, dimmer trail behind
 * it — and only the staff in hand is enabled, so a screen full of bullets is
 * two draw calls whatever the squad is carrying. The buffers are sized for
 * `balance.projectiles.max` at init and never grow.
 */

import { Constants } from '@babylonjs/core/Engines/constants';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { commitInstances, createMatrixBuffer, writeInstance } from './instanceBuffer';
import {
  BOLT_GLOW_BOOST,
  EMBER_COLOR,
  FROST_COLOR,
  POOL,
  STORM_COLOR,
  TRAIL_GLOW_BOOST,
} from './theme';
import { startWeapon, weaponIds } from '@/sim';
import type { ProjectileState, WeaponId } from '@/sim';

/**
 * Bolts fly along +z, so every shape is stretched on z. The height is the
 * mages' own chest, not their hats: at 500 units the crowd is a solid mass and
 * a bolt spawned above the hat line reads as a candle standing on the crowd
 * rather than as a spell leaving it.
 */
const BOLT_Y = 0.5;

interface BoltSet {
  core: Mesh;
  trail: Mesh;
  coreMatrices: Float32Array;
  trailMatrices: Float32Array;
  /** Trail length in metres, drawn behind the core. */
  trailLength: number;
}

export class ProjectileView {
  private readonly sets = new Map<WeaponId, BoltSet>();
  private active: WeaponId = startWeapon;

  constructor(scene: Scene) {
    for (const id of weaponIds) {
      const set = buildSet(scene, id);
      // Every set starts hidden; `commitInstances` turns on whichever one has
      // bolts to draw this frame.
      set.core.setEnabled(false);
      set.trail.setEnabled(false);
      this.sets.set(id, set);
    }
  }

  setWeapon(weaponId: WeaponId): void {
    if (weaponId === this.active) return;
    const previous = this.sets.get(this.active);
    previous?.core.setEnabled(false);
    previous?.trail.setEnabled(false);
    this.active = weaponId;
  }

  /**
   * The bolt cores bloom; the tails do not. Every mesh on the glow list is a
   * second draw call whenever it is on screen, and a tail that is already
   * additive and half transparent gains nothing from the blur.
   */
  glowMeshes(): Mesh[] {
    const meshes: Mesh[] = [];
    for (const set of this.sets.values()) meshes.push(set.core);
    return meshes;
  }

  reset(): void {
    for (const set of this.sets.values()) {
      commitInstances(set.core, 0);
      commitInstances(set.trail, 0);
    }
  }

  update(projectiles: readonly ProjectileState[], weaponId: WeaponId): void {
    this.setWeapon(weaponId);
    const set = this.sets.get(this.active);
    if (set === undefined) return;

    let live = 0;
    for (const projectile of projectiles) {
      if (!projectile.alive) continue;
      if (live >= POOL.projectiles) break;
      writeInstance(set.coreMatrices, live, 1, 1, 1, projectile.x, BOLT_Y, projectile.z);
      writeInstance(
        set.trailMatrices,
        live,
        1,
        1,
        1,
        projectile.x,
        BOLT_Y,
        projectile.z - set.trailLength / 2,
      );
      live++;
    }
    commitInstances(set.core, live);
    commitInstances(set.trail, live);
  }

  dispose(): void {
    for (const set of this.sets.values()) {
      set.core.material?.dispose();
      set.trail.material?.dispose();
      set.core.dispose();
      set.trail.dispose();
    }
    this.sets.clear();
  }
}

/**
 * The three looks. Ember is a fat round bolt, storm a long thin needle — it is
 * the fastest projectile and reads that way — and frost a faceted shard, a box
 * turned on its axis so it catches the light as a diamond rather than a brick.
 */
function buildSet(scene: Scene, id: WeaponId): BoltSet {
  const color = id === 'ember' ? EMBER_COLOR : id === 'storm' ? STORM_COLOR : FROST_COLOR;
  const core = buildCore(scene, id, color);
  const trailLength = id === 'storm' ? 1.5 : 1;
  const trail = CreateSphere(
    `trail-${id}`,
    { diameterX: 0.1, diameterY: 0.1, diameterZ: trailLength, segments: 4 },
    scene,
  );
  trail.material = unlit(scene, `trailMat-${id}`, color.scale(0.6 * TRAIL_GLOW_BOOST), 0.28, true);

  return {
    core,
    trail,
    coreMatrices: createMatrixBuffer(core, POOL.projectiles),
    trailMatrices: createMatrixBuffer(trail, POOL.projectiles),
    trailLength,
  };
}

function buildCore(scene: Scene, id: WeaponId, color: Color3): Mesh {
  if (id === 'frost') {
    const shard = CreateBox(`bolt-${id}`, { width: 0.14, height: 0.14, depth: 0.44 }, scene);
    // Baked, not set as a rotation: thin instances carry scale and position
    // only, so the shard's roll has to live in its vertices.
    shard.bakeTransformIntoVertices(Matrix.RotationZ(Math.PI / 4));
    shard.material = unlit(scene, `boltMat-${id}`, color.scale(BOLT_GLOW_BOOST), 1, true);
    return shard;
  }
  // Small: the sim keeps up to 400 bolts alive, and a big squad's barrage is a
  // solid river of them. Thin enough that the block or the boss they are aimed
  // at still reads through the stream.
  const long = id === 'storm' ? 0.7 : 0.42;
  const wide = id === 'storm' ? 0.1 : 0.13;
  const bolt = CreateSphere(
    `bolt-${id}`,
    { diameterX: wide, diameterY: wide, diameterZ: long, segments: 6 },
    scene,
  );
  bolt.material = unlit(scene, `boltMat-${id}`, color.scale(BOLT_GLOW_BOOST), 1, true);
  return bolt;
}

/**
 * A bolt should be the brightest thing on screen at any angle, so: unlit, and
 * additive with an emissive above 1 (`BOLT_GLOW_BOOST`).
 *
 * Milestone 2 drew an opaque core and let the glow pass smear a halo round it.
 * The pass is off now (plan, performance step 4), so the core carries its own
 * light: additive blending plus a saturating emissive is what still reads as a
 * spell burning through the air rather than a painted pellet.
 */
function unlit(
  scene: Scene,
  name: string,
  color: Color3,
  alpha: number,
  additive: boolean,
): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.emissiveColor = color;
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.disableLighting = true;
  material.alpha = alpha;
  if (additive) material.alphaMode = Constants.ALPHA_ADD;
  return material;
}
