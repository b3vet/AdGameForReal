/**
 * Which lane a player walks into once the road to the row has been priced,
 * and which side of a fence it arrives on (document 31, 4.4).
 *
 * Greedy and the human ask the same two questions and differ in what they
 * see: greedy prices the whole board exactly, the human through its noisy
 * read and its reach past a panel (`./botHuman.ts`). The worst bot still ranks
 * panels by face value (`./botLanes.ts`), which is what "the worst gate" means.
 *
 * Split from `./botLanes.ts`, which the unpriced ranking and the fence
 * geometry already fill to the size rule (CLAUDE.md).
 */

import { anyLaneOpen, LANES, laneOpen, pickLane, gateAt } from './botLanes';
import type { PriceView } from './botPrice';
import { laneRatio } from './botScore';
import { lanes, priceLanes } from './botValue';
import type { LaneRead } from './botValue';
import { laneCenter, laneOf } from './lanes';
import type { Lane, RunState } from './types';
import type { WallLimits } from './walls';
import type { Balance } from '@/data/types';

/** No lane kept: the next pick is free. */
export const NO_PLAN = 9;

/** Where the stretch being priced ends: the row's panels, or the arena. */
export function rowZ(state: RunState, row: number): number {
  if (row >= 0) {
    for (const gate of state.gates) if (gate.rowIndex === row) return gate.z;
  }
  return state.arenaZ;
}

/**
 * The best lane `lanes.seen` offers among those `range` leaves open, keeping
 * `keep` unless another beats it by `bots.planMargin` of the squad. Ties go to
 * the better panel and then to the lane nearest the squad, so a bot does not
 * swerve for nothing.
 */
export function bestSeen(state: RunState, range: WallLimits, balance: Balance, keep: number): Lane {
  const narrowed = anyLaneOpen(range, balance);
  const here = laneOf(state.squad.x, balance.road.laneWidth);
  let best: Lane = here;
  let bestValue = -Infinity;
  let bestFace = -Infinity;
  let bestDistance = Infinity;
  let kept = -Infinity;
  for (const lane of LANES) {
    if (narrowed && !laneOpen(lane, range, balance)) continue;
    // Too late to get there: the lane underfoot stays a candidate whatever
    // the clock says, so there is always an answer.
    if (lane !== here && lanes.reachable[lane + 1] === 0) continue;
    const value = lanes.seen[lane + 1] ?? 0;
    const face = lanes.face[lane + 1] ?? 0;
    if (lane === keep) kept = value;
    const distance = Math.abs(laneCenter(lane, balance.road.laneWidth) - state.squad.x);
    const better =
      value > bestValue ||
      (value === bestValue && (face > bestFace || (face === bestFace && distance < bestDistance)));
    if (better) {
      best = lane;
      bestValue = value;
      bestFace = face;
      bestDistance = distance;
    }
  }
  const margin = balance.bots.planMargin * Math.max(1, state.squad.count);
  if (kept > -Infinity && kept >= bestValue - margin) return keep === -1 ? -1 : keep === 0 ? 0 : 1;
  return best;
}

/** Prices `row` and returns the lane to stand in for it. */
export function planLane(
  state: RunState,
  row: number,
  range: WallLimits,
  view: PriceView,
  read: LaneRead,
  balance: Balance,
  keep: number,
): Lane {
  priceLanes(state, row, rowZ(state, row), view, read, balance);
  return bestSeen(state, range, balance, keep);
}

/**
 * The cheapest lane to stand in until `row` is read: the road to it priced
 * with its panels left out, keeping `keep` unless another is clearly cheaper.
 */
export function planRoad(
  state: RunState,
  row: number,
  range: WallLimits,
  view: PriceView,
  read: LaneRead,
  balance: Balance,
  keep: number,
): Lane {
  priceLanes(state, -1, rowZ(state, row), view, read, balance);
  return bestSeen(state, range, balance, keep);
}

const half: WallLimits = { lo: 0, hi: 0, wall: -1 };
const SIDES: readonly number[] = [-1, 1];

/**
 * Which half of the road to arrive on, given a fence at `line` before the row,
 * valued on the priced lanes: the best lane each half leaves open, times the
 * face value of the row the stretch guards when that is a later one. The
 * river and the blocks the old side choice counted separately are in the
 * price now, which is also what makes a fence that commits the column past a
 * toll cost something (document 31, 3.6).
 */
export function pricedSide(
  state: RunState,
  row: number,
  guarded: number,
  range: WallLimits,
  line: number,
  view: PriceView,
  read: LaneRead,
  balance: Balance,
): number {
  priceLanes(state, row, rowZ(state, row), view, read, balance);
  const margin = balance.walls.margin;
  const here = state.squad.x < line ? -1 : 1;
  let best = 0;
  let bestScore = -Infinity;
  for (const side of SIDES) {
    half.lo = side < 0 ? range.lo : Math.max(range.lo, line + margin);
    half.hi = side < 0 ? Math.min(range.hi, line - margin) : range.hi;
    half.wall = range.wall;
    if (half.lo > half.hi) continue;
    let score = -Infinity;
    const narrowed = anyLaneOpen(half, balance);
    for (const lane of LANES) {
      if (narrowed && !laneOpen(lane, half, balance)) continue;
      score = Math.max(score, lanes.seen[lane + 1] ?? 0);
    }
    if (guarded !== row && guarded >= 0) {
      score *= laneRatio(gateAt(state, guarded, pickLane(state, guarded, 1, half, balance)), state);
    }
    if (score > bestScore || (score === bestScore && side === here)) {
      bestScore = score;
      best = side;
    }
  }
  return best;
}
