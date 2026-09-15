/**
 * The Babylon layer. Owner: render agent (Phase B2).
 *
 * Rules (docs/03-milestone-1-plan.md):
 *   - Babylon is imported here and nowhere else outside `src/render`.
 *   - Render reads sim state; it never mutates it.
 *   - Every mesh, material and label is allocated in `init`; `loadLevel` hands
 *     them out and `update` only writes transforms. Nothing is created per frame.
 *
 * This file is the object the app holds: its lifecycle and its public API.
 * What it used to carry inline is five files around it — `./views.ts` is every
 * view, `./rendererBoot.ts` the order they are built in, `./rendererLevel.ts`
 * what a level load and a biome switch do to them (and which biome that is),
 * `./rendererFrame.ts` the order they are written in every frame,
 * `./rendererQuality.ts` the dials the degrade ladder turns, and
 * `./rendererStats.ts` what is measured off the result.
 *
 * Deep imports (`@babylonjs/core/...`) rather than the package root, so the
 * single-file artifact build stays small.
 */

import type { Engine } from '@babylonjs/core/Engines/engine';
import type { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import type { Scene } from '@babylonjs/core/scene';

import { biomeOfLevel } from './biome';
import type { CameraRig } from './camera';
import { reuploadThinInstances, watchContextLoss } from './contextLoss';
import { SceneTints } from './cosmetics';
import { PreviewBackdrop } from './preview';
import { bootScene } from './rendererBoot';
import { drawFrame, drawSquadOnly, poseStressCamera, timeScaleOf } from './rendererFrame';
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
import { RoadBiomes, applySpan, loadLevelInto } from './rendererLevel';
import {
  DEFAULT_MAX_PIXEL_RATIO,
  applyPixelRatio,
  clampPhysicsQuality,
  effectivePixelRatio,
} from './rendererQuality';
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
  /**
   * The GPU took the context away, and gave it back (`./contextLoss.ts`). The
   * renderer stops drawing in between on its own; these are for the owner of
   * the frame loop, which has to stop *asking* for frames and start again.
   * Both are optional, so a dev scene or a test can leave them out.
   */
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly preserveDrawingBuffer: boolean;
  private maxPixelRatio: number;
  /** Which biome the scene is painted in, and where the road changes it
   *  (`./rendererLevel.ts`). */
  private readonly biomes: RoadBiomes;

  private engine: Engine | null = null;
  private sceneRef: Scene | null = null;
  private rig: CameraRig | null = null;
  private instrumentation: SceneInstrumentation | null = null;

  /** Every view in the scene, built in `init` (`./views.ts`). */
  private views: SceneViews | null = null;

  /** Who draws a death, mirrored from the physics layer by `setPhysicsQuality`
   *  and 0 until it lands (`./rendererQuality.ts`). */
  private physicsQuality = 0;

  /** The Academy backdrop, when one is up; see `./preview.ts`. */
  private readonly preview = new PreviewBackdrop();

  /** The tints the squad, the wisp and the spells are wearing (D53). */
  private readonly tints = new SceneTints();

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

  /** True between `webglcontextlost` and the end of Babylon's rebuild. */
  private contextLost = false;
  /** Takes the two listeners and the observer off again; see `./contextLoss.ts`. */
  private unwatchContext: (() => void) | null = null;
  private readonly onContextLost: (() => void) | undefined;
  private readonly onContextRestored: (() => void) | undefined;

  constructor(canvas: HTMLCanvasElement, options: RendererOptions = {}) {
    this.canvas = canvas;
    this.maxPixelRatio = Math.max(1, options.maxPixelRatio ?? DEFAULT_MAX_PIXEL_RATIO);
    this.preserveDrawingBuffer = options.preserveDrawingBuffer ?? false;
    this.biomes = new RoadBiomes(options.biome);
    this.onContextLost = options.onContextLost;
    this.onContextRestored = options.onContextRestored;
  }

  async init(): Promise<void> {
    // Before anything is built: a level load that changes biome afterwards goes
    // through `setBiome` (`RoadBiomes.begin`).
    const biome = this.biomes.begin();

    const context = await bootScene({
      canvas: this.canvas,
      preserveDrawingBuffer: this.preserveDrawingBuffer,
      effectivePixelRatio: effectivePixelRatio(this.maxPixelRatio),
      biome,
      shake: (strength, seconds) => {
        this.shake(strength, seconds);
      },
    });
    this.engine = context.engine;
    this.sceneRef = context.scene;
    this.instrumentation = context.instrumentation;
    this.rig = context.rig;
    this.views = context.views;

    // Before the warm-up rather than after it: a context lost during the boot
    // pass is exactly the case a phone under memory pressure produces, and an
    // unwatched loss there is a black screen with no way back.
    this.unwatchContext = watchContextLoss(this.canvas, context.engine, {
      onLost: () => {
        this.handleContextLost();
      },
      onRestored: () => {
        this.handleContextRestored();
      },
    });

    // Last: every pooled material compiled while the title screen is still
    // being put together, so the first bolt, the first gate and the first
    // ragdoll of a run do not each cost a frame (`./warmup.ts`).
    await this.warmUp();
  }

  /**
   * True while the GPU context is gone. The frame loop is paused by the app in
   * that window, and `update` draws nothing even if something asks.
   */
  get isContextLost(): boolean {
    return this.contextLost;
  }

  /** Whether the frame loop can stop asking for frames (`./preview.ts`). */
  isSettled(): boolean {
    return this.preview.settled(this.rig);
  }

  /** The Academy's backdrop, for this player or `null` (`./preview.ts`). */
  setPreviewPlayer(player: PlayerState | null): void {
    this.preview.setPlayerOn(player, this.rig);
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
    this.tints.apply(player, this.views);
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

  /** The stress scene's camera pose; see `poseStressCamera`. */
  poseCamera(squad: SquadState, dt: number): void {
    if (this.disposed) return;
    poseStressCamera(this.rig, squad, dt);
  }

  /** The stress scene's cut-down frame; see `drawSquadOnly`. */
  drawSquad(state: RunState, dt: number): void {
    if (this.disposed) return;
    const views = this.views;
    if (views === null) return;
    drawSquadOnly(views, state, dt);
  }

  /** The physics layer's quality, mirrored here because it decides who draws a
   *  death (`./rendererQuality.ts`). */
  setPhysicsQuality(quality: number): void {
    this.physicsQuality = clampPhysicsQuality(quality);
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
    if (!this.biomes.switchTo(id, this.sceneRef, this.views)) return false;
    if (warm) void this.warmUp();
    return true;
  }

  /** Which biome the scene is painted in. The debug panel prints it, and the
   *  smoke reads it across an endless road's boundaries (D52). */
  get biomeId(): BiomeId {
    return this.biomes.id;
  }

  /** Builds the road for this level and hands every pool back to its owner. */
  loadLevel(level: LevelDef): void {
    if (this.disposed) return;
    // Which biomes this road runs through, and how long a span of one is: a
    // campaign level has one for its whole length and the endless road
    // alternates (D52). Set before the biome below, because a spanned road's
    // first biome is the span the squad starts in rather than the level's.
    const spans = this.biomes.spans;
    spans.setLevel(level, this.biomes.forced);
    // Before the views are handed the level: the road's extent, the roadside's
    // layout and the arena all land inside `loadLevel`, and they have to land
    // on the biome this level is set in (`./biome.ts`).
    this.setBiome(biomeOfLevel(level, this.biomes.forced));
    // The road's near and far halves, for a spanned road; a no-op otherwise.
    this.views?.road.setSpans(spans.biomes, spans.span);
    applySpan(spans, 0, true, this.setSpanBiome, this.sceneRef, this.views);
    loadLevelInto(this.views, this.rig, level, spans);
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
    if (this.disposed || this.contextLost) return;
    const scene = this.sceneRef;
    const views = this.views;
    const rig = this.rig;
    if (scene === null || views === null || rig === null) return;

    const timeScale = timeScaleOf(this.engine, dt);
    drawFrame({ views, rig, preview: this.preview, timeScale }, state, events, dt);

    // After the frame is written and before it is drawn: the camera has been
    // posed by `drawFrame`, and which span it now stands in is what decides the
    // biome this frame is painted in (D52).
    applySpan(this.biomes.spans, rig.camera.position.z, false, this.setSpanBiome, scene, views);

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

    this.unwatchContext?.();
    this.unwatchContext = null;
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

  /** The backing store, at the screen's ratio under our cap
   *  (`./rendererQuality.ts`). */
  private applyPixelRatio(): void {
    applyPixelRatio(this.engine, effectivePixelRatio(this.maxPixelRatio));
  }

  /**
   * The GPU took the context away. Every `update` from here is dropped, and the
   * app is told so it can stop asking for frames; the scene graph, the pools
   * and the run itself are untouched, because none of them is on the GPU.
   */
  private handleContextLost(): void {
    if (this.contextLost) return;
    this.contextLost = true;
    // Not `console.error`: a lost context is a normal thing for iOS to do, and
    // an error would fail the smoke test (`scripts/smoke-browser.mjs`).
    console.warn('[arcane-rush] WebGL context lost; frames are paused');
    this.onContextLost?.();
  }

  /**
   * Babylon has rebuilt its side (`./contextLoss.ts` lists what that covers).
   * What is left is ours: the backing store's size, which is set through the
   * engine rather than the canvas, and the materials, which Babylon would
   * otherwise recompile one at a time inside the player's first frames back.
   */
  private handleContextRestored(): void {
    if (!this.contextLost || this.disposed) return;
    this.contextLost = false;

    this.engine?.resize();
    this.applyPixelRatio();
    // The roadside, the arena walls and everything else whose matrices were
    // written once at a level load. Babylon cannot do this one; see
    // `reuploadThinInstances` for the measurement and the reason.
    const scene = this.sceneRef;
    if (scene !== null) {
      const meshes = reuploadThinInstances(scene);
      console.warn(`[arcane-rush] re-uploaded ${String(meshes)} thin-instance buffers`);
    }
    // Not awaited: the app is about to start drawing again, and a warm-up is
    // idempotent — a material that is already ready resolves on the first check
    // (`./warmup.ts`).
    void this.warmUp();
    this.onContextRestored?.();
  }
}
