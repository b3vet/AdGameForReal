/**
 * Thin-instance matrix helpers.
 *
 * Everything that moves every frame — squad units, corpses, projectiles — is a
 * thin instance of one mesh, so the per-frame cost is a few writes into a
 * Float32Array and one buffer upload, with no allocation at all. The matrices
 * we need are scale-plus-translation only, so we write the seven live slots
 * directly instead of building `Matrix` objects.
 */

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

/** Publishes `count` instances; uploading nothing when there is nothing to draw. */
export function commitInstances(mesh: Mesh, count: number): void {
  mesh.thinInstanceCount = count;
  if (count > 0) mesh.thinInstanceBufferUpdated('matrix');
}
