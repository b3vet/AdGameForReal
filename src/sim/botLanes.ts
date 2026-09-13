/**
 * Which lane a scripted player can reach, and which one it wants.
 *
 * Split out of `./bots.ts` in Milestone 6 for the file-size rule (CLAUDE.md)
 * when the human bot arrived: greedy, the worst bot and the human all ask the
 * same three questions — what does the clamp leave open, which lane is best on
 * the next row, and which side of a fence should we arrive on — and only the
 * answers they act on differ.
 *
 * Everything here is allocation-free: a bot is asked for a lane every step, so
 * the ranges and the scratch objects are module level and overwritten.
 */

import { laneRatio, laneScore } from './botScore';
import { bestStreamStand, stand } from './botStand';
import { clampLimit, wallKeep } from './formation';
import { laneCenter } from './lanes';
import type { GateState, Lane, RunState } from './types';
import { wallLimits } from './walls';
import type { WallDef, WallLimits } from './walls';
import type { Balance } from '@/data/types';

export const LANES: readonly Lane[] = [-1, 0, 1];

/** `pickLane`'s "exclude nothing": no lane is ever this. */
const NO_SKIP = 9;

/**
 * The x range the squad may steer to right now, walls included (D32). Re-used
 * rather than re-made: a bot is asked for a lane every step.
 */
const limits: WallLimits = { lo: 0, hi: 0, wall: -1 };

/**
 * Where the squad could actually steer to this step: the same clamp `Run` uses,
 * walls included (D32, D37). A bot that read the plain `road.clampX` instead
 * would believe it could reach a lane centre its own crowd's width keeps it
 * from, and would sail past a gate row still asking for it.
 */
export function reachable(state: RunState, balance: Balance): WallLimits {
  const squad = state.squad;
  return wallLimits(
    state.walls ?? [],
    squad.z,
    squad.x,
    clampLimit(squad.count, squad.formationWidth, balance),
    limits,
    balance,
    wallKeep(squad.count, squad.formationWidth, balance),
  );
}

/**
 * True when a lane can still be reached from where the squad stands.
 *
 * A *lane*, not its centre. The open-road clamp reaches both side lane centres
 * again now the crowd is one lane wide (D42), but a fence does not: it holds
 * the column's centre `wallKeep` off the boundary, which is most of a lane at
 * five hundred units. What decides which gate a squad takes is `laneOf`, so
 * that is what this asks — whether the range reaches any `x` the lane claims.
 */
export function laneOpen(lane: Lane, range: WallLimits, balance: Balance): boolean {
  const edge = balance.road.laneWidth / 2;
  if (lane < 0) return range.lo <= -edge + 1e-9;
  if (lane > 0) return range.hi >= edge - 1e-9;
  return range.lo <= edge + 1e-9 && range.hi >= -edge - 1e-9;
}

/** The same question for the whole road. An index loop, not `some`: a callback
 *  is a closure, and a bot is asked for a lane on every step (CLAUDE.md). */
export function anyLaneOpen(range: WallLimits, balance: Balance): boolean {
  for (let i = 0; i < LANES.length; i++) {
    const lane = LANES[i];
    if (lane !== undefined && laneOpen(lane, range, balance)) return true;
  }
  return false;
}

/**
 * The gate row a wall commits the squad for: the first unpassed one at or past
 * its far end. That is the row the fence is *about* — it stops `walls.gateGap`
 * short of it and the clamp holds all the way to it — and it is not always the
 * next row, because a stretch may begin within a metre of the row behind it.
 *
 * Milestone 5: a bot that chose its side against the nearer row instead could
 * take a small `add` on one side and then watch a x3 multiplier go past on the
 * other, which is exactly how the levels that kept the walls also kept losing
 * (level 11 seed 2 and its neighbours).
 */
export function guardedRow(state: RunState, wall: WallDef, fallback: number): number {
  let best = -1;
  let bestZ = Infinity;
  for (const gate of state.gates) {
    if (gate.passed || gate.z < wall.zEnd) continue;
    if (gate.z < bestZ) {
      bestZ = gate.z;
      best = gate.rowIndex;
    }
  }
  return best < 0 ? fallback : best;
}

/** Lowest row index that still has an unpassed gate, or -1 once they are gone. */
export function nextGateRow(state: RunState): number {
  let best = -1;
  for (const gate of state.gates) {
    if (gate.passed) continue;
    if (best < 0 || gate.rowIndex < best) best = gate.rowIndex;
  }
  return best;
}

/** Distance from the squad to a row, or Infinity when the row has no gates. */
export function distanceToRow(state: RunState, rowIndex: number): number {
  for (const gate of state.gates) {
    if (gate.rowIndex === rowIndex) return gate.z - state.squad.z;
  }
  return Infinity;
}

export function gateAt(state: RunState, rowIndex: number, lane: Lane): GateState | null {
  for (const candidate of state.gates) {
    if (candidate.rowIndex === rowIndex && candidate.lane === lane && !candidate.passed) {
      return candidate;
    }
  }
  return null;
}

/**
 * Best lane on `rowIndex`, ignoring `skip`. `sign` is +1 for the best gate, -1
 * for the worst. Ties go to the lane nearest the squad, so a bot does not swerve
 * for nothing. Returns null when the range leaves no candidate at all.
 *
 * `range` is what the walls leave open (D32). Inside a wall the far lanes are
 * simply not candidates, which is how a bot "chooses the side": greedy takes
 * the best lane it can still reach, the worst bot the worst one. The range is
 * ignored when it would rule every lane out, which cannot happen with the
 * shipped geometry but would otherwise turn a tuning slip into a bot that
 * refuses to steer.
 */
function rankedLane(
  state: RunState,
  rowIndex: number,
  sign: number,
  range: WallLimits,
  balance: Balance,
  skip: number,
): Lane | null {
  let bestLane: Lane | null = null;
  let bestScore = -Infinity;
  let bestDistance = Infinity;
  const narrowed = anyLaneOpen(range, balance);

  for (const lane of LANES) {
    if (lane === skip) continue;
    if (narrowed && !laneOpen(lane, range, balance)) continue;
    const gate = gateAt(state, rowIndex, lane);
    const score = sign * laneScore(gate, state);
    const distance = Math.abs(laneCenter(lane, balance.road.laneWidth) - state.squad.x);
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      bestScore = score;
      bestDistance = distance;
      bestLane = lane;
    }
  }
  return bestLane;
}

/** Picks a lane on `rowIndex`; the middle one when the range rules every lane out. */
export function pickLane(
  state: RunState,
  rowIndex: number,
  sign: number,
  range: WallLimits,
  balance: Balance,
): Lane {
  return rankedLane(state, rowIndex, sign, range, balance, NO_SKIP) ?? 0;
}

/**
 * The lane a player takes when they read the row wrong: the next best one.
 *
 * Falls back to `best` when there is no second candidate — a walled stretch can
 * leave exactly one lane open, and a bot that "mis-picked" into a fence would be
 * making a mistake the road does not offer.
 */
export function secondLane(
  state: RunState,
  rowIndex: number,
  sign: number,
  range: WallLimits,
  balance: Balance,
  best: Lane,
): Lane {
  return rankedLane(state, rowIndex, sign, range, balance, best) ?? best;
}

/** The half of the road on one side of a fence, so each can be scored. */
const half: WallLimits = { lo: 0, hi: 0, wall: -1 };

/** The two of them, as a constant: a literal here would allocate every step. */
const SIDES: readonly number[] = [-1, 1];

/**
 * Which half of the road the squad should arrive on, given a fence at `line`
 * between here and the gate row. Returns a `SIDES` value; `narrowToSide` is
 * what turns it into a range the rest of the policy steers inside.
 *
 * Both halves are valued the same way and in the same unit — soldiers. A half
 * is worth the best gate it can still reach plus the stream bodies standing in
 * it lets the crowd shoot, because a body that walks past costs exactly one
 * soldier (`Run.onLeak`). That second term is the whole point: the gate is a
 * one-off and the river runs for the length of the stretch, so a bot that
 * crossed for a fat `add` and then watched a horde walk down the half it had
 * left behind lost far more than it gained. Levels 16 to 20, whose streams are
 * the biggest in the campaign, went from three clears in five to five once the
 * side was chosen on both terms rather than on the panel alone.
 *
 * `guarded` is the row the stretch commits the squad for; pass `row` to value
 * the near row alone, which is what a player with no lookahead past the next
 * row sees.
 */
export function chooseSide(
  state: RunState,
  row: number,
  guarded: number,
  sign: number,
  range: WallLimits,
  line: number,
  balance: Balance,
): number {
  // The bare margin, not the crowd's own `wallKeep`: this asks which half of
  // the road the squad *wants*, and a crowd too wide to sit beside the fence
  // right now must still be able to score the half it is about to commit to.
  // Where it actually stands once it has chosen is `narrowToSide`'s business.
  const margin = balance.walls.margin;
  let best = 0;
  let bestScore = -Infinity;

  for (const side of SIDES) {
    half.lo = side < 0 ? range.lo : Math.max(range.lo, line + margin);
    half.hi = side < 0 ? Math.min(range.hi, line - margin) : range.hi;
    half.wall = range.wall;
    // A fence the squad is already inside can leave one half unreachable.
    if (half.lo > half.hi) continue;

    // Both rows the fence speaks for: the one the squad is about to cross — a
    // stretch may begin on top of it — and the one the stretch guards, which is
    // the row the commitment is really about. Scoring only one of them loses a
    // multiplier on the other, whichever one it is (level 9 seed 2 lost a x3 on
    // the near row, level 11 seed 2 a x3 on the far one).
    const lane = pickLane(state, row, sign, half, balance);
    let ratio = laneRatio(gateAt(state, row, lane), state);
    if (guarded !== row && guarded >= 0) {
      const far = pickLane(state, guarded, sign, half, balance);
      ratio *= laneRatio(gateAt(state, guarded, far), state);
    }
    let score = sign * state.squad.count * ratio;
    // The worst bot is asked for the worst half, so the river it gives up is
    // added rather than subtracted for it: `sign` flips both terms together.
    if (bestStreamStand(state, half, balance)) score += sign * stand.bodies;
    // A tie keeps the squad on the side it is already on. Two empty halves
    // score the same, and crossing the road for nothing is how a bot ends up
    // straddling the line the moment the stretch starts to hold it.
    if (score > bestScore || (score === bestScore && side === sideOf(state, line))) {
      bestScore = score;
      best = side;
    }
  }

  return best;
}

/**
 * Narrows `range` to `side` of `line`, far enough off it that the whole column
 * is inside (D44).
 *
 * Held off by the crowd's own reach rather than by the bare `walls.margin`: a
 * centre parked a margin from the fence has most of its column standing through
 * it, and from Milestone 6 the units on the far side when the stretch starts to
 * hold are cut off as stragglers rather than tidied up by the clamp — so "on
 * the right side" now means the whole column, not the anchor.
 */
export function narrowToSide(
  state: RunState,
  range: WallLimits,
  line: number,
  side: number,
  balance: Balance,
): void {
  const margin = balance.walls.margin;
  const keep = wallKeep(state.squad.count, state.squad.formationWidth, balance);
  if (side < 0) range.hi = Math.min(range.hi, holdOff(range, line, -1, keep, margin));
  else if (side > 0) range.lo = Math.max(range.lo, holdOff(range, line, 1, keep, margin));
}

/** Which side of `line` the squad's centre stands on, as a `SIDES` value. */
function sideOf(state: RunState, line: number): number {
  return state.squad.x < line ? -1 : 1;
}

/**
 * Where the squad should sit to keep its whole column on `side` of `line`:
 * `keep` off it, or the bare margin when the range is too tight for that. A
 * crowd wider than the lane it is being sent into still has to be sent
 * somewhere, and half a column inside beats a bot that stops steering.
 */
function holdOff(
  range: WallLimits,
  line: number,
  side: number,
  keep: number,
  margin: number,
): number {
  const wanted = line + side * keep;
  if (side < 0) return wanted >= range.lo ? wanted : Math.max(line - margin, range.lo);
  return wanted <= range.hi ? wanted : Math.min(line + margin, range.hi);
}
