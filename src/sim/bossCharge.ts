/**
 * The Rime Fiend's lane charge (D49): boss 2's second attack.
 *
 * Boss 1 is a wall that walks the squad down and stomps. The Rime Fiend does
 * that too — the stomp, the grind and the enrage are the shared boss code next
 * door — and every `rime.charge.interval` seconds it also picks the lane the
 * column is standing in, winds up for `windup` seconds, runs down the lane at
 * several times its walking speed to `depth` metres past the column's front,
 * and walks back to the spot it started from.
 *
 * Two things make it a move rather than a number. It commits to a lane, once,
 * at the moment it winds up, so the answer is the thumb: a column that has left
 * the lane by the time the body gets there is a column it runs past. And what
 * it costs is decided by where the body goes (document 29): whoever is standing
 * inside its footprint while it runs in is under it and dies, up to a cap of
 * `killShare` of the crowd it set off against.
 *
 * The rule this replaced took a share of the crowd, spread over the metres the
 * run covered, from whoever stood nearest the body wherever they stood. On the
 * owner's phone that was a charge that hurt nobody, and the numbers agree: two
 * fifths of what the charges killed died while the body was still in front of
 * the column (two thirds on a fight's first charge, which starts from further
 * out), what was left was about what the paused stomp and grind would have
 * taken in the same second, and a column that had moved to another lane paid
 * exactly as much as one that stood there.
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

import { countWithin } from './crowdState';
import type { Swath } from './crowdState';
import { laneCenter, laneOf } from './lanes';
import type { CrowdState, EnemyState, Lane, SquadState } from './types';
import type { Balance } from '@/data/types';

/** Slack on the positions and clocks the phases end at, which are hit exactly. */
const EPSILON = 1e-6;

export interface RimeStep {
  /** True on the step a charge is committed to, once per charge: the tell. */
  started: boolean;
  /** The lane it committed to, valid on the step it started. */
  lane: Lane;
  /** True on the first step this charge kills anybody, once per charge. */
  landed: boolean;
  /**
   * Units standing under the body this step, never more than the charge has
   * left to take. `Run` kills exactly these, inside `swath`.
   */
  kills: number;
  /** The ground the body covers this step; meaningful while `kills` is above 0. */
  readonly swath: Swath;
  /** True while it is away from its stand: the stomp and the grind wait. */
  busy: boolean;
}

export class RimeCharge {
  /** Seconds since the last charge ended. */
  private timer = 0;

  /**
   * Wind-up is the tell before the run, out is the run at the column, back is
   * the walk home, idle is none of them.
   */
  private phase: 'idle' | 'windup' | 'out' | 'back' = 'idle';

  /** Where it stood when it committed, and what it goes back to. */
  private standX = 0;
  private standZ = 0;

  /** Seconds of the wind-up still to go. */
  private windupLeft = 0;

  /** Units this charge may still kill, and whether it has killed anybody yet. */
  private left = 0;
  private landed = false;

  /** Re-used every step: the sim must not allocate in hot loops (CLAUDE.md). */
  private readonly result: RimeStep = {
    started: false,
    lane: 0,
    landed: false,
    kills: 0,
    swath: { x: 0, halfWidth: 0, zLo: 0, zHi: 0 },
    busy: false,
  };

  /** Idle, with its clock at zero, for the next boss to use (`BossController.reset`). */
  reset(): void {
    this.timer = 0;
    this.phase = 'idle';
    this.standX = 0;
    this.standZ = 0;
    this.windupLeft = 0;
    this.left = 0;
    this.landed = false;
  }

  /**
   * `crowd` is the units as agents (D43), read and never written: the charge
   * decides who is under it, and `Run` does the killing.
   */
  update(
    boss: EnemyState,
    squad: SquadState,
    crowd: CrowdState | undefined,
    balance: Balance,
    dt: number,
    enraged: boolean,
    time: number,
  ): RimeStep {
    const out = this.result;
    out.started = false;
    out.landed = false;
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
    } else if (this.phase === 'windup') {
      // Counted from the step after the commitment, so the run's first step is
      // the one at `charge.from` exactly.
      this.windupLeft -= dt;
      if (this.windupLeft <= EPSILON) this.phase = 'out';
    }

    out.busy = true;
    if (this.phase === 'back') {
      this.walkBack(boss, balance, dt);
      return out;
    }
    // Into the lane it picked, during the wind-up as much as the run: the
    // slide across is half of what tells the thumb which lane is marked.
    this.steer(boss, laneCenter(boss.charge?.lane ?? 0, balance.road.laneWidth), charge.lateralSpeed * dt);
    if (this.phase === 'out') this.runIn(boss, squad, crowd, balance, dt, out);
    return out;
  }

  private begin(boss: EnemyState, squad: SquadState, balance: Balance, time: number): void {
    const charge = balance.enemies.boss.rime.charge;
    const lane = laneOf(squad.x, balance.road.laneWidth);
    const windup = Math.max(0, charge.windup);
    this.standX = boss.x;
    this.standZ = boss.z;
    this.windupLeft = windup;
    this.phase = windup > EPSILON ? 'windup' : 'out';
    this.timer = 0;
    this.left = Math.max(Math.round(charge.killFloor), Math.ceil(squad.count * charge.killShare));
    this.landed = false;
    // `from` and `until` are what render times the wind-up and the lunge
    // against, and they are *sim times* exactly as a charger's is
    // (`chargers.ts`): when the run starts, and when it should be over at the
    // gap it sets off from. Nothing moves the boss forward during the wind-up
    // and the column is standing at the arena, so that gap is the one now.
    const outbound = Math.max(0, boss.z - (squad.z - charge.depth));
    const from = time + windup;
    boss.charge = { from, until: from + outbound / Math.max(0.1, charge.speed), lane };
  }

  private steer(boss: EnemyState, wanted: number, step: number): void {
    const gap = wanted - boss.x;
    boss.x += Math.abs(gap) <= step ? gap : Math.sign(gap) * step;
  }

  /** The run in, and whoever it lands on. */
  private runIn(
    boss: EnemyState,
    squad: SquadState,
    crowd: CrowdState | undefined,
    balance: Balance,
    dt: number,
    out: RimeStep,
  ): void {
    const charge = balance.enemies.boss.rime.charge;
    const target = squad.z - charge.depth;
    boss.z = Math.max(target, boss.z - charge.speed * dt);
    if (crowd !== undefined && this.left > 0) this.underfoot(boss, crowd, balance, out);
    if (boss.z <= target + EPSILON) this.phase = 'back';
  }

  /**
   * Who is under the body this step. The footprint is deeper than one step's
   * travel, so nobody it passes over is skipped between two steps, and it is
   * narrower than a lane, so a column one lane over is never inside it.
   * Whoever it cannot take once the cap is spent is left to the shove.
   */
  private underfoot(boss: EnemyState, crowd: CrowdState, balance: Balance, out: RimeStep): void {
    const charge = balance.enemies.boss.rime.charge;
    const swath = out.swath;
    swath.x = boss.x;
    swath.halfWidth = charge.hitHalfWidth;
    swath.zLo = boss.z - charge.hitReach;
    swath.zHi = boss.z + charge.hitReach;
    const kills = Math.min(this.left, countWithin(crowd, swath));
    if (kills <= 0) return;
    this.left -= kills;
    out.kills = kills;
    out.landed = !this.landed;
    this.landed = true;
  }

  /**
   * Home again, to the spot it committed from — across as well as back, so
   * the standing fight picks the body up where it left it rather than
   * snapping it a lane's width onto the road — and the interval starts
   * counting from there.
   */
  private walkBack(boss: EnemyState, balance: Balance, dt: number): void {
    const charge = balance.enemies.boss.rime.charge;
    boss.z = Math.min(this.standZ, boss.z + charge.returnSpeed * dt);
    this.steer(boss, this.standX, charge.lateralSpeed * dt);
    if (boss.z < this.standZ - EPSILON || Math.abs(boss.x - this.standX) > EPSILON) return;
    boss.z = this.standZ;
    boss.x = this.standX;
    this.phase = 'idle';
    this.timer = 0;
    delete boss.charge;
  }
}
