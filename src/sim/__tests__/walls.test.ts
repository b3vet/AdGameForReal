/**
 * Lane walls (D32), as Milestone 6 leaves them: a fence stops the *units*, not
 * the head (D43). The head is on the finger and goes wherever the finger does;
 * the crowd piles up against the line, whoever is caught on the far side when
 * the stretch begins to hold is cut off as a straggler (D44, `stragglers.
 * test.ts`), and the gate a group takes is still the one on its own side of the
 * fence, because the lane is read off where the people are.
 *
 * `wallLimits` itself is unchanged and still the bots' view of the road.
 */

import { describe, expect, it } from 'vitest';

import { createBot } from '../bots';
import { generateLevel } from '../level';
import type { LevelDef } from '../level';
import { Run } from '../Run';
import { clampLimit } from '../formation';
import { clampToWalls, generateWalls, wallHolds, wallLimits, wallX } from '../walls';
import type { WallDef, WallLimits } from '../walls';
import { level, play, row, runOf, testBalance, wall } from './fixtures';
import { balance, levelConfig, levelCount } from '@/data';

const SEEDS = [1, 2, 3, 4, 5];
const TUNING = balance.walls;
const LINE = wallX(1);

/** Where the head ends up after steering at `targetX` for `seconds`. */
function steer(run: Run, seconds: number, targetX: number): number {
  play(run, seconds, targetX);
  return run.state.squad.x;
}

/** The furthest right any live unit of `group` stands; -1 for any of them. */
function rightmost(run: Run, group = -1): number {
  const crowd = run.state.crowd;
  let most = -Infinity;
  if (crowd === undefined) return most;
  for (let i = 0; i < crowd.capacity; i++) {
    if ((crowd.alive[i] ?? 0) === 0) continue;
    if (group >= 0 && (crowd.group[i] ?? 0) !== group) continue;
    most = Math.max(most, crowd.x[i] ?? 0);
  }
  return most;
}

/** The furthest left any live unit stands. */
function leftmost(run: Run): number {
  const crowd = run.state.crowd;
  let least = Infinity;
  if (crowd === undefined) return least;
  for (let i = 0; i < crowd.capacity; i++) {
    if ((crowd.alive[i] ?? 0) === 0) continue;
    least = Math.min(least, crowd.x[i] ?? 0);
  }
  return least;
}

function limitsAt(walls: readonly WallDef[], z: number, x: number): WallLimits {
  return wallLimits(walls, z, x, balance.road.clampX, { lo: 0, hi: 0, wall: -1 });
}

describe('the wall clamp', () => {
  it('stands the fence on the lane boundary, not in a lane', () => {
    expect(wallX(1)).toBe(balance.road.laneWidth / 2);
    expect(wallX(-1)).toBe(-balance.road.laneWidth / 2);
  });

  it('keeps a column that entered on the left from crossing to the right', () => {
    const body = balance.crowd.bodyRadius;
    const run = runOf(level({ startCount: 40, rows: [], walls: [wall(1, 20, 40)] }));
    // Left of the fence as it enters, then asking to cross while inside it.
    expect(steer(run, 3.8, -99)).toBeCloseTo(-clampLimit(40), 6);
    const inside = steer(run, 2, 99);
    expect(run.state.squad.z).toBeGreaterThan(20);
    expect(run.state.squad.z).toBeLessThan(40);
    // The head goes where the finger goes (D43)...
    expect(inside).toBeCloseTo(clampLimit(40), 6);
    // ...and not one unit is through the line: they are piled against it.
    expect(rightmost(run)).toBeCloseTo(LINE - body, 6);
    // Past the far end they are free, and they follow.
    play(run, 4, 99);
    expect(leftmost(run)).toBeGreaterThan(LINE);
  });

  it('keeps a column that entered on the right from crossing to the left', () => {
    const body = balance.crowd.bodyRadius;
    const run = runOf(level({ startCount: 40, rows: [], walls: [wall(1, 20, 40)] }));
    expect(steer(run, 3.8, 99)).toBeCloseTo(clampLimit(40), 6);
    expect(steer(run, 2, -99)).toBeCloseTo(-clampLimit(40), 6);
    expect(leftmost(run)).toBeCloseTo(LINE + body, 6);
    play(run, 4, -99);
    expect(rightmost(run)).toBeLessThan(LINE);
  });

  it('cuts a column straddling the line in two, two metres before the fence', () => {
    // The mechanic D44 is about. A column sitting on the boundary when the
    // stretch begins to hold does not get pushed off it: the half on the wrong
    // side is left behind as its own group and fights there.
    const run = runOf(level({ startCount: 60, rows: [], walls: [wall(1, 20, 40)] }));
    // Dead on the boundary: outside the approach it may stand there.
    expect(steer(run, 2, LINE)).toBeCloseTo(LINE, 6);
    expect(run.state.groups?.[1]?.count ?? 0).toBe(0);

    const events = play(run, 1.7, LINE);
    const z = run.state.squad.z;
    expect(z).toBeGreaterThanOrEqual(20 - TUNING.approach);
    expect(z).toBeLessThan(20);

    const straggler = run.state.groups?.[1];
    expect(straggler?.count ?? 0).toBeGreaterThan(0);
    expect(straggler?.lane).toBe(1);
    // Nobody died doing it: the plaque still reads the whole crowd (D44).
    expect(run.state.squad.count).toBe(60);
    expect((run.state.groups?.[0]?.count ?? 0) + (straggler?.count ?? 0)).toBe(60);

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

  it('locks the crowd into the middle lane when both boundaries are walled', () => {
    const body = balance.crowd.bodyRadius;
    const run = runOf(level({ startCount: 60, rows: [], walls: [wall(1, 20, 40), wall(-1, 20, 40)] }));
    // It arrives down the middle, and the middle is where it stays.
    play(run, 3.8, 0);
    steer(run, 2, 99);
    expect(rightmost(run)).toBeCloseTo(LINE - body, 6);
    expect(leftmost(run)).toBeGreaterThanOrEqual(-LINE + body - 1e-9);
    // The range the bots read is untouched: it is still about lanes, and it is
    // read from where the crowd is rather than from where the finger is.
    const limits = limitsAt(run.state.walls ?? [], run.state.squad.z, 0);
    expect(limits.lo).toBeCloseTo(-LINE + TUNING.margin, 6);
    expect(limits.hi).toBeCloseTo(LINE - TUNING.margin, 6);
  });

  it('lets shots and enemies through it', () => {
    // The squad is held right of the fence and the block walks down the left
    // lane: the fence is not a shield, and it does not slow the block down
    // either (D32). The two runs no longer shoot *identically*, because the
    // walled crowd narrows into its half of the road (D37) and so fires from a
    // different set of places; what has to hold is that shots cross the fence
    // and that the block's walk is untouched by it.
    const rows = [row(30, [null, null, null], [{ kind: 'grunt', lane: -1, units: 40 }])];
    const walled = new Run(level({ startCount: 60, rows, walls: [wall(-1, 0, 60)] }), testBalance());
    const open = runOf(level({ startCount: 60, rows }));
    play(walled, 2, 99);
    play(open, 2, 99);

    const hp = (run: Run): number => run.state.enemies[0]?.hp ?? -1;
    expect(walled.state.squad.x).toBeGreaterThan(wallX(-1));
    expect(hp(walled)).toBeLessThan(40 * balance.enemies.grunt.hpPerUnit);
    expect(hp(open)).toBeLessThan(40 * balance.enemies.grunt.hpPerUnit);
    expect(walkedTo(walled)).toBe(walkedTo(open));
    function walkedTo(r: Run): number {
      return Math.round((r.state.enemies[0]?.z ?? 0) * 1e6);
    }
  });

  it('reads the fence geometry off the balance it was handed', () => {
    // `wallLimits` used to take a lane width and read the approach zone, the
    // release and the default margin off the shipped object, so a `Run` on a
    // modified tuning — and `availableWidth(state, custom)` with it — was
    // clamped by the shipped fences rather than by its own.
    const tuned = testBalance();
    tuned.walls.approach = TUNING.approach * 4;
    tuned.walls.margin = TUNING.margin * 5;

    const walls = [wall(1, 20, 40)];
    const out: WallLimits = { lo: 0, hi: 0, wall: -1 };
    // Inside the wider approach zone and outside the shipped one.
    const z = 20 - TUNING.approach * 2;

    expect(wallLimits(walls, z, 0, balance.road.clampX, out).hi).toBe(balance.road.clampX);
    expect(wallLimits(walls, z, 0, balance.road.clampX, out, tuned).hi).toBeCloseTo(
      LINE - tuned.walls.margin,
      9,
    );
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

  it('covers no gate row but the one it guards, and never reaches the arena', () => {
    everyLevel((def, index, seed) => {
      const gateRows = def.rows.filter((r) => r.gates.some((g) => g !== null));
      for (const w of def.walls ?? []) {
        const where = `L${String(index)} s${String(seed)} wall ${w.zStart.toFixed(1)}-${w.zEnd.toFixed(1)}`;
        expect(w.zEnd - w.zStart).toBeGreaterThanOrEqual(TUNING.minLength);
        expect(w.zEnd - w.zStart).toBeLessThanOrEqual(TUNING.length.max);
        expect(w.zEnd).toBeLessThanOrEqual(def.arenaZ - TUNING.gateClearance);
        for (const gateRow of gateRows) {
          // The guarded row sits `gateGap` past the far end; every other row is
          // clear of the whole stretch by `gateClearance`.
          const guarded = Math.abs(gateRow.z - TUNING.gateGap - w.zEnd) < 1e-6;
          const clear =
            guarded ||
            gateRow.z <= w.zStart - TUNING.gateClearance ||
            gateRow.z >= w.zEnd + TUNING.gateClearance;
          expect(`${where} vs gate ${gateRow.z.toFixed(1)}: ${String(clear)}`).toBe(
            `${where} vs gate ${gateRow.z.toFixed(1)}: true`,
          );
        }
      }
    });
  });

  it('runs each stretch up to the gate row it guards, and never an opening row', () => {
    everyLevel((def, index, seed) => {
      const gateRows = def.rows
        .map((r, i) => ({ index: i, z: r.z, gates: r.gates }))
        .filter((r) => r.gates.some((g) => g !== null));
      for (const w of def.walls ?? []) {
        const guarded = gateRows.find((r) => Math.abs(r.z - TUNING.gateGap - w.zEnd) < 1e-6);
        const where = `L${String(index)} s${String(seed)} wall ends ${w.zEnd.toFixed(1)}`;
        expect(`${where}: ${String(guarded !== undefined)}`).toBe(`${where}: true`);
        expect(guarded?.index ?? -1).toBeGreaterThanOrEqual(TUNING.fromRow);
      }
    });
  });

  /**
   * The commitment itself (Milestone 4 Phase C). The squad steers at
   * `squad.lateralSpeed` while the road runs past at `squad.runSpeed`, so every
   * metre of road it is *not* clamped for buys it 1.6 m of lane — and it is only
   * held `margin` off the boundary. So any stretch of free road before the
   * panels undoes the whole choice, which is why the clamp runs to the row and
   * only the fence stops short of it.
   */
  it('holds the crowd on its own side of the fence all the way to the row', () => {
    const freeLane = TUNING.gateGap * (balance.crowd.leaderSpeed / balance.squad.runSpeed);
    // The gap the fence leaves is worth far more lane than the margin holds:
    // release the crowd there and it is over the line in a fraction of a second.
    expect(freeLane).toBeGreaterThan(TUNING.margin);

    // Held left by a fence that stops half a metre short of the row, a column
    // whose finger is leaning on the far lane from the first step is still left
    // of the boundary when it crosses — so it takes the gate on its own side,
    // even though the head itself is over on the right (D43).
    const run = runOf(
      level({
        startCount: 40,
        rows: [row(30, [{ kind: 'add', value: 10 }, null, { kind: 'add', value: 10 }])],
        walls: [wall(1, 10, 30 - TUNING.gateGap)],
        arenaZ: 400,
      }),
    );
    play(run, 1.5, -99);

    const events: ReturnType<typeof play> = [];
    let worst = -Infinity;
    let reached = false;
    for (let step = 0; step < 60 * 10 && !reached; step++) {
      run.setTargetX(99);
      for (const event of run.tick(1 / 60)) events.push({ ...event });
      // From the step the stretch starts to hold to just short of its release:
      // before it there is no fence, and past it the straggler group the cut
      // made is rejoining from the right, which is what it is meant to do.
      const z = run.state.squad.z;
      if (z >= 10 - TUNING.approach && z < 29.4) worst = Math.max(worst, rightmost(run, 0));
      reached = run.state.squad.z >= 30;
    }
    // Not one of the column crossed, though the head is over on the right.
    expect(reached).toBe(true);
    expect(worst).toBeLessThan(LINE);
    expect(run.state.squad.x).toBeGreaterThan(LINE);
    // And it took a gate: the lane is read off the people, not the finger.
    expect(events.some((e) => e.type === 'gatePassed')).toBe(true);
    expect(run.state.squad.count).toBeGreaterThan(40);
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
  /**
   * One gate row past a wall: the good gate is on the far side of the fence.
   *
   * The curse is a `mul` and not a `sub`, because a `sub` is shootable and a
   * lane-wide column standing on one for twenty-odd metres of road counts it
   * down to zero and flips it into a bonus (D19, and `gates.test.ts`) — which
   * is a real consequence of D42 and tested below, but it is not what this
   * fixture is about. What it is about is that the fence decides the side.
   */
  function walledChoice(): LevelDef {
    return level({
      startCount: 20,
      rows: [
        row(30, [
          { kind: 'mul', value: 0.5 },
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
    expect(passed?.type === 'gatePassed' ? passed.kind : '').toBe('mul');
  });

  it('lets a column walled onto a curse shoot it into a bonus', () => {
    // The same stretch, with a shootable curse on the side the fence commits
    // the squad to and the squad held there. A road-wide crowd spread its fire
    // over three lanes and arrived at a curse barely dented; the column (D42)
    // puts all of it into the one panel it stands in front of, counts it to
    // zero and walks through a bonus — D19's shoot-to-grow finally doing what
    // it is for, and the reason the worst bot's fixture above uses a `mul`.
    const def = level({
      startCount: 20,
      rows: [row(30, [{ kind: 'sub', value: 10 }, null, { kind: 'add', value: 40 }])],
      walls: [wall(1, 8, 28)],
      arenaZ: 400,
    });
    const run = new Run(def, testBalance());
    const passed = play(run, 8, -balance.road.laneWidth).find((e) => e.type === 'gatePassed');
    expect(passed?.type === 'gatePassed' ? passed.kind : '').toBe('add');
    expect(run.state.squad.count).toBeGreaterThan(20);
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
