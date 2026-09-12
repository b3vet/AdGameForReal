/**
 * The app's half of the meta layer: what a purchase does to a `PlayerState`.
 *
 * The sim owns the numbers and the arithmetic over them — prices, effects and
 * `runRewards` are `src/sim/player.ts` over `src/data/progression.json` (D35) —
 * and the app owns the *decisions*: whether a button is live, what a tap costs,
 * and what the state looks like afterwards. Everything here is pure: a purchase
 * returns a new state or null when it is not allowed, and only `App` writes one
 * to storage (`./save.ts`). That keeps the room screens free of rules and every
 * price testable without a DOM.
 *
 * The Sanctum's unlock level is the one number that lives on this side: it is
 * the Academy's own card data (`src/data/academy.json`), not sim tuning.
 */

import { academy } from '@/data/academy-types';
import { levelConfig } from '@/data';
import {
  Run,
  emptyPlayer,
  familiarPrice,
  generateLevel,
  maxFamiliarTier,
  maxUpgradeLevel,
  nextUpgradeCost,
  progression,
  runRewards,
  staffPrices,
  upgradeIds,
  weaponIds,
} from '@/sim';
import type { Balance } from '@/data';
import type { FamiliarTier, PlayerState, StaffTier, UpgradeId } from '@/data/types';
import type { LevelDef, WeaponId } from '@/sim';

export type { FamiliarTier, PlayerState, StaffTier, UpgradeId };
export { maxFamiliarTier, maxUpgradeLevel, runRewards, upgradeIds };

/** The Academy's five cards. `play` is a room only in the sense of a door. */
export type RoomId = 'play' | 'yard' | 'workbench' | 'sanctum' | 'bestiary';

export const roomIds: readonly RoomId[] = ['play', 'yard', 'workbench', 'sanctum', 'bestiary'];

/** The level that opens a room, from the Academy's own card data. */
export function roomUnlockLevel(room: RoomId): number {
  return academy.rooms.find((card) => card.id === room)?.unlockLevel ?? 1;
}

/** A player who has just installed the game: ember in hand, nothing bought. */
export function defaultPlayer(): PlayerState {
  return emptyPlayer();
}

/** A deep copy, so a purchase never mutates the state the caller still holds. */
export function clonePlayer(player: PlayerState): PlayerState {
  return {
    coins: player.coins,
    upgrades: { ...player.upgrades },
    staffs: {
      ember: { ...player.staffs.ember },
      storm: { ...player.staffs.storm },
      frost: { ...player.staffs.frost },
    },
    selectedStaff: player.selectedStaff,
    familiar: { ...player.familiar },
    bestiary: [...player.bestiary],
    unlockedLevel: player.unlockedLevel,
  };
}

// --- Prices ----------------------------------------------------------------

/** What the next level of an upgrade costs, or null when it is maxed. */
export function upgradeCost(player: PlayerState, id: UpgradeId): number | null {
  return nextUpgradeCost(player, id);
}

/** What one level of an upgrade is worth; a share, except `startCount`. */
export function upgradeEffect(id: UpgradeId): number {
  return progression.upgrades.effects[id];
}

/** The price of the next thing a staff can sell: itself, then its evolution. */
export function staffCost(player: PlayerState, id: WeaponId): number | null {
  const staff = player.staffs[id];
  const prices = staffPrices(id);
  if (!staff.unlocked) return prices.unlock;
  if (staff.tier < 2) return prices.evolve;
  return null;
}

/** Null when the wisp is at its last tier. */
export function familiarCost(player: PlayerState): number | null {
  const tier = player.familiar.unlocked ? player.familiar.tier : 0;
  if (tier >= maxFamiliarTier) return null;
  return familiarPrice((tier + 1) as FamiliarTier);
}

/** Whether the Sanctum is open at all; it needs the level, not the coins. */
export function familiarUnlocked(player: PlayerState): boolean {
  return player.unlockedLevel >= roomUnlockLevel('sanctum');
}

// --- Purchases -------------------------------------------------------------

/**
 * Every purchase has the same shape: a price, a check, a copy with the coins
 * taken off. They return null rather than throwing, because "cannot afford" is
 * a button state and not an error.
 */
export function buyUpgrade(player: PlayerState, id: UpgradeId): PlayerState | null {
  const cost = upgradeCost(player, id);
  if (cost === null || player.coins < cost) return null;
  const next = clonePlayer(player);
  next.coins -= cost;
  next.upgrades[id] = Math.min(maxUpgradeLevel, next.upgrades[id] + 1);
  return next;
}

/** Unlocks a locked staff, or evolves an unlocked one to tier 2. */
export function buyStaff(player: PlayerState, id: WeaponId): PlayerState | null {
  const cost = staffCost(player, id);
  if (cost === null || player.coins < cost) return null;
  const next = clonePlayer(player);
  next.coins -= cost;
  const staff = next.staffs[id];
  if (!staff.unlocked) {
    staff.unlocked = true;
    // Buying a staff is also choosing it: nobody unlocks Storm to keep firing
    // Ember, and one tap is one tap.
    next.selectedStaff = id;
  } else {
    staff.tier = 2;
  }
  return next;
}

export function selectStaff(player: PlayerState, id: WeaponId): PlayerState | null {
  if (!player.staffs[id].unlocked || player.selectedStaff === id) return null;
  const next = clonePlayer(player);
  next.selectedStaff = id;
  return next;
}

/** Binds the wisp, or raises its tier by one. */
export function buyFamiliar(player: PlayerState): PlayerState | null {
  if (!familiarUnlocked(player)) return null;
  const cost = familiarCost(player);
  if (cost === null || player.coins < cost) return null;
  const next = clonePlayer(player);
  next.coins -= cost;
  const tier = next.familiar.unlocked ? next.familiar.tier : 0;
  next.familiar = {
    unlocked: true,
    tier: Math.min(maxFamiliarTier, tier + 1) as FamiliarTier,
  };
  return next;
}

/** Coins into the purse, from a reward or a refund. Never below zero. */
export function addCoins(player: PlayerState, coins: number): PlayerState {
  const next = clonePlayer(player);
  next.coins = Math.max(0, Math.round(next.coins + coins));
  return next;
}

/** Adds bestiary ids the player had not seen before; null when none are new. */
export function rememberSeen(player: PlayerState, seen: Iterable<string>): PlayerState | null {
  const added: string[] = [];
  for (const id of seen) {
    if (!player.bestiary.includes(id) && !added.includes(id)) added.push(id);
  }
  if (added.length === 0) return null;
  const next = clonePlayer(player);
  next.bestiary = [...next.bestiary, ...added];
  return next;
}

// --- The sim, with a player in it ------------------------------------------

/** The level the player is about to walk, generated with their upgrades. */
export function buildLevel(index: number, seed: number | null, player: PlayerState): LevelDef {
  const config = levelConfig(index);
  return generateLevel(index, config, seed ?? config.seed, player);
}

/** The run itself, with the player's multipliers and chosen staff in it. */
export function buildRun(level: LevelDef, balance: Balance, player: PlayerState): Run {
  return new Run(level, balance, player);
}

/**
 * What the Bestiary records for the boss. `LevelDef.bossId` is optional for the
 * render fixtures' hand-made levels, never for a generated one, and `demon` is
 * the only boss in the manifest.
 */
export function bossIdOf(level: LevelDef): string {
  return level.bossId ?? 'demon';
}

/** Narrows a stored string to a `WeaponId` without a cast. */
export function toWeaponId(raw: unknown): WeaponId | null {
  return weaponIds.find((id) => id === raw) ?? null;
}
