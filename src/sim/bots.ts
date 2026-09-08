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

import { enemyFootprint } from './enemies';
import { halfWidth } from './formation';
import { countAfterGate } from './gates';
import { FIRE_RATE_GATE_WORTH, laneCenter } from './level';
import { mulberry32 } from './rng';
import type { GateState, Lane, RunState } from './types';
import { balance } from '@/data';

export type BotKind = 'greedy' | 'random' | 'worst';

const LANES: readonly Lane[] = [-1, 0, 1];

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

/** What the squad is worth after taking this gate. Empty lanes score `count`. */
function laneScore(gate: GateState | null, count: number): number {
  if (gate === null) return count;
  if (gate.kind === 'fireRate') return count + count * FIRE_RATE_GATE_WORTH;
  return Math.min(balance.squad.maxCount, countAfterGate(gate.kind, gate.value, count));
}

/**
 * Picks a lane on `rowIndex`. `sign` is +1 for the best gate, -1 for the worst.
 * Ties go to the lane nearest the squad, so a bot does not swerve for nothing.
 */
function pickLane(state: RunState, rowIndex: number, sign: number): Lane {
  const count = state.squad.count;
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
    const score = sign * laneScore(gate, count);
    const distance = Math.abs(laneCenter(lane, balance.road.laneWidth) - state.squad.x);
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      bestScore = score;
      bestDistance = distance;
      bestLane = lane;
    }
  }
  return bestLane;
}

/** True when a block already on its way will run into the squad where it stands. */
function blockedByEnemy(state: RunState): boolean {
  const squad = state.squad;
  const squadHalf = halfWidth(squad.count);
  for (const enemy of state.enemies) {
    if (!enemy.alive || !enemy.active) continue;
    const gap = enemy.z - squad.z;
    if (gap < 0 || gap > balance.bots.threatLookahead) continue;
    const half = enemyFootprint(enemy.kind, enemy.units, balance);
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
    // No gates left: hold station and shoot whatever is in front.
    if (row < 0) return state.squad.x;
    // Between rows greedy would rather stand and shoot a block than dodge it;
    // close to a row it commits to the lane it wants instead.
    const committed = distanceToRow(state, row) <= balance.bots.gateCommitDistance;
    if (kind === 'greedy' && !committed && blockedByEnemy(state)) return state.squad.x;
    return laneCenter(pickLane(state, row, sign), balance.road.laneWidth);
  };
}
