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

import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';

import { BossView } from './boss';
import { EnemyView } from './enemies';
import { GateView } from './gates';
import { LabelLayer } from './labels';
import { ProjectileView } from './projectiles';
import { RoadView } from './road';
import { SquadView } from './squad';
import { CAMERA, FOG_END, FOG_START, SKY } from './theme';
import type { LevelDef, RunState, SimEvent } from '@/sim';

export interface RendererOptions {
  /**
   * Ceiling on the device pixel ratio the scene renders at. Phones ship 3x and
   * 4x screens; past 2x the extra pixels cost frames and buy nothing on a
   * greybox scene.
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

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly maxPixelRatio: number;

  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private camera: UniversalCamera | null = null;

  private labels: LabelLayer | null = null;
  private road: RoadView | null = null;
  private squad: SquadView | null = null;
  private projectiles: ProjectileView | null = null;
  private gates: GateView | null = null;
  private enemies: EnemyView | null = null;
  private boss: BossView | null = null;

  /** Scratch vectors: `update` runs 60 times a second and must not allocate. */
  private readonly cameraTarget = new Vector3(0, CAMERA.lookHeight, CAMERA.lookAhead);
  private cameraReady = false;
  private cameraSettled = false;

  private disposed = false;

  constructor(canvas: HTMLCanvasElement, options: RendererOptions = {}) {
    this.canvas = canvas;
    this.maxPixelRatio = Math.max(1, options.maxPixelRatio ?? DEFAULT_MAX_PIXEL_RATIO);
  }

  async init(): Promise<void> {
    const engine = createEngine(this.canvas);
    this.engine = engine;
    this.applyPixelRatio();

    const scene = new Scene(engine);
    scene.clearColor = new Color4(SKY.r, SKY.g, SKY.b, 1);
    // Linear fog to the sky colour: the road has to end somewhere, and a haze
    // is cheaper and calmer than a skybox.
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = SKY.clone();
    scene.fogStart = FOG_START;
    scene.fogEnd = FOG_END;
    this.scene = scene;

    const camera = new UniversalCamera('camera', new Vector3(0, CAMERA.height, -CAMERA.behind), scene);
    camera.fov = CAMERA.fov;
    camera.minZ = 0.2;
    camera.maxZ = 220;
    // No input: the squad is driven by the sim, and a stray gesture must never
    // move the camera.
    camera.inputs.clear();
    camera.setTarget(this.cameraTarget);
    this.camera = camera;

    const sky = new HemisphericLight('sky', new Vector3(0.2, 1, -0.15), scene);
    sky.intensity = 0.85;
    sky.diffuse = new Color3(1, 0.98, 0.94);
    sky.groundColor = new Color3(0.28, 0.3, 0.36);

    const sun = new DirectionalLight('sun', new Vector3(-0.35, -1, 0.5), scene);
    sun.intensity = 1.1;
    sun.diffuse = new Color3(1, 0.95, 0.85);

    const labels = new LabelLayer(scene);
    this.labels = labels;
    this.road = new RoadView(scene);
    this.squad = new SquadView(scene);
    this.projectiles = new ProjectileView(scene);
    this.gates = new GateView(scene, labels);
    this.enemies = new EnemyView(scene, labels);
    this.boss = new BossView(scene, labels);

    // A default stretch of road, so the very first frame — which the app draws
    // behind the title screen before any level exists — is not empty sky.
    this.road.setExtent(ROAD_START_Z, 200, 168);

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
    return this.cameraSettled;
  }

  /** Builds the road for this level and hands every pool back to its owner. */
  loadLevel(level: LevelDef): void {
    if (this.disposed) return;
    this.road?.setExtent(ROAD_START_Z, level.arenaZ + ROAD_PAST_ARENA, level.arenaZ);
    this.squad?.reset();
    this.projectiles?.reset();
    this.gates?.reset();
    this.enemies?.reset();
    this.boss?.reset();
    this.cameraReady = false;
    this.cameraSettled = false;
  }

  /**
   * Called every frame after `Run.tick`. `events` are the events from that same
   * tick, in the order the sim produced them; they start animations, while every
   * position comes from `state`. Safe to call before `loadLevel`.
   */
  update(state: RunState, events: readonly SimEvent[], dt: number): void {
    if (this.disposed) return;
    const scene = this.scene;
    if (scene === null) return;

    this.applyEvents(events);

    this.squad?.update(state.squad, dt);
    this.projectiles?.update(state.projectiles);
    this.gates?.update(state, dt);
    this.enemies?.update(state, dt);
    this.boss?.update(state.boss, state.squad.z, dt);

    this.updateCamera(state, dt);

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
    this.gates?.dispose();
    this.enemies?.dispose();
    this.boss?.dispose();
    this.road?.dispose();
    this.labels?.dispose();

    this.squad = null;
    this.projectiles = null;
    this.gates = null;
    this.enemies = null;
    this.boss = null;
    this.road = null;
    this.labels = null;
    this.camera = null;

    this.scene?.dispose();
    this.scene = null;
    this.engine?.dispose();
    this.engine = null;
  }

  private applyEvents(events: readonly SimEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'gateHit':
          this.gates?.onHit(event.gateId);
          break;
        case 'gatePassed':
          this.gates?.onPassed(event.gateId);
          break;
        case 'enemyHit':
          this.enemies?.onHit(event.enemyId);
          break;
        case 'enemyKilled':
          if (event.kind === 'boss') this.boss?.onKilled();
          else this.enemies?.onKilled(event.enemyId);
          break;
        case 'bossStomp':
          this.boss?.onStomp(event.x, event.z);
          break;
        case 'bossKilled':
          this.boss?.onKilled();
          break;
        default:
          // Everything else (fired, activated, gained, lost, ended) is already
          // visible through `RunState`; the UI layer owns the rest.
          break;
      }
    }
  }

  /**
   * Behind and above the squad, easing toward the ideal pose so a fast lateral
   * drag does not snap the whole world sideways, and pulling back as the squad
   * grows so a 300-unit blob still fits in frame.
   */
  private updateCamera(state: RunState, dt: number): void {
    const camera = this.camera;
    if (camera === null) return;

    const squad = state.squad;
    const pullback = Math.min(CAMERA.pullbackMax, squad.count * CAMERA.pullbackPerUnit);
    const lateral = squad.x * CAMERA.lateralFollow;

    const wantX = lateral;
    const wantY = CAMERA.height + pullback;
    const wantZ = squad.z - CAMERA.behind - pullback;

    // A fresh level snaps; every other frame eases at a rate independent of
    // frame time, so 30 fps and 120 fps feel the same.
    const blend = this.cameraReady ? 1 - Math.exp(-CAMERA.smoothing * dt) : 1;
    this.cameraReady = true;

    const dx = (wantX - camera.position.x) * blend;
    const dy = (wantY - camera.position.y) * blend;
    const dz = (wantZ - camera.position.z) * blend;
    camera.position.x += dx;
    camera.position.y += dy;
    camera.position.z += dz;
    this.cameraSettled = Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < CAMERA.settleEpsilon;

    this.cameraTarget.set(lateral, CAMERA.lookHeight, squad.z + CAMERA.lookAhead);
    camera.setTarget(this.cameraTarget);
  }

  /** Caps the backing-store resolution; `1 / level` is the effective ratio. */
  private applyPixelRatio(): void {
    const engine = this.engine;
    if (engine === null) return;
    const deviceRatio = typeof window === 'undefined' ? 1 : (window.devicePixelRatio || 1);
    engine.setHardwareScalingLevel(1 / Math.min(deviceRatio, this.maxPixelRatio));
  }
}

/**
 * SwiftShader in headless Chromium can refuse a WebGL2 context. Try the normal
 * antialiased WebGL2 engine first, then fall back to WebGL1 without
 * antialiasing rather than letting the whole app fail to boot.
 */
function createEngine(canvas: HTMLCanvasElement): Engine {
  try {
    return new Engine(
      canvas,
      true,
      {
        disableWebGL2Support: false,
        preserveDrawingBuffer: true,
        stencil: true,
        antialias: true,
        powerPreference: 'high-performance',
      },
      true,
    );
  } catch (error) {
    console.warn('[render] WebGL2 engine failed, falling back to WebGL1', error);
    return new Engine(canvas, false);
  }
}
