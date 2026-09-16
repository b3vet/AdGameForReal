/**
 * What the road between the squad and a gate row will take from a column that
 * stands in a lane (document 31, 4.4).
 *
 * Until Phase 1 of the level-design plan the bots chose a lane on the panel
 * alone (`laneScore`), which is exactly the blindness the beats exist to
 * punish: a guard in front of the prize, an ambush behind it, a river pouring
 * through it all cost nothing to a bot that never looked. Here every threat
 * that will meet the column before the row (and in the first metres past it)
 * is put on one timeline per lane — when the lane's fire can first reach it,
 * when it arrives — and the lane's fire is spent on them nearest first, the
 * way `TargetList` spends it. What is left standing when it arrives is the
 * price.
 *
 * Three shapes of threat, priced the way the sim charges them:
 *
 *   block    what is left of its units, times the share of it that meets the
 *            column (`contact.ts`); a shield is spent first (`shields.ts`);
 *   river    one soldier per body that walks through (D29), in pieces, each
 *            leaking by the curve the aim probes measured (`BotPriceBalance`);
 *   charger  its whole bite, unless the lane's fire finishes it first (D49).
 *
 * A panel that stops shots (`isShootable`) screens whatever stands behind it
 * until that walks through or the squad reaches the row, which is the whole
 * mechanic of the ambush and the toll. The fire that is not busy with a threat
 * goes into the lane's own panel, and `path.panel` says how long for, so the
 * value can grow a plus or flip a curse by it (`./botValue.ts`).
 *
 * The collectors are `./botThreats.ts` and the timeline `./botTimeline.ts`.
 */

import { gatherStreams } from './botStreams';
import { addBlocks, addBodies, addPours } from './botThreats';
import { addPanel, clearItems, clearPanels, ctx, path, settle } from './botTimeline';
import { halfWidth } from './formation';
import { isShootable } from './gates';
import { laneCenter } from './lanes';
import type { Lane, RunState } from './types';
import { weaponDef, weaponOf } from './weapons';
import type { Balance } from '@/data/types';

export { path } from './botTimeline';

/** How a player reads the road, where it differs from greedy's whole-board view. */
export interface PriceView {
  /** Metres from the squad a threat behind a shot-stopping panel is seen at. */
  behindReach: number;
  /** Seconds before this player's column starts moving toward a lane it is not in. */
  delay: number;
  /**
   * How fast it gets there, in metres per second: greedy's column at
   * `price.shiftSpeed`, the human's thumb at its own `swipeSpeed`. Zero means
   * greedy's.
   */
  shift: number;
  /** Whether a river that has not started and pours from no portal is seen. */
  seesUnopened: boolean;
}

/** Greedy's view: the whole board, at once (D45's ceiling). */
export const WHOLE_BOARD: PriceView = { behindReach: Infinity, delay: 0, shift: 0, seesUnopened: true };

const LANES: readonly Lane[] = [-1, 0, 1];

/**
 * Prices every lane for the stretch up to `toZ` — the next gate row's `z`, or
 * the arena's when no row is left — and writes `path`. `row` is that row's
 * index, or -1, and names the panel whose fire time is reported.
 */
export function pricePath(state: RunState, row: number, toZ: number, view: PriceView, balance: Balance): void {
  const squad = state.squad;
  const weapon = weaponDef(weaponOf(squad));
  const raw = squad.count * squad.fireRate * (1 + squad.fireRateBonus) * weapon.fireRateMul * squad.damage;
  const price = balance.bots.price;
  const speed = view.shift > 0 ? view.shift : price.shiftSpeed;
  ctx.s = squad.z;
  ctx.run = Math.max(0.1, balance.squad.runSpeed);
  ctx.range = balance.projectiles.range;
  ctx.contact = balance.enemies.contactDistance;
  ctx.rowZ = Math.min(toZ, state.arenaZ);
  ctx.toZ = row >= 0 ? Math.min(ctx.rowZ + price.afterRow, state.arenaZ) : ctx.rowZ;
  ctx.horizon = price.horizon;
  ctx.trailing = price.trailing;
  ctx.half = halfWidth(squad.count, squad.formationWidth, balance);
  ctx.reach = balance.streams.footprint + ctx.half;
  ctx.count = squad.count;
  gatherStreams(state);

  for (let slot = 0; slot < LANES.length; slot++) {
    const lane = LANES[slot] ?? 0;
    const x = laneCenter(lane, balance.road.laneWidth);
    ctx.x = x;
    clearPanels();
    let panelZ = NaN;
    for (const gate of state.gates) {
      if (gate.passed || gate.lane !== lane || !isShootable(gate.kind) || gate.z <= ctx.s) continue;
      addPanel(gate.z);
      if (gate.rowIndex === row) panelZ = gate.z;
    }
    clearItems();
    addBlocks(state, lane, view, balance);
    addBodies(state, view);
    addPours(state, lane, view, balance);
    const delay = view.delay + Math.abs(x - squad.x) / Math.max(0.1, speed);
    path.shift[slot] = delay;
    const panelFrom = Number.isNaN(panelZ) ? 0 : (panelZ - ctx.s - ctx.range) / ctx.run;
    const panelTo = Number.isNaN(panelZ) ? 0 : (panelZ - ctx.s) / ctx.run;
    settle(slot, raw, delay, panelFrom, panelTo, weapon, price, balance.bots.weaponSlowWorth);
  }
}
