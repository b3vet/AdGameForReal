/**
 * One corpse of a `RagdollPool`: a cloned mesh and skeleton, the Havok boxes
 * Babylon's `Ragdoll` built for it, and the resting layout they are revived
 * onto.
 *
 * Split out of `./RagdollPool.ts` for the file-size rule (CLAUDE.md) when the
 * pool learnt to tell Havok which boxes it moved (`./prestep.ts`); the pool is
 * what a slot's life looks like, and this is how one is made.
 */

import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PhysicsMotionType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import type { PhysicsBody } from '@babylonjs/core/Physics/v2/physicsBody';
import { Ragdoll } from '@babylonjs/core/Physics/v2/ragdoll';

import { RAGDOLL_BONES, RAGDOLL_ROOT_INDEX, ragdollConfig, untrackBounds } from './rig';
import { PARK_SPACING, PARK_Y } from './tuning';

export interface Slot {
  readonly mesh: Mesh;
  readonly skeleton: Skeleton;
  readonly ragdoll: Ragdoll;
  readonly bodies: PhysicsBody[];
  /** Box positions in the build pose, relative to the root box. */
  readonly template: Vector3[];
  live: boolean;
  /** True once the corpse has stopped simulating and is sinking out of sight. */
  sinking: boolean;
  age: number;
  /** Monotonic spawn ticket, so "recycle the oldest" is one comparison. */
  spawned: number;
}

const ZERO = Vector3.Zero();

/** Stops the simulation for a slot without leaving ragdoll mode. */
export function freeze(slot: Slot): void {
  for (const body of slot.bodies) {
    body.setLinearVelocity(ZERO);
    body.setAngularVelocity(ZERO);
    body.setMotionType(PhysicsMotionType.ANIMATED);
  }
}

export function setQuaternion(node: { rotationQuaternion: Quaternion | null }, value: Quaternion): void {
  if (node.rotationQuaternion === null) node.rotationQuaternion = value.clone();
  else node.rotationQuaternion.copyFrom(value);
}

export function buildSlot(template: Mesh, source: Skeleton, scale: number, index: number): Slot {
  const skeleton = source.clone(`ragdoll_skeleton_${String(index)}`);
  const mesh = template.clone(`ragdoll_${String(index)}`);
  mesh.skeleton = skeleton;
  mesh.numBoneInfluencers = 4;
  mesh.scaling.setAll(scale);
  mesh.position.setAll(0);
  mesh.rotationQuaternion = Quaternion.Identity();
  untrackBounds(mesh);
  mesh.setEnabled(false);
  // `Ragdoll` reads the root's world matrix while it places the boxes.
  mesh.computeWorldMatrix(true);

  const ragdoll = new Ragdoll(skeleton, mesh, ragdollConfig());
  ragdoll.ragdoll();

  const bodies: PhysicsBody[] = [];
  for (let i = 0; i < RAGDOLL_BONES.length; i++) bodies.push(ragdoll.getAggregate(i).body);

  const root = bodies[RAGDOLL_ROOT_INDEX];
  if (root === undefined) throw new Error('ragdoll has no root aggregate');
  const origin = root.transformNode.position;
  const layout = bodies.map((body) => body.transformNode.position.subtract(origin));

  const slot: Slot = {
    mesh,
    skeleton,
    ragdoll,
    bodies,
    template: layout,
    live: false,
    sinking: false,
    age: 0,
    spawned: 0,
  };
  freeze(slot);
  ragdoll.pauseSync = true;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const offset = layout[i];
    if (body === undefined || offset === undefined) continue;
    body.transformNode.position.set(
      index * PARK_SPACING + offset.x,
      PARK_Y + offset.y,
      offset.z,
    );
  }
  return slot;
}
