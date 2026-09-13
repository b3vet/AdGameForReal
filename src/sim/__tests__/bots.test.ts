import { describe, expect, it } from 'vitest';

import { createBot } from '../bots';
import { enemyFootprint } from '../enemies';
import { clampLimit, halfWidth, openRoadWidth, wallKeep } from '../formation';
import { laneCenter, laneOf } from '../lanes';
import { generateLevel } from '../level';
import { Run } from '../Run';
import type { EnemyState, GateState, Lane, RunState, StreamState, WeaponId } from '../types';
import { wallHolds, wallX } from '../walls';
import { level, row as rowOf, wall } from './fixtures';
import { playLevel } from './harness';
import { balance, levelConfig } from '@/data';
import type { Balance } from '@/data/types';

function gate(lane: Lane, kind: GateState['kind'], value: number, z = 20): GateState {
  return { id: lane + 1, rowIndex: 0, lane, z, kind, value, hits: 0, passed: false };
}

function staff(lane: Lane, weaponId: WeaponId, z = 20): GateState {
  return { id: lane + 1, rowIndex: 0, lane, z, kind: 'weapon', value: 0, hits: 0, passed: false, weaponId };
}

function block(x: number, z: number, units = 100): EnemyState {
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
function body(id: number, lane: Lane, z: number, streamId = 0): EnemyState {
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

function streamState(id: number, lane: Lane): StreamState {
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

function state(gates: GateState[], enemies: EnemyState[] = [], count = 10): RunState {
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

const ROW = [gate(-1, 'sub', 3), gate(0, 'add', 5), gate(1, 'mul', 2)];

/**
 * The lane a bot's answer steers into.
 *
 * A bot asks for a lane centre and gets back what the crowd's own clamp allows.
 * A lane-wide column reaches both side lane centres on an open road (D42), but
 * a fence still holds it short of one, and what decides which gate it takes is
 * `laneOf` rather than the distance to the middle of the panel — so these tests
 * read the lane rather than the coordinate.
 */
function lane(target: number): Lane {
  return laneOf(target);
}

describe('bots', () => {
  it('sends greedy to the lane with the best outcome', () => {
    expect(lane(createBot('greedy', 1)(state(ROW)))).toBe(1);
  });

  it('sends worst to the lane with the worst outcome', () => {
    expect(lane(createBot('worst', 1)(state(ROW)))).toBe(-1);
  });

  it('prefers an empty lane to a penalty when the row is short of gates', () => {
    const partial = [gate(-1, 'sub', 4), gate(1, 'add', 6)];
    expect(lane(createBot('greedy', 1)(state(partial)))).toBe(1);
    // Nothing at all beats losing four units, so the worst bot still avoids -4.
    expect(lane(createBot('worst', 1)(state(partial)))).toBe(-1);
  });

  it('values a fireRate gate by what it prints, not as nothing', () => {
    const row = [gate(-1, 'fireRate', 0.1), gate(0, 'add', 1), null];
    const gates = row.filter((g): g is GateState => g !== null);
    // +10% rate on a hundred units beats a single extra body...
    expect(lane(createBot('greedy', 1)(state(gates, [], 100)))).toBe(-1);
    // ...and loses to a real handful of them.
    const better = [gate(-1, 'fireRate', 0.1), gate(0, 'add', 20)];
    expect(lane(createBot('greedy', 1)(state(better, [], 100)))).toBe(0);
  });

  it('takes a staff that suits the road ahead, and the worst bot takes the other', () => {
    // Three blocks strung out down the road: too far apart to splash, close
    // enough to chain, so storm is the upgrade and frost the downgrade.
    const strung = [block(0, 12, 4), block(0, 14.5, 4), block(0, 17, 4)];
    const row = [staff(-1, 'storm'), gate(0, 'add', 40), staff(1, 'frost')];
    expect(lane(createBot('greedy', 1)(state(row, strung, 200)))).toBe(-1);
    expect(lane(createBot('worst', 1)(state(row, strung, 200)))).toBe(1);
  });

  it('will not swap to a worse staff just because a gate offers one', () => {
    // Shoulder to shoulder is what the starting staff is for, so trading its
    // splash away for a slow is a downgrade and the bot walks the empty lane.
    const packed = [block(-2, 14, 4), block(0, 14, 4), block(2, 14, 4)];
    const row = [staff(-1, 'frost'), null, null];
    const gates = row.filter((g): g is GateState => g !== null);
    expect(lane(createBot('greedy', 1)(state(gates, packed, 100)))).not.toBe(-1);
  });

  it('makes greedy step out of a block that is about to reach it', () => {
    // A lane-wide column fits beside a block (D42), so greedy no longer holds
    // its ground and eats one: it goes to the nearest place its crowd clears
    // the block from, which is the neighbouring lane's centre.
    const small = block(0, balance.bots.threatLookahead / 2, 4);
    const blocked = state(ROW, [small]);
    blocked.squad.x = 0.4;
    const target = createBot('greedy', 1)(blocked);
    const squadHalf = halfWidth(blocked.squad.count, openRoadWidth());
    const blockHalf = enemyFootprint('grunt', small.units, balance);
    expect(target).toBe(laneCenter(1));
    expect(Math.abs(target - small.x)).toBeGreaterThanOrEqual(squadHalf + blockHalf);
  });

  it('holds its ground when there is nowhere a block does not reach', () => {
    // Both boundaries walled and a block filling the lane: nothing beats
    // standing still, so it stands still rather than swerving for nothing.
    const boxed = state(ROW, [block(0, balance.bots.threatLookahead / 2)]);
    boxed.squad.x = 0.3;
    boxed.walls = [
      { boundary: -1, zStart: -5, zEnd: 40 },
      { boundary: 1, zStart: -5, zEnd: 40 },
    ];
    expect(createBot('greedy', 1)(boxed)).toBe(0.3);
  });

  it('lets greedy commit to its lane once the row is close', () => {
    const close = [gate(-1, 'sub', 3), gate(0, 'add', 5), gate(1, 'mul', 2)].map((g) => ({
      ...g,
      z: balance.bots.gateCommitDistance - 1,
    }));
    const blocked = state(close, [block(0, 2)]);
    expect(lane(createBot('greedy', 1)(blocked))).toBe(1);
  });

  it('keeps the random bot on one lane for the whole row', () => {
    const bot = createBot('random', 3);
    const current = state(ROW);
    const first = bot(current);
    for (let i = 0; i < 50; i++) expect(bot(current)).toBe(first);
  });

  it('gives different random bots different lane sequences', () => {
    const lanes = (seed: number): number[] => {
      const bot = createBot('random', seed);
      const out: number[] = [];
      for (let row = 0; row < 12; row++) {
        const gates = [{ ...gate(0, 'add', 5), rowIndex: row }];
        for (let i = 0; i < row; i++) gates.unshift({ ...gate(0, 'add', 5), rowIndex: i, passed: true });
        out.push(bot(state(gates)));
      }
      return out;
    };
    expect(lanes(1)).not.toEqual(lanes(7));
  });

  it('moves onto the lane the river is coming down, between gate rows', () => {
    // The next gate row is far away, so what matters is the stream. A small
    // squad only covers the lane it stands on, so it has to go to the bodies.
    const far = [gate(-1, 'add', 5, 60), gate(1, 'add', 6, 60)];
    const left = [body(10, -1, 8), body(11, -1, 10), body(12, -1, 12), body(13, -1, 14)];
    const right = left.map((b, i) => ({ ...b, id: 20 + i, x: laneCenter(1) }));

    expect(createBot('greedy', 1)(state(far, left, 3))).toBeLessThan(0);
    expect(createBot('greedy', 1)(state(far, right, 3))).toBeGreaterThan(0);
  });

  it('stands between two lanes when a horde pours down both', () => {
    // Giving one of a horde's two lanes up is a soldier per body; standing in
    // the gap reaches both, which is why horde lanes are neighbours.
    const far = [gate(-1, 'add', 5, 60), gate(1, 'add', 6, 60)];
    const bodies = [
      body(10, -1, 8),
      body(11, -1, 10),
      body(12, -1, 12),
      body(13, 0, 9, 1),
      body(14, 0, 11, 1),
      body(15, 0, 13, 1),
    ];
    const stand = createBot('greedy', 1)(state(far, bodies, 3));
    expect(stand).toBeGreaterThan(laneCenter(-1));
    expect(stand).toBeLessThan(laneCenter(0));
  });

  it('goes for the gate once the row is close, stream or no stream', () => {
    const close = [gate(-1, 'sub', 3, 4), gate(0, 'add', 5, 4), gate(1, 'mul', 2, 4)];
    const bodies = [body(10, -1, 6), body(11, -1, 7), body(12, -1, 8)];
    expect(lane(createBot('greedy', 1)(state(close, bodies, 20)))).toBe(1);
  });

  it('holds station once every gate is behind the squad', () => {
    const done = state(ROW.map((g) => ({ ...g, passed: true })));
    // Inside the clamp a crowd of ten has, so "hold station" is the position
    // itself and not the clamp answering for it.
    done.squad.x = 1.1;
    expect(createBot('greedy', 1)(done)).toBe(1.1);
    expect(createBot('worst', 1)(done)).toBe(1.1);
  });

  it('steers by the balance its run was built on, not by the shipped one', () => {
    // A bot asks the formation how wide its crowd is and how much road the
    // clamp leaves it, and both are functions of a `Balance` (D37). Reading the
    // shipped object while the run reads its own is the same hazard the
    // formation cache has (`formation.test.ts`), one layer up: the bot asks for
    // a lane centre its crowd is too wide to reach and sails past the row.
    const tuned = structuredClone(balance);
    tuned.formation.spacing.max = balance.formation.spacing.max * 2;
    tuned.formation.spacing.min = balance.formation.spacing.min * 2;

    const width = openRoadWidth();
    // Wider spacing packs *fewer* units into the lane, so the tuned crowd is
    // the narrower one — the band is a lane either way now (D42), and which
    // way the number moves is beside the point: the bot must read its own.
    expect(halfWidth(8, width, tuned)).not.toBeCloseTo(halfWidth(8, width), 6);

    // Both want the `mul` in the right lane, each through its own clamp.
    const squad = state(ROW, [], 8);
    const onShipped = createBot('greedy', 1)(squad);
    const onTuned = createBot('greedy', 1, tuned)(squad);
    expect(lane(onShipped)).toBe(1);
    expect(lane(onTuned)).toBe(1);
    expect(onShipped).toBeCloseTo(Math.min(clampLimit(8, width), laneCenter(1)), 9);
    expect(onTuned).toBeCloseTo(Math.min(clampLimit(8, width, tuned), laneCenter(1)), 9);
  });
});

/** The shipped tuning with the human's knobs bent, so a test can isolate one. */
function humanBalance(patch: Partial<Balance['bots']['human']>): Balance {
  const tuned = structuredClone(balance);
  Object.assign(tuned.bots.human, patch);
  return tuned;
}

/** A row of three gates `z` metres ahead, best on the right, worst on the left. */
function rowGates(z: number, rowIndex = 0): GateState[] {
  return [gate(-1, 'sub', 3, z), gate(0, 'add', 5, z), gate(1, 'mul', 2, z)].map((g) => ({
    ...g,
    rowIndex,
  }));
}

describe('the human bot', () => {
  it('acts on the board exactly `reactionSteps` after it changes', () => {
    // The hand alone: no misreads, and a finger fast enough to arrive the step
    // it is told to, so what is left to measure is the delay itself.
    const tuned = humanBalance({ swipeSpeed: 1000, laneAccuracy: 1 });
    const delay = tuned.bots.human.reactionSteps;
    const bot = createBot('human', 1, tuned);

    const close = balance.bots.gateCommitDistance - 3;
    const before = state(rowGates(close));
    for (let i = 0; i < delay + 5; i++) bot(before);
    const settled = bot(before);
    expect(lane(settled)).toBe(1);

    // The same row with the multiplier moved to the other side.
    const swapped = state([
      { ...gate(-1, 'mul', 2, close) },
      { ...gate(0, 'add', 5, close) },
      { ...gate(1, 'sub', 3, close) },
    ]);
    let changedAt = -1;
    for (let i = 0; i < delay * 2; i++) {
      const out = bot(swapped);
      if (changedAt < 0 && out !== settled) changedAt = i;
    }
    expect(changedAt).toBe(delay);
  });

  it('moves its finger no faster than `swipeSpeed`', () => {
    // A thumb, not a jump (D45): the target itself has a speed, on top of
    // whatever the crowd does to follow it.
    const tuned = humanBalance({ reactionSteps: 0, laneAccuracy: 1 });
    const cap = tuned.bots.human.swipeSpeed / 60;
    const bot = createBot('human', 1, tuned);
    const wanted = state(rowGates(balance.bots.gateCommitDistance - 3));

    let previous = wanted.squad.x;
    let biggest = 0;
    let steps = 0;
    while (previous !== laneCenter(1) && steps < 600) {
      const out = bot(wanted);
      biggest = Math.max(biggest, Math.abs(out - previous));
      previous = out;
      steps++;
    }
    expect(biggest).toBeLessThanOrEqual(cap + 1e-12);
    // And it really did take a lane change's worth of steps to get there.
    expect(previous).toBe(laneCenter(1));
    expect(steps).toBeGreaterThanOrEqual(Math.floor(laneCenter(1) / cap));
  });

  it('reads the row right about seven times in ten', () => {
    // Wrong is the *second* best lane, not the worst one: a player who misreads
    // a row takes the lesser gate, they do not walk into the curse.
    const tuned = humanBalance({ reactionSteps: 0, swipeSpeed: 1000 });
    const bot = createBot('human', 5, tuned);
    const rows = 400;
    let best = 0;
    for (let r = 0; r < rows; r++) {
      const picked = lane(bot(state(rowGates(balance.bots.gateCommitDistance - 3, r))));
      expect(picked).not.toBe(-1);
      if (picked === 1) best++;
    }
    const accuracy = best / rows;
    expect(accuracy).toBeGreaterThan(tuned.bots.human.laneAccuracy - 0.07);
    expect(accuracy).toBeLessThan(tuned.bots.human.laneAccuracy + 0.07);
  });

  it('rolls its lane once per row, not once per step', () => {
    const tuned = humanBalance({ reactionSteps: 0, swipeSpeed: 1000 });
    const bot = createBot('human', 2, tuned);
    const here = state(rowGates(balance.bots.gateCommitDistance - 3));
    const first = bot(here);
    for (let i = 0; i < 60; i++) expect(bot(here)).toBe(first);
  });

  it('answers the same board the same way from the same seed', () => {
    // It carries state now — a ring of past observations, a finger, and one
    // roll per row — so "reproducible" has to be pinned rather than assumed:
    // the balance bands are measured on this bot, run after run.
    const first = createBot('human', 9);
    const same = createBot('human', 9);
    const other = createBot('human', 10);
    let diverged = false;
    for (let r = 0; r < 40; r++) {
      const here = state(rowGates(balance.bots.gateCommitDistance - 3, r));
      for (let step = 0; step < 12; step++) {
        const answer = first(here);
        expect(same(here)).toBe(answer);
        if (other(here) !== answer) diverged = true;
      }
    }
    expect(diverged).toBe(true);
  });

  it('clears level 1 on every seed', () => {
    // D31's generous opening, through a thumb: the first level has to be a
    // level a real player finishes, or the campaign never starts.
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(`s${String(seed)} ${playLevel(1, seed, 'human').status}`).toBe(`s${String(seed)} won`);
    }
  }, 60_000);

  it('walks away with less of its crowd than greedy on a mid level', () => {
    // The whole point of D45: greedy is a ceiling, not a player. If the two
    // were within a hair of each other the bands would be measured on nobody.
    let human = 0;
    let greedy = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const h = playLevel(7, seed, 'human');
      const g = playLevel(7, seed, 'greedy');
      const hShare = h.survivors / Math.max(1, h.peakCount);
      const gShare = g.survivors / Math.max(1, g.peakCount);
      expect(`s${String(seed)} ${String(hShare <= gShare)}`).toBe(`s${String(seed)} true`);
      human += hShare;
      greedy += gShare;
    }
    expect(human / 5).toBeLessThan(greedy / 5);
  }, 60_000);
});

/**
 * Drives a whole level with one bot and reports, for every stretch of wall it
 * meets, where its centre stood the step *before* the stretch began to hold it.
 *
 * The step before is the whole question (D44). From the moment a wall holds,
 * the sim's own clamp keeps the centre on one side of the line, so a centre
 * measured inside the stretch says nothing; what decides how much of the column
 * is cut off is where the crowd was when the fence arrived.
 */
function fenceEntries(def: ReturnType<typeof level>, kind: 'greedy' | 'human', seed = 4242): number[] {
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
function fenceTrap(): ReturnType<typeof level> {
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
const WALLED_LEVELS = [4, 6, 8, 11, 14];
const WALLED_SEEDS = [1, 2, 3];

/** Every fence entry of a bot over that sweep: how far its column reached past
 *  the line the step before the stretch began to hold it. */
function campaignEntries(kind: 'greedy' | 'human'): number[] {
  const all: number[] = [];
  for (const index of WALLED_LEVELS) {
    for (const seed of WALLED_SEEDS) {
      const generated = generateLevel(index, levelConfig(index), seed);
      for (const outside of fenceEntries(generated, kind, seed * 7919 + index)) all.push(outside);
    }
  }
  return all;
}

describe('bots at a fence', () => {
  it('has greedy inside the line with its whole column before the stretch holds', () => {
    // The trap: a multiplier on each side of the fence, and the near one three
    // metres before the approach zone. Greedy commits to a side at
    // `bots.wallCommitDistance` with both rows valued and does not revisit it,
    // so it takes the near multiplier and gives the far one up rather than
    // setting off across the road with a metre of road left.
    const entries = fenceEntries(fenceTrap(), 'greedy');
    expect(entries.length).toBe(1);
    expect(entries[0]).toBe(0);
  });

  it('leaves the human astride the line, which is where its stragglers come from', () => {
    // D44 from the steering side: the bot notices the fence within `wallReach`,
    // its hand is `reactionSteps` behind that and its finger crosses at
    // `swipeSpeed`, so a crossing it starts for the river or for a gate is
    // still happening when the stretch arrives. Phase A turns the units still
    // on the far side into a straggler group; from here it is simply that the
    // crowd was not all there yet.
    const entries = campaignEntries('human');
    expect(entries.length).toBeGreaterThan(10);
    const astride = entries.filter((outside) => outside > 0).length;
    expect(`${String(astride)} of ${String(entries.length)} astride`).not.toBe(
      `0 of ${String(entries.length)} astride`,
    );
    expect(astride / entries.length).toBeGreaterThan(0.25);
  }, 60_000);

  it('keeps greedy out of every fence in the campaign, not just the fixture', () => {
    // The regression this pins: through Milestone 5 greedy took a multiplier on
    // the wrong half of the road and then set off across it with a metre of
    // road left, entering 29 of the campaign's 102 stretches astride the line.
    const entries = campaignEntries('greedy');
    expect(entries.length).toBeGreaterThan(10);
    for (const outside of entries) {
      expect(`outside ${outside.toFixed(2)}`).toBe('outside 0.00');
    }
  }, 60_000);
});
