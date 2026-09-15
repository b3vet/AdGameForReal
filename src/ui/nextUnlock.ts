/**
 * The cheapest thing the Academy still has to sell, for the result sheet's
 * "next unlock" row.
 *
 * The sheet's question after a run is "what did that buy me", and the honest
 * answer is a *thing with a price* rather than a number of coins. So this walks
 * the same three shops the Academy does — the Yard's five drills, the
 * Workbench's staffs and their evolutions, the Sanctum's wisp — and answers
 * with the nearest one, whether or not the purse covers it yet.
 *
 * Every price comes from `@/core/player`, which is the sim's own pricing
 * (`src/sim/player.ts`, D35), so this can never quote a price the shop would
 * not honour. Copy comes from `academy.json`. Rooms that are still shut are
 * skipped: a wisp is not the next unlock for a player who cannot reach the
 * Sanctum yet.
 */

import {
  familiarCost,
  familiarUnlocked,
  roomUnlockLevel,
  staffCost,
  upgradeCost,
  upgradeIds,
} from '@/core/player';
import type { PlayerState } from '@/core/player';
import { academy } from '@/data/academy-types';
import { weaponIds } from '@/sim';

export interface NextUnlock {
  /** What the Academy calls it. */
  name: string;
  price: number;
  /** Coins still to find, or 0 once the purse covers it. */
  missing: number;
}

/** The nearest unbought thing, or null when the Academy is sold out. */
export function nextUnlock(player: PlayerState): NextUnlock | null {
  let best: { name: string; price: number } | null = null;
  const consider = (name: string, price: number | null): void => {
    if (price === null) return;
    if (best === null || price < best.price) best = { name, price };
  };

  for (const copy of academy.yard.upgrades) {
    const id = upgradeIds.find((known) => known === copy.id);
    if (id === undefined) continue;
    consider(copy.name, upgradeCost(player, id));
  }

  if (player.unlockedLevel >= roomUnlockLevel('workbench')) {
    for (const copy of academy.workbench.staffs) {
      const id = weaponIds.find((known) => known === copy.id);
      if (id === undefined) continue;
      consider(copy.name, staffCost(player, id));
    }
  }

  if (familiarUnlocked(player)) consider(academy.sanctum.name, familiarCost(player));

  if (best === null) return null;
  // Narrowed by hand: TypeScript loses the assignment made inside `consider`.
  const found: { name: string; price: number } = best;
  return {
    name: found.name,
    price: found.price,
    missing: Math.max(0, Math.ceil(found.price - player.coins)),
  };
}
