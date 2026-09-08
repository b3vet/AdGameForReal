/**
 * What every view in `src/render` talks to when it draws a lot of the same
 * character, and the greybox fallback behind it.
 *
 * `VatCrowd` is the real thing: baked animation on thin instances, one draw
 * call for five hundred mages. `StaticCrowd` implements the same six calls with
 * a capsule and no animation at all, and exists for one reason — a build whose
 * `/assets/` are missing (a production bundle before Phase C copies them, a
 * host that blocks the fetch) must still boot into a playable, readable game
 * rather than a black screen. The views cannot tell the two apart.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
// Side-effect import: this is what puts `thinInstance*` on `Mesh.prototype`.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';

export interface Crowd {
  /** The one mesh every instance is drawn from; views enable and disable it. */
  readonly mesh: Mesh;
  /** Instances the buffer holds; a caller packing several groups in must check. */
  readonly capacity: number;
  setInstance(
    index: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    scale: number,
    animationId: string,
    timeOffset: number,
    speed?: number,
  ): void;
  setCount(count: number): void;
  commit(): void;
  update(dt: number): void;
  durationOf(animationId: string): number;
  dispose(): void;
}

const FLOATS_PER_MATRIX = 16;

const scratchMatrix = Matrix.Identity();
const scratchScale = Vector3.One();
const scratchRotation = Quaternion.Identity();
const scratchTranslation = Vector3.Zero();

/** Same height as a KayKit character at the manifest's scale, so the callers'
 *  `scale` argument means the same thing whichever crowd they ended up with. */
const UNIT_HEIGHT = 0.62;
const UNIT_RADIUS = 0.17;

export class StaticCrowd implements Crowd {
  readonly mesh: Mesh;

  private readonly matrices: Float32Array;
  private count = 0;

  constructor(scene: Scene, name: string, color: Color3, readonly capacity: number) {
    const material = new StandardMaterial(`${name}Mat`, scene);
    material.diffuseColor = color;
    material.emissiveColor = color.scale(0.25);
    material.specularColor = Color3.Black();

    this.mesh = CreateCapsule(
      name,
      { radius: UNIT_RADIUS, height: UNIT_HEIGHT, tessellation: 8, capSubdivisions: 2 },
      scene,
    );
    this.mesh.material = material;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.doNotSyncBoundingInfo = true;

    this.matrices = new Float32Array(capacity * FLOATS_PER_MATRIX);
    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, FLOATS_PER_MATRIX, false);
    this.mesh.thinInstanceCount = 0;
    // Hidden until something commits instances into it; see `commit`.
    this.mesh.setEnabled(false);
  }

  setInstance(
    index: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    scale: number,
    _animationId: string,
    _timeOffset: number,
    _speed = 1,
  ): void {
    // The capsule's origin is its centre, the crowd contract's is the feet.
    scratchScale.set(scale, scale, scale);
    Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, scratchRotation);
    scratchTranslation.set(x, y + (UNIT_HEIGHT / 2) * scale, z);
    Matrix.ComposeToRef(scratchScale, scratchRotation, scratchTranslation, scratchMatrix);
    this.matrices.set(scratchMatrix.m, index * FLOATS_PER_MATRIX);
  }

  setCount(count: number): void {
    this.count = Math.max(0, Math.min(this.capacity, Math.floor(count)));
  }

  commit(): void {
    // Disabled when empty, for the reason `VatCrowd.commit` explains: a zero
    // count sends the mesh down the non-instanced path.
    this.mesh.thinInstanceCount = this.count;
    this.mesh.setEnabled(this.count > 0);
    if (this.count > 0) this.mesh.thinInstanceBufferUpdated('matrix');
  }

  update(_dt: number): void {
    // No clock to advance: nothing here animates.
  }

  durationOf(_animationId: string): number {
    return 0.5;
  }

  dispose(): void {
    this.mesh.material?.dispose();
    this.mesh.dispose();
  }
}
