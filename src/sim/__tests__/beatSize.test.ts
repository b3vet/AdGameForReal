import { describe, expect, it } from 'vitest';

import { beat, ORDINARY, scripted, testLibrary } from './beatFixtures';
import { solveCurve, walkCurve } from '../beats/beatCurve';
import type { CurveBeat } from '../beats/beatCurve';
import { blockFor, capBodies, capLive, gateFor, printRound, riverFor } from '../beats/beatSize';
import { composeLevel } from '../beats/compose';
import { FIRE_RATE_GATE_WORTH, gateCap } from '../gates';
import { portalWindow } from '../pressure';
import { balance } from '@/data';
import type { BeatEnemy, BeatRiver } from '@/data/types';

describe('printed values', () => {
  it('round to a unit, then to fives above 20, then to tens above 100', () => {
    expect(printRound(0.2)).toBe(1);
    expect(printRound(7.4)).toBe(7);
    expect(printRound(20)).toBe(20);
    expect(printRound(23)).toBe(25);
    expect(printRound(31)).toBe(30);
    expect(printRound(100)).toBe(100);
    expect(printRound(131)).toBe(130);
    expect(printRound(146)).toBe(150);
  });
});

describe('gate sizing', () => {
  it('sizes a plus as its share of E times the curve\'s scale', () => {
    const gate = gateFor({ kind: 'add', size: 'big' }, 200, 0, 1.2, testLibrary);
    expect(gate).toEqual({ kind: 'add', value: 120, cap: gateCap('add', 120, balance) });
  });

  it('does not scale a curse, so a flip stays shootable', () => {
    const flip = gateFor({ kind: 'sub', size: 'flip' }, 200, 0, 2.5, testLibrary);
    expect(flip?.value).toBe(printRound(200 * 0.07));
    expect(flip?.cap).toBe(gateCap('sub', flip?.value ?? 0, balance));
  });

  it('prints a multiplier as it is, a fire rate as a mid plus and nothing for none', () => {
    expect(gateFor({ kind: 'mul', value: 3 }, 50, 0, 1, testLibrary)).toEqual({ kind: 'mul', value: 3, cap: 3 });
    const rate = gateFor({ kind: 'fireRate' }, 50, 0, 1, testLibrary);
    expect(rate?.kind).toBe('fireRate');
    expect(rate?.value).toBeCloseTo(0.3 / FIRE_RATE_GATE_WORTH, 2);
    expect(gateFor({ kind: 'none' }, 50, 0, 1, testLibrary)).toBeNull();
  });
});

describe('block sizing', () => {
  const brute: BeatEnemy = { kind: 'brute', lane: 'prize', at: -8, wake: 45, killSeconds: 3 };

  it('prints a brute from the seconds of fire it takes, at the beat\'s hit points per unit', () => {
    const def = blockFor(brute, 1, 10, 100, 1.5, false);
    const perUnit = balance.enemies.beat.bruteHpPerUnit;
    expect(def.units).toBe(Math.round((3 * 100 * 1.5) / perUnit));
    expect(def.hpPerUnit).toBe(perUnit);
    expect(def.wake).toBe(45);
    expect(def.dz).toBe(10);
    expect(def.lane).toBe(1);
    expect(def.maxHalf).toBeUndefined();
  });

  it('takes a shield\'s time out of the body it covers', () => {
    const shielded = blockFor({ ...brute, kind: 'shieldBrute' }, 0, 0, 100, 1.5, false);
    const plain = blockFor(brute, 0, 0, 100, 1.5, false);
    const shield = balance.enemies.shield;
    const bodyShare = 1 / (1 + shield.share / shield.damageMul);
    expect(shielded.units).toBe(Math.round(plain.units * bodyShare));
  });

  it('gives a charger the beat\'s bite and its own hit points per unit', () => {
    const charger = blockFor({ ...brute, kind: 'charger', killSeconds: 1 }, 0, 0, 80, 2, false);
    expect(charger.units).toBe(Math.round(160 / balance.enemies.charger.hpPerUnit));
    expect(charger.hpPerUnit).toBeUndefined();
    expect(charger.killShare).toBe(balance.enemies.beat.chargerKillShare);
  });

  it('holds a screened block to its own lane', () => {
    const screened = blockFor(brute, 0, 5, 100, 1.5, true);
    expect(screened.maxHalf).toBe(balance.road.laneWidth / 2 - balance.projectiles.radius);
  });
});

describe('river sizing', () => {
  const river: BeatRiver = { lanes: ['prize'], at: 8, open: 50, seconds: 5, pressure: 1.2, density: 0.4 };

  it('pours density times E bodies carrying pressure times the fire the window leaves', () => {
    const def = riverFor(river, -1, 300, 150, 0.8, true);
    const shape = portalWindow(
      { at: 8, open: 50, seconds: 5, screened: true, speed: balance.streams.speed },
      balance,
    );
    expect(def.count).toBe(60);
    expect(def.count * def.hpPerEnemy).toBeCloseTo(1.2 * 150 * 0.8 * balance.streams.laneShare * shape.window, 6);
    expect(def.anchorZ).toBe(300);
    expect(def.openAt).toBe(50);
    expect(def.durationSeconds).toBeCloseTo(shape.pour, 9);
    expect(def.lane).toBe(-1);
  });

  it('never pours fewer than the portal\'s floor', () => {
    const def = riverFor(river, 0, 100, 2, 0.8, false);
    expect(def.count).toBe(balance.enemies.portal.minBodies);
  });

  it('holds a beat\'s rivers to the body ceiling and keeps their hit points', () => {
    const big = { ...river, density: 1 };
    const rivers = [riverFor(big, -1, 300, 200, 0.8, false), riverFor(big, 1, 300, 200, 0.8, false)];
    const before = rivers.map((r) => r.count * r.hpPerEnemy);
    capBodies(rivers);
    const most = balance.enemies.portal.maxBodiesPerBeat;
    expect(rivers[0]?.count ?? 0).toBeLessThanOrEqual(most / 2);
    expect((rivers[0]?.count ?? 0) + (rivers[1]?.count ?? 0)).toBeLessThanOrEqual(most);
    rivers.forEach((r, i) => expect(r.count * r.hpPerEnemy).toBeCloseTo(before[i] ?? 0, 6));
  });
});

describe('the road-wide body ceiling', () => {
  const river: BeatRiver = { lanes: ['prize'], at: 0, open: 50, seconds: 5, pressure: 1, density: 1 };
  const most = balance.enemies.portal.maxLiveBodies;

  const shared = Math.floor(120 * (most / 240));

  it('shares the ceiling between overlapping rivers and keeps their hit points', () => {
    const first = riverFor(river, -1, 200, 120, 0.8, false);
    const second = riverFor(river, 1, 230, 120, 0.8, false);
    const apart = riverFor(river, 0, 400, 120, 0.8, false);
    const hp = second.count * second.hpPerEnemy;
    capLive([second, apart, first]);
    expect(first.count).toBe(shared);
    expect(second.count).toBe(shared);
    expect(first.count + second.count).toBeLessThanOrEqual(most);
    expect(second.count * second.hpPerEnemy).toBeCloseTo(hp, 6);
    // Opens 350 m up the road, long after the other two are gone.
    expect(apart.count).toBe(120);
  });

  it('counts a river as live a despawn distance past its portal', () => {
    const first = riverFor(river, -1, 200, 120, 0.8, false);
    const touching = riverFor(river, 1, 200 + 50 + balance.streams.despawnBehind, 120, 0.8, false);
    capLive([first, touching]);
    expect(touching.count).toBe(shared);
    const again = riverFor(river, -1, 200, 120, 0.8, false);
    const clear = riverFor(river, 1, 200 + 51 + balance.streams.despawnBehind, 120, 0.8, false);
    capLive([again, clear]);
    expect(clear.count).toBe(120);
  });

  it('keeps the busiest stretch under the ceiling when three rivers meet', () => {
    const rivers = [150, 170, 190].map((z, i) => riverFor(river, (i - 1) as -1 | 0 | 1, z, 120, 0.8, false));
    capLive(rivers);
    expect(rivers.reduce((sum, r) => sum + r.count, 0)).toBeLessThanOrEqual(most);
  });
});

describe('the level curve with losses', () => {
  const beats: CurveBeat[] = [
    { prize: { kind: 'add', size: 'big' }, prizeU: 0, expectLoss: 0 },
    { prize: { kind: 'mul', value: 2 }, prizeU: 0, expectLoss: 0.1 },
    { prize: { kind: 'add', size: 'mid' }, prizeU: 0, expectLoss: 0.2 },
    { prize: { kind: 'fireRate' }, prizeU: 0, expectLoss: 0 },
  ];

  it('walks E(k + 1) = E(k) g(k) (1 - l(k)) from the start', () => {
    const e = walkCurve(10, beats, 1, testLibrary);
    expect(e[0]).toBe(10);
    expect(e[1]).toBeCloseTo(15, 9);
    expect(e[2]).toBeCloseTo(15 * 2 * 0.9, 9);
    expect(e[3]).toBeCloseTo(27 * 1.3 * 0.8, 9);
  });

  it('never expects more than the squad can hold', () => {
    const e = walkCurve(400, beats, 1, testLibrary);
    for (const value of e) expect(value).toBeLessThanOrEqual(balance.squad.maxCount);
  });

  it('solves the plus panels\' scale so E at the last beat is the target', () => {
    const curve = solveCurve(10, beats, 40, testLibrary);
    expect(curve.expected[3]).toBeCloseTo(40, 4);
    expect(curve.scale).toBeGreaterThan(balance.gates.scale.min);
    expect(curve.scale).toBeLessThan(balance.gates.scale.max);
  });

  it('takes the smallest scale that reaches a target at the cap, and holds to its bounds', () => {
    const cap = balance.squad.maxCount;
    const capped = solveCurve(200, beats, cap, testLibrary);
    expect(capped.expected[3]).toBeCloseTo(cap, 6);
    const lower = walkCurve(200, beats, capped.scale * 0.99, testLibrary);
    expect(lower[3] ?? cap).toBeLessThan(cap);

    expect(solveCurve(10, beats, 1e6, testLibrary).scale).toBe(balance.gates.scale.max);
    expect(solveCurve(10, beats, 1, testLibrary).scale).toBe(balance.gates.scale.min);
  });

  it('sizes a composed level against E with its losses, landing the prep beat on its target', () => {
    const config = scripted(8, ORDINARY, { startCount: 12, peakTarget: 240, curveTrim: 0.9 });
    const level = composeLevel(8, config, config.seed, undefined, testLibrary);
    const marks = level.beats ?? [];
    expect(marks[marks.length - 1]?.expected).toBeCloseTo(240 * 0.9, 4);
    expect(marks[0]?.expected).toBe(12);
    // The guard's block is sized for the squad expected at the guard.
    const guard = marks[1];
    const block = level.rows[2]?.enemies[0];
    expect(block?.units).toBe(Math.round((2 * (guard?.expected ?? 0) * 1) / balance.enemies.beat.bruteHpPerUnit));
    // A later beat is sized for more than an earlier one on a rising curve.
    const first = level.rows[1]?.gates.find((g) => g?.kind === 'add');
    const late = level.rows[9]?.gates.find((g) => g?.kind === 'add');
    expect(late?.value ?? 0).toBeGreaterThan(first?.value ?? 0);
  });

  it('lets a beat with a heavy loss bend the curve down', () => {
    const script = [beat('open'), beat('guard', 2), beat('prep')];
    const heavy = {
      ...testLibrary,
      defs: testLibrary.defs.map((def) =>
        def.id === 'guard' ? { ...def, tiers: { ...def.tiers, '2': { ...def.tiers['2'], expectLoss: 0.6 } } } : def,
      ),
    };
    const config = scripted(8, script, { startCount: 50, peakTarget: 50 });
    const marks = composeLevel(8, config, config.seed, undefined, heavy).beats ?? [];
    // Open at scale s, then a guard that costs 60 percent: 50 at the prep
    // needs the guard's plus to more than make up for its loss.
    expect(marks[2]?.expected).toBeCloseTo(50, 3);
    expect(marks[1]?.expected ?? 0).toBeGreaterThan(50);
  });
});
