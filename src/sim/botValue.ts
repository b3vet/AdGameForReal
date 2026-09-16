/**
 * What a lane is worth to a scripted player once the road to it has been
 * priced (document 31, 4.4): the gate's outcome on the squad that is left
 * after the lane's threats have taken their share, with the panel grown or
 * shot down by the fire the threats left over.
 *
 * `laneScore` (`./botScore.ts`) is still the face value of a panel and still
 * what the worst bot ranks by. This is the answer greedy and the human act on,
 * and the one the beat lab and the design readout report as the decision
 * value, so all three agree about what a row offered.
 *
 * The human sees it through a noisy read: the gain and the price of each lane
 * are each scaled by a factor drawn once per row (`LaneRead`), so a close call
 * is missed often and an obvious one rarely, and a curse is never mistaken
 * for a plus because a factor never changes a sign.
 *
 * Allocation-free, like the rest of the bot code.
 */

import { gateAt } from './botLanes';
import { path, pricePath } from './botPrice';
import type { PriceView } from './botPrice';
import { laneRatio } from './botScore';
import { countAfterGate, FIRE_RATE_GATE_WORTH, gateCap } from './gates';
import type { GateKind, GateState, RunState } from './types';
import type { Balance } from '@/data/types';

/** Per-lane factors on what a lane gives and what it takes (index `lane + 1`). */
export interface LaneRead {
  gain: Float64Array;
  price: Float64Array;
}

/** A read with no noise in it: greedy's. */
export function exactRead(): LaneRead {
  return { gain: new Float64Array(3).fill(1), price: new Float64Array(3).fill(1) };
}

/** What the last `priceLanes` call found, per lane (index `lane + 1`). */
export const lanes = {
  /** The squad a player believes it leaves the row with, noise included. */
  seen: new Float64Array(3),
  /** The same without the noise: what the lane is expected to be worth. */
  worth: new Float64Array(3),
  /** Soldiers the road to the row is expected to take in that lane. */
  cost: new Float64Array(3),
  /**
   * The panel's outcome on the whole squad, as if the road were free: the
   * tie-break when two lanes price the same, which in practice means when both
   * are expected to cost the whole squad and a bot should still go for the
   * better panel rather than the nearer one.
   */
  face: new Float64Array(3),
  /** 1 when the column can be in the lane before the row, else 0. */
  reachable: new Uint8Array(3),
  /** The squad before the price and before the gate, for shares. */
  count: 0,
};

/** The projected panel `projectGate` writes; overwritten, never allocated. */
const projected: { kind: GateKind; value: number } = { kind: 'add', value: 0 };

/**
 * Whether this road grows and shrinks its panels by a share of the squad as
 * well as by the flat rate (`LevelDef.squadRates`, document 31, 3.4). Read off
 * the state when the sim puts it there; a dealt road never does.
 */
function squadRates(state: RunState): boolean {
  return 'squadRates' in state && state.squadRates === true;
}

/**
 * What a shootable panel will print when the squad reaches it, after
 * `seconds` of the column's whole fire and the creep of the time it is in
 * range and not being shot (`gates.ts`). Writes `projected`.
 */
function projectGate(gate: GateState, seconds: number, state: RunState, balance: Balance): void {
  const gates = balance.gates;
  const rates = gates.growthPerSecond;
  const count = state.squad.count;
  const shares = squadRates(state);
  const cap = gate.cap ?? gateCap(gate.kind, gate.value, balance);
  const addRate = rates.add + (shares ? rates.shares.add * count : 0);
  projected.kind = gate.kind;
  projected.value = gate.value;

  if (gate.kind === 'add') {
    projected.value = Math.max(gate.value, Math.min(cap, gate.value + addRate * seconds));
    return;
  }
  if (gate.kind === 'fireRate') {
    projected.value = Math.max(gate.value, Math.min(cap, gate.value + rates.fireRate * seconds));
    return;
  }
  if (gate.kind !== 'sub') return;

  const creeps = state.levelIndex >= gates.creep.fromLevel;
  const creep = creeps ? gates.creep.perSecond + (shares ? gates.creep.share * count : 0) : 0;
  const inRange = Math.max(0, Math.min(balance.projectiles.range, gate.z - state.squad.z)) / balance.squad.runSpeed;
  const before = gate.value + creep * Math.max(0, inRange - seconds);
  const drop = rates.sub + (shares ? rates.shares.sub * count : 0) - creep;
  if (drop <= 0 || drop * seconds < before) {
    projected.value = before - Math.max(0, drop) * seconds;
    return;
  }
  // The flip: the curse is spent part-way and grows as a plus for the rest.
  const flipAt = before / drop;
  projected.kind = 'add';
  projected.value = Math.min(cap, addRate * (seconds - flipAt));
}

/** The squad a gate of `kind` and `value` turns `count` into. */
function outcome(gate: GateState, count: number, state: RunState, balance: Balance): number {
  if (count <= 0) return 0;
  const kind = projected.kind;
  if (kind === 'fireRate') return count * (1 + projected.value * FIRE_RATE_GATE_WORTH);
  // A staff's worth is a ratio on the squad (`weaponScore`), so it scales.
  if (kind === 'weapon') return count * laneRatio(gate, state);
  return Math.max(0, Math.min(balance.squad.maxCount, countAfterGate(kind, projected.value, count)));
}

/**
 * Prices the three lanes on `row` (or the stretch to the arena when `row` is
 * -1) and writes `lanes`. `read` is the player's per-row noise; `exactRead()`
 * for greedy.
 */
export function priceLanes(
  state: RunState,
  row: number,
  toZ: number,
  view: PriceView,
  read: LaneRead,
  balance: Balance,
): void {
  pricePath(state, row, toZ, view, balance);
  const count = state.squad.count;
  lanes.count = count;
  for (let slot = 0; slot < 3; slot++) {
    const lane = slot === 0 ? -1 : slot === 1 ? 0 : 1;
    const cost = path.cost[slot] ?? 0;
    const later = path.after[slot] ?? 0;
    const gate = row >= 0 ? gateAt(state, row, lane) : null;
    let full = count;
    let paid = Math.max(0, count - cost - later);
    if (gate !== null) {
      projectGate(gate, path.panel[slot] ?? 0, state, balance);
      full = outcome(gate, count, state, balance);
      paid = Math.max(0, outcome(gate, Math.max(0, count - cost), state, balance) - later);
    }
    lanes.cost[slot] = cost + later;
    // A lane the column cannot be standing in before the row is not on offer:
    // what it gets is whatever lane it is crossing when the row arrives.
    lanes.reachable[slot] = row < 0 || (path.shift[slot] ?? 0) * balance.squad.runSpeed <= toZ - state.squad.z ? 1 : 0;
    lanes.worth[slot] = paid;
    lanes.face[slot] = full;
    lanes.seen[slot] = count + (full - count) * (read.gain[slot] ?? 1) - (full - paid) * (read.price[slot] ?? 1);
  }
}
