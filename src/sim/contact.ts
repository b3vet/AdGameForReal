/**
 * Everything walking into the squad.
 *
 * Two rules live here. A *block* costs the share of its units that actually met
 * the crowd (Milestone 2's overlap rule). A *stream body* costs exactly one
 * unit, whatever the angle — the product owner's rule for Milestone 3 (D29) —
 * and is reported separately as a leak, because a leak is what the stream
 * pressure bands are measured in.
 */

import { enemyBalance, enemyFootprint } from './enemies';
import type { EventBuffer } from './events';
import { halfWidth } from './formation';
import type { EnemyState, RunState, UnitLossReason } from './types';
import type { Balance } from '@/data/types';

/** What `advanceEnemies` calls to take units off the squad. */
export type HitSquad = (amount: number, reason: UnitLossReason) => void;

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

/** Marks an actor dead in the one place that also stamps the corpse clock. */
export function killEnemy(enemy: EnemyState, time: number): void {
  enemy.alive = false;
  enemy.hp = 0;
  enemy.units = 0;
  enemy.diedAt = time;
}

/**
 * Walks every live actor one step and resolves contact. `hitSquad` is `Run`'s
 * own unit removal, passed in so event ordering and the loss check stay in one
 * place; it is bound once per run, not per frame.
 */
export function advanceEnemies(
  state: RunState,
  balance: Balance,
  events: EventBuffer,
  dt: number,
  hitSquad: HitSquad,
  onLeak: (enemy: EnemyState) => void,
): void {
  const squad = state.squad;
  const contact = balance.enemies.contactDistance;
  const squadHalf = halfWidth(squad.count);
  const streamHalf = balance.streams.footprint;

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;

    if (!enemy.active) {
      if (enemy.z - squad.z > balance.enemies.activationDistance) continue;
      enemy.active = true;
      events.enemyActivated(enemy.id);
    }

    enemy.z -= effectiveSpeed(enemy, state.time) * dt;

    if (Math.abs(enemy.z - squad.z) <= contact) {
      if (enemy.streamId !== undefined) {
        // One body, one soldier (D29). No share, no rounding: the player counts
        // the ones that got through.
        if (Math.abs(enemy.x - squad.x) < streamHalf + squadHalf) {
          killEnemy(enemy, state.time);
          onLeak(enemy);
          events.enemyLeaked(enemy.id, enemy.streamId, enemy.x, enemy.z);
          events.enemyKilled(enemy.id, enemy.kind, enemy.x, enemy.z, enemy.streamId);
          hitSquad(1, 'leak');
          if (state.status !== 'running') return;
          continue;
        }
      } else {
        const half = enemyFootprint(enemy.kind, enemy.units, balance);
        const share = overlapShare(
          enemy.x,
          half,
          squad.x,
          squadHalf,
          balance.enemies.contactMinShare,
        );
        if (share > 0) {
          const taken = Math.max(1, Math.ceil(enemy.units * share));
          killEnemy(enemy, state.time);
          events.enemyKilled(enemy.id, enemy.kind, enemy.x, enemy.z);
          hitSquad(taken, 'contact');
          if (state.status !== 'running') return;
          continue;
        }
      }
    }

    // Actors that got past the squad run off the back of the level. A stream
    // body goes sooner than a block: there can be hundreds of them, and every
    // one still on the road is one more entry every sweep walks past.
    const behind =
      enemy.streamId === undefined
        ? balance.enemies.despawnBehind
        : balance.streams.despawnBehind;
    if (enemy.z < squad.z - behind) killEnemy(enemy, state.time);
  }
}

/** Units a block is still worth, from its hp. Used when a block is re-sized. */
export function unitsOf(enemy: EnemyState, balance: Balance): number {
  if (enemy.streamId !== undefined) return 1;
  return Math.ceil(enemy.hp / enemyBalance(enemy.kind, balance).hpPerUnit);
}
