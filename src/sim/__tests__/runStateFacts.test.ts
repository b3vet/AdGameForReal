/**
 * What the sim puts on the run's state for a player (and a bot) to read
 * before a river pours (Phase 1, wave two): each river's hit points per body,
 * pour length and portal opening, and whether the road grows its panels by a
 * share of the squad. Until now the balance harness wrote them on in the
 * tests only, so a bot in the app priced a road it could not see.
 */

import { describe, expect, it } from 'vitest';

import type { LevelDef } from '../level';
import { Run } from '../Run';
import type { StreamDef } from '../types';
import { balance } from '@/data';

function road(streams: StreamDef[], squadRates: boolean): LevelDef {
  return {
    index: 12,
    seed: 3,
    runSpeed: balance.squad.runSpeed,
    startCount: 20,
    rows: [{ z: 60, gates: [null, null, null], enemies: [], streams }],
    arenaZ: 90,
    biome: 'meadow',
    walls: [],
    endless: true,
    boss: { hp: 0, units: 0 },
    ...(squadRates ? { squadRates: true } : {}),
  };
}

const spawner: StreamDef = {
  lane: -1,
  kind: 'grunt',
  count: 12,
  durationSeconds: 7,
  hpPerEnemy: 4.5,
  speed: 3,
  jitter: 0.75,
};
const portal: StreamDef = { ...spawner, lane: 1, count: 20, durationSeconds: 4, hpPerEnemy: 9, anchorZ: 70, openAt: 38 };

describe('the run state a player reads', () => {
  it('carries every river\'s body, pour and opening from the moment the run starts', () => {
    const run = new Run(road([spawner, portal], true), balance);
    const [moving, poured] = run.state.streams;
    expect(moving?.hpPerEnemy).toBe(4.5);
    expect(moving?.durationSeconds).toBe(7);
    expect(moving !== undefined && 'openAt' in moving).toBe(false);
    expect(poured?.hpPerEnemy).toBe(9);
    expect(poured?.durationSeconds).toBe(4);
    expect(poured?.openAt).toBe(38);
    expect(poured?.anchorZ).toBe(70);
    expect(poured?.started).toBe(false);
  });

  it('says a road grows its panels by the squad only when it does', () => {
    expect(new Run(road([], true), balance).state.squadRates).toBe(true);
    const dealt = new Run(road([], false), balance).state;
    expect('squadRates' in dealt).toBe(false);
  });
});
