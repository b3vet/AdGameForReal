/**
 * Typed access to the tuning JSON. Import from here rather than reaching for
 * the `.json` files directly, so the schema is checked in one place.
 */

import balanceJson from './balance.json';
import levelsJson from './levels.json';
import type { Balance, LevelGenConfig } from './types';

export type { Balance, LevelGenConfig, ValueRange, EnemyBalance, BossBalance } from './types';

export const balance: Balance = balanceJson;

export const levels: readonly LevelGenConfig[] = levelsJson;

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
