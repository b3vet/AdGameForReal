/**
 * The Milestone 8 meta layer's shapes (D51, D52, D53): the streak, the
 * missions, the kill counters behind the bestiary tiers, the cosmetics, the
 * endless record and the per-level bests.
 *
 * Pinned by the Contracts block of docs/23-milestone-8-plan.md so the meta
 * track (`src/core`), the sim and the screens could be written at the same
 * time. Everything here is saved rather than shipped, and the sim reads none
 * of it: `PlayerState` carries the fields (`./progression-types.ts`) because
 * the save is one object, but `playerMods` resolves nothing out of them and a
 * run is the run it was whatever they hold.
 *
 * Owned by the meta-core track; written here by the sim track only so that
 * `PlayerState` could gain its fields first (the plan's "Phase A creates it
 * first thing; exact shapes").
 */

/** The daily streak, on the *device* clock: `src/core` reads it, `src/sim` never does. */
export interface StreakState {
  days: number;
  /** 'YYYY-MM-DD' in the device's own timezone. */
  lastDay: string;
}

export interface MissionState {
  id: string;
  progress: number;
  done: boolean;
}

/** `rolled` drives the seeded pool order, so a draw is reproducible. */
export interface MissionsState {
  active: MissionState[];
  rolled: number;
}

export type CosmeticSlot = 'hat' | 'cape' | 'wisp' | 'staffGlow';

export interface CosmeticsState {
  owned: string[];
  selected: Partial<Record<CosmeticSlot, string>>;
}

export interface EndlessState {
  bestMetres: number;
  runs: number;
}

/** What a kill counter counts. One per monster kind plus the two bosses. */
export type KillKind = 'grunt' | 'brute' | 'charger' | 'shieldBrute' | 'demon' | 'rime';

export const killKinds: readonly KillKind[] = [
  'grunt',
  'brute',
  'charger',
  'shieldBrute',
  'demon',
  'rime',
];

/** The best run of one level, keyed by the level index as a string. */
export interface LevelBest {
  survivors: number;
  peak: number;
}
