/**
 * One playthrough of one level.
 *
 * STUB for Phase A: holds a valid `RunState` built from the level, advances the
 * squad down the road on a fixed timestep, and emits no events. Phase B1
 * implements firing, gates, enemies, the boss and win/loss per
 * docs/03-milestone-1-plan.md; the constructor and method signatures are final.
 */

import type { LevelDef } from './level';
import type { RunState, SimEvent, SquadState } from './types';
import type { Balance } from '@/data/types';

/** The sim always steps at 1/60 s regardless of frame rate, so runs are reproducible. */
const FIXED_DT = 1 / 60;

/** Guards against a huge `dt` after a tab stall turning into a spiral of steps. */
const MAX_STEPS_PER_TICK = 8;

export class Run {
  private readonly level: LevelDef;
  private readonly balance: Balance;
  private readonly runState: RunState;

  /** Left-over time from the previous `tick`, carried into the next fixed step. */
  private accumulator = 0;

  /** Reused across ticks: the sim must not allocate per frame (CLAUDE.md). */
  private readonly events: SimEvent[] = [];

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

    this.runState = {
      levelIndex: level.index,
      seed: level.seed,
      time: 0,
      status: 'running',
      squad,
      gates: [],
      enemies: [],
      projectiles: [],
      boss: null,
      peakCount: level.startCount,
      survivors: level.startCount,
      arenaZ: level.arenaZ,
    };
  }

  get state(): Readonly<RunState> {
    return this.runState;
  }

  /** Clamped to the road; the squad eases toward it at `balance.squad.lateralSpeed`. */
  setTargetX(x: number): void {
    const limit = this.balance.road.clampX;
    this.runState.squad.targetX = Math.min(Math.max(x, -limit), limit);
  }

  /** Advances the sim and returns the events produced since the last call. */
  tick(dt: number): SimEvent[] {
    this.events.length = 0;
    if (this.runState.status !== 'running') return this.events;

    this.accumulator += dt;

    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_TICK) {
      this.accumulator -= FIXED_DT;
      steps++;
      this.step(FIXED_DT);
    }

    // A stall long enough to exhaust the step budget is dropped rather than
    // replayed, so the sim never falls permanently behind wall-clock time.
    if (steps >= MAX_STEPS_PER_TICK) this.accumulator = 0;

    return this.events;
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

    if (squad.count > state.peakCount) state.peakCount = squad.count;
    state.survivors = squad.count;
  }
}
