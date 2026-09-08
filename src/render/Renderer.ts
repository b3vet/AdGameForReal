/**
 * The Babylon layer. Owner: render agent (Phase B2).
 *
 * Rules (docs/03-milestone-1-plan.md):
 *   - Babylon is imported here and nowhere else outside `src/render`.
 *   - Render reads sim state; it never mutates it.
 *   - Every mesh, material and label is allocated in `init`; `loadLevel` hands
 *     them out and `update` only writes transforms. Nothing is created per frame.
 *
 * Deep imports (`@babylonjs/core/...`) rather than the package root, so the
 * single-file artifact build stays small.
 */

import type { Engine } from '@babylonjs/core/Engines/engine';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import type { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { BossView } from './boss';
import { CameraRig } from './camera';
import { EffectsView } from './effects';
import { EnemyView } from './enemies';
import { GateView } from './gates';
import { LabelLayer } from './labels';
import { ProjectileView } from './projectiles';
import { PropsView } from './props';
import { RoadView } from './road';
import { createEngine, createGlow, createScene } from './scene';
import { SquadView } from './squad';
import { SHAKE_BOSS_KILL, SHAKE_STOMP } from './theme';
import { startWeapon, weaponOf } from '@/sim';
import type { LevelDef, RunState, SimEvent, WeaponId } from '@/sim';

export interface RendererOptions {
  /**
   * Ceiling on the device pixel ratio the scene renders at. Phones ship 3x and
   * 4x screens; past 2x the extra pixels cost frames and buy nothing.
   */
  maxPixelRatio?: number;
}

const DEFAULT_MAX_PIXEL_RATIO = 2;

/**
 * The road runs from before the first row to well past the arena. The tail is
 * longer than the plan's 40 m on purpose: the far edge has to sit beyond
 * `FOG_END` from the camera, or the player sees the road stop in mid-air.
 */
const ROAD_START_Z = -10;
const ROAD_PAST_ARENA = 70;

/** Scratch for the position lookups in `applyEvents`, which must not allocate. */
const scratchFrom = { x: 0, z: 0 };
const scratchTo = { x: 0, z: 0 };

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private maxPixelRatio: number;

  private engine: Engine | null = null;
  private sceneRef: Scene | null = null;
  private rig: CameraRig | null = null;
  private instrumentation: SceneInstrumentation | null = null;

  private labels: LabelLayer | null = null;
  private road: RoadView | null = null;
  private props: PropsView | null = null;
  private squad: SquadView | null = null;
  private projectiles: ProjectileView | null = null;
  private effects: EffectsView | null = null;
  private gates: GateView | null = null;
  private enemies: EnemyView | null = null;
  private boss: BossView | null = null;

  private glow: GlowLayer | null = null;
  private glowEnabled = true;
  private physicsQuality = 2;
  /** The boss's enemy id, so `enemyHit` can be routed to its hit reaction. */
  private bossId = -1;
  /** A boss death arrives as two events; the burst belongs to whichever is first. */
  private bossBurstDone = false;
  /** The staff in hand, for effects fired by events that do not name one. */
  private lastWeapon: WeaponId = startWeapon;

  private disposed = false;

  constructor(canvas: HTMLCanvasElement, options: RendererOptions = {}) {
    this.canvas = canvas;
    this.maxPixelRatio = Math.max(1, options.maxPixelRatio ?? DEFAULT_MAX_PIXEL_RATIO);
  }

  async init(): Promise<void> {
    const engine = createEngine(this.canvas);
    this.engine = engine;
    this.applyPixelRatio();

    const scene = createScene(engine);
    this.sceneRef = scene;
    this.instrumentation = new SceneInstrumentation(scene);

    this.rig = new CameraRig(scene);

    const labels = new LabelLayer(scene);
    this.labels = labels;
    this.road = new RoadView(scene);
    this.props = new PropsView(scene);
    this.squad = new SquadView(scene);
    this.projectiles = new ProjectileView(scene);
    this.effects = new EffectsView(scene);
    this.gates = new GateView(scene, labels);
    this.enemies = new EnemyView(scene, labels);
    this.boss = new BossView(scene, labels);

    // A default stretch of road, so the very first frame — which the app draws
    // behind the title screen before any level exists — is not empty sky.
    this.road.setExtent(ROAD_START_Z, 200, 168);

    // Models are loaded in parallel and each loader is fail-soft: a missing
    // `/assets/` costs the art, never the boot.
    await Promise.all([
      this.squad.load(),
      this.enemies.load(),
      this.boss.load(),
      this.gates.load(),
      this.props.load(),
    ]);
    this.props.build(1, ROAD_START_Z, 200);

    this.buildGlow(scene);

    // Compiles shaders and uploads buffers, so the first `update` is not a
    // blank frame that the smoke test would screenshot.
    await scene.whenReadyAsync();
  }

  /**
   * True when the last `update` moved the camera by less than a pixel's worth.
   *
   * The title screen shows a run that never ticks, so once the camera has eased
   * into place nothing in the scene changes and the caller can stop asking for
   * frames until something does (see `App.frame`).
   */
  isSettled(): boolean {
    return this.rig?.isSettled() ?? false;
  }

  /**
   * The Babylon scene, for the layers that draw into it without owning it —
   * the physics debris in `src/physics`, and whatever the app hangs off it.
   * Throws rather than returning null: every caller needs a scene, and a
   * silent null here would surface as a mystery three frames later.
   */
  get scene(): Scene {
    const scene = this.sceneRef;
    if (scene === null) throw new Error('Renderer.scene read before init()');
    return scene;
  }

  /** Draw calls in the last rendered frame; the budget is 40 at 500 units. */
  get drawCalls(): number {
    return this.instrumentation?.drawCallsCounter.current ?? 0;
  }

  /**
   * Backing-store pixels per CSS pixel, and what the screen offers. The pair,
   * because on the product owner's phone the two together are what say whether
   * a frame-rate reading came from a degraded rung or a full-resolution one
   * (docs/06-milestone-2-plan.md, definition of done 9).
   */
  get pixelRatio(): number {
    const engine = this.engine;
    if (engine === null) return 0;
    const scaling = engine.getHardwareScalingLevel();
    return scaling > 0 ? 1 / scaling : 0;
  }

  get devicePixelRatio(): number {
    return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  }

  /** Kicks the camera; see `CameraRig.shake`. */
  shake(strength: number, seconds: number): void {
    this.rig?.shake(strength, seconds);
  }

  /**
   * The physics layer's quality, mirrored here because it decides who draws a
   * death: at 1 and 2 `src/physics` spawns ragdolls and shards, so the renderer
   * only takes the block away; at 0 it plays the baked death animation itself.
   */
  setPhysicsQuality(quality: number): void {
    this.physicsQuality = Math.max(0, Math.min(2, Math.round(quality)));
    this.enemies?.setPhysicsQuality(this.physicsQuality);
  }

  /**
   * Degrade ladder rung: the backing store is what a fill-rate-bound phone
   * feels first. `src/core/quality.ts` owns when this is called.
   */
  setMaxPixelRatio(ratio: number): void {
    const clamped = Math.max(1, ratio);
    if (clamped === this.maxPixelRatio) return;
    this.maxPixelRatio = clamped;
    this.applyPixelRatio();
  }

  /** Degrade ladder rung: the glow pass costs a blur and a second draw. */
  setGlow(enabled: boolean): void {
    this.glowEnabled = enabled;
    if (this.glow !== null) this.glow.isEnabled = enabled;
  }

  /** Builds the road for this level and hands every pool back to its owner. */
  loadLevel(level: LevelDef): void {
    if (this.disposed) return;
    const endZ = level.arenaZ + ROAD_PAST_ARENA;
    this.road?.setExtent(ROAD_START_Z, endZ, level.arenaZ);
    this.props?.build(level.index, ROAD_START_Z, endZ);
    this.squad?.reset();
    this.projectiles?.reset();
    this.effects?.reset();
    this.gates?.reset();
    this.enemies?.reset();
    this.boss?.reset();
    this.bossId = -1;
    this.bossBurstDone = false;
    // Every run starts on `startWeapon`, and the views only learn about a staff
    // from a `weaponChanged` event — which the new run has not emitted. Without
    // this the first frames of the level after a frost run draw frost bolts and
    // cyan muzzle flashes for a squad holding ember.
    this.setWeapon(startWeapon);
    this.rig?.reset();
  }

  /**
   * Called every frame after `Run.tick`. `events` are the events from that same
   * tick, in the order the sim produced them; they start animations, while every
   * position comes from `state`. Safe to call before `loadLevel`.
   *
   * `dt` is sim time, which the app scales for hit-stop and slow-mo, so every
   * animation here is driven by it rather than by the frame clock.
   */
  update(state: RunState, events: readonly SimEvent[], dt: number): void {
    if (this.disposed) return;
    const scene = this.sceneRef;
    if (scene === null) return;

    this.bossId = state.boss?.id ?? this.bossId;
    this.lastWeapon = weaponOf(state.squad);
    this.applyEvents(events);

    this.squad?.update(state.squad, state.arenaZ, dt);
    this.projectiles?.update(state.projectiles, weaponOf(state.squad));
    this.gates?.update(state, dt);
    this.enemies?.update(state, dt);
    this.boss?.update(state.boss, state.squad.z, dt, this.timeScale(dt));
    this.effects?.update(dt);

    this.rig?.update(state.squad, dt);
    // After the rig, because the sky dome rides on the camera: a dome that
    // follows a frame late shears against the fog on a fast lateral drag.
    const camera = this.rig?.camera;
    if (camera !== undefined) this.road?.update(camera.position.x, camera.position.z, dt);

    scene.render();
  }

  /**
   * Starts the animations a batch of events implies without drawing a frame.
   *
   * `?turbo` runs several sim ticks per frame, and the sim re-uses its event
   * objects between ticks, so every tick but the last hands its events here
   * before they are overwritten. The last tick's events go to `update` as usual.
   */
  absorbEvents(events: readonly SimEvent[]): void {
    if (this.disposed) return;
    this.applyEvents(events);
  }

  resize(): void {
    this.engine?.resize();
    this.applyPixelRatio();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.squad?.dispose();
    this.projectiles?.dispose();
    this.effects?.dispose();
    this.gates?.dispose();
    this.enemies?.dispose();
    this.boss?.dispose();
    this.props?.dispose();
    this.road?.dispose();
    this.labels?.dispose();
    this.glow?.dispose();

    this.squad = null;
    this.projectiles = null;
    this.effects = null;
    this.gates = null;
    this.enemies = null;
    this.boss = null;
    this.props = null;
    this.road = null;
    this.labels = null;
    this.glow = null;
    this.rig?.dispose();
    this.rig = null;

    this.instrumentation?.dispose();
    this.instrumentation = null;
    this.sceneRef?.dispose();
    this.sceneRef = null;
    this.engine?.dispose();
    this.engine = null;
  }

  private applyEvents(events: readonly SimEvent[]): void {
    const effects = this.effects;
    const enemies = this.enemies;

    for (const event of events) {
      switch (event.type) {
        case 'projectileFired':
          effects?.onMuzzle(event.x, event.z);
          break;
        case 'projectileHit':
          effects?.onImpact(event.weaponId, event.x, event.z);
          break;
        case 'splash':
          effects?.onSplash(event.x, event.z, event.radius);
          break;
        case 'chain':
          // The event carries block ids, not positions: the view that draws
          // them is the one that knows where they are. A block that has already
          // been taken away — killed by the same volley, or shattered — has no
          // position any more, and the arc to it is simply not drawn.
          if (
            enemies !== null &&
            enemies.positionOf(event.from, scratchFrom) &&
            enemies.positionOf(event.to, scratchTo)
          ) {
            effects?.onChain(scratchFrom.x, scratchFrom.z, scratchTo.x, scratchTo.z);
          }
          break;
        case 'weaponChanged':
          this.setWeapon(event.to);
          break;
        case 'gateHit':
          this.gates?.onHit(event.gateId);
          break;
        case 'gatePassed':
          this.gates?.onPassed(event.gateId);
          break;
        case 'enemyHit':
          if (event.enemyId === this.bossId) this.boss?.onHit();
          break;
        case 'enemySlowed':
          enemies?.onSlowed(event.enemyId, event.seconds);
          break;
        case 'enemyShattered':
          enemies?.onShattered(event.enemyId);
          // The shards are the physics layer's; the frost flash is the tell
          // that this block did not fall over, it broke.
          effects?.onImpact('frost', event.x, event.z);
          break;
        case 'enemyKilled':
          if (event.kind === 'boss') {
            this.boss?.onKilled();
            this.bossDeathBurst(event.x, event.z);
          } else {
            enemies?.onKilled(event.enemyId);
          }
          break;
        case 'bossActivated':
          this.bossId = event.enemyId;
          break;
        case 'bossStomp':
          this.boss?.onStomp(event.x, event.z);
          this.shake(SHAKE_STOMP.strength, SHAKE_STOMP.seconds);
          break;
        case 'bossKilled':
          this.boss?.onKilled();
          // `bossKilled` carries no position, unlike the `enemyKilled` that
          // usually precedes it; the view knows where it last drew the body.
          this.boss?.positionOf(scratchTo);
          this.bossDeathBurst(scratchTo.x, scratchTo.z);
          this.shake(SHAKE_BOSS_KILL.strength, SHAKE_BOSS_KILL.seconds);
          break;
        case 'runEnded':
          this.squad?.onRunEnded(event.status);
          break;
        default:
          // Everything else (activated, gained, lost) is already visible through
          // `RunState`; the UI layer owns the rest.
          break;
      }
    }
  }

  /** Points every view that has a per-staff look at the same staff. */
  private setWeapon(weaponId: WeaponId): void {
    this.lastWeapon = weaponId;
    this.squad?.setWeapon(weaponId);
    this.projectiles?.setWeapon(weaponId);
    this.effects?.setWeapon(weaponId);
  }

  /**
   * A boss death reaches us as `enemyKilled` and then `bossKilled`; the burst
   * belongs to whichever arrives first, and the latch is what keeps it to one.
   */
  private bossDeathBurst(x: number, z: number): void {
    if (this.bossBurstDone) return;
    this.bossBurstDone = true;
    this.effects?.onBossDeath(this.lastWeapon, x, z);
  }

  /**
   * The ratio between the sim time a frame covers and the wall clock it took.
   * The boss's animation groups run on the scene's own clock, so this is what
   * carries the app's hit-stop and slow-mo through to them.
   */
  private timeScale(dt: number): number {
    const frame = (this.engine?.getDeltaTime() ?? 16) / 1000;
    if (frame <= 0) return 1;
    return Math.max(0, Math.min(8, dt / frame));
  }

  /** Hands the glow pass the meshes that bloom; see `createGlow`. */
  private buildGlow(scene: Scene): void {
    const meshes: Mesh[] = [];
    for (const view of [this.projectiles, this.effects, this.enemies, this.boss]) {
      meshes.push(...(view?.glowMeshes() ?? []));
    }
    this.glow = createGlow(scene, meshes, this.glowEnabled);
  }

  /** Caps the backing-store resolution; `1 / level` is the effective ratio. */
  private applyPixelRatio(): void {
    const engine = this.engine;
    if (engine === null) return;
    const deviceRatio = typeof window === 'undefined' ? 1 : (window.devicePixelRatio || 1);
    engine.setHardwareScalingLevel(1 / Math.min(deviceRatio, this.maxPixelRatio));
  }
}
