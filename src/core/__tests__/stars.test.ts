/**
 * The picker's star after document 31 (4.6, D70, the owner's answer 4): every
 * best and every star already earned is kept, and the threshold comes down to
 * about half the peak.
 *
 * How many clears earn it is measured on the armed human campaign, whose
 * survivors run above the bare survivors band. Ruling of 2026-09-17: the
 * earlier "about a third of the clears" was this file's own reading, not the
 * owner's (the owner asked for the threshold at about half the peak, which
 * stays); the band is 0.45 to 0.75 of the campaign's clears starred, and the
 * owner's device run re-sets it.
 *
 * No save field changed. A star is not stored: it is `earnsStar` over the
 * level's best walk, which the save keeps as earned (`./saveMeta.ts`), so the
 * promise is two facts — the loader hands back every best untouched, and a
 * best that earned the star at the old share earns it at the new one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCampaign } from '@/sim/campaign';
import type { LevelBest } from '@/data';

import { STAR_SHARE, applyRunMeta, earnsStar } from '../meta';
import type { RunTally } from '../missions';
import { SAVE_KEY, loadSave } from '../save';

/** The share Milestone 8 shipped (document 28's saves were earned against it). */
const MILESTONE_8_SHARE = 0.6;

/** "About half the peak" (answer 4). */
const SHARE_BAND: readonly [number, number] = [0.45, 0.55];
/** The armed campaign's clears that earn the star (ruling of 2026-09-17, above). */
const STARRED_CLEARS: readonly [number, number] = [0.45, 0.75];

const SEEDS = [1, 2, 3];

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

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const earnedBefore = (best: LevelBest): boolean =>
  best.peak > 0 && best.survivors >= best.peak * MILESTONE_8_SHARE;

/** A save as a Milestone 9 build wrote it, with bests on either side of both shares. */
const OLD_BESTS: Record<string, LevelBest> = {
  '1': { survivors: 63, peak: 105 },
  '2': { survivors: 90, peak: 130 },
  '3': { survivors: 90, peak: 160 },
  '4': { survivors: 97, peak: 195 },
  '5': { survivors: 112, peak: 225 },
  '7': { survivors: 1, peak: 295 },
  '21': { survivors: 301, peak: 500 },
  '22': { survivors: 250, peak: 500 },
};

describe('stars after document 31', () => {
  it('sits the star at about half the peak, below the share it replaced', () => {
    expect(STAR_SHARE).toBeGreaterThanOrEqual(SHARE_BAND[0]);
    expect(STAR_SHARE).toBeLessThanOrEqual(SHARE_BAND[1]);
    expect(STAR_SHARE).toBeLessThan(MILESTONE_8_SHARE);
  });

  it('keeps every best an old save carries, and every star it showed', () => {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({ version: 3, unlockedLevel: 23, player: { coins: 400, levelBest: OLD_BESTS } }),
    );
    const { player } = loadSave();
    expect(player.levelBest).toEqual(OLD_BESTS);
    const lost: string[] = [];
    for (const [level, best] of Object.entries(OLD_BESTS)) {
      if (earnedBefore(best) && !earnsStar(player.levelBest[level] ?? null)) lost.push(level);
    }
    expect(lost).toEqual([]);
    // ...and the ones between the two shares are new stars, not lost ones.
    expect(earnsStar(player.levelBest['3'] ?? null)).toBe(true);
    expect(earnsStar(player.levelBest['7'] ?? null)).toBe(false);
  });

  it('never takes a star away at any size of walk', () => {
    const taken: string[] = [];
    for (let peak = 1; peak <= 500; peak++) {
      for (let survivors = 0; survivors <= peak; survivors++) {
        const best = { survivors, peak };
        if (earnedBefore(best) && !earnsStar(best)) taken.push(`${String(survivors)}/${String(peak)}`);
      }
    }
    expect(taken).toEqual([]);
  });

  it('keeps a starred best through a worse walk on the new roads', () => {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({ version: 3, unlockedLevel: 23, player: { levelBest: OLD_BESTS } }),
    );
    const { player } = loadSave();
    const tally: RunTally = {
      cleared: true,
      endless: false,
      survivors: 40,
      peak: 400,
      shieldsBroken: 0,
      chargersKilled: 0,
      mulGates: 0,
      bossSeconds: 24,
      cleanColumn: true,
      metres: 0,
      kills: { grunt: 0, brute: 0, charger: 0, shieldBrute: 0, demon: 1, rime: 0 },
    };
    const payout = applyRunMeta(player, { level: 21, tally }, '2026-09-17');
    expect(payout.bestImproved).toBe(false);
    expect(payout.player.levelBest['21']).toEqual(OLD_BESTS['21']);
    expect(earnsStar(payout.levelBest)).toBe(true);
  });

  it('stars roughly half to three quarters of the armed campaign\'s clears', () => {
    // The human campaign's clears, every level, three seeds: the walks a
    // player makes on the kit the road paid for (D45, D46).
    let clears = 0;
    let starred = 0;
    for (const seed of SEEDS) {
      for (const run of runCampaign({ bot: 'human', seed }).runs) {
        if (!run.facts.cleared) continue;
        clears++;
        if (earnsStar({ survivors: run.facts.survivors, peak: run.facts.peak })) starred++;
      }
    }
    const share = starred / Math.max(1, clears);
    const inBand = share >= STARRED_CLEARS[0] && share <= STARRED_CLEARS[1];
    const where =
      `${String(starred)} of ${String(clears)} clears starred at ${String(STAR_SHARE)}: ` +
      `${share.toFixed(2)}, band [${String(STARRED_CLEARS[0])}, ${String(STARRED_CLEARS[1])}]`;
    expect(`${where}: ${String(inBand)}`).toBe(`${where}: true`);
  }, 600_000);
});
