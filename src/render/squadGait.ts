/**
 * The crowd's gait: whether it is running, standing, casting or cheering, how
 * fast the gate hop travels down it, and the clock the idle sway rides on.
 *
 * One object for the whole crowd rather than one per unit, because all of it is
 * a property of the *squad* — the per-unit part is a scramble of the index
 * (`./crowdLook.ts`) and costs nothing to derive in the draw loop. `beginFrame`
 * is what ages the clocks and settles the frame's shared terms, so the loop
 * that follows reads fields instead of recomputing them five hundred times.
 *
 * Split out of `./squad.ts` for the file-size rule (CLAUDE.md): that file is
 * where a unit is *placed*, this is what it is doing while it stands there.
 */

import {
  ADVANCE_SMOOTHING,
  ADVANCE_START_SPEED,
  ADVANCE_STOP_SPEED,
  GATE_HOP_WAVE_FLOOR,
  IDLE_SWAY_RATE,
  castsWhileRunning,
} from './crowdLook';
import type { AgentFrame } from './squadAgents';
import { CASTING_SHARE } from './theme';
import type { RunStatus } from '@/sim';

/** Radians a second the sway's phase is multiplied by, from its rate in Hz. */
const TWO_PI = 6.283_185_3;

export class SquadGait {
  /**
   * Seconds since the crowd's *front rank* crossed a gate row, or infinity when
   * no hop is live. Each rank hops as the row reaches it, so the beat travels
   * down the column at `hopSpeed`.
   */
  hopAge = Number.POSITIVE_INFINITY;
  /** Metres a second the hop wave travels backward at, settled once a frame. */
  hopSpeed = GATE_HOP_WAVE_FLOOR;
  /** The idle sway's own clock, in seconds of sim time. */
  swayPhase = 0;
  /** True while the crowd is standing about rather than running or fighting. */
  swaying = false;

  private advancing = false;
  /** Low-passed forward speed in metres a second, `NaN` until primed. */
  private advanceSpeed = Number.NaN;
  private cheering = false;

  /** A new level. */
  reset(): void {
    this.advanceSpeed = Number.NaN;
    this.advancing = false;
    this.cheering = false;
    this.hopAge = Number.POSITIVE_INFINITY;
    this.hopSpeed = GATE_HOP_WAVE_FLOOR;
    this.swayPhase = 0;
    this.swaying = false;
  }

  /** Won: the survivors cheer until the next level is loaded. */
  onRunEnded(status: RunStatus): void {
    this.cheering = status === 'won';
  }

  /**
   * The squad crossed a gate row: the crowd hops, front rank first. Restarted
   * rather than accumulated, so passing two rows in one turbo frame is one hop
   * and not a crowd bouncing at double height.
   */
  onGatePassed(): void {
    this.hopAge = 0;
  }

  /** True before the first frame of a level has measured anything. */
  get unprimed(): boolean {
    return Number.isNaN(this.advanceSpeed);
  }

  /** The crowd's speed on the first frame of a level, so one that starts
   *  already moving starts already running. */
  prime(speed: number): void {
    this.advanceSpeed = speed;
    this.advancing = speed > ADVANCE_START_SPEED;
  }

  /**
   * The crowd's forward speed right now, for the one frame a level has no
   * history to low-pass: a level that starts with the squad already moving
   * starts with it already running.
   *
   * Here rather than in the view because it is the number `prime` wants and
   * nothing else ever asks for it — every other frame reads the low-passed
   * mean the draw loop is summing anyway.
   */
  measureSpeed(agents: AgentFrame): number {
    if (agents.live === 0) return 0;
    let sum = 0;
    for (let i = 0; i < agents.limit; i++) {
      if ((agents.alive[i] ?? 0) === 0) continue;
      sum += agents.curVZ[i] ?? 0;
    }
    return sum / agents.live;
  }

  /** Ages the clocks and settles what the whole crowd shares this frame. */
  beginFrame(dt: number, inArena: boolean): void {
    this.swayPhase += dt;
    this.hopAge += dt;
    // The wave's real speed is the crowd's own, because what it draws is a
    // physical fact: the row the squad just crossed reaches the tenth rank two
    // metres of road later than the first. The floor covers the cases where
    // that is not a speed — the first frames of a level, and the arena.
    this.hopSpeed = Math.max(GATE_HOP_WAVE_FLOOR, this.advanceSpeed);
    this.swaying = !this.advancing && !this.cheering && !inArena;
  }

  /** How far through its own sway this unit is, -1 to 1. */
  swayOf(index: number): number {
    return this.swaying ? Math.sin(this.swayPhase * IDLE_SWAY_RATE * TWO_PI + index * 0.7) : 0;
  }

  /**
   * A VAT cannot blend, so the crowd's "firing while running" look is built out
   * of whole units: one mage in `CASTING_SHARE` throws a spell at any moment
   * while the rest run, which at any squad size reads as a firing crowd and
   * hides the fact that each unit's animation is a hard cut.
   */
  animationFor(index: number, inArena: boolean): string {
    if (this.cheering) return 'cheer';
    // Milestone 2 had one cast clip, and a crowd where every firing unit made
    // the same shape at the same moment read as one animated dummy repeated
    // (docs/10-milestone-3-log.md, "more animation"). Split by the unit's index
    // so a unit keeps its own spell for the whole run.
    const casting = index % 2 === 0 ? 'cast' : 'cast2';
    // The arena is tested before the run, because it is a hard stop the sim
    // announces by position: the smoothed speed takes a third of a second to
    // run down and the squad must not jog on the spot in front of the boss.
    if (inArena) return casting;
    if (this.advancing) return castsWhileRunning(index, CASTING_SHARE) ? casting : 'run';
    return 'idle';
  }

  /**
   * The crowd's mean forward velocity for this frame, low-passed.
   *
   * Milestone 4 (task P) measured this by differencing `squad.z` between
   * frames, which on a 120 Hz display saw the squad standing still every other
   * frame. The agents carry their own velocities (D43), so this is a physical
   * number that reads the same on a frame that took a step and one that fell
   * between two; the smoothing is only there so the crowd does not cut out of
   * `run` on the single step it touches the arena.
   *
   * It is one frame behind, because the draw loop that sums it is the same one
   * that reads the answer. At a twelfth of a second of smoothing that is
   * invisible.
   */
  endFrame(speed: number, dt: number): void {
    if (dt <= 0) return;
    // Frame-rate independent: the same smoothing in seconds at 60 or 120 Hz,
    // and at turbo, where one frame is a second of sim time and this is 1.
    this.advanceSpeed += (speed - this.advanceSpeed) * (1 - Math.exp(-dt / ADVANCE_SMOOTHING));
    this.advancing = this.advanceSpeed > (this.advancing ? ADVANCE_STOP_SPEED : ADVANCE_START_SPEED);
  }
}
