/**
 * What a lane is worth to a scripted player.
 *
 * Split out of `./bots.ts` in Milestone 5 for the file-size rule (CLAUDE.md).
 * Everything here answers one question — "what does the squad become if it
 * walks through this gate" — in soldiers, so the bot itself only has to compare
 * numbers and steer.
 */

import { enemyFootprint } from './enemies';
import { countAfterGate } from './gates';
import { FIRE_RATE_GATE_WORTH } from './level';
import type { GateState, RunState, WeaponId } from './types';
import { blockGap, expectedDps, weaponOf } from './weapons';
import { balance } from '@/data';
import type { EnemyState } from './types';

/**
 * Blocks in the window a bot reads when it values a staff gate. Module-level
 * and re-used: a bot is asked for a lane every step, and the sim must not
 * allocate in hot loops (CLAUDE.md).
 */
const layout: EnemyState[] = [];

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
  // Damped by how much road is left to use it on. A staff hands over no units,
  // so what it is worth is the damage it adds over the rest of the level — and
  // a swap taken two rows from the arena pays for a fraction of the run while
  // costing a whole row's worth of soldiers, which is how a bot ends up at the
  // boss with half the squad and a better staff (level 8 seed 1).
  const remaining = Math.min(1, Math.max(0, (state.arenaZ - state.squad.z) / Math.max(1, state.arenaZ)));
  return count * (1 + balance.bots.weaponWorth * remaining * (then / now - 1));
}

/**
 * What taking this gate multiplies the squad by. Lets two rows be valued
 * together without re-running the sim: an `add` of ten on a squad of a hundred
 * is 1.1, a `mul` of three is 3, and an empty lane is 1.
 */
export function laneRatio(gate: GateState | null, state: RunState): number {
  return laneScore(gate, state) / Math.max(1, state.squad.count);
}

/** What the squad is worth after taking this gate. Empty lanes score `count`. */
export function laneScore(gate: GateState | null, state: RunState): number {
  const count = state.squad.count;
  if (gate === null) return count;
  if (gate.kind === 'fireRate') return count * (1 + gate.value * FIRE_RATE_GATE_WORTH);
  if (gate.kind === 'weapon') return weaponScore(gate.weaponId, state);
  return Math.min(balance.squad.maxCount, countAfterGate(gate.kind, gate.value, count));
}
