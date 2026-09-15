/**
 * The campaign's shopper: which of the things the Academy sells a player would
 * buy next, and what it is worth to them.
 *
 * Split out of `./campaign.ts` in Milestone 8 on the seam that file's own note
 * already draws: *running* a campaign is one thing — twelve attempts a level, a
 * purse, a bot — and *shopping* is another. The purchase rules themselves are
 * neither; they live once in `./player.ts` and `src/core/player.ts` delegates
 * to them, so the economy measured here is the one the player spends through.
 *
 * What is here is the taste: every row on the shelf priced by the output it
 * buys per coin, and the rule that a player saves rather than spending on
 * something worth less (D46, D54). The Academy has no opinion about any of it.
 */

import {
  buyFamiliar,
  buyStaff,
  buyUpgrade,
  familiarCost,
  maxStaffTier,
  nextUpgradeCost,
  progression,
  roomOpen,
  selectStaff,
  staffCost,
  staffPrices,
  staffTierOf,
  upgradeIds,
} from './player';
import { weaponIds } from './weapons';
import type { FamiliarTier, PlayerState, StaffWorth, UpgradeId, WeaponId } from '@/data/types';

export type PurchaseKind = 'upgrade' | 'staff' | 'evolution' | 'wisp';

export interface Purchase {
  kind: PurchaseKind;
  /** What the row would read: `damage`, `storm`, `storm+3`, `wisp2`. */
  label: string;
  cost: number;
}

/**
 * What `id` is worth to the player who buys it, as a share of the squad's own
 * output. Padded like `staffPrices` and floored at zero: a measured worth can
 * come out *negative* — frost's glacier reads at minus two percent on a meadow
 * level, which is a wall holding a river the column then walks into — and a
 * negative price per coin would sort below "nothing at all", which is not a
 * thing the shop can sell. Zero says the same and keeps the ranking a
 * comparison of gains.
 *
 * The `unlock` figure is the one number here that is a *model* rather than a
 * measurement, and deliberately: measured on fixed levels with a bot that never
 * changes its mind, carrying storm instead of ember is worth three percent on
 * a meadow level and nothing on a frost one, and carrying frost is worth less
 * than nothing on both. But a second staff is a sidegrade the player picks for
 * the row in front of them (D26) and the bot cannot pick anything, so what the
 * measurement reads is the bot's blindness rather than the staff's worth. Both
 * are priced a little above storm's best measured figure, which keeps the
 * Workbench selling them at level 5 as it always has and keeps the kit the
 * Frostfell bands are measured on the one D49 set.
 */
export function staffWorth(id: WeaponId): StaffWorth {
  const worth = progression.staffs[id].worth;
  const ladder = worth.evolve;
  const first = Math.max(0, ladder[0] ?? 0);
  const second = Math.max(0, ladder[1] ?? first);
  return {
    unlock: Math.max(0, worth.unlock),
    evolve: [first, second, Math.max(0, ladder[2] ?? second)],
  };
}

/** What reaching wisp tier `tier` is worth, on the same scale as `staffWorth`. */
export function familiarWorth(tier: FamiliarTier): number {
  return Math.max(0, progression.wisp.worth[tier] ?? 0);
}

/**
 * What one more level of an upgrade is worth, as a share of the squad's output,
 * so the shopper can compare five rows that are priced the same. Read off
 * `progression.json` and the run just played rather than a table of tastes:
 * `startCount` is one unit against the units the level starts with, and
 * `bossDamage` only counts for the share of the run that was the boss fight.
 *
 * That last one is the shelf's one known under-estimate, left standing on
 * purpose. Measured end to end (`./__tests__/worth.test.ts`, 24 seeds), a rung
 * of `bossDamage` is worth six percent of output on level 12 and ten on level
 * 28 — as much as a rung of `damage` — because the boss fight is not a quarter
 * of a run that happens to be at the end of it, it is where the crowd is lost.
 * The model prices it at a quarter of that and the shopper buys it last. Two
 * things could close the gap and neither is free: raising `effects.bossDamage`
 * to the size that makes the *model* agree takes level 28's armed clears to ten
 * in ten, well over D45's ceiling (measured at 0.3), and correcting the weight
 * here moves the kit every Frostfell recipe was fitted against. So the number
 * stands, the bands are measured on the hand it produces, and the player who
 * buys the rung the shopper skips is better off than the bands say rather than
 * worse (the Milestone 8 log).
 */
function upgradeWorth(id: UpgradeId, startCount: number, bossShare: number): number {
  const effects = progression.upgrades.effects;
  if (id === 'startCount') return effects.startCount / Math.max(1, startCount);
  if (id === 'bossDamage') return effects.bossDamage * bossShare;
  return effects[id];
}

/** A shelf row with the one number the shopper ranks the whole Academy by. */
interface Valued extends Purchase {
  /** Output share bought per coin. Bigger is better; zero never sells. */
  value: number;
}

/** The better of two rows, ties going to the one offered first, so it is stable. */
function better(a: Valued | null, b: Valued | null): Valued | null {
  if (a === null) return b;
  if (b === null) return a;
  return b.value > a.value ? b : a;
}

/**
 * What the next rung of `id`'s evolution ladder is worth per coin (D54).
 *
 * Not the rung's own worth over its own price, but the best worth-per-coin of
 * any *goal* the rung is a step toward — tier 3, or tier 4 beyond it. A ladder
 * is climbed one rung at a time and the rungs are not equally good: measured,
 * storm's arc is worth three percent of output at tier 2 and sixteen at tier 4,
 * while ember's is worth thirteen at tier 2 and under two at tier 3 (the
 * Milestone 8 log). A shopper that priced only the next rung would refuse
 * storm's first two forever and never reach the overcharge, which is not what
 * a player saving for it does.
 */
function ladderValue(player: PlayerState, id: WeaponId): number {
  const tier = staffTierOf(player, id);
  const prices = staffPrices(id).evolve;
  const worths = staffWorth(id).evolve;
  let cost = 0;
  let worth = 0;
  let best = 0;
  for (let step = tier; step < maxStaffTier; step++) {
    cost += prices[step - 1] ?? 0;
    worth += worths[step - 1] ?? 0;
    if (cost > 0) best = Math.max(best, worth / cost);
  }
  return best;
}

/**
 * The most useful thing the Academy will sell this player right now: the best
 * output per coin on the whole shelf, bought when the purse covers it and saved
 * for when it does not.
 *
 * Every row is ranked by one number — what it adds to the squad's output, over
 * what it costs — so the yard, the Workbench and the Sanctum compete on the
 * same terms. The yard's rungs cost `costGrowth` more each time, so their value
 * per coin falls as the campaign climbs, and that fall is what eventually puts
 * an evolution or a wisp at the top of the shelf. Before Milestone 8 the yard
 * was simply tried first and the shopper bought the cheapest thing it could
 * afford, so the purse never grew past one rung and a forty-level campaign
 * never bought a single evolution (the Milestone 8 log's wave-one finding).
 *
 * Null means *save*, not "nothing to buy": the best row costs more than the
 * purse holds, and the player keeps their coins rather than spending them on
 * something worth less per coin. That is the other half of what makes an
 * evolution reachable, and it is why a runs-per-purchase figure bigger than one
 * is possible at all.
 *
 * `evolutions` is false for the campaign that measures the hand a player who
 * never touches the Workbench's ladders ends up with — the hand D54's "never
 * mandatory below level 40" is defined on (`balance.test.ts`).
 *
 * Exported for the economy tests, which ask it what a given purse would be
 * sold next.
 */
export function bestOffer(
  player: PlayerState,
  startCount: number,
  bossShare: number,
  evolutions = true,
): Purchase | null {
  let best: Valued | null = null;

  for (const id of upgradeIds) {
    const cost = nextUpgradeCost(player, id);
    if (cost === null || cost <= 0) continue;
    const worth = upgradeWorth(id, startCount, bossShare);
    if (worth > 0) best = better(best, { kind: 'upgrade', label: id, cost, value: worth / cost });
  }

  if (roomOpen('workbench', player)) {
    for (const id of weaponIds) {
      const tier = staffTierOf(player, id);
      if (tier === 0) {
        const cost = staffPrices(id).unlock;
        const worth = staffWorth(id).unlock;
        if (cost > 0 && worth > 0) {
          best = better(best, { kind: 'staff', label: id, cost, value: worth / cost });
        }
        continue;
      }
      if (!evolutions || tier >= maxStaffTier) continue;
      // The same price the Workbench would show for this staff's next step.
      const cost = staffCost(player, id);
      const value = ladderValue(player, id);
      if (cost !== null && cost > 0 && value > 0) {
        best = better(best, {
          kind: 'evolution',
          label: `${id}+${String(tier + 1)}`,
          cost,
          value,
        });
      }
    }
  }

  if (roomOpen('sanctum', player)) {
    const cost = familiarCost(player);
    const next = ((player.familiar.unlocked ? player.familiar.tier : 0) + 1) as FamiliarTier;
    const worth = familiarWorth(next);
    if (cost !== null && cost > 0 && worth > 0) {
      best = better(best, {
        kind: 'wisp',
        label: `wisp${String(next)}`,
        cost,
        value: worth / cost,
      });
    }
  }

  if (best === null || best.cost > player.coins) return null;
  return { kind: best.kind, label: best.label, cost: best.cost };
}

/**
 * Takes the offer through the shipped purchase rules, or null if they refuse.
 *
 * A refusal is not expected — `bestOffer` only ever names something the same
 * rules priced and the purse can cover — and that is exactly why it is passed
 * on rather than swallowed: if the shopping above and the rules below ever
 * disagree, the campaign stalls on the spot and `economy.test.ts` sees it,
 * instead of quietly measuring an economy nobody can buy.
 */
export function buy(player: PlayerState, offer: Purchase): PlayerState | null {
  if (offer.kind === 'upgrade') {
    const id = upgradeIds.find((known) => known === offer.label);
    return id === undefined ? null : buyUpgrade(player, id);
  }
  if (offer.kind === 'wisp') return buyFamiliar(player);
  const id = weaponIds.find((known) => offer.label.startsWith(known));
  if (id === undefined) return null;
  const bought = buyStaff(player, id);
  if (bought === null || offer.kind !== 'evolution') return bought;
  // A player who pays for an evolution carries the staff that has it: every
  // mechanic D54 adds is keyed to the staff in hand, so evolving the staff in
  // the pack is buying nothing. Unlocking already selects (`buyStaff`); this is
  // the same rule one rung further up, and it is shopping rather than a
  // purchase rule, so it lives here.
  return selectStaff(bought, id) ?? bought;
}
