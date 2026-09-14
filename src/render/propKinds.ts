/**
 * What stands beside each biome's road: the kinds, their weights, and the
 * palette recipe each is tinted with.
 *
 * Split out of `./props.ts` for the file-size rule (CLAUDE.md) when Frostfell
 * doubled the table (D49). The line between the two files is the one the road
 * files already draw: this is *what* the roadside is made of, `props.ts` is
 * how it is laid out, instanced and frozen.
 *
 * Milestone 2 dressed a night graveyard: dead trees, gravestones and lanterns.
 * Under D28's daylight the same set reads as a cemetery at noon — the wrong
 * tone entirely — so the meadow's mix is re-weighted around the pack's orange
 * pines, with the fence runs that make a country lane and a quarter as many
 * gravestones. The dead trees are gone: seen from Milestone 3's lower camera
 * they are bare trunks at eye level, and in daylight a brown trunk beside the
 * road reads as a fallen log rather than as a silhouette against the sky.
 */

import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { createIceCrystals } from './frostProps';
import { paletteColor } from './theme';
import type { PaletteRole } from './theme';
import type { BiomeId } from '@/data/biome-types';

/**
 * What stands beside the road, how often, and how far out. `weight` is relative
 * within one band; `near` and `far` are metres from the road's edge.
 */
export interface PropKind {
  id: string;
  weight: number;
  near: number;
  far: number;
  /** Extra turn applied to every instance, for props authored facing across. */
  yaw?: number;
  /** Multiplies the manifest scale, before the per-instance jitter. */
  size?: number;
  /**
   * Albedo multiplier, as a palette role rather than three numbers (D36).
   * Resolved on every biome switch, so a kind that stands in both biomes is
   * re-tinted by whatever the role means there (`PropsView.setBiome`).
   */
  tint?: Tint;
  /**
   * A flat additive wash in this role's colour — snow on a prop that no albedo
   * multiplier could ever whiten (`dustEmissive` in `./models.ts`). A kind with
   * one opts out of the ordinary `PROP_LIFT`, because the two write the same
   * material property.
   */
  dust?: Tint;
  /**
   * Biomes this kind is dressed in. Absent means every biome — the fence and
   * the torch are the same roadside furniture under any sky, only a different
   * colour of it.
   */
  biomes?: readonly BiomeId[];
  /**
   * Drawn rather than fetched: a kind with no model in the manifest builds its
   * own mesh (`./frostProps.ts`). It is then exempt from the manifest scale,
   * because there is no manifest entry to take one from.
   */
  build?: (scene: Scene) => Mesh | null;
  /**
   * True when the manifest's `scale` is already metres per model unit. The
   * KayKit *character* packs are authored at a scale the mage's own 0.35 was
   * derived from, and the roadside inherited that; the dungeon pieces (D39) are
   * authored in metres, so they must not be put through it twice.
   */
  metres?: boolean;
  /** How far below its own origin the model hangs, in model units. */
  lift?: number;
  /** A flame rides at this share of the prop's height, this many metres across. */
  flame?: { at: number; size: number };
  /** Levels this kind is dressed on. Absent means every level. */
  fromLevel?: number;
  untilLevel?: number;
}

/**
 * The re-tint, as a palette role rather than three numbers (D36).
 *
 * `mix` is how much of the role's own hue is folded into white and `gain` is
 * how much the result is lifted: the Halloween pack is painted for a night
 * scene, so every prop needs both a hue and a lift or it reads as soot under
 * D28's daylight. The gain is a look number, the hue is the palette's.
 *
 * A recipe rather than the three numbers it produces, because the roles move
 * with the biome (D49): `stone.light` is warm sand in the meadow and pale ice
 * in Frostfell, so the same recipe on the same fence gives a warm country
 * fence in one and a frozen one in the other, with nothing to keep in step.
 */
interface Tint {
  role: PaletteRole;
  mix: number;
  gain: number;
}

export function tintFrom(tint: Tint): [number, number, number] {
  const color = paletteColor(tint.role);
  const blend = (channel: number): number => (1 - tint.mix + tint.mix * channel) * tint.gain;
  return [blend(color.r), blend(color.g), blend(color.b)];
}

/** Warmer and a shade lighter, for the foliage. */
const WARM: Tint = { role: 'gold.light', mix: 0.3, gain: 1.12 };
/** For the greys — stone and iron — which go to soot under daylight. */
const PALE: Tint = { role: 'stone.light', mix: 0.45, gain: 1.3 };
/** The dungeon pieces are painted for torchlight; this brings them outside. */
const DUNGEON: Tint = { role: 'stone.light', mix: 0.35, gain: 1.18 };
/**
 * Frostfell's foliage, and the one tint here that is not a wash.
 *
 * The pack's only conifer is painted orange, and an albedo multiplier can
 * darken a channel but never lift one, so nothing turns it white — a pale
 * recipe like `PALE` leaves an autumn tree standing in a snowfield, which is
 * exactly what the first Frostfell frame showed. What a multiplier *can* do is
 * crush one channel against another, so this one takes the role's colour
 * straight (`mix` 1, no white folded in) from the deepest blue the palette
 * carries: orange times that is a dark blue-green, and a dark conifer against a
 * white verge is the right silhouette anyway. Snow country is conifer country,
 * and the ground is what says which biome this is.
 */
const FROST_FOLIAGE: Tint = { role: 'spell.frost.edge', mix: 1, gain: 1.15 };
/**
 * The snow on top of it. The conifer's atlas has almost no blue in it at all,
 * so `FROST_FOLIAGE` can only take it from orange to a dark olive — the cold
 * has to be *added*, which is what `dust` is for. At this strength the tree
 * keeps its own shading and gains a pale cast; much more and it goes flat.
 */
const FROST_DUST: Tint = { role: 'sky.horizon', mix: 1, gain: 0.2 };
/** The same on the mounds, harder: a drift is mostly snow and a little stone. */
const SNOW_DUST: Tint = { role: 'sky.horizon', mix: 1, gain: 0.3 };
/**
 * A snow drift, out of a heap of dungeon rubble.
 *
 * The same problem as the conifers and the same answer: the dungeon atlas is a
 * warm brown-grey, so a near-white recipe leaves a pile of brown rocks in a
 * snowfield. The role's colour is taken straight and pushed well past 1 — a
 * multiplier above 1 is legal and simply saturates — which lifts blue hardest,
 * green next and red least, and a warm brown put through that comes out a pale
 * cold white with a little stone left showing at its darkest corners.
 */
const SNOW: Tint = { role: 'spell.frost.body', mix: 1, gain: 2.4 };

/** From this level, the roadside lights are dungeon torches, not lanterns. */
const TORCH_FROM_LEVEL = 6;

/** Kinds only the meadow dresses with, and kinds only Frostfell does (D49). */
const MEADOW: readonly BiomeId[] = ['meadow'];
const FROST: readonly BiomeId[] = ['frost'];

export const PROP_KINDS: readonly PropKind[] = [
  {
    id: 'prop_tree_pine_orange_large',
    weight: 3.2,
    near: 2.2,
    far: 9,
    size: 1.2,
    tint: WARM,
    biomes: MEADOW,
  },
  { id: 'prop_tree_pine_orange_medium', weight: 3, near: 1.4, far: 7, tint: WARM, biomes: MEADOW },
  { id: 'prop_gravestone', weight: 0.6, near: 0.9, far: 4, tint: PALE, biomes: MEADOW },
  /**
   * The same two conifers under Frostfell's tint, as their own kinds rather
   * than as a re-tint of the pair above. A prop kind is one mesh with one
   * material, and the two biomes want different albedo multipliers on it —
   * so either the kind is duplicated or a mid-run biome change would repaint
   * the meadow's trees too. Duplicated is the cheap half: the second pair costs
   * two materials at boot and nothing at all on a frame the biome does not
   * dress with them.
   */
  {
    id: 'prop_tree_pine_orange_large',
    weight: 2.4,
    near: 2.2,
    far: 9,
    size: 1.2,
    tint: FROST_FOLIAGE,
    dust: FROST_DUST,
    biomes: FROST,
  },
  {
    id: 'prop_tree_pine_orange_medium',
    weight: 2.2,
    near: 1.4,
    far: 7,
    tint: FROST_FOLIAGE,
    dust: FROST_DUST,
    biomes: FROST,
  },
  /**
   * Frostfell's answer to the gravestone: the small sharp thing that breaks up
   * a verge of trees (`./frostProps.ts`).
   */
  {
    id: 'prop_ice_crystal',
    weight: 1.5,
    near: 0.9,
    far: 5,
    build: createIceCrystals,
    metres: true,
    biomes: FROST,
  },
  /**
   * Snow mounds: the dungeon pack's rubble heaps under a near-white tint. The
   * stone atlas is near-neutral grey, so unlike the conifers it lifts, and a
   * heap of it beside the road reads as a drift with something under it.
   */
  {
    // 8.1 x 3.5 x 3.2 m in the file — a dungeon's worth of collapsed wall. A
    // quarter of that is a drift the squad could climb over, which is what a
    // roadside mound has to be: taller and it is a cliff at the frame's edge.
    id: 'prop_dungeon_rubble_large',
    weight: 1.1,
    near: 1.3,
    far: 5.5,
    tint: SNOW,
    dust: SNOW_DUST,
    metres: true,
    size: 0.28,
    biomes: FROST,
  },
  {
    id: 'prop_dungeon_rubble_half',
    weight: 0.9,
    near: 1,
    far: 4.5,
    tint: SNOW,
    dust: SNOW_DUST,
    metres: true,
    size: 0.34,
    biomes: FROST,
  },
  /** Furniture: the same in both biomes, in the biome's own colour of grey. */
  { id: 'prop_fence', weight: 1.8, near: 0.5, far: 1.1, tint: PALE },
  {
    id: 'prop_post_lantern',
    weight: 0.8,
    near: 0.7,
    far: 1.4,
    tint: PALE,
    flame: { at: 0.88, size: 0.34 },
    untilLevel: TORCH_FROM_LEVEL - 1,
  },
  /**
   * The dungeon torch takes the lantern's place from level 6 (plan, "a few
   * torches near gates on later levels"): the same slot in the layout and the
   * same flame, in the stonework the arches and walls are built from, so the
   * later road reads as a dungeon approach rather than as a country lane. Every
   * Frostfell level is past that line, so the torch is the only light there.
   */
  {
    id: 'prop_dungeon_torch_lit',
    weight: 1.1,
    near: 0.55,
    far: 1.2,
    tint: DUNGEON,
    metres: true,
    size: 1.5,
    lift: 0.395,
    flame: { at: 0.94, size: 0.3 },
    fromLevel: TORCH_FROM_LEVEL,
  },
];

