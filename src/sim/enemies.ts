/**
 * Enemy geometry shared by the sim and the bots.
 */

import type { EnemyKind } from './types';
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
