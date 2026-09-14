/**
 * Which biome a level is set in, as the renderer sees it (D49).
 *
 * A module of its own because the answer comes from three places and the
 * reason it does is worth stating once: `LevelDef.biome` is optional, so a
 * hand-built level (the render fixtures, the stress scene) carries neither it
 * nor anything else the generator writes, and `?biome=` pins the look to one
 * biome whatever the level says.
 */

import { levelConfig } from '@/data';
import type { BiomeId } from '@/data/biome-types';
import type { LevelDef } from '@/sim';

/**
 * The URL's override, then the level's own field, then the config the level
 * was generated from, then the meadow.
 */
export function biomeOfLevel(level: LevelDef, forced: BiomeId | undefined): BiomeId {
  if (forced !== undefined) return forced;
  if (level.biome !== undefined) return level.biome;
  return levelConfig(level.index).biome ?? 'meadow';
}
