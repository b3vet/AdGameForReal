/**
 * Lane walls (D32): a low fence along one lane boundary that the squad cannot
 * cross. Shots fly over it and streams ignore it — it constrains exactly one
 * thing, which is where the crowd may stand while it runs past.
 *
 * A wall stands on a lane *boundary*, not in a lane: `boundary` is -1 or +1 and
 * the fence itself is at `x = boundary * laneWidth / 2`, so a `+1` wall divides
 * the middle lane from the right one. While the squad is inside the stretch its
 * clamp loses the far side, and the side it keeps is the side its centre was on
 * when it arrived — which is what the two-metre approach zone is for: it starts
 * clamping before the fence proper, so a squad straddling the line is pushed
 * off it rather than cut in half by it.
 *
 * The generator half lives here too, because where a wall may stand is the same
 * geometry: a stretch runs up to the gate row it guards and stops half a metre
 * short of it (`walls.gateGap`) so the choice of side is settled before the
 * panels, it never reaches another gate row or the boss arena, and from
 * `walls.bothFromLevel` it may take both boundaries at once where a horde pours
 * down two lanes.
 */

import { shuffle } from './gateGen';
import { mulberry32 } from './rng';
import type { RowDef } from './rows';
import { balance } from '@/data';

/** The two boundaries of the middle lane. */
export type WallBoundary = -1 | 1;

export interface WallDef {
  boundary: WallBoundary;
  zStart: number;
  zEnd: number;
}

/** Mixed into the level seed, so walls cannot re-roll the campaign's levels. */
const WALL_STREAM_SALT = 0x7a_11_5e_ed;

/** Where the fence itself stands: the boundary between two lanes. */
export function wallX(boundary: WallBoundary, laneWidth = balance.road.laneWidth): number {
  return (boundary * laneWidth) / 2;
}

/**
 * True while the squad at `z` is inside the wall: the approach zone in front of
 * it, the fence itself, and the half-metre past its far end.
 *
 * That last stretch is what makes a wall a decision (Milestone 4 Phase C). The
 * fence stops `walls.gateGap` short of the gate row it guards so it does not
 * stand inside the panels, and the clamp runs on to the row — because half a
 * metre of road is 0.8 m of lane at `squad.lateralSpeed` over `squad.runSpeed`,
 * and the squad is held only `walls.margin` off the boundary, so a released
 * squad crossed it with room to spare and the side it had been held on meant
 * nothing at all.
 */
export function wallHolds(
  wall: WallDef,
  z: number,
  approach = balance.walls.approach,
  release = balance.walls.gateGap,
): boolean {
  return z >= wall.zStart - approach && z <= wall.zEnd + release;
}

/** The x range a squad may stand in. Re-used by the caller: never allocated per step. */
export interface WallLimits {
  lo: number;
  hi: number;
  /** Index of the wall that narrowed the range last, or -1. */
  wall: number;
}

/**
 * Narrows `[-limit, limit]` to the side of every wall in force at `z`.
 *
 * The side is read off `x`, the squad's centre, so a squad that entered on the
 * right stays on the right. A margin keeps the centre off the boundary line
 * itself: `laneOf` puts a point exactly on the line in the *side* lane, so a
 * squad clamped to the line would still count as having crossed it.
 */
export function wallLimits(
  walls: readonly WallDef[],
  z: number,
  x: number,
  limit: number,
  out: WallLimits,
  laneWidth = balance.road.laneWidth,
): WallLimits {
  out.lo = -limit;
  out.hi = limit;
  out.wall = -1;
  if (walls.length === 0) return out;

  const approach = balance.walls.approach;
  const margin = balance.walls.margin;
  const release = balance.walls.gateGap;
  for (let i = 0; i < walls.length; i++) {
    const wall = walls[i];
    if (wall === undefined || !wallHolds(wall, z, approach, release)) continue;
    const line = wallX(wall.boundary, laneWidth);
    if (x < line) {
      if (line - margin < out.hi) {
        out.hi = line - margin;
        out.wall = i;
      }
    } else if (line + margin > out.lo) {
      out.lo = line + margin;
      out.wall = i;
    }
  }
  return out;
}

/**
 * `x` put back inside the range. A range that came out empty — a squad that
 * grew past its own taper while standing outside a wall — resolves to the
 * taper, because a crowd standing in the grass is worse than one that slipped
 * a fence by five centimetres.
 */
export function clampToWalls(x: number, limits: WallLimits): number {
  return Math.min(Math.max(x, limits.lo), limits.hi);
}

/**
 * The first wall the squad has not yet entered that stands between it and `toZ`.
 * What the bots read: past this point the choice of side is made for them.
 */
export function wallAhead(
  walls: readonly WallDef[],
  fromZ: number,
  toZ: number,
): WallDef | null {
  const approach = balance.walls.approach;
  let best: WallDef | null = null;
  for (const wall of walls) {
    const gate = wall.zStart - approach;
    if (gate <= fromZ || gate > toZ) continue;
    if (best === null || gate < best.zStart - approach) best = wall;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

/** Rows that carry at least one gate, by index, with their `z`. */
function gateRowZs(rows: readonly RowDef[]): Array<{ index: number; z: number }> {
  const out: Array<{ index: number; z: number }> = [];
  rows.forEach((row, index) => {
    if (row.gates.some((gate) => gate !== null)) out.push({ index, z: row.z });
  });
  return out;
}

/** True when a horde (two streams at once) stands inside `[from, to]`. */
function hordeInside(rows: readonly RowDef[], from: number, to: number): boolean {
  for (const row of rows) {
    if ((row.streams ?? []).length < 2) continue;
    if (row.z >= from && row.z <= to) return true;
  }
  return false;
}

/**
 * Walls for one level: a stretch running up to some gate rows, so the player
 * has to pick which half of the road they will arrive on.
 *
 * The stretch ends `walls.gateGap` short of the row it guards — half a metre,
 * close enough that the fence visibly runs into the gate panels — and starts no
 * earlier than `walls.gateClearance` past the gate row behind it, so a wall
 * covers no other row: every row is approachable from both of its sides until
 * the wall that guards it begins, and then the choice is made.
 *
 * The gap used to be the full clearance, and two metres is not a commitment:
 * the squad steers at `squad.lateralSpeed` while the road runs past at
 * `squad.runSpeed`, so it covers 1.6 m of lane for every metre of road and
 * could cross the whole width in the clear stretch. Half a metre leaves it
 * 0.8 m, less than the metre it would need to change lanes.
 */
export function generateWalls(
  rows: readonly RowDef[],
  index: number,
  seed: number,
  arenaZ: number,
  wallRows: number,
): WallDef[] {
  const tuning = balance.walls;
  const wanted = Math.max(0, Math.round(wallRows));
  if (index < tuning.fromLevel || wanted <= 0) return [];

  const rng = mulberry32((seed ^ WALL_STREAM_SALT) >>> 0);
  const gateRows = gateRowZs(rows);
  // Never the opening rows: the squad is a handful of units there, and a wall
  // that keeps it off a stream costs a share of everything it has (measured on
  // level 7 seed 3, where a wall at row 2 turned a clear into a wipe).
  const candidates = gateRows.filter((row) => row.index >= tuning.fromRow);
  shuffle(rng, candidates);

  const walls: WallDef[] = [];
  for (const candidate of candidates) {
    if (walls.length >= wanted) break;

    const previous = gateRows.filter((row) => row.z < candidate.z).pop();
    const floor = previous === undefined ? 0 : previous.z + tuning.gateClearance;
    const zEnd = Math.min(candidate.z - tuning.gateGap, arenaZ - tuning.gateClearance);
    const length = tuning.length.min + rng() * (tuning.length.max - tuning.length.min);
    const zStart = Math.max(zEnd - length, floor);
    if (zEnd - zStart < tuning.minLength) continue;

    const boundary: WallBoundary = rng() < 0.5 ? -1 : 1;
    walls.push({ boundary, zStart, zEnd });
    // A horde pours down two lanes at once; walling both boundaries over it
    // means the squad answers one lane and eats the other (D32, the plan's
    // "on horde rows both boundaries may be walled").
    if (index >= tuning.bothFromLevel && hordeInside(rows, zStart, zEnd)) {
      walls.push({ boundary: (-boundary) as WallBoundary, zStart, zEnd });
    }
  }

  walls.sort((a, b) => a.zStart - b.zStart || a.boundary - b.boundary);
  return walls;
}
