/**
 * The simplifier's rules about skinning (`./simplify.ts`): which vertices bend
 * alike enough to merge, and which may not move at all.
 *
 * Split out of `./simplify.ts` for the file-size rule (CLAUDE.md).
 */

import type { SimplifyInput } from './simplify';
import { LOCKED } from './simplifyMesh';

/**
 * How different two vertices' bone weights may be and still merge: the summed
 * difference over every bone, 0 for two vertices bound alike and 2 for two
 * bound to different bones entirely.
 */
export const SKIN_TOLERANCE = 0.25;
/**
 * How different a neighbour's binding has to be for a vertex to be pinned
 * where it is (`lockSkinSeams`): less than half of it shared. KayKit blends its
 * limbs smoothly, a little per vertex, and pinning every blend would keep half
 * the mesh; the hard boundaries between parts are what must not move.
 */
const SKIN_SEAM = 1;

/**
 * Pins every point that shares a triangle with a vertex bound very differently.
 *
 * The quadric only knows the rest pose, where the line two bones meet along
 * is as flat as anything else; slide a vertex off it and the band that bends
 * gets wider, which shows the moment the unit moves. So those points stay,
 * and the parts either side of them thin as usual.
 */
export function lockSkinSeams(
  input: SimplifyInput,
  tris: readonly number[],
  point: Int32Array,
  fans: readonly (readonly number[])[],
  kind: Uint8Array,
): void {
  for (let p = 0; p < kind.length; p++) {
    if (kind[p] === LOCKED) continue;
    let locked = false;
    for (const t of fans[p] ?? []) {
      let mine = -1;
      for (let k = 0; k < 3; k++) {
        const c = tris[t * 3 + k] ?? 0;
        if (point[c] === p) mine = c;
      }
      for (let k = 0; k < 3 && !locked; k++) {
        const c = tris[t * 3 + k] ?? 0;
        if (point[c] !== p && skinDistance(input, mine, c) > SKIN_SEAM) locked = true;
      }
      if (locked) break;
    }
    if (locked) kind[p] = LOCKED;
  }
}

/**
 * Summed difference in bone weights between two vertices, bone by bone. A
 * slot with no weight binds nothing, whatever index it carries — KayKit's
 * one-bone vertices fill their three empty slots with bone 0 — and a bone
 * listed twice is one bone.
 */
export function skinDistance(input: SimplifyInput, a: number, b: number): number {
  let distance = 0;
  for (let i = 0; i < 4; i++) {
    const bone = boundBone(input, a, i);
    if (bone >= 0) distance += Math.abs(weightOf(input, a, bone) - weightOf(input, b, bone));
  }
  for (let i = 0; i < 4; i++) {
    const bone = boundBone(input, b, i);
    if (bone >= 0 && weightOf(input, a, bone) === 0) distance += weightOf(input, b, bone);
  }
  return distance;
}

/** The bone slot `i` of vertex `v` binds, or -1 if it is empty or a repeat. */
function boundBone(input: SimplifyInput, v: number, i: number): number {
  if ((input.boneWeights[v * 4 + i] ?? 0) === 0) return -1;
  const bone = input.boneIndices[v * 4 + i] ?? 0;
  for (let j = 0; j < i; j++) {
    if ((input.boneWeights[v * 4 + j] ?? 0) !== 0 && input.boneIndices[v * 4 + j] === bone) return -1;
  }
  return bone;
}

function weightOf(input: SimplifyInput, v: number, bone: number): number {
  let weight = 0;
  for (let i = 0; i < 4; i++) {
    if ((input.boneIndices[v * 4 + i] ?? -1) === bone) weight += input.boneWeights[v * 4 + i] ?? 0;
  }
  return weight;
}
