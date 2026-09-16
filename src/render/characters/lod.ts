/**
 * The small-on-screen copy of a character: its geometry, and the mesh it is
 * drawn with (docs/28, note 5).
 *
 * `./simplify.ts` picks which triangles survive; this file turns that into a
 * mesh the crowd can draw beside the full one. The copy shares everything
 * that is not geometry — the material, the rig, the baked texture and its
 * clock — so it compiles no new shader and animates in step with the full
 * mesh: a unit that changes from one to the other changes its polygon count
 * and nothing else.
 *
 * How much is kept is a trade measured by eye and by frame time
 * (`quality.json`, `crowd`): at a third of the triangles, and a surface moved by
 * at most 2 percent of the character's size — a centimetre and a half on a
 * mage — the copy is indistinguishable from the original at the sizes the
 * crowd draws it at (`./crowdDraw.ts`), and the GPU time the crowd costs falls
 * roughly in proportion.
 */

import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { BakedVertexAnimationManager } from '@babylonjs/core/BakedVertexAnimation/bakedVertexAnimationManager';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import type { Material } from '@babylonjs/core/Materials/material';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';

import { simplifyIndices } from './simplify';
import { qualityTuning } from '@/data';
/**
 * Below this saving a second mesh is not worth its draw call: a character the
 * rules cannot thin (all seams) keeps drawing whole.
 */
const LOD_MIN_SAVING = 0.25;

/** The copy's vertex data, and where each of its vertices came from. */
export interface LodGeometry {
  data: VertexData;
  /** Full-mesh vertex index of every copy vertex, for re-tinting it. */
  order: Uint32Array;
}

type Attribute = 'positions' | 'normals' | 'tangents' | 'uvs' | 'uvs2' | 'colors' |
  'matricesIndices' | 'matricesWeights';

const ATTRIBUTES: readonly (readonly [Attribute, number])[] = [
  ['positions', 3],
  ['normals', 3],
  ['tangents', 4],
  ['uvs', 2],
  ['uvs2', 2],
  ['colors', 4],
  ['matricesIndices', 4],
  ['matricesWeights', 4],
];

/**
 * The simplified copy of a merged character, or null when there is nothing
 * to gain (no skin, or too little to take away).
 */
export function buildLodGeometry(full: VertexData): LodGeometry | null {
  const positions = full.positions;
  const indices = full.indices;
  const boneIndices = full.matricesIndices;
  const boneWeights = full.matricesWeights;
  if (!positions || !indices || !boneIndices || !boneWeights) return null;

  const attributes: { data: ArrayLike<number>; stride: number }[] = [];
  for (const [name, stride] of ATTRIBUTES) {
    if (name === 'positions' || name === 'matricesIndices' || name === 'matricesWeights') continue;
    const data = full[name];
    if (data) attributes.push({ data, stride });
  }

  const kept = simplifyIndices(
    { positions, indices, attributes, boneIndices, boneWeights },
    { ratio: qualityTuning.crowd.lodRatio, maxError: qualityTuning.crowd.lodMaxError },
  );
  if (kept.length > indices.length * (1 - LOD_MIN_SAVING)) return null;

  const vertexCount = positions.length / 3;
  const compact = compactVertices(kept, vertexCount);
  const data = new VertexData();
  for (const [name, stride] of ATTRIBUTES) {
    const source = full[name];
    if (!source) continue;
    data[name] = pick(source, compact.order, stride);
  }
  // The original's index width, whatever the copy needs: Babylon compiles a
  // 32-bit index buffer into a shader variant of its own, and a copy that
  // differed would cost a program the warm-up has to build.
  data.indices = indices instanceof Uint32Array ? compact.indices : Uint16Array.from(compact.indices);
  return { data, order: compact.order };
}

/** `source`'s values for the listed vertices, in that order, into `out` if given. */
export function pick(
  source: ArrayLike<number>,
  order: Uint32Array,
  stride: number,
  out: Float32Array = new Float32Array(order.length * stride),
): Float32Array {
  for (let i = 0; i < order.length; i++) {
    const from = (order[i] ?? 0) * stride;
    for (let k = 0; k < stride; k++) out[i * stride + k] = source[from + k] ?? 0;
  }
  return out;
}

/** What the copy shares with the full mesh. */
export interface LodShared {
  material: Material | null;
  skeleton: Skeleton;
  manager: BakedVertexAnimationManager;
  numBoneInfluencers: number;
}

/**
 * The copy as a mesh, set up the way `./asset.ts` sets up the full one. The
 * colour buffer is updatable for the same reason the full mesh's is: a
 * cosmetic re-tints both (`VatCrowd.setPartTints`).
 */
export function createLodMesh(scene: Scene, name: string, lod: LodGeometry, shared: LodShared): Mesh {
  const mesh = new Mesh(name, scene);
  // Off until the crowd has instances for it, like the full mesh.
  mesh.setEnabled(false);
  lod.data.applyToMesh(mesh, false);
  const colors = lod.data.colors;
  if (colors) mesh.setVerticesData(VertexBuffer.ColorKind, colors, true);
  mesh.material = shared.material;
  mesh.skeleton = shared.skeleton;
  mesh.numBoneInfluencers = shared.numBoneInfluencers;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  mesh.bakedVertexAnimationManager = shared.manager;
  return mesh;
}

/**
 * The vertices `indices` uses, in first-use order, and the indices rewritten to
 * point at them: what a mesh is built from once the triangles are chosen.
 */
export function compactVertices(
  indices: ArrayLike<number>,
  vertexCount: number,
): { order: Uint32Array; indices: Uint32Array } {
  const remap = new Int32Array(vertexCount).fill(-1);
  const order: number[] = [];
  const out = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i] ?? 0;
    let next = remap[v] ?? -1;
    if (next < 0) {
      next = order.length;
      remap[v] = next;
      order.push(v);
    }
    out[i] = next;
  }
  return { order: Uint32Array.from(order), indices: out };
}
