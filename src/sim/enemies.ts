/**
 * Enemy geometry shared by the sim and the bots.
 */

import type { EnemyKind, EnemyState } from './types';
import type { Balance, EnemyBalance } from '@/data/types';

export function enemyBalance(kind: EnemyKind, balance: Balance): EnemyBalance {
  if (kind === 'boss') return balance.enemies.boss;
  if (kind === 'brute') return balance.enemies.brute;
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
