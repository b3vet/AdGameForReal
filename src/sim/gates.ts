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
): void {
  if (hits <= 0 || !isShootable(gate.kind)) return;

  gate.hits += hits;
  if (shotRate <= 0) return;

  const rates = balance.gates.growthPerSecond;
  const share = hits / shotRate;
  const cap = capOf(gate, balance);

  if (gate.kind === 'sub') {
    const drop = rates.sub * share;
    if (drop < gate.value) {
      gate.value -= drop;
      return;
    }
    // The flip: the penalty is spent, the gate is now a bonus that keeps growing.
    const spare = rates.sub > 0 ? ((drop - gate.value) * rates.add) / rates.sub : 0;
    gate.kind = 'add';
    gate.value = Math.min(cap, spare);
    return;
  }

  const step = gate.kind === 'add' ? rates.add * share : rates.fireRate * share;
  // `Math.max(value, ...)` and not just `Math.min(cap, ...)`: a gate that
  // already offers more than the cap is a gate the level author wanted that
  // big, and shooting a bonus must never make it smaller.
  gate.value = Math.max(gate.value, Math.min(cap, gate.value + step));
}
