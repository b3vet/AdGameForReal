/**
 * The charger (D49): the Frostfell kind that asks the thumb a question the
 * road never asked before.
 *
 * It stands in a lane doing nothing at all until the column is within
 * `enemies.charger.triggerRange`. Then it picks a lane — its own, or the
 * column's if that is within `lanePick` of it — and runs it down at a speed
 * well above anything else on the road, shoving hard with its own reach and
 * taking a bite of the crowd on contact.
 *
 * The mechanic is the pair of those two rules. The squad's fire is a lane
 * (D42), so a charger that has picked the *column's* lane is something to
 * shoot and a charger one lane over is something to steer around — and it
 * announces which by moving, a second and a half before it arrives.
 *
 * The lane is picked once, on the step it sets off, and never revised: a
 * charger that re-aimed every step would be unanswerable by steering, which
 * is half of what it is for.
 */

import type { EventBuffer } from './events';
import { laneCenter, laneOf } from './lanes';
import type { EnemyState, Lane, RunState } from './types';
import type { Balance } from '@/data/types';

/** Lanes, low to high. Module level: nothing here may allocate per step. */
const LANES: readonly Lane[] = [-1, 0, 1];

function clampLane(lane: number): Lane {
  return LANES[Math.min(2, Math.max(0, Math.round(lane) + 1))] ?? 0;
}

/**
 * The lane a charger standing at `ownX` commits to when the column is at
 * `squadX`: the column's lane, but never more than `lanePick` lanes away from
 * its own. At `lanePick` 0 it always runs straight; at 1 a charger in the next
 * lane over comes at you and one two lanes over does not.
 */
export function chargeLane(ownX: number, squadX: number, balance: Balance): Lane {
  const laneWidth = balance.road.laneWidth;
  const own = laneOf(ownX, laneWidth);
  const wanted = laneOf(squadX, laneWidth);
  const reach = Math.max(0, Math.round(balance.enemies.charger.lanePick));
  return clampLane(Math.min(own + reach, Math.max(own - reach, wanted)));
}

/**
 * Sets a charger running. Called on the step it activates, from `contact.ts`,
 * which is the one place a body wakes up.
 */
export function startCharge(
  enemy: EnemyState,
  state: RunState,
  balance: Balance,
  events: EventBuffer,
): void {
  const lane = chargeLane(enemy.x, state.squad.x, balance);
  const speed = Math.max(0.1, balance.enemies.charger.speed);
  // `until` is render's clock, not a rule: how long the run *should* take at
  // the gap it set off from. Nothing in the sim reads it back.
  enemy.charge = { until: state.time + Math.max(0, enemy.z - state.squad.z) / speed, lane };
  events.charge(enemy.id, enemy.kind, lane);
}

/**
 * One step of a running charger's lateral motion. Its forward motion is the
 * ordinary one in `contact.ts` — it walks at its own `speed`, and a frost slow
 * bites on it exactly as it does on anything else, which is what makes the
 * frost staff an answer to a lane full of them.
 */
export function steerCharger(enemy: EnemyState, balance: Balance, dt: number): void {
  const charge = enemy.charge;
  if (charge === undefined) return;
  const wanted = laneCenter(charge.lane, balance.road.laneWidth);
  const step = balance.enemies.charger.lateralSpeed * dt;
  const gap = wanted - enemy.x;
  enemy.x += Math.abs(gap) <= step ? gap : Math.sign(gap) * step;
}

/**
 * Units one charger takes when it reaches the crowd: a floor, or a share of
 * whoever is standing there, whichever is more — the same shape as a stomp
 * (`boss.ts`), so a charger costs a big column something as well as a small
 * one.
 */
export function chargerKills(count: number, balance: Balance): number {
  const config = balance.enemies.charger;
  const floor = Math.max(1, Math.round(config.kills));
  return Math.max(floor, Math.ceil(count * config.killShare));
}
