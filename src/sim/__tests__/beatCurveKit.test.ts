/**
 * The level curve sized for the kit a level expects (document 31, 3.4; D49).
 *
 * Frostfell is tuned for the armed hand, but the curve used to read every plus
 * at its bare print while the armed column walked through it with its
 * gate-bonus rungs on: the human arrived 9 to 23 percent over E at every beat
 * before the prep. A level now names the rungs its curve expects (`kit`), and
 * the curve starts from that kit's start count and reads each prize as that
 * kit prints it. A level that names none is sized exactly as before.
 */

import { describe, expect, it } from 'vitest';

import { beat, scripted, testLibrary } from './beatFixtures';
import { playerHolding } from './fixtures';
import { middleBeat, prizeFactor, shotSeconds, shotUp } from '../beats/beatCurve';
import type { CurveBeat } from '../beats/beatCurve';
import { composeLevel, curveBeats, expectedMods, levelCurve } from '../beats/compose';
import { findBeat, resolveTier } from '../beats/library';
import type { LevelDef } from '../level';
import { playerMods } from '../player';
import { balance } from '@/data';
import type { ExpectedKit, LevelGenConfig, PlayerState } from '@/data/types';

const KIT: ExpectedKit = { gateBonus: 3, startCount: 1 };

const armed = (kit: ExpectedKit): PlayerState =>
  playerHolding({ upgrades: { gateBonus: kit.gateBonus ?? 0, startCount: kit.startCount ?? 0 } });

describe('the kit a level expects', () => {
  it('is worth what the run makes of the same rungs', () => {
    expect(expectedMods(undefined)).toEqual({ startCount: 0, gateBonus: 1 });
    expect(expectedMods({})).toEqual({ startCount: 0, gateBonus: 1 });
    for (const kit of [KIT, { gateBonus: 2 }, { startCount: 4 }, { gateBonus: 99, startCount: -3 }]) {
      const mods = playerMods(armed(kit));
      expect(expectedMods(kit)).toEqual({ startCount: mods.startCount, gateBonus: mods.gateBonus });
    }
  });

  it('prints the prize bigger by the bonus, and leaves a multiplier alone', () => {
    const plus: CurveBeat = { prize: { kind: 'add', size: 'big' }, prizeU: 0, expectLoss: 0, shotSeconds: 3 };
    const bonus = expectedMods(KIT).gateBonus;
    expect(bonus).toBeGreaterThan(1);
    expect(prizeFactor({ ...plus, bonus }, 1, testLibrary)).toBeCloseTo(1 + 0.5 * bonus, 9);
    expect(prizeFactor({ ...plus, bonus }, 1, testLibrary, 100)).toBeCloseTo(
      1 + shotUp(0.5 * 100 * bonus, 100, 3) / 100,
      9,
    );
    expect(prizeFactor({ ...plus, bonus: 1 }, 1, testLibrary, 100)).toBe(prizeFactor(plus, 1, testLibrary, 100));
    const mul: CurveBeat = { ...plus, prize: { kind: 'mul', value: 2 }, bonus };
    expect(prizeFactor(mul, 1, testLibrary, 100)).toBe(2);
  });

  const script = [beat('open'), beat('guard'), beat('toll', 2), beat('rest'), beat('ambush'), beat('prep')];
  const tiers = script.map((line) => resolveTier(findBeat(testLibrary, line.beat), line.tier));
  const draws = script.map((_, k) => k / script.length);
  // Small enough a start, and far enough a peak, that both curves need their early panels scaled up.
  const bare = scripted(30, script, { startCount: 20, peakTarget: 400, biome: 'frost' });

  it('leaves a level that names no kit on the curve it had', () => {
    const plain = levelCurve(bare, tiers, draws, testLibrary);
    expect(levelCurve({ ...bare, kit: {} }, tiers, draws, testLibrary)).toEqual(plain);
    expect(levelCurve({ ...bare, kit: { gateBonus: 0, startCount: 0 } }, tiers, draws, testLibrary)).toEqual(plain);
    // A bonus of one is the bare print, to the bit.
    const beats = curveBeats(tiers, draws);
    expect(curveBeats(tiers, draws, 1)).toEqual(beats);
    for (const [k, curveBeat] of beats.entries()) {
      const { bonus: _bonus, ...unbonused } = curveBeat;
      expect(prizeFactor(curveBeat, 0.8, testLibrary, 50 + k)).toBe(prizeFactor(unbonused, 0.8, testLibrary, 50 + k));
    }
  });

  it('starts from the kit\'s count and needs no bigger panels to grow the same squad', () => {
    const plain = levelCurve(bare, tiers, draws, testLibrary);
    const kitted = levelCurve({ ...bare, kit: KIT }, tiers, draws, testLibrary);
    expect(kitted.expected[0]).toBe(bare.startCount + expectedMods(KIT).startCount);
    expect(kitted.target).toBe(plain.target);
    // Both grow the same squad by the middle beat (document 32), the kitted one on smaller panels.
    const mid = middleBeat(script.length);
    const half = balance.gates.curve.midShare * plain.target;
    expect(Math.abs((plain.expected[mid] ?? 0) - half) / half).toBeLessThan(0.01);
    expect(Math.abs((kitted.expected[mid] ?? 0) - half) / half).toBeLessThan(0.01);
    kitted.scales.forEach((scale, k) => expect(scale).toBeLessThanOrEqual(plain.scales[k] ?? 0));
    expect(Math.min(...kitted.scales.map((scale, k) => scale - (plain.scales[k] ?? 0)))).toBeLessThan(0);
  });
});

/**
 * The next beat's E as the armed column makes it: the count the curve expected
 * here, plus the prize panel the level actually printed for this player, shot
 * up for the seconds the curve allows. Open beats only: they lose nothing.
 */
function armedSteps(level: LevelDef): number[] {
  const marks = level.beats ?? [];
  const seconds = shotSeconds(resolveTier(findBeat(testLibrary, 'open'), 1), balance);
  const out: number[] = [];
  for (let k = 0; k + 1 < marks.length; k++) {
    const mark = marks[k];
    const next = marks[k + 1];
    if (mark === undefined || next === undefined) continue;
    const row = level.rows.find((r) => r.z === mark.z);
    const gate = row?.gates[mark.prize + 1];
    if (gate?.kind !== 'add') throw new Error(`beat ${String(k)} has no plus in its prize lane`);
    out.push((mark.expected + shotUp(gate.value, mark.expected, seconds, balance)) / next.expected);
  }
  return out;
}

describe('the armed column on a kitted curve', () => {
  const opens = [beat('open'), beat('open'), beat('open'), beat('open'), beat('open')];
  const config = (kit?: ExpectedKit): LevelGenConfig =>
    scripted(30, opens, { startCount: 60, peakTarget: 450, biome: 'frost', ...(kit === undefined ? {} : { kit }) });
  const compose = (kit?: ExpectedKit): LevelDef =>
    composeLevel(30, config(kit), 3_030, armed(KIT), testLibrary, []);

  it('arrives at every beat with the E it was sized for, to the print step', () => {
    const level = compose(KIT);
    expect(level.startCount).toBe(level.beats?.[0]?.expected);
    const steps = armedSteps(level);
    expect(steps.length).toBe(opens.length - 1);
    for (const step of steps) expect(Math.abs(step - 1)).toBeLessThan(0.04);
  });

  it('ran ahead of E when the curve read the bare print', () => {
    const steps = armedSteps(compose());
    expect(Math.max(...steps)).toBeGreaterThan(1.08);
    expect(compose().startCount).toBeGreaterThan(compose().beats?.[0]?.expected ?? Infinity);
  });
});
