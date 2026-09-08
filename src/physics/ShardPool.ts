/**
 * A pool of sixty-four boxes: frost shatter, gate glass and the ring the boss
 * throws when it dies.
 *
 * Bodies and drawing are separate here. Each shard's Havok body hangs off an
 * invisible `TransformNode` — nothing is drawn from it — and every frame the
 * live shards of one size are copied into that size's thin-instance buffer. So
 * sixty-four live shards cost three draw calls (one per shape) instead of the
 * sixty-four they cost in Phase B3, which is what brought a level-1 frame with
 * debris from 66 draw calls back under the plan's budget.
 *
 * A thin instance has no material of its own, so the tint that used to live on
 * a per-shard `StandardMaterial` is a per-instance colour buffer, and the fade
 * that used to be `mesh.visibility` is a shrink to nothing — the same trick the
 * spell effects use, and the same reason: an instance cannot fade alone.
 *
 * Recycling is the same trick the ragdoll pool uses: the body's prestep type is
 * `TELEPORT`, so writing the transform node's position moves the body, and a
 * parked shard is an `ANIMATED` body pinned under the world.
 */

import type { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { PhysicsMotionType, PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import type { PhysicsBody } from '@babylonjs/core/Physics/v2/physicsBody';
import type { Scene } from '@babylonjs/core/scene';

import { FLOATS_PER_MATRIX, commitInstances, createMatrixBuffer } from '@/render/instanceBuffer';

import {
  PARK_SPACING,
  PARK_Y,
  SHARD_EMISSIVE,
  SHARD_FADE,
  SHARD_FRICTION,
  SHARD_LIFE,
  SHARD_RESTITUTION,
  SHARD_SIZES,
} from './tuning';

interface Slot {
  readonly node: TransformNode;
  readonly body: PhysicsBody;
  /** Index into `SHARD_SIZES`, which is also the mesh it is drawn with. */
  readonly size: number;
  readonly parkX: number;
  readonly tint: { r: number; g: number; b: number };
  live: boolean;
  frozen: boolean;
  age: number;
  spawned: number;
}

/** One drawn shape: the mesh every shard of that size is an instance of. */
interface ShardMesh {
  readonly mesh: Mesh;
  readonly material: StandardMaterial;
  readonly matrices: Float32Array;
  readonly colors: Float32Array;
  live: number;
}

const FLOATS_PER_COLOR = 4;

const scratchVelocity = new Vector3();
const scratchSpin = new Vector3();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchMatrix = Matrix.Identity();
const ZERO = Vector3.Zero();

export class ShardPool {
  private readonly slots: Slot[] = [];
  private readonly shapes: ShardMesh[] = [];
  private ticket = 0;
  private liveCount = 0;

  constructor(scene: Scene, readonly capacity: number) {
    for (let size = 0; size < SHARD_SIZES.length; size++) {
      this.shapes.push(buildShape(scene, size, capacity));
    }
    for (let i = 0; i < capacity; i++) {
      // Round robin, so every shape has a third of the pool and a burst of one
      // kind never has to steal from another.
      this.slots.push(buildSlot(scene, i, i % SHARD_SIZES.length));
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
    slot.tint.r = tint.r;
    slot.tint.g = tint.g;
    slot.tint.b = tint.b;

    const node = slot.node;
    node.position.set(x, y, z);
    Quaternion.RotationYawPitchRollToRef(spin, spin * 0.7, spin * 1.3, scratchQuaternion);
    if (node.rotationQuaternion === null) node.rotationQuaternion = scratchQuaternion.clone();
    else node.rotationQuaternion.copyFrom(scratchQuaternion);

    scratchVelocity.set(dx, up, dz);
    scratchSpin.set(spin * 2, spin, -spin * 1.5);
    slot.body.setMotionType(PhysicsMotionType.DYNAMIC);
    slot.body.setLinearVelocity(scratchVelocity);
    slot.body.setAngularVelocity(scratchSpin);

    slot.live = true;
    slot.frozen = false;
    slot.age = 0;
    slot.spawned = ++this.ticket;
    this.liveCount++;
  }

  /** Ages every live shard and rewrites the three instance buffers. */
  update(dt: number): void {
    for (const shape of this.shapes) shape.live = 0;

    // Indexed rather than `for...of`: this and `push` are the two loops that
    // run every frame, and CLAUDE.md asks the hot ones not to allocate.
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot === undefined || !slot.live) continue;
      slot.age += dt;

      let scale = 1;
      if (slot.age >= SHARD_LIFE) {
        const progress = (slot.age - SHARD_LIFE) / SHARD_FADE;
        if (progress >= 1) {
          this.park(slot);
          continue;
        }
        if (!slot.frozen) {
          slot.frozen = true;
          freeze(slot);
        }
        // A thin instance cannot fade on its own, so it shrinks out instead.
        scale = 1 - progress;
      }

      this.draw(slot, scale);
    }

    for (const shape of this.shapes) {
      commitInstances(shape.mesh, shape.live);
      if (shape.live > 0) shape.mesh.thinInstanceBufferUpdated('color');
    }
  }

  push(x: number, z: number, radius: number, impulse: number, up: number): void {
    const radiusSquared = radius * radius;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot === undefined || !slot.live || slot.frozen) continue;
      const at = slot.node.position;
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
    for (const shape of this.shapes) {
      shape.live = 0;
      commitInstances(shape.mesh, 0);
    }
  }

  dispose(): void {
    for (const slot of this.slots) {
      slot.body.dispose();
      slot.node.dispose();
    }
    this.slots.length = 0;
    for (const shape of this.shapes) {
      shape.material.dispose();
      shape.mesh.dispose(false, false);
    }
    this.shapes.length = 0;
    this.liveCount = 0;
  }

  /** Copies one live shard's body transform into its shape's buffers. */
  private draw(slot: Slot, scale: number): void {
    const shape = this.shapes[slot.size];
    if (shape === undefined || shape.live >= this.capacity) return;

    const node = slot.node;
    scratchScale.set(scale, scale, scale);
    Matrix.ComposeToRef(
      scratchScale,
      node.rotationQuaternion ?? scratchQuaternion,
      node.position,
      scratchMatrix,
    );
    shape.matrices.set(scratchMatrix.m, shape.live * FLOATS_PER_MATRIX);

    const offset = shape.live * FLOATS_PER_COLOR;
    shape.colors[offset] = slot.tint.r;
    shape.colors[offset + 1] = slot.tint.g;
    shape.colors[offset + 2] = slot.tint.b;
    shape.colors[offset + 3] = 1;
    shape.live++;
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
    slot.node.position.set(slot.parkX, PARK_Y, 0);
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

/** One mesh per shard shape, drawn as thin instances tinted per shard. */
function buildShape(scene: Scene, size: number, capacity: number): ShardMesh {
  const shape = SHARD_SIZES[size];
  if (shape === undefined) throw new Error(`no shard size ${String(size)}`);

  const mesh = CreateBox(
    `shard_shape_${String(size)}`,
    { width: shape.width, height: shape.height, depth: shape.depth },
    scene,
  );
  const material = new StandardMaterial(`shard_mat_${String(size)}`, scene);
  // White here, coloured per instance: the shader multiplies both the lit and
  // the emissive term by the instance colour, so one material serves every tint.
  material.specularColor.set(0.25, 0.25, 0.3);
  material.emissiveColor.set(SHARD_EMISSIVE, SHARD_EMISSIVE, SHARD_EMISSIVE);
  mesh.material = material;

  const matrices = createMatrixBuffer(mesh, capacity);
  const colors = new Float32Array(capacity * FLOATS_PER_COLOR);
  mesh.thinInstanceSetBuffer('color', colors, FLOATS_PER_COLOR, false);
  commitInstances(mesh, 0);

  return { mesh, material, matrices, colors, live: 0 };
}

/** One body on an invisible node: nothing here is drawn, only simulated. */
function buildSlot(scene: Scene, index: number, size: number): Slot {
  const shape = SHARD_SIZES[size];
  if (shape === undefined) throw new Error(`no shard size ${String(size)}`);

  const node = new TransformNode(`shard_${String(index)}`, scene);
  node.rotationQuaternion = Quaternion.Identity();

  const parkX = index * PARK_SPACING;
  node.position.set(parkX, PARK_Y, 0);

  const aggregate = new PhysicsAggregate(
    node,
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
    node,
    body: aggregate.body,
    size,
    parkX,
    tint: { r: 1, g: 1, b: 1 },
    live: false,
    frozen: false,
    age: 0,
    spawned: 0,
  };
  freeze(slot);
  return slot;
}
