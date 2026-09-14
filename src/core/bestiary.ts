/**
 * Kill counters and the tint ladders they pay (D53).
 *
 * The Bestiary was a list of things met (D33). Milestone 8 gives every entry a
 * number and three rungs: kill enough Grunts and the Wardrobe gains a hat.
 * Counting happens here rather than in the sim for the usual reason — a run is
 * the run it is whatever the player has killed before — and the counters come
 * off `enemyKilled` and the boss's death, which `RunTracker` has already
 * totalled by the time anything here runs.
 *
 * A rung is paid on the *crossing*, computed from the count before the run and
 * the count after it: `before < rung.kills <= after`. That is what makes a
 * payment happen exactly once without a second list of "rungs already taken" in
 * the save — and it survives a hand-edited counter, because a save that jumps
 * from 0 to 9000 crosses all three rungs in one run and is paid for all three.
 */

import { academy } from '@/data/academy-types';
import { cosmeticDef, killKinds } from '@/data';
import type { BestiaryTier, KillKind } from '@/data';

/** Kills by kind. The same shape `PlayerState.kills` carries. */
export type KillCounts = Record<KillKind, number>;

export function emptyKills(): KillCounts {
  return { grunt: 0, brute: 0, charger: 0, shieldBrute: 0, demon: 0, rime: 0 };
}

/** The kill ladder of one bestiary entry, in rising order; empty when it has none. */
export function tiersOf(kind: string): readonly BestiaryTier[] {
  const entry = academy.bestiary.entries.find((candidate) => candidate.id === kind);
  const tiers = entry?.tiers ?? [];
  return [...tiers].sort((a, b) => a.kills - b.kills);
}

/** One rung the run just crossed, for the result sheet and the Wardrobe's bump. */
export interface TierAward {
  kind: KillKind;
  /** 1, 2 or 3 — which rung of this entry's ladder. */
  tier: number;
  coins: number;
  /** The cosmetic id the rung hands over; '' when the rung names none. */
  cosmetic: string;
  /** What the Wardrobe calls that cosmetic, for the copy. */
  cosmeticName: string;
}

export interface KillOutcome {
  kills: KillCounts;
  /** Ids to add to `CosmeticsState.owned`; already deduplicated. */
  unlocked: string[];
  coins: number;
  awards: TierAward[];
}

/**
 * Adds one run's kills to the running totals and pays whatever rungs that
 * crossed.
 *
 * `owned` is passed in rather than a whole `PlayerState` so this stays pure
 * arithmetic over two records: the caller (`./meta.ts`) owns the player.
 */
export function creditKills(
  before: KillCounts,
  run: KillCounts,
  owned: readonly string[],
): KillOutcome {
  const kills = emptyKills();
  const unlocked: string[] = [];
  const awards: TierAward[] = [];
  let coins = 0;

  for (const kind of killKinds) {
    const was = Math.max(0, Math.floor(before[kind]));
    const now = was + Math.max(0, Math.floor(run[kind]));
    kills[kind] = now;

    const tiers = tiersOf(kind);
    for (let i = 0; i < tiers.length; i++) {
      const tier = tiers[i];
      if (tier === undefined) continue;
      if (was >= tier.kills || now < tier.kills) continue;

      coins += Math.max(0, Math.round(tier.coins));
      const id = tier.cosmetic;
      const def = cosmeticDef(id);
      if (def !== null && !owned.includes(id) && !unlocked.includes(id)) unlocked.push(id);
      awards.push({
        kind,
        tier: i + 1,
        coins: Math.max(0, Math.round(tier.coins)),
        cosmetic: def === null ? '' : id,
        cosmeticName: def?.name ?? '',
      });
    }
  }

  return { kills, unlocked, coins, awards };
}

// --- The room's view -------------------------------------------------------

/** One rung as the Bestiary card draws it. */
export interface TierView {
  kills: number;
  coins: number;
  cosmetic: string;
  cosmeticName: string;
  /** True once the player's count has reached this rung. */
  taken: boolean;
}

/** One bestiary card (D33's entry, D53's ladder). */
export interface BestiaryEntryView {
  id: string;
  name: string;
  blurb: string;
  /** False until the player has met one, which is what hides the blurb. */
  seen: boolean;
  kills: number;
  tiers: TierView[];
  /** '{count} felled', filled. */
  countLabel: string;
  /** '{remaining} more for {name}', or the maxed line when the ladder is done. */
  nextLabel: string;
}

/**
 * Every bestiary card, in `academy.json` order.
 *
 * Entries without a kill ladder still draw: an entry is a thing the player has
 * met first and a ladder second, and a manifest that gains a monster before it
 * gains its rungs should show the monster.
 */
export function bestiaryView(
  kills: KillCounts,
  seen: readonly string[],
): readonly BestiaryEntryView[] {
  const copy = academy.bestiary;
  const views: BestiaryEntryView[] = [];

  for (const entry of copy.entries) {
    const kind = killKinds.find((candidate) => candidate === entry.id) ?? null;
    const count = kind === null ? 0 : Math.max(0, Math.floor(kills[kind]));
    const tiers = tiersOf(entry.id);

    const rows: TierView[] = [];
    let next: BestiaryTier | null = null;
    for (const tier of tiers) {
      const def = cosmeticDef(tier.cosmetic);
      const taken = count >= tier.kills;
      if (!taken && next === null) next = tier;
      rows.push({
        kills: tier.kills,
        coins: tier.coins,
        cosmetic: def === null ? '' : tier.cosmetic,
        cosmeticName: def?.name ?? '',
        taken,
      });
    }

    const nextTier: BestiaryTier | null = next;
    views.push({
      id: entry.id,
      name: entry.name,
      blurb: entry.blurb,
      seen: seen.includes(entry.id),
      kills: count,
      tiers: rows,
      countLabel: fill(copy.tierLabel, { count: String(count) }),
      nextLabel:
        nextTier === null
          ? copy.maxedLabel
          : fill(copy.nextLabel, {
              remaining: String(Math.max(0, nextTier.kills - count)),
              name: cosmeticDef(nextTier.cosmetic)?.name ?? nextTier.cosmetic,
            }),
    });
  }

  return views;
}

/**
 * `{token}` substitution, the same one the Academy's copy uses elsewhere
 * (`src/ui/academy.ts` has its own; this is core's, so a view can be built and
 * tested without a DOM).
 */
function fill(template: string, values: Record<string, string>): string {
  let text = template;
  for (const key of Object.keys(values)) {
    text = text.split(`{${key}}`).join(values[key] ?? '');
  }
  return text;
}
