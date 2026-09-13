/**
 * Stragglers (D44): the units a fence shuts out.
 *
 * The product owner's rule for Milestone 6 is that a slow lane change costs
 * part of the crowd rather than being clamped away. So a column straddling a
 * boundary when the stretch begins to hold is cut in two: the half on the wrong
 * side becomes a group of its own, led down the middle of its lane, firing at
 * what is in front of it, taking the gates it walks through on its own account,
 * and scurrying back to the tail of the column when the stretch releases.
 */

import { describe, expect, it } from 'vitest';

import { Run } from '../Run';
import { CROWD_REJOINING } from '../types';
import type { CrowdState, StreamDef } from '../types';
import { wallX } from '../walls';
import { level, play, row, runOf, testBalance, wall } from './fixtures';
import { balance } from '@/data';

const DT = 1 / 60;
const LINE = wallX(1, balance.road.laneWidth);

function crowdOf(run: Run): CrowdState {
  const crowd = run.state.crowd;
  if (crowd === undefined) throw new Error('the run has no crowd');
  return crowd;
}

function countIn(run: Run, group: number): number {
  return run.state.groups?.[group]?.count ?? 0;
}

/** A stretch from z 20 to 60 on the right-hand boundary, with `rows` inside it. */
function straddle(rows: ReturnType<typeof row>[] = [], startCount = 60): ReturnType<typeof level> {
  return level({ startCount, rows, walls: [wall(1, 20, 60)], arenaZ: 400 });
}

/** Drives the column onto the boundary, so the fence cuts it in two. */
function cutInTwo(run: Run, seconds = 4): void {
  play(run, seconds, LINE);
}

describe('being cut off', () => {
  it('leaves the units on the wrong side of the line behind, as their own group', () => {
    const run = runOf(straddle());
    cutInTwo(run);

    expect(run.state.squad.z).toBeGreaterThan(20 - balance.walls.approach);
    const stragglers = countIn(run, 1);
    expect(stragglers).toBeGreaterThan(0);
    expect(countIn(run, 0)).toBeGreaterThan(0);
    // Nobody died: the plaque reads the whole crowd, wherever it is standing.
    expect(countIn(run, 0) + stragglers).toBe(60);
    expect(run.state.squad.count).toBe(60);

    // They are led down the middle of the lane they were left in, and they are
    // all on the far side of the fence from the column.
    const group = run.state.groups?.[1];
    expect(group?.lane).toBe(1);
    expect(group?.leaderX).toBeCloseTo(balance.road.laneWidth, 9);
    const crowd = crowdOf(run);
    for (let i = 0; i < crowd.capacity; i++) {
      if ((crowd.alive[i] ?? 0) === 0) continue;
      const side = (crowd.x[i] ?? 0) > LINE;
      expect(side).toBe((crowd.group[i] ?? 0) === 1);
    }
  });

  it('cuts once, when the stretch begins to hold, and not again after that', () => {
    // Dragging the head across a fence later does not cut a second group: the
    // column simply jams against the line (`crowd.test.ts`). The cut is the
    // moment the wall arrives, which is the moment the player had to be ready
    // for.
    const run = runOf(straddle());
    cutInTwo(run);
    const first = countIn(run, 1);
    play(run, 4, -99);
    expect(countIn(run, 1)).toBe(first);
    expect(countIn(run, 2)).toBe(0);
  });

  it('walks them with the column and holds them in their lane', () => {
    const run = runOf(straddle());
    cutInTwo(run);
    const group = run.state.groups?.[1];
    const before = group?.z ?? 0;
    play(run, 2, -99);
    // They are behind the column — that is where they were left — and they are
    // covering the same ground it is.
    expect((group?.z ?? 0) - before).toBeCloseTo(2 * balance.squad.runSpeed, 1);
    expect(group?.z ?? 0).toBeLessThan(run.state.squad.z);

    const crowd = crowdOf(run);
    for (let i = 0; i < crowd.capacity; i++) {
      if ((crowd.alive[i] ?? 0) === 0 || (crowd.group[i] ?? 0) !== 1) continue;
      expect(crowd.x[i] ?? 0).toBeGreaterThan(LINE);
      expect(crowd.x[i] ?? 0).toBeLessThan(balance.road.halfWidth);
    }
  });
});

describe('fighting alone', () => {
  it('shoots down its own lane while the column shoots down another', () => {
    const stream: StreamDef = {
      lane: 1,
      kind: 'grunt',
      count: 40,
      durationSeconds: 4,
      hpPerEnemy: 2,
      speed: balance.streams.speed,
      jitter: 0,
    };
    const run = runOf(
      // The row is past the fence's start, so the river arrives after the cut
      // rather than before it.
      straddle([{ z: 60, gates: [null, null, null], enemies: [], streams: [stream] }], 120),
    );
    cutInTwo(run);
    expect(countIn(run, 1)).toBeGreaterThan(0);

    // The column is held left of the fence from here on, so anything that dies
    // in the right-hand lane was shot by the group standing in it.
    let killed = 0;
    for (let step = 0; step < 60 * 8; step++) {
      run.setTargetX(-99);
      for (const event of run.tick(DT)) {
        if (event.type === 'enemyKilled' && event.x > LINE) killed++;
      }
    }
    expect(killed).toBeGreaterThan(10);
  });

  it('takes the gate in its own lane while the column takes the gate in theirs', () => {
    const run = runOf(
      straddle([
        row(40, [null, { kind: 'add', value: 20 }, { kind: 'add', value: 30 }]),
      ]),
    );
    cutInTwo(run);
    const column = countIn(run, 0);
    const stragglers = countIn(run, 1);

    const events = play(run, 5, LINE);
    const passed = events.filter((e) => e.type === 'gatePassed');
    // Two gates on one row, one row, two groups: each takes the one in front
    // of it (D44). Before Milestone 6 exactly one gate per row could ever be
    // taken, by whichever lane the single crowd was in.
    expect(passed).toHaveLength(2);
    expect(countIn(run, 0)).toBeGreaterThan(column);
    expect(countIn(run, 1)).toBeGreaterThan(stragglers);
    expect(run.state.squad.count).toBe(countIn(run, 0) + countIn(run, 1));
  });

  it('pays a curse out of its own tail', () => {
    const run = runOf(straddle([row(40, [null, null, { kind: 'sub', value: 15 }])]));
    cutInTwo(run);
    const column = countIn(run, 0);
    const stragglers = countIn(run, 1);
    expect(stragglers).toBeGreaterThan(15);

    play(run, 5, LINE);
    // The column never saw it: the curse was in the straggler's lane.
    expect(countIn(run, 0)).toBe(column);
    expect(countIn(run, 1)).toBeLessThan(stragglers);
  });
});

describe('coming home', () => {
  it('rejoins the back of the column when the stretch releases', () => {
    const run = runOf(level({ startCount: 60, rows: [], walls: [wall(1, 20, 40)], arenaZ: 400 }));
    cutInTwo(run);
    const stragglers = countIn(run, 1);
    expect(stragglers).toBeGreaterThan(0);

    const crowd = crowdOf(run);
    let rejoining = 0;
    let dissolvedAt = -1;
    for (let step = 0; step < 60 * 12; step++) {
      run.setTargetX(-99);
      run.tick(DT);
      for (let i = 0; i < crowd.capacity; i++) {
        if ((crowd.alive[i] ?? 0) === 0) continue;
        if (((crowd.flags[i] ?? 0) & CROWD_REJOINING) !== 0) rejoining++;
      }
      if (dissolvedAt < 0 && countIn(run, 1) === 0) dissolvedAt = step;
    }

    // Released at the far end plus the gate gap, and not one step before it.
    expect(dissolvedAt).toBeGreaterThan(0);
    // They scurried: the flag was up for a while and is down again by the end.
    expect(rejoining).toBeGreaterThan(stragglers);
    expect(countIn(run, 0)).toBe(60);
    expect(run.state.squad.count).toBe(60);
    for (let i = 0; i < crowd.capacity; i++) {
      if ((crowd.alive[i] ?? 0) === 0) continue;
      expect((crowd.flags[i] ?? 0) & CROWD_REJOINING).toBe(0);
    }
  });

  it('keeps the slots whole through the cut and the rejoin', () => {
    const run = runOf(level({ startCount: 60, rows: [], walls: [wall(1, 20, 40)], arenaZ: 400 }));
    const crowd = crowdOf(run);
    for (let step = 0; step < 60 * 14; step++) {
      run.setTargetX(step < 60 * 4 ? LINE : -99);
      run.tick(DT);
      // Every group's slots are exactly 0 to count-1, at every step of it.
      for (let g = 0; g < (run.state.groups?.length ?? 0); g++) {
        const seen = new Set<number>();
        for (let i = 0; i < crowd.capacity; i++) {
          if ((crowd.alive[i] ?? 0) === 0 || (crowd.group[i] ?? 0) !== g) continue;
          seen.add(crowd.slot[i] ?? -1);
        }
        expect(seen.size).toBe(countIn(run, g));
        if (seen.size > 0) expect(Math.max(...seen)).toBe(seen.size - 1);
      }
    }
  });

  it('fights where it stands when the stretch runs to the arena', () => {
    // A group whose fence outlives the road never goes home; it is simply a
    // second crowd at the arena (D44).
    const run = runOf(level({ startCount: 60, rows: [], walls: [wall(1, 20, 120)], arenaZ: 30 }));
    cutInTwo(run);
    expect(countIn(run, 1)).toBeGreaterThan(0);
    play(run, 10, LINE);
    expect(run.state.squad.z).toBe(30);
    expect(countIn(run, 1)).toBeGreaterThan(0);
    expect(run.state.groups?.[1]?.rejoinAt ?? 0).toBeGreaterThan(run.state.time);
  });
});

describe('the group cap', () => {
  it('merges a new cut into the nearest group once it is full', () => {
    // Two groups only: the column and one straggler group. The second fence
    // still cuts — those units are behind it whatever the bookkeeping says —
    // and they join the group already standing nearest to them, which then
    // goes home at the later of the two fences.
    const tuning = testBalance();
    tuning.crowd.groupCap = 2;
    const run = new Run(
      level({
        startCount: 120,
        rows: [],
        walls: [wall(1, 20, 40), wall(1, 60, 90)],
        arenaZ: 400,
      }),
      tuning,
    );
    expect(run.state.groups).toHaveLength(2);

    cutInTwo(run);
    const first = countIn(run, 1);
    expect(first).toBeGreaterThan(0);

    // Past the first stretch they come home; then straddle the second one.
    play(run, 3, LINE);
    const second = countIn(run, 1);
    expect(run.state.squad.count).toBe(120);
    expect(countIn(run, 0) + second).toBe(120);
  });
});
