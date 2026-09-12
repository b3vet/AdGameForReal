/**
 * Schema for `progression.json`: the meta layer's own numbers, and the shape of
 * the `PlayerState` they are spent into (decisions D33 and D35).
 *
 * Split out of `./types.ts` in Milestone 4 Phase D, which had grown past the
 * file-size rule (CLAUDE.md). The line between the two is what the numbers
 * describe: `./types.ts` is the *campaign* — the road, its enemies, its gates
 * and the twenty level recipes — and this is the *player* walking it, which is
 * the one thing in `src/data` that is saved rather than shipped. `./types.ts`
 * re-exports every name here, so `@/data/types` is still the one import site.
 */

import type { WeaponId } from './weapon-types';

/** The five training-yard upgrades. Levels run 0 to `Progression.upgrades.maxLevel`. */
export type UpgradeId = 'damage' | 'fireRate' | 'startCount' | 'gateBonus' | 'bossDamage';

/** A staff is bought at tier 1 and evolved once (D33: one evolution each). */
export type StaffTier = 1 | 2;

/** 0 is "no wisp at all"; the Sanctum sells tiers 1 to 3. */
export type FamiliarTier = 0 | 1 | 2 | 3;

/**
 * Everything the meta layer remembers. The app owns it and saves it; the sim
 * only reads it, and reads it exactly once per run (D35): every upgrade is a
 * multiplier resolved at construction, so a purchase mid-run is impossible by
 * construction and the balance bands stay defined for a player with nothing
 * bought.
 */
export interface PlayerState {
  coins: number;
  upgrades: Record<UpgradeId, number>;
  staffs: Record<WeaponId, { unlocked: boolean; tier: StaffTier }>;
  /**
   * The staff a run starts with. Added to the contract's shape because
   * `staffs` is a record and a record has no order: the Workbench has to be
   * able to say *which* unlocked staff is in hand. Weapon gates still swap it
   * mid-run.
   */
  selectedStaff: WeaponId;
  familiar: { unlocked: boolean; tier: FamiliarTier };
  /** Enemy and boss ids seen, for the bestiary. The sim never reads it. */
  bestiary: string[];
  unlockedLevel: number;
}

/** Ember's evolution: a burn that ticks for a share of the hit that lit it. */
export interface BurnDef {
  /** Share of the hit's damage the whole burn is worth. */
  share: number;
  seconds: number;
  tickSeconds: number;
}

/** Frost's evolution: a shatter that sprays its neighbours. */
export interface ShatterDef {
  radius: number;
  /** Share of the killing hit each neighbour takes. */
  share: number;
}

/** One staff's tier-2 behaviour. Exactly one field is set per staff. */
export interface EvolutionDef {
  burn?: BurnDef;
  /** Storm: further targets on top of `WeaponChain.count`. */
  extraChains?: number;
  shatter?: ShatterDef;
}

/**
 * The wisp (D33). Rate and damage are indexed by tier, so index 0 is the
 * "no wisp" slot and never read.
 */
export interface WispDef {
  /** Price of tier 1, i.e. of unlocking it at all. */
  unlock: number;
  /** Price of reaching each tier; index 0 is unused. */
  tierPrices: number[];
  /** Hover offset from the squad centre: `x + offsetX * side`, `z + offsetZ`. */
  offsetX: number;
  offsetZ: number;
  /** How far ahead it will look for a target. */
  range: number;
  /** Spark travel speed; the hit lands `distance / sparkSpeed` seconds later. */
  sparkSpeed: number;
  /** Sparks in flight at once. Pooled, so this is also the allocation. */
  maxSparks: number;
  fireRate: number[];
  damage: number[];
}

/** `src/data/progression.json`: every number the meta layer costs and pays. */
export interface Progression {
  upgrades: {
    /** `baseCost * costGrowth ^ level` coins to buy the next level. */
    baseCost: number;
    costGrowth: number;
    maxLevel: number;
    /** What one level of each upgrade is worth (a share, except `startCount`). */
    effects: Record<UpgradeId, number>;
  };
  staffs: Record<WeaponId, { unlock: number; evolve: number }>;
  evolutions: Record<WeaponId, EvolutionDef>;
  wisp: WispDef;
  rewards: {
    perSurvivor: number;
    /** Coins per level index on any clear... */
    perClear: number;
    /** ...and again, larger, the first time that level is cleared. */
    firstClear: number;
  };
}
