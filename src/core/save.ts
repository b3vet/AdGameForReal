/**
 * Persistent player data, version 2 (decision D33).
 *
 * Milestone 1 remembered one number — the unlocked level — under
 * `arcane-rush.save.v1`, and Milestones 2 and 3 added `muted` and `debug` to
 * the same object without a version bump, because a missing boolean reads as
 * `false` and nothing was lost. The Academy is not that kind of change: a v1
 * save has no coins, no upgrades and no bestiary, so v2 is a new key with an
 * explicit migration rather than another defensive field.
 *
 * What is stored:
 *
 *   version         2, so a v3 can tell what it is reading.
 *   player          the `PlayerState` the sim is handed (`./player.ts`).
 *   unlockedLevel   how far up the road the player has been. Mirrored into
 *                   `player.unlockedLevel` on every read and write, so the two
 *                   can never disagree; the plan names both, and the sim's
 *                   contract puts it inside `PlayerState`.
 *   firstClears     levels cleared at least once, for the first-clear bonus.
 *   revealedRooms   Academy rooms whose reveal animation has already played.
 *   muted, debug    the two switches, carried over from v1.
 *
 * Rules that have not changed: nothing here throws (private browsing, disabled
 * storage and corrupt JSON all fall back to a fresh save), and every field is
 * read defensively.
 */

import { weaponIds } from '@/sim';

import { defaultPlayer, maxUpgradeLevel, roomIds, toWeaponId, upgradeIds } from './player';
import type { FamiliarTier, PlayerState, RoomId, StaffTier, UpgradeId } from './player';

const SAVE_KEY = 'arcane-rush.save.v2';
/** Read once, on the first load after the update, and then left alone. */
const SAVE_KEY_V1 = 'arcane-rush.save.v1';

export const SAVE_VERSION = 2;

export interface SaveData {
  version: number;
  unlockedLevel: number;
  /** Set from the mute button on the Academy or the HUD. */
  muted: boolean;
  /**
   * Show the debug panel. Set by `?debug` or by triple-tapping the wordmark or
   * the level chip, and remembered because the hosted playtest wrapper may not
   * pass a query string through at all.
   */
  debug: boolean;
  /** Levels cleared at least once. Sorted, no duplicates. */
  firstClears: number[];
  /** Rooms whose one-time reveal has played. */
  revealedRooms: RoomId[];
  player: PlayerState;
}

function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    unlockedLevel: 1,
    muted: false,
    debug: false,
    firstClears: [],
    revealedRooms: [],
    player: defaultPlayer(),
  };
}

/**
 * Never throws: a missing, unreadable or corrupt save is a fresh one. A v1
 * save is migrated on the spot and written back under the new key; the old key
 * is left where it is, so a build rolled back to Milestone 3 still finds it.
 */
export function loadSave(): SaveData {
  try {
    const raw = globalThis.localStorage?.getItem(SAVE_KEY);
    if (raw === null || raw === undefined) return migrateFromV1();
    return normalise(readObject(raw));
  } catch {
    return defaultSave();
  }
}

export function saveSave(data: SaveData): void {
  try {
    globalThis.localStorage?.setItem(SAVE_KEY, JSON.stringify(normalise(data)));
  } catch {
    // Storage being unavailable must not break a run in progress.
  }
}

/** Convenience for the result screen's `Ascend` button. */
export function unlockLevel(level: number): SaveData {
  const current = loadSave();
  if (level <= current.unlockedLevel) return current;

  // Spread rather than a fresh object: unlocking a level must not silently
  // un-mute the game, and the next field added here gets the same protection.
  const next: SaveData = { ...current, unlockedLevel: Math.floor(level) };
  saveSave(next);
  return next;
}

/** Convenience for the mute buttons. */
export function setMuted(muted: boolean): SaveData {
  const next: SaveData = { ...loadSave(), muted };
  saveSave(next);
  return next;
}

/** Convenience for `?debug` and the triple-tap gesture. */
export function setDebug(debug: boolean): SaveData {
  const next: SaveData = { ...loadSave(), debug };
  saveSave(next);
  return next;
}

/** Writes a new `PlayerState` — a purchase, a reward, a bestiary entry. */
export function setPlayer(player: PlayerState): SaveData {
  const next: SaveData = { ...loadSave(), player };
  saveSave(next);
  return next;
}

/** Marks a level as cleared at least once. Idempotent. */
export function markFirstClear(level: number): SaveData {
  const current = loadSave();
  const value = Math.floor(level);
  if (current.firstClears.includes(value)) return current;
  const firstClears = [...current.firstClears, value].sort(ascending);
  const next: SaveData = { ...current, firstClears };
  saveSave(next);
  return next;
}

/** True when this level has never been cleared; read *before* the run ends. */
export function isFirstClear(save: SaveData, level: number): boolean {
  return !save.firstClears.includes(Math.floor(level));
}

/** Remembers that a room's reveal animation has played. Idempotent. */
export function markRoomRevealed(room: RoomId): SaveData {
  const current = loadSave();
  if (current.revealedRooms.includes(room)) return current;
  const next: SaveData = { ...current, revealedRooms: [...current.revealedRooms, room] };
  saveSave(next);
  return next;
}

/**
 * Debug-handle entry point: a hand-written patch over the current player.
 *
 * It goes through the same reader a stored save does, so a patch that names
 * two fields still comes back as a whole, valid `PlayerState` — and one that
 * names nonsense comes back as the defaults rather than as a broken Academy.
 * `scripts/smoke-run.mjs` is the caller that matters (`__arcane.setPlayer`).
 */
export function mergePlayer(base: PlayerState, patch: unknown): PlayerState {
  const fields = typeof patch === 'object' && patch !== null ? patch : {};
  return readPlayer({ ...base, ...fields }, base);
}

/**
 * v1 carried three fields and only two of them still exist as written
 * (`unlockedLevel`, `muted`, `debug`). Everything the Academy adds starts at
 * its default: no coins, no upgrades, ember unlocked at tier 1 and selected,
 * the other staffs and the familiar locked, an empty bestiary. A player who
 * had reached level 7 keeps level 7 — the alternative is telling them their
 * progress was the price of the update.
 */
function migrateFromV1(): SaveData {
  const fresh = defaultSave();
  let raw: string | null | undefined;
  try {
    raw = globalThis.localStorage?.getItem(SAVE_KEY_V1);
  } catch {
    return fresh;
  }
  if (raw === null || raw === undefined) return fresh;

  const parsed = parse(raw);
  if (parsed === null) return fresh;

  const migrated: SaveData = {
    ...fresh,
    unlockedLevel: positiveInt(parsed['unlockedLevel'], 1),
    muted: parsed['muted'] === true,
    debug: parsed['debug'] === true,
  };
  const normalised = normalise(migrated);
  // Written back straight away so the next load is a plain v2 read; a storage
  // that refuses the write simply migrates again next time.
  saveSave(normalised);
  return normalised;
}

function readObject(raw: string): SaveData {
  const parsed = parse(raw);
  if (parsed === null) return defaultSave();

  const fresh = defaultSave();
  return {
    version: positiveInt(parsed['version'], SAVE_VERSION),
    unlockedLevel: positiveInt(parsed['unlockedLevel'], 1),
    muted: parsed['muted'] === true,
    debug: parsed['debug'] === true,
    firstClears: readLevels(parsed['firstClears']),
    revealedRooms: readRooms(parsed['revealedRooms']),
    player: readPlayer(parsed['player'], fresh.player),
  };
}

/**
 * Field by field against the defaults: a save written by an older Academy — or
 * by hand through the debug handle — must not be able to produce a player with
 * a missing upgrade record or a staff that is neither locked nor unlocked.
 */
function readPlayer(raw: unknown, fallback: PlayerState): PlayerState {
  if (typeof raw !== 'object' || raw === null) return fallback;
  const fields = raw as Record<string, unknown>;

  const player = defaultPlayer();
  player.coins = Math.max(0, Math.floor(number(fields['coins'], 0)));
  player.unlockedLevel = positiveInt(fields['unlockedLevel'], 1);

  const upgrades = record(fields['upgrades']);
  for (const id of upgradeIds) {
    player.upgrades[id] = clampUpgrade(number(upgrades[id], 0));
  }

  const staffs = record(fields['staffs']);
  for (const id of weaponIds) {
    const staff = record(staffs[id]);
    const unlocked = id === 'ember' || staff['unlocked'] === true;
    player.staffs[id] = {
      unlocked,
      // A tier on a locked staff would light the "evolved" badge on a card
      // that cannot be used, so it is held at 1 until the staff is owned.
      tier: (unlocked && number(staff['tier'], 1) >= 2 ? 2 : 1) as StaffTier,
    };
  }

  const familiar = record(fields['familiar']);
  const familiarUnlocked = familiar['unlocked'] === true;
  const tier = Math.min(3, Math.max(0, Math.floor(number(familiar['tier'], 0))));
  player.familiar = {
    unlocked: familiarUnlocked,
    tier: (familiarUnlocked ? Math.max(1, tier) : 0) as FamiliarTier,
  };

  player.bestiary = Array.isArray(fields['bestiary'])
    ? fields['bestiary'].filter((id): id is string => typeof id === 'string')
    : [];

  const selected = toWeaponId(fields['selectedStaff']);
  player.selectedStaff = selected !== null && player.staffs[selected].unlocked ? selected : 'ember';

  return player;
}

/**
 * The one invariant the two copies of the unlocked level have: they are the
 * same number, and it is the larger of the two. Applied on read and on write,
 * so nothing downstream has to know there are two.
 */
function normalise(data: SaveData): SaveData {
  const level = Math.max(1, Math.floor(Math.max(data.unlockedLevel, data.player.unlockedLevel)));
  data.unlockedLevel = level;
  data.player.unlockedLevel = level;
  data.version = SAVE_VERSION;
  return data;
}

function parse(raw: string): Record<string, unknown> | null {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) return null;
  return parsed as Record<string, unknown>;
}

function record(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) return {};
  return raw as Record<string, unknown>;
}

function number(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

function positiveInt(raw: unknown, fallback: number): number {
  const value = number(raw, fallback);
  return Math.max(1, Math.floor(value));
}

function clampUpgrade(value: number): number {
  return Math.min(maxUpgradeLevel, Math.max(0, Math.floor(value)));
}

function readLevels(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const levels: number[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) continue;
    const level = Math.floor(entry);
    if (level >= 1 && !levels.includes(level)) levels.push(level);
  }
  return levels.sort(ascending);
}

function readRooms(raw: unknown): RoomId[] {
  if (!Array.isArray(raw)) return [];
  const rooms: RoomId[] = [];
  for (const entry of raw) {
    const room = roomIds.find((id) => id === entry);
    if (room !== undefined && !rooms.includes(room)) rooms.push(room);
  }
  return rooms;
}

function ascending(a: number, b: number): number {
  return a - b;
}

export { SAVE_KEY, SAVE_KEY_V1 };
export type { PlayerState, RoomId, UpgradeId };
