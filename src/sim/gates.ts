/**
 * Gate arithmetic: what a shot does to a gate, and what a gate does to the
 * squad. Kept apart from `Run` because the bots evaluate gates too, and both
 * must agree exactly or a "greedy" bot would be greedy about the wrong number.
 */

import type { GateKind, GateState } from './types';
import type { Balance } from '@/data/types';

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
      return count;
  }
}

/** The squad is never negative and never larger than the pool render can draw. */
export function clampCount(count: number, balance: Balance): number {
  const clamped = Math.min(Math.max(0, count), balance.squad.maxCount);
  return Math.floor(clamped);
}

/** `mul` gates are solid glass: shots pass through and change nothing. */
export function isShootable(kind: GateKind): boolean {
  return kind !== 'mul';
}

/**
 * How high shooting can raise this gate. Generated gates carry their own cap,
 * scaled to the squad the row was built for; hand-made ones use the global one.
 */
function capOf(gate: GateState, balance: Balance): number {
  if (gate.cap !== undefined) return gate.cap;
  return gate.kind === 'fireRate' ? balance.gates.caps.fireRate : balance.gates.caps.add;
}

/**
 * Applies `hits` projectile hits at once. Batched hitscan lands dozens of shots
 * in one step, so this is closed-form rather than a loop.
 *
 * `sub` counts down to zero and then flips to `add` and keeps growing, which is
 * the moment that makes shooting a red gate worth it.
 */
export function applyGateHits(gate: GateState, hits: number, balance: Balance): void {
  if (hits <= 0 || !isShootable(gate.kind)) return;

  const step = balance.gates.hitStep;
  const cap = capOf(gate, balance);
  gate.hits += hits;

  if (gate.kind === 'sub') {
    const hitsToZero = Math.ceil(gate.value / step.sub);
    if (hits < hitsToZero) {
      gate.value = Math.max(0, gate.value - hits * step.sub);
      return;
    }
    // The flip: the penalty is spent, the gate is now a bonus that keeps growing.
    gate.kind = 'add';
    gate.value = Math.min(cap, (hits - hitsToZero) * step.add);
    return;
  }

  if (gate.kind === 'add') {
    gate.value = Math.min(cap, gate.value + hits * step.add);
    return;
  }

  gate.value = Math.min(cap, gate.value + hits * step.fireRate);
}
