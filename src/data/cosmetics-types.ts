/**
 * Schema for `cosmetics.json`: the tints the Wardrobe sells for kills (D53).
 *
 * Tints only, and deliberately: a mesh is an asset, a rig and a load, and a tint
 * is a colour multiplied into a material that is already on screen. Every entry
 * here is therefore a *look* on one of four slots, and the whole of what render
 * has to do with it is multiply.
 *
 * A tint is written one of two ways, and both mean the same thing to render:
 *
 *   a palette role   `"spell.ember.body"` — a dotted path into `palette.json`.
 *                    Use this when the tint is a colour the game already has a
 *                    name for, so a palette change carries it.
 *   a triple         `[1.1, 0.9, 0.8]` — multipliers on the material's own
 *                    r, g and b. Use this when the look is a *shift* of
 *                    whatever is underneath rather than a colour of its own,
 *                    which is the only thing that works on the wisp's trail.
 *
 * Nothing here is unlocked by coins: every entry names a bestiary kind and one
 * of that kind's three tiers (`academy.json`, `bestiary.entries[].tiers`), and
 * crossing the tier is what puts the id in `CosmeticsState.owned`.
 */

import cosmeticsJson from './cosmetics.json';
import type { CosmeticSlot, KillKind } from './meta-types';

export type { CosmeticSlot };

/** Which of a bestiary kind's three tiers hands this tint over. */
export type CosmeticTier = 1 | 2 | 3;

export interface CosmeticDef {
  /** Stable: it is what a save carries, and what `selected` points at. */
  id: string;
  slot: CosmeticSlot;
  /** What the Wardrobe calls it. */
  name: string;
  /** A palette role, or three multipliers. See the note above. */
  tint: string | number[];
  unlockedBy: { kind: KillKind; tier: CosmeticTier };
}

export interface SlotCopy {
  id: CosmeticSlot;
  /** The Wardrobe's heading for this slot's row. */
  name: string;
}

export interface CosmeticsData {
  wardrobe: {
    heading: string;
    /** The "wearing nothing" chip, which every slot starts on. */
    noneName: string;
    /** `{kind}` and `{kills}` — what a locked tint says instead of its name. */
    lockedHint: string;
  };
  slots: readonly SlotCopy[];
  entries: readonly CosmeticDef[];
}

/** Narrows the file's strings to the unions, as `src/data/index.ts` does. */
export const cosmetics: CosmeticsData = cosmeticsJson as CosmeticsData;

/**
 * The id that means "wearing nothing". Not an entry in the file: it is the
 * absence of one, and a slot missing from `CosmeticsState.selected` is it.
 */
export const NO_COSMETIC = 'none';

export function cosmeticDef(id: string): CosmeticDef | null {
  return cosmetics.entries.find((entry) => entry.id === id) ?? null;
}

/** The tints for one slot, in file order — the order the Wardrobe shows them. */
export function cosmeticsForSlot(slot: CosmeticSlot): readonly CosmeticDef[] {
  return cosmetics.entries.filter((entry) => entry.slot === slot);
}

/** The palette role this tint names, or null when it is a triple. */
export function tintRole(entry: CosmeticDef): string | null {
  return typeof entry.tint === 'string' ? entry.tint : null;
}

/**
 * The three multipliers this tint names, or null when it is a palette role. A
 * short or malformed triple reads as null rather than as a black material.
 */
export function tintTriple(entry: CosmeticDef): [number, number, number] | null {
  const raw = entry.tint;
  if (typeof raw === 'string' || raw.length < 3) return null;
  const [r, g, b] = raw;
  if (r === undefined || g === undefined || b === undefined) return null;
  return [r, g, b];
}
