/**
 * `?perf`, the scripted performance run (Milestone 9, plan section D).
 *
 * The flag is parsed rather than scripted: one parameter has to decide the
 * level, the bot and the debug panel, and every one of those three can still be
 * overridden beside it. That is the contract this pins — the sequencing itself
 * is `../perf.ts` and it drives a browser, not a unit test.
 *
 * `parseQuery` reads the save for the unlocked level, so the tests that care
 * about it stub `localStorage` the way `./save.test.ts` does.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { levelCount } from '@/data';

import { PERF_LEVEL, parseQuery } from '../query';
import { SAVE_KEY, saveSave, loadSave } from '../save';

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

/** A save that has been up the road as far as `unlockedLevel`. */
function savedAt(unlockedLevel: number): void {
  const storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  saveSave({ ...loadSave(), unlockedLevel });
  expect(storage.getItem(SAVE_KEY)).not.toBeNull();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('?perf', () => {
  it('is off unless it is asked for, and `=0` turns it off again', () => {
    expect(parseQuery('', levelCount).perf).toBe(false);
    expect(parseQuery('?debug', levelCount).perf).toBe(false);
    expect(parseQuery('?perf=0', levelCount).perf).toBe(false);
    expect(parseQuery('?perf=false', levelCount).perf).toBe(false);
    expect(parseQuery('?perf', levelCount).perf).toBe(true);
    expect(parseQuery('?perf=1', levelCount).perf).toBe(true);
    expect(parseQuery('?perf=true', levelCount).perf).toBe(true);
  });

  it('brings the bot and the debug panel with it', () => {
    const options = parseQuery('?perf', levelCount);

    // Nobody is holding the phone, so the run needs a driver; and the report is
    // shown in the panel at the end, so the panel has to be up.
    expect(options.bot).toBe('greedy');
    expect(options.debug).toBe(true);
    // Everything else is left exactly as an ordinary boot.
    expect(options.turbo).toBe(1);
    expect(options.endless).toBe(false);
    expect(options.qualityRung).toBeNull();
  });

  it('runs level 20 once the save has got there', () => {
    savedAt(PERF_LEVEL + 4);
    expect(parseQuery('?perf', levelCount).level).toBe(PERF_LEVEL);
  });

  it('runs the highest level reached when that is lower than 20', () => {
    savedAt(6);
    expect(parseQuery('?perf', levelCount).level).toBe(6);
    // Without `?perf` the same save boots the picker at the same level, which
    // is what says the flag only ever *caps* it.
    expect(parseQuery('', levelCount).level).toBe(6);
  });

  it('never picks a level the campaign does not have', () => {
    savedAt(PERF_LEVEL);
    expect(parseQuery('?perf', 8).level).toBe(8);
  });

  it('lets an explicit level and bot win, so `?perf&level=8` certifies level 8', () => {
    savedAt(PERF_LEVEL + 4);
    const options = parseQuery('?perf&level=8&bot=human', levelCount);

    expect(options.level).toBe(8);
    expect(options.bot).toBe('human');
    expect(options.perf).toBe(true);
  });
});
