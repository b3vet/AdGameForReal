/**
 * One gate per row (document 28, superseding the per-group half of D44).
 *
 * The owner's note: "gates are double collectible, we should only be able to
 * get a single gate on a gate set". Under D44 every group took the gate in the
 * lane it crossed a row in, so a column and its stragglers could both be paid
 * by one row. Instrumented bot runs found exactly one way it happened in play —
 * 18 rows in 400 human runs across the forty levels, none in 200 greedy ones: a
 * fence whose approach begins at a gate row cuts its stragglers off on the step
 * the column crosses that row, a metre or two behind it, and they walk through
 * it a moment later in their own lane. Now the first gate any group takes
 * claims the row and the rest of it goes dark on that step, for everybody.
 *
 * The plain case, a single column, is in `./gates.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { play, level, row, runOf, wall } from './fixtures';
import type { Run } from '../Run';
import type { GateDef } from '../types';
import { wallX } from '../walls';
import { balance } from '@/data';

const DT = 1 / 60;
const LINE = wallX(1, balance.road.laneWidth);

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

/** An `add` gate shooting cannot grow, so a test can read what it paid. */
function frozen(value: number): GateDef {
  return { kind: 'add', value, cap: value };
}

describe('a row with stragglers on the road', () => {
  it('takes nothing from a row the column has already taken a gate from', () => {
    const run = runOf(straddle([row(40, [null, frozen(20), frozen(30)])]));
    cutInTwo(run);
    const column = countIn(run, 0);
    const stragglers = countIn(run, 1);
    expect(stragglers).toBeGreaterThan(0);

    const events = play(run, 5, LINE);
    const passed = events.filter((e) => e.type === 'gatePassed');
    // Two gates on one row, two groups: the column is ahead, so it crosses
    // first and its gate claims the row. The straggler's lane went dark on the
    // same step and it walks through it for nothing (document 28, which
    // supersedes the per-group half of D44 — under it both gates paid).
    expect(passed).toHaveLength(1);
    expect(passed[0]?.type === 'gatePassed' ? passed[0].value : 0).toBe(20);
    expect(countIn(run, 0)).toBeGreaterThan(column);
    expect(countIn(run, 1)).toBe(stragglers);
    expect(run.state.gates.every((g) => g.passed)).toBe(true);
    expect(run.state.squad.count).toBe(countIn(run, 0) + countIn(run, 1));
  });

  it('takes nothing from a row the column crossed on the step the fence cut it off', () => {
    // The path the instrumented bot runs found (18 rows in 400 human runs): a
    // stretch whose approach begins at a gate row cuts its stragglers on the
    // step the column crosses that row, and they are placed where they stand,
    // a metre or two behind it. Under D44 they then walked through the row in
    // their own lane and took a second gate from it.
    const run = runOf(
      level({
        startCount: 60,
        rows: [row(40, [null, frozen(20), frozen(30)])],
        walls: [wall(1, 40 + balance.walls.approach, 70)],
        arenaZ: 400,
      }),
    );
    let passed = 0;
    let cutBehind = false;
    for (let step = 0; step < 60 * 12; step++) {
      run.setTargetX(LINE);
      for (const event of run.tick(DT)) if (event.type === 'gatePassed') passed++;
      const group = run.state.groups?.[1];
      // Cut on the crossing step, and standing behind the row when it was.
      if (group !== undefined && group.count > 0 && group.z < 40 && run.state.squad.z >= 40) {
        cutBehind = true;
      }
    }
    expect(cutBehind).toBe(true);
    expect(passed).toBe(1);
    expect(run.state.squad.count).toBe(80);
  });

  it('lets a straggler take the gate in its lane when the column took none', () => {
    // An empty lane is not a gate: the column that walks through one has
    // claimed nothing, so the row is still there for the first group that
    // does take a gate from it.
    const run = runOf(straddle([row(40, [null, null, frozen(12)])]));
    cutInTwo(run);
    const stragglers = countIn(run, 1);
    expect(stragglers).toBeGreaterThan(0);
    const events = play(run, 5, LINE);
    expect(events.filter((e) => e.type === 'gatePassed')).toHaveLength(1);
    expect(countIn(run, 1)).toBe(stragglers + 12);
  });

  it('pays one gate when two straggler groups cross the same row', () => {
    // A fence on each boundary, the second arriving a little after the first:
    // the column is cut on the right, steered onto the left line and cut
    // again, and keeps the middle lane, which is empty. A group walks each
    // side lane toward a gate of its own.
    const run = runOf(
      level({
        startCount: 60,
        rows: [row(50, [frozen(10), null, frozen(30)])],
        walls: [wall(1, 20, 60), wall(-1, 30, 60)],
        arenaZ: 400,
      }),
    );
    play(run, 4, LINE);
    play(run, 2, -LINE);
    const groups = (run.state.groups ?? []).filter((g, i) => i > 0 && g.count > 0);
    expect(groups).toHaveLength(2);
    const before = run.state.squad.count;
    const events = play(run, 5, 0);
    const passed = events.filter((e) => e.type === 'gatePassed');
    expect(passed).toHaveLength(1);
    const value = passed[0]?.type === 'gatePassed' ? passed[0].value : 0;
    expect(run.state.squad.count).toBe(before + value);
    expect(run.state.gates.every((g) => g.passed)).toBe(true);
  });
});
