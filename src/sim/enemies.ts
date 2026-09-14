/**
 * Enemy geometry shared by the sim and the bots.
 */

import type { EnemyKind, EnemyState } from './types';
import type { Balance, EnemyBalance } from '@/data/types';

/**
 * The block of tuning a kind reads.
 *
 * A shielded brute is a brute (D49): same hit points per unit, same speed,
 * same footprint. Everything that makes it a different thing to fight is the
 * `shield` it carries, which `shields.ts` owns.
 */
export function enemyBalance(kind: EnemyKind, balance: Balance): EnemyBalance {
  if (kind === 'boss') return balance.enemies.boss;
  if (kind === 'brute' || kind === 'shieldBrute') return balance.enemies.brute;
  if (kind === 'charger') return balance.enemies.charger;
  return balance.enemies.grunt;
}

/**
 * Half-width of a block along `x`. Bigger blocks are wider, so a fat block is
 * harder to sidestep than a small one; the boss is a fixed slab.
 */
export function enemyFootprint(kind: EnemyKind, units: number, balance: Balance): number {
  const base = enemyBalance(kind, balance).footprint;
  if (kind === 'boss') return base;
  const widened = base + balance.enemies.footprintPerUnit * Math.sqrt(Math.max(0, units));
  return Math.min(balance.enemies.footprintMax, widened);
}

/**
 * Half-width of one actor, block or stream body.
 *
 * A stream body is one person, not a block of them: it carries its own small
 * footprint from `balance.streams` rather than the block rule, or a lane full
 * of them would read as a moving wall and a single shot would clear three of
 * them at once.
 */
export function enemyHalfWidth(enemy: EnemyState, balance: Balance): number {
  if (enemy.streamId !== undefined) return balance.streams.footprint;
  return enemyFootprint(enemy.kind, enemy.units, balance);
}

/**
 * How far in front of the squad this body wakes up.
 *
 * A charger has its own, shorter, range (D49): it is a thing standing in a
 * lane that the player can see and shoot *before* it moves, and the moment it
 * sets off is the moment the choice — shoot it or steer out of its lane — has
 * to be made. Everything else uses the shared `activationDistance`.
 */
export function activationRange(kind: EnemyKind, balance: Balance): number {
  if (kind === 'charger') return balance.enemies.charger.triggerRange;
  return balance.enemies.activationDistance;
}

/**
 * What a body is worth to a bot deciding whether it can be removed in time.
 *
 * `units` is what a contact *costs*; this is what the body takes to *clear*,
 * which for a shielded brute is more than its printed number says: the shield
 * is hit points the fire has to spend at `enemies.shield.damageMul`, so it is
 * worth its own size over that multiplier on top of the body (D49). A bot that
 * priced a shielded brute by its label would stand in its lane expecting to
 * shoot through it, and would not.
 */
export function effectiveUnits(enemy: EnemyState, balance: Balance): number {
  const shield = enemy.shield ?? 0;
  if (shield <= 0) return enemy.units;
  const mul = Math.max(1e-6, balance.enemies.shield.damageMul);
  const perUnit = Math.max(1e-6, enemyBalance(enemy.kind, balance).hpPerUnit);
  return enemy.units + shield / (mul * perUnit);
}
