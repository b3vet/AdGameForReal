/**
 * Phase 1, wave two: the two sizing models the tuners fit against.
 *
 * Rivers: a portal's bodies leave one place and walk bunched, so a splash
 * takes several at a time and a river of a given pressure used to be far
 * easier than the moving spawner's. The lane's fire is now scaled by how
 * bunched the river walks, so a pressure of one is the river a column just
 * clears at any squad size.
 *
 * The curve: a plus is shot up on the way in, so the curve reads it as it is
 * expected to stand at the crossing rather than at its printed value.
 */

import { describe, expect, it } from 'vitest';

import { beat, scripted, testLibrary } from './beatFixtures';
import { prizeFactor, shotSeconds, shotUp, solveCurve, walkCurve } from '../beats/beatCurve';
import type { CurveBeat } from '../beats/beatCurve';
import { bunchFactor, capBodies, riverDensity, riverFor, sizeRiver } from '../beats/beatSize';
import { composeLevel, drawValues, levelCurve, resolveScript, valueStream } from '../beats/compose';
import { resolveTier } from '../beats/library';
import type { ResolvedTier } from '../beats/library';
import { gateCap } from '../gates';
import { portalWindow } from '../pressure';
import { balance } from '@/data';
import type { BeatLibrary, BeatRiver, RiverBunch } from '@/data/types';

const BUNCH: RiverBunch = { gain: 0.86, power: 0.8 };

describe('river bunching', () => {
  it('is one for bodies that walk alone and grows as a power of bodies per metre', () => {
    expect(bunchFactor(5, undefined)).toBe(1);
    expect(bunchFactor(0, BUNCH)).toBe(1);
    expect(bunchFactor(0.5, BUNCH)).toBe(1);
    expect(bunchFactor(4, BUNCH)).toBeCloseTo(0.86 * Math.pow(4, 0.8), 9);
    let last = 0;
    for (const rho of [1, 2, 4, 8, 16]) {
      const factor = bunchFactor(rho, BUNCH);
      expect(factor).toBeGreaterThanOrEqual(last);
      last = factor;
    }
  });

  const river: BeatRiver = { lanes: ['prize'], at: 8, tail: 1, seconds: 5, pressure: 1, density: 0.4 };

  it('carries its bunching in its hit points, so pressure one is what the lane clears', () => {
    for (const e of [30, 100, 300]) {
      const alone = riverFor(river, 0, 200, e, 2, true, balance);
      const bunched = riverFor(river, 0, 200, e, 2, true, balance, BUNCH);
      expect(bunched.count).toBe(alone.count);
      expect(riverDensity(bunched)).toBeCloseTo(alone.count / (alone.durationSeconds * alone.speed), 9);
      const factor = bunchFactor(riverDensity(bunched), BUNCH);
      expect((bunched.count * bunched.hpPerEnemy) / (alone.count * alone.hpPerEnemy)).toBeCloseTo(factor, 6);
    }
    // A bigger squad pours a denser river, which its splash clears faster per body.
    const small = riverFor(river, 0, 200, 30, 2, true, balance, BUNCH);
    const big = riverFor(river, 0, 200, 300, 2, true, balance, BUNCH);
    expect(bunchFactor(riverDensity(big), BUNCH)).toBeGreaterThan(bunchFactor(riverDensity(small), BUNCH));
  });

  it('keeps the pressure when the body ceiling thins a river: fewer bodies bunch less', () => {
    const heavy = { ...river, density: 1 };
    const sized = [
      sizeRiver(heavy, -1, 200, 300, 2, true, BUNCH),
      sizeRiver(heavy, 1, 200, 300, 2, true, BUNCH),
    ];
    capBodies(sized);
    for (const entry of sized) {
      const def = entry.def;
      expect(def.count).toBeLessThanOrEqual(balance.enemies.portal.maxBodiesPerBeat / 2);
      expect(def.count * def.hpPerEnemy).toBeCloseTo(entry.budget * bunchFactor(riverDensity(def), BUNCH), 6);
    }
  });

  it('is read from the library by biome, and a library without it sizes as before', () => {
    const script = [beat('open'), beat('toll', 2), beat('prep')];
    const config = scripted(8, script);
    const withBunch: BeatLibrary = {
      ...testLibrary,
      dps: { ...testLibrary.dps, bunch: { meadow: BUNCH, frost: { gain: 0, power: 1 } } },
    };
    const plain = composeLevel(8, config, config.seed, undefined, testLibrary);
    const bunched = composeLevel(8, config, config.seed, undefined, withBunch);
    const stream = (level: typeof plain): { count: number; hpPerEnemy: number; durationSeconds: number; speed: number } => {
      const found = level.rows.flatMap((row) => row.streams ?? [])[0];
      if (found === undefined) throw new Error('the toll pours');
      return found;
    };
    const a = stream(plain);
    const b = stream(bunched);
    expect(b.count).toBe(a.count);
    const rho = a.count / (a.durationSeconds * a.speed);
    expect(b.hpPerEnemy / a.hpPerEnemy).toBeCloseTo(bunchFactor(rho, BUNCH), 6);
  });
});

describe('the curve reads a plus as it will stand', () => {
  it('shoots a plus up at the road\'s rate for the squad, to its cap', () => {
    const rates = balance.gates.growthPerSecond;
    expect(shotUp(40, 100, 0)).toBe(40);
    expect(shotUp(40, 100, 2)).toBeCloseTo(40 + (rates.add + rates.shares.add * 100) * 2, 9);
    expect(shotUp(40, 100, 60)).toBe(gateCap('add', 40, balance));
  });

  const plus: CurveBeat = { prize: { kind: 'add', size: 'big' }, prizeU: 0, expectLoss: 0, shotSeconds: 3 };

  it('multiplies by the shot-up plus, and leaves a multiplier as printed', () => {
    const printed = 0.5 * 100;
    expect(prizeFactor(plus, 1, testLibrary, 100)).toBeCloseTo(1 + shotUp(printed, 100, 3) / 100, 9);
    expect(prizeFactor({ ...plus, shotSeconds: 0 }, 1, testLibrary, 100)).toBeCloseTo(1.5, 9);
    expect(prizeFactor({ ...plus, prize: { kind: 'mul', value: 2 } }, 1, testLibrary, 100)).toBe(2);
    // Asked without a squad, it reads the printed share.
    expect(prizeFactor(plus, 1, testLibrary)).toBeCloseTo(1.5, 9);
  });

  it('needs smaller panels to land the same target once the shoot-up is counted', () => {
    const flat = [plus, plus, plus].map((b) => ({ ...b, shotSeconds: 0 }));
    const shot = [plus, plus, plus];
    const a = solveCurve(20, flat, 120, testLibrary);
    const b = solveCurve(20, shot, 120, testLibrary);
    expect(a.expected[2]).toBeCloseTo(120, 3);
    expect(b.expected[2]).toBeCloseTo(120, 3);
    expect(b.scale).toBeLessThan(a.scale);
    // At one scale the shot-up curve runs higher at every beat after the first.
    const e = walkCurve(20, shot, a.scale, testLibrary);
    expect(e[2] ?? 0).toBeGreaterThan(a.expected[2] ?? 0);
  });

  const tier = (id: string, key: number): ResolvedTier => {
    const def = testLibrary.defs.find((d) => d.id === id);
    if (def === undefined) throw new Error(id);
    return resolveTier(def, key);
  };

  it('gives the prize panel the approach less what its lane\'s threats take', () => {
    const approach = balance.gates.curve.panelSeconds;
    expect(shotSeconds(tier('open', 1))).toBe(approach);
    // The fixture's guard takes two seconds of fire first.
    expect(shotSeconds(tier('guard', 1))).toBeCloseTo(approach - 2, 9);
    // A multiplier cannot be shot up.
    const guard = tier('guard', 1);
    expect(shotSeconds({ ...guard, gates: { ...guard.gates, prize: { kind: 'mul', value: 2 } } })).toBe(0);
    // A river takes its pressure times its window, less half for its toll bodies.
    const toll = tier('toll', 2);
    const river = toll.rivers[0];
    if (river === undefined) throw new Error('the toll pours');
    const shape = portalWindow(
      { at: river.at, open: river.open ?? 0, seconds: river.seconds, screened: true, speed: balance.streams.speed },
      balance,
    );
    expect(shotSeconds(toll)).toBeCloseTo(Math.max(0, approach - river.pressure * shape.window * (1 - shape.tollShare / 2)), 9);
    // Never below nothing.
    expect(shotSeconds({ ...guard, enemies: guard.enemies.map((e) => ({ ...e, killSeconds: 60 })) })).toBe(0);
  });

  it('still peaks a composed level on its target (document 32)', () => {
    const config = scripted(8, [beat('open'), beat('guard'), beat('toll', 2), beat('prep')], {
      startCount: 12,
      peakTarget: 200,
    });
    const marks = composeLevel(8, config, config.seed, undefined, testLibrary).beats ?? [];
    const resolved = resolveScript(8, config.script ?? [], config.curses, testLibrary);
    const values = valueStream(config.seed);
    const draws = resolved.map(() => drawValues(values));
    const curve = levelCurve(config, resolved.map((b) => b.tier), draws.map((d) => d[0]), testLibrary);
    expect(curve.peak).toBeCloseTo(200, 3);
    expect(marks[marks.length - 1]?.expected).toBeCloseTo(curve.expected[curve.expected.length - 1] ?? 0, 9);
  });
});
