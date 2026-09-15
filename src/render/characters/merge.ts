/**
 * Turning a loaded KayKit character into one skinned, un-mirrored mesh.
 *
 * Split out of `./asset.ts` in Milestone 8 Phase E for the file-size rule
 * (CLAUDE.md), on the seam that file's own header already names: loading is
 * fetching a `.glb` and a baked texture and handing back an asset, and this is
 * the *geometry surgery* in the middle of it — the merge, the re-skin and the
 * un-mirror, three rules about vertex buffers that know nothing about assets.
 *
 * Three things happen here that are not obvious:
 *
 *   1. **Merge.** KayKit splits a character into eight or ten meshes (body,
 *      head, jaw, limbs, cloak, hat). All of them share one material, so they
 *      are merged into a single mesh: a crowd of 500 is then one draw call
 *      instead of ten.
 *   2. **Re-skin.** The hat, the cape and each staff are *not* skinned — they
 *      are plain meshes parented to a bone. Bones do not exist once the
 *      animation is baked, so each one is rewritten as a skinned mesh with all
 *      of its weight on that bone, in the mage's rest pose, and then merged in
 *      like the rest. That is why a staff costs no extra draw call and why one
 *      baked texture serves all three staffs.
 *   3. **Un-mirror.** Babylon's glTF loader converts right-handed glTF to its
 *      own left-handed world with a `__root__` node scaled `-1` on x. A thin
 *      instance cannot inherit that node, so the flip is folded into the
 *      vertices here (and into the baked matrices in `scripts/bake-vat.mjs`),
 *      with the triangle winding reversed to match.
 *
 * The physics layer needs two of them as well (`src/physics/rig.ts`): a ragdoll
 * is skinned live rather than from a baked texture, so it cannot use the merge
 * here — but a hat parented to a bone has to become a weighted vertex either
 * way, and that rule may only exist once.
 */

import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';

import type { TintPatch } from '@/data/assets-types';

import type { ModelAsset } from './manifest';
import { tintColors } from './tint';

/**
 * Where one source mesh's vertices ended up in the merged mesh, so a part can
 * be re-tinted after the merge (D53: a hat and a cape are cosmetics).
 */
export interface PartRange {
  /** First vertex of this part in the merged buffers. */
  start: number;
  count: number;
}

/** `undefined` and `null` both mean "this mesh has no such attribute". */
function array(data: Float32Array | number[] | null | undefined): Float32Array | null {
  if (data === null || data === undefined) return null;
  return data instanceof Float32Array ? data : Float32Array.from(data);
}

/** Uniform scale about the origin of the part's own local space. */
function scaleAbout(positions: Float32Array, scale: number): void {
  for (let i = 0; i < positions.length; i++) positions[i] = (positions[i] ?? 0) * scale;
}

/** The glTF right-handed to Babylon left-handed flip, as a plain x negation. */
function unmirror(data: Float32Array): void {
  for (let i = 0; i < data.length; i += 3) data[i] = -(data[i] ?? 0);
}

/**
 * Merges the source meshes into one skinned `VertexData` in the rig's bind
 * space, re-skinning any mesh that is parented to a bone rather than skinned.
 *
 * The manifest's `tints` and `tintPatches` recolour single parts, and single
 * patches of the atlas inside a part, on the way in (`./tint.ts`). Every part
 * gets a colour attribute, white unless the manifest names it:
 * `VertexData.merge` needs the same attributes on every part, and a white
 * multiplier is the source texture unchanged.
 */
export function mergeCharacter(
  sources: readonly Mesh[],
  skeleton: Skeleton,
  model: ModelAsset,
): { data: VertexData; colors: Float32Array | null; parts: Map<string, PartRange> } {
  const parts: VertexData[] = [];
  const ranges = new Map<string, PartRange>();
  let vertices = 0;
  const boneIndex = new Map(skeleton.bones.map((bone, index) => [bone.name, index]));
  const bindInverse = bindSpaceInverse(sources);
  const tints = model.tints;
  const patches: Record<string, readonly TintPatch[]> | undefined = model.tintPatches;
  const anyTint =
    (tints !== undefined && Object.keys(tints).length > 0) ||
    (patches !== undefined && Object.keys(patches).length > 0);

  for (const source of sources) {
    // `ExtractFromMesh` leaves an absent attribute `undefined` rather than
    // `null`, so every check here has to treat the two the same.
    const data = VertexData.ExtractFromMesh(source, false, true);
    const positions = array(data.positions);
    if (positions === null || data.indices === null || data.indices === undefined) continue;

    // Before the re-skin, so the shrink happens in the part's *own* local
    // space, about its node origin — which for the hat is where it sits on the
    // head, so a 0.8 hat keeps its grip and loses only brim.
    const partScale = model.partScales?.[source.name];
    if (partScale !== undefined && partScale !== 1) scaleAbout(positions, partScale);

    if (array(data.matricesIndices) === null || array(data.matricesWeights) === null) {
      reskinToParentBone(data, source, boneIndex, bindInverse);
    }

    unmirror(positions);
    const normals = array(data.normals);
    if (normals !== null) unmirror(normals);
    reverseWinding(data);
    const count = positions.length / 3;
    if (anyTint) {
      data.colors = tintColors(
        count,
        tints?.[source.name],
        patches?.[source.name],
        array(data.uvs),
      );
    }
    // Where this part landed, so a cosmetic can find its hat again (D53). The
    // merge below concatenates in this order, which is what makes the running
    // count the part's first vertex.
    ranges.set(source.name, { start: vertices, count });
    vertices += count;
    parts.push(data);
  }

  const first = parts[0];
  if (first === undefined) throw new Error('nothing to merge');
  const data = parts.length === 1 ? first : first.merge(parts.slice(1), true);
  return { data, colors: array(data.colors), parts: ranges };
}

/** World-to-bind transform, taken from the first genuinely skinned source. */
export function bindSpaceInverse(sources: readonly Mesh[]): Matrix {
  for (const source of sources) {
    if (source.skeleton === null) continue;
    source.computeWorldMatrix(true);
    return source.getWorldMatrix().clone().invert();
  }
  return Matrix.Identity();
}

/**
 * Rewrites an unskinned accessory as a mesh weighted entirely to the bone it
 * hangs off. Its vertices move into the rig's bind space first, where the
 * bone's baked matrix is the identity, so the pose it was authored in is the
 * pose it keeps.
 */
export function reskinToParentBone(
  data: VertexData,
  source: Mesh,
  boneIndex: ReadonlyMap<string, number>,
  bindInverse: Matrix,
): void {
  let node = source.parent;
  let index: number | undefined;
  while (node !== null && index === undefined) {
    index = boneIndex.get(node.name);
    if (index === undefined) node = node.parent;
  }
  if (index === undefined) throw new Error(`"${source.name}" is not parented to a bone`);

  source.computeWorldMatrix(true);
  const toBind = source.getWorldMatrix().multiply(bindInverse);

  const positions = array(data.positions);
  if (positions === null) throw new Error(`"${source.name}" has no positions`);
  const scratch = new Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    scratch.set(positions[i] ?? 0, positions[i + 1] ?? 0, positions[i + 2] ?? 0);
    const moved = Vector3.TransformCoordinates(scratch, toBind);
    positions[i] = moved.x;
    positions[i + 1] = moved.y;
    positions[i + 2] = moved.z;
  }
  const normals = array(data.normals);
  if (normals !== null) {
    for (let i = 0; i < normals.length; i += 3) {
      scratch.set(normals[i] ?? 0, normals[i + 1] ?? 0, normals[i + 2] ?? 0);
      const moved = Vector3.TransformNormal(scratch, toBind).normalize();
      normals[i] = moved.x;
      normals[i + 1] = moved.y;
      normals[i + 2] = moved.z;
    }
  }

  const count = positions.length / 3;
  const indices = new Float32Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    indices[i * 4] = index;
    weights[i * 4] = 1;
  }
  data.positions = positions;
  data.normals = normals;
  data.matricesIndices = indices;
  data.matricesWeights = weights;
}

/** A mirror flips handedness, so the triangles have to be wound back. */
function reverseWinding(data: VertexData): void {
  const indices = data.indices;
  if (indices === null || indices === undefined) return;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const swap = indices[i] ?? 0;
    indices[i] = indices[i + 2] ?? 0;
    indices[i + 2] = swap;
  }
}

