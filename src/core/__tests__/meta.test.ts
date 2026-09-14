/**
 * One finished run, applied to the whole meta layer (D51 to D53).
 *
 * `applyRunMeta` is the seam every Milestone 8 reward passes through, so this
 * is where the interactions are tested: that the three purses add up into one
 * number, that a second run on the same day pays the streak nothing but still
 * moves the missions, and that a worse run cannot take a level's best away.
 */

import { describe, expect, it } from 'vitest';

import { missionDef } from '@/data';

import { emptyKills } from '../bestiary';
import { tiersOf } from '../bestiary';
import { applyRunMeta } from '../meta';
import type { RunTally } from '../missions';
import { defaultPlayer } from '../player';
import type { PlayerState } from '../player';
import { streakBonus } from '../streak';

function tally(fields: Partial<RunTally> = {}): RunTally {
  return {
    cleared: false,
    endless: false,
    survivors: 0,
    peak: 0,
    shieldsBroken: 0,
    chargersKilled: 0,
    mulGates: 0,
    bossSeconds: null,
    cleanColumn: true,
    metres: 0,
    kills: emptyKills(),
    ...fields,
  };
}

function player(fields: Partial<PlayerState> = {}): PlayerState {
  return { ...defaultPlayer(), ...fields };
}

const DAY = '2026-09-14';

describe('applying a run', () => {
  it('pays the streak on the first run of a day and nothing on the second', () => {
    const first = applyRunMeta(player(), { level: 1, tally: tally({ cleared: true }) }, DAY);
    expect(first.streakCoins).toBe(streakBonus(1));
    expect(first.player.streak).toEqual({ days: 1, lastDay: DAY });
    expect(first.player.coins).toBe(first.coins);

    const second = applyRunMeta(first.player, { level: 1, tally: tally({ cleared: true }) }, DAY);
    expect(second.streakCoins).toBe(0);
    expect(second.player.streak).toEqual({ days: 1, lastDay: DAY });
  });

  it('adds the three purses into one bonus', () => {
    const start = player({
      missions: { active: [{ id: 'roads3', progress: 2, done: false }], rolled: 1 },
    });
    const rung = tiersOf('brute')[0];
    if (rung === undefined) return;

    const outcome = applyRunMeta(
      start,
      {
        level: 4,
        tally: tally({ cleared: true, kills: { ...emptyKills(), brute: rung.kills } }),
      },
      DAY,
    );

    expect(outcome.missionCoins).toBe(missionDef('roads3')?.reward);
    expect(outcome.tierCoins).toBe(rung.coins);
    expect(outcome.streakCoins).toBe(streakBonus(1));
    expect(outcome.coins).toBe(
      outcome.missionCoins + outcome.tierCoins + outcome.streakCoins,
    );
    expect(outcome.player.coins).toBe(outcome.coins);
    expect(outcome.player.cosmetics.owned).toEqual([rung.cosmetic]);
    expect(outcome.unlocked).toEqual([rung.cosmetic]);
    expect(outcome.completed.map((row) => row.id)).toEqual(['roads3']);
  });

  it('counts kills whatever the run paid', () => {
    const outcome = applyRunMeta(
      player(),
      { level: 2, tally: tally({ kills: { ...emptyKills(), grunt: 31, charger: 2 } }) },
      DAY,
    );
    expect(outcome.player.kills.grunt).toBe(31);
    expect(outcome.player.kills.charger).toBe(2);
    expect(outcome.player.kills.rime).toBe(0);
  });

  it('records a level best on a clear, and keeps the better of two', () => {
    const first = applyRunMeta(
      player(),
      { level: 6, tally: tally({ cleared: true, survivors: 40, peak: 300 }) },
      DAY,
    );
    expect(first.bestImproved).toBe(true);
    expect(first.player.levelBest['6']).toEqual({ survivors: 40, peak: 300 });

    const worse = applyRunMeta(
      first.player,
      { level: 6, tally: tally({ cleared: true, survivors: 12, peak: 900 }) },
      DAY,
    );
    expect(worse.bestImproved).toBe(false);
    expect(worse.player.levelBest['6']).toEqual({ survivors: 40, peak: 300 });
    expect(worse.levelBest).toEqual({ survivors: 40, peak: 300 });

    const better = applyRunMeta(
      worse.player,
      { level: 6, tally: tally({ cleared: true, survivors: 41, peak: 200 }) },
      DAY,
    );
    expect(better.bestImproved).toBe(true);
    expect(better.player.levelBest['6']).toEqual({ survivors: 41, peak: 200 });
  });

  it('writes no best for a run that did not reach the end', () => {
    const outcome = applyRunMeta(
      player(),
      { level: 6, tally: tally({ cleared: false, survivors: 80, peak: 400 }) },
      DAY,
    );
    expect(outcome.levelBest).toBeNull();
    expect(outcome.bestImproved).toBe(false);
    expect(outcome.player.levelBest).toEqual({});
  });

  it('records the endless road in metres and runs, not as a level best', () => {
    const first = applyRunMeta(
      player(),
      { level: 0, tally: tally({ endless: true, metres: 640.4, survivors: 0 }) },
      DAY,
    );
    expect(first.endlessBest).toBe(true);
    expect(first.player.endless).toEqual({ bestMetres: 640, runs: 1 });
    expect(first.player.levelBest).toEqual({});

    const shorter = applyRunMeta(
      first.player,
      { level: 0, tally: tally({ endless: true, metres: 100 }) },
      DAY,
    );
    expect(shorter.endlessBest).toBe(false);
    expect(shorter.player.endless).toEqual({ bestMetres: 640, runs: 2 });
  });

  it('never writes through the player it was handed', () => {
    const start = player({
      missions: { active: [{ id: 'roads3', progress: 0, done: false }], rolled: 1 },
    });
    const before = JSON.stringify(start);
    applyRunMeta(start, { level: 1, tally: tally({ cleared: true, survivors: 9 }) }, DAY);
    expect(JSON.stringify(start)).toBe(before);
  });
});
