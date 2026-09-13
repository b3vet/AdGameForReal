/**
 * Scripted players. Used by the balance tests and by `?bot=` in the app.
 *
 *   greedy — best expected count on the next unpassed row; between rows it
 *            covers the river, steps out of a block already on its way, and is
 *            inside the fence with its whole column before a wall holds it
 *   human  — a decent thumb: reaction delay, a swipe speed limit, the right
 *            lane about seven times in ten, and no lookahead past the next row
 *   random — a random lane per row
 *   worst  — the worst gate on the next row
 *
 * A bot is a function of the state, its own seeded stream, and — for the ones
 * that commit to something — a few numbers it remembers: the lane the random
 * bot rolled for this row, the side greedy settled on for the fence ahead, the
 * human's ring of past observations. All of it is per-instance and seeded, so a
 * bot run is as reproducible as the sim it drives.
 *
 * The lane arithmetic they share lives in `./botLanes.ts`, what a lane is worth
 * in `./botScore.ts`, and where to stand between rows in `./botStand.ts`.
 */

import { createHumanBot } from './botHuman';
import {
  chooseSide,
  distanceToRow,
  guardedRow,
  narrowToSide,
  nextGateRow,
  pickLane,
  reachable,
} from './botLanes';
import { bestDodge, bestStreamStand, stand } from './botStand';
import { laneCenter } from './lanes';
import { mulberry32 } from './rng';
import type { Lane, RunState } from './types';
import { clampToWalls, wallX } from './walls';
import type { WallLimits } from './walls';
import { balance as shipped } from '@/data';
import type { Balance } from '@/data/types';

export type BotKind = 'greedy' | 'human' | 'random' | 'worst';

const LANES: readonly Lane[] = [-1, 0, 1];

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

  if (kind === 'human') return createHumanBot(rng, balance);

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
  // The side chosen for the stretch on each boundary, and the stretch it was
  // chosen for. A bot that re-scores its side every step will happily take a
  // multiplier on the wrong half of the road and then set off across it with a
  // metre of road left (level 11 seed 1 through Milestone 5): the fence is a
  // commitment by design, so the reference player makes it once, early, with
  // both rows valued, and lives with it. Cleared implicitly — a stretch is only
  // ever consulted while it is the one ahead on its boundary.
  const sideZ = new Float64Array(2).fill(NaN);
  const sideTaken = new Int8Array(2);

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
    commitToWalls(state, row, sign, range, balance, sideZ, sideTaken);

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

/**
 * Narrows `range` to the side of every fence the squad is about to meet.
 *
 * Every wall whose approach zone starts within `bots.wallCommitDistance`, not
 * just the first one and not only the ones this side of the next gate row:
 *
 * - a stretch may begin `walls.gateClearance` past the row behind it, which is
 *   the length of the approach zone itself, so a bot that only looked as far as
 *   its next row met the fence with no road left to cross on (measured over the
 *   campaign: greedy entered 29 of 102 stretches straddling the line);
 * - from `walls.bothFromLevel` a horde row can be fenced on both boundaries at
 *   once, and answering one of them leaves the column cut by the other;
 * - a stretch can run past the last gate row of a level, where `row` is -1 and
 *   there is nothing left to steer for but the river.
 *
 * Under D44 arriving late is no longer tidied up by the clamp: the units on the
 * wrong side of the line when the stretch starts to hold are cut off as
 * stragglers. This is what keeps greedy the fair-play reference — it never
 * costs itself a soldier at a fence — and the human bot deliberately does not
 * call it, which is where its stragglers come from.
 */
function commitToWalls(
  state: RunState,
  row: number,
  sign: number,
  range: WallLimits,
  balance: Balance,
  sideZ: Float64Array,
  sideTaken: Int8Array,
): void {
  const walls = state.walls;
  if (walls === undefined || walls.length === 0) return;
  const z = state.squad.z;
  const approach = balance.walls.approach;
  const horizon = z + balance.bots.wallCommitDistance;

  for (const wall of walls) {
    // The same window `wallAhead` reads: past its approach zone the side is
    // already decided, and beyond the horizon there is nothing to commit to yet.
    const gate = wall.zStart - approach;
    if (gate <= z || gate > horizon) continue;

    const line = wallX(wall.boundary, balance.road.laneWidth);
    const slot = wall.boundary < 0 ? 0 : 1;
    if (sideZ[slot] !== wall.zStart) {
      sideZ[slot] = wall.zStart;
      sideTaken[slot] = chooseSide(
        state,
        row,
        guardedRow(state, wall, row),
        sign,
        range,
        line,
        balance,
      );
    }
    narrowToSide(state, range, line, sideTaken[slot] ?? 0, balance);
  }
}
