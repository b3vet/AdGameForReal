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

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
// Side-effect imports: `joinedPhysicsEngineComponent` is what puts
// `enablePhysics` on `Scene.prototype` — without it the call silently returns
// false; the v2 component is what wires bodies to their transform nodes.
import '@babylonjs/core/Physics/joinedPhysicsEngineComponent';
import '@babylonjs/core/Physics/v2/physicsEngineComponent';
import type { Scene } from '@babylonjs/core/scene';

import HavokPhysics from '@babylonjs/havok';

// The one rule this layer shares with the renderer: which stream bodies fall
// over for real. `deathStyle.ts` has no imports of its own precisely so both
// sides can reach the same answer from an enemy id alone.
import { usesRagdoll } from '@/render/deathStyle';
import { laneCenter } from '@/sim';
import type { LevelDef, RunState, SimEvent } from '@/sim';

import { DebrisBursts } from './bursts';
import { GroundCollider } from './ground';
// Where the WASM comes from: a URL to fetch in dev and production, the bytes
// themselves in the single-file builds (plan, "Asset delivery in builds").
import { havokLoaderOptions } from './havokLoader';
import { RagdollPool } from './RagdollPool';
import { ShardPool } from './ShardPool';
import {
  GROUND_PAST_ARENA,
  GROUND_START_Z,
  RAGDOLL_CAPACITY,
  RAGDOLL_LIVE_CAP,
  SHARD_CAPACITY,
  STOMP_IMPULSE,
  STOMP_RADIUS,
  STOMP_UP,
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

const scratchDirection = new Vector3();
/**
 * Returned by the two lookups below. Reused because `onEvents` runs on every
 * frame of every run and may not allocate (CLAUDE.md).
 */
const scratchAway = { dx: 0, dz: 1 };
const scratchGate = { x: 0, z: 0 };
const DOWN_ROAD = { dx: 0, dz: 1 } as const;

export class PhysicsLayer {
  readonly stats: PhysicsStats = { ragdolls: 0, shards: 0, bodies: 0, quality: 0 };

  private readonly scene: Scene;
  private readonly ragdollModelId: string;

  private quality: PhysicsQuality;
  private ragdolls: RagdollPool | null = null;
  private shards: ShardPool | null = null;
  /** What a burst looks like (`./bursts.ts`); built with the pools in `init`. */
  private bursts: DebrisBursts | null = null;
  private ground: GroundCollider | null = null;
  private plugin: HavokPlugin | null = null;
  private ready = false;
  private disposed = false;

  /**
   * Block ids that shattered this batch. A frost kill emits `enemyKilled` and
   * then `enemyShattered` for the same block, and a frozen block comes apart
   * rather than falling over, so the kill's ragdolls are suppressed. Fixed
   * length because `onEvents` may not allocate. Stream bodies are not listed:
   * see the pre-pass in `onEvents`.
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

    const havok = await HavokPhysics(havokLoaderOptions());
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
    this.ragdolls.setLiveCap(RAGDOLL_LIVE_CAP[this.quality] ?? 0);
    if (this.disposed) {
      this.shards.dispose();
      this.ragdolls.dispose();
      this.shards = null;
      this.ragdolls = null;
      return;
    }
    this.bursts = new DebrisBursts(this.ragdolls, this.shards);
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
      // Stream bodies are skipped: their ragdoll rule does not consult this
      // list, and three hundred of them would crowd the blocks out of it.
      if (
        event.type === 'enemyShattered' &&
        event.streamId === undefined &&
        this.shatteredCount < this.shattered.length
      ) {
        this.shattered[this.shatteredCount++] = event.enemyId;
      }
    }

    let bossDone = false;
    for (const event of events) {
      switch (event.type) {
        case 'enemyKilled':
          if (event.kind === 'boss') {
            if (!bossDone) this.bursts?.boss(event.x, event.z, this.quality);
            bossDone = true;
          } else if (event.streamId !== undefined) {
            // Only the one in ten the renderer leaves to us (D29). The shatter
            // suppression does not apply: a frozen stream body still has to
            // fall, because its baked death was skipped either way.
            if (usesRagdoll(event.enemyId)) {
              const away = this.awayFromSquad(event.x, event.z, state);
              this.bursts?.streamFall(event.x, event.z, away.dx, away.dz);
            }
          } else if (!this.wasShattered(event.enemyId)) {
            const away = this.awayFromSquad(event.x, event.z, state);
            this.bursts?.kill(event.x, event.z, away.dx, away.dz, this.quality);
          }
          break;
        case 'bossKilled':
          if (!bossDone) {
            const boss = state.boss;
            this.bursts?.boss(boss?.x ?? state.squad.x, boss?.z ?? state.arenaZ, this.quality);
            bossDone = true;
          }
          break;
        case 'enemyShattered':
          // A block bursting into ice chips is an event; a stream doing it body
          // by body is a blizzard, and a shard pool that never stops recycling.
          if (event.streamId === undefined) this.bursts?.shatter(event.x, event.z, this.quality);
          break;
        case 'gatePassed': {
          const at = this.gatePosition(event.gateId, state);
          this.bursts?.glass(at.x, at.z, event.kind, this.quality);
          break;
        }
        case 'bossStomp':
          this.ragdolls?.push(event.x, event.z, STOMP_RADIUS, STOMP_IMPULSE, STOMP_UP);
          this.shards?.push(event.x, event.z, STOMP_RADIUS, STOMP_IMPULSE, STOMP_UP);
          break;
        default:
          // Everything else is the renderer's, the UI's or nobody's.
          // `enemyActivated` in particular: it fires once per stream body, about
          // twenty a second, and there is no debris in it.
          break;
      }
    }
  }

  /** Ages both pools. Call before `scene.render`. */
  update(dt: number): void {
    if (this.disposed) return;

    // Nothing is live, so there is nothing to age, sink or upload — and the
    // frame that parked the last body already committed both instance buffers
    // to zero. Worth the check because this is called on every frame of the
    // title screen and every frame of a run with no debris in the air, which is
    // most of them: 8 ragdoll slots, 64 shard slots and three buffer commits.
    if ((this.ragdolls?.count ?? 0) === 0 && (this.shards?.count ?? 0) === 0) {
      this.stats.ragdolls = 0;
      this.stats.shards = 0;
      this.stats.bodies = 0;
      this.stats.quality = this.quality;
      return;
    }

    this.ragdolls?.update(dt);
    this.shards?.update(dt);

    this.stats.ragdolls = this.ragdolls?.count ?? 0;
    this.stats.shards = this.shards?.count ?? 0;
    this.stats.bodies = (this.ragdolls?.bodyCount ?? 0) + (this.shards?.bodyCount ?? 0);
    this.stats.quality = this.quality;
  }

  /**
   * Lower is cheaper. The layer never decides this for itself: the app owns the
   * degrade ladder (`src/core/quality.ts`) because most of its rungs are the
   * renderer's, and this is the one it turns here.
   */
  setQuality(quality: PhysicsQuality): void {
    // A layer that never came up cannot be turned back on: `?physics=0` skipped
    // the WASM and a failed init has no pools, so anything above 0 would be a
    // number the debug panel prints and nothing behind it.
    const wanted = this.ready ? quality : 0;
    if (wanted === this.quality) return;
    this.quality = wanted;
    this.stats.quality = wanted;
    this.ragdolls?.setLiveCap(RAGDOLL_LIVE_CAP[wanted] ?? 0);
    if (wanted === 0) {
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
    this.bursts = null;
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

  /**
   * Which way a corpse is thrown: the unit direction from the squad to
   * `(x, z)`. A body killed on contact sits on top of the squad and has no
   * direction at all, so that case falls back to "further down the road".
   */
  private awayFromSquad(x: number, z: number, state: RunState): { dx: number; dz: number } {
    scratchDirection.set(x - state.squad.x, 0, z - state.squad.z);
    const length = scratchDirection.length();
    if (length < 0.01) return DOWN_ROAD;
    scratchAway.dx = scratchDirection.x / length;
    scratchAway.dz = scratchDirection.z / length;
    return scratchAway;
  }

  /** Where a gate's panel stands, or the squad if that gate is already gone. */
  private gatePosition(gateId: number, state: RunState): { x: number; z: number } {
    for (const gate of state.gates) {
      if (gate.id !== gateId) continue;
      scratchGate.x = laneCenter(gate.lane);
      scratchGate.z = gate.z;
      return scratchGate;
    }
    scratchGate.x = state.squad.x;
    scratchGate.z = state.squad.z;
    return scratchGate;
  }
}
