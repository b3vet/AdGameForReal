/**
 * App state machine: `title -> playing -> result`.
 *
 * Owns the canvas, the renderer, the physics layer, the audio, one
 * `RunSession` at a time, the degrade ladder and the `window.__arcane` debug
 * handle the smoke test drives. Everything visual is delegated to `src/ui` and
 * `src/render`; everything about the game is delegated to `@/sim` through
 * `./session`; everything that happens inside one frame is `./frame`.
 */

import { GameAudio } from '@/audio';
import { balance, levelCount } from '@/data';
import { PhysicsLayer } from '@/physics';
import type { PhysicsQuality } from '@/physics';
import { Renderer } from '@/render/Renderer';
import { runRenderDevScene } from '@/render/dev-scene';
import { weaponOf } from '@/sim';
import type { Run, RunState } from '@/sim';
import { fontsReady, Overlay } from '@/ui';

import { FrameDriver, NO_EVENTS } from './frame';
import type { FrameHost } from './frame';
import { attachInput } from './input';
import type { DetachInput } from './input';
import { Juice } from './juice';
import { QualityLadder } from './quality';
import type { QualityRung } from './quality';
import { clampLevel, parseQuery } from './query';
import type { QueryOptions } from './query';
import { loadSave, setDebug, setMuted } from './save';
import { RunSession } from './session';
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
  /** Which rung of the degrade ladder the app is on; 0 is everything on. */
  quality: () => number;
  /** Draw calls: the last frame's, and the worst since the run started. */
  draws: () => { current: number; peak: number };
  /**
   * Shader programs compiled so far and what the warm-up pass did. The smoke
   * asserts `programs` does not move across a whole level of play.
   */
  shaders: () => {
    programs: number;
    warmed: number;
    skipped: number;
    failed: number;
    warming: boolean;
  };
}

declare global {
  // `var` is required here: this is a global augmentation, not a declaration.
  var __arcane: ArcaneDebugHandle | undefined;
}

export class App implements FrameHost {
  readonly renderer: Renderer;
  readonly audio: GameAudio;
  readonly juice: Juice;
  readonly overlay: Overlay;

  private readonly canvas: HTMLCanvasElement;
  private readonly options: QueryOptions;
  private readonly driver: FrameDriver;
  private readonly ladder: QualityLadder;

  private physicsLayer: PhysicsLayer | null = null;
  private stress: StressHandle | null = null;
  /** `?scene=render-test`'s own loop, so `dispose` can stop it. Structural on
   * purpose: the handle's shape is the render agent's to change. */
  private devScene: { stop: () => void } | null = null;

  private currentPhase: AppPhase = 'title';
  private session: RunSession | null = null;
  /** A never-ticked session whose level and state back the title screen. */
  private preview: RunSession | null = null;
  private detachInput: DetachInput | null = null;
  private muted: boolean;

  /** Set by `dispose`, so the loads still in flight there hand back their work. */
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, overlayRoot: ParentNode, search: string) {
    this.canvas = canvas;
    this.options = parseQuery(search, levelCount);
    this.muted = this.options.muted;
    this.renderer = new Renderer(canvas, {
      // A readable drawing buffer costs a copy of the back buffer every frame
      // and only a screenshot tool needs one, so it is opt-in by URL and
      // `npm run smoke` is the only thing that asks (`src/render/scene.ts`).
      preserveDrawingBuffer: new URLSearchParams(search).has('screenshot'),
    });
    this.juice = new Juice(canvas, this.renderer, this.options.turbo === 1);
    this.audio = new GameAudio({ muted: this.muted });
    this.driver = new FrameDriver(this);
    this.ladder = new QualityLadder({
      forced: this.options.qualityRung,
      apply: (rung, index) => {
        this.applyQuality(rung, index);
      },
    });
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
      onToggleDebug: () => {
        // The panel is a toggle rather than a query parameter because the
        // hosted playtest wrapper may not pass one through; the save is what
        // makes the choice survive the reload that wrapper does on its own.
        const debug = !this.overlay.debugEnabled;
        this.overlay.setDebugEnabled(debug);
        setDebug(debug);
      },
      onCountTick: () => {
        this.audio.playTick();
      },
    });
  }

  /** Boots the renderer, then flips `window.__arcane.ready` for the smoke test. */
  async start(): Promise<void> {
    // The digit atlas rasterises Cinzel into a texture once and never again
    // (`src/render/labels.ts`), so the face has to be in before the renderer
    // builds it — otherwise a whole run's numbers are the fallback serif.
    await fontsReady;
    await this.renderer.init();

    window.addEventListener('resize', this.onResize);
    this.detachInput = attachInput(this.canvas, this.onDragDeltaPixels, {
      // A scripted bot owns `targetX`; a stray drag must not fight it.
      enabled: () => this.currentPhase === 'playing' && (this.session?.bot ?? null) === null,
    });
    // `?debug` is a request to keep the panel on, not to borrow it for one
    // load: it writes the save the triple-tap gesture writes.
    this.overlay.setDebugEnabled(this.options.debug ? setDebug(true).debug : loadSave().debug);
    this.overlay.setMuted(this.muted);
    // The renderer exists now, so the rung the ladder settled on at
    // construction is applied to it for real.
    this.ladder.applyCurrent();

    if (this.options.scene !== 'game') {
      // The dev scenes bypass the state machine entirely: they drive the
      // renderer themselves, so no session, no HUD and no frame loop here.
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

    this.driver.start();
  }

  /** `'title' | 'playing' | 'result'` — the state machine's current node. */
  status(): AppPhase {
    return this.currentPhase;
  }

  /** Jumps straight into a level, ignoring the save's unlock state. */
  startLevel(level: number): void {
    this.options.level = clampLevel(level, levelCount);
    this.startRun();
  }

  stop(): void {
    this.driver.stop();
  }

  /**
   * Restarts the frame loop after `stop`. The smoke test uses the pair to hold
   * a frame still while it photographs it: a scene that takes a second to draw
   * would otherwise move between the check and the picture.
   */
  resume(): void {
    this.driver.start();
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
    this.physicsLayer?.dispose();
    this.physicsLayer = null;
    this.renderer.dispose();
    if (globalThis.__arcane?.app === this) globalThis.__arcane = undefined;
  }

  // --- FrameHost -----------------------------------------------------------

  get turbo(): number {
    return this.options.turbo;
  }

  activeSession(): RunSession | null {
    return this.session;
  }

  previewSession(): RunSession | null {
    return this.preview;
  }

  physics(): PhysicsLayer | null {
    return this.physicsLayer;
  }

  phaseName(): string {
    return this.currentPhase;
  }

  /** The degrade ladder and the result-screen beat both ride the wall clock. */
  onFrameEnd(frameDt: number, realDt: number): void {
    this.ladder.track(frameDt);
    // What the ladder is thinking, for the panel the product owner reads off
    // the phone: the window's verdict and why the rung last moved.
    this.driver.stats.qualityP95 = this.ladder.p95Ms;
    this.driver.stats.qualityReason = this.ladder.reason;

    const session = this.session;
    if (session === null || this.currentPhase !== 'playing') return;
    if (session.advanceEnding(realDt, this.options.level)) this.showResult(session);
  }

  // --- Screens -------------------------------------------------------------

  private showTitle(): void {
    this.currentPhase = 'title';
    this.session = null;
    this.juice.reset();

    this.loadPreview();
    this.overlay.showTitle({
      levelCount,
      unlockedLevel: Math.min(levelCount, loadSave().unlockedLevel),
      selectedLevel: this.options.level,
    });
  }

  private selectLevel(level: number): void {
    if (this.currentPhase !== 'title') return;
    this.options.level = clampLevel(level, levelCount);
    this.showTitle();
  }

  /** Builds the level shown behind the title screen and hands it to the renderer. */
  private loadPreview(): void {
    const preview = new RunSession(this.options.level, this.options);
    this.preview = preview;
    this.renderer.loadLevel(preview.level);
    this.physicsLayer?.loadLevel(preview.level);
    this.renderer.update(preview.state, NO_EVENTS, 0);
    this.driver.markPreviewDirty();
  }

  private startRun(): void {
    // The next title screen draws a fresh preview whatever happens here.
    this.driver.markPreviewDirty();
    // Cheap when the boot pass already did the work, which is the normal case;
    // this is the guarantee that nothing compiles inside the run's frames even
    // if a layer arrived late (`src/render/warmup.ts`).
    void this.renderer.warmUp();
    // A level is a fresh measurement: the ladder starts again at rung 0 and
    // ignores the first seconds of load noise (`src/core/quality.ts`).
    this.ladder.beginLevel();
    const session = new RunSession(this.options.level, this.options);
    this.session = session;
    this.preview = null;
    this.juice.reset();
    this.audio.beginRun();

    this.renderer.loadLevel(session.level);
    this.physicsLayer?.loadLevel(session.level);
    this.driver.resetPeak();
    this.currentPhase = 'playing';
    this.overlay.showPlaying(this.options.level, weaponOf(session.state.squad));

    this.driver.start();
  }

  private showResult(session: RunSession): void {
    this.currentPhase = 'result';
    this.juice.endDefeatCrawl();
    this.overlay.showResult({
      levelIndex: this.options.level,
      won: session.won,
      survivors: session.state.survivors,
      peakCount: session.state.peakCount,
      canAdvance: this.options.level < levelCount,
    });
  }

  // --- Wiring --------------------------------------------------------------

  /**
   * Havok, or nothing. A failed init is a downgrade and not a crash: a phone
   * that cannot afford physics should still play the game, and every ladder
   * rung below stays honest because the layer is marked unavailable.
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
    this.physicsLayer = physics;
    // Whatever is on screen was loaded before this finished, so the road
    // collider is built now rather than at the next `loadLevel`.
    const level = this.session?.level ?? this.preview?.level ?? null;
    if (level !== null) physics.loadLevel(level);
    // The layer arrived after the ladder settled; hand it the current rung.
    this.ladder.applyCurrent();
    // Its debris pools are new meshes in the renderer's scene, so their shaders
    // have to be compiled too or the first kill of the first run pays for them
    // inside a frame (`src/render/warmup.ts`).
    await this.renderer.warmUp();
  }

  /**
   * One rung of the degrade ladder, applied to whoever owns each step
   * (`src/core/quality.ts`). Called on construction, when the physics layer
   * arrives, and on every step down.
   */
  private applyQuality(rung: QualityRung, index: number): void {
    this.renderer.setMaxPixelRatio(rung.pixelRatio);
    this.renderer.setGlow(rung.glow);
    const physics = this.physicsLayer;
    if (physics !== null) {
      // The rung is a ceiling, not an instruction: `?physics=1` asked for less
      // than the ladder's top rung offers, and a layer whose init failed stays
      // at 0 whatever it is told (`PhysicsLayer.setQuality`).
      const wanted = Math.min(rung.physics, this.options.physicsQuality) as PhysicsQuality;
      physics.setQuality(wanted);
      // The renderer plays the baked death itself at quality 0, so it follows
      // whatever the layer actually ended up at rather than what was asked.
      this.renderer.setPhysicsQuality(physics.stats.quality);
    }
    this.driver.stats.qualityRung = index;
  }

  private publishHandle(): void {
    const handle: ArcaneDebugHandle = {
      ready: true,
      app: this,
      run: () => this.session?.run ?? null,
      state: () => this.session?.state ?? null,
      physics: () => this.physicsLayer,
      quality: () => this.ladder.rung,
      draws: () => ({ current: this.renderer.drawCalls, peak: this.driver.peakDrawCalls }),
      shaders: () => this.renderer.shaderStats,
    };
    globalThis.__arcane = handle;
  }

  private setMuted(muted: boolean): void {
    this.muted = muted;
    setMuted(muted);
    this.audio.setMuted(muted);
    this.overlay.setMuted(muted);
  }

  private readonly onResize = (): void => {
    this.renderer.resize();
    // The canvas just changed size, so whatever is on it is stale.
    this.driver.markPreviewDirty();
  };

  /**
   * Pixels to road meters: a full screen width of drag moves the squad
   * `balance.input.sensitivity` meters. Tuning stays in `src/data`.
   */
  private readonly onDragDeltaPixels = (deltaXPixels: number): void => {
    const session = this.session;
    if (session === null || this.currentPhase !== 'playing') return;

    const width = this.canvas.clientWidth || window.innerWidth || 1;
    const meters = (deltaXPixels / width) * balance.input.sensitivity;
    session.run.setTargetX(session.state.squad.targetX + meters);
  };
}
