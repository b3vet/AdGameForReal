/**
 * Typed access to the tuning JSON. Import from here rather than reaching for
 * the `.json` files directly, so the schema is checked in one place.
 */

import audioJson from './audio.json';
import balanceJson from './balance.json';
import endlessJson from './endless.json';
import levelsJson from './levels.json';
import type { AudioMix } from './audio-types';
import type { Balance, EndlessConfig, LevelGenConfig } from './types';

export type { Balance, EndlessConfig, LevelGenConfig, ValueRange, EnemyBalance, BossBalance } from './types';
export type { AudioMix } from './audio-types';

export const balance: Balance = balanceJson;

/**
 * The endless road's dials (D52). Cast for the same reason `levels` below is:
 * `biomes` is a string-literal union and a JSON module's strings widen.
 */
export const endless: EndlessConfig = endlessJson as EndlessConfig;

/** Mix and throttles for `src/audio`; see `audio-types.ts`. */
export const audioMix: AudioMix = audioJson;

/**
 * The cast is the one place a JSON import's widened strings are narrowed:
 * `biome` and `boss.kind` are string-literal unions (D49) and TypeScript reads
 * a `.json` module's strings as `string`. Doing it here rather than at every
 * read site is the whole point of this file.
 */
export const levels: readonly LevelGenConfig[] = levelsJson as readonly LevelGenConfig[];

/**
 * Level configs are 1-indexed for players. Out-of-range indices clamp to the
 * first or last level rather than throwing, so a bad `?level=` query parameter
 * still boots a playable run.
 */
export function levelConfig(index: number): LevelGenConfig {
  const clamped = Math.min(Math.max(1, Math.floor(index)), levels.length);
  const config = levels[clamped - 1];
  if (config === undefined) {
    throw new Error(`levels.json is empty; cannot resolve level ${String(index)}`);
  }
  return config;
}

export const levelCount = levels.length;

/**
 * The Milestone 8 meta layer, re-exported so `@/data` stays the one import site
 * (D51, D53). The pool, the Wardrobe's tints and the shapes the save carries
 * are *data with copy in them*, so each keeps its own `*-types.ts` beside its
 * JSON; this file is the door onto all of them.
 */
export { missionDef, missions } from './missions-types';
export type {
  MissionDef,
  MissionKind,
  MissionsData,
  StreakTuning,
} from './missions-types';

export {
  NO_COSMETIC,
  cosmeticDef,
  cosmetics,
  cosmeticsForSlot,
  tintRole,
  tintTriple,
} from './cosmetics-types';
export type { CosmeticDef, CosmeticTier, CosmeticsData, SlotCopy } from './cosmetics-types';

export { killKinds } from './meta-types';
export type {
  CosmeticSlot,
  CosmeticsState,
  EndlessState,
  KillKind,
  LevelBest,
  MissionState,
  MissionsState,
  StreakState,
} from './meta-types';

export type { BestiaryCopy, BestiaryTier } from './academy-types';
