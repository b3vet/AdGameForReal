/**
 * App state machine: `title -> playing -> result`.
 *
 * Phase A wires the whole spine — canvas, renderer, run, input, loop and the
 * `window.__arcane` debug handle the smoke test drives — so Phase B3 can fill in
 * the HUD and result screen without re-plumbing anything.
 */

import { balance, levelConfig, levelCount } from '@/data';
import { Renderer } from '@/render/Renderer';
import { runRenderDevScene } from '@/render/dev-scene';
import { createBot, generateLevel, Run } from '@/sim';
import type { BotKind, RunState } from '@/sim';
import { Overlay } from '@/ui';

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
}

/** Frame delta is clamped so a backgrounded tab cannot teleport the squad. */
const MAX_FRAME_DT = 0.05;

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly overlay: Overlay;
  private readonly renderer: Renderer;
  private readonly options: QueryOptions;

  private phase: AppPhase = 'title';
  private run: Run | null = null;
  private bot: ((state: RunState) => number) | null = null;
  private detachInput: DetachInput | null = null;

  private rafId: number | null = null;
  private lastFrameTime = 0;

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
        this.options.level = Math.min(levelCount, this.options.level + 1);
        this.startRun();
      },
    });
  }

  /** Boots the renderer, then flips `window.__arcane.ready` for the smoke test. */
  async start(): Promise<void> {
    await this.renderer.init();

    window.addEventListener('resize', this.onResize);
    this.detachInput = attachInput(this.canvas, this.onDragDeltaPixels);

    if (this.options.devScene) {
      runRenderDevScene(this.renderer);
    }

    this.overlay.showTitle();

    // One frame so the title screen is not sitting on an empty canvas.
    this.renderer.update(this.snapshotState(), [], 0);

    const handle: ArcaneDebugHandle = {
      ready: true,
      app: this,
      run: () => this.run,
      state: () => this.run?.state ?? null,
    };
    globalThis.__arcane = handle;
  }

  get currentPhase(): AppPhase {
    return this.phase;
  }

  startRun(): void {
    const config = levelConfig(this.options.level);
    const seed = this.options.seed ?? config.seed;
    const level = generateLevel(this.options.level, config, seed);

    this.run = new Run(level, balance);
    this.bot = this.options.bot === null ? null : createBot(this.options.bot, seed);

    this.renderer.loadLevel(level);
    this.phase = 'playing';
    this.overlay.showPlaying();

    this.lastFrameTime = 0;
    if (this.rafId === null) this.rafId = requestAnimationFrame(this.frame);
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

  private readonly frame = (time: number): void => {
    this.rafId = requestAnimationFrame(this.frame);

    const dt =
      this.lastFrameTime === 0 ? 0 : Math.min(MAX_FRAME_DT, (time - this.lastFrameTime) / 1000);
    this.lastFrameTime = time;

    const run = this.run;
    if (run === null) {
      this.renderer.update(this.snapshotState(), [], dt);
      return;
    }

    if (this.bot !== null) run.setTargetX(this.bot(run.state));

    const events = run.tick(dt);
    this.renderer.update(run.state, events, dt);
    this.overlay.updateHud();

    if (this.phase === 'playing' && run.state.status !== 'running') {
      this.finishRun(run);
    }
  };

  private finishRun(run: Run): void {
    this.phase = 'result';
    if (run.state.status === 'won') {
      unlockLevel(Math.min(levelCount, this.options.level + 1));
    }
    this.overlay.showResult();
  }

  private readonly onResize = (): void => {
    this.renderer.resize();
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

  /** A run may not exist yet on the title screen; the renderer still needs a state. */
  private snapshotState(): Readonly<RunState> {
    if (this.run !== null) return this.run.state;

    const config = levelConfig(this.options.level);
    const level = generateLevel(this.options.level, config, this.options.seed ?? config.seed);
    return new Run(level, balance).state;
  }
}

function parseQuery(search: string): QueryOptions {
  const params = new URLSearchParams(search);
  const save = loadSave();

  const levelParam = Number.parseInt(params.get('level') ?? '', 10);
  const level = Number.isFinite(levelParam)
    ? Math.min(Math.max(1, levelParam), levelCount)
    : Math.min(save.unlockedLevel, levelCount);

  const botParam = params.get('bot');
  const bot: BotKind | null =
    botParam === 'greedy' || botParam === 'random' || botParam === 'worst' ? botParam : null;

  const seedParam = Number.parseInt(params.get('seed') ?? '', 10);

  return {
    level,
    bot,
    seed: Number.isFinite(seedParam) ? seedParam : null,
    debug: params.has('debug'),
    devScene: params.get('scene') === 'render-test',
  };
}
