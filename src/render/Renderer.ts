/**
 * The Babylon layer. Owner: render agent (Phase B2).
 *
 * Rules (docs/03-milestone-1-plan.md):
 *   - Babylon is imported here and nowhere else outside `src/render`.
 *   - Render reads sim state; it never mutates it.
 *   - Every mesh, material and label is allocated in `init`; `loadLevel` hands
 *     them out and `update` only writes transforms. Nothing is created per frame.
 *
 * This file is the object the app holds: its lifecycle, its public API and the
 * quality rung. What it used to carry inline is four files around it —
 * `./views.ts` is every view, `./rendererBoot.ts` the order they are built in,
 * `./rendererLevel.ts` what a level load and a biome switch do to them,
 * `./rendererFrame.ts` the order they are written in every frame, and
 * `./rendererStats.ts` what is measured off the result.
 *
 * Deep imports (`@babylonjs/core/...`) rather than the package root, so the
 * single-file artifact build stays small.
 */

import type { Engine } from '@babylonjs/core/Engines/engine';
import type { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import type { Scene } from '@babylonjs/core/scene';

import { biomeOfLevel } from './biome';
import { BiomeSpans } from './biomeSpans';
import type { CameraRig } from './camera';
import { BARE_TINTS, applyCosmetics, sameTints, wornTints } from './cosmetics';
import type { WornTints } from './cosmetics';
import { PreviewBackdrop } from './preview';
import { setBiome as setPaletteBiome } from './palette';
import { bootScene } from './rendererBoot';
import { drawFrame, drawSquadOnly } from './rendererFrame';
import {
  chargerBodiesOf,
  drawCallsOf,
  featureStatsOf,
  labelStatsOf,
  pixelRatioOf,
  screenPixelRatio,
  streamBodiesOf,
} from './rendererStats';
import type { FeatureReadout, LabelReadout } from './rendererStats';
import { applySpan, loadLevelInto, repaintBiome } from './rendererLevel';
import { applyToonRampToScene } from './toonRamp';
import type { SceneViews } from './views';
import { WarmUpTracker } from './warmup';
import type { ShaderStats } from './warmup';
import type { BiomeId } from '@/data/biome-types';
import type { LevelDef, PlayerState, RunState, SimEvent, SquadState } from '@/sim';

export interface RendererOptions {
  /**
   * Ceiling on the device pixel ratio the scene renders at. Rung 0 of the
   * degrade ladder is the screen's own, up to 3 (D38); the ladder is what
   * decides whether a device can hold it (`src/core/quality.ts`).
   */
  maxPixelRatio?: number;
  /**
   * Keep the drawing buffer readable after present. Only the screenshot path
   * wants it (`?screenshot=1`); see `createEngine`.
   */
  preserveDrawingBuffer?: boolean;
  /**
   * Pins every level to one biome, whatever the level says (`?biome=frost`).
   *
   * A probe affordance, not a game one: the biome a level is set in is the
   * level's own (D49), and this is how a Frostfell frame is photographed on a
   * level the campaign has not reached yet.
   */
  biome?: BiomeId;
}

/**
 * What the renderer renders at before the ladder has said anything: rung 0.
 *
 * Three, not Milestone 3's two. The product owner's verdict on that build was
 * "resolution very low" and they were reading a 3x phone at 2. There is no
 * device check here on purpose — the ladder starts at native and steps down on
 * its p95 rule, which is the only test that is true of the phone in the room.
 */
const DEFAULT_MAX_PIXEL_RATIO = 3;

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly preserveDrawingBuffer: boolean;
  private maxPixelRatio: number;
  /** `?biome=`, or undefined to follow each level's own (see `RendererOptions`). */
  private readonly forcedBiome: BiomeId | undefined;
  /** The biome the scene is painted in right now. */
  private biome: BiomeId = 'meadow';

  private engine: Engine | null = null;
  private sceneRef: Scene | null = null;
  private rig: CameraRig | null = null;
  private instrumentation: SceneInstrumentation | null = null;

  /** Every view in the scene, built in `init` (`./views.ts`). */
  private views: SceneViews | null = null;

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

  /** The Academy backdrop, when one is up; see `./preview.ts`. */
  private readonly preview = new PreviewBackdrop();

  /** The tints the squad, the wisp and the spells are wearing (D53). */
  private tints: WornTints = BARE_TINTS;

  /**
   * The endless road's biome spans (D52), or inactive on a campaign level. It
   * owns the crossings; what a crossing *does* is `applySpan` below.
   */
  private readonly spans = new BiomeSpans();

  /**
   * The biome switch a span crossing asks for, bound once: `applySpan` runs on
   * every frame of a spanned road, and an arrow written at the call site would
   * be an allocation in the steady-state path. `warm` is false because both
   * biomes were compiled at boot (`setBiome`).
   */
  private readonly setSpanBiome = (id: BiomeId): void => {
    this.setBiome(id, false);
  };

  /** Warm-up bookkeeping; see `warmUp` and `./warmup.ts`. */
  private readonly warmUpTracker = new WarmUpTracker();

  private disposed = false;

  constructor(canvas: HTMLCanvasElement, options: RendererOptions = {}) {
    this.canvas = canvas;
    this.maxPixelRatio = Math.max(1, options.maxPixelRatio ?? DEFAULT_MAX_PIXEL_RATIO);
    this.preserveDrawingBuffer = options.preserveDrawingBuffer ?? false;
    this.forcedBiome = options.biome;
  }

  async init(): Promise<void> {
    // Before anything is built, so every material, vertex colour and painted
    // texture in the scene is made in the right biome the first time and the
    // boot warm-up compiles exactly what the first frame draws. A level load
    // that changes biome afterwards goes through `setBiome`.
    this.biome = this.forcedBiome ?? 'meadow';
    setPaletteBiome(this.biome);

    const context = await bootScene({
      canvas: this.canvas,
      preserveDrawingBuffer: this.preserveDrawingBuffer,
      effectivePixelRatio: this.effectivePixelRatio(),
      biome: this.biome,
      shake: (strength, seconds) => {
        this.shake(strength, seconds);
      },
    });
    this.engine = context.engine;
    this.sceneRef = context.scene;
    this.instrumentation = context.instrumentation;
    this.rig = context.rig;
    this.views = context.views;

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
    // The backdrop crowd wears what the player is wearing (D53), so a tint
    // chosen in the Wardrobe is on the mages behind the Academy's own cards.
    if (player !== null) this.setCosmetics(player);
  }

  /**
   * The tints this player is wearing (D53): the squad's hat and cape, the
   * wisp's colour and trail, and the glow on the spell sprites.
   *
   * Called at a level load and whenever the Academy re-dresses its backdrop —
   * never per frame. An unchanged selection is dropped here rather than in each
   * view, because the crowd's is the expensive one: it rewrites a vertex colour
   * buffer per staff.
   */
  setCosmetics(player: PlayerState): void {
    const tints = wornTints(player);
    if (sameTints(tints, this.tints)) return;
    this.tints = tints;
    if (this.views !== null) applyCosmetics(this.views, tints);
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

  /** The readouts the debug panel and the smoke take off the scene; see
   *  `./rendererStats.ts` for what each one is and who reads it. */
  get drawCalls(): number {
    return drawCallsOf(this.instrumentation);
  }

  get streamBodies(): number {
    return streamBodiesOf(this.views);
  }

  get chargerBodies(): number {
    return chargerBodiesOf(this.views);
  }

  get labelStats(): LabelReadout {
    return labelStatsOf(this.views);
  }

  get featureStats(): FeatureReadout {
    return featureStatsOf(this.views);
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

  get pixelRatio(): number {
    return pixelRatioOf(this.engine);
  }

  get devicePixelRatio(): number {
    return screenPixelRatio();
  }

  /** Kicks the camera; see `CameraRig.shake`. */
  shake(strength: number, seconds: number): void {
    this.rig?.shake(strength, seconds);
  }

  /**
   * Poses the camera at the play rig's pose for this squad, and nothing else,
   * for a caller that draws into the scene and renders it itself: the stress
   * scene (`src/core/stress.ts`). Without it that scene keeps the rig's
   * *constructor* pose — the framing a one-unit squad gets — and its 500-unit
   * crowd stands with its back rows under the bottom edge, so the frame the
   * performance tripwire measures is not one the game ever draws (D37).
   */
  poseCamera(squad: SquadState, dt: number): void {
    if (this.disposed) return;
    this.rig?.update(squad, dt);
  }

  /** The stress scene's cut-down frame; see `drawSquadOnly`. */
  drawSquad(state: RunState, dt: number): void {
    if (this.disposed) return;
    const views = this.views;
    if (views === null) return;
    drawSquadOnly(views, state, dt);
  }

  /**
   * The physics layer's quality, mirrored here because it decides who draws a
   * death: at 1 and 2 `src/physics` spawns ragdolls and shards, so the renderer
   * only takes the block away; at 0 it plays the baked death animation itself.
   */
  setPhysicsQuality(quality: number): void {
    this.physicsQuality = Math.max(0, Math.min(2, Math.round(quality)));
    this.views?.enemies.setPhysicsQuality(this.physicsQuality);
  }

  /**
   * Whether the physics layer will throw the squad's own dead (D43).
   *
   * A second switch rather than a share of `setPhysicsQuality`, because it is a
   * second fact: the layer can be at full quality and still have no mage pool
   * to throw them with (`PhysicsLayer.throwsUnits`), and the crowd has to keep
   * drawing those deaths itself when it has.
   */
  setUnitRagdolls(enabled: boolean): void {
    this.views?.squad.setRagdolls(enabled);
  }

  /**
   * Hands the units that fell this frame to `sink`, and forgets them.
   *
   * The frame loop calls it between the render and the physics step: the crowd
   * view is the only thing that sees a squad death (the sim frees an index and
   * emits nothing) and the physics layer is the only thing that can throw one,
   * and they may not know about each other (D18, and render never reaches out
   * of the scene). So the app carries the four numbers across.
   */
  drainFallenUnits(sink: (x: number, z: number, vx: number, vz: number) => void): void {
    this.views?.squad.drainFallen(sink);
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

  /**
   * Repaints the scene in a biome (D49), and answers whether it had to; the
   * sequence itself is `repaintBiome` in `./rendererLevel.ts`.
   *
   * `warm` is false for a crossing *inside* a run (D52's endless road): both
   * biomes were compiled at boot precisely so a boundary costs nothing, and a
   * readiness pass over every material in the scene every two hundred metres
   * would be the stall this is supposed to avoid.
   */
  setBiome(id: BiomeId, warm = true): boolean {
    if (this.disposed) return false;
    // The renderer's own record, not the palette's answer: `init` switches the
    // palette before any view exists, so a first level on a pinned biome would
    // find the palette already there and skip the fan-out the views still need.
    if (id === this.biome) return false;
    this.biome = id;
    repaintBiome(this.sceneRef, this.views, id);
    if (warm) void this.warmUp();
    return true;
  }

  /** Which biome the scene is painted in. The debug panel prints it. */
  get biomeId(): BiomeId {
    return this.biome;
  }

  /** Builds the road for this level and hands every pool back to its owner. */
  loadLevel(level: LevelDef): void {
    if (this.disposed) return;
    // Which biomes this road runs through, and how long a span of one is: a
    // campaign level has one for its whole length and the endless road
    // alternates (D52). Set before the biome below, because a spanned road's
    // first biome is the span the squad starts in rather than the level's.
    this.spans.setLevel(level, this.forcedBiome);
    // Before the views are handed the level: the road's extent, the roadside's
    // layout and the arena all land inside `loadLevel`, and they have to land
    // on the biome this level is set in (`./biome.ts`).
    this.setBiome(biomeOfLevel(level, this.forcedBiome));
    // The road's near and far halves, for a spanned road; a no-op otherwise.
    this.views?.road.setSpans(this.spans.biomes, this.spans.span);
    applySpan(this.spans, 0, true, this.setSpanBiome, this.sceneRef, this.views);
    loadLevelInto(this.views, this.rig, level, this.spans);
  }

  /**
   * Called every frame after `Run.tick`. `events` are the events from that same
   * tick, in the order the sim produced them; they start animations, while every
   * position comes from `state`. Safe to call before `loadLevel`.
   *
   * `dt` is sim time, which the app scales for hit-stop and slow-mo, so every
   * animation here is driven by it rather than by the frame clock. The draw
   * order itself is `./rendererFrame.ts`.
   */
  update(state: RunState, events: readonly SimEvent[], dt: number): void {
    if (this.disposed) return;
    const scene = this.sceneRef;
    const views = this.views;
    const rig = this.rig;
    if (scene === null || views === null || rig === null) return;

    drawFrame({ views, rig, preview: this.preview, timeScale: this.timeScale(dt) }, state, events, dt);

    // After the frame is written and before it is drawn: the camera has been
    // posed by `drawFrame`, and which span it now stands in is what decides the
    // biome this frame is painted in (D52).
    applySpan(this.spans, rig.camera.position.z, false, this.setSpanBiome, scene, views);

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
    this.views?.events.apply(events);
  }

  resize(): void {
    this.engine?.resize();
    this.applyPixelRatio();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.views?.dispose();
    this.views = null;
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
    return Math.min(screenPixelRatio(), this.maxPixelRatio);
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
