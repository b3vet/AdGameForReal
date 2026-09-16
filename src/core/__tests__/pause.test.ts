/**
 * The pause menu's rules (docs/27, section B), with every switch they drive
 * recorded in order.
 *
 * The order is the point in two places. Pausing holds the loop *before* the
 * menu goes up, so no frame of the run can land between the tap and the hold;
 * and Restart and Home let the hold go before they act, so the new run (or the
 * Academy) is what the next frame draws. Everything else here is the list of
 * screens where pausing must do nothing at all.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { RunPause, isPauseKey } from '../pause';
import type { PauseKeyEvent } from '../pause';

/** Every switch the controller flipped, in the order it flipped them. */
let calls: string[] = [];
let pausable = true;
let endless = false;

function controller(): RunPause {
  return new RunPause({
    pausable: () => pausable,
    endless: () => endless,
    showMenu: (forEndless) => {
      calls.push(forEndless ? 'menu:endless' : 'menu');
    },
    hideMenu: () => {
      calls.push('hide');
    },
    hold: (paused) => {
      calls.push(paused ? 'hold' : 'release');
    },
    redraw: () => {
      calls.push('redraw');
    },
    restart: () => {
      calls.push('restart');
    },
    home: () => {
      calls.push('home');
    },
  });
}

beforeEach(() => {
  calls = [];
  pausable = true;
  endless = false;
});

describe('RunPause', () => {
  it('holds the run before the menu goes up, and lets it go on Resume', () => {
    const pause = controller();
    expect(pause.pause()).toBe(true);
    expect(pause.paused).toBe(true);
    expect(calls).toEqual(['hold', 'menu']);

    pause.resume();
    expect(pause.paused).toBe(false);
    expect(calls).toEqual(['hold', 'menu', 'hide', 'release']);
  });

  it('does nothing where there is no run being played', () => {
    // The Academy, the result sheet, and a run's end sequence all look the
    // same from here: not pausable.
    pausable = false;
    const pause = controller();
    expect(pause.pause()).toBe(false);
    expect(pause.toggle()).toBe(false);
    pause.onVisibility(true);
    pause.resume();
    pause.restart();
    pause.home();
    pause.release();
    pause.redraw();
    expect(pause.paused).toBe(false);
    expect(calls).toEqual([]);
  });

  it('opens once however many times it is asked', () => {
    const pause = controller();
    pause.pause();
    expect(pause.pause()).toBe(true);
    pause.onVisibility(true);
    expect(calls).toEqual(['hold', 'menu']);
  });

  it('names the Restart button for the endless road', () => {
    endless = true;
    const pause = controller();
    pause.pause();
    expect(calls).toEqual(['hold', 'menu:endless']);
  });

  it('toggles on P and Escape, and says when it did something', () => {
    const pause = controller();
    expect(pause.toggle()).toBe(true);
    expect(pause.paused).toBe(true);
    expect(pause.toggle()).toBe(true);
    expect(pause.paused).toBe(false);
    expect(calls).toEqual(['hold', 'menu', 'hide', 'release']);
  });

  it('drops the run on Restart only after the menu and the hold are gone', () => {
    const pause = controller();
    pause.pause();
    pause.restart();
    expect(pause.paused).toBe(false);
    expect(calls).toEqual(['hold', 'menu', 'hide', 'release', 'restart']);
  });

  it('drops the run on Home the same way', () => {
    const pause = controller();
    pause.pause();
    pause.home();
    expect(pause.paused).toBe(false);
    expect(calls).toEqual(['hold', 'menu', 'hide', 'release', 'home']);
  });

  it('ignores Restart and Home when the menu is not up', () => {
    const pause = controller();
    pause.restart();
    pause.home();
    expect(calls).toEqual([]);
  });

  /** A phone call, and the player coming back to the menu rather than the fight. */
  it('pauses on the way out and stays paused on the way back', () => {
    const pause = controller();
    pause.onVisibility(true);
    expect(pause.paused).toBe(true);
    pause.onVisibility(false);
    expect(pause.paused).toBe(true);
    // The web view may have dropped the picture while it was away.
    expect(calls).toEqual(['hold', 'menu', 'redraw']);
  });

  it('asks for the frozen frame only while there is one', () => {
    const pause = controller();
    pause.redraw();
    pause.onVisibility(false);
    expect(calls).toEqual([]);

    pause.pause();
    pause.redraw();
    expect(calls).toEqual(['hold', 'menu', 'redraw']);
  });

  it('lets go when the phase moves under it', () => {
    const pause = controller();
    pause.pause();
    pause.release();
    expect(pause.paused).toBe(false);
    expect(calls).toEqual(['hold', 'menu', 'hide', 'release']);
    // Twice is once.
    pause.release();
    expect(calls).toHaveLength(4);
  });

  it('can pause again after a resume', () => {
    const pause = controller();
    pause.pause();
    pause.resume();
    expect(pause.pause()).toBe(true);
    expect(calls).toEqual(['hold', 'menu', 'hide', 'release', 'hold', 'menu']);
  });
});

describe('isPauseKey', () => {
  const press = (fields: Partial<PauseKeyEvent>): PauseKeyEvent => ({
    code: '',
    key: '',
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...fields,
  });

  it('is P and Escape', () => {
    expect(isPauseKey(press({ code: 'KeyP', key: 'p' }))).toBe(true);
    // Shift is not a chord anything else wants: caps lock on still pauses.
    expect(isPauseKey(press({ code: 'KeyP', key: 'P' }))).toBe(true);
    expect(isPauseKey(press({ code: 'Escape', key: 'Escape' }))).toBe(true);
  });

  it('is not the steering keys, a held key, or a browser chord', () => {
    expect(isPauseKey(press({ code: 'ArrowLeft', key: 'ArrowLeft' }))).toBe(false);
    expect(isPauseKey(press({ code: 'KeyA', key: 'a' }))).toBe(false);
    expect(isPauseKey(press({ code: 'KeyP', key: 'p', repeat: true }))).toBe(false);
    expect(isPauseKey(press({ code: 'KeyP', key: 'p', metaKey: true }))).toBe(false);
    expect(isPauseKey(press({ code: 'KeyP', key: 'p', ctrlKey: true }))).toBe(false);
    expect(isPauseKey(press({ code: 'Escape', key: 'Escape', altKey: true }))).toBe(false);
  });
});
