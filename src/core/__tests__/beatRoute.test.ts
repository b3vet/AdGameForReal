/**
 * `?beat=<id>:<tier>`, the one-beat dev route (document 31, 4.1).
 *
 * Two halves: the URL is parsed for shape (`parseBeat`), and the library is
 * asked whether it can build what the URL names (`beatRoad`). Every way the
 * second half can fail is a URL typed by hand, so each one is a console
 * warning and no road, never a throw.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { beats } from '@/data';
import { emptyPlayer } from '@/sim';

import { BEAT_SEED, beatRoad } from '../devScenes';
import { BEAT_COUNT, parseBeat } from '../query';

afterEach(() => {
  vi.restoreAllMocks();
});

/** The tiers a beat defines, highest last. */
function tiers(id: string): number[] {
  const def = beats.defs.find((candidate) => candidate.id === id);
  return Object.keys(def?.tiers ?? {})
    .map(Number)
    .sort((a, b) => a - b);
}

describe('parseBeat', () => {
  it('reads an id and a tier, with the default squad', () => {
    expect(parseBeat('ambush:3')).toEqual({
      id: 'ambush',
      tier: 3,
      count: BEAT_COUNT,
      prize: null,
    });
  });

  it('takes tier 1 when none is named or it is not a number', () => {
    expect(parseBeat('guard')?.tier).toBe(1);
    expect(parseBeat('guard:x')?.tier).toBe(1);
    expect(parseBeat('guard:0')?.tier).toBe(1);
  });

  it('reads the squad and the prize beside it', () => {
    expect(parseBeat('guard:2', '240', 'x2')).toEqual({
      id: 'guard',
      tier: 2,
      count: 240,
      prize: 'x2',
    });
    expect(parseBeat('guard:2', '-5', 'x9')).toMatchObject({ count: BEAT_COUNT, prize: null });
  });

  it('is no pin without an id', () => {
    expect(parseBeat(null)).toBeNull();
    expect(parseBeat(':3')).toBeNull();
    expect(parseBeat('')).toBeNull();
  });
});

describe('beatRoad', () => {
  it('builds an endless-style road with no boss, sized for the pinned squad', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pin = { id: 'ambush', tier: 3, count: 120, prize: null };
    const road = beatRoad(pin, null, null, emptyPlayer());
    expect(road).not.toBeNull();
    expect(road?.endless).toBe(true);
    expect(road?.arenas ?? []).toHaveLength(0);
    expect(road?.startCount).toBe(120);
    expect(road?.seed).toBe(BEAT_SEED);
    expect(road?.beats?.[0]?.beat).toBe('ambush');
    expect(warn).not.toHaveBeenCalled();
  });

  it('lays the same road for the same pin and seed', () => {
    const pin = { id: 'toll', tier: 3, count: 100, prize: null } as const;
    const a = beatRoad(pin, 7, null, emptyPlayer());
    const b = beatRoad(pin, 7, null, emptyPlayer());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('warns and builds nothing for a beat the library does not have', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pin = { id: 'nope', tier: 1, count: 100, prize: null };
    const road = beatRoad(pin, null, null, emptyPlayer());
    expect(road).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/no such beat.*ambush/);
  });

  it('warns and plays the nearest tier below one the beat does not have', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const top = tiers('ambush').at(-1) ?? 1;
    const pin = { id: 'ambush', tier: top + 4, count: 100, prize: null };
    const road = beatRoad(pin, null, null, emptyPlayer());
    expect(road?.beats?.[0]?.tier).toBe(top);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toMatch(new RegExp(`playing tier ${String(top)}`));
  });

  it('sets a Frostfell beat on Frostfell unless the URL pins a biome', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pin = { id: 'chargeFork', tier: 1, count: 100, prize: null } as const;
    expect(beatRoad(pin, null, null, emptyPlayer())?.biome).toBe('frost');
    expect(beatRoad(pin, null, 'meadow', emptyPlayer())?.biome).toBe('meadow');
    const guard = { id: 'guard', tier: 1, count: 100, prize: null } as const;
    expect(beatRoad(guard, null, null, emptyPlayer())?.biome).toBe('meadow');
  });
});
