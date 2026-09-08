/**
 * App state machine: `title -> playing -> result`.
 *
 * Owns the canvas, the renderer, one `Run` at a time, the frame loop and the
 * `window.__arcane` debug handle the smoke test drives. Everything visual is
 * delegated to `src/ui`; everything about the game is delegated to `@/sim`.
 */

import { balance, levelConfig, levelCount } from '@/data';
import { Renderer } from '@/render/Renderer';
import { runRenderDevScene } from '@/render/dev-scene';
import { createBot, generateLevel, Run } from '@/sim';
import type { BotKind, LevelDef, RunState, SimEvent } from '@/sim';
import { Overlay } from '@/ui';
import type { FrameTimings } from '@/ui';

import { attachInput } from './input';
import type { DetachInput } from './input';
import { loadSave, unlockLevel } from './save';

export type AppPhase = 'title' | 'playing' | 'result';

/** The handle `scripts/smoke.mjs` and manual debugging use. Keep it stable. */
export interface ArcaneDebugHandle {
  ready: boolean;
  app: App;
  run: () => Run | null;
  state: () => Readonly<RunState> | null;
}

declare global {
  // `var` is required here: this is a global augmentation, not a declaration.
  var __arcane: ArcaneDebugHandle | undefined;
}

interface QueryOptions {
  level: number;
  bot: BotKind | null;
  seed: number | null;
  debug: boolean;
  devScene: boolean;
  /** Sim seconds per real second. 1 is normal play; `?turbo=8` is for scripts. */
  turbo: number;
}

/** Frame delta is clamped so a backgrounded tab cannot teleport the squad. */
const MAX_FRAME_DT = 0.05;

/**
 * Largest sim step a single `tick` is given, even under `?turbo`. The sim's own
 * accumulator would clamp a longer step anyway, and keeping chunks small means a
 * fast-forwarded run resolves collisions exactly as a real-time one does.
 */
const MAX_SIM_CHUNK = 0.05;

/** Ceiling on `?turbo`: past this a frame's worth of sim costs more than it saves. */
const MAX_TURBO = 20;

/** Shared empty list, so an idle frame allocates nothing. */
const NO_EVENTS: readonly SimEvent[] = [];

/** Wall clock for the debug panel's cost readouts; never used by the sim. */
const now = (): number =>
  typeof performance === 'undefined' ? 0 : performance.now();

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly overlay: Overlay;
  private readonly renderer: Renderer;
  private readonly options: QueryOptions;

  private phase: AppPhase = 'title';
  private run: Run | null = null;
  private bot: ((state: RunState) => number) | null = null;
  private detachInput: DetachInput | null = null;

  /**
   * A never-ticked run whose state backs the title screen, so the renderer has
   * a real level to show behind the menu instead of an empty scene.
   */
  private preview: Run | null = null;

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

  /** Re-used every frame: the debug panel reads it, nothing else may write it. */
  private readonly timings: FrameTimings = { simMs: 0, renderMs: 0 };

  constructor(canvas: HTMLCanvasElement, overlayRoot: ParentNode, search: string) {
    this.canvas = canvas;
    this.options = parseQuery(search);
    this.renderer = new Renderer(canvas);
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

    if (this.options.devScene) {
      // `?scene=render-test` bypasses the state machine entirely: the dev scene
      // drives the renderer itself, so no run, no HUD and no frame loop here.
      this.overlay.hideAll();
      runRenderDevScene(this.renderer);
      this.publishHandle();
      return;
    }

    this.showTitle();
    this.publishHandle();

    if (this.rafId === null) this.rafId = requestAnimationFrame(this.frame);
  }

  /** `'title' | 'playing' | 'result'` — the state machine's current node. */
  status(): AppPhase {
    return this.phase;
  }

  /** Jumps straight into a level, ignoring the save's unlock state. */
  startLevel(level: number): void {
    this.options.level = clampLevel(level);
    this.startRun();
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  dispose(): void {
    this.stop();
    this.detachInput?.();
    this.detachInput = null;
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    if (globalThis.__arcane?.app === this) globalThis.__arcane = undefined;
  }

  private publishHandle(): void {
    const handle: ArcaneDebugHandle = {
      ready: true,
      app: this,
      run: () => this.run,
      state: () => this.run?.state ?? null,
    };
    globalThis.__arcane = handle;
  }

  private showTitle(): void {
    this.phase = 'title';
    this.run = null;
    this.bot = null;
    this.endCountdown = null;

    this.loadPreview();
    this.overlay.showTitle({
      levelCount,
      unlockedLevel: Math.min(levelCount, loadSave().unlockedLevel),
      selectedLevel: this.options.level,
    });
  }

  private selectLevel(level: number): void {
    if (this.phase !== 'title') return;
    this.options.level = clampLevel(level);
    this.showTitle();
  }

  /** Builds the level shown behind the title screen and hands it to the renderer. */
  private loadPreview(): void {
    const level = this.buildLevel();
    this.preview = new Run(level, balance);
    this.renderer.loadLevel(level);
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

    this.renderer.loadLevel(level);
    this.phase = 'playing';
    this.overlay.showPlaying(this.options.level);

    this.lastFrameTime = 0;
    if (this.rafId === null) this.rafId = requestAnimationFrame(this.frame);
  }

  private buildLevel(): LevelDef {
    const config = levelConfig(this.options.level);
    return generateLevel(this.options.level, config, this.options.seed ?? config.seed);
  }

  private readonly frame = (time: number): void => {
    this.rafId = requestAnimationFrame(this.frame);

    const dt =
      this.lastFrameTime === 0 ? 0 : Math.min(MAX_FRAME_DT, (time - this.lastFrameTime) / 1000);
    this.lastFrameTime = time;

    const run = this.run;
    if (run === null) {
      const preview = this.preview;
      if (preview !== null && this.previewDirty) {
        this.renderer.update(preview.state, NO_EVENTS, dt);
        this.previewDirty = !this.renderer.isSettled();
      }
      this.overlay.updateDebug(null, NO_EVENTS, dt, this.phase, this.timings);
      return;
    }

    const simStart = now();
    const events = this.stepSim(run, dt);
    const renderStart = now();
    this.renderer.update(run.state, events, dt);
    const renderEnd = now();
    this.timings.simMs = renderStart - simStart;
    this.timings.renderMs = renderEnd - renderStart;

    this.overlay.updateHud(run.state, events);
    this.overlay.updateDebug(run.state, events, dt, this.phase, this.timings);

    if (this.phase === 'playing') this.advanceEnding(run, dt);
  };

  /**
   * Advances the sim by `dt * turbo`, split into ticks of at most
   * `MAX_SIM_CHUNK`, and returns the last tick's events for the render call.
   *
   * Only the last array survives: the sim pools its event objects and the next
   * `tick` overwrites them, so every earlier chunk hands its events to the
   * renderer and the HUD right away instead of being concatenated. That keeps
   * the count, the bump animation and the gate flashes correct at any speed.
   */
  private stepSim(run: Run, dt: number): readonly SimEvent[] {
    const total = dt * this.options.turbo;
    const chunks = Math.max(1, Math.ceil(total / MAX_SIM_CHUNK));
    const chunkDt = total / chunks;

    let events: readonly SimEvent[] = NO_EVENTS;
    for (let i = 0; i < chunks; i++) {
      if (this.bot !== null && run.state.status === 'running') run.setTargetX(this.bot(run.state));
      events = run.tick(chunkDt);
      if (i === chunks - 1) break;

      this.renderer.absorbEvents(events);
      this.overlay.updateHud(run.state, events);
      // dt 0: an intermediate chunk drew no frame, so it must not move the
      // panel's frame-rate average.
      this.overlay.updateDebug(run.state, events, 0, this.phase, this.timings);
    }
    return events;
  }

  /** Holds the result screen back for a beat so the killing blow is visible. */
  private advanceEnding(run: Run, dt: number): void {
    if (this.endCountdown === null) {
      if (run.state.status === 'running') return;

      this.endCountdown = balance.ui.resultDelay;
      // Unlock as soon as the run is won, not when the player taps Next: a
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

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(Math.max(1, Math.floor(level)), levelCount);
}

function parseQuery(search: string): QueryOptions {
  const params = new URLSearchParams(search);
  const save = loadSave();

  const levelParam = Number.parseInt(params.get('level') ?? '', 10);
  const level = Number.isFinite(levelParam) ? clampLevel(levelParam) : clampLevel(save.unlockedLevel);

  const botParam = params.get('bot');
  const bot: BotKind | null =
    botParam === 'greedy' || botParam === 'random' || botParam === 'worst' ? botParam : null;

  const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
  const turboParam = Number.parseFloat(params.get('turbo') ?? '');

  return {
    level,
    bot,
    seed: Number.isFinite(seedParam) ? seedParam : null,
    debug: params.has('debug'),
    devScene: params.get('scene') === 'render-test',
    turbo: Number.isFinite(turboParam) ? Math.min(MAX_TURBO, Math.max(1, turboParam)) : 1,
  };
}
