/**
 * How the squad's `x` follows the player's finger (D37).
 *
 * Milestone 4 moved `x` at a flat `squad.lateralSpeed` and stopped it dead on
 * arrival, which is what the playtest read as jerky: the crowd snapped into
 * motion, ran at one speed, and switched off. It is now a critically damped
 * spring — the cheapest motion that eases in and out and cannot oscillate —
 * under two caps. The acceleration cap is what a crowd of people can actually
 * do and is what removes the snap; the speed cap is the one the campaign was
 * balanced against, so a full-width swipe still takes about the time it used to
 * rather than whatever the stiffness happens to allow.
 *
 * Deliberately not frame-rate independent beyond the fixed step: the sim only
 * ever integrates at 1/60 s, so this is exact and reproducible (CLAUDE.md).
 */

import type { SquadState } from './types';
import { clampToWalls } from './walls';
import type { WallLimits } from './walls';
import type { Balance } from '@/data/types';

/**
 * Distance in metres at which the spring is called done, so a squad standing on
 * its target is exactly on it rather than a fraction short of it forever. A
 * tenth of a millimetre: smaller than anything the game can show, and small
 * enough that snapping it is not motion.
 */
const SETTLE = 1e-4;

export function steer(squad: SquadState, limits: WallLimits, balance: Balance, dt: number): void {
  const tuning = balance.squad;
  const omega = tuning.lateralSpring;
  const error = squad.targetX - squad.x;
  let v = squad.vx ?? 0;

  const spring = omega * omega * error - 2 * omega * v;
  const accel = Math.min(tuning.lateralAccel, Math.max(-tuning.lateralAccel, spring));
  v = Math.min(tuning.lateralSpeed, Math.max(-tuning.lateralSpeed, v + accel * dt));

  let x = squad.x + v * dt;
  // A step that would carry the crowd past the target ends on it instead. The
  // spring cannot overshoot from rest, but a target that jumps backward while
  // the squad is already moving can, and a crowd that slides past the lane it
  // was steering for and comes back reads as a mistake, not as momentum.
  if ((error > 0 && x > squad.targetX) || (error < 0 && x < squad.targetX)) {
    x = squad.targetX;
    v = 0;
  }
  if (Math.abs(squad.targetX - x) < SETTLE && Math.abs(v) < SETTLE * omega) {
    x = squad.targetX;
    v = 0;
  }

  const clamped = clampToWalls(x, limits);
  // Leaning on a fence must not wind the spring up: without this the squad
  // would store a second of acceleration against a wall and shoot sideways the
  // moment the stretch released it.
  if (clamped !== x) v = 0;
  squad.x = clamped;
  squad.vx = v;
}
