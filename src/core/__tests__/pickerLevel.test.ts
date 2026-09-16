/**
 * The picker opens on the newest unlocked level, every time (docs/29, note 3).
 *
 * The owner cleared a level, went Home instead of Continue, and found the
 * picker still pointed at the level just cleared. The level the picker showed
 * was one mutable number shared by the picker, the run on the road and the
 * URL, and only Continue ever moved it forward.
 *
 * So these tests play real runs — the real level, the greedy bot, the real sim
 * and the real meta layer over an in-memory save, so a clear really writes its
 * unlock — through the real menu stage, run stage and overlay callbacks, and
 * read what the overlay was asked to paint. The one stand-in is `TestApp`,
 * which does what `App`'s screen methods do (each is one line there) without a
 * renderer to boot.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameAudio } from '@/audio';
import { levelCount } from '@/data';
import type { Renderer } from '@/render/Renderer';
import type { LevelDef } from '@/sim';
import type { AcademyView, Overlay, OverlayCallbacks } from '@/ui';

import { AcademyController } from '../academy';
import { RunStage } from '../appRun';
import { overlayCallbacks } from '../controls';
import type { AppCommands } from '../controls';
import type { FrameDriver } from '../frame';
import type { Juice } from '../juice';
import { MenuStage } from '../menus';
import { RunPause } from '../pause';
import type { RoomId } from '../player';
import type { QualityLadder } from '../quality';
import { parseQuery } from '../query';
import { unlockLevel } from '../save';

const STEP = 1 / 60;
/** Sim seconds a greedy run may take before the harness calls it hung. */
const RUN_CAP_SECONDS = 400;
/** Wall-clock seconds of the beat before the sheet (`balance.ui.resultDelay`). */
const BEAT_CAP_SECONDS = 10;

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

type Phase = 'title' | 'playing' | 'result';

/** What the overlay and the renderer were asked to show, newest last. */
interface Painted {
  homes: AcademyView[];
  pickers: AcademyView[];
  rooms: RoomId[];
  /** Level indices loaded, with the phase they were loaded in. */
  loads: { level: number; phase: Phase }[];
  /** Level numbers the HUD was started on. */
  runs: number[];
  sheets: number;
}

/** `App`'s screen methods, one line each there, over the real stages. */
class TestApp implements AppCommands {
  readonly audio = {
    unlock: noop,
    playTap: noop,
    beginRun: noop,
    playPurchase: noop,
    playUnlock: noop,
    playRoomReveal: noop,
  } as unknown as GameAudio;
  readonly academy: AcademyController;
  readonly pause: RunPause;
  readonly menus: MenuStage;
  readonly runs: RunStage;
  readonly painted: Painted = { homes: [], pickers: [], rooms: [], loads: [], runs: [], sheets: 0 };
  readonly taps: OverlayCallbacks;
  /** True when the URL names a level, which may be one the save has not reached. */
  readonly pinned: boolean;
  phase: Phase = 'title';

  constructor(search: string) {
    const painted = this.painted;
    const overlay = {
      showAcademy: (view: AcademyView): void => {
        painted.homes.push(view);
      },
      showLevels: (view: AcademyView): void => {
        painted.pickers.push(view);
      },
      showRoom: (room: RoomId): void => {
        painted.rooms.push(room);
      },
      showPlaying: (level: number): void => {
        painted.runs.push(level);
      },
      showResult: (): void => {
        painted.sheets += 1;
      },
    } as unknown as Overlay;
    const renderer = {
      warmUp: () => Promise.resolve(),
      setCosmetics: noop,
      setPreviewPlayer: noop,
      update: noop,
      loadLevel: (level: LevelDef): void => {
        painted.loads.push({ level: level.index, phase: this.phase });
      },
    } as unknown as Renderer;
    const options = parseQuery(search, levelCount);
    this.pinned = options.level !== null;

    this.academy = new AcademyController({
      overlay,
      audio: this.audio,
      levelCount,
      onPlayerChanged: () => {
        this.menus.invalidate();
      },
      now: () => new Date('2026-09-16T12:00:00').getTime(),
    });
    this.menus = new MenuStage({
      renderer,
      academy: this.academy,
      options,
      physics: () => null,
      markDirty: noop,
    });
    this.runs = new RunStage({
      options,
      academy: this.academy,
      menus: this.menus,
      renderer,
      overlay,
      juice: { reset: noop, endDefeatCrawl: noop } as unknown as Juice,
      audio: this.audio,
      ladder: { beginLevel: noop } as unknown as QualityLadder,
      driver: { start: noop, resetPeak: noop } as unknown as FrameDriver,
      physics: () => null,
      onPhase: (next) => {
        this.phase = next;
        this.pause.release();
      },
    });
    this.pause = new RunPause({
      pausable: () => this.phase === 'playing' && this.runs.current?.finished === false,
      endless: () => this.runs.current?.isEndless === true,
      showMenu: noop,
      hideMenu: noop,
      hold: noop,
      redraw: noop,
      restart: () => {
        this.runs.replay();
      },
      home: () => {
        this.showHome();
      },
    });
    this.taps = overlayCallbacks(this);
  }

  /** `App.start`, from the home on. */
  boot(): this {
    this.academy.beginSession();
    this.showHome();
    return this;
  }

  startRun(): void {
    this.runs.startLevel(this.menus.playLevel);
  }

  retryRun(): void {
    this.runs.replay();
  }

  startEndless(seed: number | null = null): void {
    this.runs.startEndless(seed);
  }

  nextLevel(): void {
    this.runs.next();
  }

  selectLevel(level: number): void {
    if (this.phase !== 'title') return;
    this.menus.selectLevel(level);
  }

  openRoom(room: RoomId): void {
    if (this.phase !== 'title') return;
    this.menus.openRoom(room);
  }

  showHome(): void {
    this.phase = 'title';
    this.pause.release();
    this.runs.clear();
    this.menus.showHome();
  }

  toggleMute(): void {}

  toggleDebug(): void {}

  // --- Reading it back ----------------------------------------------------

  /** Opens the picker from the home and says which chip it pressed. */
  openPicker(): number {
    this.taps.onOpenRoom('play');
    const view = this.painted.pickers.at(-1);
    if (view === undefined) throw new Error('the picker was never painted');
    // A pressed chip is always one the player may tap, unless a URL said so.
    if (!this.pinned) expect(view.selectedLevel).toBeLessThanOrEqual(view.unlockedLevel);
    return view.selectedLevel;
  }

  /** The level the home was last painted over, as the renderer loaded it. */
  backdrop(): number | undefined {
    return this.painted.loads.filter((load) => load.phase === 'title').at(-1)?.level;
  }

  get walking(): number | undefined {
    return this.runs.current?.level.index;
  }

  /**
   * Plays the run on the road to its sheet: the bot steers, the sim ticks, the
   * session notes what it met, and the beat runs out — what `FrameDriver` and
   * `App.onFrameEnd` do a frame at a time.
   */
  finish(end: 'play' | 'lose' = 'play'): 'won' | 'lost' {
    const session = this.runs.current;
    if (session === null) throw new Error('no run on the road');
    if (end === 'lose') session.run.abandon();
    for (let t = 0; t < RUN_CAP_SECONDS && !session.finished; t += STEP) {
      session.steer();
      session.absorb(session.run.tick(STEP));
      this.runs.advanceEnding(STEP);
    }
    for (let t = 0; t < BEAT_CAP_SECONDS && this.phase === 'playing'; t += STEP) {
      this.runs.advanceEnding(STEP);
    }
    expect(this.phase).toBe('result');
    return session.won ? 'won' : 'lost';
  }
}

/** A booted app over a save whose newest level is `level`. */
function appAt(level: number, search = '?bot=greedy'): TestApp {
  const app = new TestApp(search);
  app.academy.setPlayer({ unlockedLevel: level, coins: 0 });
  return app.boot();
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the level the picker opens on', () => {
  it('is the newest level on a fresh boot, and the home stands on it', () => {
    const app = appAt(7);
    expect(app.backdrop()).toBe(7);
    expect(app.painted.homes.at(-1)?.selectedLevel).toBe(7);
    expect(app.openPicker()).toBe(7);
  });

  it('moves on to the level a clear opened when the sheet is left by Home', () => {
    const app = appAt(1);
    expect(app.openPicker()).toBe(1);
    app.taps.onPlay();
    expect(app.walking).toBe(1);
    expect(app.finish()).toBe('won');
    expect(app.academy.player.unlockedLevel).toBe(2);

    app.taps.onResultHome();
    // The home's backdrop follows the same rule: the road Play offers next.
    expect(app.backdrop()).toBe(2);
    expect(app.openPicker()).toBe(2);
    app.taps.onPlay();
    expect(app.walking).toBe(2);
  });

  it('is the newest level after a clear left by Continue', () => {
    const app = appAt(1);
    app.openPicker();
    app.taps.onPlay();
    expect(app.finish()).toBe('won');

    app.taps.onNext();
    expect(app.walking).toBe(2);
    expect(app.painted.runs.at(-1)).toBe(2);
    expect(app.finish()).toBe('won');

    app.taps.onResultHome();
    expect(app.backdrop()).toBe(3);
    expect(app.openPicker()).toBe(3);
  });

  it('is the newest level after a Continue run that was lost', () => {
    const app = appAt(1);
    app.openPicker();
    app.taps.onPlay();
    expect(app.finish()).toBe('won');

    app.taps.onNext();
    expect(app.walking).toBe(2);
    expect(app.finish('lose')).toBe('lost');

    app.taps.onResultHome();
    expect(app.openPicker()).toBe(2);
  });

  it('is the newest level after Retry, and Retry replays the level just walked', () => {
    const app = appAt(1);
    app.openPicker();
    app.taps.onPlay();
    const first = app.runs.current?.seed;
    expect(app.finish()).toBe('won');

    app.taps.onRetry();
    expect(app.walking).toBe(1);
    expect(app.runs.current?.seed).toBe(first);
    expect(app.finish()).toBe('won');

    app.taps.onResultHome();
    expect(app.openPicker()).toBe(2);
  });

  it('is the newest level after a loss on an older level', () => {
    const app = appAt(4);
    app.openPicker();
    app.taps.onSelectLevel(2);
    app.taps.onPlay();
    expect(app.walking).toBe(2);
    expect(app.finish('lose')).toBe('lost');

    // Retry is still the level the chip chose...
    app.taps.onRetry();
    expect(app.walking).toBe(2);
    expect(app.finish('lose')).toBe('lost');

    // ...and the picker has forgotten the chip.
    app.taps.onResultHome();
    expect(app.backdrop()).toBe(4);
    expect(app.openPicker()).toBe(4);
  });

  it('is the newest level after a replayed old level is cleared', () => {
    const app = appAt(3);
    app.openPicker();
    app.taps.onSelectLevel(1);
    app.taps.onPlay();
    expect(app.finish()).toBe('won');
    // Nothing new unlocked: level 2 was already open.
    expect(app.academy.player.unlockedLevel).toBe(3);

    // Continue follows the level walked, not the newest one.
    app.taps.onNext();
    expect(app.walking).toBe(2);
    app.taps.onResultHome();
    expect(app.openPicker()).toBe(3);
  });

  it('is the newest level after the pause menu takes the player home', () => {
    const app = appAt(5);
    app.openPicker();
    app.taps.onSelectLevel(3);
    app.taps.onPlay();
    expect(app.pause.pause()).toBe(true);
    app.taps.onHome();
    expect(app.phase).toBe('title');
    expect(app.openPicker()).toBe(5);
  });

  it('is the newest level after an endless run', () => {
    const app = appAt(6);
    app.openPicker();
    app.taps.onSelectLevel(4);
    app.taps.onEndless();
    expect(app.runs.current?.isEndless).toBe(true);
    expect(app.finish('lose')).toBe('lost');
    app.taps.onRetry();
    expect(app.runs.current?.isEndless).toBe(true);
    app.taps.onResultHome();
    expect(app.openPicker()).toBe(6);
  });

  it('forgets a chip when the player goes back, and after a walk through the rooms', () => {
    const app = appAt(5);
    expect(app.openPicker()).toBe(5);
    app.taps.onSelectLevel(2);
    expect(app.painted.pickers.at(-1)?.selectedLevel).toBe(2);
    // The backdrop is the chip's while the picker is up...
    expect(app.backdrop()).toBe(2);

    app.taps.onCloseRoom();
    // ...and the newest level's again on the home.
    expect(app.backdrop()).toBe(5);
    expect(app.openPicker()).toBe(5);

    app.taps.onSelectLevel(3);
    app.taps.onCloseRoom();
    app.taps.onOpenRoom('yard');
    expect(app.painted.rooms.at(-1)).toBe('yard');
    app.taps.onCloseRoom();
    app.taps.onOpenRoom('workbench');
    app.taps.onCloseRoom();
    expect(app.openPicker()).toBe(5);
  });

  it('lets a chip choose the level the next Play starts', () => {
    const app = appAt(12);
    // Level 12 is on the second page; the chip on the first is still a tap.
    expect(app.openPicker()).toBe(12);
    app.taps.onSelectLevel(3);
    expect(app.painted.pickers.at(-1)?.selectedLevel).toBe(3);
    app.taps.onSelectLevel(9);
    app.taps.onPlay();
    expect(app.walking).toBe(9);
    expect(app.painted.runs.at(-1)).toBe(9);
  });

  it('reads an unlock the controller did not write', () => {
    // A won run writes its unlock straight to storage (`RunSession`), and the
    // debug handle can start a new run before that run is paid.
    const app = appAt(2);
    unlockLevel(3);
    app.taps.onOpenRoom('yard');
    app.taps.onCloseRoom();
    expect(app.backdrop()).toBe(3);
    expect(app.painted.homes.at(-1)?.selectedLevel).toBe(3);
    expect(app.openPicker()).toBe(3);
  });

  it('stays inside the campaign for a save that says more', () => {
    const app = appAt(levelCount + 5);
    expect(app.openPicker()).toBe(levelCount);
  });

  it('follows an injected unlock on the picker that is up', () => {
    const app = appAt(2);
    expect(app.openPicker()).toBe(2);
    app.academy.setPlayer({ unlockedLevel: 6 });
    app.menus.repaint();
    expect(app.painted.pickers.at(-1)?.selectedLevel).toBe(6);
    expect(app.backdrop()).toBe(6);
  });
});

describe('a level named by the URL', () => {
  it('pins the picker for the page, above a save that has not reached it', () => {
    // The smoke's own shape: a fresh save, `?level=23`, Play.
    const app = appAt(1, '?bot=greedy&level=23');
    expect(app.backdrop()).toBe(23);
    expect(app.openPicker()).toBe(23);
    app.taps.onPlay();
    expect(app.walking).toBe(23);
    app.taps.onResultHome();
    expect(app.openPicker()).toBe(23);
  });

  it('still gives way to a chip', () => {
    const app = appAt(5, '?bot=greedy&level=4');
    expect(app.openPicker()).toBe(4);
    app.taps.onSelectLevel(1);
    app.taps.onPlay();
    expect(app.walking).toBe(1);
  });
});
