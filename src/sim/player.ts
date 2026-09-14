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
 *
 * The *purchases* are here too, which they were not before the Milestone 6
 * review: `src/core/player.ts` owned a copy and `src/sim/campaign.ts` — the
 * campaign simulation the prices are tuned against (D46) — owned a second one,
 * because `src/sim` may not import from `src/core`. Two copies of "what a
 * purchase does" is two economies, and the one the campaign measures would not
 * have been the one the player spends through. They are one pure copy now:
 * every rule lives below, `src/core/player.ts` delegates to it and keeps the
 * screens' own vocabulary (`RoomId`, button state), and the campaign shops
 * through the same functions.
 */

import { startWeapon, weaponIds } from './weapons';
// The Academy's room cards, for the one thing a purchase rule needs from them:
// the level that opens the Sanctum, which is what gates a wisp. Card *copy* is
// still the app's (`src/core/player.ts`); this reads one number out of the same
// file rather than letting the rule exist twice.
import { academy } from '@/data/academy-types';
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

/**
 * The same, for a named track: the ladder above, except that a track listed in
 * `upgrades.starterRung` prices its own first rung (D50).
 *
 * One track is listed as shipped, `gateBonus`, and the reason is the Milestone
 * 6 finding: it is the only upgrade that *compounds* — it moves what every
 * `add` gate on the level prints — so until a player owns a rung of it, what
 * the Academy has sold them is worth a few percent of their output and a
 * milestone level cannot be gated by it. Making the first rung cheap puts one
 * in the player's hands by about level 7 and leaves every price above it
 * exactly where the economy was tuned.
 */
export function upgradeCostFor(id: UpgradeId, level: number): number {
  const rung = Math.max(0, Math.floor(level));
  const starter = progression.upgrades.starterRung?.[id];
  if (rung === 0 && starter !== undefined) return Math.round(starter);
  return upgradeCost(rung);
}

export function upgradeLevel(player: PlayerState, id: UpgradeId): number {
  return Math.min(maxUpgradeLevel, Math.max(0, Math.floor(player.upgrades[id])));
}

/** What the next level of `id` costs, or null when it is already maxed. */
export function nextUpgradeCost(player: PlayerState, id: UpgradeId): number | null {
  const level = upgradeLevel(player, id);
  return level >= maxUpgradeLevel ? null : upgradeCostFor(id, level);
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
 * The level that opens an Academy room, from the Academy's own card data.
 * `room` is a plain string because the ids in `academy.json` are (see that
 * file's schema); the screens narrow them, the rules here do not need to.
 */
export function roomUnlockLevel(room: string): number {
  return academy.rooms.find((card) => card.id === room)?.unlockLevel ?? 1;
}

/** Whether this player has reached the level that opens `room`. */
export function roomOpen(room: string, player: PlayerState): boolean {
  return player.unlockedLevel >= roomUnlockLevel(room);
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
  return roomOpen('sanctum', player);
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

/**
 * Every purchase has the same shape: a price, a check, a copy with the coins
 * taken off. They return null rather than throwing, because "cannot afford" is
 * a button state and not an error — and, for the campaign simulation, a refusal
 * it can stop on rather than a divergence it would carry silently.
 */
export function buyUpgrade(player: PlayerState, id: UpgradeId): PlayerState | null {
  const cost = nextUpgradeCost(player, id);
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

/** What a run's own state has to carry for `runRewards` to price it. */
export interface RunPayable {
  status: string;
  survivors: number;
  /** Where the squad got to; a `RunState` always has it, a fixture may not. */
  squad?: { z: number };
  arenaZ?: number;
}

/**
 * How far up the road a run got, 0 to 1. The squad stops at `arenaZ` to fight
 * the boss, so a run that died to the boss reads 1 and one that died at the
 * second gate row reads a tenth.
 *
 * A state without a position — the hand-made ones in tests and fixtures —
 * reads 0, which is what keeps `runRewards` paying nothing for a loss that
 * cannot say how far it got.
 */
export function roadProgress(state: RunPayable): number {
  const z = state.squad?.z;
  const arenaZ = state.arenaZ;
  if (z === undefined || arenaZ === undefined || arenaZ <= 0) return 0;
  return Math.min(1, Math.max(0, z / arenaZ));
}

/**
 * Coins a *finished* run pays (D46).
 *
 * The road pays for clearing it, not for the size of the crowd that walked it:
 * `perClear` on any clear and `firstClear` again the first time, both scaled by
 * the level index through `levelExponent`, plus a token `perSurvivor` so the
 * count on the result screen still means something. Before D46 the survivors
 * *were* the payment, which paid a fat gate rather than a finished level.
 *
 * A loss pays `lossShare` of what another clear of this level would pay, scaled
 * by how far up the road it got: dying to the boss is nearly the whole share
 * and dying in the first ten metres is nearly nothing. That is what makes a
 * milestone level (D45) a few runs of grinding rather than a wall — and it is
 * deliberately measured against a *repeat* clear, so that losing over and over
 * can never out-earn clearing the level and moving on.
 *
 * A run that is still going pays nothing, and that is a rule rather than a
 * guard. `survivors` tracks the live squad while a run is under way, so paying
 * on it would make "walk into a fat gate, then leave" worth more than finishing
 * the level. Nothing in the app can leave a run today — the HUD has no way out
 * — but the rule belongs here, with the arithmetic, rather than in whichever
 * screen grows one first.
 */
export function runRewards(
  state: RunPayable,
  level: number,
  firstClear: boolean,
): { coins: number } {
  if (state.status === 'running') return { coins: 0 };

  const rewards = progression.rewards;
  const index = Math.max(1, Math.floor(level));
  const scale = Math.pow(index, rewards.levelExponent);
  const clearValue = rewards.perClear * scale;

  if (state.status !== 'won') {
    return { coins: Math.round(clearValue * rewards.lossShare * roadProgress(state)) };
  }

  let coins = clearValue + Math.max(0, Math.floor(state.survivors)) * rewards.perSurvivor;
  if (firstClear) coins += rewards.firstClear * scale;
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
