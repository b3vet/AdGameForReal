/**
 * Projectiles: thin instances of one stretched, unlit sphere.
 *
 * The buffer is sized for `balance.projectiles.max` at init and never grows, so
 * a full screen of bullets costs one buffer upload and one draw call.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { commitInstances, createMatrixBuffer, writeInstance } from './instanceBuffer';
import { POOL, PROJECTILE_COLOR } from './theme';
import type { ProjectileState } from '@/sim';

/** Bolts fly along +z, so they are stretched on z and sit at chest height. */
const BOLT_WIDTH = 0.18;
const BOLT_LENGTH = 0.65;
const BOLT_Y = 0.72;

export class ProjectileView {
  private readonly mesh: Mesh;
  private readonly matrices: Float32Array;

  constructor(scene: Scene) {
    const material = new StandardMaterial('boltMat', scene);
    material.emissiveColor = PROJECTILE_COLOR;
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    // Unlit: a bolt should be the brightest thing on screen at any angle.
    material.disableLighting = true;

    this.mesh = CreateSphere(
      'bolt',
      { diameterX: BOLT_WIDTH, diameterY: BOLT_WIDTH, diameterZ: BOLT_LENGTH, segments: 6 },
      scene,
    );
    this.mesh.material = material;
    this.matrices = createMatrixBuffer(this.mesh, POOL.projectiles);
  }

  reset(): void {
    commitInstances(this.mesh, 0);
  }

  update(projectiles: readonly ProjectileState[]): void {
    let live = 0;
    for (const projectile of projectiles) {
      if (!projectile.alive) continue;
      if (live >= POOL.projectiles) break;
      writeInstance(this.matrices, live, 1, 1, 1, projectile.x, BOLT_Y, projectile.z);
      live++;
    }
    commitInstances(this.mesh, live);
  }

  dispose(): void {
    this.mesh.dispose();
  }
}
