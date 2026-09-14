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

import { progression } from './progression';
import { startWeapon, weaponIds } from './weapons';
// The Academy's room cards, for the one thing a purchase rule needs from them:
// the level that opens the Sanctum, which is what gates a wisp. Card *copy* is
// still the app's (`src/core/player.ts`); this reads one number out of the same
// file rather than letting the rule exist twice.
import { academy } from '@/data/academy-types';
import { maxStaffTier } from '@/data/progression-types';
import type { LevelBest } from '@/data/meta-types';
import type {
  EvolutionTier,
  FamiliarTier,
  PlayerState,
  StaffTier,
  UpgradeId,
  WeaponId,
} from '@/data/types';

export { progression } from './progression';
export { maxStaffTier };

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
    // The Milestone 8 meta layer (D51 to D53). The sim reads none of it —
    // `playerMods` resolves nothing out of these — but the save is one object,
    // so a fresh player has to carry an empty one of each.
    streak: { days: 0, lastDay: '' },
    missions: { active: [], rolled: 0 },
    kills: { grunt: 0, brute: 0, charger: 0, shieldBrute: 0, demon: 0, rime: 0 },
    cosmetics: { owned: [], selected: {} },
    endless: { bestMetres: 0, runs: 0 },
    levelBest: {},
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

/** What a staff costs to own and then to evolve, one tier at a time (D54). */
export interface StaffPrices {
  unlock: number;
  /** Staff tier 2, then 3, then 4 — the three evolutions, in the order sold. */
  evolve: readonly [number, number, number];
}

/**
 * Price of owning `id` at all, and of each of its three evolutions (D33, D54).
 *
 * The ladder is narrowed to a triple here rather than in the schema because it
 * is read out of a JSON module, whose array literals widen: a tuple in
 * `progression-types.ts` would need a cast at the one place that exists to
 * remove casts. A short ladder pads with its last price rather than throwing,
 * so a half-edited tuning file still boots a shop.
 */
export function staffPrices(id: WeaponId): StaffPrices {
  const prices = progression.staffs[id];
  const ladder = prices.evolve;
  const first = ladder[0] ?? 0;
  const second = ladder[1] ?? first;
  return { unlock: prices.unlock, evolve: [first, second, ladder[2] ?? second] };
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

/**
 * What tier the player actually holds `id` at: 0 when the Workbench has not
 * sold it, and otherwise the tier on the save, held inside 1 to `maxStaffTier`.
 * A save that carries a tier on a staff nobody bought is worth nothing here,
 * which is the same rule `src/core/save.ts` repairs a file with.
 */
export function staffTierOf(player: PlayerState, id: WeaponId): StaffTier {
  const staff = player.staffs[id];
  if (!staff.unlocked) return 0;
  return Math.min(maxStaffTier, Math.max(1, Math.floor(staff.tier))) as StaffTier;
}

/**
 * The price of the next thing a staff can sell: itself, then each evolution in
 * turn (D54). Null at the top of the ladder, which is what makes the Workbench
 * row read "owned" rather than print a price nobody can pay.
 */
export function staffCost(player: PlayerState, id: WeaponId): number | null {
  const tier = staffTierOf(player, id);
  const prices = staffPrices(id);
  if (tier === 0) return prices.unlock;
  if (tier >= maxStaffTier) return null;
  // Tier 1 buys `evolve[0]` (staff tier 2), tier 2 buys `evolve[1]`, and so on.
  return prices.evolve[tier - 1] ?? null;
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
    // Deep, like `bestiary` above: a purchase must not hand the caller back a
    // board whose missions it can still write through.
    streak: { ...player.streak },
    missions: {
      active: player.missions.active.map((mission) => ({ ...mission })),
      rolled: player.missions.rolled,
    },
    kills: { ...player.kills },
    cosmetics: {
      owned: [...player.cosmetics.owned],
      selected: { ...player.cosmetics.selected },
    },
    endless: { ...player.endless },
    levelBest: cloneLevelBest(player.levelBest),
  };
}

/** `Object.entries` and back, so each `LevelBest` is a copy and not a share. */
function cloneLevelBest(source: Record<string, LevelBest>): Record<string, LevelBest> {
  const copy: Record<string, LevelBest> = {};
  for (const key of Object.keys(source)) {
    const best = source[key];
    if (best !== undefined) copy[key] = { ...best };
  }
  return copy;
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

/**
 * Unlocks a locked staff, or evolves an unlocked one by exactly one tier (D54).
 *
 * One tier at a time, never "as far as the purse reaches": each rung is a
 * separate purchase with a price of its own, and a player who can afford tier 4
 * outright still walks up through 3 — which is what makes the Workbench row a
 * ladder the player climbs rather than a number they clear.
 */
export function buyStaff(player: PlayerState, id: WeaponId): PlayerState | null {
  const cost = staffCost(player, id);
  if (cost === null || player.coins < cost) return null;
  const next = clonePlayer(player);
  next.coins -= cost;
  const staff = next.staffs[id];
  if (!staff.unlocked) {
    staff.unlocked = true;
    staff.tier = 1;
    // Buying a staff is also choosing it: nobody unlocks Storm to keep firing
    // Ember, and one tap is one tap.
    next.selectedStaff = id;
  } else {
    staff.tier = Math.min(maxStaffTier, staffTierOf(player, id) + 1) as StaffTier;
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
  /**
   * Evolutions *held* per staff, which is `max(0, staffTier - 1)` (D54): an
   * owned but unevolved staff is 0 and a maxed one is 3.
   *
   * Counted in evolutions rather than in staff tiers because that is the
   * question every mechanic asks — "how many rungs of this staff does the
   * player own" — and because it makes "nothing bought" a record of zeroes
   * rather than of ones, so a run with no player resolves to the identity the
   * way every other field of `NO_MODS` does.
   */
  tiers: Record<WeaponId, EvolutionTier>;
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
  tiers: Object.freeze({ ember: 0, storm: 0, frost: 0 }) as Record<WeaponId, EvolutionTier>,
  familiarTier: 0,
});

/** Evolutions held on `id`: staff tier 1 is none, tier 4 is all three. */
export function evolutionTierOf(player: PlayerState, id: WeaponId): EvolutionTier {
  return Math.max(0, staffTierOf(player, id) - 1) as EvolutionTier;
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
      ember: evolutionTierOf(player, 'ember'),
      storm: evolutionTierOf(player, 'storm'),
      frost: evolutionTierOf(player, 'frost'),
    },
    familiarTier: player.familiar.unlocked ? player.familiar.tier : 0,
  };
}
