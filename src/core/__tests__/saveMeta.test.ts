/**
 * Save v3's meta block: the migration up from v2, and the repair of a v3 that
 * has been hand-edited (D51 to D53).
 *
 * Split from `./save.test.ts` — which is still the v1 chain, the round trip and
 * the switches — because the two suites answer different questions: that one is
 * about the save as a file, this one is about the six fields Milestone 8 added
 * to the player inside it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultPlayer } from '../player';
import { SAVE_KEY, SAVE_KEY_V2, SAVE_VERSION, loadSave, setPlayer } from '../save';

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

/**
 * The migration Milestone 8 is: a v2 save on the device, a v3 build reading it.
 * Nothing is asked of the player, nothing is lost, and every field the meta
 * layer added starts at its default (D51 to D53).
 */
describe('the v2 chain', () => {
  const v2Save = {
    version: 2,
    unlockedLevel: 12,
    muted: true,
    debug: false,
    firstClears: [1, 2, 3],
    revealedRooms: ['yard', 'workbench'],
    player: {
      coins: 5400,
      upgrades: { damage: 3, fireRate: 2, startCount: 1, gateBonus: 1, bossDamage: 0 },
      staffs: {
        ember: { unlocked: true, tier: 2 },
        storm: { unlocked: true, tier: 1 },
        frost: { unlocked: false, tier: 1 },
      },
      selectedStaff: 'storm',
      familiar: { unlocked: true, tier: 2 },
      bestiary: ['grunt', 'brute', 'demon'],
      unlockedLevel: 12,
    },
  };

  it('carries a v2 save over whole', () => {
    storage.setItem(SAVE_KEY_V2, JSON.stringify(v2Save));

    const save = loadSave();

    expect(save.version).toBe(SAVE_VERSION);
    expect(save.unlockedLevel).toBe(12);
    expect(save.muted).toBe(true);
    expect(save.firstClears).toEqual([1, 2, 3]);
    expect(save.revealedRooms).toEqual(['yard', 'workbench']);
    expect(save.player.coins).toBe(5400);
    expect(save.player.upgrades.damage).toBe(3);
    // The one evolution Milestone 4 sold is still tier 2 after D54 widened the
    // ladder: the number a player had means what it always meant.
    expect(save.player.staffs.ember).toEqual({ unlocked: true, tier: 2 });
    expect(save.player.selectedStaff).toBe('storm');
    expect(save.player.familiar).toEqual({ unlocked: true, tier: 2 });
    expect(save.player.bestiary).toEqual(['grunt', 'brute', 'demon']);
  });

  it('defaults every field the meta layer added', () => {
    storage.setItem(SAVE_KEY_V2, JSON.stringify(v2Save));

    const { player } = loadSave();

    expect(player.streak).toEqual({ days: 0, lastDay: '' });
    expect(player.missions).toEqual({ active: [], rolled: 0 });
    expect(player.kills).toEqual({
      grunt: 0,
      brute: 0,
      charger: 0,
      shieldBrute: 0,
      demon: 0,
      rime: 0,
    });
    expect(player.cosmetics).toEqual({ owned: [], selected: {} });
    expect(player.endless).toEqual({ bestMetres: 0, runs: 0 });
    expect(player.levelBest).toEqual({});
  });

  it('writes it back under the v3 key and leaves v2 where it is', () => {
    storage.setItem(SAVE_KEY_V2, JSON.stringify(v2Save));

    loadSave();

    expect(storage.getItem(SAVE_KEY_V2)).not.toBeNull();
    const written: unknown = JSON.parse(storage.getItem(SAVE_KEY) ?? 'null');
    expect(written).toMatchObject({ version: SAVE_VERSION, unlockedLevel: 12 });
  });

  it('prefers a v3 save to the v2 beside it', () => {
    storage.setItem(SAVE_KEY_V2, JSON.stringify(v2Save));
    storage.setItem(
      SAVE_KEY,
      JSON.stringify({ ...v2Save, version: 3, unlockedLevel: 20, player: { coins: 1 } }),
    );

    const save = loadSave();
    expect(save.unlockedLevel).toBe(20);
    expect(save.player.coins).toBe(1);
  });

  it('falls back to a fresh save for a corrupt v2', () => {
    storage.setItem(SAVE_KEY_V2, 'half a save');
    expect(() => loadSave()).not.toThrow();
    expect(loadSave().unlockedLevel).toBe(1);
  });
});

describe('the v3 meta block', () => {
  it('returns the whole meta layer it was given', () => {
    const player = defaultPlayer();
    player.streak = { days: 6, lastDay: '2026-09-14' };
    player.missions = {
      active: [
        { id: 'roads3', progress: 2, done: false },
        { id: 'boss25', progress: 1, done: true },
      ],
      rolled: 7,
    };
    player.kills = { grunt: 900, brute: 40, charger: 12, shieldBrute: 8, demon: 3, rime: 1 };
    player.cosmetics = { owned: ['hatBone', 'hatStone'], selected: { hat: 'hatStone' } };
    player.endless = { bestMetres: 1480, runs: 9 };
    player.levelBest = { '3': { survivors: 44, peak: 260 } };

    setPlayer(player);
    expect(loadSave().player).toEqual(player);
  });

  it('repairs a partial or hand-edited v3', () => {
    storage.setItem(
      SAVE_KEY,
      JSON.stringify({
        version: 3,
        unlockedLevel: 3,
        player: {
          coins: 10,
          // A count with no day, a board of nonsense, a negative kill count, a
          // tint nobody owns being worn, and a best on a level that cannot be.
          streak: { days: 40, lastDay: 'soon' },
          missions: {
            active: [
              { id: 'roads3', progress: -5, done: 'yes' },
              { id: 'roads3', progress: 1, done: false },
              { id: 'retired-long-ago', progress: 2, done: false },
            ],
            rolled: -3,
          },
          kills: { grunt: -10, brute: 4.7, wyvern: 100 },
          cosmetics: { owned: ['hatBone', 'hatBone', 'nope'], selected: { hat: 'capeBone', cape: 'capeBone' } },
          endless: { bestMetres: -20, runs: 'many' },
          levelBest: { '2': { survivors: -1, peak: 12.6 }, zero: { survivors: 5, peak: 5 } },
        },
      }),
    );

    const { player } = loadSave();

    expect(player.streak).toEqual({ days: 0, lastDay: '' });
    // The duplicate and the retired id are gone; `done` is a boolean or false.
    expect(player.missions).toEqual({
      active: [{ id: 'roads3', progress: 0, done: false }],
      rolled: 0,
    });
    expect(player.kills.grunt).toBe(0);
    expect(player.kills.brute).toBe(4);
    expect(player.cosmetics.owned).toEqual(['hatBone']);
    // A hat slot cannot hold a cape, and a cape nobody owns cannot be worn.
    expect(player.cosmetics.selected).toEqual({});
    expect(player.endless).toEqual({ bestMetres: 0, runs: 0 });
    expect(player.levelBest).toEqual({ '2': { survivors: 0, peak: 12 } });
  });

  it('keeps a worn tint that is owned and fits its slot', () => {
    storage.setItem(
      SAVE_KEY,
      JSON.stringify({
        version: 3,
        unlockedLevel: 3,
        player: {
          cosmetics: { owned: ['hatBone', 'capeBone'], selected: { hat: 'hatBone' } },
        },
      }),
    );

    const { player } = loadSave();
    expect(player.cosmetics.owned).toEqual(['hatBone', 'capeBone']);
    expect(player.cosmetics.selected).toEqual({ hat: 'hatBone' });
  });
});
