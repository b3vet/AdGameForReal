/**
 * The frame loop.
 *
 * Two clocks run here and they must not be confused:
 *
 *   frameDt   real seconds since the last frame. Physics, the degrade ladder,
 *             every juice timer and the result-screen countdown run on this.
 *   scaledDt  `frameDt * timeScale`, then multiplied by `?turbo` inside the sim
 *             step. The sim and the renderer run on this, which is what makes
 *             hit-stop and slow-mo affect the game rather than an animation.
 *
 * Split out of `App` (Phase C) so the state machine reads as a state machine:
 * everything here is about one frame, and everything there is about which
 * screen is up. The loop asks the app for what it needs through `FrameHost`
 * and never decides anything about phases itself.
 */

import type { GameAudio } from '@/audio';
import type { PhysicsLayer } from '@/physics';
import type { Renderer } from '@/render/Renderer';
import type { RunState, SimEvent } from '@/sim';
import type { Overlay } from '@/ui';
import type { DebugStats } from '@/ui';

import { FrameStatsCollector } from './frameStats';
import type { Juice } from './juice';
import { PhysicsEventQueue } from './physicsEvents';
import type { RunSession } from './session';

/** Frame delta is clamped so a backgrounded tab cannot teleport the squad. */
const MAX_FRAME_DT = 0.05;

/**
 * Largest sim step a single `tick` is given, even under `?turbo`. The sim's own
 * accumulator would clamp a longer step anyway, and keeping chunks small means a
 * fast-forwarded run resolves collisions exactly as a real-time one does.
 */
const MAX_SIM_CHUNK = 0.05;

/**
 * Frames a second the Academy's backdrop is drawn at (Milestone 4 Phase D's
 * deferred item, "the backdrop renders behind the room panels every frame").
 *
 * The home screen is a preview run that never ticks, so once the camera has
 * settled the frame is identical and the loop stops asking for one at all. The
 * Academy broke that: its backdrop *drifts* (`CameraRig.setDrift`), so the
 * camera never settles and the scene is re-rendered at the display's full rate
 * — 120 Hz on the product owner's phone — behind a room panel that covers most
 * of it, for a pose that moves half a metre every seventeen seconds.
 *
 * Thirty is well above what the drift needs (it is two pixels a frame at 30)
 * and a quarter of the work. The whole accumulated interval is handed to the
 * renderer as its `dt`, so the drift runs at the same speed it always did; a
 * capped frame is a longer frame, not a slower world.
 */
const BACKDROP_FPS = 30;
const BACKDROP_FRAME_SECONDS = 1 / BACKDROP_FPS;

/** Shared empty list, so an idle frame allocates nothing. */
export const NO_EVENTS: readonly SimEvent[] = [];

/** Wall clock for the debug panel's cost readouts; never used by the sim. */
const now = (): number => (typeof performance === 'undefined' ? 0 : performance.now());

/** What the loop needs from the app. Everything here is read once a frame. */
export interface FrameHost {
  readonly renderer: Renderer;
  readonly overlay: Overlay;
  readonly audio: GameAudio;
  readonly juice: Juice;
  /** Sim seconds per real second; `?turbo`. */
  readonly turbo: number;
  /** The session being played, or null while a menu is up. */
  activeSession(): RunSession | null;
  /** The never-ticked session behind the title screen, or null. */
  previewSession(): RunSession | null;
  physics(): PhysicsLayer | null;
  /** `title | playing | result`, for the debug panel. */
  phaseName(): string;
  /**
   * The end of a frame, on the wall clock. The app steps the degrade ladder
   * and the result-screen countdown here; `realDt` is unclamped on purpose, so
   * a beat is a beat even at one frame a second.
   */
  onFrameEnd(frameDt: number, realDt: number): void;
}

export class FrameDriver {
  /** The debug panel's numbers, gathered off each frame (`./frameStats.ts`). */
  private readonly collector = new FrameStatsCollector();

  /** The struct the panel holds for the life of the app. */
  get stats(): DebugStats {
    return this.collector.stats;
  }

  private readonly host: FrameHost;
  private readonly physicsEvents = new PhysicsEventQueue();

  private rafId: number | null = null;

  /**
   * The timestamp of the last frame, or null when the next one is the first
   * after a start.
   *
   * Null rather than 0, because 0 is a timestamp a frame can genuinely be
   * handed: `requestAnimationFrame` counts from `document.timeline`'s origin,
   * and the first callback of a freshly created document can arrive at exactly
   * zero. With 0 as the sentinel that frame reports no time, sets the sentinel
   * again, and makes the frame *after* it report no time either — two sim steps
   * of nothing where one was meant.
   */
  private lastFrameTime: number | null = null;

  /**
   * The app is in the background (`src/device/lifecycle.ts`).
   *
   * Separate from "the loop is stopped", because the two have different owners
   * and must not undo each other: `stop`/`start` is the smoke test holding a
   * frame still while it photographs it, and this is the phone being taken
   * away. While it is set, `start` asks for no frame at all — so a run that
   * ends, a level that loads or a screenshot that finishes *behind* a locked
   * screen cannot quietly bring the loop back with the app still off screen. It
   * is remembered, not lost (`runningWhenSuspended`), and acted on by `resume`.
   */
  private suspended = false;

  /**
   * Whether the loop should be running once the app comes back.
   *
   * Set by `pause` from what it interrupted, and then kept up to date by
   * `start` and `stop` for as long as the app is away: those two are the app
   * saying what it wants, and it goes on saying it behind a lock screen. A run
   * that ends and a level that loads both call `start`, and without this the
   * player would come back to a level that had been loaded onto a stopped loop.
   */
  private runningWhenSuspended = false;

  /**
   * Worst draw-call count since the last `resetPeak`. Tracked on every frame
   * rather than only under `?debug`, because it is what the smoke test reads to
   * hold the frame budget (plan, "Performance"): one counter read per frame.
   */
  private peak = 0;

  /**
   * Worst charger count since the last `resetPeak`, tracked exactly like the
   * draw calls beside it and for one reader: the Frostfell smoke run asserts a
   * charger was actually drawn (D49). A single-frame sample cannot say that — a
   * charger is on the road for two seconds of a ninety-second run — and a peak
   * can, for one getter read per frame.
   */
  private peakChargers = 0;

  /**
   * Whether the title screen's frame still needs drawing. The preview session
   * never ticks, so once the camera has eased into place the scene is identical
   * frame to frame and `scene.render` is pure heat; anything that can change it
   * (a new preview, a resize) arms this again.
   */
  private previewDirty = true;
  /** Seconds of real time the backdrop has not been drawn for; see `BACKDROP_FPS`. */
  private previewAccum = 0;

  constructor(host: FrameHost) {
    this.host = host;
  }

  start(): void {
    if (this.suspended) {
      // Not dropped: remembered. The app wants to be drawing, and `resume` is
      // the thing that is allowed to act on that.
      this.runningWhenSuspended = true;
      return;
    }
    if (this.rafId !== null) return;
    // Cleared, not set to a clock reading: the first frame after a start
    // reports a delta of nothing, which is what makes a pause drop the time
    // spent away instead of handing it to the sim in one lump (see `pause`).
    this.lastFrameTime = null;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    // Cleared before the early return, so a `stop` that arrives while the app
    // is in the background is honoured: the smoke test holding a frame still
    // has said it does not want the loop, and `resume` must not hand it back.
    this.runningWhenSuspended = false;
    if (this.rafId === null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  /**
   * The app went to the background: no frames, and no clock.
   *
   * A backgrounded page gets no `requestAnimationFrame` callbacks anyway, so
   * the frames take care of themselves; the clock does not. `lastFrameTime`
   * would still be holding the timestamp of the frame before the phone was
   * locked, and the first frame back would compute a `realDt` of however many
   * minutes that was. `frameDt` is clamped (`MAX_FRAME_DT`) so the sim itself
   * survives that, but `realDt` is deliberately *not*: it drives the
   * result-screen beat (`FrameHost.onFrameEnd`), and a five-minute one would
   * skip the whole ending in a single frame.
   *
   * So: stop, and let `start` re-zero the clock on the way back. Idempotent.
   */
  pause(): void {
    if (this.suspended) return;
    const running = this.rafId !== null;
    this.suspended = true;
    // After `stop`, which clears the flag on purpose (see it).
    this.stop();
    this.runningWhenSuspended = running;
  }

  /**
   * Back on screen. Restarts the loop with a fresh clock, but only if the app
   * wants it running — which is what it was doing when the phone was taken
   * away, as amended by any `start` or `stop` that arrived while it was gone. A
   * page backgrounded while the smoke test is holding a frame still comes back
   * held; a level loaded behind a lock screen comes back drawing.
   */
  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    const wanted = this.runningWhenSuspended;
    this.runningWhenSuspended = false;
    if (wanted) this.start();
  }

  /** True while the app is in the background. The debug report prints it. */
  get isSuspended(): boolean {
    return this.suspended;
  }

  /** The title backdrop changed (new preview, resize): draw it again. */
  markPreviewDirty(): void {
    this.previewDirty = true;
    // Now, not in a thirtieth of a second: a resize or a new preview is a
    // visible change and the cap is only there to stop an idle redraw.
    this.previewAccum = BACKDROP_FRAME_SECONDS;
  }

  /** Worst draw-call count since `resetPeak`; 0 before the first frame. */
  get peakDrawCalls(): number {
    return this.peak;
  }

  /** Most chargers drawn in one frame since `resetPeak` (D49). */
  get peakChargerBodies(): number {
    return this.peakChargers;
  }

  resetPeak(): void {
    this.peak = 0;
    this.peakChargers = 0;
  }

  private readonly frame = (time: number): void => {
    this.rafId = requestAnimationFrame(this.frame);
    const host = this.host;

    // Two real deltas: the clamped one drives the game, the raw one drives the
    // result-screen countdown. Clamping the countdown would make it frame-rate
    // dependent — a beat of 0.8 s takes sixteen seconds at one frame a second,
    // which is what a software rasteriser gives a big crowd.
    const previous = this.lastFrameTime;
    const realDt = previous === null ? 0 : (time - previous) / 1000;
    const frameDt = Math.min(MAX_FRAME_DT, realDt);
    this.lastFrameTime = time;

    host.juice.advance(frameDt);
    const scaledDt = frameDt * host.juice.scale;

    const session = host.activeSession();
    if (session === null) {
      const preview = host.previewSession();
      if (preview !== null && this.previewDirty) {
        this.previewAccum += scaledDt;
        if (this.previewAccum >= BACKDROP_FRAME_SECONDS) {
          host.renderer.update(preview.state, NO_EVENTS, this.previewAccum);
          this.previewAccum = 0;
          this.previewDirty = !host.renderer.isSettled();
        }
      }
      // Real time, always: debris left over from the last run has to settle
      // rather than hang in the air behind the menu.
      host.physics()?.update(frameDt);
      // No sim, and usually no render either (the title's frame is drawn once
      // and then held), so the three cost readouts describe nothing. Zeroed
      // rather than left holding the last run's numbers, which a capture taken
      // on the title screen would otherwise report as if they were live.
      this.stats.simMs = 0;
      this.stats.renderMs = 0;
      this.stats.physicsMs = 0;
      this.updateDebug(null, NO_EVENTS, frameDt);
      host.onFrameEnd(frameDt, realDt);
      return;
    }

    const simStart = now();
    const events = this.stepSim(session, scaledDt);
    const renderStart = now();
    host.renderer.update(session.state, events, scaledDt);
    const physicsStart = now();
    this.stepPhysics(session.state, frameDt);
    const physicsEnd = now();

    this.stats.simMs = renderStart - simStart;
    this.stats.renderMs = physicsStart - renderStart;
    this.stats.physicsMs = physicsEnd - physicsStart;

    const draws = host.renderer.drawCalls;
    if (draws > this.peak) this.peak = draws;
    const chargers = host.renderer.chargerBodies;
    if (chargers > this.peakChargers) this.peakChargers = chargers;

    host.juice.apply();
    this.stats.timeScale = host.juice.scale;
    host.overlay.updateHud(session.state, events);
    this.updateDebug(session.state, events, frameDt);

    host.onFrameEnd(frameDt, realDt);
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
  private stepSim(session: RunSession, dt: number): readonly SimEvent[] {
    const host = this.host;
    this.physicsEvents.clear();
    host.juice.beginFrame();

    const total = dt * host.turbo;
    const chunks = Math.max(1, Math.ceil(total / MAX_SIM_CHUNK));
    const chunkDt = total / chunks;

    let events: readonly SimEvent[] = NO_EVENTS;
    for (let i = 0; i < chunks; i++) {
      session.steer();
      events = session.run.tick(chunkDt);

      this.physicsEvents.absorb(events);
      host.audio.onEvents(events, session.state);
      host.juice.scan(events);
      // What the player has met, for the Bestiary (D33). Cheap by
      // construction: it stops looking things up once it has seen both block
      // kinds (`src/core/session.ts`).
      session.absorb(events);
      if (i === chunks - 1) break;

      host.renderer.absorbEvents(events);
      host.overlay.updateHud(session.state, events);
      // dt 0: an intermediate chunk drew no frame, so it must not move the
      // panel's frame-rate average.
      this.updateDebug(session.state, events, 0);
    }
    return events;
  }

  /** Debris runs on real frame time and after the render, never on sim time. */
  private stepPhysics(state: Readonly<RunState>, frameDt: number): void {
    const physics = this.host.physics();
    if (physics === null) return;
    physics.onEvents(this.physicsEvents.events, state);
    // The squad's own dead, which are not events: the crowd view noticed them
    // during the render above and this is the only place that can see both
    // sides of it (`Renderer.drainFallenUnits`). Before `update`, which is
    // where the per-frame budget is handed back.
    this.host.renderer.drainFallenUnits(this.throwFallenUnit);
    physics.update(frameDt);
  }

  /**
   * The sink `drainFallenUnits` writes into. A field rather than a closure made
   * per frame: nothing on the frame path may allocate (CLAUDE.md).
   */
  private readonly throwFallenUnit = (x: number, z: number, vx: number, vz: number): void => {
    this.host.physics()?.unitFell(x, z, vx, vz);
  };

  /** Hands the frame's numbers to the panel; see `./frameStats.ts`. */
  private updateDebug(
    state: Readonly<RunState> | null,
    events: readonly SimEvent[],
    dt: number,
  ): void {
    this.collector.publish(this.host, state, events, dt, this.peak);
  }
}
