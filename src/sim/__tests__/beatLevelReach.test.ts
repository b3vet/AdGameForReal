/**
 * The beat lab's road starts the column outside the fire range of every block
 * the beat stands (Phase 1 wave two, TUNE-SHARED). A guard on its hold line
 * wakes only on contact, so a road laid by its wake alone started the column
 * 35 m from it: one metre outside range and already inside greedy's read
 * distance, and the lab measured a fight that was under way before the bots
 * had read the row.
 */

import { describe, expect, it } from 'vitest';

import { buildBeatLevel } from '../beats/beatLevel';
import { resolveTier } from '../beats/library';
import { testLibrary } from './beatFixtures';
import { balance } from '@/data';
import type { BeatDef, BeatLibrary } from '@/data/types';

/** The fixture library with its guard on a hold line, as the shipped guard stands. */
function holdingLibrary(): BeatLibrary {
  const defs: BeatDef[] = testLibrary.defs.map((def) => {
    if (def.id !== 'guard') return def;
    const line = -balance.enemies.beat.holdGap;
    return {
      ...def,
      tiers: {
        ...def.tiers,
        '1': {
          ...def.tiers['1'],
          enemies: [{ kind: 'brute', lane: 'prize', at: line, wake: balance.enemies.contactDistance, killSeconds: 7, hold: true }],
        },
      },
    };
  });
  return { ...testLibrary, defs };
}

describe('the beat lab road', () => {
  it('starts the column out of range of every block, asleep or not', () => {
    for (const [id, tier] of [
      ['guard', 1],
      ['ambush', 1],
      ['chargeFork', 1],
      ['prep', 1],
    ] as const) {
      const library = holdingLibrary();
      const level = buildBeatLevel(id, tier, 80, 3, 'meadow', { library });
      const gateZ = level.beats?.[0]?.z ?? 0;
      const def = library.defs.find((d) => d.id === id);
      if (def === undefined) throw new Error(id);
      for (const enemy of resolveTier(def, tier).enemies) {
        const from = gateZ + enemy.at - balance.projectiles.range;
        expect(from, id).toBeGreaterThanOrEqual(balance.level.rowSpacing);
      }
    }
  });

  it('lets greedy read the row before anything is in range', () => {
    const level = buildBeatLevel('guard', 1, 80, 3, 'meadow', { library: holdingLibrary() });
    expect(level.beats?.[0]?.z ?? 0).toBeGreaterThan(balance.bots.readDistance);
  });
});
