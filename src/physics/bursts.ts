/**
 * What each kind of debris looks like: where the corpses and the chips go.
 *
 * Split out of `PhysicsLayer` in Milestone 3, when the stream bodies gave it a
 * sixth burst to describe. The layer owns Havok, the pools and the routing from
 * sim events; this owns the shape of a burst and nothing else — it never sees
 * an event, the scene or the sim, only a position and a quality rung.
 *
 * It carries the layer's RNG, which is seeded and is never the sim's
 * (CLAUDE.md): a dropped or re-rolled corpse changes how a kill *looks*, and
 * the bots and the balance tests cannot see it either way.
 */

import type { Color3 } from '@babylonjs/core/Maths/math.color';

import { mulberry32 } from '@/sim';
import type { GateKind } from '@/sim';

import type { RagdollPool } from './RagdollPool';
import type { ShardPool } from './ShardPool';
import {
  BOSS_SHARDS,
  BOSS_TINT,
  GATE_PANEL_CENTER_Y,
  GATE_PANEL_HALF_WIDTH,
  GLASS_SHARDS,
  ICE_TINT,
  RAGDOLLS_PER_KILL,
  RAGDOLL_PUSH_JITTER,
  RAGDOLL_PUSH_SPEED,
  RAGDOLL_PUSH_UP,
  RAGDOLL_SPIN,
  RAGDOLL_SPREAD,
  SHARD_PANEL,
  SHARD_PUSH_SPEED,
  SHARD_PUSH_UP,
  SHARD_SIZES,
  SHARD_SPIN,
  SHATTER_SHARDS,
  STREAM_PUSH_SCALE,
  gateTint,
} from './tuning';

/** The layer's own RNG seed, kept here with the code that draws from it. */
const RNG_SEED = 0x5eed_1e55;

export class DebrisBursts {
  private readonly random = mulberry32(RNG_SEED);

  constructor(
    private readonly ragdolls: RagdollPool,
    private readonly shards: ShardPool,
  ) {}

  /**
   * A block falls over: a ring of corpses thrown away from the squad that
   * killed it. `(dx, dz)` is that direction, from `awayFrom`.
   */
  kill(x: number, z: number, dx: number, dz: number, quality: number): void {
    const count = RAGDOLLS_PER_KILL[quality] ?? 0;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + this.random() * 0.6;
      const radius = RAGDOLL_SPREAD * (0.4 + this.random() * 0.6);
      const jitter = 1 + (this.random() - 0.5) * RAGDOLL_PUSH_JITTER;
      const speed = RAGDOLL_PUSH_SPEED * jitter;
      this.ragdolls.spawn(
        x + Math.cos(angle) * radius,
        z + Math.sin(angle) * radius,
        Math.atan2(dx, dz) + (this.random() - 0.5),
        dx * speed + (this.random() - 0.5) * 0.8,
        dz * speed + (this.random() - 0.5) * 0.8,
        RAGDOLL_PUSH_UP * (0.7 + this.random() * 0.6),
        (this.random() - 0.5) * 2 * RAGDOLL_SPIN,
      );
    }
  }

  /**
   * One stream body falls over where it stood (D29).
   *
   * Not an effect that may be dropped: the renderer skips exactly these bodies'
   * baked deaths, so without it a tenth of every stream blinks out. One corpse
   * rather than a block's ring of six, and thrown softer — a single grunt shot
   * off its feet topples, it does not explode.
   */
  streamFall(x: number, z: number, dx: number, dz: number): void {
    const jitter = 1 + (this.random() - 0.5) * RAGDOLL_PUSH_JITTER;
    const speed = RAGDOLL_PUSH_SPEED * STREAM_PUSH_SCALE * jitter;
    this.ragdolls.spawn(
      x,
      z,
      Math.atan2(dx, dz) + (this.random() - 0.5),
      dx * speed + (this.random() - 0.5) * 0.5,
      dz * speed + (this.random() - 0.5) * 0.5,
      RAGDOLL_PUSH_UP * STREAM_PUSH_SCALE * (0.7 + this.random() * 0.6),
      (this.random() - 0.5) * 2 * RAGDOLL_SPIN,
    );
  }

  /** A frozen block comes apart: ice-blue chips, radial. */
  shatter(x: number, z: number, quality: number): void {
    this.ring(x, 0.35, z, SHATTER_SHARDS[quality] ?? 0, 0, ICE_TINT, 1);
  }

  /** The boss goes down: a wider, slower ring of violet debris. */
  boss(x: number, z: number, quality: number): void {
    this.ring(x, 0.8, z, BOSS_SHARDS[quality] ?? 0, 1, BOSS_TINT, 1.5);
  }

  /** The panel breaks where the squad went through it, tinted by its kind. */
  glass(x: number, z: number, kind: GateKind, quality: number): void {
    const count = GLASS_SHARDS[quality] ?? 0;
    const tint = gateTint(kind);
    for (let i = 0; i < count; i++) {
      const across = (this.random() * 2 - 1) * GATE_PANEL_HALF_WIDTH;
      this.shards.spawn(
        SHARD_PANEL,
        tint,
        x + across,
        GATE_PANEL_CENTER_Y + (this.random() - 0.5) * 0.8,
        z,
        // Glass falls out of the frame it was in rather than being thrown, so
        // the push is a nudge outward from the panel's centre and a little
        // forward, in the direction the squad went through it.
        across * 0.5,
        (this.random() - 0.4) * SHARD_PUSH_UP * 0.3,
        -0.4 - this.random() * 0.8,
        (this.random() - 0.5) * 2 * SHARD_SPIN,
      );
    }
  }

  /** `count` shards thrown outward from `(x, y, z)`. */
  private ring(
    x: number,
    y: number,
    z: number,
    count: number,
    sizeBias: number,
    tint: Color3,
    speedMul: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + this.random() * 0.5;
      const speed = SHARD_PUSH_SPEED * speedMul * (0.6 + this.random() * 0.8);
      this.shards.spawn(
        (sizeBias + i) % (SHARD_SIZES.length - 1),
        tint,
        x + Math.cos(angle) * 0.15,
        y + this.random() * 0.2,
        z + Math.sin(angle) * 0.15,
        Math.cos(angle) * speed,
        SHARD_PUSH_UP * (0.5 + this.random() * 0.8),
        Math.sin(angle) * speed,
        (this.random() - 0.5) * 2 * SHARD_SPIN,
      );
    }
  }
}
