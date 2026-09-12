/**
 * The meta layer, as the sim sees it (D33, D35).
 *
 * The app owns a `PlayerState`, saves it and spends coins into it; the sim only
 * reads it, and only through `playerMods`, which turns the whole of it into a
 * handful of multipliers once per run. That is the rule the balance bands rest
 * on: a player with nothing bought resolves to `NO_MODS`, every multiplier is
 * exactly 1, and the run is bit for bit the run the campaign was tuned as.
 *
 * Prices and effects are numbers, so they live in `src/data/progression.json`
 * (CLAUDE.md); this file is the arithmetic over them.
 */

import { startWeapon, weaponIds } from './weapons';
import progressionJson from '@/data/progression.json';
import type {
  FamiliarTier,
  PlayerState,
  Progression,
  StaffTier,
  UpgradeId,
  WeaponId,
} from '@/data/types';

export const progression: Progression = progressionJson;

export const upgradeIds: readonly UpgradeId[] = [
  'damage',
  'fireRate',
  'startCount',
  'gateBonus',
  'bossDamage',
];

/** A player who has just installed the game: ember in hand, nothing bought. */
export function emptyPlayer(): PlayerState {
  return {
    coins: 0,
    upgrades: { damage: 0, fireRate: 0, startCount: 0, gateBonus: 0, bossDamage: 0 },
    staffs: {
      ember: { unlocked: true, tier: 1 },
      storm: { unlocked: false, tier: 1 },
      frost: { unlocked: false, tier: 1 },
    },
    selectedStaff: startWeapon,
    familiar: { unlocked: false, tier: 0 },
    bestiary: [],
    unlockedLevel: 1,
  };
}

export const maxUpgradeLevel = Math.max(0, Math.floor(progression.upgrades.maxLevel));

/** `baseCost * costGrowth ^ level` coins to go from `level` to `level + 1`. */
export function upgradeCost(level: number): number {
  const up = progression.upgrades;
  return Math.round(up.baseCost * Math.pow(up.costGrowth, Math.max(0, Math.floor(level))));
}

export function upgradeLevel(player: PlayerState, id: UpgradeId): number {
  return Math.min(maxUpgradeLevel, Math.max(0, Math.floor(player.upgrades[id])));
}

/** What the next level of `id` costs, or null when it is already maxed. */
export function nextUpgradeCost(player: PlayerState, id: UpgradeId): number | null {
  const level = upgradeLevel(player, id);
  return level >= maxUpgradeLevel ? null : upgradeCost(level);
}

/** Price of owning `id` at all, and of its one evolution (D33). */
export function staffPrices(id: WeaponId): { unlock: number; evolve: number } {
  return progression.staffs[id];
}

/** Price of reaching wisp tier `tier`; 0 for tier 0, which is "no wisp". */
export function familiarPrice(tier: FamiliarTier): number {
  return progression.wisp.tierPrices[tier] ?? 0;
}

/** Highest tier the Sanctum sells. */
export const maxFamiliarTier: FamiliarTier = 3;

/**
 * Coins a finished run pays: one per survivor, plus a flat share of the level
 * index on a clear, and again — larger — the first time that level is cleared.
 * A lost run leaves no survivors, so it pays nothing.
 */
export function runRewards(
  state: { status: string; survivors: number },
  level: number,
  firstClear: boolean,
): { coins: number } {
  const rewards = progression.rewards;
  const cleared = state.status === 'won';
  const index = Math.max(1, Math.floor(level));
  let coins = Math.max(0, Math.floor(state.survivors)) * rewards.perSurvivor;
  if (cleared) coins += rewards.perClear * index;
  if (cleared && firstClear) coins += rewards.firstClear * index;
  return { coins: Math.round(coins) };
}

/**
 * Everything the sim needs from a player, resolved once.
 *
 * `startCount` and `gateBonus` are read by `generateLevel` (they shape the
 * level); the rest is read by `Run` (they shape the squad). Splitting them that
 * way is what keeps the level a level: the road, its streams and its curses are
 * the ones the campaign was tuned with whatever the player has bought, and the
 * player's money shows up as a stronger squad walking it.
 */
export interface PlayerMods {
  damage: number;
  fireRate: number;
  /** Extra units the squad starts a generated level with. */
  startCount: number;
  /** Multiplier on the printed value of `add` gates. */
  gateBonus: number;
  /** Multiplier on damage dealt to a boss. */
  bossDamage: number;
  /** The staff the run starts with. */
  staff: WeaponId;
  tiers: Record<WeaponId, StaffTier>;
  familiarTier: FamiliarTier;
}

/** What "nothing bought" resolves to. Frozen: every run without a player shares it. */
export const NO_MODS: PlayerMods = Object.freeze({
  damage: 1,
  fireRate: 1,
  startCount: 0,
  gateBonus: 1,
  bossDamage: 1,
  staff: startWeapon,
  tiers: Object.freeze({ ember: 1, storm: 1, frost: 1 }) as Record<WeaponId, StaffTier>,
  familiarTier: 0,
});

function tierOf(player: PlayerState, id: WeaponId): StaffTier {
  const staff = player.staffs[id];
  return staff.unlocked && staff.tier === 2 ? 2 : 1;
}

/** The staff in hand at the start: the chosen one if it is owned, else ember. */
function staffOf(player: PlayerState): WeaponId {
  const chosen = weaponIds.find((id) => id === player.selectedStaff);
  if (chosen !== undefined && player.staffs[chosen].unlocked) return chosen;
  return startWeapon;
}

export function playerMods(player?: PlayerState): PlayerMods {
  if (player === undefined) return NO_MODS;

  const effects = progression.upgrades.effects;
  const level = (id: UpgradeId): number => upgradeLevel(player, id);

  return {
    damage: 1 + effects.damage * level('damage'),
    fireRate: 1 + effects.fireRate * level('fireRate'),
    startCount: Math.round(effects.startCount * level('startCount')),
    gateBonus: 1 + effects.gateBonus * level('gateBonus'),
    bossDamage: 1 + effects.bossDamage * level('bossDamage'),
    staff: staffOf(player),
    tiers: {
      ember: tierOf(player, 'ember'),
      storm: tierOf(player, 'storm'),
      frost: tierOf(player, 'frost'),
    },
    familiarTier: player.familiar.unlocked ? player.familiar.tier : 0,
  };
}

/** The evolution a staff has at this tier, or undefined at tier 1. */
export function evolutionOf(id: WeaponId, tier: StaffTier): Progression['evolutions'][WeaponId] | undefined {
  return tier === 2 ? progression.evolutions[id] : undefined;
}
