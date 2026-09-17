/**
 * Gate arithmetic: what shooting does to a gate, and what a gate does to the
 * squad. Kept apart from `Run` because the bots evaluate gates too, and both
 * must agree exactly or a "greedy" bot would be greedy about the wrong number.
 */

import type { GateKind, GateState } from './types';
import type { Balance } from '@/data/types';

/**
 * What a `fireRate` gate's printed value is worth as a share of the squad: a
 * gate reading `+8%` is ranked like `+7%` more units. Bots agree (bots.ts).
 * Fire rate buys damage, not bodies, so it is worth a little less than its face
 * value — a bigger squad also survives stomps and contact, and rate does not.
 */
export const FIRE_RATE_GATE_WORTH = 0.9;

/** Squad size after walking through a gate, before any clamping. */
export function countAfterGate(kind: GateKind, value: number, count: number): number {
  switch (kind) {
    case 'mul':
      return Math.floor(count * value);
    case 'add':
      return count + value;
    case 'sub':
      return count - value;
    case 'fireRate':
    case 'weapon':
      return count;
  }
}

/** The squad is never negative and never larger than the pool render can draw. */
export function clampCount(count: number, balance: Balance): number {
  const clamped = Math.min(Math.max(0, count), balance.squad.maxCount);
  return Math.floor(clamped);
}

/** `mul` and `weapon` gates are solid glass: shots pass through and change nothing. */
export function isShootable(kind: GateKind): boolean {
  return kind === 'add' || kind === 'sub' || kind === 'fireRate';
}

/**
 * How far shooting can move a gate from the value it was built with:
 * `base + max(capFloor, capShare * base)` (docs/06-milestone-2-plan.md).
 *
 * A `sub` gate is the exception: its cap is what it pays *after* it counts down
 * to zero and flips, so it is the budget alone rather than the penalty plus it.
 */
export function gateCap(kind: GateKind, base: number, balance: Balance): number {
  const gates = balance.gates;
  if (kind === 'fireRate') {
    const budget = Math.max(gates.capFloor.fireRate, gates.capShare * base);
    return Math.min(gates.caps.fireRate, base + budget);
  }
  const budget = Math.max(gates.capFloor.add, gates.capShare * base);
  if (kind === 'sub') return Math.min(gates.caps.add, budget);
  return Math.min(gates.caps.add, base + budget);
}

/**
 * The gate's own ceiling. Generated gates carry one frozen at build time;
 * hand-made ones derive it from whatever they print right now.
 */
function capOf(gate: GateState, balance: Balance): number {
  return gate.cap ?? gateCap(gate.kind, gate.value, balance);
}

/**
 * The other half of D19, for curses (Phase C2): a `sub` gate the squad is not
 * shooting grows while the crowd walks up to it.
 *
 * Flat per second rather than scaled by the share of fire that is *not* on it,
 * because the counter-term is already there and is four times bigger: focused
 * fire counts a curse down at `growthPerSecond.sub` in the same step, so a lane
 * the crowd is pointed at still shrinks, and one it is not grows. What it
 * punishes is the hand that reads the row late — the curse the player walks
 * into is the one they never aimed at.
 *
 * It needs no ceiling: a curse is only in play while it is inside
 * `projectiles.range`, which at the run speed is under seven seconds, so the
 * most one can put on is `perSecond` times that.
 */
export function applyCurseCreep(
  gate: GateState,
  dt: number,
  balance: Balance,
  // The squad the share term is read against; zero on a road without
  // `squadRates`, which leaves the flat rate exactly as it was tuned.
  squad = 0,
): void {
  if (gate.kind !== 'sub') return;
  const creep = balance.gates.creep;
  gate.value += (creep.perSecond + creep.share * squad) * dt;
}

/**
 * The per-second rates a gate grows and shrinks at for a squad of `squad`
 * (document 31, 3.4): the flat D19 rate plus a share of the squad, so a curse
 * of thirty can be shot green by the column that stands in it and pumping a
 * plus is visible at three hundred. `squad` is zero on a dealt road.
 */
export function growthRates(balance: Balance, squad: number): { add: number; sub: number } {
  const rates = balance.gates.growthPerSecond;
  return {
    add: rates.add + rates.shares.add * squad,
    sub: rates.sub + rates.shares.sub * squad,
  };
}

/**
 * Shoot-to-grow (D19). `hits` shots have landed on this gate; `shotRate` is the
 * squad's *whole* output in shots per second at that moment.
 *
 * The plan states the rule per step as
 * `growthPerSecond * dt * (hits this step / shots this step)`; the `dt` cancels
 * against the shot count, which is what this computes — and it has to, because
 * a small squad fires less than one shot in most steps, so a literal per-step
 * shot count would be zero on exactly the steps where its hits land and small
 * squads could never pump a gate at all.
 *
 * `sub` counts down to zero and then flips to `add` and keeps growing, which is
 * the moment that makes shooting a red gate worth it.
 */
export function applyGateGrowth(
  gate: GateState,
  hits: number,
  shotRate: number,
  balance: Balance,
  // See `growthRates`: zero keeps the flat D19 rates of a dealt road. Read as
  // two numbers rather than through `growthRates`, which allocates, because
  // this is on the shot path.
  squad = 0,
): void {
  if (hits <= 0 || !isShootable(gate.kind)) return;

  gate.hits += hits;
  if (shotRate <= 0) return;

  const rates = balance.gates.growthPerSecond;
  // A flipped curse on a scripted road grows at its own pace (document 32);
  // every other plus, and every dealt road's flip, at the road's.
  const addRate = Math.max(rates.add + rates.shares.add * squad, gate.flipGrowth ?? 0);
  const subRate = rates.sub + rates.shares.sub * squad;
  const share = hits / shotRate;
  const cap = capOf(gate, balance);

  if (gate.kind === 'sub') {
    const drop = subRate * share;
    if (drop < gate.value) {
      gate.value -= drop;
      return;
    }
    // The flip: the penalty is spent, the gate is now a bonus that keeps growing.
    const spare = subRate > 0 ? ((drop - gate.value) * addRate) / subRate : 0;
    gate.kind = 'add';
    gate.value = Math.min(cap, spare);
    return;
  }

  const step = gate.kind === 'add' ? addRate * share : rates.fireRate * share;
  // `Math.max(value, ...)` and not just `Math.min(cap, ...)`: a gate that
  // already offers more than the cap is a gate the level author wanted that
  // big, and shooting a bonus must never make it smaller.
  gate.value = Math.max(gate.value, Math.min(cap, gate.value + step));
}
