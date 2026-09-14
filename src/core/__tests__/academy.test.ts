/**
 * The controller's Milestone 8 seams: the board rolled at the start of a play
 * session, and the meta layer paid where the road is (D51 to D53).
 *
 * The overlay and the audio are stubs — this is about what reaches the save,
 * not about what is drawn — and the clock is injected, which is the whole
 * reason `AcademyDeps.now` exists: the streak is about which calendar day a run
 * finished on, and a test has to be able to say.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameAudio } from '@/audio';
import type { Overlay } from '@/ui';

import { AcademyController } from '../academy';
import { emptyKills, tiersOf } from '../bestiary';
import { boardSize } from '../missions';
import type { RunTally } from '../missions';
import { defaultPlayer } from '../player';
import { loadSave, setPlayer } from '../save';
import type { RunSession } from '../session';
import { streakBonus } from '../streak';

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

/** Every overlay call the controller can make, doing nothing. */
function stubOverlay(): Overlay {
  const noop = (): void => undefined;
  return { showAcademy: noop, showLevels: noop, showRoom: noop } as unknown as Overlay;
}

function stubAudio(): GameAudio {
  const noop = (): void => undefined;
  return {
    playPurchase: noop,
    playUnlock: noop,
    playRoomReveal: noop,
  } as unknown as GameAudio;
}

function controller(day: string): AcademyController {
  return new AcademyController({
    overlay: stubOverlay(),
    audio: stubAudio(),
    levelCount: 40,
    onPlayerChanged: () => undefined,
    now: () => new Date(`${day}T12:00:00`).getTime(),
  });
}

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

/** The five things `payRun` reads off a session. */
function fakeSession(fields: {
  won: boolean;
  survivors?: number;
  seed?: number;
  seen?: string[];
  tally?: RunTally;
}): RunSession {
  const survivors = fields.survivors ?? 0;
  const session = {
    won: fields.won,
    seed: fields.seed ?? 1137,
    seen: new Set(fields.seen ?? []),
    state: {
      status: fields.won ? 'won' : 'lost',
      survivors,
      squad: { z: 100 },
      arenaZ: 100,
    },
    tally: () => fields.tally ?? tally({ cleared: fields.won, survivors }),
  };
  // A real session would have to play a level out; `payRun` reads five fields.
  return session as unknown as RunSession;
}

describe('the start of a play session', () => {
  it('fills the board and writes it once', () => {
    const academy = controller('2026-09-14');
    expect(academy.player.missions.active).toHaveLength(0);

    academy.beginSession();
    expect(academy.player.missions.active).toHaveLength(boardSize);
    expect(loadSave().player.missions.rolled).toBe(boardSize);

    const board = academy.missionsView();
    expect(board).toHaveLength(boardSize);
    expect(board.every((row) => row.progress === 0 && !row.done)).toBe(true);

    // A second session start on a board with nothing finished changes nothing.
    const before = JSON.stringify(academy.player.missions);
    academy.beginSession();
    expect(JSON.stringify(academy.player.missions)).toBe(before);
  });

  it('replaces the missions that are done', () => {
    const academy = controller('2026-09-14');
    academy.beginSession();
    const first = academy.player.missions.active[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    const player = defaultPlayer();
    player.missions = {
      active: academy.player.missions.active.map((mission) =>
        mission.id === first.id ? { ...mission, done: true } : mission,
      ),
      rolled: academy.player.missions.rolled,
    };
    setPlayer(player);

    const next = controller('2026-09-15');
    next.beginSession();
    expect(next.player.missions.active).toHaveLength(boardSize);
    expect(next.player.missions.active.map((mission) => mission.id)).not.toContain(first.id);
  });
});

describe('paying a run', () => {
  it('pays the road and the meta layer, and reports both', () => {
    const academy = controller('2026-09-14');
    const rung = tiersOf('grunt')[0];
    if (rung === undefined) return;

    const payout = academy.payRun(
      fakeSession({
        won: true,
        survivors: 60,
        seed: 4242,
        seen: ['grunt'],
        tally: tally({
          cleared: true,
          survivors: 60,
          peak: 400,
          kills: { ...emptyKills(), grunt: rung.kills },
        }),
      }),
      5,
    );

    expect(payout.coins).toBeGreaterThan(0);
    expect(payout.streakCoins).toBe(streakBonus(1));
    expect(payout.tierCoins).toBe(rung.coins);
    expect(payout.bonusCoins).toBe(
      payout.streakCoins + payout.missionCoins + payout.tierCoins,
    );
    expect(payout.totalCoins).toBe(payout.coins + payout.bonusCoins);
    expect(payout.seed).toBe(4242);
    expect(payout.best).toEqual({ survivors: 60, peak: 400 });
    expect(payout.bestImproved).toBe(true);
    expect(payout.streak.days).toBe(1);
    expect(payout.streak.claimedToday).toBe(true);

    const saved = loadSave().player;
    expect(saved.coins).toBe(payout.totalCoins);
    expect(saved.kills.grunt).toBe(rung.kills);
    expect(saved.cosmetics.owned).toEqual([rung.cosmetic]);
    expect(saved.bestiary).toEqual(['grunt']);
    expect(saved.levelBest['5']).toEqual({ survivors: 60, peak: 400 });
  });

  it('advances the streak across days and resets on a skipped one', () => {
    const first = controller('2026-09-14').payRun(fakeSession({ won: true }), 1);
    expect(first.streak.days).toBe(1);

    const second = controller('2026-09-15').payRun(fakeSession({ won: true }), 1);
    expect(second.streak.days).toBe(2);
    expect(second.streakCoins).toBe(streakBonus(2));

    // Same day again: the day is claimed, so the streak pays nothing.
    const again = controller('2026-09-15').payRun(fakeSession({ won: true }), 1);
    expect(again.streak.days).toBe(2);
    expect(again.streakCoins).toBe(0);

    // A day skipped entirely.
    const missed = controller('2026-09-17').payRun(fakeSession({ won: true }), 1);
    expect(missed.streak.days).toBe(1);
  });

  it('pays the streak on a lost run too, and writes no level best', () => {
    const payout = controller('2026-09-14').payRun(
      fakeSession({ won: false, survivors: 0, tally: tally({ cleared: false }) }),
      3,
    );
    expect(payout.streakCoins).toBe(streakBonus(1));
    expect(payout.best).toBeNull();
    expect(loadSave().player.levelBest).toEqual({});
  });
});

describe('the Wardrobe through the controller', () => {
  it('refuses an unowned tint and wears an owned one', () => {
    const academy = controller('2026-09-14');
    academy.selectCosmetic('hat', 'hatBone');
    expect(academy.player.cosmetics.selected).toEqual({});

    const player = defaultPlayer();
    player.cosmetics = { owned: ['hatBone'], selected: {} };
    setPlayer(player);

    const dressed = controller('2026-09-14');
    dressed.selectCosmetic('hat', 'hatBone');
    expect(dressed.player.cosmetics.selected).toEqual({ hat: 'hatBone' });
    expect(loadSave().player.cosmetics.selected).toEqual({ hat: 'hatBone' });

    const view = dressed.wardrobeView();
    const hats = view.slots.find((slot) => slot.id === 'hat');
    expect(hats?.choices.find((choice) => choice.id === 'hatBone')?.selected).toBe(true);
  });
});
