/**
 * Thin-instance matrix helpers.
 *
 * Everything that moves every frame — squad units, corpses, projectiles — is a
 * thin instance of one mesh, so the per-frame cost is a few writes into a
 * Float32Array and one buffer upload, with no allocation at all. The matrices
 * we need are scale-plus-translation only, so we write the seven live slots
 * directly instead of building `Matrix` objects.
 */

import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
// Side-effect import: this is what puts `thinInstance*` on `Mesh.prototype`.
import '@babylonjs/core/Meshes/thinInstanceMesh';

export const FLOATS_PER_MATRIX = 16;

/** Allocates a zero-filled matrix buffer and binds it to `mesh` as dynamic. */
export function createMatrixBuffer(mesh: Mesh, capacity: number): Float32Array {
  const buffer = new Float32Array(capacity * FLOATS_PER_MATRIX);
  mesh.thinInstanceSetBuffer('matrix', buffer, FLOATS_PER_MATRIX, false);
  mesh.thinInstanceCount = 0;
  // Thin-instance bounds are not tracked as the buffer changes, so let the mesh
  // skip frustum culling rather than have instances vanish at the screen edge.
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.isPickable = false;
  mesh.doNotSyncBoundingInfo = true;
  return buffer;
}

/**
 * Writes an axis-aligned scale + translation matrix at `index`. The rotation
 * slots of the buffer stay zero for the buffer's whole life, which is exactly
 * what an unrotated matrix wants.
 */
export function writeInstance(
  buffer: Float32Array,
  index: number,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
  x: number,
  y: number,
  z: number,
): void {
  const o = index * FLOATS_PER_MATRIX;
  buffer[o] = scaleX;
  buffer[o + 5] = scaleY;
  buffer[o + 10] = scaleZ;
  buffer[o + 12] = x;
  buffer[o + 13] = y;
  buffer[o + 14] = z;
  buffer[o + 15] = 1;
}

/** Reused by `writeRotatedInstance`, which is also a per-frame hot path. */
const scratchMatrix = Matrix.Identity();
const scratchScale = Vector3.One();
const scratchRotation = Quaternion.Identity();
const scratchTranslation = Vector3.Zero();

/**
 * The same write with a yaw, for the few things that are not axis-aligned — a
 * chain arc between two blocks, an impact spark thrown at a random angle.
 */
export function writeRotatedInstance(
  buffer: Float32Array,
  index: number,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
  yaw: number,
  x: number,
  y: number,
  z: number,
): void {
  scratchScale.set(scaleX, scaleY, scaleZ);
  Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, scratchRotation);
  scratchTranslation.set(x, y, z);
  Matrix.ComposeToRef(scratchScale, scratchRotation, scratchTranslation, scratchMatrix);
  buffer.set(scratchMatrix.m, index * FLOATS_PER_MATRIX);
}

/**
 * Publishes `count` instances, and disables the mesh when there are none.
 *
 * The disable is not an optimisation. Babylon's `hasThinInstances` is
 * `instancesCount > 0`, so a mesh whose count drops to zero falls off the
 * instanced path and draws *one* copy of itself at the world origin — a stray
 * bolt in the middle of the crowd, or a three-metre mage standing on the road.
 * Every pool here empties at some point, so the rule lives in one place.
 */
export function commitInstances(mesh: Mesh, count: number): void {
  mesh.thinInstanceCount = count;
  mesh.setEnabled(count > 0);
  if (count > 0) mesh.thinInstanceBufferUpdated('matrix');
}
