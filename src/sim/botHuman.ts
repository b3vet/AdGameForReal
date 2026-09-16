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
 *   read        it prices every lane as greedy does (`./botValue.ts`), but sees
 *               what a panel gives and what its road takes each through a
 *               log-normal factor of spread `readNoise`, drawn once per row —
 *               a player commits to a panel, they do not dither in front of
 *               it — so close calls are missed often and obvious ones rarely
 *               (document 31, 4.4, replacing the flat seven-in-ten of D45);
 *   behind      a block or a portal standing behind a panel that stops shots
 *               is not on its screen until it is within `behindReach`, and a
 *               river that has not started pouring from nowhere is not on it
 *               at all;
 *   read time   it reads each row somewhere between `readLate` and
 *               `readDistance` short of it, drawn with the read, and until then
 *               plays the road — the cheapest lane underfoot — rather than the
 *               row. A row read late is a guard shot for less time, an ambush
 *               seen too late to leave, and a fence met from the wrong side;
 *   lookahead   it values the next row only. The row behind a fence is a row it
 *               has not looked at yet;
 *   walls       it notices a stretch only when the approach zone is within
 *               `wallReach`, which is about as far ahead as a player watching
 *               the crowd rather than the horizon sees it. A late crossing
 *               leaves part of the column outside the fence, and from D44 those
 *               units are cut off as stragglers — the bot does not model that,
 *               it simply moves late and pays for it.
 *
 * Everything else — how a lane is priced, where to stand in a river, how to
 * step out of a block — is greedy's, because a decent player does know all of
 * that. The difference the bands are measured against is the hand and the eye,
 * not the arithmetic.
 */

import { distanceToRow, narrowToSide, nextGateRow, reachable } from './botLanes';
import { bestChargerStand } from './botCharge';
import { NO_PLAN, planLane, planRoad, pricedSide } from './botPlan';
import type { PriceView } from './botPrice';
import { bestDodge, stand } from './botStand';
import type { LaneRead } from './botValue';
import { laneCenter, laneOf } from './lanes';
import type { Rng } from './rng';
import type { RunState } from './types';
import { clampToWalls, wallX } from './walls';
import type { Balance } from '@/data/types';

/**
 * The sim only ever integrates at 1/60 s (`Run.FIXED_DT`) and a bot is asked for
 * a target once per step, so a delay in steps is exact and a speed in metres per
 * second converts to metres per step here rather than at every call site.
 */
const SIM_STEP = 1 / 60;

/**
 * Two standard normals from two uniforms (Box–Muller), so the six a row needs
 * are three pairs. `1 - u` keeps the logarithm off zero, which the generator
 * can return.
 */
function normalPair(rng: Rng, out: Float64Array, at: number): void {
  const radius = Math.sqrt(-2 * Math.log(1 - rng()));
  const angle = 2 * Math.PI * rng();
  out[at] = radius * Math.cos(angle);
  out[at + 1] = radius * Math.sin(angle);
}

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
  /** The row the read was drawn for, and the lane it has settled on for it. */
  let readRow = -2;
  let plan = NO_PLAN;
  /** How far from the row this row gets read, drawn with the read. */
  let readAt = tuning.readDistance;

  const read: LaneRead = { gain: new Float64Array(3), price: new Float64Array(3) };
  const normals = new Float64Array(6);
  const view: PriceView = {
    behindReach: tuning.behindReach,
    delay: tuning.reactionSteps * SIM_STEP,
    shift: tuning.swipeSpeed,
    seesUnopened: false,
  };

  /** A fresh read for a new row: what each lane gives and takes, as it looks. */
  function drawRead(): void {
    for (let i = 0; i < normals.length; i += 2) normalPair(rng, normals, i);
    for (let slot = 0; slot < 3; slot++) {
      read.gain[slot] = Math.exp(tuning.readNoise * (normals[slot * 2] ?? 0));
      read.price[slot] = Math.exp(tuning.readNoise * (normals[slot * 2 + 1] ?? 0));
    }
  }

  /** What the player sees this step and would like to do about it. */
  function observe(state: RunState): number {
    const row = nextGateRow(state);
    const distance = row >= 0 ? distanceToRow(state, row) : Infinity;
    const range = reachable(state, balance);
    if (row !== readRow) {
      readRow = row;
      plan = NO_PLAN;
      drawRead();
      readAt = tuning.readLate + rng() * Math.max(0, tuning.readDistance - tuning.readLate);
    }

    // The fence, once it is close enough to be looking at. The row it guards
    // is valued as the near row: the no-lookahead rule, the side is chosen on
    // the panels this side of the stretch, not on the ones it is hiding.
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
        const side = pricedSide(state, row, row, range, line, view, read, balance);
        narrowToSide(state, range, line, side, balance);
      }
    }

    const committed = row >= 0 && distance <= balance.bots.gateCommitDistance;
    // A charger that has set off comes first: a decent player does get out of
    // the way of the thing running at them (D49). The hand is still late and
    // still slow, which is where the difficulty is — this is the observation,
    // and the reaction ring and the swipe limit below decide whether the crowd
    // arrives in time.
    if (!committed && bestChargerStand(state, range, balance)) return stand.x;

    // Until it has read the row it plays the road: the cheapest lane between
    // here and the panels, the one underfoot unless another is clearly cheaper.
    const here = laneOf(state.squad.x, balance.road.laneWidth);
    const reading = row < 0 || distance <= readAt;
    const lane = reading
      ? planLane(state, row, range, view, read, balance, row < 0 ? here : plan)
      : planRoad(state, row, range, view, read, balance, here);
    if (reading) plan = lane;
    // Stepping out of a block stays inside the lane it has settled on, as
    // greedy's does (`./bots.ts`).
    if (!committed && bestDodge(state, range, balance) && laneOf(stand.x, balance.road.laneWidth) === lane) {
      return stand.x;
    }
    if ((!reading || row < 0) && lane === here) return clampToWalls(state.squad.x, range);
    return clampToWalls(laneCenter(lane, balance.road.laneWidth), range);
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
