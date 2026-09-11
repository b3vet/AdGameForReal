/**
 * Scripted players. Used by the balance tests and by `?bot=` in the app.
 *
 *   greedy — best expected count on the next unpassed row; holds position when
 *            an active block is about to run into the squad, and shoots it
 *   random — a random lane per row
 *   worst  — the worst gate on the next row
 *
 * A bot is a pure function of the state plus its own seeded stream, so a bot
 * run is as reproducible as the sim it drives.
 */

import { enemyFootprint, enemyHalfWidth } from './enemies';
import { halfWidth } from './formation';
import { countAfterGate } from './gates';
import { laneCenter, laneOf } from './lanes';
import { FIRE_RATE_GATE_WORTH } from './level';
import { mulberry32 } from './rng';
import type { EnemyState, GateState, Lane, RunState, WeaponId } from './types';
import { blockGap, expectedDps, weaponOf } from './weapons';
import { balance } from '@/data';

export type BotKind = 'greedy' | 'random' | 'worst';

const LANES: readonly Lane[] = [-1, 0, 1];

/**
 * Blocks in the window a bot reads when it values a staff gate. Module-level
 * and re-used: a bot is asked for a lane every step, and the sim must not
 * allocate in hot loops (CLAUDE.md).
 */
const layout: EnemyState[] = [];

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

function fillLayout(state: RunState): void {
  layout.length = 0;
  const from = state.squad.z;
  const rows = balance.bots.weaponLookaheadRows + 1;
  const to = from + rows * balance.level.rowSpacing;
  // A stream is hundreds of bodies and a staff is valued against a layout, not a
  // census: reading the whole river would swamp the blocks the splash and chain
  // numbers are also about. Every block counts, and the river is sampled — a
  // couple of dozen bodies already says "this lane is packed".
  let sampled = 0;
  const cap = balance.bots.weaponLayoutMax;
  for (const enemy of state.enemies) {
    if (!enemy.alive || enemy.z < from || enemy.z > to) continue;
    if (enemy.streamId !== undefined) {
      if (sampled >= cap) continue;
      sampled++;
    }
    layout.push(enemy);
  }
}

/**
 * How many other blocks the average block in the window has within `radius`,
 * measured the way the sim measures: `edgeToEdge` for a splash, which reaches
 * from the impact to the edge of a block, and centre to centre for a chain,
 * which jumps between blocks.
 */
function neighboursWithin(radius: number, edgeToEdge: boolean): number {
  if (layout.length <= 1) return 0;
  let total = 0;
  for (let i = 0; i < layout.length; i++) {
    const a = layout[i];
    if (a === undefined) continue;
    const aHalf = edgeToEdge ? enemyFootprint(a.kind, a.units, balance) : 0;
    for (let j = 0; j < layout.length; j++) {
      if (i === j) continue;
      const b = layout[j];
      if (b === undefined) continue;
      const bHalf = edgeToEdge ? enemyFootprint(b.kind, b.units, balance) : 0;
      if (blockGap(a.x, aHalf, b.x, bHalf, a.z - b.z) <= radius) total++;
    }
  }
  return total / layout.length;
}

/**
 * What swapping to `next` is worth, in units.
 *
 * A staff hands over no units, so it is scored as the squad it makes: expected
 * damage per second against the blocks in the next few rows, relative to the
 * staff in hand, damped by `bots.weaponWorth` because DPS is only worth
 * something where there is something to shoot.
 */
function weaponScore(next: WeaponId | undefined, state: RunState): number {
  const count = state.squad.count;
  if (next === undefined) return count;

  const current = weaponOf(state.squad);
  if (next === current) return count;

  fillLayout(state);
  const slowWorth = balance.bots.weaponSlowWorth;
  const now = expectedDps(current, neighboursWithin, slowWorth);
  if (now <= 0) return count;
  const then = expectedDps(next, neighboursWithin, slowWorth);
  return count * (1 + balance.bots.weaponWorth * (then / now - 1));
}

/** What the squad is worth after taking this gate. Empty lanes score `count`. */
function laneScore(gate: GateState | null, state: RunState): number {
  const count = state.squad.count;
  if (gate === null) return count;
  if (gate.kind === 'fireRate') return count * (1 + gate.value * FIRE_RATE_GATE_WORTH);
  if (gate.kind === 'weapon') return weaponScore(gate.weaponId, state);
  return Math.min(balance.squad.maxCount, countAfterGate(gate.kind, gate.value, count));
}

/**
 * Picks a lane on `rowIndex`. `sign` is +1 for the best gate, -1 for the worst.
 * Ties go to the lane nearest the squad, so a bot does not swerve for nothing.
 */
function pickLane(state: RunState, rowIndex: number, sign: number): Lane {
  let bestLane: Lane = 0;
  let bestScore = -Infinity;
  let bestDistance = Infinity;

  for (const lane of LANES) {
    let gate: GateState | null = null;
    for (const candidate of state.gates) {
      if (candidate.rowIndex === rowIndex && candidate.lane === lane && !candidate.passed) {
        gate = candidate;
        break;
      }
    }
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

/** Live stream bodies in front of the squad, per lane. Re-used, never re-made. */
const laneBodies = [0, 0, 0];

/**
 * Candidate places to stand: the three lane centres and the two gaps between
 * them, so a horde pouring down two neighbouring lanes can be answered by
 * standing between them rather than by giving one of them up.
 */
const STANDS: readonly number[] = [-2, -1, 0, 1, 2];

/**
 * Where the squad should stand when there is no gate to go for: the spot its
 * own width covers the most live stream bodies from (plan, "Enemy streams
 * (sim)": greedy centres on the densest live stream lane).
 *
 * A stream left alone is one lost soldier per body, so coverage is the whole
 * game between rows. Returns `null` when nothing is streaming, and the bot
 * falls back to its gate logic.
 */
function bestStreamStand(state: RunState): number | null {
  if (state.streams.length === 0) return null;
  const squadZ = state.squad.z;
  const reach = balance.bots.streamLookahead;
  laneBodies[0] = 0;
  laneBodies[1] = 0;
  laneBodies[2] = 0;
  let seen = 0;

  for (const enemy of state.enemies) {
    if (!enemy.alive || enemy.streamId === undefined) continue;
    const gap = enemy.z - squadZ;
    if (gap < 0 || gap > reach) continue;
    const slot = laneOf(enemy.x, balance.road.laneWidth) + 1;
    laneBodies[slot] = (laneBodies[slot] ?? 0) + 1;
    seen++;
  }
  if (seen === 0) return null;

  // How far off its centre the crowd can still put a shot into a body: its own
  // half-width plus what the body is worth to a shot.
  const cover =
    halfWidth(state.squad.count) + balance.streams.footprint + balance.streams.aimAssist;

  let best = state.squad.x;
  let bestScore = -1;
  let bestDistance = Infinity;
  for (const stand of STANDS) {
    let score = 0;
    for (const lane of LANES) {
      if (Math.abs(laneCenter(lane, balance.road.laneWidth) - stand) <= cover) {
        score += laneBodies[lane + 1] ?? 0;
      }
    }
    const distance = Math.abs(stand - state.squad.x);
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      best = stand;
      bestScore = score;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * True when a block already on its way will run into a squad standing at `x`.
 *
 * Stream bodies are not blocks and are deliberately not counted: one costs a
 * single soldier, and the squad is standing where it is precisely in order to
 * shoot the lane it came down. A block costs a share of its whole unit count.
 */
function blockedByEnemy(state: RunState): boolean {
  const squad = state.squad;
  const squadHalf = halfWidth(squad.count);
  for (const enemy of state.enemies) {
    if (!enemy.alive || !enemy.active || enemy.streamId !== undefined) continue;
    const gap = enemy.z - squad.z;
    if (gap < 0 || gap > balance.bots.threatLookahead) continue;
    const half = enemyHalfWidth(enemy, balance);
    if (Math.abs(enemy.x - squad.x) < half + squadHalf) return true;
  }
  return false;
}

/** Returns a policy: given the current state, the `targetX` the bot wants. */
export function createBot(kind: BotKind, seed: number): (state: RunState) => number {
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
    const committed = row >= 0 && distanceToRow(state, row) <= balance.bots.gateCommitDistance;

    if (kind === 'greedy' && !committed) {
      // Between rows the squad's job is the river, not the next panel.
      const stand = bestStreamStand(state);
      if (stand !== null) return stand;
      // Nothing streaming: greedy would rather stand and shoot a block than
      // dodge it, and only swerves once the row is close.
      if (blockedByEnemy(state)) return state.squad.x;
    }

    // No gates left: hold station and shoot whatever is in front.
    if (row < 0) return state.squad.x;
    return laneCenter(pickLane(state, row, sign), balance.road.laneWidth);
  };
}
