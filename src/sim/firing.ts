/**
 * Everything the squad's fire does: the shot clock, the projectile pool, and
 * what a staff does when a shot lands.
 *
 * Milestone 3 added the rule that makes streams work: a volley carries over.
 * Above the projectile cap a step's shots are summed per lane into one hitscan
 * batch, and a batch of three hundred shots landing on a body with one hit
 * point used to throw away the other two hundred and ninety-nine. It now mows
 * down the lane from the front until its damage is spent, which is both what a
 * wall of fire into a column of bodies should look like and what makes the
 * pressure model in `pressure.ts` predict anything at all.
 */

import type { Burn } from './burn';
import { killEnemy, unitsOf } from './contact';
import type { EventBuffer } from './events';
import { formationOffsets } from './formation';
import { applyGateGrowth } from './gates';
import { laneCenter, laneOf } from './lanes';
import { WeaponEffects } from './effects';
import { evolutionOf, NO_MODS } from './player';
import type { PlayerMods } from './player';
import type { Streams } from './streams';
import type { TargetList, Target } from './targeting';
import { weaponDef, weaponIds, weaponOf } from './weapons';
import type { EnemyState, Lane, ProjectileState, RunState, WeaponId } from './types';
import type { Balance, ShatterDef, WeaponSlow } from '@/data/types';

export class Firing {
  private readonly balance: Balance;
  private readonly events: EventBuffer;
  private readonly targets: TargetList;
  private readonly streams: Streams;
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

  /** Splash, chain and shatter: everything that happens around the body hit. */
  private readonly effects: WeaponEffects;

  /** The squad's whole output this step, in shots per second. */
  private shotRate = 0;

  /** The player's multipliers and staff tiers, resolved once (D35). */
  private readonly mods: PlayerMods;

  /** Ember's evolution, when the player has bought it; else null. */
  private readonly burn: Burn | null;

  /** Extra chain links per staff, from the tier its owner has it at. */
  private readonly extraChains: Record<WeaponId, number>;

  constructor(
    balance: Balance,
    events: EventBuffer,
    targets: TargetList,
    streams: Streams,
    onBossKilled: () => void,
    mods: PlayerMods = NO_MODS,
    burn: Burn | null = null,
  ) {
    this.balance = balance;
    this.events = events;
    this.targets = targets;
    this.streams = streams;
    this.onBossKilled = onBossKilled;
    this.mods = mods;
    this.burn = burn;

    let shatter: ShatterDef | null = null;
    const chains: Record<WeaponId, number> = { ember: 0, storm: 0, frost: 0 };
    for (const id of weaponIds) {
      const evolution = evolutionOf(id, mods.tiers[id]);
      if (evolution === undefined) continue;
      chains[id] = evolution.extraChains ?? 0;
      if (evolution.shatter !== undefined) shatter = evolution.shatter;
    }
    this.extraChains = chains;
    // Frost's evolution is resolved from the *player* rather than the staff in
    // hand: a body only shatters because frost froze it, and which staff the
    // squad happens to be carrying when it dies is beside the point.
    this.effects = new WeaponEffects(
      balance,
      events,
      targets,
      (hitState, enemy, amount, slow) => {
        this.damage(hitState, enemy, amount, null, slow);
      },
      shatter,
    );

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
    const laneWidth = this.balance.road.laneWidth;

    for (let i = live.length - 1; i >= 0; i--) {
      const projectile = live[i];
      if (projectile === undefined) continue;

      const prevZ = projectile.z;
      const nextZ = prevZ + speed * dt;
      // Sweep the whole step, so a fast shot cannot tunnel through a gate.
      const maxZ = (this.spawnZ[projectile.id] ?? prevZ) + range;
      const hit = this.targets.sweep(projectile.x, prevZ, Math.min(nextZ, maxZ), laneWidth);
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
      this.volley(state, lane, x, squad.z, squad.z + this.balance.projectiles.range, batched);
      if (state.status !== 'running') return;
    }
  }

  /**
   * A lane's batched shots, spent from the front of the lane backward.
   *
   * A gate swallows the whole batch — it is a wall of glass, and the growth
   * rule is already written in terms of a batch's own shot count, so hitscan
   * and projectiles pump a gate at exactly the same speed. Bodies do not: what
   * is left over after one dies rolls on to the next one behind it.
   */
  private volley(
    state: RunState,
    lane: Lane,
    x: number,
    from: number,
    to: number,
    batched: number,
  ): void {
    let left = batched;
    // Bounded so a pathological step cannot loop forever; a batch never kills
    // more bodies than it has shots.
    for (let guard = 0; guard < batched && left > 0; guard++) {
      const target = this.targets.sweepLane(lane, from, to);
      if (target === null) return;

      const gate = target.gate;
      if (gate !== null) {
        this.resolveHit(state, target, left, x);
        return;
      }

      const enemy = target.enemy;
      if (enemy === null) return;
      const spent = Math.min(left, Math.max(1, Math.ceil(enemy.hp / state.squad.damage)));
      this.resolveHit(state, target, spent, x);
      if (state.status !== 'running') return;
      left -= spent;
      // The body survived the volley, so there is nothing left to roll on.
      if (enemy.alive) return;
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
      this.effects.splash(state, enemy, x, enemy.z, damage, splash.radius, splash.falloff, weapon.slow);
      if (state.status !== 'running') return;
    }

    const chain = weapon.chain;
    if (chain !== undefined) {
      // Storm's evolution is one more target, so it is the same arc with a
      // longer budget rather than a second mechanic.
      const count = chain.count + this.extraChains[weaponId];
      this.effects.chain(state, enemy, damage * chain.damageMul, count, chain.range, weapon.slow);
      if (state.status !== 'running') return;
    }

    // Ember's evolution. Only the body the shot actually struck is set alight:
    // the splash already spends the shot on its neighbours, and lighting a
    // whole blast radius would make the burn a second splash rather than a
    // burn. `enemy.alive` is false if the shot killed it, and a corpse does
    // not burn.
    if (this.burn !== null && enemy.alive && this.hasBurn(weaponId)) {
      this.burn.ignite(enemy, damage, state.time);
    }
  }

  /** Damage from something that is not a shot: a burn tick, the wisp's spark. */
  hit(state: RunState, enemy: EnemyState, amount: number): void {
    if (amount <= 0) return;
    this.damage(state, enemy, amount, null, undefined);
  }

  private hasBurn(id: WeaponId): boolean {
    return evolutionOf(id, this.mods.tiers[id])?.burn !== undefined;
  }

  /**
   * Damage on one body, with the staff's slow applied and the death events in
   * one place. `target` is the target-list entry when the body was hit
   * directly, so one killed mid-step stops absorbing later shots.
   */
  private damage(
    state: RunState,
    enemy: EnemyState,
    amount: number,
    target: Target | null,
    slow: WeaponSlow | undefined,
  ): void {
    // A body killed earlier in this same step by a splash or a chain keeps its
    // entry in the target list — only a *direct* kill clears it — so a later
    // shot of the same volley can still land on the corpse. It is absorbed
    // exactly as it was before, because the damage economy is balanced around
    // that, but it must not die twice: a second `enemyKilled` is a second
    // ragdoll burst, a second kill sound and a second hit-stop for one body.
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

    // The boss-damage upgrade (D35) is the one multiplier that is about who is
    // being hit rather than who is hitting, so it lands here and covers shots,
    // splash, chains, burns and the wisp alike.
    const dealt = enemy.kind === 'boss' ? amount * this.mods.bossDamage : amount;

    enemy.hp -= dealt;
    if (enemy.hp > 0) {
      enemy.units = unitsOf(enemy, this.balance);
      this.events.enemyHit(enemy.id, dealt, enemy.hp, enemy.x, enemy.z);
      return;
    }

    const streamId = enemy.streamId;
    killEnemy(enemy, state.time);
    if (target !== null) target.live = false;
    if (streamId !== undefined) this.streams.noteKilled(enemy);
    this.events.enemyHit(enemy.id, dealt, 0, enemy.x, enemy.z);
    this.events.enemyKilled(enemy.id, enemy.kind, enemy.x, enemy.z, streamId);
    // A frozen body does not fall over, it comes apart.
    const shatters = slow?.shatterOnKill === true || (wasSlowed && enemy.slowFactor !== undefined);
    if (shatters) {
      this.events.enemyShattered(enemy.id, enemy.x, enemy.z, streamId);
      this.effects.shatter(state, enemy, dealt);
      if (state.status !== 'running') return;
    }
    if (enemy.kind === 'boss') {
      this.events.bossKilled();
      this.onBossKilled();
    }
  }
}
