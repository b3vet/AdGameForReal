/**
 * A fake run for the renderer to draw.
 *
 * This is a fixture, not a second sim: it produces a plausible `RunState` and
 * the matching `SimEvent`s so every visual path — gate pulses, gate passes,
 * unit pops, corpses, block hits and deaths, boss activation and stomps — can be
 * exercised and screenshotted before `Run.tick` does any of it for real.
 *
 * It deliberately runs the squad down the road faster than the game does, so a
 * twelve-second screenshot pass reaches the boss.
 */

import { buildDevLevel, emptyDevState } from './dev-fixture';
import { balance } from '@/data';
import { BOSS_Z_OFFSET, formationOffsets, laneCenter } from '@/sim';
import type { EnemyState, GateState, LevelDef, ProjectileState, RunState, SimEvent } from '@/sim';

/**
 * Dev-only pacing. The real `runSpeed` needs 35 s to reach the arena, and the
 * level generator keeps changing length, so the fixture derives its speed from
 * the level: the squad always arrives at the arena at `DEV_ARENA_SECONDS`,
 * which keeps the boss inside a twelve-second screenshot pass.
 */
const DEV_ARENA_SECONDS = 7;
const DEV_MIN_RUN_SPEED = 8;
/** The fixture steps at the sim's rate, so a slow GPU cannot slow the story down. */
const FIXED_DT = 1 / 60;
const MAX_CATCHUP = 1;
/** The boss closes in fast enough to be on screen inside a 12 s screenshot pass. */
const DEV_BOSS_SPEED_SCALE = 5;
/** Stomps often enough that a screenshot near the end catches a ring. */
const DEV_STOMP_INTERVAL = 1.2;
const DEV_SHOTS_PER_UNIT = 2;
const DEV_MAX_SHOTS_PER_SECOND = 90;
const DEV_BOSS_MIN_HP = 900;

/**
 * Squad size after each gate row. The first four are the arc the review asks
 * for — 5 grows to 60, then a row costs 20 — and the rest keep the pops and the
 * corpse animation firing for the rest of the pass.
 */
const COUNT_PLAN = [12, 30, 60, 40, 70, 95, 70, 120];

const LATERAL_AMPLITUDE = 2.2;
const LATERAL_PERIOD = 7;

const RESTART_DELAY = 1.5;

export class DevScenario {
  readonly level: LevelDef;
  readonly state: RunState;

  private readonly runSpeed: number;

  private readonly events: SimEvent[] = [];
  private readonly travelled: Float32Array;

  private nextProjectile = 0;
  private fireAccumulator = 0;
  private shotIndex = 0;
  private rowsPassed = 0;
  private stompTimer = 0;
  private restartTimer: number | null = null;
  private reloaded = false;
  private accumulator = 0;

  constructor() {
    this.level = buildDevLevel();
    this.runSpeed = Math.max(DEV_MIN_RUN_SPEED, this.level.arenaZ / DEV_ARENA_SECONDS);
    this.travelled = new Float32Array(balance.projectiles.max);
    this.state = emptyDevState(this.level);
    this.populate();
  }

  /** True once, after the scenario has looped: the caller re-runs `loadLevel`. */
  takeReloaded(): boolean {
    const value = this.reloaded;
    this.reloaded = false;
    return value;
  }

  /**
   * Fixed-step like the sim, so the fixture tells the same story at whatever
   * frame rate the renderer manages — SwiftShader in CI is nowhere near 60 fps,
   * and a clamped frame delta would leave the boss off screen.
   */
  advance(dt: number): readonly SimEvent[] {
    this.events.length = 0;
    this.accumulator = Math.min(MAX_CATCHUP, this.accumulator + dt);

    while (this.accumulator >= FIXED_DT) {
      this.accumulator -= FIXED_DT;
      this.step(FIXED_DT);
    }
    return this.events;
  }

  private step(dt: number): void {
    if (this.restartTimer !== null) {
      this.restartTimer -= dt;
      if (this.restartTimer <= 0) {
        this.restartTimer = null;
        this.populate();
        this.reloaded = true;
      }
    }

    const state = this.state;
    state.time += dt;
    this.moveSquad(dt);
    this.fire(dt);
    this.moveProjectiles(dt);
    this.moveEnemies(dt);
    this.crossRows();
    this.moveBoss(dt);

    if (state.squad.count > state.peakCount) state.peakCount = state.squad.count;
    state.survivors = state.squad.count;
  }

  private populate(): void {
    const state = this.state;
    const level = this.level;

    state.time = 0;
    state.status = 'running';
    state.squad.count = level.startCount;
    state.squad.x = 0;
    state.squad.targetX = 0;
    state.squad.z = 0;
    state.squad.fireRateBonus = 0;
    state.peakCount = level.startCount;
    state.survivors = level.startCount;

    state.gates.length = 0;
    state.enemies.length = 0;
    this.rowsPassed = 0;
    this.shotIndex = 0;
    this.fireAccumulator = 0;
    this.stompTimer = 0;
    this.accumulator = 0;

    let gateId = 0;
    let enemyId = 0;
    for (let rowIndex = 0; rowIndex < level.rows.length; rowIndex++) {
      const row = level.rows[rowIndex];
      if (row === undefined) continue;

      for (let slot = 0; slot < row.gates.length; slot++) {
        const def = row.gates[slot];
        if (def === undefined || def === null) continue;
        const lane = (slot - 1) as -1 | 0 | 1;
        state.gates.push({
          id: gateId++,
          rowIndex,
          lane,
          z: row.z,
          kind: def.kind,
          value: def.value,
          hits: 0,
          passed: false,
        });
      }

      for (const enemy of row.enemies) {
        // Blocks are inflated relative to the stub generator so their HP labels
        // stay on screen long enough to read.
        const units = Math.max(6, enemy.units * 3);
        state.enemies.push({
          id: enemyId++,
          kind: enemy.kind,
          x: laneCenter(enemy.lane),
          z: row.z,
          hp: units * 12,
          maxHp: units * 12,
          units,
          speed: balance.enemies[enemy.kind === 'brute' ? 'brute' : 'grunt'].speed,
          active: false,
          alive: true,
        });
      }
    }

    for (const projectile of state.projectiles) projectile.alive = false;
    this.travelled.fill(0);
    this.nextProjectile = 0;

    const bossHp = Math.max(DEV_BOSS_MIN_HP, level.boss.hp);
    state.boss = {
      id: 9000,
      kind: 'boss',
      x: 0,
      z: level.arenaZ + BOSS_Z_OFFSET,
      hp: bossHp,
      maxHp: bossHp,
      units: level.boss.units,
      speed: balance.enemies.boss.speed * DEV_BOSS_SPEED_SCALE,
      active: false,
      alive: true,
    };
  }

  private moveSquad(dt: number): void {
    const squad = this.state.squad;
    squad.x = LATERAL_AMPLITUDE * Math.sin((this.state.time * Math.PI * 2) / LATERAL_PERIOD);
    squad.targetX = squad.x;
    if (squad.z < this.state.arenaZ) {
      squad.z = Math.min(this.state.arenaZ, squad.z + this.runSpeed * dt);
    }
  }

  private fire(dt: number): void {
    const squad = this.state.squad;
    if (squad.count <= 0) return;

    const rate = Math.min(DEV_MAX_SHOTS_PER_SECOND, squad.count * DEV_SHOTS_PER_UNIT);
    this.fireAccumulator += rate * dt;

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
      if (gate.passed || gate.kind === 'mul') continue;
      if (gate.z < previousZ || gate.z > projectile.z) continue;
      if (Math.abs(projectile.x - laneCenter(gate.lane)) > balance.road.laneWidth / 2) continue;

      gate.hits++;
      const step = balance.gates.hitStep;
      if (gate.kind === 'add') {
        gate.value = Math.min(balance.gates.caps.add, gate.value + step.add);
      } else if (gate.kind === 'sub') {
        gate.value -= step.sub;
        if (gate.value <= 0) {
          gate.kind = 'add';
          gate.value = 0;
        }
      } else {
        gate.value = Math.min(balance.gates.caps.fireRate, gate.value + step.fireRate);
      }

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
    const half = enemy.kind === 'boss' ? 1.3 : blockHalfWidth(enemy.units);
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
    if (enemy.hp <= 0) this.killEnemy(enemy);
    return true;
  }

  private killEnemy(enemy: EnemyState): void {
    enemy.alive = false;
    enemy.hp = 0;
    this.events.push({ type: 'enemyKilled', enemyId: enemy.id, kind: enemy.kind, x: enemy.x, z: enemy.z });

    if (enemy.kind === 'boss') {
      this.state.boss = null;
      this.state.status = 'won';
      this.events.push({ type: 'bossKilled' });
      this.events.push({
        type: 'runEnded',
        status: 'won',
        survivors: this.state.squad.count,
        peakCount: this.state.peakCount,
      });
      this.restartTimer = RESTART_DELAY;
      return;
    }

    const index = this.state.enemies.indexOf(enemy);
    if (index >= 0) this.state.enemies.splice(index, 1);
  }

  private moveEnemies(dt: number): void {
    const squad = this.state.squad;
    for (let i = this.state.enemies.length - 1; i >= 0; i--) {
      const enemy = this.state.enemies[i];
      if (enemy === undefined) continue;

      if (!enemy.active) {
        if (enemy.z - squad.z > balance.enemies.activationDistance) continue;
        enemy.active = true;
        this.events.push({ type: 'enemyActivated', enemyId: enemy.id });
      }

      enemy.z -= enemy.speed * dt;

      if (Math.abs(enemy.z - squad.z) <= balance.enemies.contactDistance) {
        // Capped, unlike the real rule: a fixture that wipes the squad has
        // nothing left to show for the rest of the screenshot pass.
        const lost = Math.min(squad.count, enemy.units, Math.ceil(squad.count * 0.35));
        if (lost > 0) {
          squad.count -= lost;
          this.events.push({ type: 'unitsLost', amount: lost, reason: 'contact' });
        }
        this.killEnemy(enemy);
      } else if (enemy.z < squad.z - balance.enemies.contactDistance) {
        this.state.enemies.splice(i, 1);
      }
    }
  }

  /**
   * Applies one gate per crossed row. The fixture always takes the lane nearest
   * the squad rather than requiring an exact overlap, so the count arc plays out
   * no matter where the scripted sine wave happens to be.
   */
  private crossRows(): void {
    const squad = this.state.squad;
    let chosen: GateState | null = null;
    let chosenRow = -1;

    for (const gate of this.state.gates) {
      if (gate.passed || squad.z < gate.z) continue;
      gate.passed = true;

      if (chosenRow !== -1 && gate.rowIndex !== chosenRow) continue;
      const distance = Math.abs(squad.x - laneCenter(gate.lane));
      if (chosen === null || distance < Math.abs(squad.x - laneCenter(chosen.lane))) {
        chosen = gate;
        chosenRow = gate.rowIndex;
      }
    }

    if (chosen === null) return;

    const before = squad.count;
    // The plan is what keeps the fixture's arc readable: 5 -> 60 -> a loss.
    const planned = COUNT_PLAN[this.rowsPassed % COUNT_PLAN.length];
    const after = planned ?? before;
    squad.count = after;
    this.rowsPassed++;

    this.events.push({
      type: 'gatePassed',
      gateId: chosen.id,
      kind: chosen.kind,
      value: chosen.value,
      countBefore: before,
      countAfter: after,
    });
    if (after > before) this.events.push({ type: 'unitsGained', amount: after - before, reason: 'gate' });
    if (after < before) this.events.push({ type: 'unitsLost', amount: before - after, reason: 'gate' });
  }

  private moveBoss(dt: number): void {
    const boss = this.state.boss;
    if (boss === null) return;
    const squad = this.state.squad;

    if (!boss.active) {
      if (squad.z < this.state.arenaZ - 0.5) return;
      boss.active = true;
      this.events.push({ type: 'bossActivated', enemyId: boss.id });
    }

    const stopZ = squad.z + 4;
    if (boss.z > stopZ) boss.z = Math.max(stopZ, boss.z - boss.speed * dt);
    boss.x += (squad.x - boss.x) * Math.min(1, dt * 0.8);

    this.stompTimer += dt;
    if (this.stompTimer >= DEV_STOMP_INTERVAL && boss.z - squad.z <= balance.enemies.boss.stompRange) {
      this.stompTimer = 0;
      this.events.push({ type: 'bossStomp', x: boss.x, z: boss.z });
      const lost = Math.min(squad.count, balance.enemies.boss.stompKills);
      if (lost > 0) {
        squad.count -= lost;
        this.events.push({ type: 'unitsLost', amount: lost, reason: 'stomp' });
      }
    }
  }
}

function blockHalfWidth(units: number): number {
  return Math.min(1.2, 0.45 + 0.06 * Math.sqrt(units));
}
