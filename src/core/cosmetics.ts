/**
 * The Wardrobe (D53): what the player owns, what they are wearing, and the one
 * rule that matters — a tint cannot be worn until a bestiary rung has paid it
 * out.
 *
 * Tints only. The whole of what render does with an entry is multiply a colour
 * into a material it is already drawing (`src/data/cosmetics-types.ts` explains
 * the two ways a tint is written), so nothing here loads, allocates or knows
 * about a mesh. That is what makes a cosmetic cost a string in the save.
 *
 * Every function is pure over a `PlayerState` and returns a new one or null,
 * exactly as the purchases in `src/sim/player.ts` do: only `AcademyController`
 * writes one to storage.
 */

import { academy } from '@/data/academy-types';
import { NO_COSMETIC, cosmeticDef, cosmetics as cosmeticsData, cosmeticsForSlot } from '@/data';
import type { BestiaryTier, CosmeticDef, CosmeticSlot } from '@/data';

import { clonePlayer } from './player';
import type { PlayerState } from './player';

export { NO_COSMETIC };

/** The four slots, in the order the Wardrobe lists them. */
export const cosmeticSlots: readonly CosmeticSlot[] = cosmeticsData.slots.map((slot) => slot.id);

/** True for a string `cosmetics.json` has an entry for. */
export function isCosmeticId(raw: unknown): raw is string {
  return typeof raw === 'string' && cosmeticDef(raw) !== null;
}

/**
 * Wears a tint, or takes one off.
 *
 * Returns null when the change is not allowed or would change nothing, which is
 * the same shape every purchase has: a dead chip in the room is the normal way
 * an unowned id arrives here, so this is a guard against a stale screen and not
 * an error path. `NO_COSMETIC` is always allowed — taking a hat off is not a
 * thing that can be locked — and removes the slot from `selected` rather than
 * storing a sentinel, so "wearing nothing" is the absence of a key (the
 * default selection the plan asks for).
 */
export function selectCosmetic(
  player: PlayerState,
  slot: CosmeticSlot,
  id: string,
): PlayerState | null {
  if (!cosmeticSlots.includes(slot)) return null;
  const current = player.cosmetics.selected[slot];

  if (id === NO_COSMETIC) {
    if (current === undefined) return null;
    const next = clonePlayer(player);
    // `delete` rather than a sentinel: `Partial<Record<...>>` is the pinned
    // shape, and an absent key is what every reader treats as bare.
    delete next.cosmetics.selected[slot];
    return next;
  }

  const def = cosmeticDef(id);
  if (def === null || def.slot !== slot) return null;
  if (!player.cosmetics.owned.includes(id)) return null;
  if (current === id) return null;

  const next = clonePlayer(player);
  next.cosmetics.selected[slot] = id;
  return next;
}

/**
 * Hands over tints the player has just earned (the bestiary's rungs, D53).
 * Null when every id was already owned or is not in the manifest.
 */
export function ownCosmetics(player: PlayerState, ids: readonly string[]): PlayerState | null {
  const added: string[] = [];
  for (const id of ids) {
    if (!isCosmeticId(id)) continue;
    if (player.cosmetics.owned.includes(id) || added.includes(id)) continue;
    added.push(id);
  }
  if (added.length === 0) return null;

  const next = clonePlayer(player);
  next.cosmetics.owned = [...next.cosmetics.owned, ...added];
  return next;
}

/**
 * The tint worn in one slot, or null for bare. Render's one read (Phase C):
 * everything it needs to paint is on the `CosmeticDef`.
 */
export function wornCosmetic(player: PlayerState, slot: CosmeticSlot): CosmeticDef | null {
  const id = player.cosmetics.selected[slot];
  return id === undefined ? null : cosmeticDef(id);
}

// --- The room's view -------------------------------------------------------

/** One chip in a slot's row. */
export interface CosmeticChoiceView {
  id: string;
  name: string;
  owned: boolean;
  selected: boolean;
  /** A palette role, or three multipliers; null for the bare chip. */
  tint: string | readonly number[] | null;
  /** What the chip says while it is locked: the kind and the kills it wants. */
  hint: string;
}

export interface CosmeticSlotView {
  id: CosmeticSlot;
  name: string;
  choices: CosmeticChoiceView[];
}

export interface WardrobeView {
  heading: string;
  slots: CosmeticSlotView[];
}

/**
 * The whole Wardrobe: four rows, each starting with the bare chip and then the
 * slot's tints in manifest order, locked ones included.
 *
 * Locked tints are shown rather than hidden on purpose — a ladder the player
 * cannot see is not a goal — and each says what it wants, which is a kind and
 * a number of kills the Bestiary is already counting.
 */
export function wardrobeView(player: PlayerState): WardrobeView {
  const copy = cosmeticsData.wardrobe;
  const slots: CosmeticSlotView[] = [];

  for (const slot of cosmeticsData.slots) {
    const worn = player.cosmetics.selected[slot.id];
    const choices: CosmeticChoiceView[] = [
      {
        id: NO_COSMETIC,
        name: copy.noneName,
        owned: true,
        selected: worn === undefined,
        tint: null,
        hint: '',
      },
    ];

    for (const entry of cosmeticsForSlot(slot.id)) {
      const owned = player.cosmetics.owned.includes(entry.id);
      choices.push({
        id: entry.id,
        name: entry.name,
        owned,
        selected: worn === entry.id,
        tint: entry.tint,
        hint: owned ? '' : lockedHint(entry),
      });
    }

    slots.push({ id: slot.id, name: slot.name, choices });
  }

  return { heading: copy.heading, slots };
}

/** '{kills} {kind}': the rung this tint hangs off, in the Bestiary's own words. */
function lockedHint(entry: CosmeticDef): string {
  // The Bestiary's ladder is read straight off `academy.json` rather than
  // through `./bestiary.ts`, which reads this file for its own tint names: two
  // rooms describe the same rung from opposite ends, and neither owns it.
  const kind = academy.bestiary.entries.find((candidate) => candidate.id === entry.unlockedBy.kind);
  const tiers: readonly BestiaryTier[] = kind?.tiers ?? [];
  const rung = tiers.find((tier) => tier.cosmetic === entry.id);
  return cosmeticsData.wardrobe.lockedHint
    .split('{kills}')
    .join(String(rung?.kills ?? 0))
    .split('{kind}')
    .join(kind?.name ?? entry.unlockedBy.kind);
}
