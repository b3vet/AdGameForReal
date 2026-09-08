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
  /** Re-used every frame: the debug panel reads it, nothing else may write it. */
  readonly stats: DebugStats = {
    simMs: 0,
    renderMs: 0,
    physicsMs: 0,
    drawCalls: 0,
    drawCallsPeak: 0,
    timeScale: 1,
    ragdolls: 0,
    shards: 0,
    physicsBodies: 0,
    physicsQuality: 0,
    qualityRung: 0,
    pixelRatio: 0,
    devicePixelRatio: 1,
    audio: 'off',
    audioClips: 0,
  };

  private readonly host: FrameHost;
  private readonly physicsEvents = new PhysicsEventQueue();

  private rafId: number | null = null;
  private lastFrameTime = 0;

  /**
   * Worst draw-call count since the last `resetPeak`. Tracked on every frame
   * rather than only under `?debug`, because it is what the smoke test reads to
   * hold the frame budget (plan, "Performance"): one counter read per frame.
   */
  private peak = 0;

  /**
   * Whether the title screen's frame still needs drawing. The preview session
   * never ticks, so once the camera has eased into place the scene is identical
   * frame to frame and `scene.render` is pure heat; anything that can change it
   * (a new preview, a resize) arms this again.
   */
  private previewDirty = true;

  constructor(host: FrameHost) {
    this.host = host;
  }

  start(): void {
    if (this.rafId !== null) return;
    this.lastFrameTime = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.rafId === null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  /** The title backdrop changed (new preview, resize): draw it again. */
  markPreviewDirty(): void {
    this.previewDirty = true;
  }

  /** Worst draw-call count since `resetPeak`; 0 before the first frame. */
  get peakDrawCalls(): number {
    return this.peak;
  }

  resetPeak(): void {
    this.peak = 0;
  }

  private readonly frame = (time: number): void => {
    this.rafId = requestAnimationFrame(this.frame);
    const host = this.host;

    // Two real deltas: the clamped one drives the game, the raw one drives the
    // result-screen countdown. Clamping the countdown would make it frame-rate
    // dependent — a beat of 0.8 s takes sixteen seconds at one frame a second,
    // which is what a software rasteriser gives a big crowd.
    const realDt = this.lastFrameTime === 0 ? 0 : (time - this.lastFrameTime) / 1000;
    const frameDt = Math.min(MAX_FRAME_DT, realDt);
    this.lastFrameTime = time;

    host.juice.advance(frameDt);
    const scaledDt = frameDt * host.juice.scale;

    const session = host.activeSession();
    if (session === null) {
      const preview = host.previewSession();
      if (preview !== null && this.previewDirty) {
        host.renderer.update(preview.state, NO_EVENTS, scaledDt);
        this.previewDirty = !host.renderer.isSettled();
      }
      // Real time, always: debris left over from the last run has to settle
      // rather than hang in the air behind the menu.
      host.physics()?.update(frameDt);
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
    physics.update(frameDt);
  }

  private updateDebug(
    state: Readonly<RunState> | null,
    events: readonly SimEvent[],
    dt: number,
  ): void {
    const host = this.host;
    if (!host.overlay.debugEnabled) return;

    const physics = host.physics();
    this.stats.drawCalls = host.renderer.drawCalls;
    this.stats.drawCallsPeak = this.peak;
    this.stats.ragdolls = physics?.stats.ragdolls ?? 0;
    this.stats.shards = physics?.stats.shards ?? 0;
    this.stats.physicsBodies = physics?.stats.bodies ?? 0;
    this.stats.physicsQuality = physics?.stats.quality ?? 0;
    this.stats.pixelRatio = host.renderer.pixelRatio;
    this.stats.devicePixelRatio = host.renderer.devicePixelRatio;
    this.stats.audio = host.audio.muted ? `${host.audio.status} muted` : host.audio.status;
    this.stats.audioClips = host.audio.loadedCount;

    host.overlay.updateDebug(state, events, dt, host.phaseName(), this.stats);
  }
}
