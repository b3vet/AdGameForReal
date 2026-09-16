import { describe, expect, it } from 'vitest';

import { beat, ORDINARY, scripted, testLibrary } from './beatFixtures';
import { buildBeatLevel } from '../beats/beatLevel';
import { composeLevel } from '../beats/compose';
import { resolveTier } from '../beats/library';
import { Run } from '../Run';
import type { SimEvent } from '../types';
import { balance, beats, levelCount } from '@/data';

const lab = { library: testLibrary };

function playOut(run: Run, targetX: number, seconds = 120): SimEvent[] {
  const events: SimEvent[] = [];
  for (let step = 0; step < seconds * 60 && run.state.status === 'running'; step++) {
    run.setTargetX(targetX);
    for (const event of run.tick(1 / 60)) events.push({ ...event });
  }
  return events;
}

describe('one beat on a boss-less road', () => {
  it('builds the beat alone, sized for the squad it is played with', () => {
    const level = buildBeatLevel('guard', 1, 120, 7, 'meadow', lab);
    expect(level.endless).toBe(true);
    expect(level.arenas).toBeUndefined();
    expect(level.startCount).toBe(120);
    expect(level.index).toBe(levelCount);
    expect(level.rows).toHaveLength(2);
    expect(level.beats).toHaveLength(1);
    expect(level.beats?.[0]?.expected).toBe(120);
    expect(level.squadRates).toBe(true);
    const gateZ = level.beats?.[0]?.z ?? 0;
    expect(level.rows[1]?.z).toBe(gateZ);
    // A big plus for 120 prints 60 on the fixture's values.
    expect(level.rows[1]?.gates[(level.beats?.[0]?.prize ?? 0) + 1]?.value).toBe(60);
  });

  it('starts the column outside every wake, portal and fence', () => {
    for (const [id, tier] of [
      ['guard', 1],
      ['ambush', 1],
      ['toll', 2],
      ['fence', 1],
      ['chargeFork', 1],
      ['prep', 1],
    ] as const) {
      const level = buildBeatLevel(id, tier, 80, 3, 'meadow', lab);
      const gateZ = level.beats?.[0]?.z ?? 0;
      const def = testLibrary.defs.find((d) => d.id === id);
      if (def === undefined) throw new Error(id);
      const resolved = resolveTier(def, tier);
      for (const enemy of resolved.enemies) {
        expect(gateZ + enemy.at - enemy.wake, id).toBeGreaterThanOrEqual(balance.level.rowSpacing);
      }
      for (const river of resolved.rivers) {
        expect(gateZ + river.at - river.open, id).toBeGreaterThanOrEqual(balance.level.rowSpacing);
      }
      for (const wall of level.walls ?? []) expect(wall.zStart, id).toBeGreaterThan(balance.level.rowSpacing);
      expect(level.arenaZ).toBeGreaterThan(gateZ + Math.max(0, ...resolved.enemies.map((e) => e.at)));
    }
  });

  it('plays to a win with no boss when the column survives it', () => {
    const level = buildBeatLevel('toll', 2, 150, 5, 'meadow', lab);
    const run = new Run(level, balance);
    expect(run.state.boss).toBeNull();
    const events = playOut(run, 0);
    expect(run.state.status).toBe('won');
    expect(run.state.squad.z).toBe(level.arenaZ);
    expect(events.some((e) => e.type === 'streamStarted')).toBe(true);
    expect(events.some((e) => e.type === 'bossActivated')).toBe(false);
  });

  it('writes the prize override in and throws on a beat or tier the library lacks', () => {
    const level = buildBeatLevel('guard', 1, 100, 1, 'meadow', { ...lab, prize: 'x2' });
    const prize = level.beats?.[0]?.prize ?? 0;
    expect(level.rows[1]?.gates[prize + 1]).toEqual({ kind: 'mul', value: 2, cap: 2 });
    expect(() => buildBeatLevel('nope', 1, 100, 1, 'meadow', lab)).toThrow(/"nope"/);
    expect(() => buildBeatLevel('guard', 5, 100, 1, 'meadow', lab)).toThrow(/no tier 5/);
  });

  it('sizes from the biome\'s measured fire', () => {
    const meadow = buildBeatLevel('guard', 1, 100, 1, 'meadow', lab);
    const frost = buildBeatLevel('guard', 1, 100, 1, 'frost', lab);
    expect(frost.biome).toBe('frost');
    // The fixture measures a block fire of 1 on the meadow and 2 on Frostfell.
    const perUnit = balance.enemies.beat.bruteHpPerUnit;
    expect(meadow.rows[0]?.enemies[0]?.units).toBe(Math.round((2 * 100 * 1) / perUnit));
    expect(frost.rows[0]?.enemies[0]?.units).toBe(Math.round((2 * 100 * 2) / perUnit));
  });

  it('builds every tier of every shipped beat', () => {
    for (const def of beats.defs) {
      for (const tier of Object.keys(def.tiers)) {
        const level = buildBeatLevel(def.id, Number(tier), 150, 11, 'meadow');
        expect(level.beats?.[0]?.beat).toBe(def.id);
      }
    }
  });
});

describe('determinism', () => {
  function replay(seed: number): { state: string; events: number } {
    const config = scripted(8, ORDINARY, { startCount: 20, peakTarget: 200 });
    const level = composeLevel(8, config, seed, undefined, testLibrary);
    const run = new Run(level, balance);
    // A fixed hand: middle lane, then the right side from the fence on.
    let events = 0;
    for (let step = 0; step < 90 * 60 && run.state.status === 'running'; step++) {
      run.setTargetX(run.state.squad.z > 100 ? 2 : 0);
      events += run.tick(1 / 60).length;
    }
    const { crowd: _crowd, groups, ...rest } = run.state;
    return { state: JSON.stringify({ ...rest, groups }), events };
  }

  it('replays a composed level from the same seed to the same state', () => {
    const first = replay(4);
    expect(replay(4)).toEqual(first);
    expect(replay(5).state).not.toEqual(first.state);
  });

  it('composes the same road for the same script and seed', () => {
    const config = scripted(12, [...ORDINARY, beat('open')]);
    expect(composeLevel(12, config, 99, undefined, testLibrary)).toEqual(
      composeLevel(12, config, 99, undefined, testLibrary),
    );
  });
});
