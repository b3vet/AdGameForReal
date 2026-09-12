/**
 * App state machine: `title -> playing -> result`.
 *
 * Owns the canvas, the renderer, the physics layer, the audio, one
 * `RunSession` at a time, the degrade ladder and the `window.__arcane` debug
 * handle the smoke test drives. Everything visual is delegated to `src/ui` and
 * `src/render`; everything about the game is delegated to `@/sim` through
 * `./session`; everything that happens inside one frame is `./frame`; and
 * everything about the meta layer — the player, the Academy's menus and the
 * purse — is `./academy.ts` (decision D33).
 *
 * The `title` phase covers all of the Academy: which of its screens is up is
 * the controller's business, not the state machine's.
 */

import { GameAudio } from '@/audio';
import { balance, levelCount } from '@/data';
import { PhysicsLayer } from '@/physics';
import type { PhysicsQuality } from '@/physics';
import { Renderer } from '@/render/Renderer';
import { runRenderDevScene } from '@/render/dev-scene';
import { weaponOf } from '@/sim';
import type { WeaponId } from '@/sim';
import { fontsReady, Overlay } from '@/ui';

import { AcademyController } from './academy';
import { FrameDriver, NO_EVENTS } from './frame';
import type { FrameHost } from './frame';
import type { ArcaneDebugHandle } from './handle';
import { attachInput } from './input';
import type { DetachInput } from './input';
import { Juice } from './juice';
import type { RoomId } from './player';
import { QualityLadder } from './quality';
import type { QualityRung } from './quality';
import { clampLevel, parseQuery } from './query';
import type { QueryOptions } from './query';
import { loadSave, setDebug, setMuted } from './save';
import { RunSession } from './session';
import { runStressScene } from './stress';
import type { StressHandle } from './stress';

export type AppPhase = 'title' | 'playing' | 'result';

export type { ArcaneDebugHandle };

export class App implements FrameHost {
  readonly renderer: Renderer;
  readonly audio: GameAudio;
  readonly juice: Juice;
  readonly overlay: Overlay;
  /** The meta layer: the player, the menus and the purse (`./academy.ts`). */
  readonly academy: AcademyController;

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
  /** A never-ticked session whose level and state back the Academy screens. */
  private preview: RunSession | null = null;
  /** Which level the standing preview was built for; 0 when there is none. */
  private previewLevel = 0;
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
      onOpenRoom: (room: RoomId) => {
        this.openRoom(room);
      },
      onCloseRoom: () => {
        this.showHome();
      },
      onLevels: () => {
        this.showHome();
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
      onCoinTick: () => {
        this.audio.playCoinTick();
      },
      onBuyUpgrade: (id: string) => {
        this.academy.buyUpgrade(id);
      },
      onBuyStaff: (id: WeaponId) => {
        this.academy.buyStaff(id);
      },
      onSelectStaff: (id: WeaponId) => {
        this.academy.selectStaff(id);
      },
      onBuyFamiliar: () => {
        this.academy.buyFamiliar();
      },
    });
    this.academy = new AcademyController({
      overlay: this.overlay,
      audio: this.audio,
      levelCount,
      onPlayerChanged: () => {
        // The backdrop was built with the old player in it.
        this.previewLevel = 0;
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

    this.showHome();
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

  /** The Academy home, over a fresh backdrop of the selected level. */
  private showHome(): void {
    this.currentPhase = 'title';
    this.session = null;
    this.juice.reset();
    this.loadPreview();
    this.academy.showHome(this.options.level);
  }

  /** The level picker, behind the home's Play card. */
  private showLevels(): void {
    this.currentPhase = 'title';
    this.academy.showLevels(this.options.level);
  }

  /** A card was tapped: `play` is the picker, the rest are rooms. */
  private openRoom(room: RoomId): void {
    if (this.currentPhase !== 'title') return;
    if (room === 'play') this.showLevels();
    else this.academy.openRoom(room);
  }

  private selectLevel(level: number): void {
    if (this.currentPhase !== 'title') return;
    this.options.level = clampLevel(level, levelCount);
    // The backdrop is the level the player is about to walk, so it changes
    // with the chip rather than only when Play is tapped.
    this.loadPreview();
    this.showLevels();
  }

  /**
   * Re-paints whatever menu is up after a debug injection. The home is the
   * app's to re-show rather than the controller's, because its backdrop is a
   * generated level.
   */
  private repaintMenu(): void {
    if (this.currentPhase !== 'title') return;
    if (this.academy.menu === 'home') this.showHome();
    else this.academy.repaint(this.options.level);
  }

  /**
   * Builds the level shown behind the Academy and hands it to the renderer.
   *
   * Skipped when the standing preview is already the right one: the Academy's
   * screens come and go with every Back tap, and a rebuild is a generated
   * level plus a renderer and physics reload for a backdrop that has not
   * changed. A purchase clears it (`AcademyController` calls back), because
   * upgrades change how many apprentices are standing there.
   */
  private loadPreview(): void {
    // Before the early return and before the frame is marked dirty: this is
    // what puts the chosen staff and the owned wisp on the backdrop and starts
    // the camera's drift (`src/render/preview.ts`). A standing preview that is
    // re-shown still needs it, because `startRun` cleared it.
    this.renderer.setPreviewPlayer(this.academy.player);
    if (this.preview !== null && this.previewLevel === this.options.level) return;

    const preview = new RunSession(this.options.level, this.options, this.academy.player);
    this.preview = preview;
    this.previewLevel = this.options.level;
    this.renderer.loadLevel(preview.level);
    this.physicsLayer?.loadLevel(preview.level);
    this.renderer.update(preview.state, NO_EVENTS, 0);
    this.driver.markPreviewDirty();
  }

  private startRun(): void {
    // The backdrop is over: the camera stops drifting and the wisp goes back to
    // being the run's own, not the Academy's stand-in.
    this.renderer.setPreviewPlayer(null);
    // The next Academy screen draws a fresh preview whatever happens here.
    this.driver.markPreviewDirty();
    // Cheap when the boot pass already did the work, which is the normal case;
    // this is the guarantee that nothing compiles inside the run's frames even
    // if a layer arrived late (`src/render/warmup.ts`).
    void this.renderer.warmUp();
    // A level is a fresh measurement: the ladder starts again at rung 0 and
    // ignores the first seconds of load noise (`src/core/quality.ts`).
    this.ladder.beginLevel();
    // The player is read once, here: the level is generated with their
    // upgrades and the run starts with the staff they chose (D35).
    const session = new RunSession(this.options.level, this.options, this.academy.player);
    this.session = session;
    this.preview = null;
    this.previewLevel = 0;
    this.juice.reset();
    this.audio.beginRun();

    this.renderer.loadLevel(session.level);
    this.physicsLayer?.loadLevel(session.level);
    this.driver.resetPeak();
    this.currentPhase = 'playing';
    this.overlay.showPlaying(this.options.level, weaponOf(session.state.squad));

    this.driver.start();
  }

  /**
   * The run is over: pay it, remember what was met, and show the sheet.
   *
   * The first-clear flag is read before the level is marked, and the level is
   * only marked once the coins for it have been counted — so the bonus is paid
   * exactly once however the run ended. `RunSession.advanceEnding` has already
   * written the unlock by the time this runs, which is why the save is re-read
   * rather than assumed.
   */
  private showResult(session: RunSession): void {
    this.currentPhase = 'result';
    this.juice.endDefeatCrawl();

    const level = this.options.level;
    const payout = this.academy.payRun(session, level);

    this.overlay.showResult({
      levelIndex: level,
      won: session.won,
      survivors: session.state.survivors,
      peakCount: session.state.peakCount,
      coins: payout.coins,
      totalCoins: payout.totalCoins,
      firstClear: payout.firstClear,
      canAdvance: level < levelCount,
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
      player: () => this.academy.player,
      setPlayer: (patch: unknown) => {
        this.academy.setPlayer(patch);
        this.repaintMenu();
      },
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
