/**
 * A pool of sixty-four boxes: frost shatter, gate glass and the ring the boss
 * throws when it dies.
 *
 * They are separate meshes rather than thin instances of one, because a shard
 * has to be teleported, coloured and faded on its own, and Havok's instanced
 * bodies share a motion type across every instance. Sixty-four live shards is
 * therefore sixty-four draw calls; they live 1.5 s, and the degrade ladder is
 * what stops that mattering on a slow device.
 *
 * Recycling is the same trick the ragdoll pool uses: the body's prestep type is
 * `TELEPORT`, so writing the transform node's position moves the body, and a
 * parked shard is an `ANIMATED` body pinned under the world.
 */

import type { Color3 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PhysicsMotionType, PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import type { PhysicsBody } from '@babylonjs/core/Physics/v2/physicsBody';
import type { Scene } from '@babylonjs/core/scene';

import {
  PARK_SPACING,
  PARK_Y,
  SHARD_FADE,
  SHARD_FRICTION,
  SHARD_LIFE,
  SHARD_RESTITUTION,
  SHARD_SIZES,
} from './tuning';

interface Slot {
  readonly mesh: Mesh;
  readonly body: PhysicsBody;
  readonly material: StandardMaterial;
  /** Index into `SHARD_SIZES`; a spawn asks for the shape it wants. */
  readonly size: number;
  readonly parkX: number;
  live: boolean;
  frozen: boolean;
  age: number;
  spawned: number;
}

const scratchVelocity = new Vector3();
const scratchSpin = new Vector3();
const scratchQuaternion = new Quaternion();
const ZERO = Vector3.Zero();

export class ShardPool {
  private readonly slots: Slot[] = [];
  private ticket = 0;
  private liveCount = 0;

  constructor(scene: Scene, readonly capacity: number) {
    for (let i = 0; i < capacity; i++) {
      // Round robin, so every shape has a third of the pool and a burst of one
      // kind never has to steal from another.
      const size = i % SHARD_SIZES.length;
      this.slots.push(buildSlot(scene, i, size));
    }
  }

  get count(): number {
    return this.liveCount;
  }

  get bodyCount(): number {
    return this.liveCount;
  }

  /**
   * Throws one shard from `(x, y, z)` along `(dx, up, dz)`.
   *
   * The velocity is set rather than an impulse applied, because the body has
   * only just been teleported and Havok has not seen the new transform yet: an
   * impulse would take its torque from where the shard used to be.
   */
  spawn(
    size: number,
    tint: Color3,
    x: number,
    y: number,
    z: number,
    dx: number,
    up: number,
    dz: number,
    spin: number,
  ): void {
    const slot = this.acquire(size);
    slot.material.diffuseColor.copyFrom(tint);
    slot.material.emissiveColor.copyFrom(tint).scaleInPlace(0.45);

    const node = slot.body.transformNode;
    node.position.set(x, y, z);
    Quaternion.RotationYawPitchRollToRef(spin, spin * 0.7, spin * 1.3, scratchQuaternion);
    if (node.rotationQuaternion === null) node.rotationQuaternion = scratchQuaternion.clone();
    else node.rotationQuaternion.copyFrom(scratchQuaternion);

    scratchVelocity.set(dx, up, dz);
    scratchSpin.set(spin * 2, spin, -spin * 1.5);
    slot.body.setMotionType(PhysicsMotionType.DYNAMIC);
    slot.body.setLinearVelocity(scratchVelocity);
    slot.body.setAngularVelocity(scratchSpin);

    slot.mesh.setEnabled(true);
    slot.mesh.visibility = 1;
    slot.live = true;
    slot.frozen = false;
    slot.age = 0;
    slot.spawned = ++this.ticket;
    this.liveCount++;
  }

  update(dt: number): void {
    // Indexed rather than `for...of`: this and `push` are the two loops that
    // run every frame, and CLAUDE.md asks the hot ones not to allocate.
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot === undefined || !slot.live) continue;
      slot.age += dt;
      if (slot.age < SHARD_LIFE) continue;
      const progress = (slot.age - SHARD_LIFE) / SHARD_FADE;
      if (progress >= 1) {
        this.park(slot);
        continue;
      }
      if (!slot.frozen) {
        slot.frozen = true;
        freeze(slot);
      }
      slot.mesh.visibility = 1 - progress;
    }
  }

  push(x: number, z: number, radius: number, impulse: number, up: number): void {
    const radiusSquared = radius * radius;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot === undefined || !slot.live || slot.frozen) continue;
      const at = slot.body.transformNode.position;
      const dx = at.x - x;
      const dz = at.z - z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared > radiusSquared) continue;
      const distance = Math.max(0.001, Math.sqrt(distanceSquared));
      const falloff = 1 - distance / radius;
      scratchVelocity.set(
        (dx / distance) * impulse * falloff,
        up * impulse * falloff,
        (dz / distance) * impulse * falloff,
      );
      slot.body.applyImpulse(scratchVelocity, at);
    }
  }

  reset(): void {
    for (const slot of this.slots) {
      if (slot.live) this.park(slot);
    }
  }


  dispose(): void {
    for (const slot of this.slots) {
      slot.body.dispose();
      slot.material.dispose();
      slot.mesh.dispose(false, false);
    }
    this.slots.length = 0;
    this.liveCount = 0;
  }

  /**
   * A free slot of the shape asked for; then any free slot, because the wrong
   * shape reads better than cutting a live shard short; then the oldest live
   * one, which is the cap being enforced rather than a failure.
   */
  private acquire(size: number): Slot {
    let free: Slot | undefined;
    let oldestOfSize: Slot | undefined;
    let oldest: Slot | undefined;
    for (const slot of this.slots) {
      if (!slot.live) {
        if (slot.size === size) return slot;
        free ??= slot;
        continue;
      }
      if (slot.size === size && (oldestOfSize === undefined || slot.spawned < oldestOfSize.spawned)) {
        oldestOfSize = slot;
      }
      if (oldest === undefined || slot.spawned < oldest.spawned) oldest = slot;
    }
    const chosen = free ?? oldestOfSize ?? oldest;
    if (chosen === undefined) throw new Error('shard pool is empty');
    if (chosen.live) this.liveCount--;
    return chosen;
  }

  private park(slot: Slot): void {
    freeze(slot);
    slot.body.transformNode.position.set(slot.parkX, PARK_Y, 0);
    slot.mesh.setEnabled(false);
    if (slot.live) this.liveCount--;
    slot.live = false;
    slot.frozen = false;
  }
}

function freeze(slot: Slot): void {
  slot.body.setLinearVelocity(ZERO);
  slot.body.setAngularVelocity(ZERO);
  slot.body.setMotionType(PhysicsMotionType.ANIMATED);
}

function buildSlot(scene: Scene, index: number, size: number): Slot {
  const shape = SHARD_SIZES[size];
  if (shape === undefined) throw new Error(`no shard size ${String(size)}`);

  const mesh = CreateBox(
    `shard_${String(index)}`,
    { width: shape.width, height: shape.height, depth: shape.depth },
    scene,
  );
  const material = new StandardMaterial(`shard_mat_${String(index)}`, scene);
  material.specularColor.set(0.25, 0.25, 0.3);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.rotationQuaternion = Quaternion.Identity();
  mesh.setEnabled(false);

  const parkX = index * PARK_SPACING;
  mesh.position.set(parkX, PARK_Y, 0);

  const aggregate = new PhysicsAggregate(
    mesh,
    PhysicsShapeType.BOX,
    {
      mass: shape.mass,
      friction: SHARD_FRICTION,
      restitution: SHARD_RESTITUTION,
      extents: new Vector3(shape.width, shape.height, shape.depth),
    },
    scene,
  );
  // Teleporting is how a shard is recycled, so the body has to read its node.
  aggregate.body.disablePreStep = false;

  const slot: Slot = {
    mesh,
    body: aggregate.body,
    material,
    size,
    parkX,
    live: false,
    frozen: false,
    age: 0,
    spawned: 0,
  };
  freeze(slot);
  return slot;
}
