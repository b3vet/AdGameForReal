/**
 * Which biome a level is set in, as the renderer sees it (D49).
 *
 * A module of its own because the answer comes from three places and the
 * reason it does is worth stating once: the field is new on both sides of a
 * milestone, so a level may or may not carry it, and a hand-built `LevelDef`
 * (the render fixtures, the stress scene) carries neither it nor a config.
 *
 * `LevelDef` is the sim's type and the biome is a property of the level
 * *config*, so the level is read through an interface of our own rather than
 * through the sim's — which is what lets the render and sim tracks land in
 * either order.
 */

import { levelConfig } from '@/data';
import type { BiomeId } from '@/data/biome-types';
import type { LevelDef } from '@/sim';

/** The one field of a level the renderer needs and may not yet have. */
interface BiomeCarrier {
  biome?: BiomeId;
}

/**
 * The URL's override, then the level's own field, then the config the level
 * was generated from, then the meadow.
 */
export function biomeOfLevel(level: LevelDef, forced: BiomeId | undefined): BiomeId {
  if (forced !== undefined) return forced;
  const own = (level as BiomeCarrier).biome;
  if (own !== undefined) return own;
  return levelConfig(level.index).biome ?? 'meadow';
}
