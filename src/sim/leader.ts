/**
 * The head of a column, and the trail of where it has been.
 *
 * Milestone 5 eased `squad.x` toward the finger under an acceleration cap
 * (D37), which is what a crowd of people can do — and it is also what the
 * product owner read as unresponsive, because the *head* is not a crowd. The
 * head is on the finger now (D43): a stiff spring, no acceleration cap, and a
 * speed cap loose enough that a full-lane move is over inside 150 ms. What
 * makes the motion read as people is the crowd behind it — every unit seeks a
 * slot that hangs off this trail a few steps late, so a turn travels down the
 * column and the tail whips.
 *
 * `LeaderTrails` is that memory: one pooled ring of leader `x` per group,
 * written once a step, read twice per agent. Nothing here allocates after the
 * constructor (CLAUDE.md).
 *
 * Deliberately not frame-rate independent beyond the fixed step: the sim only
 * ever integrates at 1/60 s, so this is exact and reproducible.
 */

import type { SquadState } from './types';
import type { Balance } from '@/data/types';

/**
 * Distance in metres at which the spring is called done, so a head standing on
 * its target is exactly on it rather than a fraction short of it forever. A
 * tenth of a millimetre: smaller than anything the game can show.
 */
const SETTLE = 1e-4;

/**
 * `squad.x` chases `squad.targetX`. The caller has already bounded the target
 * by the road (`clampLimit`); walls do not bound the head at all (D43) — they
 * stop the *units*, which is what `crowdForces` does with the fence lines.
 *
 * Critically damped, so it cannot oscillate, and integrated with explicit Euler
 * at `ωdt = 0.5`, whose discrete poles sit at 0.5: the head covers a full lane
 * in about six steps rather than the fourteen the continuous solution would
 * take, and still never overshoots.
 */
export function steerLeader(squad: SquadState, balance: Balance, dt: number): void {
  const tuning = balance.crowd;
  const omega = tuning.leaderSpring;
  const target = squad.targetX;
  const error = target - squad.x;
  let v = squad.vx ?? 0;

  // No acceleration cap (D43): the head is the finger, and a finger does not
  // ease in. The speed cap is the only limit, and it only bites on a swipe
  // longer than a lane.
  v += (omega * omega * error - 2 * omega * v) * dt;
  v = Math.min(tuning.leaderSpeed, Math.max(-tuning.leaderSpeed, v));

  let x = squad.x + v * dt;
  // A step that would carry the head past the target ends on it instead. The
  // spring cannot overshoot from rest, but a target that jumps backward while
  // the head is already moving can.
  if ((error > 0 && x > target) || (error < 0 && x < target)) {
    x = target;
    v = 0;
  }
  if (Math.abs(target - x) < SETTLE && Math.abs(v) < SETTLE * omega) {
    x = target;
    v = 0;
  }

  squad.x = x;
  squad.vx = v;
}

/**
 * One ring of past leader `x` per group, newest first.
 *
 * Read with a *fractional* delay — a row's delay is `row * chainStepsPerRow`
 * and that is deliberately under one step per row — so two neighbouring rows
 * are a fraction of a step apart rather than snapping to the same sample.
 */
export class LeaderTrails {
  private readonly length: number;
  private readonly x: Float64Array;
  /** Newest sample's index within each group's ring. */
  private readonly head: Int32Array;

  constructor(groups: number, length: number) {
    this.length = Math.max(2, Math.floor(length));
    this.x = new Float64Array(groups * this.length);
    this.head = new Int32Array(groups);
  }

  /** Fills a group's whole ring, so a new group has no history to whip from. */
  reset(group: number, x: number): void {
    const base = group * this.length;
    this.x.fill(x, base, base + this.length);
    this.head[group] = 0;
  }

  /** One step's sample. Called once per group per step, before the forces. */
  push(group: number, x: number): void {
    let head = (this.head[group] ?? 0) + 1;
    if (head >= this.length) head = 0;
    this.head[group] = head;
    this.x[group * this.length + head] = x;
  }

  /** Where the leader was `delay` steps ago, interpolated between samples. */
  at(group: number, delay: number): number {
    const length = this.length;
    const limit = length - 1;
    const clamped = delay <= 0 ? 0 : delay >= limit ? limit : delay;
    const whole = Math.floor(clamped);
    const frac = clamped - whole;
    const base = group * length;
    const head = this.head[group] ?? 0;

    let i = head - whole;
    if (i < 0) i += length;
    const a = this.x[base + i] ?? 0;
    if (frac <= 0) return a;

    let j = i - 1;
    if (j < 0) j += length;
    const b = this.x[base + j] ?? a;
    return a + (b - a) * frac;
  }

  /**
   * How fast the leader was moving `delay` steps ago, in m/s. The feed-forward
   * term of the seek: without it a unit sits a permanent `speed / seekRate`
   * behind the slot it is chasing, which at the head's own speed is metres.
   */
  velocity(group: number, delay: number, stepsPerSecond: number): number {
    return (this.at(group, delay) - this.at(group, delay + 1)) * stepsPerSecond;
  }
}
