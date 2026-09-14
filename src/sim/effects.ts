/**
 * What a staff does to everything *around* the body it hit: ember's splash,
 * storm's arc, and the spray an evolved frost throws when a frozen body comes
 * apart.
 *
 * Split out of `firing.ts` in Milestone 4, when the evolutions (D33) pushed it
 * past the file budget. Everything here reads the lane lists rather than the
 * road — a splash with three hundred bodies out there must not be a scan — and
 * hands its damage back to the one kill path in `Firing` through the callback
 * it is constructed with, so a body killed by a splash books its stream, its
 * events and its corpse exactly as one killed by a shot does.
 *
 * Milestone 8 added the two D54 mechanics that are the same shape: frost's
 * freeze pulse, which is a shatter that spreads cold instead of damage, and
 * storm's overcharge, which is an arc to everything at once instead of to the
 * next body along. They are here rather than in files of their own because
 * they are the same three lines of scan-and-apply over the same lane lists,
 * and a fourth copy of that is a fourth place to get a cascade guard wrong.
 * The two that are *not* here are the two that run on a clock rather than on a
 * hit (`./meteor.ts`, `./glacier.ts`).
 */

import { enemyHalfWidth } from './enemies';
import type { HeldEvolutions } from './evolutions';
import { anyStaff } from './evolutions';
import type { EventBuffer } from './events';
import type { TargetList } from './targeting';
import type { EnemyState, RunState, WeaponId } from './types';
import { blockGap, weaponOf } from './weapons';
import type {
  Balance,
  FreezePulseBalance,
  OverchargeBalance,
  ShatterDef,
  WeaponSlow,
} from '@/data/types';

/** `Firing.damage`, bound: one place books a kill. */
export type ApplyDamage = (
  state: RunState,
  enemy: EnemyState,
  amount: number,
  slow: WeaponSlow | undefined,
) => void;

export class WeaponEffects {
  private readonly balance: Balance;
  private readonly events: EventBuffer;
  private readonly targets: TargetList;
  private readonly damage: ApplyDamage;
  private readonly shatterDef: ShatterDef | null;

  /** Ids already struck by the arc being resolved. Re-used, never re-allocated. */
  private readonly chained: number[] = [];

  /** Scratch for the lane scans, so no closure has to capture a local. */
  private scanBest: EnemyState | null = null;
  private scanGap = 0;
  private scanSplashed = false;

  /** True while a shatter's own spray is resolving, so it cannot cascade. */
  private shattering = false;

  /** The same, for the chill a freeze pulse spreads. */
  private pulsing = false;

  /** Frost tier 3, when the player holds it: the chill a frozen death leaves. */
  private readonly freezeDef: FreezePulseBalance | null;

  /** Storm tier 4, when the player holds it, and which staffs switch it on. */
  private readonly overchargeDef: OverchargeBalance | null;
  private readonly overchargeStaffs: Record<WeaponId, boolean>;

  /** Volleys since the last arc, and when that arc was. See `everyVolleys`. */
  private volleys = 0;
  private lastArc = -Infinity;

  /** Bodies the pass in hand has touched, against its own cap. */
  private scanCount = 0;

  constructor(
    balance: Balance,
    events: EventBuffer,
    targets: TargetList,
    damage: ApplyDamage,
    held: HeldEvolutions,
  ) {
    this.balance = balance;
    this.events = events;
    this.targets = targets;
    this.damage = damage;
    this.shatterDef = held.shatter;
    const tuning = balance.evolutions;
    // Frost's tier 3 follows the *player* rather than the staff in hand, for
    // the reason its tier 2 does: the ice that chills the neighbours is the ice
    // already on the body, not whatever the squad is carrying when it dies.
    this.freezeDef = anyStaff(held.freezePulse) ? tuning.frost.freezePulse : null;
    // Storm's tier 4 is the opposite case: it *is* the squad firing, so it
    // follows the staff in hand and is checked again at every volley.
    this.overchargeDef = anyStaff(held.overcharge) ? tuning.storm.overcharge : null;
    this.overchargeStaffs = held.overcharge;
  }

  /**
   * Everything within `radius` of the impact takes a share of the shot, falling
   * off linearly with distance. Measured to the edge of each body, not its
   * centre, so a wide block in the next lane is genuinely "next to" the blast —
   * and read out of the lane lists rather than by walking the whole road, which
   * is what keeps a splash cheap with three hundred bodies out there.
   */
  splash(
    state: RunState,
    /** Excluded from the blast; null for a blast that came from no body at all. */
    source: EnemyState | null,
    x: number,
    z: number,
    damage: number,
    radius: number,
    falloff: number,
    slow: WeaponSlow | undefined,
  ): void {
    this.scanSplashed = false;
    this.targets.forEachNear(z, radius + this.balance.enemies.footprintMax, (enemy) => {
      if (enemy === source) return true;
      const half = enemyHalfWidth(enemy, this.balance);
      const gap = blockGap(enemy.x, half, x, 0, enemy.z - z);
      if (gap > radius) return true;
      const share = 1 - falloff * (gap / radius);
      if (share <= 0) return true;
      this.scanSplashed = true;
      this.damage(state, enemy, damage * share, slow);
      return state.status === 'running';
    });
    if (this.scanSplashed) this.events.splash(x, z, radius);
  }

  /** Up to `count` further bodies, each within `range` of the last one hit. */
  chain(
    state: RunState,
    source: EnemyState,
    damage: number,
    count: number,
    range: number,
    slow: WeaponSlow | undefined,
  ): void {
    this.chained.length = 0;
    this.chained.push(source.id);

    let from = source;
    for (let link = 0; link < count; link++) {
      const next = this.nearestUnchained(from, range);
      if (next === null) return;
      this.chained.push(next.id);
      this.events.chain(from.id, next.id);
      this.damage(state, next, damage, slow);
      if (state.status !== 'running') return;
      from = next;
    }
  }

  /**
   * Frost's evolution: the ice going off takes the neighbours with it.
   *
   * Guarded against cascading — a neighbour that dies frozen shatters too, and
   * without the flag one shot into a packed river would resolve as a chain
   * reaction down the whole lane.
   */
  shatter(state: RunState, source: EnemyState, damage: number): void {
    const shatter = this.shatterDef;
    if (shatter === null || this.shattering || damage <= 0) return;
    this.shattering = true;
    // No falloff: a shatter is a body coming apart, not a blast with a centre.
    this.splash(state, source, source.x, source.z, damage * shatter.share, shatter.radius, 0, undefined);
    this.shattering = false;
  }

  /**
   * Frost tier 3 (D54): a body that dies frozen chills whatever is standing
   * around it — the same slow the staff itself applies, spread by the death.
   *
   * It costs no damage at all, which is the point: what it buys is *time*, and
   * on a river that is the whole of frost's case. Capped at `maxTargets` and
   * guarded against re-entry like the shatter, so one death chills a circle
   * rather than a lane.
   */
  freezePulse(state: RunState, source: EnemyState): void {
    const tuning = this.freezeDef;
    if (tuning === null || this.pulsing) return;
    this.pulsing = true;
    this.scanCount = 0;
    const reach = tuning.radius + this.balance.enemies.footprintMax;
    this.targets.forEachNear(source.z, reach, (enemy) => {
      if (enemy === source) return true;
      const half = enemyHalfWidth(enemy, this.balance);
      if (blockGap(enemy.x, half, source.x, 0, enemy.z - source.z) > tuning.radius) return true;
      // Announced only where it is news: `enemySlowed` is what render starts a
      // frost shader on, and a body already walking at half speed has one.
      if ((enemy.slowUntil ?? 0) <= state.time) this.events.enemySlowed(enemy.id, tuning.seconds);
      enemy.slowUntil = state.time + tuning.seconds;
      enemy.slowFactor = tuning.factor;
      this.scanCount++;
      return this.scanCount < tuning.maxTargets;
    });
    this.pulsing = false;
    if (this.scanCount > 0) this.events.freezePulse(source.x, source.z, tuning.radius);
  }

  /**
   * Storm tier 4 (D54): every `everyVolleys` volleys the charge goes to
   * everything in range at once instead of down one lane.
   *
   * Called once a step by `Firing` on every step the squad fired, with the
   * squad's whole output per second; what one arc is worth is that output over
   * `secondsOfFire`, split evenly between the bodies it reaches. Split rather
   * than paid per body because an arc that hit forty bodies for a full share
   * each would be forty times a volley on exactly the rows that are already
   * the hardest — a river — and a tier is meant to be worth a fixed share of a
   * run, not a jackpot on the rows where the run is decided.
   */
  overcharge(state: RunState, output: number): void {
    const tuning = this.overchargeDef;
    if (tuning === null || !this.overchargeStaffs[weaponOf(state.squad)]) return;
    this.volleys++;
    if (this.volleys < tuning.everyVolleys || state.time - this.lastArc < tuning.minSeconds) return;

    const squad = state.squad;
    const reached = this.countNear(squad.x, squad.z, tuning.radius, tuning.maxTargets);
    if (reached <= 0) return;
    this.volleys = 0;
    this.lastArc = state.time;

    const each = (output * tuning.secondsOfFire) / reached;
    this.scanCount = 0;
    this.targets.forEachNear(squad.z, tuning.radius, (enemy) => {
      if (Math.hypot(enemy.x - squad.x, enemy.z - squad.z) > tuning.radius) return true;
      this.scanCount++;
      this.damage(state, enemy, each, undefined);
      return state.status === 'running' && this.scanCount < reached;
    });
    this.events.overcharge(squad.x, squad.z, tuning.radius, reached);
  }

  /** Live bodies within `radius` of `(x, z)`, counted up to `cap`. */
  private countNear(x: number, z: number, radius: number, cap: number): number {
    this.scanCount = 0;
    this.targets.forEachNear(z, radius, (enemy) => {
      if (Math.hypot(enemy.x - x, enemy.z - z) > radius) return true;
      this.scanCount++;
      return this.scanCount < cap;
    });
    return this.scanCount;
  }

  private nearestUnchained(from: EnemyState, range: number): EnemyState | null {
    this.scanBest = null;
    this.scanGap = range;
    this.targets.forEachNear(from.z, range, (enemy) => {
      if (enemy === from || this.chained.includes(enemy.id)) return true;
      const gap = Math.hypot(enemy.x - from.x, enemy.z - from.z);
      if (gap <= this.scanGap) {
        this.scanGap = gap;
        this.scanBest = enemy;
      }
      return true;
    });
    return this.scanBest;
  }
}
