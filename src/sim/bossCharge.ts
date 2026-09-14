/**
 * The Rime Fiend's lane charge (D49): boss 2's second attack.
 *
 * Boss 1 is a wall that walks the squad down and stomps. The Rime Fiend does
 * that too — the stomp, the grind and the enrage are the shared boss code next
 * door — and every `rime.charge.interval` seconds it also picks the lane the
 * column is standing in, runs down it at several times its walking speed to
 * `depth` metres past the column's front, and walks back to the spot it
 * started from.
 *
 * Two things make it a move rather than a number. It commits to a lane, once,
 * at the moment it sets off, so the answer is the thumb: a column standing
 * anywhere else is a column it runs past. And it kills along its *path* —
 * `share` of the crowd, spread over the metres it covers — so the dead are the
 * people it actually ran over rather than a share of an anonymous total.
 *
 * While it is out of position the stomp clock and the contact grind are
 * paused: it is not standing over anybody to stomp on. That is what keeps the
 * charge a trade rather than a second tax, and it is why a charge does not
 * start once the boss is enraged (`whileEnraged`) — the enraged stomp is
 * already the short clock, and a charge on top of it is a wipe.
 *
 * Kept apart from `boss.ts` so the arena fight stays one readable file
 * (CLAUDE.md). Nothing here allocates: the result is re-used every step.
 */

import { laneCenter, laneOf } from './lanes';
import type { EnemyState, Lane, SquadState } from './types';
import type { Balance } from '@/data/types';

/** Slack on the two positions the phases end at, which are hit exactly. */
const EPSILON = 1e-6;

export interface RimeStep {
  /** True on the step a charge begins, once per charge. */
  started: boolean;
  /** The lane it committed to, valid on the step it started. */
  lane: Lane;
  /** Units it ran over this step; `Run` takes them nearest its own position. */
  kills: number;
  /** True while it is away from its stand: the stomp and the grind wait. */
  busy: boolean;
}

export class RimeCharge {
  /** Seconds since the last charge ended. */
  private timer = 0;

  /** Out is the run at the column, back is the walk home, idle is neither. */
  private phase: 'idle' | 'out' | 'back' = 'idle';

  /** Where it stood when it set off, and what it goes back to. */
  private standZ = 0;

  /** Units this charge is worth in total, and the fraction not yet spent. */
  private budget = 0;
  private carry = 0;

  /** Metres the outbound run covers, so the kills can be spread along them. */
  private outbound = 1;

  /** Re-used every step: the sim must not allocate in hot loops (CLAUDE.md). */
  private readonly result: RimeStep = { started: false, lane: 0, kills: 0, busy: false };

  update(
    boss: EnemyState,
    squad: SquadState,
    balance: Balance,
    dt: number,
    enraged: boolean,
    time: number,
  ): RimeStep {
    const out = this.result;
    out.started = false;
    out.kills = 0;

    const charge = balance.enemies.boss.rime.charge;

    if (this.phase === 'idle') {
      out.busy = false;
      // The clock only runs while a charge could actually come of it, so an
      // enrage does not bank up a charge to be spent the moment it ends.
      if (enraged && !charge.whileEnraged) return out;
      this.timer += dt;
      if (this.timer < charge.interval) return out;
      this.begin(boss, squad, balance, time);
      out.started = true;
      out.lane = boss.charge?.lane ?? 0;
    }

    out.busy = true;
    this.steer(boss, balance, dt);

    if (this.phase === 'out') this.runIn(boss, squad, balance, dt, out);
    else this.walkBack(boss, charge.returnSpeed * dt);
    return out;
  }

  private begin(boss: EnemyState, squad: SquadState, balance: Balance, time: number): void {
    const charge = balance.enemies.boss.rime.charge;
    const lane = laneOf(squad.x, balance.road.laneWidth);
    this.standZ = boss.z;
    this.outbound = Math.max(EPSILON, boss.z - (squad.z - charge.depth));
    this.budget = squad.count * charge.share;
    this.carry = 0;
    this.phase = 'out';
    this.timer = 0;
    // `until` is what render times the lunge against, and it is a *sim time*
    // exactly as a charger's is (`chargers.ts`): when the run in should be
    // over, at the gap it set off from.
    boss.charge = { until: time + this.outbound / Math.max(0.1, charge.speed), lane };
  }

  /** Into the lane it picked, at its own lateral speed. */
  private steer(boss: EnemyState, balance: Balance, dt: number): void {
    const lane = boss.charge?.lane;
    if (lane === undefined) return;
    const wanted = laneCenter(lane, balance.road.laneWidth);
    const step = balance.enemies.boss.rime.charge.lateralSpeed * dt;
    const gap = wanted - boss.x;
    boss.x += Math.abs(gap) <= step ? gap : Math.sign(gap) * step;
  }

  /**
   * The run in. The kill budget is spent per metre covered rather than per
   * second, so a charge that starts from further out does not kill more —
   * what it is worth is the crowd it passes through, not the road it crossed.
   */
  private runIn(
    boss: EnemyState,
    squad: SquadState,
    balance: Balance,
    dt: number,
    out: RimeStep,
  ): void {
    const charge = balance.enemies.boss.rime.charge;
    const target = squad.z - charge.depth;
    const next = Math.max(target, boss.z - charge.speed * dt);
    const moved = boss.z - next;
    boss.z = next;

    this.carry += (this.budget * moved) / this.outbound;
    const kills = Math.floor(this.carry);
    if (kills > 0) {
      this.carry -= kills;
      out.kills = kills;
    }
    if (boss.z <= target + EPSILON) this.phase = 'back';
  }

  /** Home again, and the interval starts counting from there. */
  private walkBack(boss: EnemyState, step: number): void {
    boss.z = Math.min(this.standZ, boss.z + step);
    if (boss.z < this.standZ - EPSILON) return;
    boss.z = this.standZ;
    this.phase = 'idle';
    this.timer = 0;
    delete boss.charge;
  }
}
