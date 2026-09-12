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
import type { Scene } from '@babylonjs/core/scene';

import { BossView } from './boss';
import { BurnView } from './burn';
import { CameraRig } from './camera';
import { EffectsView } from './effects';
import { EnemyView } from './enemies';
import { GateView } from './gates';
import { loadDisplayFont } from './glyphAtlas';
import { NumberLabels } from './labels';
import { ProjectileView } from './projectiles';
import { PreviewBackdrop } from './preview';
import { PropsView } from './props';
import { RoadView } from './road';
import { createEngine, createScene } from './scene';
import { SpriteLayer } from './sprites';
import { SquadView } from './squad';
import { RendererEvents } from './rendererEvents';
import { POOL } from './theme';
import { applyToonRampToScene } from './toonRamp';
import { WallView } from './walls';
import { WarmUpTracker } from './warmup';
import type { ShaderStats } from './warmup';
import { WispView } from './wisp';
import { weaponOf } from '@/sim';
import type { LevelDef, PlayerState, RunState, SimEvent } from '@/sim';

export interface RendererOptions {
  /**
   * Ceiling on the device pixel ratio the scene renders at. Phones ship 3x and
   * 4x screens; past 2x the extra pixels cost frames and buy nothing.
   */
  maxPixelRatio?: number;
  /**
   * Keep the drawing buffer readable after present. Only the screenshot path
   * wants it (`?screenshot=1`); see `createEngine`.
   */
  preserveDrawingBuffer?: boolean;
}

const DEFAULT_MAX_PIXEL_RATIO = 2;

/**
 * The road runs from before the first row to well past the arena. Both ends are
 * longer than the plan's 40 m on purpose: each has to sit outside the frame
 * from wherever the camera can stand, or the player sees the road stop in
 * mid-air.
 *
 * The near end moved from -10 to -30 in Milestone 4 for the Academy backdrop:
 * that camera stands twenty metres behind the squad and looks along the road
 * rather than down at it (`PREVIEW_BEHIND`), so the bottom of its frame reaches
 * about `z = -14` — four metres past where the road used to start, which put a
 * band of grass and the road's own near edge under the Academy's cards.
 */
const ROAD_START_Z = -30;
const ROAD_PAST_ARENA = 70;

/** A lookup that never finds anything, for a frame drawn before `init` wired
 *  the event router up. A spark with no target simply fizzles. */
const noTarget = (): boolean => false;

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly preserveDrawingBuffer: boolean;
  private maxPixelRatio: number;

  private engine: Engine | null = null;
  private sceneRef: Scene | null = null;
  private rig: CameraRig | null = null;
  private instrumentation: SceneInstrumentation | null = null;

  private labels: NumberLabels | null = null;
  private road: RoadView | null = null;
  private props: PropsView | null = null;
  private squad: SquadView | null = null;
  /** Every spell quad in the scene, in one batch; see `./sprites.ts`. */
  private sprites: SpriteLayer | null = null;
  private projectiles: ProjectileView | null = null;
  private effects: EffectsView | null = null;
  private gates: GateView | null = null;
  private enemies: EnemyView | null = null;
  private boss: BossView | null = null;
  /** Lane walls (D32) and the familiar (D33). */
  private walls: WallView | null = null;
  private wisp: WispView | null = null;
  /** Ember's burn (D33, tier 2), read off the bodies themselves. */
  private burn: BurnView | null = null;

  /**
   * Who draws a death, mirrored from the physics layer by `setPhysicsQuality`.
   *
   * Zero until the app says otherwise, and that is the important part: the
   * layer is loaded without being awaited (two megabytes of Havok must not hold
   * the title screen), so for the first seconds of the session there is no
   * physics at all. Starting at 2 meant the renderer spent those seconds
   * skipping the deaths it believed Havok was about to throw — every tenth
   * stream body blinked out, and every block died without an animation.
   */
  private physicsQuality = 0;
  /** Built in `init`, once every view it writes to exists (`./rendererEvents.ts`). */
  private events: RendererEvents | null = null;

  /** The Academy backdrop, when one is up; see `./preview.ts`. */
  private readonly preview = new PreviewBackdrop();

  /** Warm-up bookkeeping; see `warmUp` and `./warmup.ts`. */
  private readonly warmUpTracker = new WarmUpTracker();

  private disposed = false;

  constructor(canvas: HTMLCanvasElement, options: RendererOptions = {}) {
    this.canvas = canvas;
    this.maxPixelRatio = Math.max(1, options.maxPixelRatio ?? DEFAULT_MAX_PIXEL_RATIO);
    this.preserveDrawingBuffer = options.preserveDrawingBuffer ?? false;
  }

  async init(): Promise<void> {
    const engine = createEngine(this.canvas, {
      preserveDrawingBuffer: this.preserveDrawingBuffer,
      effectivePixelRatio: this.effectivePixelRatio(),
    });
    this.engine = engine;
    this.applyPixelRatio();

    const scene = createScene(engine);
    this.sceneRef = scene;
    this.instrumentation = new SceneInstrumentation(scene);

    this.rig = new CameraRig(scene);

    // Sixty gate materials, three crowds and the biome are all built in the
    // next few lines. Each `new StandardMaterial` would otherwise re-dirty every
    // material in the scene; blocking the mechanism makes it one pass at the end.
    scene.blockMaterialDirtyMechanism = true;

    // The glyph sheet is rasterised from whatever face is installed *now*, so
    // the font has to be asked for before the atlas is built. Fail-soft and
    // time-boxed: a missing Cinzel is a fallback serif, never a delayed boot.
    await loadDisplayFont();
    const labels = new NumberLabels(scene);
    this.labels = labels;
    this.road = new RoadView(scene);
    this.props = new PropsView(scene);
    this.squad = new SquadView(scene);
    const sprites = new SpriteLayer(scene, POOL.sprites);
    this.sprites = sprites;
    this.projectiles = new ProjectileView(sprites);
    this.effects = new EffectsView(scene, sprites);
    this.gates = new GateView(scene, labels);
    this.enemies = new EnemyView(scene, labels);
    this.boss = new BossView(scene, labels);
    this.walls = new WallView(scene, sprites);
    this.wisp = new WispView(sprites);
    this.burn = new BurnView(sprites);
    this.events = new RendererEvents({
      squad: this.squad,
      projectiles: this.projectiles,
      effects: this.effects,
      gates: this.gates,
      enemies: this.enemies,
      boss: this.boss,
      walls: this.walls,
      wisp: this.wisp,
      shake: (strength, seconds) => {
        this.shake(strength, seconds);
      },
    });

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

    scene.blockMaterialDirtyMechanism = false;

    // Compiles shaders and uploads buffers, so the first `update` is not a
    // blank frame that the smoke test would screenshot. The labels join in with
    // one invisible glyph, or their shader would compile on the frame the first
    // gate comes into range — a stall exactly where the player is deciding.
    labels.warmUp();
    await scene.whenReadyAsync();
    labels.commit();

    // After the first readiness pass, never before: a material frozen while its
    // effect is still compiling never draws. Neither view ever changes what its
    // materials are made of, so re-checking them every frame is pure cost.
    this.props?.freeze();
    this.road?.freeze();

    // Last: every pooled material compiled while the title screen is still
    // being put together, so the first bolt, the first gate and the first
    // ragdoll of a run do not each cost a frame (`./warmup.ts`).
    await this.warmUp();
  }

  /**
   * True when the last `update` moved the camera by less than a pixel's worth.
   *
   * The title screen shows a run that never ticks, so once the camera has eased
   * into place nothing in the scene changes and the caller can stop asking for
   * frames until something does (see `App.frame`).
   */
  isSettled(): boolean {
    // Never, while the Academy backdrop is up: the drift is the whole point of
    // the preview, and a settled frame is a paused game (`./preview.ts`).
    if (this.preview.active) return false;
    return this.rig?.isSettled() ?? false;
  }

  /**
   * The Academy's backdrop follows this player (D33): the staff on the mages,
   * the wisp beside them, and a camera that breathes rather than freezing.
   *
   * `null` ends the preview, which the app calls as a run starts. The staff
   * needs nothing beyond this call — the app builds its preview through `Run`
   * with the same player, so `state.squad.weaponId` is already the chosen one
   * and `SquadView` draws the crowd carrying it. See `./preview.ts` for what
   * the wisp needs.
   */
  setPreviewPlayer(player: PlayerState | null): void {
    this.preview.setPlayer(player);
    this.rig?.setDrift(this.preview.active);
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
   * Stream bodies written into the crowd last frame, and the world labels drawn
   * over them. Both are what the horde costs the renderer and both have a
   * ceiling a level can quietly run into — `POOL.grunts` and the glyph budget —
   * so the debug panel prints them next to the draw calls.
   */
  get streamBodies(): number {
    return this.enemies?.streamBodies ?? 0;
  }

  get labelStats(): { labels: number; glyphs: number; dropped: number } {
    return this.labels?.stats ?? { labels: 0, glyphs: 0, dropped: 0 };
  }

  /**
   * Fence pieces, wisp sparks and burning bodies drawn last frame: what
   * Milestone 4 added to the road, and all three have a pool a level can run
   * into. The debug panel and the dev harness print them beside the draw calls.
   */
  get featureStats(): { walls: number; wisp: boolean; sparks: number; burning: number } {
    return {
      walls: this.walls?.drawn ?? 0,
      wisp: this.wisp?.drawn ?? false,
      sparks: this.wisp?.sparksInFlight ?? 0,
      burning: this.burn?.drawn ?? 0,
    };
  }

  /** Shader programs compiled so far, and what the warm-up pass did (`./warmup.ts`). */
  get shaderStats(): ShaderStats {
    return this.warmUpTracker.stats(this.engine);
  }

  /**
   * Compiles every material in the scene, so no frame pays for a first use.
   *
   * Called at the end of `init` for everything the renderer owns, again when
   * the physics layer has built its debris pools, and once more as a level
   * starts — the later calls are nearly free, because a material that is
   * already ready resolves on the first check.
   */
  async warmUp(): Promise<void> {
    const scene = this.sceneRef;
    if (scene === null || this.disposed) return;
    // Before the compile, never after: a plugin added to a material marks its
    // defines dirty, and a material ramped after the pass would compile its
    // new variant inside the first frame that drew it — exactly the stall this
    // pass exists to remove.
    applyToonRampToScene(scene);
    await this.warmUpTracker.run(scene);
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

  /** Builds the road for this level and hands every pool back to its owner. */
  loadLevel(level: LevelDef): void {
    if (this.disposed) return;
    const endZ = level.arenaZ + ROAD_PAST_ARENA;
    this.road?.setExtent(ROAD_START_Z, endZ, level.arenaZ);
    this.props?.build(level.index, ROAD_START_Z, endZ);
    // The fences are placed once here and only culled per frame afterwards
    // (`./walls.ts`); `walls` is optional on `LevelDef` for the fixtures that
    // predate D32, and an absent list is simply a level with no walls.
    this.walls?.setWalls(level.walls);
    this.squad?.reset();
    this.sprites?.reset();
    this.projectiles?.reset();
    this.effects?.reset();
    this.gates?.reset();
    this.enemies?.reset();
    this.boss?.reset();
    this.wisp?.reset();
    this.burn?.reset();
    this.events?.reset();
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

    this.events?.observe(state.boss?.id, weaponOf(state.squad));
    this.events?.apply(events);

    this.squad?.update(state.squad, state.arenaZ, dt);
    // The sprite batch is opened before anything writes into it and closed
    // after everything has: projectiles, their trails, impacts and flashes all
    // land in the same buffer and the same draw call.
    this.sprites?.begin();
    this.projectiles?.update(state.projectiles, weaponOf(state.squad), dt);
    this.gates?.update(state, dt);
    this.enemies?.update(state, dt);
    this.boss?.update(state.boss, state.squad.z, dt, this.timeScale(dt));
    this.effects?.update(dt);
    // After the enemies, because both read positions the enemy view has just
    // refreshed: the wall's flare sprite and the wisp's spark, which homes on
    // its target through `EnemyView.positionOf`.
    this.walls?.update(state.squad.z, dt);
    this.wisp?.update(this.preview.familiarFor(state), this.events?.targetLookup ?? noTarget, dt);
    this.burn?.update(state, dt);
    this.sprites?.end();

    this.rig?.update(state.squad, dt);
    // After the rig, because the sky dome rides on the camera: a dome that
    // follows a frame late shears against the fog on a fast lateral drag.
    const camera = this.rig?.camera;
    if (camera !== undefined) this.road?.update(camera.position.x, camera.position.z, dt);

    // Last, and after the rig: every label is billboarded against the camera's
    // final pose for this frame, so a number never lags the thing it names.
    this.labels?.commit();

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
    this.events?.apply(events);
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
    this.sprites?.dispose();
    this.gates?.dispose();
    this.enemies?.dispose();
    this.boss?.dispose();
    this.walls?.dispose();
    this.props?.dispose();
    this.road?.dispose();
    this.labels?.dispose();

    this.squad = null;
    this.projectiles = null;
    this.effects = null;
    this.sprites = null;
    this.gates = null;
    this.enemies = null;
    this.boss = null;
    this.walls = null;
    this.wisp = null;
    this.burn = null;
    this.events = null;
    this.props = null;
    this.road = null;
    this.labels = null;
    this.rig?.dispose();
    this.rig = null;

    this.instrumentation?.dispose();
    this.instrumentation = null;
    this.sceneRef?.dispose();
    this.sceneRef = null;
    this.engine?.dispose();
    this.engine = null;
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

  /** What the scene actually renders at: the screen's ratio under our cap. */
  private effectivePixelRatio(): number {
    const deviceRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    return Math.min(deviceRatio, this.maxPixelRatio);
  }

  /**
   * Caps the backing-store resolution; `1 / level` is the effective ratio.
   *
   * Guarded, because `setHardwareScalingLevel` resizes the canvas and every
   * render target hanging off it. This is called from `init`, from a rung
   * change and from `resize` — never per frame — and the guard keeps a resize
   * that did not change the ratio from costing a reallocation anyway.
   */
  private applyPixelRatio(): void {
    const engine = this.engine;
    if (engine === null) return;
    const level = 1 / this.effectivePixelRatio();
    if (engine.getHardwareScalingLevel() === level) return;
    engine.setHardwareScalingLevel(level);
  }
}

