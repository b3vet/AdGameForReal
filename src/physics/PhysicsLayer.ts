/**
 * Presentation-only Havok layer: ragdolls, shards and the road they land on.
 *
 * Decision D18: this consumes sim events and sim state and never writes either,
 * and the sim never reads physics. Determinism, the bots and the balance tests
 * are therefore untouched by anything in here — a dropped ragdoll changes how
 * a kill *looks* and nothing else.
 *
 * Call order per frame, from whoever owns the scene:
 *
 *   run.tick(dt) -> layer.onEvents(events, state) -> layer.update(dt) -> scene.render()
 *
 * `scene.render()` is what steps Havok, so `update` has to come before it: it
 * writes the frame's teleports and recycles, and the step reads them.
 */

import type { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
// Side-effect imports: `joinedPhysicsEngineComponent` is what puts
// `enablePhysics` on `Scene.prototype` — without it the call silently returns
// false; the v2 component is what wires bodies to their transform nodes.
import '@babylonjs/core/Physics/joinedPhysicsEngineComponent';
import '@babylonjs/core/Physics/v2/physicsEngineComponent';
import type { Scene } from '@babylonjs/core/scene';

import HavokPhysics from '@babylonjs/havok';
// Vite serves the WASM as a URL; `locateFile` overrides emscripten's default,
// which would look for it next to the pre-bundled module. The single-file
// builds hand the same loader a base64 `wasmBinary` instead (plan, "Asset
// delivery in builds"), which is why the URL is never written by hand.
import havokWasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';

import { laneCenter, mulberry32 } from '@/sim';
import type { GateKind, LevelDef, RunState, SimEvent } from '@/sim';

import { FrameBudget } from './degrade';
import { GroundCollider } from './ground';
import { RagdollPool } from './RagdollPool';
import { ShardPool } from './ShardPool';
import {
  BOSS_SHARDS,
  BOSS_TINT,
  GATE_PANEL_CENTER_Y,
  GATE_PANEL_HALF_WIDTH,
  GLASS_SHARDS,
  GROUND_PAST_ARENA,
  GROUND_START_Z,
  ICE_TINT,
  RAGDOLLS_PER_KILL,
  RAGDOLL_CAPACITY,
  RAGDOLL_PUSH_JITTER,
  RAGDOLL_PUSH_SPEED,
  RAGDOLL_PUSH_UP,
  RAGDOLL_SPIN,
  RAGDOLL_SPREAD,
  SHARD_CAPACITY,
  SHARD_PANEL,
  SHARD_PUSH_SPEED,
  SHARD_PUSH_UP,
  SHARD_SIZES,
  SHARD_SPIN,
  SHATTER_SHARDS,
  STOMP_IMPULSE,
  STOMP_RADIUS,
  STOMP_UP,
  gateTint,
} from './tuning';

export type PhysicsQuality = 0 | 1 | 2;

export interface PhysicsLayerOptions {
  /** 2 = full, 1 = reduced, 0 = off. 0 at construction skips Havok entirely. */
  quality?: PhysicsQuality;
  /** Which model the corpses are made of. Defaults to the grunt skeleton. */
  ragdollModelId?: string;
}

export interface PhysicsStats {
  ragdolls: number;
  shards: number;
  bodies: number;
  quality: number;
}

/** The layer's own RNG, seeded and never shared with the sim's (CLAUDE.md). */
const RNG_SEED = 0x5eed_1e55;

const scratchDirection = new Vector3();

export class PhysicsLayer {
  readonly stats: PhysicsStats = { ragdolls: 0, shards: 0, bodies: 0, quality: 0 };

  private readonly scene: Scene;
  private readonly ragdollModelId: string;
  private readonly random = mulberry32(RNG_SEED);

  private quality: PhysicsQuality;
  private ragdolls: RagdollPool | null = null;
  private shards: ShardPool | null = null;
  private ground: GroundCollider | null = null;
  private plugin: HavokPlugin | null = null;
  private ready = false;
  private disposed = false;

  private readonly budget = new FrameBudget();

  /**
   * Enemy ids that shattered this batch. A frost kill emits `enemyKilled` and
   * then `enemyShattered` for the same block, and a frozen block comes apart
   * rather than falling over, so the kill's ragdolls are suppressed. Fixed
   * length because `onEvents` may not allocate.
   */
  private readonly shattered = new Int32Array(64);
  private shatteredCount = 0;

  constructor(scene: Scene, options: PhysicsLayerOptions = {}) {
    this.scene = scene;
    this.quality = options.quality ?? 2;
    this.ragdollModelId = options.ragdollModelId ?? 'skeleton_minion';
    this.stats.quality = this.quality;
  }

  /**
   * Loads Havok, turns physics on for the scene and builds both pools. At
   * quality 0 it does none of that: the layer stays constructed and inert, so a
   * device that cannot afford physics does not pay for the WASM either. Quality
   * never climbs on its own, so nothing later needs what was skipped.
   */
  async init(): Promise<void> {
    if (this.disposed || this.ready || this.quality === 0) return;

    const havok = await HavokPhysics({ locateFile: () => havokWasmUrl });
    if (this.disposed) return;

    // `false` means a fixed step rather than the frame's delta: a hitch or a
    // SwiftShader frame then runs the debris in slow motion instead of firing
    // one 100 ms step that flings every ragdoll through the road.
    const plugin = new HavokPlugin(false, havok);
    plugin.setTimeStep(1 / 60);
    if (this.scene.getPhysicsEngine() === null) {
      if (!this.scene.enablePhysics(new Vector3(0, -9.81, 0), plugin)) {
        throw new Error('scene.enablePhysics refused the Havok plugin');
      }
      this.plugin = plugin;
    }

    this.shards = new ShardPool(this.scene, SHARD_CAPACITY);
    this.ragdolls = await RagdollPool.create(this.scene, RAGDOLL_CAPACITY, this.ragdollModelId);
    if (this.disposed) {
      this.shards.dispose();
      this.ragdolls.dispose();
      this.shards = null;
      this.ragdolls = null;
      return;
    }
    this.ready = true;
  }

  /** Builds the road collider for this level and empties both pools. */
  loadLevel(level: LevelDef): void {
    if (this.disposed || !this.ready) return;
    this.ground?.dispose();
    this.ground = new GroundCollider(
      this.scene,
      GROUND_START_Z,
      level.arenaZ + GROUND_PAST_ARENA,
    );
    this.ragdolls?.reset();
    this.shards?.reset();
  }

  /**
   * Turns one tick's events into debris.
   *
   * What it reads out of `state`: `squad.x` and `squad.z` for the direction a
   * corpse is thrown, `gates` for the lane and z of the panel that just broke,
   * and `boss` as the fallback position for `bossKilled`, which carries none.
   */
  onEvents(events: readonly SimEvent[], state: RunState): void {
    if (!this.ready || this.quality === 0) return;

    this.shatteredCount = 0;
    for (const event of events) {
      if (event.type === 'enemyShattered' && this.shatteredCount < this.shattered.length) {
        this.shattered[this.shatteredCount++] = event.enemyId;
      }
    }

    let bossDone = false;
    for (const event of events) {
      switch (event.type) {
        case 'enemyKilled':
          if (event.kind === 'boss') {
            if (!bossDone) this.bossBurst(event.x, event.z);
            bossDone = true;
          } else if (!this.wasShattered(event.enemyId)) {
            this.killBurst(event.x, event.z, state);
          }
          break;
        case 'bossKilled':
          if (!bossDone) {
            const boss = state.boss;
            this.bossBurst(boss?.x ?? state.squad.x, boss?.z ?? state.arenaZ);
            bossDone = true;
          }
          break;
        case 'enemyShattered':
          this.shatterBurst(event.x, event.z);
          break;
        case 'gatePassed':
          this.glassBurst(event.gateId, event.kind, state);
          break;
        case 'bossStomp':
          this.ragdolls?.push(event.x, event.z, STOMP_RADIUS, STOMP_IMPULSE, STOMP_UP);
          this.shards?.push(event.x, event.z, STOMP_RADIUS, STOMP_IMPULSE, STOMP_UP);
          break;
        default:
          // Everything else is the renderer's, the UI's or nobody's.
          break;
      }
    }
  }

  /** Ages both pools and runs the degrade ladder. Call before `scene.render`. */
  update(dt: number): void {
    if (this.disposed) return;
    this.ragdolls?.update(dt);
    this.shards?.update(dt);
    this.trackFrame(dt);

    this.stats.ragdolls = this.ragdolls?.count ?? 0;
    this.stats.shards = this.shards?.count ?? 0;
    this.stats.bodies = (this.ragdolls?.bodyCount ?? 0) + (this.shards?.bodyCount ?? 0);
    this.stats.quality = this.quality;
  }

  /** Lower is cheaper. Nothing raises this automatically, only the caller. */
  setQuality(quality: PhysicsQuality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.stats.quality = quality;
    if (quality === 0) {
      this.ragdolls?.reset();
      this.shards?.reset();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    this.ground?.dispose();
    this.ragdolls?.dispose();
    this.shards?.dispose();
    this.ground = null;
    this.ragdolls = null;
    this.shards = null;
    // Only if this layer is the one that turned physics on.
    if (this.plugin !== null) {
      this.scene.disablePhysicsEngine();
      this.plugin = null;
    }
  }

  private wasShattered(enemyId: number): boolean {
    for (let i = 0; i < this.shatteredCount; i++) {
      if (this.shattered[i] === enemyId) return true;
    }
    return false;
  }

  /** A block falls over: corpses thrown away from the squad that killed it. */
  private killBurst(x: number, z: number, state: RunState): void {
    const pool = this.ragdolls;
    const count = RAGDOLLS_PER_KILL[this.quality] ?? 0;
    if (pool === null || count === 0) return;

    scratchDirection.set(x - state.squad.x, 0, z - state.squad.z);
    const length = scratchDirection.length();
    // A block killed on contact sits on top of the squad; fall back to "away".
    const dx = length < 0.01 ? 0 : scratchDirection.x / length;
    const dz = length < 0.01 ? 1 : scratchDirection.z / length;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + this.random() * 0.6;
      const radius = RAGDOLL_SPREAD * (0.4 + this.random() * 0.6);
      const jitter = 1 + (this.random() - 0.5) * RAGDOLL_PUSH_JITTER;
      const speed = RAGDOLL_PUSH_SPEED * jitter;
      pool.spawn(
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

  /** A frozen block comes apart: ice-blue chips, radial. */
  private shatterBurst(x: number, z: number): void {
    const count = SHATTER_SHARDS[this.quality] ?? 0;
    this.ring(x, 0.35, z, count, 0, ICE_TINT, 1);
  }

  /** The boss goes down: a wider, slower ring of violet debris. */
  private bossBurst(x: number, z: number): void {
    const count = BOSS_SHARDS[this.quality] ?? 0;
    this.ring(x, 0.8, z, count, 1, BOSS_TINT, 1.5);
  }

  /** The panel breaks where the squad went through it, tinted by its kind. */
  private glassBurst(gateId: number, kind: GateKind, state: RunState): void {
    const count = GLASS_SHARDS[this.quality] ?? 0;
    const pool = this.shards;
    if (pool === null || count === 0) return;

    let x = state.squad.x;
    let z = state.squad.z;
    for (const gate of state.gates) {
      if (gate.id !== gateId) continue;
      x = laneCenter(gate.lane);
      z = gate.z;
      break;
    }

    const tint = gateTint(kind);
    for (let i = 0; i < count; i++) {
      const across = (this.random() * 2 - 1) * GATE_PANEL_HALF_WIDTH;
      pool.spawn(
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
    const pool = this.shards;
    if (pool === null || count === 0) return;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + this.random() * 0.5;
      const speed = SHARD_PUSH_SPEED * speedMul * (0.6 + this.random() * 0.8);
      pool.spawn(
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

  /** Drops a step when `FrameBudget` says the last second was over budget. */
  private trackFrame(dt: number): void {
    if (this.budget.push(dt) && this.quality > 0) {
      this.setQuality((this.quality - 1) as PhysicsQuality);
    }
  }
}
