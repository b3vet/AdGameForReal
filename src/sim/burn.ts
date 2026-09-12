/**
 * Ember's evolution (D33): a hit sets its target alight for a share of its own
 * damage, spread over a couple of seconds.
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

import type { EventBuffer } from './events';
import type { EnemyState, RunState } from './types';
import type { BurnDef } from '@/data/types';

/** Damage applied through the sim's one kill path (`Firing.hit`). */
export type HitFn = (state: RunState, enemy: EnemyState, amount: number) => void;

export class Burn {
  private readonly def: BurnDef;
  private readonly events: EventBuffer;
  private readonly hit: HitFn;
  private readonly ticks: number;
  private readonly burning: EnemyState[] = [];

  constructor(def: BurnDef, events: EventBuffer, hit: HitFn) {
    this.def = def;
    this.events = events;
    this.hit = hit;
    this.ticks = Math.max(1, Math.round(def.seconds / Math.max(0.01, def.tickSeconds)));
  }

  /** Lights `enemy` up for `share` of `damage`, or refreshes a burn already on it. */
  ignite(enemy: EnemyState, damage: number, time: number): void {
    if (!enemy.alive || damage <= 0) return;
    const perTick = (damage * this.def.share) / this.ticks;
    const alight = enemy.burning === true && (enemy.burnUntil ?? 0) > time;

    enemy.burnPerTick = alight ? Math.max(enemy.burnPerTick ?? 0, perTick) : perTick;
    enemy.burnUntil = time + this.def.seconds;
    if (alight) return;

    enemy.burnNextAt = time + this.def.tickSeconds;
    enemy.burning = true;
    this.burning.push(enemy);
    this.events.enemyBurning(enemy.id, enemy.x, enemy.z, this.def.seconds);
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
  }
}
