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
import type { FrameDriver } from './frame';
import type { Juice } from './juice';
import type { MenuStage } from './menus';
import type { QualityLadder } from './quality';
import { clampLevel } from './query';
import type { QueryOptions } from './query';
import { resultView } from './resultView';
import { RunSession } from './session';

/** What a run touches that is not the state machine. */
export interface RunStageDeps {
  /** Shared with `App`: `level` is the road the picker is pointed at. */
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
  /** The seed the next run is pinned to, or null for the road's own. */
  private nextSeed: number | null = null;
  /** The seed of the last road walked, for `replay`. */
  private lastSeed: number | null = null;
  /** Whether the *next* run walks the endless road (D52); cleared by `start`. */
  private nextEndless = false;
  /** Whether the last road walked was the endless one, for `replay` and `retry`. */
  private lastEndless = false;
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

  /** The Academy is up again, so there is no run. */
  clear(): void {
    this.session = null;
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
    this.deps.options.level = clampLevel(level, levelCount);
    this.nextSeed = seed;
    this.nextEndless = false;
    this.start();
  }

  /**
   * A walk of the endless road (D52), on `seed` or on the road's own.
   *
   * A mode beside the campaign rather than a level at the end of it: the level
   * the picker is pointed at is left exactly where it was, so Back from the
   * result sheet finds the Academy the player left.
   */
  startEndless(seed: number | null = null): void {
    this.nextSeed = seed;
    this.nextEndless = true;
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

  /** "Same road again": the road just walked, on the seed it was walked on. */
  replay(): void {
    if (this.lastEndless) {
      this.startEndless(this.lastSeed);
      return;
    }
    this.startLevel(this.deps.options.level, this.lastSeed);
  }

  /**
   * "Again": the road just walked, re-rolled rather than repeated.
   *
   * It has to know the *mode* rather than only the level, because the endless
   * road has no level number: without this, Again on an endless sheet walked
   * whatever campaign level the picker happened to be pointed at.
   */
  retry(): void {
    if (this.lastEndless) {
      this.startEndless();
      return;
    }
    this.start();
  }

  /** Play: the road the pins name, from the top. */
  start(): void {
    const deps = this.deps;
    // The backdrop is over; see `MenuStage.end` for what that costs it.
    deps.menus.end();
    // Cheap when the boot pass already did the work, which is the normal case;
    // this is the guarantee that nothing compiles inside the run's frames even
    // if a layer arrived late (`src/render/warmup.ts`).
    void deps.renderer.warmUp();
    // A level is a fresh measurement: the ladder starts again at rung 0 and
    // ignores the first seconds of load noise (`src/core/quality.ts`).
    deps.ladder.beginLevel();
    // The player is read once, here: the level is generated with their
    // upgrades and the run starts with the staff they chose (D35).
    const endless = this.nextEndless;
    const session = new RunSession(
      deps.options.level,
      deps.options,
      deps.academy.player,
      this.nextSeed,
      endless,
    );
    // Both pins are for one run: the next Play walks whatever road the picker
    // is pointed at, on that level's own seed.
    this.nextSeed = null;
    this.nextEndless = false;
    this.lastSeed = session.seed;
    this.lastEndless = endless;
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
    deps.overlay.showPlaying(deps.options.level, weaponOf(session.state.squad), endless);

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
    if (session.advanceEnding(realDt, this.deps.options.level)) this.finish(session);
  }

  /**
   * The run is over: pay it, remember what was met, and show the sheet. What
   * "pay it" means — and why the bonus can only be paid once — is
   * `AcademyController.payRun`.
   */
  private finish(session: RunSession): void {
    const deps = this.deps;
    deps.onPhase('result');
    deps.juice.endDefeatCrawl();

    const level = deps.options.level;
    const payout = deps.academy.payRun(session, level);
    this.lastPayout = payout;

    // The one buzz the sim cannot describe (D34, Milestone 9 section B): a
    // mission finished or a bestiary tier crossed is a fact about the *save*,
    // decided here, not an event any tick emitted. Two counts rather than the
    // payout, so `src/device` keeps knowing nothing about the meta layer; a
    // no-op in every browser.
    onRunAwards(payout.completed.length, payout.awards.length);

    deps.overlay.showResult(resultView(session, level, payout, levelCount, deps.academy.player));
  }
}
