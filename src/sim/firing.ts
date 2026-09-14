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
import type { CrowdSim } from './crowd';
import type { EventBuffer } from './events';
import { evolutionOf } from './evolutions';
import type { HeldEvolutions } from './evolutions';
import { applyCurseCreep, applyGateGrowth } from './gates';
import { laneCenter, laneOf } from './lanes';
import type { WeaponEffects } from './effects';
import { NO_MODS } from './player';
import type { PlayerMods } from './player';
import { hitShield } from './shields';
import type { Streams } from './streams';
import type { TargetList, Target } from './targeting';
import { weaponDef, weaponOf } from './weapons';
import type { EnemyState, Lane, ProjectileState, RunState, WeaponId } from './types';
import type { Balance, WeaponSlow } from '@/data/types';

export class Firing {
  private readonly balance: Balance;
  private readonly events: EventBuffer;
  private readonly targets: TargetList;
  private readonly streams: Streams;
  /** Every unit as an agent: a shot leaves the person who fired it (D43). */
  private readonly crowd: CrowdSim;
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

  /** Splash, chain, shatter and the two evolutions that ride on them. */
  private readonly effects: WeaponEffects;

  /** The squad's whole output this step, in shots per second. */
  private shotRate = 0;

  /** The player's multipliers and staff tiers, resolved once (D35). */
  private readonly mods: PlayerMods;

  /** Ember's evolution, when the player has bought it; else null. */
  private readonly burn: Burn | null;

  /** Extra chain links per staff, from the tier its owner has it at. */
  private readonly extraChains: Record<WeaponId, number>;

  /** Per staff: whether the arc keeps its full damage at every hop (D54). */
  private readonly fullChains: Record<WeaponId, boolean>;

  constructor(
    balance: Balance,
    events: EventBuffer,
    targets: TargetList,
    streams: Streams,
    crowd: CrowdSim,
    onBossKilled: () => void,
    // Built by `buildLoadout` rather than here: the meteor blasts through the
    // same object, and neither it nor this class may own the other (D54).
    effects: WeaponEffects,
    held: HeldEvolutions,
    mods: PlayerMods = NO_MODS,
    burn: Burn | null = null,
  ) {
    this.balance = balance;
    this.events = events;
    this.targets = targets;
    this.streams = streams;
    this.crowd = crowd;
    this.onBossKilled = onBossKilled;
    this.effects = effects;
    this.mods = mods;
    this.burn = burn;
    this.extraChains = held.extraChains;
    this.fullChains = held.fullChains;

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

  /**
   * Called once at the top of the step, before anything can hit a gate: the
   * step's shot rate, which both growth rules are measured against, and the
   * creep every curse in play puts on while nobody is shooting it (Phase C2).
   *
   * "In play" is the same window the squad can shoot into — a gate inside
   * `projectiles.range` and not yet walked through — so a curse grows exactly
   * while the player can do something about it.
   */
  beginStep(state: RunState, dt: number): void {
    this.shotRate = this.rateOf(state);

    if (state.levelIndex < this.balance.gates.creep.fromLevel) return;
    const from = state.squad.z;
    const to = from + this.balance.projectiles.range;
    for (const gate of state.gates) {
      if (gate.passed || gate.kind !== 'sub' || gate.z < from || gate.z > to) continue;
      applyCurseCreep(gate, dt, this.balance);
    }
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
    // The people actually standing on the road, stragglers included: a group
    // cut off behind a fence goes on firing down its own lane (D44).
    const live = this.crowd.liveCount;
    if (live <= 0) return;

    this.shotAccumulator += this.shotRate * dt;
    const shots = Math.floor(this.shotAccumulator);
    if (shots <= 0) return;
    this.shotAccumulator -= shots;

    const agents = this.crowd.crowd;
    this.laneBatch[0] = 0;
    this.laneBatch[1] = 0;
    this.laneBatch[2] = 0;

    for (let s = 0; s < shots; s++) {
      // Round robin over the crowd, so every unit fires in its turn and a shot
      // leaves the slot its firer is actually standing in, not a slot the
      // formation says it should be in (D43).
      const unit = this.crowd.liveAt(this.fireCursor % live);
      this.fireCursor = (this.fireCursor + 1) % 1000003;

      const x = agents.x[unit] ?? squad.x;
      const z = agents.z[unit] ?? squad.z;
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

    // Storm tier 4 (D54). Counted here because this is what a volley *is* — a
    // step the squad fired on — and resolved after the shots have landed, so an
    // overcharge finishes the row the volley started rather than racing it.
    this.effects.overcharge(state, this.shotRate * squad.damage);
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
    const tiers = this.mods.tiers;
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
      // Storm's evolutions are both the same arc with a better budget rather
      // than a second mechanic: tier 2 is one more target, and tier 3 is every
      // link taking the whole shot instead of `damageMul` of it.
      const count = chain.count + this.extraChains[weaponId];
      const mul = this.fullChains[weaponId] ? 1 : chain.damageMul;
      this.effects.chain(state, enemy, damage * mul, count, chain.range, weapon.slow);
      if (state.status !== 'running') return;
    }

    // Ember's evolution. Only the body the shot actually struck is set alight:
    // the splash already spends the shot on its neighbours, and lighting a
    // whole blast radius would make the burn a second splash rather than a
    // burn. `enemy.alive` is false if the shot killed it, and a corpse does
    // not burn.
    // `evolutionOf` rather than a flag off `held`: the burn belongs to the staff
    // in hand, so a squad that walked through a storm gate stops lighting fires
    // even though the player still owns an evolved ember.
    if (this.burn !== null && enemy.alive && evolutionOf(weaponId, tiers[weaponId])?.burn !== undefined) {
      this.burn.ignite(enemy, damage, state.time);
    }
  }

  /** Damage from something that is not a shot: a burn tick, the wisp's spark. */
  hit(state: RunState, enemy: EnemyState, amount: number): void {
    if (amount <= 0) return;
    this.damage(state, enemy, amount, null, undefined);
  }

  /**
   * Damage from one of the weapon effects — a splash, an arc, a shatter, a
   * meteor — with the staff's slow carried along.
   *
   * The one door `WeaponEffects` damages through, so a body killed by any of
   * them books its stream, its events and its corpse exactly as one killed by
   * a shot does. Unlike `hit` it takes whatever it is given: the effects have
   * already decided there is damage to deal, and a zero guard here would be a
   * second opinion about arithmetic that happened next door.
   */
  spill(state: RunState, enemy: EnemyState, amount: number, slow: WeaponSlow | undefined): void {
    this.damage(state, enemy, amount, null, slow);
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

    // A shielded brute's shield eats the hit first (D49), at its own rate, and
    // the body underneath takes nothing until it is gone. The hit still
    // *happened* — render and audio want it — so the event fires either way,
    // with the body's own unchanged hp in it.
    const shield = hitShield(enemy, dealt, this.balance);
    if (shield.broke) this.events.shieldBreak(enemy.id, enemy.x, enemy.z);
    if (shield.toBody <= 0) {
      this.events.enemyHit(enemy.id, dealt, enemy.hp, enemy.x, enemy.z);
      return;
    }

    enemy.hp -= shield.toBody;
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
    // Frost tier 3 (D54): a body that was *already* frozen when it died leaves
    // the chill behind it. Strictly the body that was slowed before this hit,
    // not any body a frost shot killed, so the pulse is the second hit on a
    // held body rather than something every frost kill does for free.
    if (wasSlowed) this.effects.freezePulse(state, enemy);
    if (enemy.kind === 'boss') {
      this.events.bossKilled();
      this.onBossKilled();
    }
  }
}
