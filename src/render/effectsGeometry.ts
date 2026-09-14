/**
 * The two spell effects that are geometry rather than sprites: ember's splash
 * ring and storm's chain arc.
 *
 * Split out of `./effects.ts` for the file-size rule (CLAUDE.md). The line
 * between the two files is what a thing is made of: everything in `effects.ts`
 * is a billboarded quad in the shared sprite batch, and these two are not — a
 * ring that has to be exactly `radius` metres across on the ground is a torus,
 * and an arc between two blocks is a bar stretched between them.
 *
 * Both are pooled at `POOL.splashes` and `POOL.chains`, both are immediate-mode
 * inside their own `update`, and neither allocates per frame.
 */

import { Constants } from '@babylonjs/core/Engines/constants';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { commitInstances, createMatrixBuffer, writeRotatedInstance } from './instanceBuffer';
import { RingPool } from './rings';
import {
  CHAIN_DURATION,
  CHAIN_Y,
  EMBER_COLOR,
  IMPACT_GLOW_BOOST,
  POOL,
  SPLASH_DURATION,
  STORM_COLOR,
} from './theme';

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

export class EffectGeometry {
  private readonly chainMesh: Mesh;
  private readonly chainMatrices: Float32Array;
  private readonly chains: Chain[] = [];
  private chainCount = 0;

  private readonly splashRings: RingPool;
  private readonly splashes: Splash[] = [];
  private splashCount = 0;

  constructor(scene: Scene) {
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

  reset(): void {
    this.chainCount = 0;
    this.splashCount = 0;
    commitInstances(this.chainMesh, 0);
    this.splashRings.reset();
  }

  update(dt: number): void {
    this.updateChains(dt);
    this.updateSplashes(dt);
  }

  dispose(): void {
    this.chainMesh.material?.dispose();
    this.chainMesh.dispose();
    this.splashRings.dispose();
    this.chains.length = 0;
    this.splashes.length = 0;
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
