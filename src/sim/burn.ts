/**
 * Ember's fire: the burn its first evolution lights (D33), and the wildfire its
 * third passes on (D54).
 *
 * A hit sets its target alight for a share of its own damage, spread over a
 * couple of seconds; at tier 3 each fire the squad starts hops once to whatever
 * that body is touching, at a share of what it is itself.
 *
 * Burning bodies are kept in their own list rather than found by walking the
 * road: a river is three hundred bodies and the burn ticks four times a second,
 * so a scan per step would cost more than the fire does. The list is the only
 * allocation, it grows to the high-water mark of simultaneously burning bodies
 * and never shrinks, and entries leave it the step after their body dies.
 *
 * A second hit refreshes rather than stacks (the plan's rule): the clock is
 * reset and the per-tick damage is the larger of the two, so setting a body on
 * fire again cannot multiply the burn — it can only make it hotter or longer.
 */

import { enemyHalfWidth } from './enemies';
import type { EventBuffer } from './events';
import type { TargetList } from './targeting';
import type { EnemyState, RunState } from './types';
import { blockGap } from './weapons';
import type { Balance, BurnDef, WildfireBalance } from '@/data/types';

/** Damage applied through the sim's one kill path (`Firing.hit`). */
export type HitFn = (state: RunState, enemy: EnemyState, amount: number) => void;

/**
 * Ember tier 3 (D54), when the player holds it: what a burning body passes on,
 * and the lane lists it finds a neighbour in.
 */
export interface Wildfire {
  tuning: WildfireBalance;
  targets: TargetList;
  balance: Balance;
}

export class Burn {
  private readonly def: BurnDef;
  private readonly events: EventBuffer;
  private readonly hit: HitFn;
  private readonly ticks: number;
  private readonly burning: EnemyState[] = [];

  /** Ember tier 3, or null. */
  private readonly wildfire: Wildfire | null;

  /**
   * Bodies the squad set alight this step that have not yet passed the fire on.
   *
   * Only bodies lit by a *shot* are in here, and each one only on the step it
   * was lit: that is what "one hop per source" is, and it is what bounds the
   * mechanic. A fire that arrived by spreading never enters this list, so a
   * river takes `maxTargets` extra fires from each body the squad actually hit
   * rather than `maxTargets ^ n` from a chain reaction down the lane.
   *
   * Pooled like `burning`: it grows to the high-water mark and is emptied, not
   * re-allocated (CLAUDE.md).
   */
  private readonly pending: EnemyState[] = [];

  /** Neighbours the spread in hand has lit, against `maxTargets`. */
  private spreadCount = 0;

  constructor(def: BurnDef, events: EventBuffer, hit: HitFn, wildfire: Wildfire | null = null) {
    this.def = def;
    this.events = events;
    this.hit = hit;
    this.ticks = Math.max(1, Math.round(def.seconds / Math.max(0.01, def.tickSeconds)));
    this.wildfire = wildfire;
  }

  /** Lights `enemy` up for `share` of `damage`, or refreshes a burn already on it. */
  ignite(enemy: EnemyState, damage: number, time: number): void {
    if (!enemy.alive || damage <= 0) return;
    const lit = this.light(enemy, (damage * this.def.share) / this.ticks, time);
    // A fire the squad started, so it is the one that may hop (see `pending`).
    if (lit && this.wildfire !== null) this.pending.push(enemy);
  }

  /**
   * The burn itself, at a per-tick cost the caller has already worked out.
   * Returns true when this *started* a fire rather than refreshing one.
   *
   * A second hit refreshes rather than stacks (the Milestone 4 rule): the clock
   * is reset and the per-tick damage is the larger of the two, so setting a
   * body on fire again cannot multiply the burn — it can only make it hotter or
   * longer.
   */
  private light(enemy: EnemyState, perTick: number, time: number): boolean {
    const alight = enemy.burning === true && (enemy.burnUntil ?? 0) > time;

    enemy.burnPerTick = alight ? Math.max(enemy.burnPerTick ?? 0, perTick) : perTick;
    enemy.burnUntil = time + this.def.seconds;
    if (alight) return false;

    enemy.burnNextAt = time + this.def.tickSeconds;
    enemy.burning = true;
    this.burning.push(enemy);
    this.events.enemyBurning(enemy.id, enemy.x, enemy.z, this.def.seconds);
    return true;
  }

  /** One tick's worth of fire on everything currently alight. */
  update(state: RunState): void {
    const step = this.def.tickSeconds;
    for (let i = this.burning.length - 1; i >= 0; i--) {
      const enemy = this.burning[i];
      if (enemy === undefined) continue;

      if (!enemy.alive || state.time > (enemy.burnUntil ?? 0)) {
        enemy.burning = false;
        enemy.burnUntil = 0;
        const last = this.burning.pop();
        if (last !== undefined && i < this.burning.length) this.burning[i] = last;
        continue;
      }

      const due = enemy.burnNextAt ?? 0;
      if (state.time < due) continue;
      // One tick per step at most: the step is 1/60 s and a tick is a quarter of
      // a second, so a burn can never fall behind its own clock.
      enemy.burnNextAt = due + step;
      this.hit(state, enemy, enemy.burnPerTick ?? 0);
      if (state.status !== 'running') return;
    }

    this.spread(state);
  }

  /**
   * Ember tier 3: every fire the squad started this step passes itself to the
   * bodies it is touching, once.
   *
   * The new fire is a *share of the old one's per-tick damage*, not of the shot
   * that lit it: the fire spreading cannot be hotter than the fire it came
   * from, so a river cannot be set alight at full strength by one body at the
   * front of it. With one hop and a share under one, what the whole mechanic
   * can ever add is `maxTargets * share` of the fires the squad lit itself.
   */
  private spread(state: RunState): void {
    const wildfire = this.wildfire;
    if (wildfire === null) return;
    const { tuning, targets, balance } = wildfire;
    const reach = tuning.radius + balance.enemies.footprintMax;

    for (const source of this.pending) {
      if (!source.alive || source.burning !== true) continue;
      const perTick = (source.burnPerTick ?? 0) * tuning.share;
      if (perTick <= 0) continue;
      this.spreadCount = 0;
      targets.forEachNear(source.z, reach, (enemy) => {
        if (enemy === source || enemy.burning === true) return true;
        const half = enemyHalfWidth(enemy, balance);
        if (blockGap(enemy.x, half, source.x, 0, enemy.z - source.z) > tuning.radius) return true;
        this.light(enemy, perTick, state.time);
        this.spreadCount++;
        return this.spreadCount < tuning.maxTargets;
      });
    }
    this.pending.length = 0;
  }
}
