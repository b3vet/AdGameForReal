/**
 * A pool of skinned skeleton ragdolls.
 *
 * Babylon's `Ragdoll` is one-way: `ragdoll()` unlinks the bones from the glTF
 * transform nodes and turns the boxes dynamic, and there is no method that puts
 * it back. So the pool never leaves ragdoll mode. Every slot is built, posed and
 * ragdolled once during `create`, and its resting layout — where each box sits
 * relative to the root box — is recorded as the slot's template. Reviving a slot
 * is then teleporting its boxes back onto that template at the kill's position
 * and handing them a velocity; recycling is freezing them and parking them under
 * the world. Nothing is allocated after `create`.
 *
 * Each slot is posed at a different frame of the walk cycle before its boxes are
 * built, so twenty-four corpses do not all start from the same silhouette.
 */

import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PhysicsMotionType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import type { PhysicsBody } from '@babylonjs/core/Physics/v2/physicsBody';
import { Ragdoll } from '@babylonjs/core/Physics/v2/ragdoll';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';
// Side-effect import: registers the glTF 2.0 loader with `ImportMeshAsync`.
import '@babylonjs/loaders/glTF/2.0';

import { modelAsset, resolveAssetUrl } from '@/render/characters';
import { RAGDOLL_BONES, RAGDOLL_ROOT_INDEX, bodyMeshes, mergeSkinnedParts, ragdollConfig, untrackBounds } from './rig';
import {
  PARK_SPACING,
  PARK_Y,
  RAGDOLL_FADE,
  RAGDOLL_LIFE,
  RAGDOLL_LIFT,
  RAGDOLL_SINK,
} from './tuning';

interface Slot {
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

/** Reused every frame and every spawn: this class allocates nothing after `create`. */
const scratchYaw = Matrix.Identity();
const scratchVector = new Vector3();
const scratchVelocity = new Vector3();
const scratchSpin = new Vector3();
const scratchQuaternion = new Quaternion();
const ZERO = Vector3.Zero();

export class RagdollPool {
  private readonly slots: Slot[] = [];
  private ticket = 0;
  private liveCount = 0;
  /** One material for all twenty-four corpses; fading uses `mesh.visibility`. */
  private material: Material | null = null;

  private constructor(readonly capacity: number) {}

  /**
   * Loads the minion once, then clones the merged mesh and the skeleton per
   * slot. The skeleton clone keeps the source's link to the glTF transform
   * nodes, which is exactly what makes the per-slot pose work: pose the source,
   * clone, build the boxes from that pose, then `ragdoll()` cuts the link and
   * freezes the clone there.
   */
  static async create(scene: Scene, capacity: number, modelId: string): Promise<RagdollPool> {
    const pool = new RagdollPool(capacity);
    const model = modelAsset(modelId);
    if (model.body === undefined) throw new Error(`asset "${modelId}" declares no body meshes`);

    const loaded = await ImportMeshAsync(resolveAssetUrl(modelId), scene);
    const skeleton = loaded.skeletons[0];
    if (skeleton === undefined) throw new Error(`${modelId} has no skeleton`);
    for (const group of loaded.animationGroups) group.stop();

    const walkName = model.animations['walk'];
    const walk = loaded.animationGroups.find((group) => group.name === walkName);
    if (walk === undefined) throw new Error(`${modelId} has no clip "${String(walkName)}"`);

    const scale = model.scale ?? 1;
    const template = mergeSkinnedParts(scene, `${modelId}:ragdoll`, bodyMeshes(loaded.meshes, model.body));
    template.setEnabled(false);

    // `goToFrame` only moves a group that has been started; pausing it keeps
    // the frame we ask for instead of running on (same trick as bake-vat.mjs).
    walk.play(false);
    walk.pause();

    for (let i = 0; i < capacity; i++) {
      walk.goToFrame(walk.from + ((i + 0.5) / capacity) * (walk.to - walk.from));
      skeleton.prepare(true);
      pool.slots.push(buildSlot(template, skeleton, scale, i));
    }
    pool.material = template.material;

    walk.stop();
    for (const group of loaded.animationGroups) group.dispose();
    template.dispose();
    // The loader's own meshes, transform nodes and skeleton have done their
    // job; every slot owns an independent copy now.
    for (const mesh of loaded.meshes) mesh.dispose(false, false);
    for (const node of loaded.transformNodes) node.dispose(false, false);
    skeleton.dispose();

    return pool;
  }

  get count(): number {
    return this.liveCount;
  }

  get bodyCount(): number {
    return this.liveCount * RAGDOLL_BONES.length;
  }

  /**
   * Drops one corpse at `(x, z)` facing `yaw`, moving along `(dx, 0, dz)` at
   * `speed` with `up` of lift and `spin` of tumble.
   */
  spawn(
    x: number,
    z: number,
    yaw: number,
    dx: number,
    dz: number,
    up: number,
    spin: number,
  ): void {
    const slot = this.acquire();
    Matrix.RotationYToRef(yaw, scratchYaw);
    Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, scratchQuaternion);
    scratchVelocity.set(dx, up, dz);
    scratchSpin.set(spin, spin * 0.4, -spin);

    for (let i = 0; i < slot.bodies.length; i++) {
      const body = slot.bodies[i];
      const offset = slot.template[i];
      if (body === undefined || offset === undefined) continue;
      Vector3.TransformCoordinatesToRef(offset, scratchYaw, scratchVector);
      const node = body.transformNode;
      node.position.set(x + scratchVector.x, RAGDOLL_LIFT + scratchVector.y, z + scratchVector.z);
      setQuaternion(node, scratchQuaternion);
      body.setMotionType(PhysicsMotionType.DYNAMIC);
      body.setLinearVelocity(scratchVelocity);
      body.setAngularVelocity(scratchSpin);
    }

    slot.mesh.setEnabled(true);
    slot.mesh.visibility = 1;
    slot.ragdoll.pauseSync = false;
    slot.live = true;
    slot.sinking = false;
    slot.age = 0;
    slot.spawned = ++this.ticket;
    this.liveCount++;
  }

  /** Ages every live corpse, sinks the expired ones and recycles the finished. */
  update(dt: number): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot === undefined || !slot.live) continue;
      slot.age += dt;
      if (slot.age < RAGDOLL_LIFE) continue;

      const progress = (slot.age - RAGDOLL_LIFE) / RAGDOLL_FADE;
      if (progress >= 1) {
        this.park(slot, i);
        continue;
      }
      if (!slot.sinking) {
        slot.sinking = true;
        freeze(slot);
      }
      slot.mesh.visibility = 1 - progress;
      const drop = (RAGDOLL_SINK * dt) / RAGDOLL_FADE;
      for (let j = 0; j < slot.bodies.length; j++) {
        const body = slot.bodies[j];
        if (body !== undefined) body.transformNode.position.y -= drop;
      }
    }
  }

  /**
   * Shoves every simulating box within `radius` of `(x, z)` away from it.
   * `impulse` is scaled by how close the box is to the centre.
   */
  push(x: number, z: number, radius: number, impulse: number, up: number): void {
    const radiusSquared = radius * radius;
    // Indexed: `update` and `push` are the per-frame loops (CLAUDE.md).
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot === undefined || !slot.live || slot.sinking) continue;
      for (let j = 0; j < slot.bodies.length; j++) {
        const body = slot.bodies[j];
        if (body === undefined) continue;
        const at = body.transformNode.position;
        const dx = at.x - x;
        const dz = at.z - z;
        const distanceSquared = dx * dx + dz * dz;
        if (distanceSquared > radiusSquared) continue;
        const falloff = 1 - Math.sqrt(distanceSquared) / radius;
        const spread = Math.max(0.001, Math.sqrt(distanceSquared));
        scratchVelocity.set(
          (dx / spread) * impulse * falloff,
          up * impulse * falloff,
          (dz / spread) * impulse * falloff,
        );
        body.applyImpulse(scratchVelocity, at);
      }
    }
  }

  /** Recycles every live corpse at once: a level change, or quality dropping. */
  reset(): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot !== undefined && slot.live) this.park(slot, i);
    }
  }

  dispose(): void {
    for (const slot of this.slots) {
      slot.ragdoll.dispose();
      slot.mesh.dispose(false, false);
      slot.skeleton.dispose();
    }
    this.slots.length = 0;
    this.liveCount = 0;
    // Shared by every slot, so it is disposed once rather than per mesh.
    this.material?.dispose(true, true);
    this.material = null;
  }

  /** A free slot, or the one that has been on the ground longest. */
  private acquire(): Slot {
    let oldest: Slot | undefined;
    for (const slot of this.slots) {
      if (!slot.live) return slot;
      if (oldest === undefined || slot.spawned < oldest.spawned) oldest = slot;
    }
    // The pool is never empty, so this is the cap being enforced, not a failure.
    if (oldest === undefined) throw new Error('ragdoll pool is empty');
    this.liveCount--;
    return oldest;
  }

  private park(slot: Slot, index: number): void {
    freeze(slot);
    const parkX = index * PARK_SPACING;
    for (let i = 0; i < slot.bodies.length; i++) {
      const body = slot.bodies[i];
      const offset = slot.template[i];
      if (body === undefined || offset === undefined) continue;
      body.transformNode.position.set(parkX + offset.x, PARK_Y + offset.y, offset.z);
    }
    slot.mesh.setEnabled(false);
    slot.ragdoll.pauseSync = true;
    if (slot.live) this.liveCount--;
    slot.live = false;
    slot.sinking = false;
  }
}

/** Stops the simulation for a slot without leaving ragdoll mode. */
function freeze(slot: Slot): void {
  for (const body of slot.bodies) {
    body.setLinearVelocity(ZERO);
    body.setAngularVelocity(ZERO);
    body.setMotionType(PhysicsMotionType.ANIMATED);
  }
}

function setQuaternion(node: { rotationQuaternion: Quaternion | null }, value: Quaternion): void {
  if (node.rotationQuaternion === null) node.rotationQuaternion = value.clone();
  else node.rotationQuaternion.copyFrom(value);
}

function buildSlot(template: Mesh, source: Skeleton, scale: number, index: number): Slot {
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
