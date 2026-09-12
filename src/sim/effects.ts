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
 */

import { enemyHalfWidth } from './enemies';
import type { EventBuffer } from './events';
import type { TargetList } from './targeting';
import type { EnemyState, RunState } from './types';
import { blockGap } from './weapons';
import type { Balance, ShatterDef, WeaponSlow } from '@/data/types';

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

  constructor(
    balance: Balance,
    events: EventBuffer,
    targets: TargetList,
    damage: ApplyDamage,
    shatter: ShatterDef | null,
  ) {
    this.balance = balance;
    this.events = events;
    this.targets = targets;
    this.damage = damage;
    this.shatterDef = shatter;
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
    source: EnemyState,
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
