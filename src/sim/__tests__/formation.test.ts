/**
 * The line-filling formation (D37).
 *
 * Milestone 2's phyllotaxis spiral is gone: the crowd fills the width of road it
 * is given in staggered rows and then extends backward. What these tests hold
 * onto is the contract the rest of the sim leans on — one offset per unit, no
 * unit outside the band it was built for, a half-width that never shrinks as
 * the squad grows, and offsets that are cached rather than rebuilt every frame.
 */

import { describe, expect, it } from 'vitest';

import {
  availableWidth,
  clampLimit,
  formationColumns,
  formationDepth,
  formationOffsets,
  formationRows,
  halfExtent,
  halfWidth,
  openRoadWidth,
  unitSpacing,
  wallKeep,
} from '../formation';
import type { FormationOffset } from '../formation';
import { level, row, runOf, wall } from './fixtures';
import { balance } from '@/data';

const COUNTS = [1, 2, 3, 5, 8, 13, 21, 50, 100, 250, 500];

/** The open road, which is what a one-argument caller gets. */
const OPEN = openRoadWidth();

/** Rows pack tighter than columns, so this is the floor on any pair. */
const MIN_SEPARATION = balance.formation.rowDepth * 0.99;

function minPairDistance(offsets: ReadonlyArray<FormationOffset>): number {
  let min = Infinity;
  for (let i = 0; i < offsets.length; i++) {
    for (let j = i + 1; j < offsets.length; j++) {
      const a = offsets[i];
      const b = offsets[j];
      if (a === undefined || b === undefined) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < min) min = d;
    }
  }
  return min;
}

function maxAbs(offsets: ReadonlyArray<FormationOffset>, axis: 'x' | 'z'): number {
  let max = 0;
  for (const offset of offsets) {
    const value = Math.abs(offset[axis]);
    if (value > max) max = value;
  }
  return max;
}

describe('formationOffsets', () => {
  it('returns exactly one offset per unit', () => {
    for (const count of COUNTS) {
      expect(formationOffsets(count)).toHaveLength(count);
    }
  });

  it('returns an empty formation for a wiped-out squad', () => {
    expect(formationOffsets(0)).toHaveLength(0);
    expect(formationOffsets(-5)).toHaveLength(0);
  });

  it('never places two units closer than the row gap', () => {
    for (const count of COUNTS) {
      if (count < 2) continue;
      const floor = MIN_SEPARATION * unitSpacing(count);
      expect(minPairDistance(formationOffsets(count))).toBeGreaterThanOrEqual(floor);
    }
  });

  it('fills the width in rows before it goes backward', () => {
    // A handful is one line; the line fills the road and only then does a
    // second one start behind it. That is the whole point of D37.
    expect(formationOffsets(3)).toHaveLength(3);
    // A squad opens a second row only once the first one is full, at every size.
    for (const count of [1, 3, 8, 12, 20, 60, 300, 500]) {
      const columns = formationColumns(count);
      expect(formationRows(count)).toBe(count <= columns ? 1 : formationRows(count));
      expect(formationRows(count) === 1).toBe(count <= columns);
    }
    expect(formationColumns(500)).toBeGreaterThan(12);
    expect(formationRows(500)).toBeGreaterThan(20);
    for (const count of COUNTS) {
      if (count < 8) continue;
      const offsets = formationOffsets(count);
      // Never wider than the band it was built for...
      expect(maxAbs(offsets, 'x')).toBeLessThanOrEqual(OPEN / 2 + 1e-9);
      // ...and every unit stands at or behind the anchor, never in front of it.
      for (const offset of offsets) expect(offset.z).toBeLessThanOrEqual(0);
    }
  });

  it('centres the front row on the anchor and staggers the one behind it', () => {
    const spacing = unitSpacing(40);
    const offsets = formationOffsets(40);
    const front = offsets.filter((o) => o.row === 0);
    const second = offsets.filter((o) => o.row === 1);
    const centre = (line: ReadonlyArray<FormationOffset>): number =>
      line.reduce((sum, o) => sum + o.x, 0) / line.length;

    expect(centre(front)).toBeCloseTo(0, 9);
    expect(centre(second)).toBeCloseTo(0, 9);
    // The second row holds one fewer and sits in the gaps of the first.
    expect(second).toHaveLength(front.length - 1);
    const firstOfSecond = second[0];
    if (firstOfSecond === undefined) throw new Error('no second row');
    expect(firstOfSecond.x - (front[0]?.x ?? 0)).toBeCloseTo(spacing / 2, 9);
    expect(firstOfSecond.z).toBeCloseTo(-spacing * balance.formation.rowDepth, 9);
  });

  it('narrows into its lane when a wall takes half the road away', () => {
    const wide = formationOffsets(120, OPEN);
    const narrow = formationOffsets(120, OPEN / 2);
    expect(maxAbs(narrow, 'x')).toBeLessThan(maxAbs(wide, 'x'));
    expect(maxAbs(narrow, 'x')).toBeLessThanOrEqual(OPEN / 4 + 1e-9);
    // The units it can no longer stand beside go behind instead.
    expect(maxAbs(narrow, 'z')).toBeGreaterThan(maxAbs(wide, 'z'));
    expect(narrow).toHaveLength(120);
  });

  it('is cached, so the same count and width return the same array instance', () => {
    expect(formationOffsets(37)).toBe(formationOffsets(37));
    // And widths inside one bucket share a formation, so the approach to a
    // fence — where the band narrows a little every step — does not rebuild it.
    const bucket = balance.formation.widthBucket;
    expect(formationOffsets(37, 3.2)).toBe(formationOffsets(37, 3.2 + bucket / 4));
    expect(formationOffsets(37, 3.2)).not.toBe(formationOffsets(37, 3.2 + bucket));
  });

  it('allocates nothing on a cache hit', () => {
    // The sim asks for this every step at up to five hundred units and must not
    // allocate in a hot loop (CLAUDE.md). Measured rather than asserted by
    // inspection: rebuilding would cost five hundred objects a call, some tens
    // of kilobytes, against the tens of *bytes* of allocator noise a cache hit
    // leaves behind over the same loop.
    const iterations = 200_000;
    formationOffsets(500);
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < iterations; i++) formationOffsets(500);
    const grown = process.memoryUsage().heapUsed - before;
    expect(grown / iterations).toBeLessThan(200);
  });

  it('is deterministic: the same count always produces the same positions', () => {
    const first = formationOffsets(12).map((o) => `${o.x.toFixed(6)},${o.z.toFixed(6)}`);
    const second = formationOffsets(12).map((o) => `${o.x.toFixed(6)},${o.z.toFixed(6)}`);
    expect(second).toEqual(first);
  });
});

describe('unitSpacing', () => {
  it('shrinks as the crowd grows, from 0.42 down to 0.28', () => {
    expect(unitSpacing(1)).toBeCloseTo(balance.formation.spacing.max, 6);
    expect(unitSpacing(500)).toBeCloseTo(balance.formation.spacing.min, 6);
    expect(unitSpacing(500)).toBeLessThan(unitSpacing(100));
    expect(unitSpacing(100)).toBeLessThan(unitSpacing(10));
  });
});

describe('halfWidth', () => {
  it('grows monotonically with the squad count', () => {
    let previous = halfWidth(1);
    for (let count = 2; count <= 500; count++) {
      const current = halfWidth(count);
      expect(current).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = current;
    }
  });

  it('saturates at the available half-width, whatever the count', () => {
    for (const width of [1.2, 2.4, OPEN]) {
      for (const count of COUNTS) {
        expect(halfWidth(count, width)).toBeLessThanOrEqual(width / 2 + 1e-9);
        expect(halfExtent(count, width)).toBeLessThanOrEqual(halfWidth(count, width));
      }
      // And it does saturate: a full squad fills whatever it is given.
      expect(halfWidth(500, width)).toBeCloseTo(width / 2, 9);
    }
  });

  it('never gets wider when the road gets narrower', () => {
    for (const count of [10, 60, 200, 500]) {
      let previous = halfWidth(count, 1.2);
      for (let width = 1.3; width <= OPEN; width += 0.1) {
        const current = halfWidth(count, width);
        expect(current).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = current;
      }
    }
  });

  it('covers every unit in the formation plus padding', () => {
    for (const count of COUNTS) {
      const reach = maxAbs(formationOffsets(count), 'x');
      expect(halfWidth(count)).toBeGreaterThanOrEqual(reach);
      expect(halfExtent(count)).toBeCloseTo(reach, 9);
    }
  });

  it('is zero for an empty squad', () => {
    expect(halfWidth(0)).toBe(0);
    expect(halfExtent(0)).toBe(0);
  });
});

describe('availableWidth', () => {
  it('gives the open road everything but the room the clamp steers in', () => {
    const run = runOf(level({ startCount: 40, rows: [] }));
    expect(availableWidth(run.state)).toBeCloseTo(OPEN, 9);
    expect(OPEN).toBeCloseTo(2 * (balance.road.halfWidth - balance.formation.inset), 9);
  });

  it('takes the far side of a fence away while the squad is inside one', () => {
    const run = runOf(level({ startCount: 40, rows: [], walls: [wall(1, 20, 40)] }));
    const open = availableWidth(run.state);
    // Driven left of the fence and then held there.
    for (let step = 0; step < 60 * 5; step++) {
      run.setTargetX(-99);
      run.tick(1 / 60);
      if (run.state.squad.z > 22) break;
    }
    const inside = availableWidth(run.state);
    expect(inside).toBeLessThan(open);
    expect(inside).toBeCloseTo(
      balance.road.halfWidth + 1 - balance.walls.margin - 2 * balance.formation.inset,
      9,
    );
    expect(halfWidth(40, inside)).toBeLessThan(halfWidth(40, open));
  });

  it('leaves a crowd walled on both sides its lane and no less', () => {
    const run = runOf(level({ startCount: 200, rows: [], walls: [wall(1, 5, 60), wall(-1, 5, 60)] }));
    for (let step = 0; step < 60 * 3; step++) {
      run.setTargetX(0);
      run.tick(1 / 60);
      if (run.state.squad.z > 8) break;
    }
    const width = availableWidth(run.state);
    expect(width).toBeGreaterThanOrEqual(balance.formation.minWidth - 1e-9);
    expect(width).toBeLessThanOrEqual(balance.road.laneWidth - 2 * balance.walls.margin + 1e-9);
    // The crowd stands inside the lane: no unit through either fence.
    const keep = wallKeep(200, width);
    expect(run.state.squad.x + halfExtent(200, width)).toBeLessThanOrEqual(
      1 - balance.walls.margin + 1e-9,
    );
    expect(keep).toBeGreaterThan(balance.walls.margin);
  });
});

describe('clampLimit', () => {
  it('is the road less the crowd, floored so a side lane stays reachable', () => {
    const road = balance.road;
    expect(clampLimit(1)).toBeCloseTo(road.clampX, 9);
    expect(clampLimit(500)).toBeCloseTo(road.clampMin, 9);
    for (const count of COUNTS) {
      const limit = clampLimit(count);
      expect(limit).toBeLessThanOrEqual(road.clampX + 1e-9);
      expect(limit).toBeGreaterThanOrEqual(road.clampMin - 1e-9);
      // A squad at the clamp stands in the side lane, wall line included, or a
      // line-filling crowd could take neither a side gate nor a side of a wall.
      expect(limit).toBeGreaterThanOrEqual(road.laneWidth / 2);
    }
  });
});

describe('formationDepth', () => {
  it('grows backward as the crowd outgrows the road, and stays framable', () => {
    expect(formationDepth(3)).toBe(0);
    expect(formationDepth(500)).toBeGreaterThan(formationDepth(100));
    // What the camera has to frame at a full squad. Written down because the
    // render track sizes its shots against it.
    expect(formationDepth(500)).toBeLessThan(9);
    expect(formationDepth(500)).toBeGreaterThan(5);
  });
});

describe('the crowd against the road', () => {
  it('keeps a full squad on the road it steers across', () => {
    // The taper and the floor are one rule: at full width the crowd overhangs
    // the verge by the difference between them and no more.
    const slack = balance.road.clampMin - balance.formation.inset;
    const run = runOf(level({ startCount: 500, rows: [row(400, [null, null, null])] }));
    for (let step = 0; step < 60 * 3; step++) {
      run.setTargetX(99);
      run.tick(1 / 60);
    }
    const edge = run.state.squad.x + halfWidth(500, run.state.squad.formationWidth);
    expect(edge).toBeLessThanOrEqual(balance.road.halfWidth + slack + 1e-9);
  });
});
