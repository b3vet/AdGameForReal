/**
 * The shooting half of the render fixture: projectiles, what they hit, and the
 * events each staff owes the renderer when they land.
 *
 * Split out of `dev-scenario.ts`, which owns the story — where the squad is,
 * which row it crossed, when the boss wakes up. This owns everything between a
 * shot leaving the crowd and a block coming apart, because that is where every
 * weapon visual is decided and it is half the fixture on its own.
 *
 * It is a fixture, not a second sim: the numbers come from `weapons.json` and
 * `balance.json` so the effects have the reach the sim will give them, but the
 * damage model here is one point per hit and nothing about it is authoritative.
 */

import { balance } from '@/data';
import {
  applyGateGrowth,
  formationOffsets,
  isShootable,
  laneCenter,
  progression,
  weaponDef,
} from '@/sim';
import type { EnemyState, ProjectileState, RunState, SimEvent, WeaponId } from '@/sim';

const DEV_SHOTS_PER_UNIT = 2;
const DEV_MAX_SHOTS_PER_SECOND = 90;
/** How wide a block is to a bullet. The renderer uses the sim's own footprint;
 *  the fixture only needs something that feels the same size. */
const BOSS_HALF_WIDTH = 1.3;

/**
 * The fixture plays every staff at tier 2 (D33), because the evolutions are
 * three of the visuals Phase B2 added and none of them appears at tier 1:
 * ember's burn, storm's extra chain hop and frost's shatter puff. What each one
 * is worth comes from `progression.json`, so the reach and the timing on screen
 * are the ones the sim will give them.
 */
const EVOLVED = true;

export class DevCombat {
  private readonly travelled: Float32Array;
  private nextProjectile = 0;
  private fireAccumulator = 0;
  private shotIndex = 0;

  constructor(
    private readonly state: RunState,
    private readonly events: SimEvent[],
    /** Called instead of removing the boss, so the scenario can end the run. */
    private readonly onBossKilled: () => void,
  ) {
    this.travelled = new Float32Array(balance.projectiles.max);
  }

  /** New pass: every bullet in the air is dropped. */
  reset(): void {
    for (const projectile of this.state.projectiles) projectile.alive = false;
    this.travelled.fill(0);
    this.nextProjectile = 0;
    this.fireAccumulator = 0;
    this.shotIndex = 0;
  }

  /** The whole squad's output, in shots per second. Gate growth is a share of it. */
  shotRate(): number {
    return Math.min(DEV_MAX_SHOTS_PER_SECOND, this.state.squad.count * DEV_SHOTS_PER_UNIT);
  }

  /** Spawns this step's shots from the crowd, then moves and resolves them. */
  step(dt: number): void {
    this.fire(dt);
    this.moveProjectiles(dt);
  }

  /**
   * Kills a block, and emits the shatter that frost owes when the block was
   * frozen at the time. Public because a block that reaches the squad dies of
   * contact rather than of being shot.
   */
  killEnemy(enemy: EnemyState): void {
    const frozen = (enemy.slowUntil ?? -1) > this.state.time;
    enemy.alive = false;
    enemy.hp = 0;
    this.events.push({
      type: 'enemyKilled',
      enemyId: enemy.id,
      kind: enemy.kind,
      x: enemy.x,
      z: enemy.z,
    });
    // Frost's rule: a block that dies while slowed comes apart into shards
    // instead of falling over.
    if (frozen && weaponDef(this.weapon()).slow?.shatterOnKill === true) {
      this.events.push({ type: 'enemyShattered', enemyId: enemy.id, x: enemy.x, z: enemy.z });
      // Frost's evolution. The sim emits the shatter's reach as an ordinary
      // `splash` centred on the body that came apart, and the renderer tells
      // that from an ember blast by exactly that — same batch, same position
      // (`rendererEvents.ts`), so the fixture has to emit the pair the same way.
      const shatter = progression.evolutions.frost.shatter;
      if (EVOLVED && shatter !== undefined) {
        this.events.push({
          type: 'splash',
          x: enemy.x,
          z: enemy.z,
          radius: shatter.radius,
        });
      }
    }

    if (enemy.kind === 'boss') {
      this.onBossKilled();
      return;
    }

    // A stream body stays in the array as a corpse with `diedAt` on it, exactly
    // as the sim leaves it, because that is what the renderer reads to play the
    // death (`src/render/streamBodies.ts`). `DevStreams` sweeps it later.
    if (enemy.streamId !== undefined) {
      enemy.diedAt = this.state.time;
      const stream = this.state.streams[enemy.streamId];
      if (stream !== undefined) stream.killed++;
      return;
    }

    const index = this.state.enemies.indexOf(enemy);
    if (index >= 0) this.state.enemies.splice(index, 1);
  }

  private weapon(): WeaponId {
    return this.state.squad.weaponId ?? 'ember';
  }

  private fire(dt: number): void {
    const squad = this.state.squad;
    if (squad.count <= 0) return;

    this.fireAccumulator += this.shotRate() * dt;

    const offsets = formationOffsets(squad.count);
    while (this.fireAccumulator >= 1) {
      this.fireAccumulator -= 1;
      const offset = offsets[this.shotIndex % Math.max(1, offsets.length)];
      this.shotIndex++;
      if (offset === undefined) continue;
      this.spawnProjectile(squad.x + offset.x, squad.z + offset.z);
    }
  }

  private spawnProjectile(x: number, z: number): void {
    const pool = this.state.projectiles;
    for (let attempt = 0; attempt < pool.length; attempt++) {
      const index = (this.nextProjectile + attempt) % pool.length;
      const projectile = pool[index];
      if (projectile === undefined || projectile.alive) continue;
      projectile.x = x;
      projectile.z = z;
      projectile.alive = true;
      this.travelled[index] = 0;
      this.nextProjectile = (index + 1) % pool.length;
      this.events.push({ type: 'projectileFired', x, z });
      return;
    }
  }

  private moveProjectiles(dt: number): void {
    const speed = balance.projectiles.speed;
    const range = balance.projectiles.range;
    const pool = this.state.projectiles;

    for (let i = 0; i < pool.length; i++) {
      const projectile = pool[i];
      if (projectile === undefined || !projectile.alive) continue;

      const previousZ = projectile.z;
      projectile.z += speed * dt;
      this.travelled[i] = (this.travelled[i] ?? 0) + speed * dt;

      if (this.hitGate(projectile, previousZ) || this.hitEnemy(projectile, previousZ)) {
        projectile.alive = false;
        continue;
      }
      if ((this.travelled[i] ?? 0) >= range) projectile.alive = false;
    }
  }

  private hitGate(projectile: ProjectileState, previousZ: number): boolean {
    for (const gate of this.state.gates) {
      // `mul` and staff gates are solid glass: a shot passes through unchanged.
      if (gate.passed || !isShootable(gate.kind)) continue;
      if (gate.z < previousZ || gate.z > projectile.z) continue;
      if (Math.abs(projectile.x - laneCenter(gate.lane)) > balance.road.laneWidth / 2) continue;

      // The sim's own rule, not a stub of it: growth is rate-based, so what the
      // fixture has to supply is this one hit and the squad's whole shot rate.
      // A shot is consumed either way, exactly as in `Run`.
      applyGateGrowth(gate, 1, this.shotRate(), balance);
      this.events.push({ type: 'gateHit', gateId: gate.id, kind: gate.kind, value: gate.value });
      return true;
    }
    return false;
  }

  private hitEnemy(projectile: ProjectileState, previousZ: number): boolean {
    // Deliberately no allocation here: this runs once per live projectile per
    // fixed step, which is thousands of calls a second.
    for (const enemy of this.state.enemies) {
      if (this.tryHit(enemy, projectile, previousZ)) return true;
    }
    const boss = this.state.boss;
    return boss !== null && this.tryHit(boss, projectile, previousZ);
  }

  private tryHit(enemy: EnemyState, projectile: ProjectileState, previousZ: number): boolean {
    if (!enemy.alive) return false;
    if (enemy.z < previousZ || enemy.z > projectile.z) return false;
    const half =
      enemy.kind === 'boss'
        ? BOSS_HALF_WIDTH
        : enemy.streamId !== undefined
          ? balance.streams.footprint + balance.streams.aimAssist
          : blockHalfWidth(enemy.units);
    if (Math.abs(projectile.x - enemy.x) > half) return false;

    enemy.hp -= 1;
    this.events.push({
      type: 'enemyHit',
      enemyId: enemy.id,
      damage: 1,
      hp: enemy.hp,
      x: enemy.x,
      z: enemy.z,
    });
    this.weaponEffects(enemy, projectile.x);
    if (enemy.hp <= 0) this.killEnemy(enemy);
    return true;
  }

  /**
   * The visuals a staff owes the renderer on a hit: the impact itself, plus
   * ember's splash ring, storm's chain to a neighbour and frost's slow. The
   * numbers are the staff's own (`weapons.json`), so the fixture shows the same
   * reach the sim will.
   */
  private weaponEffects(enemy: EnemyState, x: number): void {
    const weapon = this.weapon();
    this.events.push({ type: 'projectileHit', weaponId: weapon, x, z: enemy.z });

    const def = weaponDef(weapon);
    const splash = def.splash;
    if (splash !== undefined) {
      this.events.push({ type: 'splash', x: enemy.x, z: enemy.z, radius: splash.radius });
    }

    const chain = def.chain;
    if (chain !== undefined) {
      // A wider reach than the sim's, because the fixture's blocks sit a whole
      // row apart and a chain that never fires proves nothing.
      let from = enemy;
      // Storm's evolution is one more link on the same arc, so this is the
      // fixture's own budget plus `extraChains` rather than a second mechanic.
      const links = 1 + (EVOLVED ? (progression.evolutions.storm.extraChains ?? 0) : 0);
      for (let link = 0; link < links; link++) {
        const neighbour = this.nearestOther(from, chain.range * 4, enemy);
        if (neighbour === null) break;
        this.events.push({ type: 'chain', from: from.id, to: neighbour.id });
        from = neighbour;
      }
    }

    // Ember's evolution: the struck body is set alight for a couple of seconds,
    // written onto the body itself exactly as `Burn.ignite` does — which is
    // where `BurnView` reads it from.
    const burn = progression.evolutions.ember.burn;
    if (EVOLVED && burn !== undefined && weapon === 'ember' && enemy.alive) {
      enemy.burning = true;
      enemy.burnUntil = this.state.time + burn.seconds;
      enemy.burnPerTick = 1;
      enemy.burnNextAt = this.state.time + burn.tickSeconds;
      this.events.push({
        type: 'enemyBurning',
        enemyId: enemy.id,
        x: enemy.x,
        z: enemy.z,
        seconds: burn.seconds,
      });
    }

    const slow = def.slow;
    if (slow !== undefined) {
      enemy.slowUntil = this.state.time + slow.seconds;
      enemy.slowFactor = slow.factor;
      this.events.push({ type: 'enemySlowed', enemyId: enemy.id, seconds: slow.seconds });
    }
  }

  private nearestOther(
    enemy: EnemyState,
    range: number,
    exclude: EnemyState | null = null,
  ): EnemyState | null {
    let best: EnemyState | null = null;
    let bestGap = range;
    for (const other of this.state.enemies) {
      if (other === enemy || other === exclude || !other.alive) continue;
      const gap = Math.hypot(other.x - enemy.x, other.z - enemy.z);
      if (gap >= bestGap) continue;
      best = other;
      bestGap = gap;
    }
    return best;
  }
}

export function blockHalfWidth(units: number): number {
  return Math.min(1.2, 0.45 + 0.06 * Math.sqrt(units));
}
