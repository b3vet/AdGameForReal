/**
 * The save is the only thing in the game a player can lose, so the two things
 * tested here are the two ways it can be lost: a v1 save that is not carried
 * over, and a v2 save that does not come back the way it went in.
 *
 * `localStorage` does not exist in the Vitest node environment, which is also
 * the browser case the loader has to survive (private browsing throws on the
 * first read), so both are exercised: a memory storage for the round trips, and
 * no storage at all for the fallbacks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultPlayer } from '../player';
import {
  SAVE_KEY,
  SAVE_KEY_V1,
  SAVE_VERSION,
  isFirstClear,
  loadSave,
  markFirstClear,
  markRoomRevealed,
  mergePlayer,
  saveSave,
  setDebug,
  setMuted,
  setPlayer,
  unlockLevel,
} from '../save';

class MemoryStorage {
  private readonly entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, String(value));
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('save v2 migration', () => {
  it('carries a v1 save over and defaults everything the Academy added', () => {
    storage.setItem(
      SAVE_KEY_V1,
      JSON.stringify({ unlockedLevel: 7, muted: true, debug: true }),
    );

    const save = loadSave();

    expect(save.version).toBe(SAVE_VERSION);
    expect(save.unlockedLevel).toBe(7);
    expect(save.muted).toBe(true);
    expect(save.debug).toBe(true);
    expect(save.firstClears).toEqual([]);
    expect(save.revealedRooms).toEqual([]);
    expect(save.player.coins).toBe(0);
    expect(save.player.upgrades).toEqual({
      damage: 0,
      fireRate: 0,
      startCount: 0,
      gateBonus: 0,
      bossDamage: 0,
    });
    expect(save.player.staffs.ember).toEqual({ unlocked: true, tier: 1 });
    expect(save.player.staffs.storm.unlocked).toBe(false);
    expect(save.player.staffs.frost.unlocked).toBe(false);
    expect(save.player.selectedStaff).toBe('ember');
    expect(save.player.familiar).toEqual({ unlocked: false, tier: 0 });
    expect(save.player.bestiary).toEqual([]);
    // The unlocked level lives in two places and they are the same number.
    expect(save.player.unlockedLevel).toBe(7);
  });

  it('writes the migrated save under the v2 key and leaves v1 alone', () => {
    storage.setItem(SAVE_KEY_V1, JSON.stringify({ unlockedLevel: 4 }));

    loadSave();

    expect(storage.getItem(SAVE_KEY_V1)).not.toBeNull();
    const written: unknown = JSON.parse(storage.getItem(SAVE_KEY) ?? 'null');
    expect(written).toMatchObject({ version: SAVE_VERSION, unlockedLevel: 4 });
  });

  it('falls back to a fresh save for a corrupt or absent v1', () => {
    storage.setItem(SAVE_KEY_V1, 'not json at all');
    expect(() => loadSave()).not.toThrow();

    storage.clear();
    const fresh = loadSave();
    expect(fresh.unlockedLevel).toBe(1);
    expect(fresh.player).toEqual(defaultPlayer());
  });

  it('never throws when storage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadSave().unlockedLevel).toBe(1);
    expect(() => {
      saveSave(loadSave());
    }).not.toThrow();
  });
});

describe('save v2 round trip', () => {
  it('returns every field it was given', () => {
    const player = defaultPlayer();
    player.coins = 1234;
    player.upgrades.damage = 3;
    player.upgrades.bossDamage = 1;
    player.staffs.storm = { unlocked: true, tier: 2 };
    player.selectedStaff = 'storm';
    player.familiar = { unlocked: true, tier: 2 };
    player.bestiary = ['grunt', 'demon'];
    player.unlockedLevel = 9;

    setPlayer(player);
    const save = loadSave();

    expect(save.player).toEqual(player);
    expect(save.unlockedLevel).toBe(9);
  });

  it('keeps the switches when another field is written', () => {
    setMuted(true);
    setDebug(true);
    unlockLevel(5);
    const player = defaultPlayer();
    player.coins = 10;
    setPlayer(player);

    const save = loadSave();
    expect(save.muted).toBe(true);
    expect(save.debug).toBe(true);
    expect(save.unlockedLevel).toBe(5);
    expect(save.player.coins).toBe(10);
    // A player written with the default level must not walk the unlock back.
    expect(save.player.unlockedLevel).toBe(5);
  });

  it('records first clears once and in order', () => {
    expect(isFirstClear(loadSave(), 3)).toBe(true);
    markFirstClear(3);
    markFirstClear(1);
    markFirstClear(3);

    const save = loadSave();
    expect(save.firstClears).toEqual([1, 3]);
    expect(isFirstClear(save, 3)).toBe(false);
    expect(isFirstClear(save, 2)).toBe(true);
  });

  it('remembers a room reveal once', () => {
    markRoomRevealed('yard');
    markRoomRevealed('yard');
    markRoomRevealed('sanctum');
    expect(loadSave().revealedRooms).toEqual(['yard', 'sanctum']);
  });

  it('repairs a hand-edited save rather than trusting it', () => {
    storage.setItem(
      SAVE_KEY,
      JSON.stringify({
        version: 2,
        unlockedLevel: -4,
        firstClears: ['nonsense', 2, 2],
        revealedRooms: ['yard', 'cellar'],
        player: {
          coins: -50,
          upgrades: { damage: 99, fireRate: 'lots' },
          staffs: { storm: { unlocked: false, tier: 2 } },
          selectedStaff: 'storm',
          familiar: { unlocked: true, tier: 0 },
          bestiary: ['grunt', 7],
        },
      }),
    );

    const save = loadSave();
    expect(save.unlockedLevel).toBe(1);
    expect(save.firstClears).toEqual([2]);
    expect(save.revealedRooms).toEqual(['yard']);
    expect(save.player.coins).toBe(0);
    // Clamped to the ladder's top, and a word is not a level.
    expect(save.player.upgrades.damage).toBe(10);
    expect(save.player.upgrades.fireRate).toBe(0);
    // A tier on a staff that is not owned, and a staff in hand that is not
    // owned either: both are walked back.
    expect(save.player.staffs.storm).toEqual({ unlocked: false, tier: 1 });
    expect(save.player.selectedStaff).toBe('ember');
    // "Unlocked at tier 0" is not a wisp; the lowest bound tier is 1.
    expect(save.player.familiar).toEqual({ unlocked: true, tier: 1 });
    expect(save.player.bestiary).toEqual(['grunt']);
  });
});

describe('a save written by a newer build', () => {
  it('keeps every field this build knows and drops the rest', () => {
    storage.setItem(
      SAVE_KEY,
      JSON.stringify({
        version: 7,
        unlockedLevel: 9,
        muted: true,
        debug: true,
        firstClears: [1, 2],
        revealedRooms: ['yard'],
        prestige: { tier: 3 },
        player: { coins: 120, selectedStaff: 'ember', trinkets: ['ring'] },
      }),
    );

    const save = loadSave();
    expect(save.unlockedLevel).toBe(9);
    expect(save.muted).toBe(true);
    expect(save.firstClears).toEqual([1, 2]);
    expect(save.player.coins).toBe(120);
    // Read field by field against the defaults, so anything a v3 adds is simply
    // not here — and the version is re-stamped, so writing this save back
    // rewrites it as a v2. A future build that must not lose its own fields
    // takes a new key, exactly as v2 did.
    expect(save.version).toBe(SAVE_VERSION);
    expect(Object.keys(save).sort()).toEqual(
      ['debug', 'firstClears', 'muted', 'player', 'revealedRooms', 'unlockedLevel', 'version'],
    );
  });
});

describe('mergePlayer', () => {
  it('applies a patch over the current player and validates it', () => {
    const base = defaultPlayer();
    base.coins = 100;

    const merged = mergePlayer(base, {
      coins: 900,
      staffs: { storm: { unlocked: true, tier: 1 } },
      selectedStaff: 'storm',
      unlockedLevel: 6,
    });

    expect(merged.coins).toBe(900);
    expect(merged.staffs.storm.unlocked).toBe(true);
    expect(merged.staffs.ember.unlocked).toBe(true);
    expect(merged.staffs.frost.unlocked).toBe(false);
    expect(merged.selectedStaff).toBe('storm');
    expect(merged.unlockedLevel).toBe(6);
  });

  it('ignores a patch that is not an object', () => {
    const base = defaultPlayer();
    expect(mergePlayer(base, null)).toEqual(base);
    expect(mergePlayer(base, 7)).toEqual(base);
  });
});
