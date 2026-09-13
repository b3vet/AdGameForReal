/**
 * The human-like bot (D45): the reference the difficulty bands are measured on.
 *
 * Greedy is a fair-play *ceiling* — it sees the whole board every step, moves
 * the instant the board changes, and is never on the wrong side of a fence. A
 * campaign tuned against it is tuned against nobody, which is how Milestone 5
 * shipped levels the owner read as too easy while greedy cleared 100 of 100.
 *
 * This one plays the same game through a thumb:
 *
 *   reaction    it steers on the board as it was `reactionSteps` ago, so a gate
 *               that changes value, a block that turns toward it or a fence
 *               coming up all reach it a quarter of a second late;
 *   swipe       the finger it steers with moves at `swipeSpeed`, so a lane
 *               change is a movement with a duration rather than a jump;
 *   lane        it reads the row right `laneAccuracy` of the time and takes the
 *               second-best lane the rest of the time, decided once per row —
 *               a player commits to a panel, they do not dither in front of it;
 *   lookahead   it values the next row only. The row behind a fence is a row it
 *               has not looked at yet;
 *   walls       it notices a stretch only when the approach zone is within
 *               `wallReach`, which is about as far ahead as a player watching
 *               the crowd rather than the horizon sees it. A late crossing
 *               leaves part of the column outside the fence, and from D44 those
 *               units are cut off as stragglers — the bot does not model that,
 *               it simply moves late and pays for it.
 *
 * Everything else — which lane is worth what, where to stand in a river, how to
 * step out of a block — is greedy's, because a decent player does know all of
 * that. The difference the bands are measured against is the hand, not the head.
 */

import {
  chooseSide,
  distanceToRow,
  narrowToSide,
  nextGateRow,
  pickLane,
  reachable,
  secondLane,
} from './botLanes';
import { bestDodge, bestStreamStand, stand } from './botStand';
import { laneCenter } from './lanes';
import type { Rng } from './rng';
import type { Lane, RunState } from './types';
import { clampToWalls, wallX } from './walls';
import type { WallLimits } from './walls';
import type { Balance } from '@/data/types';

/**
 * The sim only ever integrates at 1/60 s (`Run.FIXED_DT`) and a bot is asked for
 * a target once per step, so a delay in steps is exact and a speed in metres per
 * second converts to metres per step here rather than at every call site.
 */
const SIM_STEP = 1 / 60;

/** Greedy's sign: the human wants the best gate too, it just misreads which. */
const BEST = 1;

export function createHumanBot(rng: Rng, balance: Balance): (state: RunState) => number {
  const tuning = balance.bots.human;
  // One allocation per bot, none per step (CLAUDE.md): the observation from
  // `reactionSteps` ago plus the one being made now.
  const delayed = new Float64Array(Math.max(1, Math.round(tuning.reactionSteps) + 1));
  const swipe = tuning.swipeSpeed * SIM_STEP;

  let head = 0;
  let primed = false;
  /** Where the thumb is: the bot's own target, which moves at `swipeSpeed`. */
  let finger = 0;
  /** The row the lane roll was made for, and how it came out. */
  let rolledRow = -2;
  let readsRowRight = true;

  function laneFor(state: RunState, row: number, range: WallLimits): Lane {
    if (row !== rolledRow) {
      rolledRow = row;
      readsRowRight = rng() < tuning.laneAccuracy;
    }
    const best = pickLane(state, row, BEST, range, balance);
    return readsRowRight ? best : secondLane(state, row, BEST, range, balance, best);
  }

  /** What the player sees this step and would like to do about it. */
  function observe(state: RunState): number {
    const row = nextGateRow(state);
    const distance = row >= 0 ? distanceToRow(state, row) : Infinity;
    const range = reachable(state, balance);

    // The fence, once it is close enough to be looking at. `row` for the
    // guarded row is the no-lookahead rule: the side is chosen on the panels
    // this side of the stretch, not on the ones it is hiding.
    const walls = state.walls;
    if (walls !== undefined) {
      const z = state.squad.z;
      const approach = balance.walls.approach;
      for (const wall of walls) {
        const gate = wall.zStart - approach;
        if (gate <= z || gate - z > tuning.wallReach) continue;
        const line = wallX(wall.boundary, balance.road.laneWidth);
        // Re-decided every step, unlike greedy's one-shot commitment: a player
        // changes their mind halfway across, which is the other half of why
        // this bot leaves units outside the fence.
        narrowToSide(state, range, line, chooseSide(state, row, row, BEST, range, line, balance), balance);
      }
    }

    if (row < 0 || distance > balance.bots.gateCommitDistance) {
      if (bestStreamStand(state, range, balance)) return stand.x;
      if (bestDodge(state, range, balance)) return stand.x;
      if (row < 0) return clampToWalls(state.squad.x, range);
    }
    return clampToWalls(laneCenter(laneFor(state, row, range), balance.road.laneWidth), range);
  }

  return function decide(state: RunState): number {
    const wanted = observe(state);
    if (!primed) {
      // A player is not late for the board they started on: the run begins with
      // the finger where the crowd is and the buffer already full.
      primed = true;
      finger = state.squad.x;
      delayed.fill(wanted);
    }

    // Write now, read the far end of the ring: with `reactionSteps + 1` slots
    // that is exactly the observation `reactionSteps` steps ago.
    delayed[head] = wanted;
    head = (head + 1) % delayed.length;
    const target = delayed[head] ?? wanted;

    const move = target - finger;
    finger += Math.min(swipe, Math.max(-swipe, move));
    return finger;
  };
}
