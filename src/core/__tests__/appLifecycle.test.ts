/**
 * What happens when the game stops being on screen.
 *
 * The interesting case is not either reason on its own, it is the order a phone
 * actually delivers them in: background, context lost, foreground, context
 * restored — four events for one phone call, arriving over a second or two, and
 * the loop has to stay down for all of it and come back exactly once. A restore
 * that arrived while the app was still away and started the loop would be a
 * game running behind a lock screen; a foreground that started it while the GPU
 * context was still gone would be frames drawn into nothing.
 *
 * Vitest runs in Node, so the browser half of `src/device/lifecycle.ts` needs a
 * `document` to attach to and `src/core/save.ts` needs a `localStorage` to
 * flush into. Both are stubbed, which is also the honest shape of the thing
 * being tested: a listener on a page, and a synchronous write.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameAudio } from '@/audio';

import { AppLifecycle } from '../appLifecycle';
import type { FrameDriver } from '../frame';
import { SAVE_KEY } from '../save';

/** Calls made on the driver, in order, so the sequencing can be read back. */
let driverCalls: string[] = [];
let suspendedAudio: boolean[] = [];
let dirtied = 0;
/** The page's `visibilitychange` handler, once `start` has attached one. */
let onVisibility: (() => void) | null = null;
let visibility: DocumentVisibilityState = 'visible';
/** Keys written to storage, so a flush can be told from silence. */
let writes: string[] = [];

function lifecycle(): AppLifecycle {
  return new AppLifecycle({
    driver: {
      pause: (): void => {
        driverCalls.push('pause');
      },
      resume: (): void => {
        driverCalls.push('resume');
      },
    } as unknown as FrameDriver,
    audio: {
      setSuspended: (value: boolean): void => {
        suspendedAudio.push(value);
      },
    } as unknown as GameAudio,
    markDirty: (): void => {
      dirtied++;
    },
  });
}

/** The page went away, or came back. */
function setVisibility(state: DocumentVisibilityState): void {
  visibility = state;
  onVisibility?.();
}

beforeEach(() => {
  driverCalls = [];
  suspendedAudio = [];
  dirtied = 0;
  onVisibility = null;
  visibility = 'visible';
  writes = [];

  vi.stubGlobal('document', {
    addEventListener: (type: string, handler: () => void): void => {
      if (type === 'visibilitychange') onVisibility = handler;
    },
    get visibilityState(): DocumentVisibilityState {
      return visibility;
    },
  });
  vi.stubGlobal('localStorage', {
    getItem: (): string | null => null,
    setItem: (key: string): void => {
      writes.push(key);
    },
    removeItem: (): void => undefined,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppLifecycle', () => {
  it('stops the clock, silences the sound and writes the save on the way out', () => {
    const app = lifecycle();
    app.start();

    setVisibility('hidden');
    expect(app.isBackground).toBe(true);
    expect(driverCalls).toEqual(['pause']);
    expect(suspendedAudio).toEqual([true]);
    expect(writes).toEqual([SAVE_KEY]);

    setVisibility('visible');
    expect(app.isBackground).toBe(false);
    expect(driverCalls).toEqual(['pause', 'resume']);
    // The player's own mute is untouched either way: this flag is only ever the
    // phone's, and `GameAudio` keeps the two apart.
    expect(suspendedAudio).toEqual([true, false]);
    // Nothing is written on the way back in; the save was already current.
    expect(writes).toEqual([SAVE_KEY]);

    app.stop();
  });

  /** The four events one phone call produces, in the order iOS sends them. */
  it('holds the loop down until both the app and the context are back', () => {
    const app = lifecycle();
    app.start();

    setVisibility('hidden');
    app.onContextLost();
    expect(driverCalls).toEqual(['pause', 'pause']);

    // Foreground first, context still gone: still no frames.
    setVisibility('visible');
    expect(driverCalls).toEqual(['pause', 'pause', 'pause']);

    app.onContextRestored();
    expect(driverCalls).toEqual(['pause', 'pause', 'pause', 'resume']);
    // The title backdrop is drawn once and then held, so a rebuilt scene has to
    // be told to draw it again — before the loop is let go, not after.
    expect(dirtied).toBe(1);

    app.stop();
  });

  /** The other order — restore lands before the app comes forward. */
  it('waits for the foreground when the context comes back first', () => {
    const app = lifecycle();
    app.start();

    setVisibility('hidden');
    app.onContextLost();
    app.onContextRestored();
    expect(driverCalls).toEqual(['pause', 'pause', 'pause']);
    expect(dirtied).toBe(1);

    setVisibility('visible');
    expect(driverCalls.at(-1)).toBe('resume');

    app.stop();
  });

  /** The pause menu is the third reason (docs/27, section B). */
  it('holds the loop and the sound while the run is paused', () => {
    const app = lifecycle();
    app.start();

    app.setRunPaused(true);
    expect(driverCalls).toEqual(['pause']);
    expect(suspendedAudio).toEqual([true]);
    // Pausing writes nothing: the save has not changed.
    expect(writes).toEqual([]);

    app.setRunPaused(true);
    expect(driverCalls).toEqual(['pause']);

    app.setRunPaused(false);
    expect(driverCalls).toEqual(['pause', 'resume']);
    expect(suspendedAudio).toEqual([true, false]);

    app.stop();
  });

  /** A phone call that ends while the menu is up must not start the run. */
  it('keeps a paused run held when the app comes back', () => {
    const app = lifecycle();
    const heard: string[] = [];
    app.listen({
      onVisibility: (background) => {
        heard.push(background ? 'away' : 'back');
        // What `RunPause` does on the way out: the menu goes up.
        if (background) app.setRunPaused(true);
      },
      redraw: () => {
        heard.push('redraw');
      },
    });
    app.start();

    setVisibility('hidden');
    expect(heard).toEqual(['away']);
    expect(suspendedAudio).toEqual([true]);

    setVisibility('visible');
    expect(heard).toEqual(['away', 'back']);
    // Still held, still quiet: the menu is what lets them go.
    expect(driverCalls.at(-1)).toBe('pause');
    expect(suspendedAudio).toEqual([true]);

    app.setRunPaused(false);
    expect(driverCalls.at(-1)).toBe('resume');
    expect(suspendedAudio).toEqual([true, false]);

    app.stop();
  });

  it('keeps a paused run held across a lost and restored context', () => {
    const app = lifecycle();
    let redraws = 0;
    app.listen({
      onVisibility: (): void => undefined,
      redraw: () => {
        redraws++;
      },
    });
    app.start();

    app.setRunPaused(true);
    app.onContextLost();
    app.onContextRestored();
    // The frozen frame behind the menu is drawn again; the loop stays down.
    expect(redraws).toBe(1);
    expect(driverCalls).toEqual(['pause', 'pause', 'pause']);

    app.setRunPaused(false);
    expect(driverCalls.at(-1)).toBe('resume');

    app.stop();
  });

  it('does not silence the sound for a lost context alone', () => {
    const app = lifecycle();
    app.start();
    app.onContextLost();
    app.onContextRestored();
    expect(suspendedAudio).toEqual([]);
    app.stop();
  });

  it('ignores a repeated transition', () => {
    const app = lifecycle();
    app.start();

    setVisibility('hidden');
    setVisibility('hidden');
    expect(suspendedAudio).toEqual([true]);
    expect(writes).toEqual([SAVE_KEY]);

    app.onContextLost();
    app.onContextLost();
    app.onContextRestored();
    app.onContextRestored();
    expect(dirtied).toBe(1);

    app.stop();
  });
});
