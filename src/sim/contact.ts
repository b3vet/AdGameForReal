/**
 * Everything walking into the squad.
 *
 * Two rules live here. A *block* costs the share of its units that actually met
 * the crowd (Milestone 2's overlap rule). A *stream body* costs exactly one
 * unit, whatever the angle — the product owner's rule for Milestone 3 (D29) —
 * and is reported separately as a leak, because a leak is what the stream
 * pressure bands are measured in.
 *
 * Milestone 6 changed two things and deliberately not a third. It is asked
 * once per *group* now (D44), so a straggler column fighting on its own in the
 * next lane meets the bodies walking down that lane. And the units it takes are
 * the ones standing nearest the thing that hit them, front or flank, rather
 * than an anonymous subtraction — which is what `Run` does with the position
 * this reports.
 *
 * What did not change is *how many* die: a contact is still measured against
 * the group's own leader and formation half-width. That is what lets the enemy
 * shove (D43) bow the front of the column without changing the arithmetic the
 * campaign is balanced on — the shove moves where people are standing when they
 * die, never how many of them do.
 */

import { chargerKills, startCharge, steerCharger } from './chargers';
import { activationRange, enemyBalance, enemyFootprint } from './enemies';
import type { EventBuffer } from './events';
import { halfWidth } from './formation';
import type { EnemyState, GroupState, RunState, UnitLossReason } from './types';
import type { Balance } from '@/data/types';

/** What `advanceEnemies` calls to take units off the squad. `x` and `z` are
 *  where the blow landed; `group` is whose crowd took it. */
export type HitSquad = (
  amount: number,
  reason: UnitLossReason,
  x: number,
  z: number,
  group: number,
) => void;

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
 * The one group a state without a crowd has. Re-used rather than allocated:
 * render's dev fixtures build a `RunState` by hand and have no crowd in it.
 */
const soloGroup: GroupState = { id: 0, count: 0, leaderX: 0, z: 0, lane: null, rejoinAt: 0 };
const solo: GroupState[] = [soloGroup];

/**
 * Each group's formation half-width this step: written once a step and read
 * once per enemy per group, so the arithmetic happens `groups` times and not
 * `groups * enemies` times.
 *
 * Pooled rather than allocated per step (CLAUDE.md), and grown rather than
 * truncated. Sixteen covers `crowd.groupCap` several times over, but a cap
 * raised past it would otherwise have left the groups above the sixteenth
 * unable to be walked into by anything — a straggler column that quietly
 * cannot be hit is a worse failure than one `new Float64Array` on the step a
 * bigger cap is first seen.
 */
let halves = new Float64Array(16);

function groupsOf(state: RunState): readonly GroupState[] {
  const groups = state.groups;
  if (groups !== undefined) return groups;
  soloGroup.count = state.squad.count;
  soloGroup.leaderX = state.squad.x;
  soloGroup.z = state.squad.z;
  return solo;
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
  const streamHalf = balance.streams.footprint;
  const groups = groupsOf(state);
  const groupCount = groups.length;
  if (groupCount > halves.length) halves = new Float64Array(groupCount);
  for (let g = 0; g < groupCount; g++) {
    const group = groups[g];
    halves[g] = group === undefined ? 0 : halfWidth(group.count, squad.formationWidth, balance);
  }

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;

    if (!enemy.active) {
      // A charger has a trigger range of its own (D49): it stands still until
      // the column is close enough, and the step it wakes on is the step it
      // commits to a lane.
      if (enemy.z - squad.z > activationRange(enemy.kind, balance)) continue;
      enemy.active = true;
      events.enemyActivated(enemy.id);
      if (enemy.kind === 'charger') startCharge(enemy, state, balance, events);
    }

    enemy.z -= effectiveSpeed(enemy, state.time) * dt;
    if (enemy.kind === 'charger') steerCharger(enemy, balance, dt);

    let hit = false;
    for (let g = 0; g < groupCount && !hit; g++) {
      const group = groups[g];
      if (group === undefined || group.count <= 0) continue;
      if (Math.abs(enemy.z - group.z) > contact) continue;
      const squadHalf = halves[g] ?? 0;

      if (enemy.streamId !== undefined) {
        // One body, one soldier (D29). No share, no rounding: the player counts
        // the ones that got through.
        if (Math.abs(enemy.x - group.leaderX) >= streamHalf + squadHalf) continue;
        killEnemy(enemy, state.time);
        onLeak(enemy);
        events.enemyLeaked(enemy.id, enemy.streamId, enemy.x, enemy.z);
        events.enemyKilled(enemy.id, enemy.kind, enemy.x, enemy.z, enemy.streamId);
        hitSquad(1, 'leak', enemy.x, enemy.z, group.id);
        hit = true;
      } else {
        const half = enemyFootprint(enemy.kind, enemy.units, balance);
        const share = overlapShare(
          enemy.x,
          half,
          group.leaderX,
          squadHalf,
          balance.enemies.contactMinShare,
        );
        if (share <= 0) continue;
        // A charger is a runner rather than a block: what it costs is its own
        // bite of whoever it reached, not a share of its printed number, which
        // is small on purpose so it can be shot out of the lane (D49).
        const taken =
          enemy.kind === 'charger'
            ? chargerKills(group.count, balance)
            : Math.max(1, Math.ceil(enemy.units * share));
        killEnemy(enemy, state.time);
        events.enemyKilled(enemy.id, enemy.kind, enemy.x, enemy.z);
        hitSquad(taken, 'contact', enemy.x, enemy.z, group.id);
        hit = true;
      }
    }
    if (state.status !== 'running') return;
    if (hit) continue;

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
