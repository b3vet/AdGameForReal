/**
 * Flat rings on the road, drawn as thin instances of one torus.
 *
 * Three things in the scene are a ring: the frost decal under a slowed block,
 * the boss's stomp shockwave, and an ember splash. They differ only in colour
 * and in who ages them, so each owner keeps its own pool of one mesh — one draw
 * call per kind, however many rings are live.
 *
 * Immediate mode: the owner calls `begin`, `add`s the rings it wants this
 * frame, and `end`s. Nothing is retained, so an owner that stops adding a ring
 * has already removed it.
 */

import { Constants } from '@babylonjs/core/Engines/constants';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { commitInstances, createMatrixBuffer, writeInstance } from './instanceBuffer';

export interface RingOptions {
  /** Torus thickness as a share of its diameter of 1. */
  thickness?: number;
  /** Height above the road. Two rings at the same height z-fight. */
  y?: number;
  alpha?: number;
  /** Additive rings glow through each other; blended ones stack up. */
  additive?: boolean;
}

export class RingPool {
  readonly mesh: Mesh;
  private readonly matrices: Float32Array;
  private readonly y: number;
  private live = 0;

  constructor(
    scene: Scene,
    name: string,
    color: Color3,
    readonly capacity: number,
    options: RingOptions = {},
  ) {
    const material = new StandardMaterial(`${name}Mat`, scene);
    material.emissiveColor = color;
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.alpha = options.alpha ?? 0.85;
    if (options.additive === true) material.alphaMode = Constants.ALPHA_ADD;

    // A torus already lies flat in the xz plane, so a ring on the road needs no
    // rotation — only a scale on x and z.
    this.mesh = CreateTorus(
      name,
      { diameter: 1, thickness: options.thickness ?? 0.14, tessellation: 28 },
      scene,
    );
    this.mesh.material = material;
    this.y = options.y ?? 0.06;
    this.matrices = createMatrixBuffer(this.mesh, capacity);
  }

  begin(): void {
    this.live = 0;
  }

  /** `radius` is the ring's outer radius in metres. */
  add(x: number, z: number, radius: number, height = 1): void {
    if (this.live >= this.capacity) return;
    writeInstance(this.matrices, this.live, radius * 2, height, radius * 2, x, this.y, z);
    this.live++;
  }

  end(): void {
    commitInstances(this.mesh, this.live);
  }

  reset(): void {
    this.begin();
    this.end();
  }

  dispose(): void {
    this.mesh.material?.dispose();
    this.mesh.dispose();
  }
}
