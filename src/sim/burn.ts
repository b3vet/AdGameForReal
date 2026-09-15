/**
 * Ember's fire: the burn its first evolution lights (D33), and the wildfire its
 * third passes on (D54).
 *
 * A hit sets its target alight for a share of its own damage, spread over the
 * following second; at tier 3 a fire the squad is feeding hands a share of what
 * it is being fed to whatever that body is touching.
 *
 * Burning bodies are kept in their own list rather than found by walking the
 * road: a river is three hundred bodies and the burn ticks four times a second,
 * so a scan per step would cost more than the fire does. The list is the only
 * allocation, it grows to the high-water mark of simultaneously burning bodies
 * and never shrinks, and entries leave it the step after their body dies.
 *
 * A second hit adds to the fire rather than restarting it, and Milestone 8's
 * balance pass is why. The Milestone 4 rule was "refresh, and take the larger
 * per-tick damage", written for a world where a hit is a discrete event; the
 * squad fires in sixtieths of a second, so "the hit that lit it" was one step's
 * slice of a volley and the whole evolution was worth a quarter of a percent of
 * the squad's output — measured, 0.1 percent end to end, and the wildfire that
 * hops it was worth nothing at all because there was nothing to hop.
 *
 * What a body carries now is a *pool* of damage still owed, drained over
 * `seconds` in ticks of `tickSeconds`, and a hit adds `share` of itself to it.
 * The pool is drained fast — `seconds` is well under one — for the same reason:
 * a body under a squad's fire lives a fraction of a second, and a fire that
 * takes two seconds to hand over what it owes hands over a fifth of it before
 * the body it is on is dead and the rest is thrown away.
 * That is the same sentence the Workbench prints — a hit sets its target alight
 * for a share of its own damage — read at every time scale rather than at one:
 * a single hit and no follow-up still burns for exactly `share` of it, and a
 * body held under continuous fire burns at `share` of the fire landing on it,
 * which is what the words meant all along. It cannot multiply, because the
 * total is `share` of the damage that was actually dealt.
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
   * The fires the squad fed this step, and what each of them was fed, for
   * ember tier 3 to hand on at the end of the step.
   *
   * Fed rather than *lit*, which is the Milestone 8 correction and the whole
   * of why the tier measured at nothing. A body under a squad's fire is set
   * alight on the first step and fed on every step after it, so hopping only
   * on the step a fire *starts* handed on one sixtieth of a second of a volley
   * — and hopping when the fire first ticked was worse still, because nine
   * bodies in ten die inside the quarter second before their first tick. What
   * spreads is what the squad is pouring in, as it pours it in.
   *
   * A fire that arrived by spreading never enters this list (`burnSpreads`),
   * so what the mechanic can ever add is `maxTargets * share` of the fires the
   * squad lit itself, and never `maxTargets ^ n` down a lane.
   *
   * Pooled like `burning`: both grow to the high-water mark and are emptied,
   * not re-allocated (CLAUDE.md).
   */
  private readonly pending: EnemyState[] = [];
  private readonly pendingOwed: number[] = [];

  /** Neighbours the spread in hand has lit, against `maxTargets`. */
  private spreadCount = 0;

  constructor(def: BurnDef, events: EventBuffer, hit: HitFn, wildfire: Wildfire | null = null) {
    this.def = def;
    this.events = events;
    this.hit = hit;
    this.ticks = Math.max(1, Math.round(def.seconds / Math.max(0.01, def.tickSeconds)));
    this.wildfire = wildfire;
  }

  /** Adds `share` of `damage` to whatever fire `enemy` is already carrying. */
  ignite(enemy: EnemyState, damage: number, time: number): void {
    if (!enemy.alive || damage <= 0) return;
    const owed = damage * this.def.share;
    this.light(enemy, owed, time);
    // A fire the squad is feeding is a fire the squad started, so it is the one
    // that may hand itself on — at the end of the step, with this much in it.
    enemy.burnSpreads = true;
    if (this.wildfire !== null) {
      this.pending.push(enemy);
      this.pendingOwed.push(owed);
    }
  }

  /**
   * Adds `owed` damage to this body's fire and pushes its clock out to the full
   * `seconds`, filing it under the burning list if it was not alight already.
   *
   * Adding rather than refreshing to the larger per-tick is the Milestone 8
   * change (see the file note): the total a body ever takes is `share` of the
   * damage actually dealt to it, which is what the Workbench's copy says and
   * what the Milestone 4 rule could not deliver at a sixtieth of a second.
   */
  private light(enemy: EnemyState, owed: number, time: number): void {
    const alight = enemy.burning === true && (enemy.burnUntil ?? 0) > time;

    enemy.burnLeft = (alight ? enemy.burnLeft ?? 0 : 0) + owed;
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
        enemy.burnLeft = 0;
        enemy.burnSpreads = false;
        const last = this.burning.pop();
        if (last !== undefined && i < this.burning.length) this.burning[i] = last;
        continue;
      }

      const due = enemy.burnNextAt ?? 0;
      if (state.time < due) continue;
      // One tick per step at most: the step is a sixtieth of a second and a
      // tick is `tickSeconds`, which is many times that, so a burn can never
      // fall behind its own clock.
      enemy.burnNextAt = due + step;
      // The pool spread over the ticks it has left, so a fire that is being fed
      // burns hotter and one that is not still ends with nothing owed.
      const left = Math.max(0, enemy.burnLeft ?? 0);
      const remaining = Math.max(1, Math.ceil(((enemy.burnUntil ?? 0) - state.time) / step));
      const amount = left / Math.min(this.ticks, remaining);
      enemy.burnLeft = left - amount;
      this.hit(state, enemy, amount);
      if (state.status !== 'running') return;
    }

    this.spread(state);
  }

  /**
   * Ember tier 3: every fire the squad fed this step hands a share of what it
   * was fed to the bodies it is touching.
   *
   * A share of the *feed* rather than of the pool, so the fire spreading is
   * never hotter than the fire it came from: a body that is taking a volley
   * passes on `share` of what the volley is putting into it, and a body that
   * is taking nothing passes on nothing. The bodies it reaches take it as
   * fire, alight or not — a river is fed from the front while the front is
   * being shot, which is what "hands the fire to whatever it is touching"
   * means when the thing it is touching is already burning.
   *
   * Bounded by the two guards: `maxTargets` bodies a step from each source,
   * and only fires the squad itself is feeding spread at all, so the mechanic
   * is a ring around what the squad is shooting rather than a lane going up.
   */
  private spread(state: RunState): void {
    const wildfire = this.wildfire;
    if (wildfire === null) return;
    const { tuning, targets, balance } = wildfire;
    const reach = tuning.radius + balance.enemies.footprintMax;

    for (let i = 0; i < this.pending.length; i++) {
      const source = this.pending[i];
      if (source === undefined || !source.alive || source.burning !== true) continue;
      const owed = (this.pendingOwed[i] ?? 0) * tuning.share;
      if (owed <= 0) continue;
      this.spreadCount = 0;
      targets.forEachNear(source.z, reach, (enemy) => {
        if (enemy === source) return true;
        const half = enemyHalfWidth(enemy, balance);
        if (blockGap(enemy.x, half, source.x, 0, enemy.z - source.z) > tuning.radius) return true;
        this.spreadCount++;
        // What jumps lands twice: a flare now, and a fire behind it, each
        // worth `share` of what the squad is feeding the body it came from.
        // Fire alone never got to burn — measured, nine parts in ten of a
        // hopped fire were still owed when the squad's own volley killed the
        // body it had landed on, and the tier came to a fifth of a percent of
        // output. The flare is what the hop is worth on a river; the fire is
        // what it looks like, and what it is worth on anything that lives
        // longer than a volley.
        this.hit(state, enemy, owed);
        if (state.status !== 'running') return false;
        if (enemy.alive) {
          this.light(enemy, owed, state.time);
          // Lit by a fire, not by the squad: this one is the end of the ring.
          enemy.burnSpreads = false;
        }
        return this.spreadCount < tuning.maxTargets;
      });
    }
    this.pending.length = 0;
    this.pendingOwed.length = 0;
  }
}
