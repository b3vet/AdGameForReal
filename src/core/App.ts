/**
 * App state machine: `title -> playing -> result`.
 *
 * Owns the canvas, the renderer, the physics layer, the audio, one
 * `RunSession` at a time, the degrade ladder and the `window.__arcane` debug
 * handle the smoke test drives. Everything visual is delegated to `src/ui` and
 * `src/render`; everything about the game is delegated to `@/sim` through
 * `./session`; everything that happens inside one frame is `./frame`; the
 * Academy's screens and the road behind them are `./menus.ts`; what a tap asks
 * for is `./controls.ts`; and everything about the meta layer — the player, the
 * purse and what a run pays — is `./academy.ts` (decision D33).
 *
 * The `title` phase covers all of the Academy: which of its screens is up is
 * the menu stage's business, not the state machine's.
 */

import { GameAudio } from '@/audio';
import { levelCount } from '@/data';
import type { PhysicsLayer } from '@/physics';
import { Renderer } from '@/render/Renderer';
import { weaponOf } from '@/sim';
import { fontsReady, Overlay } from '@/ui';

import { AcademyController } from './academy';
import type { RunPayout } from './academy';
import { overlayCallbacks } from './controls';
import type { AppCommands } from './controls';
import { FrameDriver } from './frame';
import type { FrameHost } from './frame';
import type { ArcaneDebugHandle } from './handle';
import { Juice } from './juice';
import { attachAppInput } from './appInput';
import type { AppInput } from './appInput';
import { applyQuality, initPhysics } from './appLayers';
import { startDevScene } from './devScenes';
import type { DevScene } from './devScenes';
import { MenuStage } from './menus';
import type { RoomId } from './player';
import { publishHandle } from './publishHandle';
import { resultView } from './resultView';
import { QualityLadder } from './quality';
import { MAX_TURBO, clampLevel, parseQuery } from './query';
import type { QueryOptions } from './query';
import { loadSave, setDebug, setMuted } from './save';
import { RunSession } from './session';

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
   * The run on the road, or null on the title and the result sheets. Readable
   * because the debug handle reads it (`./publishHandle.ts`); writable only
   * here, which is what `startRun` and `showHome` are.
   */
  private currentSession: RunSession | null = null;
  /** The seed the next run is pinned to, or null for the level's own. */
  private replaySeed: number | null = null;
  /** The seed of the last road walked, for `replayRun`. */
  private lastSeed: number | null = null;
  /** Whether the *next* run walks the endless road (D52); cleared by `startRun`. */
  private nextEndless = false;
  /** Whether the last road walked was the endless one, for `replayRun`. */
  private lastEndless = false;
  /**
   * What the last finished run paid, meta layer included (`./academy.ts`).
   * Read by the result sheet and by the debug handle; null until a run ends.
   */
  private payout: RunPayout | null = null;
  /** The drag and the resize listener, until `dispose` (`./appInput.ts`). */
  private input: AppInput | null = null;
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
      // `?biome=frost` pins the look; without it every level brings its own
      // (D49), which `Renderer.loadLevel` reads off the level itself.
      ...(this.options.biome === null ? {} : { biome: this.options.biome }),
    });
    this.juice = new Juice(canvas, this.renderer, this.options.turbo === 1);
    this.audio = new GameAudio({ muted: this.muted });
    this.driver = new FrameDriver(this);
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
      session: () => this.currentSession,
      steerable: () =>
        this.currentPhase === 'playing' && (this.currentSession?.bot ?? null) === null,
      markDirty: () => {
        this.driver.markPreviewDirty();
      },
    });
    // `?debug` is a request to keep the panel on, not to borrow it for one
    // load: it writes the save the triple-tap gesture writes.
    this.overlay.setDebugEnabled(this.options.debug ? setDebug(true).debug : loadSave().debug);
    this.overlay.setMuted(this.muted);
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
    // `?endless=1`: straight onto the road with no end (D52). After the home
    // screen rather than instead of it, so the Academy is what Back finds.
    if (this.options.endless) this.startEndless();

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

  /**
   * What the last finished run paid, meta layer included, or null before the
   * first one. The result sheet's Milestone 8 rows read it (Phase C).
   */
  get runPayout(): RunPayout | null {
    return this.payout;
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
   * Jumps straight into a level, ignoring the save's unlock state.
   *
   * `seed` walks the *same road* again rather than the level's own: every
   * campaign level has a fixed seed in `levels.json`, but an endless run (D52)
   * and anything that re-rolls a road do not, so the result sheet's "same road
   * again" hands back the seed the finished run reported (`RunSession.seed`).
   * It applies to the one run that follows and is then forgotten, so the next
   * Play is an ordinary one.
   */
  startLevel(level: number, seed: number | null = null): void {
    this.options.level = clampLevel(level, levelCount);
    this.replaySeed = seed;
    this.nextEndless = false;
    this.startRun();
  }

  /**
   * A walk of the endless road (D52), on `seed` or on the road's own.
   *
   * A mode beside the campaign rather than a level at the end of it: the level
   * the picker is pointed at is left exactly where it was, so Back from the
   * result sheet finds the Academy the player left.
   */
  startEndless(seed: number | null = null): void {
    this.replaySeed = seed;
    this.nextEndless = true;
    this.startRun();
  }

  /** "Same road again": the road just walked, on the seed it was walked on. */
  replayRun(): void {
    if (this.lastEndless) {
      this.startEndless(this.lastSeed);
      return;
    }
    this.startLevel(this.options.level, this.lastSeed);
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
    return this.currentSession;
  }

  activeSession(): RunSession | null {
    return this.currentSession;
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

    const session = this.currentSession;
    if (session === null || this.currentPhase !== 'playing') return;
    if (session.advanceEnding(realDt, this.options.level)) this.showResult(session);
  }

  // --- Screens -------------------------------------------------------------

  /**
   * The Academy home, over a fresh backdrop of the selected level. Which screen
   * comes next is `./menus.ts`; the state machine's part is that `title` has no
   * run in it.
   */
  showHome(): void {
    this.currentPhase = 'title';
    this.currentSession = null;
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

  /** Play, or Again: the selected level, from the top. */
  startRun(): void {
    // The backdrop is over; see `MenuStage.end` for what that costs it.
    this.menus.end();
    // Cheap when the boot pass already did the work, which is the normal case;
    // this is the guarantee that nothing compiles inside the run's frames even
    // if a layer arrived late (`src/render/warmup.ts`).
    void this.renderer.warmUp();
    // A level is a fresh measurement: the ladder starts again at rung 0 and
    // ignores the first seconds of load noise (`src/core/quality.ts`).
    this.ladder.beginLevel();
    // The player is read once, here: the level is generated with their
    // upgrades and the run starts with the staff they chose (D35).
    const endless = this.nextEndless;
    const session = new RunSession(
      this.options.level,
      this.options,
      this.academy.player,
      this.replaySeed,
      endless,
    );
    // Both pins are for one run: the next Play walks whatever road the picker
    // is pointed at, on that level's own seed.
    this.replaySeed = null;
    this.nextEndless = false;
    this.lastSeed = session.seed;
    this.lastEndless = endless;
    this.currentSession = session;
    this.juice.reset();
    this.audio.beginRun();

    // The tints the player is wearing (D53), read once per run exactly as the
    // upgrades are: the squad's hat and cape, the wisp and the staff glow.
    this.renderer.setCosmetics(this.academy.player);
    this.renderer.loadLevel(session.level);
    this.physicsLayer?.loadLevel(session.level);
    this.driver.resetPeak();
    this.currentPhase = 'playing';
    this.overlay.showPlaying(this.options.level, weaponOf(session.state.squad), endless);

    this.driver.start();
  }

  /**
   * The run is over: pay it, remember what was met, and show the sheet. What
   * "pay it" means — and why the bonus can only be paid once — is
   * `AcademyController.payRun`.
   */
  private showResult(session: RunSession): void {
    this.currentPhase = 'result';
    this.juice.endDefeatCrawl();

    const level = this.options.level;
    const payout = this.academy.payRun(session, level);
    this.payout = payout;

    this.overlay.showResult(resultView(session, level, payout, levelCount, this.academy.player));
  }

  // --- Wiring --------------------------------------------------------------

  /** Havok, or nothing; see `./appLayers.ts`. */
  private async initPhysics(): Promise<void> {
    const physics = await initPhysics({
      renderer: this.renderer,
      quality: this.options.physicsQuality,
      level: () => this.currentSession?.level ?? this.menus.session?.level ?? null,
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

  /** The mute control on the Academy or the HUD. */
  toggleMute(): void {
    this.setMuted(!this.muted);
  }

  /**
   * The triple-tap gesture, or `?debug`. The panel is a toggle rather than only
   * a query parameter because the hosted playtest wrapper may not pass one
   * through; the save is what makes the choice survive the reload that wrapper
   * does on its own.
   */
  toggleDebug(): void {
    const debug = !this.overlay.debugEnabled;
    this.overlay.setDebugEnabled(debug);
    setDebug(debug);
  }

  private setMuted(muted: boolean): void {
    this.muted = muted;
    setMuted(muted);
    this.audio.setMuted(muted);
    this.overlay.setMuted(muted);
  }
}
