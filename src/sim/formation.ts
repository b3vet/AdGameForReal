/**
 * Squad formation geometry.
 *
 * The squad is a point `(x, z)` plus a `count`; the visual arrangement and the
 * collision half-width are both derived from `count` and from the width of road
 * the squad has to stand in, so the two can never disagree. Render reads these
 * offsets to place unit instances; the sim reads `halfWidth` for gate and enemy
 * overlap and `halfExtent` for the fence it may not stand through.
 *
 * Milestone 5 (D37) replaces Milestone 2's phyllotaxis spiral. The spiral made
 * a disc, and a disc on a six-metre road reads as a blob however many units are
 * in it. The crowd now fills the width it is given in staggered rows — front
 * row centred on the anchor, further rows behind it, offset half a spacing so
 * the lines interlock — and grows *backward* once the width is full. A squad of
 * twenty-five is a few lines across the road; a squad of five hundred is the
 * same lines, thirty deep.
 *
 * Two consequences the rest of the sim leans on:
 *
 *   - `halfWidth` saturates at the available half-width, so the crowd can never
 *     be wider than the road it was handed. That is what finally keeps it off a
 *     fence (Milestone 4 deferred this: the clamp bounded the centre only).
 *   - The anchor is the *front* of the crowd rather than its centre, so contact
 *     and the boss meet the front line, and shots leave from the anchor
 *     backward rather than from up to four metres ahead of it.
 */

import type { RunState } from './types';
import { wallLimits } from './walls';
import type { WallLimits } from './walls';
import { balance as shipped } from '@/data';
import type { Balance } from '@/data/types';

export interface FormationOffset {
  x: number;
  z: number;
  /** Which row this unit stands in, 0 at the front. Render lags by it (D37). */
  row: number;
}

/**
 * How the crowd is laid out at one (count, width): the numbers every other
 * function here is derived from, computed once and cached with the offsets.
 */
interface Formation {
  offsets: ReadonlyArray<FormationOffset>;
  /** Units in a full row. */
  columns: number;
  rows: number;
  /** |x| of the outermost unit: what a fence has to clear. */
  extent: number;
  /** `extent` plus padding, saturated at the available half-width. */
  half: number;
  /** How far the last row stands behind the anchor. */
  depth: number;
  spacing: number;
}

const EMPTY_OFFSETS: ReadonlyArray<FormationOffset> = Object.freeze([]);

const EMPTY: Formation = Object.freeze({
  offsets: EMPTY_OFFSETS,
  columns: 0,
  rows: 0,
  extent: 0,
  half: 0,
  depth: 0,
  spacing: shipped.formation.spacing.max,
});

/**
 * Cached per count and per bucket of available width, because `update` asks for
 * this every frame and the sim must not allocate in hot loops (CLAUDE.md). A
 * run only ever visits a handful of widths — the open road, one side of a
 * fence, the strip between two of them — so the cache stays small in practice;
 * the cap is there so a pathological caller cannot grow it without bound.
 */
const cache = new Map<number, Formation>();
const CACHE_MAX = 4096;

/** Widths are bucketed into this many slots when they are folded into a key. */
const WIDTH_SLOTS = 1024;

/**
 * The width the open road gives the crowd: the road less `formation.inset` on
 * each side, which is the room the squad steers in. Also what a one-argument
 * caller gets — the stress scene and the dev fixtures have no state to read.
 */
export function openRoadWidth(balance: Balance = shipped): number {
  return bandRoom(2 * balance.road.halfWidth, balance);
}

/** The crowd's share of a band of road: the band less its inset, floored. */
function bandRoom(band: number, balance: Balance): number {
  const room = Math.max(balance.formation.minWidth, band - 2 * balance.formation.inset);
  // A band narrower than the floor — both boundaries walled at once — gets the
  // band itself: the crowd fills its lane rather than standing through a fence.
  return Math.min(room, Math.max(0, band));
}

/** Re-used by `availableWidth`: a wall lookup per step must not allocate. */
const wallScratch: WallLimits = { lo: 0, hi: 0, wall: -1 };

/**
 * How wide a band of road the crowd may fill right now.
 *
 * The band is the road, narrowed to the squad's own side of every wall in force
 * at its z — the approach zone included, so the crowd is already pulling in as
 * it arrives at a fence rather than snapping narrow at the first post. The
 * crowd takes all of that but `formation.inset` at each edge, which is the room
 * it needs to be *steered* inside its band: a crowd exactly as wide as its lane
 * has nowhere to go, and the lane is the only choice a walled stretch leaves.
 */
export function availableWidth(state: RunState, balance: Balance = shipped): number {
  const road = balance.road;
  const squad = state.squad;
  const walls = state.walls ?? [];
  const limits = wallLimits(walls, squad.z, squad.x, road.halfWidth, wallScratch, road.laneWidth);
  return bandRoom(limits.hi - limits.lo, balance);
}

/**
 * Distance between neighbouring units at this squad size, in meters: 0.42 for a
 * handful, 0.28 at `formation.spacingTo`. Render scales its unit meshes by the
 * same number so a dense crowd reads as dense rather than as overlapping boxes.
 *
 * Interpolated on `sqrt(count)` rather than on the count, so the spacing holds
 * near its wide end over the first dozens of units — the sizes most of a run is
 * played at — and tightens where the crowd is genuinely deep.
 */
export function unitSpacing(count: number, balance: Balance = shipped): number {
  const tuning = balance.formation;
  const n = Math.max(1, Math.floor(count));
  const to = Math.max(2, tuning.spacingTo);
  const t = Math.min(1, Math.max(0, (Math.sqrt(n) - 1) / (Math.sqrt(to) - 1)));
  return tuning.spacing.max + (tuning.spacing.min - tuning.spacing.max) * t;
}

/**
 * How many units stand shoulder to shoulder across `width`: the widest row is
 * `(columns - 1) * spacing` across, so this inverts that. Never more than the
 * squad has, so a handful of units is a short line and not a sparse one.
 */
function columnsFor(count: number, width: number, spacing: number): number {
  return Math.max(1, Math.min(count, Math.floor(width / spacing) + 1));
}

/**
 * Hexagonal packing: a full row holds `columns`, the row behind it holds one
 * fewer and sits half a spacing over, and both are centred on the anchor. That
 * is what makes the rows interlock — every unit looks down a gap rather than at
 * the back of the unit in front — while keeping the crowd symmetrical, which a
 * row simply shifted sideways would not.
 */
function build(count: number, width: number, balance: Balance): Formation {
  const tuning = balance.formation;
  const spacing = unitSpacing(count, balance);
  const columns = columnsFor(count, width, spacing);
  const short = Math.max(1, columns - 1);
  const rowGap = spacing * tuning.rowDepth;

  const offsets: FormationOffset[] = new Array<FormationOffset>(count);
  let extent = 0;
  let index = 0;
  let row = 0;
  while (index < count) {
    const capacity = row % 2 === 0 ? columns : short;
    // A short last row is centred on its own count, so the crowd never trails a
    // ragged edge on one side.
    const inRow = Math.min(capacity, count - index);
    for (let column = 0; column < inRow; column++) {
      const x = (column - (inRow - 1) / 2) * spacing;
      offsets[index + column] = { x, z: -row * rowGap, row };
      const reach = Math.abs(x);
      if (reach > extent) extent = reach;
    }
    index += inRow;
    row++;
  }

  const halfAvailable = width / 2;
  return {
    offsets: Object.freeze(offsets),
    columns,
    rows: row,
    extent: Math.min(extent, halfAvailable),
    half: Math.min(halfAvailable, extent + tuning.padding),
    depth: (row - 1) * rowGap,
    spacing,
  };
}

/**
 * The whole layout for one (count, width), cached. Width is bucketed at
 * `formation.widthBucket` so the approach to a wall — where the band narrows a
 * little every step — does not rebuild the crowd sixty times a second.
 */
function formationOf(count: number, width: number, balance: Balance): Formation {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return EMPTY;

  const bucket = balance.formation.widthBucket;
  const slot = Math.min(
    WIDTH_SLOTS - 1,
    Math.max(0, Math.round(Math.max(0, width) / Math.max(1e-3, bucket))),
  );
  const key = n * WIDTH_SLOTS + slot;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  // Rebuilt from the bucket's own width, not the caller's, or two callers a
  // millimetre apart would disagree about where unit 40 stands.
  const built = build(n, slot * bucket, balance);
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, built);
  return built;
}

/**
 * Formation offsets relative to the squad anchor, one per unit, front row
 * first. Non-integer or negative counts are floored and clamped to zero.
 *
 * The one-argument form is the whole road, for callers with no state to hand
 * (the stress scene, the dev fixtures).
 */
export function formationOffsets(
  count: number,
  width: number = openRoadWidth(),
  balance: Balance = shipped,
): ReadonlyArray<FormationOffset> {
  return formationOf(count, width, balance).offsets;
}

/**
 * Half the squad's footprint along `x`: the outermost unit plus padding, never
 * wider than the half-width it was given.
 *
 * The sim compares this against enemy footprints every step. It is monotonic in
 * `count` at a fixed width — a squad that got narrower by recruiting would let
 * blocks phase through the edge of the crowd — and monotonic in the width, so
 * a narrowing band can only ever pull the crowd in.
 */
export function halfWidth(
  count: number,
  width: number = openRoadWidth(),
  balance: Balance = shipped,
): number {
  return formationOf(count, width, balance).half;
}

/**
 * The outermost unit's own offset, with no padding: what may not cross a fence.
 *
 * The padding in `halfWidth` is a contact fudge, not a body, and charging it
 * against a wall would hold a single unit a quarter of a metre off a line it is
 * nowhere near.
 */
export function halfExtent(
  count: number,
  width: number = openRoadWidth(),
  balance: Balance = shipped,
): number {
  return formationOf(count, width, balance).extent;
}

/** Units in a full row; the row behind it holds one fewer. */
export function formationColumns(
  count: number,
  width: number = openRoadWidth(),
  balance: Balance = shipped,
): number {
  return formationOf(count, width, balance).columns;
}

/** How many rows deep the crowd stands. */
export function formationRows(
  count: number,
  width: number = openRoadWidth(),
  balance: Balance = shipped,
): number {
  return formationOf(count, width, balance).rows;
}

/**
 * How far from the centre line the squad's centre may stand: the road less the
 * crowd's own half-width, never wider than `road.clampX` and never tighter than
 * `road.clampMin` (D37). `Run` steers by it and the bots read it, so the two can
 * never disagree about where a squad of this size can actually get to.
 */
export function clampLimit(
  count: number,
  width: number = openRoadWidth(),
  balance: Balance = shipped,
): number {
  const road = balance.road;
  const tapered = road.halfWidth - halfWidth(count, width, balance);
  return Math.max(road.clampMin, Math.min(road.clampX, tapered));
}

/**
 * How far off a fence the squad's *centre* is held: the wall's margin plus the
 * crowd's own reach, so the outermost unit clears the line rather than the
 * anchor (see `wallLimits`).
 */
export function wallKeep(
  count: number,
  width: number = openRoadWidth(),
  balance: Balance = shipped,
): number {
  return balance.walls.margin + halfExtent(count, width, balance);
}

/** How far the back row stands behind the anchor, in metres. */
export function formationDepth(
  count: number,
  width: number = openRoadWidth(),
  balance: Balance = shipped,
): number {
  return formationOf(count, width, balance).depth;
}
