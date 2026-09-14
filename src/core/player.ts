/**
 * The app's half of the meta layer: the Academy's own vocabulary over the
 * purchase rules, and the sim built with a player in it.
 *
 * The sim owns the numbers and the arithmetic over them — prices, effects,
 * `runRewards` and, since the Milestone 6 review, the purchases themselves are
 * `src/sim/player.ts` over `src/data/progression.json` (D35). They moved
 * because there were two copies of them: this file's, and the one
 * `src/sim/campaign.ts` had to keep so the campaign simulation could shop
 * without importing from `src/core`. The campaign is what D46's prices are
 * measured against, so a second copy of "what a purchase does" would have meant
 * measuring an economy the player does not spend through.
 *
 * What is left on this side is the app's own vocabulary: `RoomId`, the room
 * cards' copy, the level a player is about to walk, and the run built from it.
 * Everything is still pure — a purchase returns a new state or null when it is
 * not allowed, and only `App` writes one to storage (`./save.ts`) — and every
 * price is still testable without a DOM (`./__tests__/player.test.ts`).
 */

import { levelConfig } from '@/data';
import {
  Run,
  addCoins,
  buyFamiliar,
  buyStaff,
  buyUpgrade,
  clonePlayer,
  emptyPlayer,
  familiarCost,
  familiarUnlocked,
  generateLevel,
  maxFamiliarTier,
  maxUpgradeLevel,
  nextUpgradeCost,
  progression,
  roomUnlockLevel as simRoomUnlockLevel,
  runRewards,
  selectStaff,
  staffCost,
  upgradeIds,
  weaponIds,
} from '@/sim';
import { maxStaffTier } from '@/data/types';
import type { Balance } from '@/data';
import type { FamiliarTier, PlayerState, StaffTier, UpgradeId } from '@/data/types';
import type { LevelDef, WeaponId } from '@/sim';

export type { FamiliarTier, PlayerState, StaffTier, UpgradeId };
export { maxFamiliarTier, maxStaffTier, maxUpgradeLevel, runRewards, upgradeIds };

/**
 * The purchase rules, re-exported where the screens have always read them.
 * One pure copy, in `src/sim/player.ts`, so the campaign simulation that prices
 * them and the taps that spend them can never disagree.
 */
export {
  addCoins,
  buyFamiliar,
  buyStaff,
  buyUpgrade,
  clonePlayer,
  familiarCost,
  familiarUnlocked,
  selectStaff,
  staffCost,
};

/**
 * The Academy's cards. `play` is a room only in the sense of a door, and
 * `wardrobe` is Milestone 8's (D53): the tints the bestiary's kill ladders pay
 * out have to be worn somewhere.
 *
 * The order is the order `academy.json` lists them in, because that is the
 * order the home screen builds its cards in and the order a reveal is owed in.
 */
export type RoomId = 'play' | 'yard' | 'workbench' | 'sanctum' | 'bestiary' | 'wardrobe';

export const roomIds: readonly RoomId[] = [
  'play',
  'yard',
  'workbench',
  'sanctum',
  'bestiary',
  'wardrobe',
];

/**
 * The level that opens a room, from the Academy's own card data.
 *
 * The lookup itself is the sim's (`roomUnlockLevel` there), because a purchase
 * rule needs it too; this is the screens' narrowed door onto it, so a caller
 * that mistypes a room id is a type error rather than a silent level 1.
 */
export function roomUnlockLevel(room: RoomId): number {
  return simRoomUnlockLevel(room);
}

/** A player who has just installed the game: ember in hand, nothing bought. */
export function defaultPlayer(): PlayerState {
  return emptyPlayer();
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

// --- The Bestiary ----------------------------------------------------------

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
