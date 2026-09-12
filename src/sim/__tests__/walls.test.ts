/**
 * Lane walls (D32): the clamp, the approach push, where the generator may put
 * one, and what the bots do about them.
 */

import { describe, expect, it } from 'vitest';

import { createBot } from '../bots';
import { generateLevel } from '../level';
import type { LevelDef } from '../level';
import { Run } from '../Run';
import { clampToWalls, generateWalls, wallHolds, wallLimits, wallX } from '../walls';
import type { WallDef, WallLimits } from '../walls';
import { level, play, row, runOf, testBalance, wall } from './fixtures';
import { balance, levelConfig, levelCount } from '@/data';

const SEEDS = [1, 2, 3, 4, 5];
const TUNING = balance.walls;
const LINE = wallX(1);

/** Where the squad ends up after steering at `targetX` for `seconds`. */
function steer(run: Run, seconds: number, targetX: number): number {
  play(run, seconds, targetX);
  return run.state.squad.x;
}

function limitsAt(walls: readonly WallDef[], z: number, x: number): WallLimits {
  return wallLimits(walls, z, x, balance.road.clampX, { lo: 0, hi: 0, wall: -1 });
}

describe('the wall clamp', () => {
  it('stands the fence on the lane boundary, not in a lane', () => {
    expect(wallX(1)).toBe(balance.road.laneWidth / 2);
    expect(wallX(-1)).toBe(-balance.road.laneWidth / 2);
  });

  it('keeps a squad that entered on the left from crossing to the right', () => {
    // One unit, so the road clamp rather than the crowd's own taper is what
    // bounds it and the numbers below are the plan's, not the formation's.
    const run = runOf(level({ startCount: 1, rows: [], walls: [wall(1, 20, 40)] }));
    // Left of the fence as it enters, then asking to cross while inside it.
    expect(steer(run, 3.8, -99)).toBeCloseTo(-balance.road.clampX, 6);
    const inside = steer(run, 2, 99);
    expect(run.state.squad.z).toBeGreaterThan(20);
    expect(run.state.squad.z).toBeLessThan(40);
    expect(inside).toBeCloseTo(LINE - TUNING.margin, 6);
    // Past the far end it is free again.
    expect(steer(run, 3, 99)).toBeCloseTo(balance.road.clampX, 6);
  });

  it('keeps a squad that entered on the right from crossing to the left', () => {
    const run = runOf(level({ startCount: 1, rows: [], walls: [wall(1, 20, 40)] }));
    expect(steer(run, 3.8, 99)).toBeCloseTo(balance.road.clampX, 6);
    expect(steer(run, 2, -99)).toBeCloseTo(LINE + TUNING.margin, 6);
    expect(steer(run, 3, -99)).toBeCloseTo(-balance.road.clampX, 6);
  });

  it('pushes a squad straddling the line off it, two metres before the fence', () => {
    const run = runOf(level({ startCount: 1, rows: [], walls: [wall(1, 20, 40)] }));
    // Dead on the boundary: outside the approach it may stand there...
    expect(steer(run, 2, LINE)).toBeCloseTo(LINE, 6);
    const events = play(run, 1.7, LINE);
    const z = run.state.squad.z;
    // ...and inside the approach zone it is pushed to the side its centre is on.
    expect(z).toBeGreaterThanOrEqual(20 - TUNING.approach);
    expect(z).toBeLessThan(20);
    expect(run.state.squad.x).toBeCloseTo(LINE + TUNING.margin, 6);

    const blocked = events.filter((e) => e.type === 'wallBlocked');
    expect(blocked.length).toBe(1);
    expect(blocked[0]?.type === 'wallBlocked' ? blocked[0].boundary : 0).toBe(1);
  });

  it('says nothing more while the finger stays on the fence', () => {
    // Inside the fence from the first step, so the squad cannot cross it early.
    const run = runOf(level({ startCount: 1, rows: [], walls: [wall(1, 2, 60)] }));
    play(run, 1, -99);
    const events = play(run, 8, 99);
    // One event for the whole stretch, not one a step: a sound, not a buzz.
    expect(events.filter((e) => e.type === 'wallBlocked')).toHaveLength(1);
  });

  it('locks the squad into the middle lane when both boundaries are walled', () => {
    const run = runOf(level({ startCount: 1, rows: [], walls: [wall(1, 20, 40), wall(-1, 20, 40)] }));
    // It arrives down the middle, and the middle is where it stays.
    play(run, 3.8, 0);
    expect(steer(run, 2, 99)).toBeCloseTo(LINE - TUNING.margin, 6);
    const limits = limitsAt(run.state.walls ?? [], run.state.squad.z, run.state.squad.x);
    expect(limits.lo).toBeCloseTo(-LINE + TUNING.margin, 6);
    expect(limits.hi).toBeCloseTo(LINE - TUNING.margin, 6);
  });

  it('lets shots and enemies through it', () => {
    // The squad is held right of the fence; the block walks down the left lane
    // and is shot at exactly as it would be without one (D32).
    const rows = [row(30, [null, null, null], [{ kind: 'grunt', lane: -1, units: 40 }])];
    const walled = new Run(level({ startCount: 60, rows, walls: [wall(-1, 0, 60)] }), testBalance());
    const open = runOf(level({ startCount: 60, rows }));
    play(walled, 2, 99);
    play(open, 2, 99);

    const hp = (run: Run): number => run.state.enemies[0]?.hp ?? -1;
    expect(hp(walled)).toBeLessThan(40 * balance.enemies.grunt.hpPerUnit);
    expect(hp(walled)).toBe(hp(open));
    expect(run(walled)).toBe(run(open));
    function run(r: Run): number {
      return Math.round((r.state.enemies[0]?.z ?? 0) * 1e6);
    }
  });

  it('holds a range that never comes out empty', () => {
    const walls = [wall(1, 0, 100)];
    // A squad so wide its own taper is tighter than the fence: the road wins,
    // rather than the clamp folding inside out.
    const limits = limitsAt(walls, 10, 2);
    expect(clampToWalls(2, limits)).toBeGreaterThanOrEqual(LINE);
    const tight = wallLimits(walls, 10, 2, 0.5, { lo: 0, hi: 0, wall: -1 });
    expect(clampToWalls(2, tight)).toBeLessThanOrEqual(0.5);
  });
});

describe('the wall generator', () => {
  function everyLevel(fn: (def: LevelDef, index: number, seed: number) => void): void {
    for (let index = 1; index <= levelCount; index++) {
      for (const seed of SEEDS) fn(generateLevel(index, levelConfig(index), seed), index, seed);
    }
  }

  it('builds none before the level walls start', () => {
    everyLevel((def, index) => {
      if (index >= TUNING.fromLevel) return;
      expect(def.walls ?? []).toHaveLength(0);
    });
    expect(TUNING.fromLevel).toBe(4);
  });

  it('walls most gate rows late and a couple early, within the level\'s budget', () => {
    let seen = 0;
    everyLevel((def, index) => {
      const walls = def.walls ?? [];
      seen += walls.length;
      // A horde stretch adds its mirror image, so the budget can be beaten by
      // one; nothing else may.
      expect(walls.length).toBeLessThanOrEqual(levelConfig(index).wallRows + 1);
      if (index >= TUNING.fromLevel && levelConfig(index).wallRows > 0) {
        expect(walls.length).toBeGreaterThan(0);
      }
    });
    expect(seen).toBeGreaterThan(100);
  });

  it('never covers a gate row, and never reaches the arena', () => {
    everyLevel((def, index, seed) => {
      const gateRows = def.rows.filter((r) => r.gates.some((g) => g !== null));
      for (const w of def.walls ?? []) {
        const where = `L${String(index)} s${String(seed)} wall ${w.zStart.toFixed(1)}-${w.zEnd.toFixed(1)}`;
        expect(`${where} length`).toBe(`${where} length`);
        expect(w.zEnd - w.zStart).toBeGreaterThanOrEqual(TUNING.minLength);
        expect(w.zEnd - w.zStart).toBeLessThanOrEqual(TUNING.length.max);
        expect(w.zEnd).toBeLessThanOrEqual(def.arenaZ - TUNING.gateClearance);
        for (const gateRow of gateRows) {
          const clear =
            gateRow.z <= w.zStart - TUNING.gateClearance ||
            gateRow.z >= w.zEnd + TUNING.gateClearance;
          expect(`${where} vs gate ${gateRow.z.toFixed(1)}: ${String(clear)}`).toBe(
            `${where} vs gate ${gateRow.z.toFixed(1)}: true`,
          );
        }
      }
    });
  });

  it('guards a gate row, and never one of the opening rows', () => {
    everyLevel((def, index, seed) => {
      const gateRows = def.rows
        .map((r, i) => ({ index: i, z: r.z, gates: r.gates }))
        .filter((r) => r.gates.some((g) => g !== null));
      for (const w of def.walls ?? []) {
        const guarded = gateRows.find((r) => Math.abs(r.z - TUNING.gateClearance - w.zEnd) < 1e-6);
        const where = `L${String(index)} s${String(seed)} wall ends ${w.zEnd.toFixed(1)}`;
        expect(`${where}: ${String(guarded !== undefined)}`).toBe(`${where}: true`);
        expect(guarded?.index ?? -1).toBeGreaterThanOrEqual(TUNING.fromRow);
      }
    });
  });

  it('walls both boundaries only over a horde, and only late', () => {
    let pairs = 0;
    everyLevel((def, index) => {
      const walls = def.walls ?? [];
      for (const w of walls) {
        const mirror = walls.find(
          (other) => other !== w && other.zStart === w.zStart && other.zEnd === w.zEnd,
        );
        if (mirror === undefined) continue;
        pairs++;
        expect(mirror.boundary).toBe(-w.boundary);
        expect(index).toBeGreaterThanOrEqual(TUNING.bothFromLevel);
        const horde = def.rows.some(
          (r) => (r.streams ?? []).length > 1 && r.z >= w.zStart && r.z <= w.zEnd,
        );
        expect(horde).toBe(true);
      }
    });
    expect(pairs).toBeGreaterThan(0);
  });

  it('is a function of the seed, like everything else the generator does', () => {
    const rows = generateLevel(12, levelConfig(12), 4).rows;
    const once = generateWalls(rows, 12, 4, 400, 5);
    const twice = generateWalls(rows, 12, 4, 400, 5);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    expect(JSON.stringify(generateWalls(rows, 12, 5, 400, 5))).not.toBe(JSON.stringify(once));
  });
});

describe('bots and walls', () => {
  /** One gate row past a wall: the good gate is on the far side of the fence. */
  function walledChoice(): LevelDef {
    return level({
      startCount: 20,
      rows: [
        row(30, [
          { kind: 'sub', value: 10 },
          null,
          { kind: 'add', value: 40 },
        ]),
      ],
      walls: [wall(1, 8, 28)],
      arenaZ: 400,
    });
  }

  function drive(kind: 'greedy' | 'worst'): ReturnType<typeof play> {
    const run = new Run(walledChoice(), testBalance());
    const bot = createBot(kind, 5);
    const events: ReturnType<typeof play> = [];
    for (let step = 0; step < 60 * 10; step++) {
      run.setTargetX(bot(run.state));
      for (const event of run.tick(1 / 60)) events.push({ ...event });
    }
    return events;
  }

  it('sends greedy across before the fence, to the side the good gate is on', () => {
    const passed = drive('greedy').find((e) => e.type === 'gatePassed');
    expect(passed?.type === 'gatePassed' ? passed.kind : '').toBe('add');
  });

  it('sends the worst bot to the wrong side, and it cannot come back', () => {
    const passed = drive('worst').find((e) => e.type === 'gatePassed');
    expect(passed?.type === 'gatePassed' ? passed.kind : '').toBe('sub');
  });

  it('never asks for a lane the fence has taken away', () => {
    const def = generateLevel(16, levelConfig(16), 2);
    const run = new Run(def, testBalance());
    const bot = createBot('greedy', 11);
    const walls = def.walls ?? [];
    let inside = 0;

    for (let step = 0; step < 60 * 120 && run.state.status === 'running'; step++) {
      const target = bot(run.state);
      const z = run.state.squad.z;
      const x = run.state.squad.x;
      for (const w of walls) {
        if (!wallHolds(w, z)) continue;
        inside++;
        const line = wallX(w.boundary);
        // The bot asks for its own side of the fence, never the far one.
        if (x < line) expect(target).toBeLessThanOrEqual(line);
        else expect(target).toBeGreaterThanOrEqual(line);
      }
      run.setTargetX(target);
      run.tick(1 / 60);
    }
    expect(inside).toBeGreaterThan(100);
  });
});
