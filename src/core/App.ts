/**
 * App state machine: `title -> playing -> result`.
 *
 * Owns the canvas, the renderer, the physics layer, the audio, the degrade
 * ladder and the `window.__arcane` debug handle the smoke test drives.
 * Everything visual is delegated to `src/ui` and `src/render`; everything about
 * the game is delegated to `@/sim` through `./session`; everything that happens
 * inside one frame is `./frame`; the run on the road and the pins that say
 * which road is next are `./appRun.ts`; the Academy's screens and the road
 * behind them are `./menus.ts`; what a tap asks for is `./controls.ts`; the
 * sound and the debug panel are `./appPrefs.ts`; what happens when the phone
 * takes the app away or the GPU takes the context away is `./appLifecycle.ts`;
 * and everything about the meta layer — the player, the purse and what a run
 * pays — is `./academy.ts` (D33).
 *
 * The `title` phase covers all of the Academy: which of its screens is up is
 * the menu stage's business, not the state machine's.
 */

import { GameAudio } from '@/audio';
import { levelCount } from '@/data';
import type { PhysicsLayer } from '@/physics';
import { Renderer } from '@/render/Renderer';
import { fontsReady, Overlay } from '@/ui';

import { AcademyController } from './academy';
import type { RunPayout } from './academy';
import { AppLifecycle } from './appLifecycle';
import { overlayCallbacks } from './controls';
import type { AppCommands } from './controls';
import { FrameDriver } from './frame';
import type { FrameHost } from './frame';
import type { ArcaneDebugHandle } from './handle';
import { Juice } from './juice';
import { attachAppInput } from './appInput';
import type { AppInput } from './appInput';
import { applyQuality, initPhysics } from './appLayers';
import { AppPrefs } from './appPrefs';
import { RunStage } from './appRun';
import { startDevScene } from './devScenes';
import type { DevScene } from './devScenes';
import { MenuStage } from './menus';
import { runPerfCapture } from './perf';
import type { RoomId } from './player';
import { publishHandle } from './publishHandle';
import { QualityLadder } from './quality';
import { MAX_TURBO, parseQuery } from './query';
import type { QueryOptions } from './query';
import type { RunSession } from './session';

export type AppPhase = 'title' | 'playing' | 'result';

export type { ArcaneDebugHandle };

export class App implements FrameHost, AppCommands {
  readonly renderer: Renderer;
  readonly audio: GameAudio;
  readonly juice: Juice;
  readonly overlay: Overlay;
  /** The meta layer: the player, the purse and what a run pays (`./academy.ts`). */
  readonly academy: AcademyController;
  /** The Academy's screens and the backdrop behind them (`./menus.ts`). */
  private readonly menus: MenuStage;

  private readonly canvas: HTMLCanvasElement;
  private readonly options: QueryOptions;
  private readonly driver: FrameDriver;
  private readonly ladder: QualityLadder;

  private physicsLayer: PhysicsLayer | null = null;
  /** `?scene=`'s own scene, so `dispose` can stop it (`./devScenes.ts`). */
  private devScene: DevScene | null = null;

  private currentPhase: AppPhase = 'title';
  /**
   * The run on the road, the pins that say which road is next, and what the
   * last one paid (`./appRun.ts`). Built in the constructor because a run can
   * be asked for before `start` has finished — `?endless=1` does exactly that.
   */
  private readonly runs: RunStage;
  /** The drag and the resize listener, until `dispose` (`./appInput.ts`). */
  private input: AppInput | null = null;
  /** The sound and the debug panel, and the save behind them (`./appPrefs.ts`). */
  private readonly prefs: AppPrefs;
  /**
   * Background, foreground and a lost GPU context (`./appLifecycle.ts`). Built
   * here because the renderer below reports a lost context through it, and a
   * context can be lost inside `Renderer.init`.
   */
  private readonly lifecycle: AppLifecycle;

  /** Set by `dispose`, so the loads still in flight there hand back their work. */
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, overlayRoot: ParentNode, search: string) {
    this.canvas = canvas;
    this.options = parseQuery(search, levelCount);
    this.renderer = new Renderer(canvas, {
      // A readable drawing buffer costs a copy of the back buffer every frame
      // and only a screenshot tool needs one, so it is opt-in by URL and
      // `npm run smoke` is the only thing that asks (`src/render/scene.ts`).
      preserveDrawingBuffer: new URLSearchParams(search).has('screenshot'),
      // `?biome=frost` pins the look; without it every level brings its own
      // (D49), which `Renderer.loadLevel` reads off the level itself.
      ...(this.options.biome === null ? {} : { biome: this.options.biome }),
      // iOS drops the context on a backgrounded web view; the frame loop is
      // what has to stop and start again (`./appLifecycle.ts`).
      onContextLost: () => {
        this.lifecycle.onContextLost();
      },
      onContextRestored: () => {
        this.lifecycle.onContextRestored();
      },
    });
    this.juice = new Juice(canvas, this.renderer, this.options.turbo === 1);
    this.audio = new GameAudio({ muted: this.options.muted });
    this.driver = new FrameDriver(this);
    this.lifecycle = new AppLifecycle({
      driver: this.driver,
      audio: this.audio,
      markDirty: () => {
        this.driver.markPreviewDirty();
      },
    });
    this.ladder = new QualityLadder({
      forced: this.options.qualityRung,
      apply: (rung, index) => {
        applyQuality(rung, {
          renderer: this.renderer,
          physics: this.physicsLayer,
          wanted: this.options.physicsQuality,
        });
        this.driver.stats.qualityRung = index;
      },
    });
    this.overlay = new Overlay(overlayRoot, overlayCallbacks(this));
    this.prefs = new AppPrefs({
      overlay: this.overlay,
      audio: this.audio,
      muted: this.options.muted,
    });
    this.academy = new AcademyController({
      overlay: this.overlay,
      audio: this.audio,
      levelCount,
      onPlayerChanged: () => {
        // The backdrop was built with the old player in it.
        this.menus.invalidate();
      },
    });
    this.menus = new MenuStage({
      renderer: this.renderer,
      academy: this.academy,
      options: this.options,
      physics: () => this.physicsLayer,
      markDirty: () => {
        this.driver.markPreviewDirty();
      },
    });
    this.runs = new RunStage({
      options: this.options,
      academy: this.academy,
      menus: this.menus,
      renderer: this.renderer,
      overlay: this.overlay,
      juice: this.juice,
      audio: this.audio,
      ladder: this.ladder,
      driver: this.driver,
      physics: () => this.physicsLayer,
      onPhase: (phase) => {
        this.currentPhase = phase;
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

    this.input = attachAppInput({
      canvas: this.canvas,
      renderer: this.renderer,
      session: () => this.runs.current,
      steerable: () =>
        this.currentPhase === 'playing' && (this.runs.current?.bot ?? null) === null,
      markDirty: () => {
        this.driver.markPreviewDirty();
      },
    });
    this.prefs.restore(this.options.debug);
    // The page is up, so a `visibilitychange` from here on is a real one. On a
    // device this is the app-state plugin instead; either way the sim clock
    // stops when the game is not on screen (`./appLifecycle.ts`).
    this.lifecycle.start();
    // The renderer exists now, so the rung the ladder settled on at
    // construction is applied to it for real.
    this.ladder.applyCurrent();

    if (this.options.scene !== 'game') {
      // The dev scenes bypass the state machine entirely (`./devScenes.ts`).
      this.overlay.hideAll();
      this.devScene = await startDevScene(
        this.options.scene,
        this.renderer,
        this.options.physicsQuality,
      );
      this.publishHandle();
      return;
    }

    // The board drops whatever was finished last time and draws replacements
    // (D51). Before the home screen, so the cards paint the new board.
    this.academy.beginSession();
    this.showHome();
    this.publishHandle();

    // Neither is awaited: two megabytes of Havok and twenty audio clips must
    // not hold the title screen back. Both attach themselves to whatever level
    // is loaded by the time they arrive, and nothing can play a sound before
    // the first tap anyway.
    const physics = this.initPhysics();
    void this.audio.load();

    // `?endless=1`: onto the road with no end (D52), once Havok has landed —
    // the one thing in the app that waits for it (`RunStage.autoStartEndless`).
    if (this.options.endless) this.runs.autoStartEndless(physics, () => this.disposed);

    this.driver.start();

    // `?perf`: the scripted capture (`./perf.ts`). After the loop is running,
    // because every wait in it is a wait for something the loop does — and
    // after Havok, so the run it measures is the run the phone actually plays.
    if (this.options.perf) void physics.then(() => this.startPerfCapture());
  }

  /** `'title' | 'playing' | 'result'` — the state machine's current node. */
  status(): AppPhase {
    return this.currentPhase;
  }

  /**
   * What the last finished run paid, meta layer included, or null before the
   * first one. The result sheet's Milestone 8 rows read it (`./appRun.ts`).
   */
  get runPayout(): RunPayout | null {
    return this.runs.payout;
  }

  /**
   * Sim seconds per real second, changed after boot. Only the debug handle
   * calls it (`ArcaneDebugHandle.setTurbo`); the game itself never does.
   */
  setTurbo(value: number): void {
    if (!Number.isFinite(value)) return;
    this.options.turbo = Math.min(MAX_TURBO, Math.max(1, value));
  }

  /**
   * Jumps straight into a level, ignoring the save's unlock state; `seed`
   * walks the same road again (`RunStage.startLevel`).
   */
  startLevel(level: number, seed: number | null = null): void {
    this.runs.startLevel(level, seed);
  }

  /** A walk of the endless road (D52), on `seed` or on the road's own. */
  startEndless(seed: number | null = null): void {
    this.runs.startEndless(seed);
  }

  /** "Same road again": the road just walked, on the seed it was walked on. */
  replayRun(): void {
    this.runs.replay();
  }

  /** Again: the road just walked, re-rolled — the endless one included. */
  retryRun(): void {
    this.runs.retry();
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
    this.lifecycle.stop();
    this.input?.detach();
    this.input = null;
    this.devScene?.dispose();
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

  /** The run on the road, or null. Read by `./publishHandle.ts` and `./frame.ts`. */
  get session(): RunSession | null {
    return this.runs.current;
  }

  activeSession(): RunSession | null {
    return this.runs.current;
  }

  previewSession(): RunSession | null {
    return this.menus.session;
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

    if (this.currentPhase !== 'playing') return;
    this.runs.advanceEnding(realDt);
  }

  // --- Screens -------------------------------------------------------------

  /**
   * The Academy home, over a fresh backdrop of the selected level. Which screen
   * comes next is `./menus.ts`; the state machine's part is that `title` has no
   * run in it.
   */
  showHome(): void {
    this.currentPhase = 'title';
    this.runs.clear();
    this.juice.reset();
    this.menus.showHome();
  }

  /** A card was tapped: `play` is the picker, the rest are rooms. */
  openRoom(room: RoomId): void {
    if (this.currentPhase !== 'title') return;
    this.menus.openRoom(room);
  }

  selectLevel(level: number): void {
    if (this.currentPhase !== 'title') return;
    this.menus.selectLevel(level);
  }

  /** Ascend: the level after the one just cleared. */
  nextLevel(): void {
    this.startLevel(this.options.level + 1);
  }

  /** Re-paints whatever menu is up after a debug injection. */
  private repaintMenu(): void {
    if (this.currentPhase === 'title') this.menus.repaint();
  }

  /** Play: the road the picker is pointed at, from the top (`./appRun.ts`). */
  startRun(): void {
    this.runs.start();
  }

  // --- Wiring --------------------------------------------------------------

  /** Havok, or nothing; see `./appLayers.ts`. */
  private async initPhysics(): Promise<void> {
    const physics = await initPhysics({
      renderer: this.renderer,
      quality: this.options.physicsQuality,
      level: () => this.runs.current?.level ?? this.menus.session?.level ?? null,
      disposed: () => this.disposed,
      onReady: () => {
        this.ladder.applyCurrent();
      },
    });
    if (physics === null) return;
    this.physicsLayer = physics;
  }

  private publishHandle(): void {
    publishHandle(this, {
      physics: () => this.physicsLayer,
      qualityRung: () => this.ladder.rung,
      qualityReason: () => this.ladder.reason,
      peakDrawCalls: () => this.driver.peakDrawCalls,
      peakChargerBodies: () => this.driver.peakChargerBodies,
      repaintMenu: () => {
        this.repaintMenu();
      },
      openRoom: (room) => {
        this.openRoom(room);
      },
    });
  }

  /** `?perf`: the scripted level-20 capture that ends in a report (`./perf.ts`). */
  private startPerfCapture(): void {
    if (this.disposed) return;
    void runPerfCapture({
      level: this.options.level,
      startLevel: (level) => {
        this.startLevel(level);
      },
      warming: () => this.renderer.shaderStats.warming,
      startCapture: (seconds) => {
        this.overlay.startCapture(seconds);
      },
      captureActive: () => this.overlay.captureActive,
      finish: () => this.overlay.showAndCopyReport(),
      disposed: () => this.disposed,
    });
  }

  /** The sound and the debug panel, with the save behind them (`./appPrefs.ts`). */
  toggleMute(): void {
    this.prefs.toggleMute();
  }

  toggleDebug(): void {
    this.prefs.toggleDebug();
  }
}
