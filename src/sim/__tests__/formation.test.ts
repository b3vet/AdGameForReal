/**
 * The lane column (D42, correcting the formation half of D37).
 *
 * The crowd is one lane wide whatever the road leaves open, and the count grows
 * it *backward*. What these tests hold onto is the contract the rest of the sim
 * leans on — one offset per unit, no unit outside its lane on an open road or
 * inside a fence, a half-width that never shrinks as the squad grows and
 * saturates at half a lane, a depth the camera can frame at five hundred, and a
 * clamp that still reaches both side lanes' centres.
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

/** The crowd's band: one lane less its inset, on the open road and under a
 *  fence alike, and what a one-argument caller gets. */
const OPEN = openRoadWidth();

/** The lane the column stands in. */
const LANE = balance.road.laneWidth;

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

  it('fills its lane in rows before it goes backward', () => {
    // A handful is one short line; the line fills the *lane* and only then does
    // a second one start behind it. That is the whole point of D42: the count
    // grows the column backward, never sideways across the road.
    expect(formationOffsets(3)).toHaveLength(3);
    // A squad opens a second row only once the first one is full, at every size.
    for (const count of [1, 3, 8, 12, 20, 60, 300, 500]) {
      const columns = formationColumns(count);
      expect(formationRows(count)).toBe(count <= columns ? 1 : formationRows(count));
      expect(formationRows(count) === 1).toBe(count <= columns);
    }
    // Five to seven abreast at every size worth drawing, and deep rather than
    // wide: a full squad is seven columns and seventy-odd rows.
    for (const count of [25, 100, 200, 500]) {
      expect(formationColumns(count)).toBeGreaterThanOrEqual(5);
      expect(formationColumns(count)).toBeLessThanOrEqual(7);
    }
    expect(formationColumns(500)).toBe(7);
    expect(formationRows(500)).toBeGreaterThan(60);
    for (const count of COUNTS) {
      if (count < 8) continue;
      const offsets = formationOffsets(count);
      // Never wider than the band it was built for...
      expect(maxAbs(offsets, 'x')).toBeLessThanOrEqual(OPEN / 2 + 1e-9);
      // ...and every unit stands at or behind the anchor, never in front of it.
      for (const offset of offsets) expect(offset.z).toBeLessThanOrEqual(0);
    }
  });

  it('is never handed more than one lane, on the open road or inside a fence', () => {
    // The whole of D42 in one assertion. The band the sim hands the crowd is
    // the lane wherever it stands, so no count and no stretch of road can put
    // a unit on a lane line, let alone across one. Driven through `Run`,
    // because `availableWidth` is what decides this and `formationOffsets`
    // honours whatever band it is given.
    const inset = balance.formation.laneInset;
    expect(OPEN).toBeCloseTo(LANE - 2 * inset, 9);
    const reachIn = (def: ReturnType<typeof level>): number => {
      const run = runOf(def);
      let worst = 0;
      for (let step = 0; step < 60 * 12; step++) {
        run.setTargetX(step % 240 < 120 ? 99 : -99);
        run.tick(1 / 60);
        const squad = run.state.squad;
        expect(squad.formationWidth).toBeLessThanOrEqual(OPEN + 1e-9);
        worst = Math.max(worst, maxAbs(formationOffsets(squad.count, squad.formationWidth), 'x'));
      }
      return worst;
    };
    for (const count of [1, 13, 200, 500]) {
      const open = reachIn(level({ startCount: count, rows: [] }));
      const walled = reachIn(
        level({ startCount: count, rows: [], walls: [wall(1, 8, 40), wall(-1, 45, 70)] }),
      );
      expect(open).toBeLessThanOrEqual(LANE / 2 - inset + 1e-9);
      expect(walled).toBeLessThanOrEqual(LANE / 2 - inset + 1e-9);
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

  it('narrows further still when it is handed less than a lane', () => {
    // Not the shipped geometry — no fence leaves the crowd less than its lane —
    // but the rule has to hold, or a band the column cannot fit in would put a
    // unit through a fence rather than pull the column in.
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
    expect(formationOffsets(37, 1.2)).toBe(formationOffsets(37, 1.2 + bucket / 4));
    expect(formationOffsets(37, 1.2)).not.toBe(formationOffsets(37, 1.2 + bucket));
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

  it('caches per balance, so a modified tuning is not served the shipped crowd', () => {
    // Every function here takes a `Balance`, so the cache has to be keyed by one
    // too: a flat cache would hand a run built on a tweaked balance whatever the
    // shipped one had already produced for that count and width — silently, and
    // only for the counts something else had asked about first.
    const tuned = structuredClone(balance);
    // Tighter, not looser: the band is a lane either way, so closer spacing is
    // what puts more of the squad in a row and widens the crowd inside it.
    tuned.formation.spacing.max = balance.formation.spacing.max / 2;
    tuned.formation.spacing.min = balance.formation.spacing.min / 2;

    // Shipped first, so a shared cache would already be warm for this key.
    const shipped = formationOffsets(9, OPEN);
    const wider = formationOffsets(9, OPEN, tuned);
    expect(unitSpacing(9, tuned)).toBeCloseTo(unitSpacing(9) / 2, 9);
    expect(maxAbs(wider, 'x')).toBeGreaterThan(maxAbs(shipped, 'x'));
    // And the shipped answer is still the shipped answer afterwards.
    expect(formationOffsets(9, OPEN)).toBe(shipped);
  });

  it('is deterministic: the same count always produces the same positions', () => {
    const first = formationOffsets(12).map((o) => `${o.x.toFixed(6)},${o.z.toFixed(6)}`);
    const second = formationOffsets(12).map((o) => `${o.x.toFixed(6)},${o.z.toFixed(6)}`);
    expect(second).toEqual(first);
  });
});

describe('unitSpacing', () => {
  it('shrinks as the crowd grows, from 0.42 down to 0.25', () => {
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

  it('saturates at half the lane band, whatever the count', () => {
    for (const width of [0.8, 1.2, OPEN]) {
      for (const count of COUNTS) {
        expect(halfWidth(count, width)).toBeLessThanOrEqual(width / 2 + 1e-9);
        expect(halfExtent(count, width)).toBeLessThanOrEqual(halfWidth(count, width));
      }
      // And it does saturate: a full squad fills whatever it is given.
      expect(halfWidth(500, width)).toBeCloseTo(width / 2, 9);
    }
    // On the road the crowd is handed a lane and nothing else, so the number
    // the sim compares enemy footprints against is half a lane from a handful
    // of units upward — and that is the whole of its width forever (D42).
    expect(halfWidth(500)).toBeCloseTo(OPEN / 2, 9);
    expect(halfWidth(4)).toBeCloseTo(OPEN / 2, 9);
  });

  it('never gets wider when the band gets narrower', () => {
    for (const count of [10, 60, 200, 500]) {
      let previous = halfWidth(count, 0.4);
      for (let width = 0.5; width <= OPEN; width += 0.1) {
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
  it('gives the open road one lane, not the road', () => {
    const run = runOf(level({ startCount: 40, rows: [] }));
    expect(availableWidth(run.state)).toBeCloseTo(OPEN, 9);
    expect(OPEN).toBeCloseTo(LANE - 2 * balance.formation.laneInset, 9);
    // The road is three times as wide and the crowd does not care (D42).
    expect(OPEN).toBeLessThan(balance.road.halfWidth);
  });

  it('is still one lane while the squad is inside a fence', () => {
    const run = runOf(level({ startCount: 40, rows: [], walls: [wall(1, 20, 40)] }));
    const open = availableWidth(run.state);
    // Driven left of the fence and then held there.
    for (let step = 0; step < 60 * 5; step++) {
      run.setTargetX(-99);
      run.tick(1 / 60);
      if (run.state.squad.z > 22) break;
    }
    const inside = availableWidth(run.state);
    // Phase B narrowed the crowd here — the band was the road, so half of it
    // was half a crowd. The column already fits its lane, so a fence changes
    // where it may stand and nothing about how wide it is.
    expect(inside).toBeCloseTo(open, 9);
    expect(halfWidth(40, inside)).toBeCloseTo(halfWidth(40, open), 9);
  });

  it('leaves a crowd walled on both sides its lane and no less', () => {
    const run = runOf(level({ startCount: 200, rows: [], walls: [wall(1, 5, 60), wall(-1, 5, 60)] }));
    for (let step = 0; step < 60 * 3; step++) {
      run.setTargetX(0);
      run.tick(1 / 60);
      if (run.state.squad.z > 8) break;
    }
    const width = availableWidth(run.state);
    expect(width).toBeCloseTo(OPEN, 9);
    expect(width).toBeLessThanOrEqual(LANE - 2 * balance.walls.margin + 1e-9);
    // The crowd stands inside the lane: no unit through either fence.
    const keep = wallKeep(200, width);
    expect(run.state.squad.x + halfExtent(200, width)).toBeLessThanOrEqual(
      LANE / 2 - balance.walls.margin + 1e-9,
    );
    expect(keep).toBeGreaterThan(balance.walls.margin);
  });

  it('leaves the middle lane reachable however wide the column stands', () => {
    // The keep-off is the margin plus the crowd's own reach, so two fences
    // could in principle close on the centre. They do not: at the widest the
    // column ever stands, the centre still has room either side of the lane's
    // middle, which is what a squad walled into a lane needs to steer at all.
    const line = LANE / 2;
    for (let count = 1; count <= balance.squad.maxCount; count++) {
      const keep = wallKeep(count, OPEN);
      expect(`${String(count)}: ${String(line - keep > 0.1)}`).toBe(`${String(count)}: true`);
    }
  });
});

describe('clampLimit', () => {
  it('is the road less the crowd, and reaches a side lane centre at every size', () => {
    const road = balance.road;
    expect(clampLimit(1)).toBeCloseTo(road.clampX, 9);
    // The widest the column ever stands is half a lane, so the taper bottoms
    // out at the road less that — 2.2 m — and never reaches the floor.
    expect(clampLimit(500)).toBeCloseTo(road.halfWidth - OPEN / 2, 9);
    for (let count = 0; count <= balance.squad.maxCount; count++) {
      const limit = clampLimit(count);
      expect(limit).toBeLessThanOrEqual(road.clampX + 1e-9);
      expect(limit).toBeGreaterThanOrEqual(road.clampMin - 1e-9);
      // The whole column can stand *on* a side gate, not merely in its lane
      // (D42), and it never hangs a unit over the verge doing it.
      expect(`${String(count)} reach: ${String(limit >= LANE - 1e-9)}`).toBe(
        `${String(count)} reach: true`,
      );
      expect(`${String(count)} verge: ${String(limit + halfWidth(count) <= road.halfWidth + 1e-9)}`)
        .toBe(`${String(count)} verge: true`);
    }
  });
});

describe('formationDepth', () => {
  it('grows the column backward and stays framable at five hundred', () => {
    expect(formationDepth(3)).toBe(0);
    expect(formationDepth(500)).toBeGreaterThan(formationDepth(100));
    // What the camera has to frame at a full squad. Written down because the
    // render track sizes its shots against it: 13.3 m at five hundred, where
    // Phase B's line across the road was 7.2 m (D42 asks for 12 to 14).
    expect(formationDepth(500)).toBeGreaterThan(12);
    expect(formationDepth(500)).toBeLessThan(14);
  });
});

describe('the crowd against the road', () => {
  it('keeps a full squad on the road it steers across', () => {
    // The taper is exact now the crowd is one lane wide: the outermost unit
    // stops *on* the verge at every count, with none of Phase B's overhang.
    const run = runOf(level({ startCount: 500, rows: [row(400, [null, null, null])] }));
    for (let step = 0; step < 60 * 3; step++) {
      run.setTargetX(99);
      run.tick(1 / 60);
    }
    const edge = run.state.squad.x + halfWidth(500, run.state.squad.formationWidth);
    expect(edge).toBeLessThanOrEqual(balance.road.halfWidth + 1e-9);
  });

  it('takes a full squad to either side lane centre', () => {
    // The side gates, with the whole column inside the lane it takes them in.
    for (const side of [-1, 1]) {
      const run = runOf(level({ startCount: 500, rows: [row(400, [null, null, null])] }));
      for (let step = 0; step < 60 * 3; step++) {
        run.setTargetX(side * LANE);
        run.tick(1 / 60);
      }
      const squad = run.state.squad;
      expect(squad.x).toBeCloseTo(side * LANE, 6);
      expect(Math.abs(squad.x) + halfExtent(500, squad.formationWidth)).toBeLessThanOrEqual(
        balance.road.halfWidth + 1e-9,
      );
    }
  });

  it('holds a full squad in the side lane of a walled stretch, clear of the fence', () => {
    // The fence between the middle and the right lane, entered on the right:
    // the column stands on the lane centre it was steering for and not one
    // unit of it is through the line.
    const line = LANE / 2;
    const run = runOf(level({ startCount: 500, rows: [], walls: [wall(1, 12, 60)] }));
    let held = 0;
    for (let step = 0; step < 60 * 8; step++) {
      run.setTargetX(LANE);
      run.tick(1 / 60);
      const squad = run.state.squad;
      if (squad.z < 12 || squad.z > 60) continue;
      held++;
      expect(`z ${squad.z.toFixed(1)} inside: ${String(squad.x - halfExtent(500, squad.formationWidth) >= line)}`)
        .toBe(`z ${squad.z.toFixed(1)} inside: true`);
    }
    expect(held).toBeGreaterThan(100);
    expect(run.state.squad.x).toBeCloseTo(LANE, 2);
  });
});
