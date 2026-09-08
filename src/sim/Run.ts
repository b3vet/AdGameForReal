/**
 * One playthrough of one level.
 *
 * The sim is deterministic: a fixed 1/60 s step behind an accumulator, no
 * `Math.random`, no `Date`. `state` is the live object the sim mutates, not a
 * copy — render reads it every frame and must never write to it.
 */

import { BossController } from './boss';
import { enemyBalance, enemyFootprint } from './enemies';
import { EventBuffer } from './events';
import { applyGateHits, clampCount, countAfterGate } from './gates';
import { formationOffsets, halfWidth } from './formation';
import { laneCenter } from './level';
import type { LevelDef } from './level';
import { buildWorld } from './spawn';
import { TargetList } from './targeting';
import type { Target } from './targeting';
import type { GateState, Lane, ProjectileState, RunState, RunStatus, SimEvent, SquadState } from './types';
import type { Balance } from '@/data/types';

/** The sim always steps at 1/60 s regardless of frame rate, so runs are reproducible. */
const FIXED_DT = 1 / 60;

/** Guards against a huge `dt` after a tab stall turning into a spiral of steps. */
const MAX_STEPS_PER_TICK = 8;

export class Run {
  private readonly level: LevelDef;
  private readonly balance: Balance;
  private readonly runState: RunState;
  private readonly events = new EventBuffer();

  /** Left-over time from the previous `tick`, carried into the next fixed step. */
  private accumulator = 0;

  /** Projectile pool: every object is created once and re-used forever. */
  private readonly projectilePool: ProjectileState[] = [];
  private readonly freeProjectiles: number[] = [];
  private readonly projectileSpawnZ: Float64Array;

  /** Fractional shots carried between steps, and the unit that fires next. */
  private shotAccumulator = 0;
  private fireCursor = 0;
  private readonly laneBatch = [0, 0, 0];

  private readonly targets = new TargetList();

  private readonly boss = new BossController();
  private nextRow = 0;

  constructor(level: LevelDef, balance: Balance) {
    this.level = level;
    this.balance = balance;

    const squad: SquadState = {
      count: level.startCount,
      x: 0,
      targetX: 0,
      z: 0,
      fireRate: balance.squad.fireRate,
      damage: balance.squad.damage,
      fireRateBonus: 0,
    };

    const world = buildWorld(level, balance);

    const max = Math.max(1, Math.floor(balance.projectiles.max));
    this.projectileSpawnZ = new Float64Array(max);
    for (let i = max - 1; i >= 0; i--) {
      this.projectilePool[i] = { id: i, x: 0, z: 0, alive: false };
      this.freeProjectiles.push(i);
    }

    this.runState = {
      levelIndex: level.index,
      seed: level.seed,
      time: 0,
      status: 'running',
      squad,
      gates: world.gates,
      enemies: world.enemies,
      projectiles: [],
      boss: world.boss,
      peakCount: level.startCount,
      survivors: level.startCount,
      arenaZ: level.arenaZ,
    };
  }

  /** The live state object. Render reads it; nothing outside the sim writes it. */
  get state(): Readonly<RunState> {
    return this.runState;
  }

  /** Clamped to the road; the squad eases toward it at `balance.squad.lateralSpeed`. */
  setTargetX(x: number): void {
    const limit = this.balance.road.clampX;
    this.runState.squad.targetX = Math.min(Math.max(x, -limit), limit);
  }

  /**
   * Advances the sim and returns the events produced since the last call.
   * The array and the event objects in it are re-used by the next `tick`.
   */
  tick(dt: number): SimEvent[] {
    this.events.reset();
    if (this.runState.status !== 'running') return this.events.list;

    this.accumulator += dt;

    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_TICK) {
      this.accumulator -= FIXED_DT;
      steps++;
      this.step(FIXED_DT);
      if (this.runState.status !== 'running') break;
    }

    // A stall long enough to exhaust the step budget is dropped rather than
    // replayed, so the sim never falls permanently behind wall-clock time.
    if (steps >= MAX_STEPS_PER_TICK) this.accumulator = 0;

    return this.events.list;
  }

  private step(dt: number): void {
    const state = this.runState;
    const squad = state.squad;

    state.time += dt;

    const dx = squad.targetX - squad.x;
    const maxMove = this.balance.squad.lateralSpeed * dt;
    squad.x += Math.abs(dx) <= maxMove ? dx : Math.sign(dx) * maxMove;

    // The squad stops at the arena to fight the boss.
    if (squad.z < state.arenaZ) {
      squad.z = Math.min(state.arenaZ, squad.z + this.level.runSpeed * dt);
    }

    this.applyCrossedRows();
    if (state.status !== 'running') return;

    this.targets.rebuild(state, this.balance);
    this.updateProjectiles(dt);
    this.fire(dt);
    this.updateEnemies(dt);
    this.updateBoss(dt);

    if (squad.count > state.peakCount) state.peakCount = squad.count;
    state.survivors = squad.count;
    if (state.status === 'running' && squad.count <= 0) this.finish('lost');
  }


  /** Exactly one gate applies per row: the one whose lane holds the squad now. */
  private applyCrossedRows(): void {
    const state = this.runState;
    const rows = this.level.rows;

    while (this.nextRow < rows.length) {
      const row = rows[this.nextRow];
      if (row === undefined || state.squad.z < row.z) break;

      const lane = this.laneOf(state.squad.x);
      const rowIndex = this.nextRow;
      this.nextRow++;

      for (const gate of state.gates) {
        if (gate.rowIndex !== rowIndex || gate.passed) continue;
        gate.passed = true;
        if (gate.lane === lane) this.applyGate(gate);
      }
      if (state.status !== 'running') return;
    }
  }

  private applyGate(gate: GateState): void {
    const squad = this.runState.squad;
    const before = squad.count;

    if (gate.kind === 'fireRate') {
      squad.fireRateBonus += gate.value;
      this.events.gatePassed(gate.id, gate.kind, gate.value, before, before);
      return;
    }

    const after = clampCount(countAfterGate(gate.kind, gate.value, before), this.balance);
    squad.count = after;
    this.events.gatePassed(gate.id, gate.kind, gate.value, before, after);
    if (after > before) this.events.unitsGained(after - before);
    else if (after < before) this.events.unitsLost(before - after, 'gate');
    if (after <= 0) this.finish('lost');
  }


  private updateProjectiles(dt: number): void {
    const live = this.runState.projectiles;
    const speed = this.balance.projectiles.speed;
    const range = this.balance.projectiles.range;

    for (let i = live.length - 1; i >= 0; i--) {
      const projectile = live[i];
      if (projectile === undefined) continue;

      const prevZ = projectile.z;
      const nextZ = prevZ + speed * dt;
      // Sweep the whole step, so a fast shot cannot tunnel through a gate.
      const maxZ = (this.projectileSpawnZ[projectile.id] ?? prevZ) + range;
      const hit = this.targets.sweep(projectile.x, prevZ, Math.min(nextZ, maxZ));
      if (hit !== null) {
        this.resolveHit(hit, 1, this.runState.squad.damage);
        this.recycleProjectile(i);
        continue;
      }
      if (nextZ >= maxZ) {
        this.recycleProjectile(i);
        continue;
      }
      projectile.z = nextZ;
    }
  }

  private recycleProjectile(index: number): void {
    const live = this.runState.projectiles;
    const projectile = live[index];
    if (projectile === undefined) return;
    projectile.alive = false;
    this.freeProjectiles.push(projectile.id);
    const last = live.pop();
    if (last !== undefined && index < live.length) live[index] = last;
  }

  /** `hits` shots of `damage` each landing on one target at once. */
  private resolveHit(target: Target, hits: number, damage: number): void {
    const gate = target.gate;
    if (gate !== null) {
      applyGateHits(gate, hits, this.balance);
      this.events.gateHit(gate.id, gate.kind, gate.value);
      return;
    }
    const enemy = target.enemy;
    if (enemy === null) return;

    enemy.hp -= hits * damage;
    if (enemy.hp > 0) {
      enemy.units = Math.ceil(enemy.hp / enemyBalance(enemy.kind, this.balance).hpPerUnit);
      this.events.enemyHit(enemy.id, hits * damage, enemy.hp, enemy.x, enemy.z);
      return;
    }

    enemy.hp = 0;
    enemy.units = 0;
    enemy.alive = false;
    target.live = false;
    this.events.enemyHit(enemy.id, hits * damage, 0, enemy.x, enemy.z);
    this.events.enemyKilled(enemy.id, enemy.kind, enemy.x, enemy.z);
    if (enemy.kind === 'boss') {
      this.events.bossKilled();
      this.finish('won');
    }
  }


  private fire(dt: number): void {
    const squad = this.runState.squad;
    const count = squad.count;
    if (count <= 0) return;

    this.shotAccumulator += count * squad.fireRate * (1 + squad.fireRateBonus) * dt;
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
      const id = this.freeProjectiles.pop();
      if (id === undefined) {
        // Cap reached: the rest of this step's shots become hitscan, batched per
        // lane so a 400-unit squad still costs three sweeps instead of hundreds.
        const slot = this.laneOf(x) + 1;
        this.laneBatch[slot] = (this.laneBatch[slot] ?? 0) + 1;
        continue;
      }

      const projectile = this.projectilePool[id];
      if (projectile === undefined) continue;
      projectile.x = x;
      projectile.z = z;
      projectile.alive = true;
      this.projectileSpawnZ[id] = z;
      this.runState.projectiles.push(projectile);
      this.events.projectileFired(x, z);
    }

    for (let slot = 0; slot < 3; slot++) {
      const batched = this.laneBatch[slot] ?? 0;
      if (batched <= 0) continue;
      const lane = (slot - 1) as Lane;
      const x = laneCenter(lane, this.balance.road.laneWidth);
      this.events.projectileFired(x, squad.z);
      const target = this.targets.sweep(x, squad.z, squad.z + this.balance.projectiles.range);
      if (target !== null) this.resolveHit(target, batched, squad.damage);
      if (this.runState.status !== 'running') return;
    }
  }

  private laneOf(x: number): Lane {
    const raw = Math.round(x / this.balance.road.laneWidth);
    return Math.min(1, Math.max(-1, raw)) as Lane;
  }


  private updateEnemies(dt: number): void {
    const state = this.runState;
    const squad = state.squad;
    const contact = this.balance.enemies.contactDistance;
    const squadHalf = halfWidth(squad.count);

    for (const enemy of state.enemies) {
      if (!enemy.alive) continue;

      if (!enemy.active) {
        if (enemy.z - squad.z > this.balance.enemies.activationDistance) continue;
        enemy.active = true;
        this.events.enemyActivated(enemy.id);
      }

      enemy.z -= enemy.speed * dt;

      if (Math.abs(enemy.z - squad.z) <= contact) {
        const half = enemyFootprint(enemy.kind, enemy.units, this.balance);
        if (Math.abs(enemy.x - squad.x) < half + squadHalf) {
          const taken = enemy.units;
          enemy.alive = false;
          enemy.hp = 0;
          this.events.enemyKilled(enemy.id, enemy.kind, enemy.x, enemy.z);
          this.removeUnits(taken, 'contact');
          if (state.status !== 'running') return;
          continue;
        }
      }

      // Blocks that got past the squad run off the back of the level.
      if (enemy.z < squad.z - this.balance.enemies.despawnBehind) enemy.alive = false;
    }
  }


  private updateBoss(dt: number): void {
    const state = this.runState;
    const boss = state.boss;
    if (boss === null || !boss.alive) return;

    const step = this.boss.update(boss, state.squad, state.arenaZ, this.balance, dt);
    if (step.activated) this.events.bossActivated(boss.id);
    if (step.contactKills > 0) {
      this.removeUnits(step.contactKills, 'contact');
      if (state.status !== 'running') return;
    }
    if (step.stomped) {
      this.events.bossStomp(boss.x, boss.z);
      this.removeUnits(this.balance.enemies.boss.stompKills, 'stomp');
    }
  }


  private removeUnits(amount: number, reason: 'contact' | 'gate' | 'stomp'): void {
    const squad = this.runState.squad;
    const before = squad.count;
    const after = clampCount(before - amount, this.balance);
    if (after === before) return;
    squad.count = after;
    this.events.unitsLost(before - after, reason);
    if (after <= 0) this.finish('lost');
  }

  private finish(status: RunStatus): void {
    const state = this.runState;
    if (state.status !== 'running') return;
    state.status = status;
    state.survivors = status === 'won' ? state.squad.count : 0;
    this.events.runEnded(status, state.survivors, state.peakCount);
  }
}
