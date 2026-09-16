/**
 * A run, from the tap that asks for one to the sheet that closes it.
 *
 * Split out of `App` in Milestone 8 for the file-size rule (CLAUDE.md), on the
 * seam Endless made visible: "which road is next" stopped being a level number
 * the moment there was a mode beside the campaign (D52), and the four pins that
 * answer it — the seed the next run is on, the seed the last one was on, and
 * whether either is the endless road — belong with the code that reads them
 * rather than scattered through a state machine.
 *
 * `App` keeps the three phases and the screens between them; this owns the run
 * that is on the road, the pins around it, and what the finished one paid. The
 * phase itself still moves through `App`, which is what `onPhase` is for: there
 * is exactly one `title -> playing -> result` in this app and it stays in one
 * place.
 */

import type { GameAudio } from '@/audio';
import { levelCount } from '@/data';
import { onRunAwards } from '@/device';
import type { PhysicsLayer } from '@/physics';
import type { Renderer } from '@/render/Renderer';
import { weaponOf } from '@/sim';
import type { Overlay } from '@/ui';

import type { AcademyController, RunPayout } from './academy';
import { beatRoad } from './devScenes';
import type { FrameDriver } from './frame';
import type { Juice } from './juice';
import type { MenuStage } from './menus';
import type { QualityLadder } from './quality';
import { clampLevel } from './query';
import type { BeatPin, QueryOptions } from './query';
import { resultView } from './resultView';
import { RunSession } from './session';

/** What a run touches that is not the state machine. */
export interface RunStageDeps {
  /** The URL's: the seed and the bot every run is built with. */
  options: QueryOptions;
  academy: AcademyController;
  menus: MenuStage;
  renderer: Renderer;
  overlay: Overlay;
  juice: Juice;
  audio: GameAudio;
  ladder: QualityLadder;
  driver: FrameDriver;
  /** Loaded late and owned by `App`, so it is read rather than held. */
  physics: () => PhysicsLayer | null;
  /** The state machine's node moved. `App` owns the phase itself. */
  onPhase: (phase: 'playing' | 'result') => void;
}

export class RunStage {
  private readonly deps: RunStageDeps;

  /** The run on the road, or null on the title and the result sheets. */
  private session: RunSession | null = null;
  /**
   * The campaign level of the run on the road, or of the last one walked:
   * what Retry replays and Continue follows. The run's own rather than the
   * picker's, because the picker opens on the newest level whatever was
   * walked (docs/29), and an endless run leaves it where it was (D52).
   */
  private walked = 1;
  /** The seed the next run is pinned to, or null for the road's own. */
  private nextSeed: number | null = null;
  /** The seed of the last road walked, for `replay`. */
  private lastSeed: number | null = null;
  /** Whether the *next* run walks the endless road (D52); cleared by `start`. */
  private nextEndless = false;
  /** Whether the last road walked was the endless one, for `replay`. */
  private lastEndless = false;
  /**
   * The beat the next run, and the last, walk alone (`?beat=`, document 31,
   * `./devScenes.ts`), or null. A beat run is a probe: it is never paid, and it
   * plays again from the top when it ends rather than showing a result sheet.
   */
  private nextBeat: BeatPin | null = null;
  private lastBeat: BeatPin | null = null;
  /** What the last finished run paid, meta layer included (`./academy.ts`). */
  private lastPayout: RunPayout | null = null;

  constructor(deps: RunStageDeps) {
    this.deps = deps;
  }

  /** The run on the road, or null. */
  get current(): RunSession | null {
    return this.session;
  }

  /** What the last finished run paid, or null before the first one. */
  get payout(): RunPayout | null {
    return this.lastPayout;
  }

  /** The campaign level on the road, or last walked; see `walked`. */
  get level(): number {
    return this.walked;
  }

  /** The Academy is up again, so there is no run. */
  clear(): void {
    this.session = null;
  }

  /**
   * Jumps straight into a level, ignoring the save's unlock state.
   *
   * `seed` walks the *same road* again rather than the level's own: every
   * campaign level has a fixed seed in `levels.json`, but a road started on a
   * seed of its own does not, so Retry on the result sheet hands back the seed
   * the finished run reported (`RunSession.seed`). It applies to the one run
   * that follows and is then forgotten, so the next Play is an ordinary one.
   */
  startLevel(level: number, seed: number | null = null): void {
    this.walked = clampLevel(level, levelCount);
    this.nextSeed = seed;
    this.nextEndless = false;
    this.nextBeat = null;
    this.start();
  }

  /**
   * A walk of the endless road (D52), on `seed` or on the road's own.
   *
   * A mode beside the campaign rather than a level at the end of it: the
   * campaign level last walked is left exactly where it was.
   */
  startEndless(seed: number | null = null): void {
    this.nextSeed = seed;
    this.nextEndless = true;
    this.nextBeat = null;
    this.start();
  }

  /**
   * `?beat=`: the one-beat road the URL names, once the physics layer has
   * landed, for the same reason `autoStartEndless` waits. A pin the beat
   * library cannot build has already said why in the console (`beatRoad`), and
   * leaves the Academy up.
   */
  autoStartBeat(physics: Promise<void>, disposed: () => boolean): void {
    void physics.then(() => {
      if (disposed()) return;
      this.startBeat();
    });
  }

  /**
   * One beat on its own road, from the top, on the seed the URL names: the
   * URL's own pin unless a probe names another (`ArcaneDebugHandle.startBeat`).
   */
  startBeat(pin: BeatPin | null = this.deps.options.beat): void {
    if (pin === null) return;
    this.nextSeed = this.deps.options.seed;
    this.nextEndless = false;
    this.nextBeat = pin;
    this.start();
  }

  /**
   * `?endless=1`: onto the endless road as soon as the physics layer has
   * landed (D52).
   *
   * The wait is the whole of it. The layer's debris pools are meshes in the
   * renderer's scene, and the warm-up pass that compiles their materials only
   * runs once they exist (`./appLayers.ts`) — so a run started before that
   * point pays for three shader programs inside its own first frames, which is
   * exactly the stall the pass exists to remove. Milestone 8's smoke read it as
   * three shaders compiled during play, and it is not reachable any other way:
   * a player taps Play, and by then Havok is long in.
   *
   * Nothing else in the boot waits on it — the title screen is up before this
   * is called, and `disposed` is what stops a page that went away in between
   * from starting a run into a torn-down renderer.
   */
  autoStartEndless(physics: Promise<void>, disposed: () => boolean): void {
    void physics.then(() => {
      if (disposed()) return;
      this.startEndless();
    });
  }

  /**
   * The road just walked, from the top, on the seed it was walked on: the
   * result sheet's Retry and the pause menu's Restart.
   *
   * It has to know the *mode* rather than only the level, because the endless
   * road has no level number: without it, a retry from an endless sheet walked
   * whatever campaign level the picker happened to be pointed at.
   *
   * This used to be one of two buttons, beside an "Again" that re-rolled the
   * road instead (Milestone 8). They never differed in play (docs/28): a
   * campaign level's seed is fixed in `levels.json`, and the picker's Endless
   * card walks the one seed in `endless.json`, so a re-roll landed on the seed
   * this pins anyway. Only a road started through the debug handle on a seed of
   * its own told them apart, and for that road this is the honest retry.
   */
  replay(): void {
    if (this.lastBeat !== null) {
      this.startBeat(this.lastBeat);
      return;
    }
    if (this.lastEndless) {
      this.startEndless(this.lastSeed);
      return;
    }
    this.startLevel(this.walked, this.lastSeed);
  }

  /** Continue on the result sheet: the level after the one just walked. */
  next(): void {
    this.startLevel(this.walked + 1);
  }

  /** The road the pins name, from the top. */
  private start(): void {
    const deps = this.deps;
    const endless = this.nextEndless;
    const seed = this.nextSeed;
    // The player is read once, here: the level is generated with their
    // upgrades and the run starts with the staff they chose (D35).
    const pin = this.nextBeat;
    const road = pin === null ? null : beatRoad(pin, seed, deps.options.biome, deps.academy.player);
    // Every pin is for one run: the next Play walks whatever road the picker
    // names, on that level's own seed.
    this.nextSeed = null;
    this.nextEndless = false;
    this.nextBeat = null;
    // A `?beat=` the library cannot build leaves the Academy as it was; the
    // console already says why (`beatRoad`).
    if (pin !== null && road === null) return;

    // The backdrop is over; see `MenuStage.end` for what that costs it.
    deps.menus.end();
    // Cheap when the boot pass already did the work, which is the normal case;
    // this is the guarantee that nothing compiles inside the run's frames even
    // if a layer arrived late (`src/render/warmup.ts`).
    void deps.renderer.warmUp();
    // A level is a fresh measurement: the ladder starts again at rung 0 and
    // ignores the first seconds of load noise (`src/core/quality.ts`).
    deps.ladder.beginLevel();
    const session = new RunSession(
      this.walked,
      deps.options,
      deps.academy.player,
      seed,
      endless,
      road,
    );
    this.lastSeed = session.seed;
    this.lastEndless = endless;
    this.lastBeat = road === null ? null : pin;
    this.session = session;
    deps.juice.reset();
    deps.audio.beginRun();

    // The tints the player is wearing (D53), read once per run exactly as the
    // upgrades are: the squad's hat and cape, the wisp and the staff glow.
    deps.renderer.setCosmetics(deps.academy.player);
    deps.renderer.loadLevel(session.level);
    deps.physics()?.loadLevel(session.level);
    deps.driver.resetPeak();
    deps.onPhase('playing');
    // A beat's road is endless-style, so its HUD counts metres, not a level.
    deps.overlay.showPlaying(this.walked, weaponOf(session.state.squad), session.isEndless);

    deps.driver.start();
  }

  /**
   * The result-screen beat, on the wall clock: `RunSession` counts the pause
   * between the last body falling and the sheet, and this is the frame that
   * notices it ran out.
   */
  advanceEnding(realDt: number): void {
    const session = this.session;
    if (session === null) return;
    if (session.advanceEnding(realDt, this.walked)) this.finish(session);
  }

  /**
   * The run is over: pay it, remember what was met, and show the sheet. What
   * "pay it" means — and why the bonus can only be paid once — is
   * `AcademyController.payRun`.
   */
  private finish(session: RunSession): void {
    // A beat is a probe, not a run: nothing to pay, and it plays again.
    if (this.lastBeat !== null) {
      this.startBeat(this.lastBeat);
      return;
    }
    const deps = this.deps;
    deps.onPhase('result');
    deps.juice.endDefeatCrawl();

    const level = this.walked;
    const payout = deps.academy.payRun(session, level);
    this.lastPayout = payout;

    // The one buzz the sim cannot describe (D34, Milestone 9 section B): a
    // mission finished or a bestiary tier crossed is a fact about the *save*,
    // decided here, not an event any tick emitted. Two counts rather than the
    // payout, so `src/device` keeps knowing nothing about the meta layer; a
    // no-op in every browser.
    onRunAwards(payout.completed.length, payout.awards.length);

    deps.overlay.showResult(resultView(session, level, payout, levelCount));
  }
}
