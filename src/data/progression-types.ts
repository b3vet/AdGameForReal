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

import type {
  CosmeticsState,
  EndlessState,
  KillKind,
  LevelBest,
  MissionsState,
  StreakState,
} from './meta-types';
import type { WeaponId } from './weapon-types';

/** The five training-yard upgrades. Levels run 0 to `Progression.upgrades.maxLevel`. */
export type UpgradeId = 'damage' | 'fireRate' | 'startCount' | 'gateBonus' | 'bossDamage';

/**
 * What a staff is worth to its owner (D33, widened by D54).
 *
 * 0 is locked, 1 is owned and unevolved, and 2 to 4 are the three evolution
 * tiers the Workbench sells one at a time. Milestone 4's single evolution *is*
 * tier 2, so a v2 save reads exactly as it always did: the number a player had
 * means the same thing, and only the ceiling above it moved.
 */
export type StaffTier = 0 | 1 | 2 | 3 | 4;

/**
 * Evolutions *held*, which is what the sim reads: `max(0, staffTier - 1)`, so
 * an owned but unevolved staff is 0 and every multiplier a run resolves is the
 * one it always was (D35).
 */
export type EvolutionTier = 0 | 1 | 2 | 3;

/** Highest tier the Workbench sells: three evolutions above the staff itself. */
export const maxStaffTier: StaffTier = 4;

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
  /**
   * The Milestone 8 meta layer (D51 to D53), pinned by
   * `docs/23-milestone-8-plan.md`. Shapes are `./meta-types.ts`; the sim reads
   * none of them — they are counted in `src/core` from run events and results,
   * saved by `src/core/save.ts` (v3) and shown by the Academy's rooms.
   */
  streak: StreakState;
  missions: MissionsState;
  /** Kills per kind, for the bestiary's tint ladders (D53). */
  kills: Record<KillKind, number>;
  cosmetics: CosmeticsState;
  endless: EndlessState;
  /** Best walk of each campaign level, keyed by the level index as a string. */
  levelBest: Record<string, LevelBest>;
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

/**
 * What one staff's evolutions do (D33, widened by D54).
 *
 * The three Milestone 4 fields carry their own numbers because those numbers
 * are the whole of the mechanic, and they are on at staff tier 2 — the only
 * evolution there was — so a save and a screen written before D54 read exactly
 * what they always read.
 *
 * The six D54 mechanics carry one number each instead: **the staff tier that
 * switches this one on**. Which tier a mechanic arrives at is what a player
 * *buys*, so it belongs in the file the prices are in; how far it reaches and
 * how hard it hits is *balance*, so that lives in `balance.evolutions`
 * (CLAUDE.md puts tuning in the file that is tuned).
 *
 * A ladder — one `EvolutionDef` per rung, indexed by tier — was the other
 * shape considered. It says the same thing by array position rather than by
 * name, and it would have moved `progression.evolutions.ember.burn` (which the
 * sim, the tests and the renderer's dev fixture all read) for no gain.
 */
export interface EvolutionDef {
  /** Tier 2, ember: a hit sets its target alight for a share of its damage. */
  burn?: BurnDef;
  /** Tier 2, storm: further targets on top of `WeaponChain.count`. */
  extraChains?: number;
  /** Tier 2, frost: a frozen body that dies sprays its neighbours. */
  shatter?: ShatterDef;
  /** Ember: a burning body passes the fire to what it is touching, once. */
  wildfire?: number;
  /** Ember: a charged shot lands on the crowd's aim point every N seconds. */
  meteor?: number;
  /** Storm: the arc stops losing damage at every hop. */
  fullChains?: number;
  /** Storm: every Nth volley arcs to everything in range at once. */
  overcharge?: number;
  /** Frost: a slowed body that dies chills whatever is standing around it. */
  freezePulse?: number;
  /** Frost: a wall of ice holds one lane's river where it stands. */
  glacier?: number;
}

/**
 * What a staff is worth to the player who buys it, as a share of the squad's
 * own output — the number the shopper in `src/sim/campaign.ts` ranks the whole
 * Academy by, beside `upgrades.effects` (D46).
 *
 * Measured rather than asserted: every figure here is the end-to-end gain the
 * bands harness reads off a real level, converted to "how many damage rungs is
 * this worth" against a known reference, and the Milestone 8 log records the
 * measurement. It is a *shopping* number and the sim never reads it: what the
 * mechanics actually do is `./balance.json` and the `EvolutionDef` above.
 */
export interface StaffWorth {
  /** Output share of carrying this staff instead of the one in hand. */
  unlock: number;
  /** Output share each evolution adds over the tier below it: 2, then 3, then 4. */
  evolve: readonly number[];
}

/** The six mechanics D54 adds, by the name each is switched on under. */
export type EvolutionMechanic =
  | 'wildfire'
  | 'meteor'
  | 'fullChains'
  | 'overcharge'
  | 'freezePulse'
  | 'glacier';

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
  /** What each tier is worth, indexed like `tierPrices`; index 0 is unused. */
  worth: number[];
}

/** `src/data/progression.json`: every number the meta layer costs and pays. */
export interface Progression {
  upgrades: {
    /** `baseCost * costGrowth ^ level` coins to buy the next level. */
    baseCost: number;
    costGrowth: number;
    maxLevel: number;
    /**
     * Price of the *first* rung of a named track, overriding the ladder (D50).
     *
     * The Milestone 6 finding: the Academy sells nothing that compounds before
     * a `gateBonus` rung, so an early milestone level could not be gated by an
     * upgrade the economy had actually paid for — levels 7 and 10 cleared at
     * the same rate armed or bare. One cheap first rung fixes exactly that and
     * nothing else: the ladder above it is untouched, so the runs-per-purchase
     * curve the prices were tuned against still holds.
     *
     * A track with no entry here prices its first rung at `baseCost` as before.
     */
    starterRung?: Partial<Record<UpgradeId, number>>;
    /** What one level of each upgrade is worth (a share, except `startCount`). */
    effects: Record<UpgradeId, number>;
  };
  /**
   * What a staff costs: owning it at all, then each of its three evolutions in
   * turn (D54). `evolve[0]` is the Milestone 4 price, unchanged, so a player
   * mid-campaign pays exactly what they were quoted; `[1]` and `[2]` are
   * multi-run goals above it.
   *
   * `readonly number[]` rather than a three-tuple because this is read out of a
   * JSON module, whose array literals widen: a tuple here would need a cast at
   * the one place the schema exists to remove casts. `staffPrices` narrows it.
   */
  staffs: Record<WeaponId, { unlock: number; evolve: readonly number[]; worth: StaffWorth }>;
  /** What each staff's evolutions do, and which tier each of them arrives at. */
  evolutions: Record<WeaponId, EvolutionDef>;
  wisp: WispDef;
  /**
   * What a run pays (D46). Coins come from clearing the road, not from the size
   * of the crowd that walked it, so `perSurvivor` is a token and the two clear
   * payments are the economy.
   */
  rewards: {
    /** Coins per surviving apprentice. Small on purpose. */
    perSurvivor: number;
    /** Coins for any clear, before the level scale... */
    perClear: number;
    /** ...and this on top of it the first time that level is cleared. */
    firstClear: number;
    /**
     * Both clear payments are multiplied by `level ^ levelExponent`. Sub-linear
     * because the Academy's prices climb with every purchase while a run's pay
     * climbs with the level: linear scaling here would make each purchase
     * *quicker* than the last, which is the opposite of the campaign's target
     * (an upgrade every two runs early, every four by level 10).
     */
    levelExponent: number;
    /**
     * Share of a repeat clear's coins a loss pays, before it is scaled by how
     * far up the road the run got.
     */
    lossShare: number;
  };
}
