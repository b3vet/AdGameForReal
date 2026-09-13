/**
 * The KayKit Dungeon Remastered pieces (D39) and how they are put together.
 *
 * Five pieces carry every stone structure Milestone 5 adds — the gate arches,
 * the lane walls and the boss arena — and they all paint out of one atlas
 * (`dungeon_texture`, embedded in each `.glb`). That is what makes an assembly
 * possible: several pieces can be baked into *one* mesh sharing *one* material,
 * so a whole arch is a single thin instance and a whole row of them a single
 * draw call.
 *
 * Everything here happens once, at load. Nothing in this file runs per frame.
 */

import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { loadStaticMesh, meshExtent } from './models';

/** One piece of an assembly: which source mesh, and where it goes. */
export interface Part {
  /** A mesh from `loadDungeonPieces`. Cloned, never consumed. */
  source: Mesh;
  /** Metres per model unit, per axis. The pieces are authored in metres. */
  scale: Vector3;
  /** Yaw about the road's up axis, and roll about its forward axis. Roll is
   *  what lays a piece along the curve of an arch. */
  yaw?: number;
  roll?: number;
  position: Vector3;
}

/**
 * Loads the named manifest models as static meshes, skipping any that fail.
 *
 * Fail-soft like every other loader in `./models.ts`: a build whose `/assets/`
 * never arrived draws the road without its stonework rather than not at all.
 *
 * **Every piece comes back mirrored in x.** `loadStaticMesh` bakes the glTF
 * loader's right-to-left-handed flip into the vertices, so a piece the artist
 * authored from x = 0 to x = 2 arrives spanning -2 to 0. It costs nothing on
 * the symmetric pieces (the pillar, the column) and it is a sign flip on the
 * ones authored from a corner — the parapet, which is both the arch's crown and
 * the lane wall's run.
 */
export async function loadDungeonPieces(
  scene: Scene,
  ids: readonly string[],
): Promise<Map<string, Mesh>> {
  const loaded = await Promise.all(ids.map(async (id) => loadStaticMesh(scene, id, id)));
  const pieces = new Map<string, Mesh>();
  ids.forEach((id, index) => {
    const mesh = loaded[index];
    if (mesh === null || mesh === undefined) return;
    mesh.setEnabled(false);
    pieces.set(id, mesh);
  });
  return pieces;
}

/**
 * Bakes `parts` into one mesh, in the first part's material.
 *
 * The pieces share an atlas, so the merged mesh's UVs still land on the right
 * patch of it whichever piece's material carries them — which is the whole
 * reason an arch is one draw call rather than three.
 *
 * The sources are cloned rather than moved: the same `column` is the arch's leg
 * and the lane wall's post, and each assembly wants it at its own scale.
 */
export function assemble(name: string, parts: readonly Part[]): Mesh | null {
  if (parts.length === 0) return null;
  const clones: Mesh[] = [];
  for (const part of parts) {
    const clone = part.source.clone(`${name}-part`);
    clone.setEnabled(true);
    // A Babylon clone *shares* its source's geometry, and `bakeTransformIntoVertices`
    // writes through to it — so without this every part of an assembly scrambles
    // every other part and the source, and a seven-block arch comes out as three
    // stray boxes. The unique copy is thrown away with the clone in the merge.
    clone.makeGeometryUnique();
    const rotation = Quaternion.RotationYawPitchRoll(part.yaw ?? 0, 0, part.roll ?? 0);
    clone.bakeTransformIntoVertices(
      Matrix.Compose(part.scale, rotation, part.position),
    );
    clones.push(clone);
  }

  const merged =
    clones.length === 1 ? (clones[0] ?? null) : Mesh.MergeMeshes(clones, true, true);
  if (merged === null) return null;
  merged.name = name;
  merged.setEnabled(false);
  merged.isPickable = false;
  merged.alwaysSelectAsActiveMesh = true;
  merged.doNotSyncBoundingInfo = true;
  return merged;
}

/** The uniform scale that makes `mesh` exactly `metres` tall. */
export function scaleToHeight(mesh: Mesh, metres: number): number {
  const height = meshExtent(mesh).y;
  return height > 0.001 ? metres / height : 1;
}

/** A scale vector, so callers do not allocate one per part at a call site. */
export function scale3(x: number, y: number, z: number): Vector3 {
  return new Vector3(x, y, z);
}

/** Shorthand for a part's position; same reason as `scale3`. */
export function at(x: number, y: number, z: number): Vector3 {
  return new Vector3(x, y, z);
}
