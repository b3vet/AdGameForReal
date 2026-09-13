/**
 * Board builders for the bot tests.
 *
 * `bots.test.ts` reached 534 lines carrying the greedy bot, the human bot and
 * the fence sweep together with the hand-made boards all three are asked about.
 * The boards live here, the two suites are next door (`bots.test.ts`,
 * `botHuman.test.ts`), and none of the three is over the file-size rule.
 */

import { createBot } from '../bots';
import { wallKeep } from '../formation';
import { laneCenter, laneOf } from '../lanes';
import { generateLevel } from '../level';
import { Run } from '../Run';
import type { EnemyState, GateState, Lane, RunState, StreamState, WeaponId } from '../types';
import { wallHolds, wallX } from '../walls';
import { level, row as rowOf, wall } from './fixtures';
import { balance, levelConfig } from '@/data';
import type { Balance } from '@/data/types';

export function gate(lane: Lane, kind: GateState['kind'], value: number, z = 20): GateState {
  return { id: lane + 1, rowIndex: 0, lane, z, kind, value, hits: 0, passed: false };
}

export function staff(lane: Lane, weaponId: WeaponId, z = 20): GateState {
  return { id: lane + 1, rowIndex: 0, lane, z, kind: 'weapon', value: 0, hits: 0, passed: false, weaponId };
}

export function block(x: number, z: number, units = 100): EnemyState {
  return {
    id: 99,
    kind: 'grunt',
    x,
    z,
    hp: units * 3,
    maxHp: units * 3,
    units,
    speed: 3,
    active: true,
    alive: true,
  };
}

/** One stream body standing in a lane, `z` metres in front of the squad. */
export function body(id: number, lane: Lane, z: number, streamId = 0): EnemyState {
  return {
    id,
    kind: 'grunt',
    x: laneCenter(lane),
    z,
    hp: 4,
    maxHp: 4,
    units: 1,
    speed: balance.streams.speed,
    active: true,
    alive: true,
    streamId,
  };
}

export function streamState(id: number, lane: Lane): StreamState {
  return {
    id,
    lane,
    z: 20,
    count: 40,
    remaining: 40,
    spawned: 10,
    alive: 10,
    killed: 0,
    leaked: 0,
    headZ: 12,
    started: true,
    done: false,
  };
}

export function state(gates: GateState[], enemies: EnemyState[] = [], count = 10): RunState {
  return {
    levelIndex: 1,
    seed: 1,
    time: 0,
    status: 'running',
    squad: {
      count,
      x: 0,
      targetX: 0,
      z: 0,
      fireRate: 2,
      damage: 1,
      fireRateBonus: 0,
      weaponId: 'ember',
    },
    gates,
    enemies,
    streams: enemies.some((e) => e.streamId !== undefined) ? [streamState(0, 0), streamState(1, 1)] : [],
    projectiles: [],
    boss: null,
    peakCount: count,
    survivors: count,
    arenaZ: 200,
  };
}

export const ROW = [gate(-1, 'sub', 3), gate(0, 'add', 5), gate(1, 'mul', 2)];

/**
 * The lane a bot's answer steers into.
 *
 * A bot asks for a lane centre and gets back what the crowd's own clamp allows.
 * A lane-wide column reaches both side lane centres on an open road (D42), but
 * a fence still holds it short of one, and what decides which gate it takes is
 * `laneOf` rather than the distance to the middle of the panel — so these tests
 * read the lane rather than the coordinate.
 */
export function lane(target: number): Lane {
  return laneOf(target);
}

/** The shipped tuning with the human's knobs bent, so a test can isolate one. */
export function humanBalance(patch: Partial<Balance['bots']['human']>): Balance {
  const tuned = structuredClone(balance);
  Object.assign(tuned.bots.human, patch);
  return tuned;
}

/** A row of three gates `z` metres ahead, best on the right, worst on the left. */
export function rowGates(z: number, rowIndex = 0): GateState[] {
  return [gate(-1, 'sub', 3, z), gate(0, 'add', 5, z), gate(1, 'mul', 2, z)].map((g) => ({
    ...g,
    rowIndex,
  }));
}

/**
 * Drives a whole level with one bot and reports, for every stretch of wall it
 * meets, where its centre stood the step *before* the stretch began to hold it.
 *
 * The step before is the whole question (D44). From the moment a wall holds,
 * the sim's own clamp keeps the centre on one side of the line, so a centre
 * measured inside the stretch says nothing; what decides how much of the column
 * is cut off is where the crowd was when the fence arrived.
 */
export function fenceEntries(def: ReturnType<typeof level>, kind: 'greedy' | 'human', seed = 4242): number[] {
  const run = new Run(def, balance);
  const bot = createBot(kind, seed, balance);
  const walls = def.walls ?? [];
  const held = walls.map(() => false);
  const outside: number[] = [];
  let previous = run.state.squad.x;

  for (let step = 0; step < 60 * 240 && run.state.status === 'running'; step++) {
    run.setTargetX(bot(run.state));
    run.tick(1 / 60);
    const squad = run.state.squad;
    for (let i = 0; i < walls.length; i++) {
      const stretch = walls[i];
      if (stretch === undefined) continue;
      const holds = wallHolds(stretch, squad.z);
      if (holds && held[i] !== true) {
        // How far the column reached past the line, or 0 when it was all
        // inside. A micron of it is the clamp's own rounding, not a unit.
        const keep = wallKeep(squad.count, squad.formationWidth, balance);
        const gap = Math.abs(previous - wallX(stretch.boundary));
        const past = keep - gap;
        outside.push(past > 1e-6 ? past : 0);
      }
      held[i] = holds;
    }
    previous = squad.x;
  }
  return outside;
}

/**
 * A fence with a multiplier on each side of it: one on the row before the
 * stretch, one on the row it guards, and only three metres of clear road
 * between the near row and the approach zone. Whichever half a bot decides it
 * wants, it has to be there before the stretch starts.
 */
export function fenceTrap(): ReturnType<typeof level> {
  return level({
    startCount: 100,
    arenaZ: 120,
    rows: [
      rowOf(26, [{ kind: 'sub', value: 60 }, { kind: 'add', value: 5 }, { kind: 'mul', value: 3 }]),
      rowOf(50, [{ kind: 'mul', value: 3 }, null, null]),
    ],
    walls: [wall(-1, 30, 49.5)],
  });
}

/** Levels and seeds with fences on them, small enough to drive twice in a test. */
export const WALLED_LEVELS = [4, 6, 8, 11, 14];
export const WALLED_SEEDS = [1, 2, 3];

/** Every fence entry of a bot over that sweep: how far its column reached past
 *  the line the step before the stretch began to hold it. */
export function campaignEntries(kind: 'greedy' | 'human'): number[] {
  const all: number[] = [];
  for (const index of WALLED_LEVELS) {
    for (const seed of WALLED_SEEDS) {
      const generated = generateLevel(index, levelConfig(index), seed);
      for (const outside of fenceEntries(generated, kind, seed * 7919 + index)) all.push(outside);
    }
  }
  return all;
}

