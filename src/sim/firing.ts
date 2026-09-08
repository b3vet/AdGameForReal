/**
 * Everything the squad's fire does: the shot clock, the projectile pool, and
 * what a staff does when a shot lands.
 *
 * Split out of `Run` in Milestone 2, when weapons turned one hit into an impact,
 * a splash, a chain and a slow.
 */

import { unitsOf } from './contact';
import { enemyFootprint } from './enemies';
import type { EventBuffer } from './events';
import { formationOffsets } from './formation';
import { applyGateGrowth } from './gates';
import { laneCenter, laneOf } from './level';
import type { TargetList, Target } from './targeting';
import type { EnemyState, Lane, ProjectileState, RunState } from './types';
import { blockGap, weaponDef, weaponOf } from './weapons';
import type { Balance, WeaponSlow } from '@/data/types';

export class Firing {
  private readonly balance: Balance;
  private readonly events: EventBuffer;
  private readonly targets: TargetList;
  /** Called when a shot kills the boss, so `Run` can end the run in one place. */
  private readonly onBossKilled: () => void;

  /** Projectile pool: every object is created once and re-used forever. */
  private readonly pool: ProjectileState[] = [];
  private readonly free: number[] = [];
  private readonly spawnZ: Float64Array;

  /** Fractional shots carried between steps, and the unit that fires next. */
  private shotAccumulator = 0;
  private fireCursor = 0;
  private readonly laneBatch = [0, 0, 0];

  /** Ids already struck by the chain being resolved. Re-used, never re-allocated. */
  private readonly chained: number[] = [];

  /** The squad's whole output this step, in shots per second. */
  private shotRate = 0;

  constructor(
    balance: Balance,
    events: EventBuffer,
    targets: TargetList,
    onBossKilled: () => void,
  ) {
    this.balance = balance;
    this.events = events;
    this.targets = targets;
    this.onBossKilled = onBossKilled;

    const max = Math.max(1, Math.floor(balance.projectiles.max));
    this.spawnZ = new Float64Array(max);
    for (let i = max - 1; i >= 0; i--) {
      this.pool[i] = { id: i, x: 0, z: 0, alive: false };
      this.free.push(i);
    }
  }

  /** Shots per second at the squad's current size, rate bonus and staff. */
  rateOf(state: RunState): number {
    const squad = state.squad;
    const weapon = weaponDef(weaponOf(squad));
    return squad.count * squad.fireRate * (1 + squad.fireRateBonus) * weapon.fireRateMul;
  }

  /** Called once at the top of the step, before anything can hit a gate. */
  beginStep(state: RunState): void {
    this.shotRate = this.rateOf(state);
  }

  update(state: RunState, dt: number): void {
    const live = state.projectiles;
    const weapon = weaponDef(weaponOf(state.squad));
    const speed = weapon.projectileSpeed;
    const range = this.balance.projectiles.range;

    for (let i = live.length - 1; i >= 0; i--) {
      const projectile = live[i];
      if (projectile === undefined) continue;

      const prevZ = projectile.z;
      const nextZ = prevZ + speed * dt;
      // Sweep the whole step, so a fast shot cannot tunnel through a gate.
      const maxZ = (this.spawnZ[projectile.id] ?? prevZ) + range;
      const hit = this.targets.sweep(projectile.x, prevZ, Math.min(nextZ, maxZ));
      if (hit !== null) {
        this.resolveHit(state, hit, 1, projectile.x);
        this.recycle(state, i);
        if (state.status !== 'running') return;
        continue;
      }
      if (nextZ >= maxZ) {
        this.recycle(state, i);
        continue;
      }
      projectile.z = nextZ;
    }
  }

  fire(state: RunState, dt: number): void {
    const squad = state.squad;
    const count = squad.count;
    if (count <= 0) return;

    this.shotAccumulator += this.shotRate * dt;
    const shots = Math.floor(this.shotAccumulator);
    if (shots <= 0) return;
    this.shotAccumulator -= shots;

    const offsets = formationOffsets(count);
    this.laneBatch[0] = 0;
    this.laneBatch[1] = 0;
    this.laneBatch[2] = 0;

    for (let s = 0; s < shots; s++) {
      const offset = offsets[this.fireCursor % count];
      this.fireCursor = (this.fireCursor + 1) % 1000003;
      if (offset === undefined) continue;

      const x = squad.x + offset.x;
      const z = squad.z + offset.z;
      const id = this.free.pop();
      if (id === undefined) {
        // Cap reached: the rest of this step's shots become hitscan, batched per
        // lane so a 400-unit squad still costs three sweeps instead of hundreds.
        const slot = laneOf(x, this.balance.road.laneWidth) + 1;
        this.laneBatch[slot] = (this.laneBatch[slot] ?? 0) + 1;
        continue;
      }

      const projectile = this.pool[id];
      if (projectile === undefined) continue;
      projectile.x = x;
      projectile.z = z;
      projectile.alive = true;
      this.spawnZ[id] = z;
      state.projectiles.push(projectile);
      this.events.projectileFired(x, z);
    }

    for (let slot = 0; slot < 3; slot++) {
      const batched = this.laneBatch[slot] ?? 0;
      if (batched <= 0) continue;
      const lane = (slot - 1) as Lane;
      const x = laneCenter(lane, this.balance.road.laneWidth);
      this.events.projectileFired(x, squad.z);
      const target = this.targets.sweep(x, squad.z, squad.z + this.balance.projectiles.range);
      // A batch counts as its own shot count on both sides of the growth rule,
      // so hitscan and projectiles pump a gate at exactly the same speed.
      if (target !== null) this.resolveHit(state, target, batched, x);
      if (state.status !== 'running') return;
    }
  }


  private recycle(state: RunState, index: number): void {
    const live = state.projectiles;
    const projectile = live[index];
    if (projectile === undefined) return;
    projectile.alive = false;
    this.free.push(projectile.id);
    const last = live.pop();
    if (last !== undefined && index < live.length) live[index] = last;
  }

  /** `hits` shots landing on one target at once, fired from `x`. */
  private resolveHit(state: RunState, target: Target, hits: number, x: number): void {
    const squad = state.squad;
    const weaponId = weaponOf(squad);

    const gate = target.gate;
    if (gate !== null) {
      applyGateGrowth(gate, hits, this.shotRate, this.balance);
      this.events.projectileHit(weaponId, x, gate.z);
      this.events.gateHit(gate.id, gate.kind, gate.value);
      return;
    }

    const enemy = target.enemy;
    if (enemy === null) return;

    const weapon = weaponDef(weaponId);
    const damage = hits * squad.damage;
    this.events.projectileHit(weaponId, x, enemy.z);
    this.damage(state, enemy, damage, target, weapon.slow);
    if (state.status !== 'running') return;

    const splash = weapon.splash;
    if (splash !== undefined) {
      this.applySplash(state, enemy, x, enemy.z, damage, splash.radius, splash.falloff, weapon.slow);
      if (state.status !== 'running') return;
    }

    const chain = weapon.chain;
    if (chain !== undefined) {
      this.applyChain(state, enemy, damage * chain.damageMul, chain.count, chain.range, weapon.slow);
    }
  }

  /**
   * Every block within `radius` of the impact takes a share of the shot, falling
   * off linearly with distance. Measured to the edge of each block, not its
   * centre, so a wide block in the next lane is genuinely "next to" the blast.
   */
  private applySplash(
    state: RunState,
    source: EnemyState,
    x: number,
    z: number,
    damage: number,
    radius: number,
    falloff: number,
    slow: WeaponSlow | undefined,
  ): void {
    let splashed = false;
    for (const enemy of state.enemies) {
      if (!enemy.alive || enemy === source) continue;
      const half = enemyFootprint(enemy.kind, enemy.units, this.balance);
      const gap = blockGap(enemy.x, half, x, 0, enemy.z - z);
      if (gap > radius) continue;
      const share = 1 - falloff * (gap / radius);
      if (share <= 0) continue;
      splashed = true;
      this.damage(state, enemy, damage * share, null, slow);
      if (state.status !== 'running') return;
    }
    if (splashed) this.events.splash(x, z, radius);
  }

  /** Up to `count` further blocks, each within `range` of the last one hit. */
  private applyChain(
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
      const next = this.nearestUnchained(state, from, range);
      if (next === null) return;
      this.chained.push(next.id);
      this.events.chain(from.id, next.id);
      this.damage(state, next, damage, null, slow);
      if (state.status !== 'running') return;
      from = next;
    }
  }

  private nearestUnchained(state: RunState, from: EnemyState, range: number): EnemyState | null {
    let best: EnemyState | null = null;
    let bestGap = range;
    for (const enemy of state.enemies) {
      if (!enemy.alive || this.chained.includes(enemy.id)) continue;
      const gap = Math.hypot(enemy.x - from.x, enemy.z - from.z);
      if (gap > bestGap) continue;
      bestGap = gap;
      best = enemy;
    }
    return best;
  }

  /**
   * Damage on one block, with the staff's slow applied and the death events in
   * one place. `target` is the target-list entry when the block was hit
   * directly, so a block killed mid-step stops absorbing later shots.
   */
  private damage(
    state: RunState,
    enemy: EnemyState,
    amount: number,
    target: Target | null,
    slow: WeaponSlow | undefined,
  ): void {
    // A block killed earlier in this same step by a splash or a chain keeps its
    // entry in the target list — only a *direct* kill clears it — so a later
    // shot of the same volley can still land on the corpse. It is absorbed
    // exactly as it was before, because the damage economy is balanced around
    // that, but the block must not die twice: a second `enemyKilled` is a
    // second ragdoll burst, a second kill sound and a second hit-stop for one
    // block. Rare (two of 715 kills across the balance seed set) and entirely
    // cosmetic, which is why it survived to Phase D.
    if (!enemy.alive) {
      if (target !== null) target.live = false;
      return;
    }

    const wasSlowed = (enemy.slowUntil ?? 0) > state.time;
    if (slow !== undefined) {
      enemy.slowUntil = state.time + slow.seconds;
      enemy.slowFactor = slow.factor;
      if (!wasSlowed) this.events.enemySlowed(enemy.id, slow.seconds);
    }

    enemy.hp -= amount;
    if (enemy.hp > 0) {
      enemy.units = unitsOf(enemy, this.balance);
      this.events.enemyHit(enemy.id, amount, enemy.hp, enemy.x, enemy.z);
      return;
    }

    enemy.hp = 0;
    enemy.units = 0;
    enemy.alive = false;
    if (target !== null) target.live = false;
    this.events.enemyHit(enemy.id, amount, 0, enemy.x, enemy.z);
    this.events.enemyKilled(enemy.id, enemy.kind, enemy.x, enemy.z);
    // A frozen block does not fall over, it comes apart.
    const shatters = slow?.shatterOnKill === true || (wasSlowed && enemy.slowFactor !== undefined);
    if (shatters) this.events.enemyShattered(enemy.id, enemy.x, enemy.z);
    if (enemy.kind === 'boss') {
      this.events.bossKilled();
      this.onBossKilled();
    }
  }
}
