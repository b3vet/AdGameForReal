/**
 * The KayKit skeleton rig, as Babylon's `Ragdoll` wants to see it.
 *
 * Three things about that class shape everything here.
 *
 *   1. **The skeleton's root bone must be in the config.** `Ragdoll` refuses to
 *      build its joints unless `skeleton.getChildren()` — the bones with no
 *      bone parent — has exactly one entry *and* that entry appears in the
 *      config. On this rig that bone is `root`, which sits on the floor between
 *      the feet, so it gets a two-centimetre anchor box rather than a real one.
 *      Its box position is also what the whole character is drawn from, so its
 *      `boxOffset` must stay zero or the corpse floats.
 *   2. **Box extents are world-axis-aligned at build time, not bone-aligned.**
 *      The class only ever sets a box's rotation to `boneRotation *
 *      inverse(boneRotationWhenBuilt)`, which is the identity at build time. We
 *      build every ragdoll posed mid-walk, where the limbs hang roughly along
 *      world Y, so limb boxes are tall and thin rather than long and thin.
 *   3. **`boxOffset` is in metres along the bone's local Y**, which on a
 *      Blender-authored rig points at the child bone. Half a segment's length
 *      therefore centres the box on the segment.
 *
 * Sizes are half the KayKit rest-pose segment lengths times the manifest scale
 * (0.35), so a box is the limb it stands for. Nothing here is drawn: the visible
 * corpse is the skinned mesh, and these boxes only decide how it tumbles.
 */

import { Axis } from '@babylonjs/core/Maths/math.axis';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PhysicsConstraintType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import type { RagdollBoneProperties } from '@babylonjs/core/Physics/v2/ragdoll';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import type { Scene } from '@babylonjs/core/scene';

/**
 * What `Ragdoll` actually reads out of a config entry. The shipped
 * `RagdollBoneProperties` declares only half of it — `bone`, `bones`, `mass`,
 * `restitution` and `putBoxInBoneCenter` are used by the implementation and
 * missing from the typings — so the array is declared with this shape and cast
 * once, on the way in, rather than every entry being an `as` expression.
 */
export interface RagdollBoneConfig {
  bone: string;
  width?: number;
  height?: number;
  depth?: number;
  size?: number;
  mass?: number;
  restitution?: number;
  joint?: PhysicsConstraintType;
  rotationAxis?: Vector3;
  boxOffset?: number;
  boneOffsetAxis?: Vector3;
}

const BALL = PhysicsConstraintType.BALL_AND_SOCKET;
const HINGE = PhysicsConstraintType.HINGE;

/**
 * Eleven bodies: the anchor, pelvis, torso, head, and four limb segments a
 * side. Fewer than a hero ragdoll would use, because a corpse here is forty
 * pixels tall and there are up to twenty-four of them.
 */
export const RAGDOLL_BONES: readonly RagdollBoneConfig[] = [
  // The required root. Tiny and light so it barely takes part in collisions,
  // but it is the bone the corpse's world position is read from.
  { bone: 'root', size: 0.02, mass: 0.05, joint: BALL },
  { bone: 'hips', width: 0.16, height: 0.1, depth: 0.1, mass: 0.5, joint: BALL },
  // Spine to shoulder: 0.509 model units, centred 0.254 above the spine bone.
  { bone: 'spine', width: 0.16, height: 0.178, depth: 0.09, mass: 0.6, boxOffset: 0.089, joint: BALL },
  { bone: 'head', size: 0.1, mass: 0.3, boxOffset: 0.04, joint: BALL },

  { bone: 'upperarm.l', width: 0.045, height: 0.085, depth: 0.045, mass: 0.12, boxOffset: 0.042, joint: BALL },
  { bone: 'lowerarm.l', width: 0.04, height: 0.091, depth: 0.04, mass: 0.1, boxOffset: 0.045, joint: HINGE, rotationAxis: Axis.X },
  { bone: 'upperarm.r', width: 0.045, height: 0.085, depth: 0.045, mass: 0.12, boxOffset: 0.042, joint: BALL },
  { bone: 'lowerarm.r', width: 0.04, height: 0.091, depth: 0.04, mass: 0.1, boxOffset: 0.045, joint: HINGE, rotationAxis: Axis.X },

  { bone: 'upperleg.l', width: 0.055, height: 0.079, depth: 0.055, mass: 0.2, boxOffset: 0.04, joint: BALL },
  // Shin plus foot, so the corpse has something to land on.
  { bone: 'lowerleg.l', width: 0.05, height: 0.093, depth: 0.06, mass: 0.15, boxOffset: 0.046, joint: HINGE, rotationAxis: Axis.X },
  { bone: 'upperleg.r', width: 0.055, height: 0.079, depth: 0.055, mass: 0.2, boxOffset: 0.04, joint: BALL },
  { bone: 'lowerleg.r', width: 0.05, height: 0.093, depth: 0.06, mass: 0.15, boxOffset: 0.046, joint: HINGE, rotationAxis: Axis.X },
];

/** Index of the `root` entry: the aggregate the whole corpse is placed from. */
export const RAGDOLL_ROOT_INDEX = 0;

/** The cast the missing typings force. Kept in one place, with the reason. */
export function ragdollConfig(): RagdollBoneProperties[] {
  return RAGDOLL_BONES as unknown as RagdollBoneProperties[];
}

/**
 * Merges a character's parts into one skinned mesh — one draw call per corpse
 * instead of the eight KayKit ships.
 *
 * This is deliberately *not* `loadCharacterAsset`'s merge. That one folds the
 * glTF right-to-left-hand flip into the vertices because a thin instance cannot
 * inherit the loader's `__root__` node; the flip is matched by a conjugation
 * baked into the VAT. A ragdoll is skinned live from a real skeleton whose
 * matrices carry no such conjugation, so the vertices have to stay exactly as
 * the loader read them and the mirror has to go instead: the ragdoll's root has
 * a plain positive scale, which leaves `Ragdoll`'s quaternion maths working in
 * an unmirrored frame. The character comes out left-right mirrored, which on a
 * symmetric skeleton is invisible, and the triangles are wound back here
 * because a mirror reverses them.
 */
export function mergeSkinnedParts(scene: Scene, name: string, sources: readonly Mesh[]): Mesh {
  const parts: VertexData[] = [];
  for (const source of sources) {
    const data = VertexData.ExtractFromMesh(source, false, true);
    reverseWinding(data);
    parts.push(data);
  }

  const first = parts[0];
  if (first === undefined) throw new Error(`${name}: nothing to merge`);
  const merged = parts.length === 1 ? first : first.merge(parts.slice(1), true);

  const mesh = new Mesh(name, scene);
  merged.applyToMesh(mesh, false);
  mesh.material = materialOf(sources);
  mesh.numBoneInfluencers = 4;
  mesh.isPickable = false;
  return mesh;
}

/** Bones move the corpse far from where its geometry says it is. */
export function untrackBounds(mesh: Mesh): void {
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
}

/** Every KayKit body part shares one material; take the first that has one. */
function materialOf(sources: readonly Mesh[]): Mesh['material'] {
  for (const source of sources) {
    if (source.material !== null) return source.material;
  }
  return null;
}

function reverseWinding(data: VertexData): void {
  const indices = data.indices;
  if (indices === null || indices === undefined) return;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const swap = indices[i] ?? 0;
    indices[i] = indices[i + 2] ?? 0;
    indices[i + 2] = swap;
  }
}

/** Every mesh named by the manifest's `body` list, narrowed to `Mesh`. */
export function bodyMeshes(meshes: readonly { name: string }[], names: readonly string[]): Mesh[] {
  return names.map((name) => {
    const found = meshes.find((each) => each.name === name);
    if (!(found instanceof Mesh)) throw new Error(`model has no mesh "${name}"`);
    return found;
  });
}

/** `Skeleton` is re-exported so the pool does not need a second import path. */
export type { Skeleton };
