/**
 * The shielded brute's shield (D49).
 *
 * A brute whose number will not move until the shield is gone: every hit is
 * worth `enemies.shield.damageMul` of itself against the shield, and the body
 * underneath takes nothing at all while it stands. When the shield reaches
 * zero a `shieldBreak` fires once and the block is an ordinary brute from then
 * on.
 *
 * The overflow of the breaking hit is *not* carried into the body. A shield is
 * a wall of time rather than a pool of hit points, and a 400-shot volley that
 * broke a shield and then took half the brute with it would make the kind read
 * as a rounding error on the levels it matters on. The break is the event; the
 * next shot is the first one that hurts.
 */

import type { EnemyState } from './types';
import type { Balance } from '@/data/types';

/** What one hit did to a shield: what is left over for the body, and whether
 *  this was the hit that broke it. */
export interface ShieldHit {
  /** Damage the body should take. Zero while the shield stood. */
  toBody: number;
  /** True only on the step the shield reached zero, so the event fires once. */
  broke: boolean;
}

const THROUGH: ShieldHit = { toBody: 0, broke: false };

/**
 * Takes `amount` against `enemy`'s shield if it has one.
 *
 * Re-uses one result object: this is on the shot path and the sim must not
 * allocate in hot loops (CLAUDE.md). The caller reads it before the next call.
 */
export function hitShield(enemy: EnemyState, amount: number, balance: Balance): ShieldHit {
  const shield = enemy.shield ?? 0;
  if (shield <= 0) {
    THROUGH.toBody = amount;
    THROUGH.broke = false;
    return THROUGH;
  }
  const left = shield - amount * balance.enemies.shield.damageMul;
  enemy.shield = Math.max(0, left);
  THROUGH.toBody = 0;
  THROUGH.broke = left <= 0;
  return THROUGH;
}

/** The shield a body of `hp` hit points is built with, or 0 for a kind that
 *  carries none. */
export function shieldFor(hp: number, balance: Balance): number {
  return hp * balance.enemies.shield.share;
}
