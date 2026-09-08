/**
 * Blocks walking into the squad.
 *
 * Split out of `Run` with the overlap rule that replaced M1's all-or-nothing
 * contact: a block that clips the edge of the crowd takes a corner off it, and
 * only a block that meets it square takes everyone it is worth.
 */

import { enemyBalance, enemyFootprint } from './enemies';
import type { EventBuffer } from './events';
import { halfWidth } from './formation';
import type { EnemyState, RunState } from './types';
import type { Balance } from '@/data/types';

/** How a block moves right now: frost holds it at a fraction of its speed. */
export function effectiveSpeed(enemy: EnemyState, time: number): number {
  const until = enemy.slowUntil ?? 0;
  if (until <= time) return enemy.speed;
  return enemy.speed * (enemy.slowFactor ?? 1);
}

/**
 * Share of a block's units a contact costs, from how much of it actually met
 * the crowd.
 *
 * Measured against the narrower of the two footprints, so "square on" means the
 * same thing for a fat block against a thin squad as the other way round, and
 * a full engagement always costs the full block. Any overlap at all costs at
 * least `minShare`: a graze has to hurt.
 */
export function overlapShare(
  enemyX: number,
  enemyHalf: number,
  squadX: number,
  squadHalf: number,
  minShare: number,
): number {
  const overlap =
    Math.min(enemyX + enemyHalf, squadX + squadHalf) -
    Math.max(enemyX - enemyHalf, squadX - squadHalf);
  if (overlap <= 0) return 0;

  const span = 2 * Math.min(enemyHalf, squadHalf);
  if (span <= 0) return Math.min(1, minShare);
  return Math.min(1, Math.max(minShare, overlap / span));
}

/**
 * Walks every live block one step and resolves contact. `hitSquad` is `Run`'s
 * own unit removal, passed in so event ordering and the loss check stay in one
 * place; it is bound once per run, not per frame.
 */
export function advanceEnemies(
  state: RunState,
  balance: Balance,
  events: EventBuffer,
  dt: number,
  hitSquad: (amount: number, reason: 'contact') => void,
): void {
  const squad = state.squad;
  const contact = balance.enemies.contactDistance;
  const squadHalf = halfWidth(squad.count);

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;

    if (!enemy.active) {
      if (enemy.z - squad.z > balance.enemies.activationDistance) continue;
      enemy.active = true;
      events.enemyActivated(enemy.id);
    }

    enemy.z -= effectiveSpeed(enemy, state.time) * dt;

    if (Math.abs(enemy.z - squad.z) <= contact) {
      const half = enemyFootprint(enemy.kind, enemy.units, balance);
      const share = overlapShare(enemy.x, half, squad.x, squadHalf, balance.enemies.contactMinShare);
      if (share > 0) {
        const taken = Math.max(1, Math.ceil(enemy.units * share));
        enemy.alive = false;
        enemy.hp = 0;
        enemy.units = 0;
        events.enemyKilled(enemy.id, enemy.kind, enemy.x, enemy.z);
        hitSquad(taken, 'contact');
        if (state.status !== 'running') return;
        continue;
      }
    }

    // Blocks that got past the squad run off the back of the level.
    if (enemy.z < squad.z - balance.enemies.despawnBehind) enemy.alive = false;
  }
}

/** Units a block is still worth, from its hp. Used when a block is re-sized. */
export function unitsOf(enemy: EnemyState, balance: Balance): number {
  return Math.ceil(enemy.hp / enemyBalance(enemy.kind, balance).hpPerUnit);
}
