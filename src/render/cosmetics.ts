/**
 * The worn tints, as the renderer needs them (D53).
 *
 * A cosmetic is a *multiplier* and nothing else: the whole of what render does
 * with one is multiply it into a colour it is already drawing — the mage's hat
 * and cape patches, the wisp's own hue, the tint the spell sprites are drawn
 * with. So this file turns the two ways a tint is written
 * (`src/data/cosmetics-types.ts`) into one shape: three numbers.
 *
 * A **triple** is already that. A **palette role** is a colour, and a colour is
 * not a multiplier — multiplying by a role straight would darken everything it
 * touched, because every channel of a palette colour is below one. So a role is
 * normalised to its own average: the result carries the role's *hue* at
 * unchanged brightness, which is exactly what "wear this colour" means on a
 * material whose brightness was already chosen by the artist.
 *
 * `wornCosmetic` is the source (`src/core/cosmetics.ts`): the save says which
 * id is in each slot and the manifest says what that id is. Nothing here reads
 * the save itself.
 */

import { wornCosmetic } from '@/core/cosmetics';
import type { PlayerState } from '@/core/player';
import { tintTriple } from '@/data';
import type { CosmeticDef, CosmeticSlot } from '@/data';

import { paletteColor } from './palette';
import type { PaletteRole } from './palette';
import type { SceneViews } from './views';

/**
 * The two parts of the mage a cosmetic dresses (D53), by their name in
 * `mage.glb` — the same names `assets.json` keys its `tints` and `tintPatches`
 * by, and the ones `docs/ASSETS.md` records. A re-export of the art with
 * different mesh names is a change here and in the manifest together.
 */
export const HAT_PART = 'Mage_Hat';
export const CAPE_PART = 'Mage_Cape';

/**
 * What those two parts *read as on screen today*, as a hue at mean 1.
 *
 * Measured, not derived, and that is the point. A part's colour in frame is the
 * atlas texel times the manifest's tint (`src/render/characters/tint.ts`), and
 * neither half is knowable from here: the hat's texel is a near-black navy and
 * its tint is a violet multiplier, and their product is the violet the player
 * sees. A cosmetic has to move *that* — so the dye below divides by it.
 *
 * Read off a frame of the shipped art (a Milestone 8 probe averaged every
 * strongly-coloured pixel of a bare crowd: the hats came back 119/87/192 and
 * the capes 189/29/93). If the mage is re-exported, or the manifest's `tints`
 * change, these have to be measured again — exactly like the `tintPatches`
 * rectangles they sit beside.
 */
export const HAT_LOOK: Tint = [0.9, 0.65, 1.45];
export const CAPE_LOOK: Tint = [1.82, 0.28, 0.9];

/**
 * The multiplier that turns a part's current look into the worn tint.
 *
 * `H / LOOK`: the vertex colours of that part are multiplied by it, so the
 * product of texel, manifest tint and this comes out as the cosmetic's hue at
 * the brightness the artist chose. Multiplying by the tint alone does not work
 * — the Phase C probe photographed a crowd in unchanged violet — because the
 * thing being multiplied is already strongly coloured.
 */
export function dyeAgainst(tint: Tint, look: Tint, out: [number, number, number]): void {
  out[0] = Math.pow(tint[0] / Math.max(0.05, look[0]), DYE_STRENGTH);
  out[1] = Math.pow(tint[1] / Math.max(0.05, look[1]), DYE_STRENGTH);
  out[2] = Math.pow(tint[2] / Math.max(0.05, look[2]), DYE_STRENGTH);
}

/**
 * How hard the correction above pulls.
 *
 * One would be exact if `HAT_LOOK` were the material's own linear colour. It is
 * not: it was measured off the *screen*, after a tone curve that compresses
 * every channel towards each other (`src/render/scene.ts`), so the hue it
 * reports is flatter than the one the shader is working with and dividing by it
 * under-corrects. Squaring is what the probe settled on — at 1 the dyed hat is
 * a dusty version of the old violet, and at 2 it is the colour on the chip.
 */
const DYE_STRENGTH = 2;

/**
 * The crowd's own dye job: the worn hat and cape as a map of part name to
 * multiplier, ready for `Crowd.setPartTints`.
 *
 * Here rather than in `./squad.ts` because every number it needs is in this
 * file — the part names, what those parts read as on screen, and the
 * correction between the two — and the squad's only interest in it is that it
 * has one map to hand its three crowds.
 *
 * Writes into the caller's map and the caller's two triples rather than
 * allocating: a wardrobe change is a level load rather than a frame, but a
 * player trying six hats on should not leave six maps behind. A bare slot is
 * *left out* rather than written as the identity, because what a crowd is
 * given is a correction against what the part already looks like, and there is
 * nothing to correct on a part nobody is dressing.
 */
export function partTintsInto(
  tints: WornTints,
  out: Map<string, readonly [number, number, number]>,
  hatDye: [number, number, number],
  capeDye: [number, number, number],
): void {
  out.clear();
  if (!isBare(tints.hat)) {
    dyeAgainst(tints.hat, HAT_LOOK, hatDye);
    out.set(HAT_PART, hatDye);
  }
  if (!isBare(tints.cape)) {
    dyeAgainst(tints.cape, CAPE_LOOK, capeDye);
    out.set(CAPE_PART, capeDye);
  }
}

/** Three multipliers on r, g and b. Identity is `[1, 1, 1]`. */
export type Tint = readonly [number, number, number];

export const NO_TINT: Tint = [1, 1, 1];

/** Every slot's multiplier for one player; `NO_TINT` where nothing is worn. */
export interface WornTints {
  hat: Tint;
  cape: Tint;
  wisp: Tint;
  staffGlow: Tint;
}

export const BARE_TINTS: WornTints = {
  hat: NO_TINT,
  cape: NO_TINT,
  wisp: NO_TINT,
  staffGlow: NO_TINT,
};

/**
 * Dresses the scene in what the player is wearing (D53): the squad's hat and
 * cape, the wisp's colour and trail, and the glow on the spell sprites.
 *
 * One call at a level load and at every Academy backdrop, never per frame.
 */
export function applyCosmetics(views: SceneViews, tints: WornTints): void {
  views.squad.setCosmetics(tints);
  views.wisp.setCosmetic(tints.wisp);
  views.projectiles.setStaffGlow(tints.staffGlow);
  views.effects.setStaffGlow(tints.staffGlow);
}

/** What this player is wearing, resolved to multipliers. */
export function wornTints(player: PlayerState | null): WornTints {
  if (player === null) return BARE_TINTS;
  return {
    hat: tintFor(player, 'hat'),
    cape: tintFor(player, 'cape'),
    wisp: tintFor(player, 'wisp'),
    staffGlow: tintFor(player, 'staffGlow'),
  };
}

/**
 * True for the identity tint — nothing worn in that slot.
 *
 * Worth a function of its own because it is the one case every dye below has
 * to leave completely alone: a slot with no cosmetic in it must come out as
 * the colour the artist painted, not as a grey of the same brightness.
 */
export function isBare(tint: Tint): boolean {
  return tint[0] === 1 && tint[1] === 1 && tint[2] === 1;
}

/**
 * Dyes a colour: the cosmetic's *hue* at the colour's own brightness.
 *
 * This is the rule for every slot, and it is not the obvious one. A tint was
 * first multiplied into whatever was underneath, which is what a tint normally
 * means — and it did not work, for a reason worth keeping: the things a
 * cosmetic dresses are already strongly coloured. The mage's hat is a 2.0/0.8/3.0
 * violet in the manifest and the wisp is a green; multiplying a warm stone hue
 * into either leaves a violet hat and a green wisp with a faint warm cast, and
 * the player who just earned "Stonecap" sees nothing at all (the Phase C probe
 * `squad-hat-tint-2x.png`, first run).
 *
 * So a tint *replaces* the hue and keeps the value: the mean of what is there
 * times the tint. A hat whose brim is the lightest part of it stays a hat whose
 * brim is the lightest part of it, and it is the colour the player chose. What
 * is lost is the second hue inside a part — the hat band's gold against its
 * violet — which is the honest price of dressing a crowd with a multiplier
 * rather than a texture (D53: tints only, meshes may follow).
 */
export function dyeToRef(
  r: number,
  g: number,
  b: number,
  tint: Tint,
  out: [number, number, number],
): void {
  if (isBare(tint)) {
    out[0] = r;
    out[1] = g;
    out[2] = b;
    return;
  }
  const value = (r + g + b) / 3;
  out[0] = value * tint[0];
  out[1] = value * tint[1];
  out[2] = value * tint[2];
}

/** True when nothing in either set differs, so a repaint can be skipped. */
export function sameTints(a: WornTints, b: WornTints): boolean {
  return (
    sameTint(a.hat, b.hat) &&
    sameTint(a.cape, b.cape) &&
    sameTint(a.wisp, b.wisp) &&
    sameTint(a.staffGlow, b.staffGlow)
  );
}

function sameTint(a: Tint, b: Tint): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function tintFor(player: PlayerState, slot: CosmeticSlot): Tint {
  const def = wornCosmetic(player, slot);
  return def === null ? NO_TINT : tintOf(def);
}

/**
 * One entry as three multipliers. A role is normalised to its own average (see
 * the file's note); a triple is taken as written, and a malformed one is the
 * identity rather than a black material.
 */
export function tintOf(def: CosmeticDef): Tint {
  const triple = tintTriple(def);
  if (triple !== null) return triple;
  if (typeof def.tint !== 'string') return NO_TINT;
  // The role union is derived from `palette.json` and a cosmetic's role is a
  // string in another JSON file, so the two can only be checked against each
  // other at runtime: an unknown role wears nothing rather than throwing.
  const color = paletteOrNull(def.tint);
  if (color === null) return NO_TINT;
  const mean = (color.r + color.g + color.b) / 3;
  if (mean <= 0.001) return NO_TINT;
  return [color.r / mean, color.g / mean, color.b / mean];
}

/** `paletteColor` for a role the file may not carry; null when it does not. */
function paletteOrNull(role: string): { r: number; g: number; b: number } | null {
  try {
    // The cast is the runtime check above: `paletteColor` throws on a role the
    // palette has no entry for, which is what the catch is here for.
    return paletteColor(role as PaletteRole);
  } catch {
    return null;
  }
}
