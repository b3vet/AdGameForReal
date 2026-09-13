/**
 * Scripted players. Used by the balance tests and by `?bot=` in the app.
 *
 *   greedy — best expected count on the next unpassed row; between rows it
 *            covers the river, and steps out of a block already on its way
 *   random — a random lane per row
 *   worst  — the worst gate on the next row
 *
 * A bot is a pure function of the state plus its own seeded stream, so a bot
 * run is as reproducible as the sim it drives.
 */

import { laneRatio, laneScore } from './botScore';
import { bestDodge, bestStreamStand, stand } from './botStand';
import { clampLimit, wallKeep } from './formation';
import { laneCenter } from './lanes';
import { mulberry32 } from './rng';
import type { GateState, Lane, RunState } from './types';
import { clampToWalls, wallAhead, wallLimits, wallX } from './walls';
import type { WallDef, WallLimits } from './walls';
import { balance as shipped } from '@/data';
import type { Balance } from '@/data/types';

export type BotKind = 'greedy' | 'random' | 'worst';

const LANES: readonly Lane[] = [-1, 0, 1];

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
function reachable(state: RunState, balance: Balance): WallLimits {
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
function laneOpen(lane: Lane, range: WallLimits, balance: Balance): boolean {
  const edge = balance.road.laneWidth / 2;
  if (lane < 0) return range.lo <= -edge + 1e-9;
  if (lane > 0) return range.hi >= edge - 1e-9;
  return range.lo <= edge + 1e-9 && range.hi >= -edge - 1e-9;
}

/** The same question for the whole road. An index loop, not `some`: a callback
 *  is a closure, and a bot is asked for a lane on every step (CLAUDE.md). */
function anyLaneOpen(range: WallLimits, balance: Balance): boolean {
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
function guardedRow(state: RunState, wall: WallDef, fallback: number): number {
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
function nextGateRow(state: RunState): number {
  let best = -1;
  for (const gate of state.gates) {
    if (gate.passed) continue;
    if (best < 0 || gate.rowIndex < best) best = gate.rowIndex;
  }
  return best;
}

/** Distance from the squad to a row, or Infinity when the row has no gates. */
function distanceToRow(state: RunState, rowIndex: number): number {
  for (const gate of state.gates) {
    if (gate.rowIndex === rowIndex) return gate.z - state.squad.z;
  }
  return Infinity;
}

/**
 * Picks a lane on `rowIndex`. `sign` is +1 for the best gate, -1 for the worst.
 * Ties go to the lane nearest the squad, so a bot does not swerve for nothing.
 *
 * `range` is what the walls leave open (D32). Inside a wall the far lanes are
 * simply not candidates, which is how a bot "chooses the side": greedy takes
 * the best lane it can still reach, the worst bot the worst one. The range is
 * ignored when it would rule every lane out, which cannot happen with the
 * shipped geometry but would otherwise turn a tuning slip into a bot that
 * refuses to steer.
 */
function gateAt(state: RunState, rowIndex: number, lane: Lane): GateState | null {
  for (const candidate of state.gates) {
    if (candidate.rowIndex === rowIndex && candidate.lane === lane && !candidate.passed) {
      return candidate;
    }
  }
  return null;
}

function pickLane(
  state: RunState,
  rowIndex: number,
  sign: number,
  range: WallLimits,
  balance: Balance,
): Lane {
  let bestLane: Lane = 0;
  let bestScore = -Infinity;
  let bestDistance = Infinity;
  const narrowed = anyLaneOpen(range, balance);

  for (const lane of LANES) {
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

/** The half of the road on one side of a fence, so each can be scored. */
const half: WallLimits = { lo: 0, hi: 0, wall: -1 };

/** The two of them, as a constant: a literal here would allocate every step. */
const SIDES: readonly number[] = [-1, 1];

/**
 * Narrows `range` to the half of the road the squad should arrive on, given a
 * fence at `line` between here and the gate row.
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
 */
function chooseSide(
  state: RunState,
  row: number,
  guarded: number,
  sign: number,
  range: WallLimits,
  line: number,
  balance: Balance,
): void {
  // The bare margin, not the crowd's own `wallKeep`: this asks which half of
  // the road the squad *wants*, and by the time it is inside the stretch its
  // formation has narrowed into that half, so a crowd that is too wide to sit
  // beside the fence right now will fit perfectly well once it is committed.
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
    if (score > bestScore) {
      bestScore = score;
      best = side;
    }
  }

  if (best < 0) range.hi = Math.min(range.hi, line - margin);
  else if (best > 0) range.lo = Math.max(range.lo, line + margin);
}

/**
 * Returns a policy: given the current state, the `targetX` the bot wants.
 *
 * `balance` is the tuning the run it steers was built on, and every geometry
 * question the policy asks — the crowd's own half-width, the clamp it leaves,
 * how far off a fence the centre is held, where the lanes are — is asked
 * against it. Before Milestone 5 Phase F the bot read the shipped object while
 * its `Run` read its own, so a run on a modified balance was steered by a bot
 * that believed in a different road.
 */
export function createBot(
  kind: BotKind,
  seed: number,
  balance: Balance = shipped,
): (state: RunState) => number {
  // Constructed here (not per call) so each bot's random stream is deterministic
  // across a whole run, which is what the balance tests rely on.
  const rng = mulberry32(seed);

  if (kind === 'random') {
    let lastRow = -2;
    let lane: Lane = 0;
    return function decide(state: RunState): number {
      const row = nextGateRow(state);
      if (row !== lastRow) {
        lastRow = row;
        lane = LANES[Math.min(2, Math.floor(rng() * 3))] ?? 0;
      }
      return laneCenter(lane, balance.road.laneWidth);
    };
  }

  const sign = kind === 'greedy' ? 1 : -1;
  return function decide(state: RunState): number {
    const row = nextGateRow(state);
    const distance = row >= 0 ? distanceToRow(state, row) : Infinity;
    const range = reachable(state, balance);

    // A wall between here and the row settles which half of the road the squad
    // arrives on, so the *side* has to be chosen before the fence rather than at
    // `gateCommitDistance` (D32): the stretch is up to twenty metres long, it
    // holds all the way to the row it guards, and there is no crossing it once
    // inside. The choice narrows the range rather than becoming the answer —
    // the bot still covers the river and still picks a lane, it just does both
    // on the half it has decided to arrive on.
    const wall =
      row < 0
        ? null
        : wallAhead(state.walls ?? [], state.squad.z, state.squad.z + distance, balance);
    if (
      wall !== null &&
      wall.zStart - balance.walls.approach - state.squad.z <= balance.bots.wallCommitDistance
    ) {
      chooseSide(
        state,
        row,
        guardedRow(state, wall, row),
        sign,
        range,
        wallX(wall.boundary, balance.road.laneWidth),
        balance,
      );
    }

    const committed = row >= 0 && distance <= balance.bots.gateCommitDistance;

    if (kind === 'greedy' && !committed) {
      // Between rows the squad's job is the river, not the next panel — but
      // only as far as the wall it is already inside allows.
      if (bestStreamStand(state, range, balance)) return stand.x;
      // Nothing streaming, and a block already on its way: step out of it.
      // Through Phase B this held position and shot instead, because the crowd
      // was wider than the lanes and there was nowhere a block was not; a
      // lane-wide column (D42) fits beside one, so the cheapest place it can
      // still reach is worth more than the half-second of extra fire.
      if (bestDodge(state, range, balance)) return stand.x;
    }

    // No gates left: hold station and shoot whatever is in front.
    if (row < 0) return clampToWalls(state.squad.x, range);
    return clampToWalls(
      laneCenter(pickLane(state, row, sign, range, balance), balance.road.laneWidth),
      range,
    );
  };
}
