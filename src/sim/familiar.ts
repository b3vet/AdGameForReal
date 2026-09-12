/**
 * The wisp (D33): a familiar that hovers beside the squad and fires on its own
 * clock at whatever is nearest.
 *
 * Its spark is resolved as a *delayed* hit rather than a hitscan — the damage
 * lands `distance / sparkSpeed` seconds after the shot — so render can fly a
 * bolt along and have it arrive exactly when the body reacts. Sparks live in a
 * fixed pool sized by `wisp.maxSparks`, so the familiar allocates nothing after
 * construction; with the pool full it simply holds its fire, which at a couple
 * of shots a second cannot happen outside a pathological tuning.
 *
 * A spark whose target dies before it arrives fizzles silently: the body it was
 * aimed at is gone, and re-targeting in flight would make the wisp better than
 * its fire rate says it is.
 */

import type { EventBuffer } from './events';
import type { TargetList } from './targeting';
import type { EnemyState, FamiliarState, RunState, SquadState } from './types';
import type { Balance, FamiliarTier, WispDef } from '@/data/types';

/** Damage applied through the sim's one kill path (`Firing.hit`). */
export type HitFn = (state: RunState, enemy: EnemyState, amount: number) => void;

interface Spark {
  active: boolean;
  /** The body aimed at, plus its id: pooled bodies are re-used, so the id is
   *  what proves the object is still the same enemy when the spark lands. */
  enemy: EnemyState | null;
  targetId: number;
  damage: number;
  arriveAt: number;
}

export class Familiar {
  private readonly def: WispDef;
  private readonly balance: Balance;
  private readonly events: EventBuffer;
  private readonly targets: TargetList;
  private readonly hit: HitFn;
  private readonly sparks: Spark[] = [];

  private readonly fireRate: number;
  private readonly damage: number;

  /** Scratch for the target scan, so the visitor captures nothing. */
  private bestEnemy: EnemyState | null = null;
  private bestGap = 0;
  private scanX = 0;
  private scanZ = 0;

  constructor(
    def: WispDef,
    tier: FamiliarTier,
    balance: Balance,
    events: EventBuffer,
    targets: TargetList,
    hit: HitFn,
  ) {
    this.def = def;
    this.balance = balance;
    this.events = events;
    this.targets = targets;
    this.hit = hit;
    this.fireRate = Math.max(0, def.fireRate[tier] ?? 0);
    this.damage = Math.max(0, def.damage[tier] ?? 0);

    const max = Math.max(1, Math.floor(def.maxSparks));
    for (let i = 0; i < max; i++) {
      this.sparks.push({ active: false, enemy: null, targetId: -1, damage: 0, arriveAt: 0 });
    }
  }

  /** The state object render reads. Built once per run, then mutated in place. */
  create(squad: SquadState, tier: FamiliarTier): FamiliarState {
    const state: FamiliarState = {
      x: squad.x + this.def.offsetX,
      z: squad.z + this.def.offsetZ,
      tier,
      cooldown: this.fireRate > 0 ? 1 / this.fireRate : Infinity,
      side: 1,
    };
    return state;
  }

  update(state: RunState, dt: number): void {
    const wisp = state.familiar;
    if (wisp === null || wisp === undefined) return;

    this.follow(wisp, state.squad);
    this.land(state);
    if (state.status !== 'running') return;

    if (this.fireRate <= 0 || this.damage <= 0) return;
    wisp.cooldown -= dt;
    if (wisp.cooldown > 0) return;

    const target = this.nearest(wisp.x, wisp.z);
    if (target === null) {
      // Nothing in range: hold the shot ready rather than banking cooldown, so
      // the wisp does not fire a burst the instant a stream appears.
      wisp.cooldown = 0;
      return;
    }

    wisp.cooldown = 1 / this.fireRate;
    if (!this.launch(state, wisp.x, wisp.z, target)) return;
    this.events.familiarShot(wisp.x, wisp.z, target.id);
  }

  /**
   * Hovers at a fixed offset beside the squad, on the shoulder that keeps it
   * over the road: at the right-hand clamp the offset would put it in the
   * grass, so it swaps shoulders.
   */
  private follow(wisp: FamiliarState, squad: SquadState): void {
    const edge = this.balance.road.halfWidth;
    wisp.side = squad.x + this.def.offsetX > edge ? -1 : 1;
    wisp.x = squad.x + this.def.offsetX * wisp.side;
    wisp.z = squad.z + this.def.offsetZ;
  }

  private nearest(x: number, z: number): EnemyState | null {
    const range = this.def.range;
    this.bestEnemy = null;
    this.bestGap = range;
    this.scanX = x;
    this.scanZ = z;
    // Centred half a range ahead, so the window is "in front of the wisp".
    this.targets.forEachNear(z + range / 2, range / 2, this.visit);
    return this.bestEnemy;
  }

  /** Bound once: the sim must not allocate a closure every step (CLAUDE.md). */
  private readonly visit = (enemy: EnemyState): boolean => {
    const gap = Math.hypot(enemy.x - this.scanX, enemy.z - this.scanZ);
    if (gap <= this.bestGap) {
      this.bestGap = gap;
      this.bestEnemy = enemy;
    }
    return true;
  };

  private launch(state: RunState, x: number, z: number, enemy: EnemyState): boolean {
    // Indexed rather than `find`: a predicate is a closure, and the sim does
    // not allocate in a step (CLAUDE.md).
    let spark: Spark | undefined;
    for (const candidate of this.sparks) {
      if (candidate.active) continue;
      spark = candidate;
      break;
    }
    if (spark === undefined) return false;
    const distance = Math.hypot(enemy.x - x, enemy.z - z);
    spark.active = true;
    spark.enemy = enemy;
    spark.targetId = enemy.id;
    spark.damage = this.damage;
    spark.arriveAt = state.time + distance / Math.max(1, this.def.sparkSpeed);
    return true;
  }

  /** Resolves every spark whose flight is over. */
  private land(state: RunState): void {
    for (const spark of this.sparks) {
      if (!spark.active || state.time < spark.arriveAt) continue;
      const enemy = spark.enemy;
      spark.active = false;
      spark.enemy = null;
      if (enemy === null || !enemy.alive || enemy.id !== spark.targetId) continue;
      this.hit(state, enemy, spark.damage);
      if (state.status !== 'running') return;
    }
  }
}
