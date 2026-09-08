/**
 * App state machine: `title -> playing -> result`.
 *
 * Owns the canvas, the renderer, the physics layer, the audio, one `Run` at a
 * time, the frame loop and the `window.__arcane` debug handle the smoke test
 * drives. Everything visual is delegated to `src/ui` and `src/render`;
 * everything about the game is delegated to `@/sim`.
 *
 * Two clocks run here and they must not be confused:
 *
 *   frameDt   real seconds since the last frame. Physics, every juice timer and
 *             the result-screen countdown run on this.
 *   scaledDt  `frameDt * timeScale`, then multiplied by `?turbo` inside the sim
 *             step. The sim and the renderer run on this, which is what makes
 *             hit-stop and slow-mo affect the game rather than an animation.
 */

import { GameAudio } from '@/audio';
import { balance, levelConfig, levelCount } from '@/data';
import { PhysicsLayer } from '@/physics';
import { Renderer } from '@/render/Renderer';
import { runRenderDevScene } from '@/render/dev-scene';
import { createBot, generateLevel, Run, weaponOf } from '@/sim';
import type { LevelDef, RunState, SimEvent } from '@/sim';
import { Overlay } from '@/ui';
import type { DebugStats } from '@/ui';

import { attachInput } from './input';
import type { DetachInput } from './input';
import { Juice } from './juice';
import { PhysicsEventQueue } from './physicsEvents';
import { clampLevel, parseQuery } from './query';
import type { QueryOptions } from './query';
import { loadSave, setMuted, unlockLevel } from './save';
import { runStressScene } from './stress';
import type { StressHandle } from './stress';

export type AppPhase = 'title' | 'playing' | 'result';

/** The handle `scripts/smoke.mjs` and manual debugging use. Keep it stable. */
export interface ArcaneDebugHandle {
  ready: boolean;
  app: App;
  run: () => Run | null;
  state: () => Readonly<RunState> | null;
  /** Null until `init` finishes, and when `?physics=0` skipped it. */
  physics: () => PhysicsLayer | null;
}

declare global {
  // `var` is required here: this is a global augmentation, not a declaration.
  var __arcane: ArcaneDebugHandle | undefined;
}

/** Frame delta is clamped so a backgrounded tab cannot teleport the squad. */
const MAX_FRAME_DT = 0.05;

/**
 * Largest sim step a single `tick` is given, even under `?turbo`. The sim's own
 * accumulator would clamp a longer step anyway, and keeping chunks small means a
 * fast-forwarded run resolves collisions exactly as a real-time one does.
 */
const MAX_SIM_CHUNK = 0.05;

/** Shared empty list, so an idle frame allocates nothing. */
const NO_EVENTS: readonly SimEvent[] = [];

/** Wall clock for the debug panel's cost readouts; never used by the sim. */
const now = (): number =>
  typeof performance === 'undefined' ? 0 : performance.now();

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly overlay: Overlay;
  private readonly renderer: Renderer;
  private readonly audio: GameAudio;
  private readonly options: QueryOptions;

  private physics: PhysicsLayer | null = null;
  private stress: StressHandle | null = null;
  /** `?scene=render-test`'s own loop, so `dispose` can stop it. Structural on
   * purpose: the handle's shape is the render agent's to change. */
  private devScene: { stop: () => void } | null = null;

  private readonly juice: Juice;
  private readonly physicsEvents = new PhysicsEventQueue();

  private phase: AppPhase = 'title';
  private run: Run | null = null;
  private bot: ((state: RunState) => number) | null = null;
  private detachInput: DetachInput | null = null;
  private muted: boolean;

  /**
   * A never-ticked run whose state backs the title screen, so the renderer has
   * a real level to show behind the menu instead of an empty scene.
   */
  private preview: Run | null = null;

  /** The level the renderer and the physics layer are currently loaded with. */
  private level: LevelDef | null = null;

  private rafId: number | null = null;
  private lastFrameTime = 0;
  private endCountdown: number | null = null;

  /**
   * Whether the title screen's frame still needs drawing. The preview run never
   * ticks, so once the camera has eased into place the scene is identical frame
   * to frame and `scene.render` is pure heat; anything that can change it
   * (a new preview, a resize) arms this again.
   */
  private previewDirty = true;

  /** Last quality handed to the renderer, so the mirror only fires on a change. */
  private mirroredQuality = -1;

  /** Set by `dispose`, so the loads still in flight there hand back their work. */
  private disposed = false;

  /** Re-used every frame: the debug panel reads it, nothing else may write it. */
  private readonly stats: DebugStats = {
    simMs: 0,
    renderMs: 0,
    physicsMs: 0,
    drawCalls: 0,
    timeScale: 1,
    ragdolls: 0,
    shards: 0,
    physicsQuality: 0,
    audio: 'off',
  };

  constructor(canvas: HTMLCanvasElement, overlayRoot: ParentNode, search: string) {
    this.canvas = canvas;
    this.options = parseQuery(search, levelCount);
    this.muted = this.options.muted;
    this.renderer = new Renderer(canvas);
    this.juice = new Juice(canvas, this.renderer, this.options.turbo === 1);
    this.audio = new GameAudio({ muted: this.muted });
    this.overlay = new Overlay(overlayRoot, {
      onPlay: () => {
        this.startRun();
      },
      onRetry: () => {
        this.startRun();
      },
      onNext: () => {
        this.startLevel(this.options.level + 1);
      },
      onSelectLevel: (level: number) => {
        this.selectLevel(level);
      },
      onLevels: () => {
        this.showTitle();
      },
      onTap: () => {
        // Every button is a user gesture, which is the only moment a browser
        // lets an audio context start. Play is the one the plan names; the
        // others cost nothing once it is already running.
        this.audio.unlock();
        this.audio.playTap();
      },
      onToggleMute: () => {
        this.setMuted(!this.muted);
      },
      onCountTick: () => {
        this.audio.playTick();
      },
    });
  }

  /** Boots the renderer, then flips `window.__arcane.ready` for the smoke test. */
  async start(): Promise<void> {
    await this.renderer.init();

    window.addEventListener('resize', this.onResize);
    this.detachInput = attachInput(this.canvas, this.onDragDeltaPixels, {
      // A scripted bot owns `targetX`; a stray drag must not fight it.
      enabled: () => this.phase === 'playing' && this.bot === null,
    });
    this.overlay.setDebugEnabled(this.options.debug);
    this.overlay.setMuted(this.muted);

    if (this.options.scene !== 'game') {
      // The dev scenes bypass the state machine entirely: they drive the
      // renderer themselves, so no run, no HUD and no frame loop here.
      this.overlay.hideAll();
      if (this.options.scene === 'render-test') {
        this.devScene = runRenderDevScene(this.renderer);
      } else {
        this.stress = await runStressScene(this.renderer, {
          quality: this.options.physicsQuality,
        });
      }
      this.publishHandle();
      return;
    }

    this.showTitle();
    this.publishHandle();

    // Neither is awaited: two megabytes of Havok and twenty audio clips must
    // not hold the title screen back. Both attach themselves to whatever level
    // is loaded by the time they arrive, and nothing can play a sound before
    // the first tap anyway.
    void this.initPhysics();
    void this.audio.load();

    if (this.rafId === null) this.rafId = requestAnimationFrame(this.frame);
  }

  /** `'title' | 'playing' | 'result'` — the state machine's current node. */
  status(): AppPhase {
    return this.phase;
  }

  /** Jumps straight into a level, ignoring the save's unlock state. */
  startLevel(level: number): void {
    this.options.level = clampLevel(level, levelCount);
    this.startRun();
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.detachInput?.();
    this.detachInput = null;
    window.removeEventListener('resize', this.onResize);
    this.stress?.dispose();
    this.stress = null;
    this.devScene?.stop();
    this.devScene = null;
    this.overlay.dispose();
    this.audio.dispose();
    // Before the renderer: the layer's bodies and meshes live in its scene.
    this.physics?.dispose();
    this.physics = null;
    this.renderer.dispose();
    if (globalThis.__arcane?.app === this) globalThis.__arcane = undefined;
  }

  /**
   * Havok, or nothing. A failed init is a downgrade and not a crash: the hosted
   * single-file build cannot fetch the WASM until Phase C inlines it, and a
   * phone that cannot afford physics should still play the game.
   */
  private async initPhysics(): Promise<void> {
    const physics = new PhysicsLayer(this.renderer.scene, {
      quality: this.options.physicsQuality,
    });
    try {
      await physics.init();
    } catch (error: unknown) {
      console.warn('[arcane-rush] physics unavailable, running without debris', error);
      physics.setQuality(0);
    }
    if (this.disposed) {
      // The app went away while Havok was loading; nothing else will free it.
      physics.dispose();
      return;
    }
    this.physics = physics;
    this.mirrorPhysicsQuality();
    // Whatever is on screen was loaded before this finished, so the road
    // collider is built now rather than at the next `loadLevel`.
    if (this.level !== null) physics.loadLevel(this.level);
  }

  private publishHandle(): void {
    const handle: ArcaneDebugHandle = {
      ready: true,
      app: this,
      run: () => this.run,
      state: () => this.run?.state ?? null,
      physics: () => this.physics,
    };
    globalThis.__arcane = handle;
  }

  private showTitle(): void {
    this.phase = 'title';
    this.run = null;
    this.bot = null;
    this.endCountdown = null;
    this.juice.reset();

    this.loadPreview();
    this.overlay.showTitle({
      levelCount,
      unlockedLevel: Math.min(levelCount, loadSave().unlockedLevel),
      selectedLevel: this.options.level,
    });
  }

  private selectLevel(level: number): void {
    if (this.phase !== 'title') return;
    this.options.level = clampLevel(level, levelCount);
    this.showTitle();
  }

  /** Builds the level shown behind the title screen and hands it to the renderer. */
  private loadPreview(): void {
    const level = this.buildLevel();
    this.preview = new Run(level, balance);
    this.renderer.loadLevel(level);
    this.physics?.loadLevel(level);
    this.renderer.update(this.preview.state, NO_EVENTS, 0);
    this.previewDirty = true;
  }

  private startRun(): void {
    // The next title screen draws a fresh preview whatever happens here.
    this.previewDirty = true;
    const level = this.buildLevel();
    const seed = level.seed;

    this.run = new Run(level, balance);
    this.preview = null;
    // Constructed once per run: the policy carries its own RNG stream, so
    // rebuilding it every tick would reset that stream and break determinism.
    this.bot = this.options.bot === null ? null : createBot(this.options.bot, seed);
    this.endCountdown = null;
    this.juice.reset();
    this.audio.beginRun();

    this.renderer.loadLevel(level);
    this.physics?.loadLevel(level);
    this.phase = 'playing';
    this.overlay.showPlaying(this.options.level, weaponOf(this.run.state.squad));

    this.lastFrameTime = 0;
    if (this.rafId === null) this.rafId = requestAnimationFrame(this.frame);
  }

  private buildLevel(): LevelDef {
    const config = levelConfig(this.options.level);
    const level = generateLevel(this.options.level, config, this.options.seed ?? config.seed);
    this.level = level;
    return level;
  }

  private setMuted(muted: boolean): void {
    this.muted = muted;
    setMuted(muted);
    this.audio.setMuted(muted);
    this.overlay.setMuted(muted);
  }

  private readonly frame = (time: number): void => {
    this.rafId = requestAnimationFrame(this.frame);

    // Two real deltas: the clamped one drives the game, the raw one drives the
    // result-screen countdown. Clamping the countdown would make it frame-rate
    // dependent — a beat of 0.8 s takes sixteen seconds at one frame a second,
    // which is what a software rasteriser gives a big crowd.
    const realDt = this.lastFrameTime === 0 ? 0 : (time - this.lastFrameTime) / 1000;
    const frameDt = Math.min(MAX_FRAME_DT, realDt);
    this.lastFrameTime = time;

    this.juice.advance(frameDt);
    const scaledDt = frameDt * this.juice.scale;

    const run = this.run;
    if (run === null) {
      const preview = this.preview;
      if (preview !== null && this.previewDirty) {
        this.renderer.update(preview.state, NO_EVENTS, scaledDt);
        this.previewDirty = !this.renderer.isSettled();
      }
      // Real time, always: debris left over from the last run has to settle
      // rather than hang in the air behind the menu.
      this.physics?.update(frameDt);
      this.updateDebug(null, NO_EVENTS, frameDt);
      return;
    }

    const simStart = now();
    const events = this.stepSim(run, scaledDt);
    const renderStart = now();
    this.renderer.update(run.state, events, scaledDt);
    const physicsStart = now();
    this.stepPhysics(run.state, frameDt);
    const physicsEnd = now();

    this.stats.simMs = renderStart - simStart;
    this.stats.renderMs = physicsStart - renderStart;
    this.stats.physicsMs = physicsEnd - physicsStart;

    this.juice.apply();
    this.stats.timeScale = this.juice.scale;
    this.overlay.updateHud(run.state, events);
    this.updateDebug(run.state, events, frameDt);

    if (this.phase === 'playing') this.advanceEnding(run, realDt);
  };

  /**
   * Advances the sim by `dt * turbo`, split into ticks of at most
   * `MAX_SIM_CHUNK`, and returns the last tick's events for the render call.
   *
   * Only the last array survives: the sim pools its event objects and the next
   * `tick` overwrites them, so every earlier chunk hands its events to the
   * renderer and the HUD right away instead of being concatenated. That keeps
   * the count, the bump animation and the gate flashes correct at any speed.
   * The physics layer is the exception — it runs once a frame — so every chunk
   * copies what it needs into `physicsEvents`.
   */
  private stepSim(run: Run, dt: number): readonly SimEvent[] {
    this.physicsEvents.clear();
    this.juice.beginFrame();

    const total = dt * this.options.turbo;
    const chunks = Math.max(1, Math.ceil(total / MAX_SIM_CHUNK));
    const chunkDt = total / chunks;

    let events: readonly SimEvent[] = NO_EVENTS;
    for (let i = 0; i < chunks; i++) {
      if (this.bot !== null && run.state.status === 'running') run.setTargetX(this.bot(run.state));
      events = run.tick(chunkDt);

      this.physicsEvents.absorb(events);
      this.audio.onEvents(events, run.state);
      this.juice.scan(events);
      if (i === chunks - 1) break;

      this.renderer.absorbEvents(events);
      this.overlay.updateHud(run.state, events);
      // dt 0: an intermediate chunk drew no frame, so it must not move the
      // panel's frame-rate average.
      this.updateDebug(run.state, events, 0);
    }
    return events;
  }

  /** Debris runs on real frame time and after the render, never on sim time. */
  private stepPhysics(state: RunState | null, frameDt: number): void {
    const physics = this.physics;
    if (physics === null) return;
    if (state !== null) physics.onEvents(this.physicsEvents.events, state);
    physics.update(frameDt);
    this.mirrorPhysicsQuality();
  }

  /** The degrade ladder lives in the physics layer; the renderer follows it. */
  private mirrorPhysicsQuality(): void {
    const quality = this.physics?.stats.quality ?? 0;
    if (quality === this.mirroredQuality) return;
    this.mirroredQuality = quality;
    this.renderer.setPhysicsQuality(quality);
  }

  private updateDebug(
    state: Readonly<RunState> | null,
    events: readonly SimEvent[],
    dt: number,
  ): void {
    if (!this.overlay.debugEnabled) return;

    const physics = this.physics;
    this.stats.drawCalls = this.renderer.drawCalls;
    this.stats.ragdolls = physics?.stats.ragdolls ?? 0;
    this.stats.shards = physics?.stats.shards ?? 0;
    this.stats.physicsQuality = physics?.stats.quality ?? 0;
    this.stats.audio = this.muted ? `${this.audio.status} muted` : this.audio.status;

    this.overlay.updateDebug(state, events, dt, this.phase, this.stats);
  }

  /**
   * Holds the result screen back for a beat so the killing blow is visible.
   * `dt` is unclamped wall-clock time: the beat is a beat, not a frame count.
   */
  private advanceEnding(run: Run, dt: number): void {
    if (this.endCountdown === null) {
      if (run.state.status === 'running') return;

      this.endCountdown = balance.ui.resultDelay;
      // Unlock as soon as the run is won, not when the player taps Ascend: a
      // player who closes the tab on the result screen keeps their progress.
      if (run.state.status === 'won' && this.options.level < levelCount) {
        unlockLevel(this.options.level + 1);
      }
      return;
    }

    this.endCountdown -= dt;
    if (this.endCountdown > 0) return;

    this.endCountdown = null;
    this.phase = 'result';
    this.juice.endDefeatCrawl();
    this.overlay.showResult({
      levelIndex: this.options.level,
      won: run.state.status === 'won',
      survivors: run.state.survivors,
      peakCount: run.state.peakCount,
      canAdvance: this.options.level < levelCount,
    });
  }

  private readonly onResize = (): void => {
    this.renderer.resize();
    // The canvas just changed size, so whatever is on it is stale.
    this.previewDirty = true;
  };

  /**
   * Pixels to road meters: a full screen width of drag moves the squad
   * `balance.input.sensitivity` meters. Tuning stays in `src/data`.
   */
  private readonly onDragDeltaPixels = (deltaXPixels: number): void => {
    const run = this.run;
    if (run === null || this.phase !== 'playing') return;

    const width = this.canvas.clientWidth || window.innerWidth || 1;
    const meters = (deltaXPixels / width) * balance.input.sensitivity;
    run.setTargetX(run.state.squad.targetX + meters);
  };
}
