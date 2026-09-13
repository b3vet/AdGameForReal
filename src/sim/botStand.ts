/**
 * Where a scripted player stands when there is no gate to go for, and what
 * standing there costs.
 *
 * Split out of `./bots.ts` for the file-size rule (CLAUDE.md) when D42 made the
 * question harder. With the crowd one lane wide, coverage is no longer "the
 * squad is three metres across, so it shoots most of the road": the column
 * stands in a lane and reaches a stride past its own edge, so which lane it
 * stands in is most of how well a bot plays the river.
 */

import { overlapShare } from './contact';
import { enemyFootprint } from './enemies';
import { halfWidth } from './formation';
import type { RunState } from './types';
import { clampToWalls } from './walls';
import type { WallLimits } from './walls';
import type { Balance } from '@/data/types';

/**
 * Candidate places to stand: the three lane centres and the two gaps between
 * them, so a horde pouring down two neighbouring lanes can be answered by
 * standing between them rather than by giving one of them up.
 */
const STAND_COUNT = 5;

/** The candidates in road coordinates, and what each of them covers. Module
 *  level and overwritten: a bot is asked where to stand on every step. */
const candidates = new Float64Array(STAND_COUNT);
const covered = new Int32Array(STAND_COUNT);

/**
 * The last `bestStreamStand`: where to stand, and how many live bodies standing
 * there covers. Module-level and overwritten, like everything else here.
 */
export const stand = { x: 0, bodies: 0 };

/**
 * Where the squad should stand when there is no gate to go for: the spot its
 * own fire covers the most live stream bodies from (plan, "Enemy streams
 * (sim)": greedy centres on the densest live stream lane).
 *
 * A stream left alone is one lost soldier per body, so coverage is the whole
 * game between rows. Returns `false` when nothing is streaming, and the bot
 * falls back to its gate logic; otherwise `stand` holds the answer and the
 * bodies it covers, which is what the wall's side choice weighs a gate against.
 *
 * Counted body by body rather than lane by lane. Through Milestone 5 Phase B
 * the crowd was wide enough that its reach from the middle covered all three
 * lane *centres*, so every candidate scored the whole river and the bot never
 * moved; and the bodies it was really scoring are spread over `streams.jitter`
 * either side of their lane centre anyway, which a lane-centre test cannot see.
 * The loop over the bodies was already being walked, so this costs five
 * comparisons a body instead of a `laneOf`.
 *
 * `range` bounds the candidates, so the same routine answers both "where should
 * I stand" and "what would standing on that side of a fence be worth".
 */
export function bestStreamStand(state: RunState, range: WallLimits, balance: Balance): boolean {
  if (state.streams.length === 0) return false;
  const squad = state.squad;
  const reach = balance.bots.streamLookahead;
  const laneWidth = balance.road.laneWidth;

  // How far off its centre the crowd can still put a shot into a body: its own
  // half-width plus what the body is worth to a shot.
  const cover =
    halfWidth(squad.count, squad.formationWidth, balance) +
    balance.streams.footprint +
    balance.streams.aimAssist;

  for (let i = 0; i < STAND_COUNT; i++) {
    candidates[i] = clampToWalls(((i - 2) * laneWidth) / 2, range);
    covered[i] = 0;
  }

  let seen = 0;
  for (const enemy of state.enemies) {
    if (!enemy.alive || enemy.streamId === undefined) continue;
    const gap = enemy.z - squad.z;
    if (gap < 0 || gap > reach) continue;
    seen++;
    // `?? 0` on a fixed-length typed array: the index is in range by
    // construction, and `noUncheckedIndexedAccess` does not know that.
    for (let i = 0; i < STAND_COUNT; i++) {
      if (Math.abs(enemy.x - (candidates[i] ?? 0)) <= cover) covered[i] = (covered[i] ?? 0) + 1;
    }
  }
  if (seen === 0) return false;

  stand.x = clampToWalls(squad.x, range);
  stand.bodies = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < STAND_COUNT; i++) {
    const x = candidates[i] ?? 0;
    const score = covered[i] ?? 0;
    const distance = Math.abs(x - squad.x);
    if (score > stand.bodies || (score === stand.bodies && distance < bestDistance)) {
      stand.x = x;
      stand.bodies = score;
      bestDistance = distance;
    }
  }
  return true;
}

/**
 * What standing at `x` would cost in soldiers, from the blocks already close
 * enough to run into the crowd. Priced exactly as `contact.ts` prices it, so
 * the bot and the sim agree about what a graze is worth.
 *
 * Stream bodies are not blocks and are deliberately not counted: one costs a
 * single soldier, and the squad is standing where it is precisely in order to
 * shoot the lane it came down. A block costs a share of its whole unit count.
 */
export function contactCost(state: RunState, x: number, balance: Balance): number {
  const squad = state.squad;
  const squadHalf = halfWidth(squad.count, squad.formationWidth, balance);
  const minShare = balance.enemies.contactMinShare;
  let cost = 0;
  for (const enemy of state.enemies) {
    if (!enemy.alive || !enemy.active || enemy.streamId !== undefined) continue;
    const gap = enemy.z - squad.z;
    if (gap < 0 || gap > balance.bots.threatLookahead) continue;
    const half = enemyFootprint(enemy.kind, enemy.units, balance);
    cost += overlapShare(enemy.x, half, x, squadHalf, minShare) * enemy.units;
  }
  return cost;
}

/**
 * Where to stand when a block is already on its way and nothing is streaming.
 *
 * Through Phase B this was a yes-or-no question — the crowd was wider than the
 * road's own lanes, so there was nowhere a block was not, and greedy held its
 * ground and shot whatever was coming. A lane-wide column fits *between*
 * blocks, so the answer is a place: the cheapest candidate it can still reach,
 * and its own position when nothing beats standing still. Returns `false` when
 * no block threatens, and the bot falls back to its gate logic.
 */
export function bestDodge(state: RunState, range: WallLimits, balance: Balance): boolean {
  const squad = state.squad;
  const here = clampToWalls(squad.x, range);
  const cost = contactCost(state, here, balance);
  if (cost <= 0) return false;

  const laneWidth = balance.road.laneWidth;
  stand.x = here;
  stand.bodies = 0;
  let best = cost;
  let bestDistance = 0;
  for (let i = 0; i < STAND_COUNT; i++) {
    const x = clampToWalls(((i - 2) * laneWidth) / 2, range);
    const at = contactCost(state, x, balance);
    const distance = Math.abs(x - squad.x);
    // Ties keep the squad where it is: a swerve that saves nothing is a swerve
    // that gives the next row's lane up for nothing.
    if (at < best || (at === best && distance < bestDistance)) {
      best = at;
      stand.x = x;
      bestDistance = distance;
    }
  }
  return true;
}
