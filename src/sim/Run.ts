/**
 * One playthrough of one level.
 *
 * The sim is deterministic: a fixed 1/60 s step behind an accumulator, no
 * `Math.random`, no `Date`. `state` is the live object the sim mutates, not a
 * copy — render reads it every frame and must never write to it.
 *
 * The heavy phases live next door: `firing.ts` owns the shot clock, projectiles
 * and weapon effects, `contact.ts` owns blocks walking in, `boss.ts` owns the
 * arena fight. `Run` is the order they happen in and the one place the run ends.
 */

import { BossController } from './boss';
import { advanceEnemies } from './contact';
import type { Burn } from './burn';
import { EventBuffer } from './events';
import type { Familiar } from './familiar';
import type { Firing } from './firing';
import { halfWidth } from './formation';
import { clampCount, countAfterGate } from './gates';
import { laneOf } from './lanes';
import type { LevelDef } from './level';
import { buildLoadout } from './loadout';
import { playerMods } from './player';
import type { PlayerMods } from './player';
import { buildWorld } from './spawn';
import { Streams } from './streams';
import { TargetList } from './targeting';
import type {
  EnemyState,
  GateState,
  RunState,
  RunStatus,
  SimEvent,
  SquadState,
  UnitLossReason,
  WeaponId,
} from './types';
import { clampToWalls, wallLimits, wallX } from './walls';
import type { WallDef, WallLimits } from './walls';
import { weaponDef, weaponOf } from './weapons';
import type { Balance, PlayerState } from '@/data/types';

/** The sim always steps at 1/60 s regardless of frame rate, so runs are reproducible. */
const FIXED_DT = 1 / 60;

/** Guards against a huge `dt` after a tab stall turning into a spiral of steps. */
const MAX_STEPS_PER_TICK = 8;

export class Run {
  private readonly level: LevelDef;
  private readonly balance: Balance;
  private readonly runState: RunState;
  private readonly events = new EventBuffer();
  private readonly targets = new TargetList();
  private readonly firing: Firing;
  private readonly burn: Burn | null;
  private readonly streams: Streams;
  private readonly boss = new BossController();

  /** Left-over time from the previous `tick`, carried into the next fixed step. */
  private accumulator = 0;
  private nextRow = 0;

  /** The player's upgrades, resolved once (D35). `NO_MODS` when there is none. */
  private readonly mods: PlayerMods;
  private readonly walls: readonly WallDef[];
  private readonly familiar: Familiar | null;

  /** Re-used by the wall clamp every step: the sim must not allocate per frame. */
  private readonly limits: WallLimits = { lo: 0, hi: 0, wall: -1 };

  /** Wall currently pushing the squad, so `wallBlocked` fires on the edge only. */
  private blockedWall = -1;

  /** Bound once, not per frame: `contact.ts` calls back into the loss check. */
  private readonly hitSquad = (amount: number, reason: UnitLossReason): void => {
    this.removeUnits(amount, reason);
  };

  /** The same, for the stream a leaked body belonged to. */
  private readonly onLeak = (enemy: EnemyState): void => {
    this.streams.noteLeaked(enemy);
  };

  /**
   * `player` is optional and a player with nothing bought resolves to the
   * identity: every multiplier is 1, no wisp, ember at tier 1 (D35). The
   * campaign's balance bands are defined at exactly that point, and everything
   * bought above it is the squad getting stronger against the same road.
   *
   * The level's own two upgrades — starting units and what an `add` gate prints
   * — were applied by `generateLevel`, so they are not applied again here.
   */
  constructor(level: LevelDef, balance: Balance, player?: PlayerState) {
    this.level = level;
    this.balance = balance;
    this.mods = playerMods(player);
    this.walls = level.walls ?? [];

    const staff = this.mods.staff;
    const squad: SquadState = {
      count: level.startCount,
      x: 0,
      targetX: 0,
      z: 0,
      fireRate: balance.squad.fireRate * this.mods.fireRate,
      damage: balance.squad.damage * weaponDef(staff).damage * this.mods.damage,
      fireRateBonus: 0,
      weaponId: staff,
    };

    const world = buildWorld(level, balance);

    this.runState = {
      levelIndex: level.index,
      seed: level.seed,
      time: 0,
      status: 'running',
      squad,
      gates: world.gates,
      enemies: world.enemies,
      streams: [],
      projectiles: [],
      boss: world.boss,
      peakCount: level.startCount,
      survivors: level.startCount,
      arenaZ: level.arenaZ,
      familiar: null,
      walls: this.walls,
    };

    this.streams = new Streams(balance, this.events, this.targets, level.seed, world.nextId);
    for (const row of level.rows) {
      for (const def of row.streams ?? []) this.runState.streams.push(this.streams.add(def, row.z));
    }
    this.streams.countStanding(world.enemies);
    this.targets.build(this.runState, balance);

    const loadout = buildLoadout(balance, this.events, this.targets, this.streams, this.mods, () => {
      this.finish('won');
    });
    this.firing = loadout.firing;
    this.burn = loadout.burn;
    this.familiar = loadout.familiar;
    if (this.familiar !== null) {
      this.runState.familiar = this.familiar.create(squad, this.mods.familiarTier);
    }
  }

  /** The live state object. Render reads it; nothing outside the sim writes it. */
  get state(): Readonly<RunState> {
    return this.runState;
  }

  /** Clamped to the road; the squad eases toward it at `balance.squad.lateralSpeed`. */
  setTargetX(x: number): void {
    const limit = this.clampLimit();
    this.runState.squad.targetX = Math.min(Math.max(x, -limit), limit);
  }

  /**
   * How far from the centre line the squad's *centre* may stand.
   *
   * Tapered by the crowd's own half-width, so a 500-strong squad hugging the
   * edge still stands on the road instead of overhanging the grass:
   * `road.halfWidth - halfWidth(count)`, never wider than the plan's
   * `road.clampX` and never tighter than `road.clampMin`. That floor is what
   * keeps the side lanes reachable — a lane centre is at `|x| = laneWidth`, and
   * `laneOf` puts everything from `road.clampMin` outward in the side lane, so
   * even the widest squad can still choose a side gate.
   */
  private clampLimit(): number {
    const road = this.balance.road;
    const tapered = road.halfWidth - halfWidth(this.runState.squad.count);
    return Math.max(road.clampMin, Math.min(road.clampX, tapered));
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

    // Re-clamped every step, not only when the player steers: the limit moves
    // as the crowd grows and shrinks (see `clampLimit`), and a wall narrows it
    // further for as long as the squad is inside one (D32).
    const limits = wallLimits(
      this.walls,
      squad.z,
      squad.x,
      this.clampLimit(),
      this.limits,
      this.balance.road.laneWidth,
    );
    const wanted = squad.targetX;
    squad.targetX = clampToWalls(wanted, limits);
    this.noteWall(limits.wall, wanted !== squad.targetX, squad.z);

    const dx = squad.targetX - squad.x;
    const maxMove = this.balance.squad.lateralSpeed * dt;
    squad.x += Math.abs(dx) <= maxMove ? dx : Math.sign(dx) * maxMove;
    squad.x = clampToWalls(squad.x, limits);

    // The squad stops at the arena to fight the boss.
    if (squad.z < state.arenaZ) {
      squad.z = Math.min(state.arenaZ, squad.z + this.level.runSpeed * dt);
    }

    // Every phase can end the run, and `runEnded` is the last event of its
    // tick: nothing may fire, walk or stomp after the run is over.
    this.applyCrossedRows();
    if (state.status !== 'running') return;

    // Spawn before the lists are refreshed, so a body born this step is sorted
    // into its lane and can be shot in the same step it appears in.
    this.streams.spawn(state, dt);
    this.targets.update(state, this.balance, dt);
    this.firing.beginStep(state);
    this.firing.update(state, dt);
    if (state.status !== 'running') return;
    this.firing.fire(state, dt);
    if (state.status !== 'running') return;
    // After the squad's own fire and before anything walks: a burn tick and a
    // spark are hits like any other, and a body they kill must not also get a
    // step of walking this frame.
    if (this.burn !== null) {
      this.burn.update(state);
      if (state.status !== 'running') return;
    }
    if (this.familiar !== null) {
      this.familiar.update(state, dt);
      if (state.status !== 'running') return;
    }
    advanceEnemies(state, this.balance, this.events, dt, this.hitSquad, this.onLeak);
    if (state.status !== 'running') return;
    // After everything has moved: heads, counts, the `streamCleared` edge and
    // the corpse sweep.
    this.streams.settle(state);
    this.updateBoss(dt);
    if (state.status !== 'running') return;

    if (squad.count > state.peakCount) state.peakCount = squad.count;
    state.survivors = squad.count;
    if (squad.count <= 0) this.finish('lost');
  }

  /**
   * `wallBlocked` on the edge only: the clamp bites on every step the player
   * holds a finger against a fence, and a sound per step is a buzz.
   */
  private noteWall(wall: number, pushed: boolean, z: number): void {
    // Both ways out arm the edge again. A push with no wall behind it is the
    // crowd's own taper biting — the clamp narrows as the squad grows — and
    // leaving the latch set there would swallow the *next* bump against the
    // fence the squad was last held by.
    if (!pushed || wall < 0) {
      this.blockedWall = -1;
      return;
    }
    if (this.blockedWall === wall) return;
    this.blockedWall = wall;
    const def = this.walls[wall];
    if (def === undefined) return;
    // The event carries the fence's own x, not the squad's: that is where the
    // push is seen and where a sound should come from.
    this.events.wallBlocked(def.boundary, wallX(def.boundary, this.balance.road.laneWidth), z);
  }

  /** Exactly one gate applies per row: the one whose lane holds the squad now. */
  private applyCrossedRows(): void {
    const state = this.runState;
    const rows = this.level.rows;

    while (this.nextRow < rows.length) {
      const row = rows[this.nextRow];
      if (row === undefined || state.squad.z < row.z) break;

      const lane = laneOf(state.squad.x, this.balance.road.laneWidth);
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

    if (gate.kind === 'weapon') {
      this.swapWeapon(gate.weaponId);
      this.events.gatePassed(gate.id, gate.kind, gate.value, before, before);
      return;
    }

    const after = clampCount(countAfterGate(gate.kind, gate.value, before), this.balance);
    squad.count = after;
    // Recorded here rather than only at the end of the step: a row that grows
    // the squad and a row that wipes it can land in the same step, and the peak
    // the player reached is part of their result either way.
    if (after > this.runState.peakCount) this.runState.peakCount = after;
    this.events.gatePassed(gate.id, gate.kind, gate.value, before, after);
    if (after > before) this.events.unitsGained(after - before);
    else if (after < before) this.events.unitsLost(before - after, 'gate');
    if (after <= 0) this.finish('lost');
  }

  /** A staff gate swaps the squad's staff for the rest of the run. */
  private swapWeapon(next: WeaponId | undefined): void {
    if (next === undefined) return;
    const squad = this.runState.squad;
    const current = weaponOf(squad);
    if (next === current) return;
    squad.weaponId = next;
    squad.damage = this.balance.squad.damage * weaponDef(next).damage * this.mods.damage;
    this.events.weaponChanged(current, next);
  }

  private updateBoss(dt: number): void {
    const state = this.runState;
    const boss = state.boss;
    if (boss === null || !boss.alive) return;

    const step = this.boss.update(
      boss,
      state.squad,
      state.arenaZ,
      this.balance,
      dt,
      this.level.boss.bite ?? 1,
    );
    if (step.activated) this.events.bossActivated(boss.id);
    if (step.enraged) this.events.bossEnraged(boss.id);
    if (step.contactKills > 0) {
      this.removeUnits(step.contactKills, 'contact');
      if (state.status !== 'running') return;
    }
    if (step.stomped) {
      this.events.bossStomp(boss.x, boss.z);
      this.removeUnits(step.stompKills, 'stomp');
    }
  }

  private removeUnits(amount: number, reason: UnitLossReason): void {
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