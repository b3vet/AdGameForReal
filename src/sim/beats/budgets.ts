/**
 * Gate budgets per level (document 31, 3.5): checked, not rolled.
 *
 * Multipliers are the script author's to place and the composer's to refuse:
 * a script that asks for more than its level allows, or a x3 before x3s are
 * allowed, is a data error and fails with the level's number on it.
 *
 * Curses are a budget to spend. Every curse slot a beat writes is a candidate
 * and the level's `curses` funds them in a fixed order; an unfunded slot
 * prints a small plus instead. The order puts the flips first, because a flip
 * beat without its curse is a beat with no question in it (and 3.5 wants one
 * flip on every level that has curses), then the price curses from the
 * highest rating down, ties in script order.
 *
 * Staff gates are a budget to host: `weaponBudget` per level, stood only on
 * the open and rest beats (Phase 1), with what a level cannot host carried to
 * the levels after it (`staffDemand`).
 */

import { weaponBudget } from '../levelPasses';
import { balance as shipped, levels } from '@/data';
import type { Balance, GateSlot, LaneRole, LevelGenConfig, ScriptBeat } from '@/data/types';
import { ROLES, STAFF_HOST_BEATS } from './library';
import type { ResolvedTier } from './library';

/** One beat of a script as the budget passes see it. */
export interface BudgetBeat {
  id: string;
  tier: ResolvedTier;
}

/** The most multipliers a level may print. */
export function mulAllowance(index: number, balance: Balance = shipped): number {
  const budget = balance.gates.budget;
  if (index < budget.mulFromLevel) return 0;
  return index <= budget.mulEarlyTo ? budget.mulEarly : budget.mulMax;
}

/** Throws when a script asks for more multipliers, or bigger ones, than its level allows. */
export function checkMultipliers(
  index: number,
  beats: readonly BudgetBeat[],
  balance: Balance = shipped,
): void {
  let count = 0;
  for (const beat of beats) {
    for (const role of ROLES) {
      const slot = beat.tier.gates[role];
      if (slot.kind !== 'mul') continue;
      count++;
      if (slot.value > 2 && index < balance.gates.budget.x3FromLevel) {
        throw new Error(
          `level ${String(index)}: beat "${beat.id}" asks for a x${String(slot.value)} before level ${String(balance.gates.budget.x3FromLevel)}`,
        );
      }
    }
  }
  const allowed = mulAllowance(index, balance);
  if (count > allowed) {
    throw new Error(
      `level ${String(index)}: the script prints ${String(count)} multipliers and the level allows ${String(allowed)}`,
    );
  }
}

interface CurseSlot {
  beat: number;
  role: LaneRole;
  flip: boolean;
  rating: number;
}

const SMALL_PLUS: GateSlot = { kind: 'add', size: 'small' };

/**
 * The script's tiers with its curse budget spent. `budget` undefined funds
 * every slot. Returns new tiers; the ones passed in are the library's and are
 * never written to.
 */
export function fundCurses(beats: readonly BudgetBeat[], budget: number | undefined): ResolvedTier[] {
  const tiers = beats.map((beat) => beat.tier);
  if (budget === undefined) return tiers;

  const slots: CurseSlot[] = [];
  beats.forEach((beat, index) => {
    for (const role of ROLES) {
      const slot = beat.tier.gates[role];
      if (slot.kind !== 'sub') continue;
      slots.push({ beat: index, role, flip: slot.size === 'flip', rating: beat.tier.rating });
    }
  });
  // A stable order written out rather than left to the sort: flips first, then
  // rating down, then where the slot stands in the script.
  slots.sort((a, b) => {
    if (a.flip !== b.flip) return a.flip ? -1 : 1;
    if (a.rating !== b.rating) return b.rating - a.rating;
    if (a.beat !== b.beat) return a.beat - b.beat;
    return ROLES.indexOf(a.role) - ROLES.indexOf(b.role);
  });

  const funded = Math.max(0, Math.floor(budget));
  const out = tiers.slice();
  for (let i = funded; i < slots.length; i++) {
    const slot = slots[i];
    if (slot === undefined) continue;
    const tier = out[slot.beat];
    if (tier === undefined) continue;
    out[slot.beat] = { ...tier, gates: { ...tier.gates, [slot.role]: SMALL_PLUS } };
  }
  return out;
}

/** Beats of a script a staff gate may stand on: the open and rest beats past the first. */
export function staffHosts(script: readonly ScriptBeat[]): number[] {
  const hosts: number[] = [];
  script.forEach((entry, k) => {
    if (k > 0 && STAFF_HOST_BEATS.has(entry.beat)) hosts.push(k);
  });
  return hosts;
}

/**
 * How many staff gates level `index` is asked to offer: its own budget
 * (`weaponBudget`), plus whatever the scripted levels before it in `campaign`
 * had no open or rest beat left to stand on, carried forward (Phase 1's rule:
 * a staff never breaks a beat, so a level short of hosts hands its offer on).
 * A dealt level in the campaign places its own budget and carries nothing.
 */
export function staffDemand(index: number, campaign: readonly LevelGenConfig[] = levels): number {
  let carry = 0;
  for (const config of campaign) {
    if (config.index >= index) break;
    const demand = weaponBudget(config.index) + carry;
    const hosts = config.script === undefined ? demand : staffHosts(config.script).length;
    carry = Math.max(0, demand - hosts);
  }
  return weaponBudget(index) + carry;
}
