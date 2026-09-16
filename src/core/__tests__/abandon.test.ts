/**
 * A run left from the pause menu records nothing (docs/27, section B).
 *
 * Restart and Home drop the run on the road: no coins, no mission, streak or
 * bestiary progress from it, no unlock and no result sheet. Nothing in the
 * menu says "and do not pay" — the guarantee is structural, and this is what
 * holds it: a run is only ever paid by `RunStage.finish`, which only
 * `advanceEnding` reaches, which only a *finished* run gets past; and the menu
 * cannot be opened on a finished run at all.
 *
 * So the test plays a real run — the real level, the real bot, the real sim
 * and the real meta layer over an in-memory save — long enough that it has
 * killed things and met things, abandons it both ways through the real pause
 * controller, and asserts the save is byte-for-byte what it was before the run
 * started. The last case finishes a run the same way and watches the save
 * move, so a harness that could not see a payment cannot pass the rest.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameAudio } from '@/audio';
import { levelCount } from '@/data';
import type { Renderer } from '@/render/Renderer';
import type { Overlay, ResultView } from '@/ui';

import { AcademyController } from '../academy';
import { RunStage } from '../appRun';
import type { FrameDriver } from '../frame';
import type { Juice } from '../juice';
import type { MenuStage } from '../menus';
import { RunPause } from '../pause';
import type { QualityLadder } from '../quality';
import { parseQuery } from '../query';
import { SAVE_KEY } from '../save';

/** Sim seconds of play before the run is abandoned: long enough to kill things. */
const PLAY_SECONDS = 30;
const STEP = 1 / 60;

class MemoryStorage {
  private readonly entries = new Map<string, string>();

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, String(value));
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }
}

const noop = (): void => undefined;

let sheets: ResultView[] = [];
let phases: string[] = [];

function world(): { stage: RunStage; academy: AcademyController; pause: RunPause } {
  const academy = new AcademyController({
    overlay: { showAcademy: noop, showLevels: noop, showRoom: noop } as unknown as Overlay,
    audio: { playPurchase: noop, playUnlock: noop, playRoomReveal: noop } as unknown as GameAudio,
    levelCount,
    onPlayerChanged: noop,
    now: () => new Date('2026-09-16T12:00:00').getTime(),
  });
  // A save that exists, so "unchanged" is a comparison of two real strings.
  academy.setPlayer({ coins: 50 });
  let phase = 'title';
  const stage = new RunStage({
    options: parseQuery('?level=1&bot=greedy', levelCount),
    academy,
    menus: { end: noop } as unknown as MenuStage,
    renderer: {
      warmUp: () => Promise.resolve(),
      setCosmetics: noop,
      loadLevel: noop,
    } as unknown as Renderer,
    overlay: {
      showPlaying: noop,
      showResult: (view: ResultView): void => {
        sheets.push(view);
      },
    } as unknown as Overlay,
    juice: { reset: noop, endDefeatCrawl: noop } as unknown as Juice,
    audio: { beginRun: noop } as unknown as GameAudio,
    ladder: { beginLevel: noop } as unknown as QualityLadder,
    driver: { start: noop, resetPeak: noop } as unknown as FrameDriver,
    physics: () => null,
    onPhase: (next) => {
      phase = next;
      phases.push(next);
      pause.release();
    },
  });
  const pause = new RunPause({
    pausable: () => phase === 'playing' && stage.current?.finished === false,
    endless: () => stage.current?.isEndless === true,
    showMenu: noop,
    hideMenu: noop,
    hold: noop,
    redraw: noop,
    restart: () => {
      stage.replay();
    },
    home: () => {
      // What `App.showHome` does to the run.
      phase = 'title';
      phases.push('title');
      stage.clear();
    },
  });
  return { stage, academy, pause };
}

/**
 * One frame's worth of what `FrameDriver` does to a session, `seconds` times
 * over: steer, tick, let the session note what it met, and give the ending
 * its beat — which `App` only does in the `playing` phase.
 */
function play(stage: RunStage, seconds: number): void {
  for (let t = 0; t < seconds; t += STEP) {
    const session = stage.current;
    if (session === null || phases.at(-1) !== 'playing') return;
    session.steer();
    const events = session.run.tick(STEP);
    session.absorb(events);
    stage.advanceEnding(STEP);
  }
}

function saved(): string {
  const raw = globalThis.localStorage.getItem(SAVE_KEY);
  if (raw === null) throw new Error('no save was written');
  return raw;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  sheets = [];
  phases = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('abandoning a run from the pause menu', () => {
  it('has something to lose: the run it drops has killed and met things', () => {
    const { stage } = world();
    stage.startLevel(1);
    play(stage, PLAY_SECONDS);
    const session = stage.current;
    expect(session).not.toBeNull();
    if (session === null) return;
    expect(session.finished).toBe(false);
    const kills = Object.values(session.tally().kills).reduce((sum, n) => sum + n, 0);
    expect(kills).toBeGreaterThan(0);
    expect(session.seen.size).toBeGreaterThan(0);
  });

  it('records nothing on Restart, and starts the same road again', () => {
    const { stage, academy, pause } = world();
    const before = saved();
    const player = structuredClone(academy.player);

    stage.startLevel(1);
    const abandoned = stage.current;
    play(stage, PLAY_SECONDS);

    expect(pause.pause()).toBe(true);
    pause.restart();

    expect(pause.paused).toBe(false);
    expect(stage.current).not.toBe(abandoned);
    expect(stage.current?.seed).toBe(abandoned?.seed);
    expect(stage.current?.state.time).toBe(0);
    expect(saved()).toBe(before);
    expect(academy.player).toEqual(player);
    expect(stage.payout).toBeNull();
    expect(sheets).toEqual([]);
    expect(phases).toEqual(['playing', 'playing']);
  });

  it('records nothing on Home, and leaves no run behind', () => {
    const { stage, academy, pause } = world();
    const before = saved();
    const player = structuredClone(academy.player);

    stage.startLevel(1);
    play(stage, PLAY_SECONDS);

    expect(pause.pause()).toBe(true);
    pause.home();

    expect(stage.current).toBeNull();
    expect(saved()).toBe(before);
    expect(academy.player).toEqual(player);
    expect(stage.payout).toBeNull();
    expect(sheets).toEqual([]);
    expect(phases).toEqual(['playing', 'title']);
  });

  it('records nothing for an endless run either', () => {
    const { stage, academy, pause } = world();
    const before = saved();
    const player = structuredClone(academy.player);

    stage.startEndless();
    play(stage, PLAY_SECONDS);
    expect(stage.current?.isEndless).toBe(true);

    expect(pause.pause()).toBe(true);
    pause.home();

    expect(saved()).toBe(before);
    expect(academy.player).toEqual(player);
    expect(sheets).toEqual([]);
  });

  it('cannot be opened once the run has finished', () => {
    const { stage, pause } = world();
    stage.startLevel(1);
    play(stage, 1);
    stage.current?.run.abandon();
    play(stage, STEP);
    expect(stage.current?.finished).toBe(true);
    expect(pause.pause()).toBe(false);
  });

  /** The control: the same harness does see a run that is paid. */
  it('pays a run that finishes, so the cases above could have failed', () => {
    const { stage, academy } = world();
    const before = saved();
    const coins = academy.player.coins;

    stage.startLevel(1);
    play(stage, PLAY_SECONDS);
    // A loss, which pays too (D46), ended the way the debug handle ends one.
    stage.current?.run.abandon();
    play(stage, 5);

    expect(sheets).toHaveLength(1);
    expect(stage.payout).not.toBeNull();
    expect(saved()).not.toBe(before);
    expect(academy.player.coins).toBeGreaterThan(coins);
    expect(academy.player.streak.days).toBe(1);
  });
});
