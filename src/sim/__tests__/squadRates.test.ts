import { describe, expect, it } from 'vitest';

import { level, play, row, runOf } from './fixtures';
import { applyCurseCreep, applyGateGrowth, gateCap, growthRates } from '../gates';
import type { GateState } from '../types';
import { balance } from '@/data';

function gate(kind: GateState['kind'], value: number): GateState {
  return { id: 0, rowIndex: 0, lane: 0, z: 50, kind, value, hits: 0, passed: false, cap: 1000 };
}

const rates = balance.gates.growthPerSecond;

describe('gate rates with a share of the squad', () => {
  it('leaves the flat rate alone when there is no squad term', () => {
    const flat = gate('add', 10);
    applyGateGrowth(flat, 60, 60, balance);
    expect(flat.value).toBeCloseTo(10 + rates.add, 9);
    const same = gate('add', 10);
    applyGateGrowth(same, 60, 60, balance, 0);
    expect(same.value).toBe(flat.value);
  });

  it('adds the squad\'s share to a plus and to a curse', () => {
    const plus = gate('add', 10);
    applyGateGrowth(plus, 60, 60, balance, 200);
    expect(plus.value).toBeCloseTo(10 + rates.add + rates.shares.add * 200, 9);

    const curse = gate('sub', 30);
    applyGateGrowth(curse, 60, 60, balance, 200);
    expect(curse.value).toBeCloseTo(30 - (rates.sub + rates.shares.sub * 200), 9);
    expect(growthRates(balance, 200)).toEqual({
      add: rates.add + rates.shares.add * 200,
      sub: rates.sub + rates.shares.sub * 200,
    });
  });

  it('carries the spare shoot-down over the flip at the two squad rates', () => {
    const curse = gate('sub', 1);
    curse.cap = 1000;
    const squad = 100;
    const sub = rates.sub + rates.shares.sub * squad;
    const add = rates.add + rates.shares.add * squad;
    applyGateGrowth(curse, 60, 60, balance, squad);
    expect(curse.kind).toBe('add');
    expect(curse.value).toBeCloseTo(((sub - 1) * add) / sub, 9);
  });

  it('creeps a curse faster for a bigger squad only when asked', () => {
    const flat = gate('sub', 10);
    applyCurseCreep(flat, 1, balance);
    expect(flat.value).toBeCloseTo(10 + balance.gates.creep.perSecond, 9);
    const scaled = gate('sub', 10);
    applyCurseCreep(scaled, 1, balance, 300);
    expect(scaled.value).toBeCloseTo(10 + balance.gates.creep.perSecond + balance.gates.creep.share * 300, 9);
  });
});

describe('a road with squad rates', () => {
  // A curse of seven percent of a 150 squad, which the column stands in from
  // well outside range: the flat rate cannot flip it, the squad's share can.
  const value = 11;
  const curse = { kind: 'sub' as const, value, cap: gateCap('sub', value, balance) };
  const road = (squadRates: boolean): ReturnType<typeof runOf> =>
    runOf(
      level({
        index: 10,
        startCount: 150,
        rows: [row(60, [null, curse, null])],
        ...(squadRates ? { squadRates: true } : {}),
      }),
    );

  it('flips a flip-sized curse for the column that stands in it', () => {
    const scaled = road(true);
    const flat = road(false);
    // Past the row at 60 m, which the column reaches at 12 s.
    play(scaled, 13, 0);
    play(flat, 13, 0);
    expect(scaled.state.squad.count).toBeGreaterThan(150);
    expect(flat.state.squad.count).toBeLessThan(150);
  });
});
