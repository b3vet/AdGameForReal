import { describe, expect, it } from 'vitest';

import { applyGateGrowth, clampCount, countAfterGate, gateCap, isShootable } from '../gates';
import type { GateState } from '../types';
import { level, play, row, runOf, testBalance } from './fixtures';

const balance = testBalance();

function gate(kind: GateState['kind'], value: number): GateState {
  return {
    id: 0,
    rowIndex: 0,
    lane: 0,
    z: 10,
    kind,
    value,
    hits: 0,
    passed: false,
    cap: gateCap(kind, value, balance),
  };
}

/** One second of a squad whose whole output lands on this gate. */
function focus(g: GateState, shotRate: number, seconds: number): void {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) applyGateGrowth(g, shotRate / 60, shotRate, balance);
}

describe('gate arithmetic', () => {
  it('applies each kind to the squad count', () => {
    expect(countAfterGate('add', 7, 10)).toBe(17);
    expect(countAfterGate('sub', 7, 10)).toBe(3);
    expect(countAfterGate('mul', 3, 10)).toBe(30);
    expect(countAfterGate('fireRate', 0.2, 10)).toBe(10);
    expect(countAfterGate('weapon', 0, 10)).toBe(10);
  });

  it('floors a multiply rather than handing out half a wizard', () => {
    expect(countAfterGate('mul', 2.5, 7)).toBe(17);
  });

  it('clamps the count to the road and the pool', () => {
    expect(clampCount(-40, balance)).toBe(0);
    expect(clampCount(9_000, balance)).toBe(balance.squad.maxCount);
  });

  it('lets shots through a mul and a staff gate, and into the rest', () => {
    expect(isShootable('mul')).toBe(false);
    expect(isShootable('weapon')).toBe(false);
    expect(isShootable('add')).toBe(true);
    expect(isShootable('sub')).toBe(true);
    expect(isShootable('fireRate')).toBe(true);
  });

  it('caps a gate at its printed value plus the bigger of the floor and the share', () => {
    // Small gates grow by the flat floor, big ones by the share of themselves.
    expect(gateCap('add', 3, balance)).toBe(3 + balance.gates.capFloor.add);
    expect(gateCap('add', 100, balance)).toBe(100 + 60);
    // A curse's cap is what it pays *after* it flips, so the penalty is not in it.
    expect(gateCap('sub', 100, balance)).toBe(60);
    expect(gateCap('fireRate', 0.05, balance)).toBeCloseTo(0.05 + balance.gates.capFloor.fireRate, 9);
    expect(gateCap('fireRate', 0.2, balance)).toBeCloseTo(0.2 * (1 + balance.gates.capShare), 9);
  });
});

describe('shoot to grow', () => {
  it('grows a gate by the rate times its share of the squad\'s fire', () => {
    const g = gate('add', 10);
    // Half the squad's shots land here for one second.
    applyGateGrowth(g, 300, 600, balance);
    expect(g.value).toBeCloseTo(10 + balance.gates.growthPerSecond.add * 0.5, 9);
    expect(g.hits).toBe(300);
  });

  it('cannot be maxed in one step, however big the squad is', () => {
    // 300 units at the base rate fire 10 shots in a step; even all ten landing
    // on one gate is a fiftieth of a second's worth of growth (D19).
    const g = gate('add', 10);
    const shotRate = 300 * balance.squad.fireRate;
    applyGateGrowth(g, shotRate / 60, shotRate, balance);
    expect(g.value).toBeLessThan(10.05);
    expect(g.value).toBeGreaterThan(10);
  });

  it('reaches the cap only with sustained focus', () => {
    const g = gate('add', 10);
    const cap = gateCap('add', 10, balance);
    focus(g, 600, 1);
    expect(g.value).toBeLessThan(cap);
    focus(g, 600, 5);
    expect(g.value).toBe(cap);
  });

  it('grows more slowly when the squad is shooting other things too', () => {
    const focused = gate('add', 10);
    const split = gate('add', 10);
    applyGateGrowth(focused, 600, 600, balance);
    applyGateGrowth(split, 150, 600, balance);
    expect(split.value - 10).toBeCloseTo((focused.value - 10) / 4, 9);
  });

  it('raises a fireRate gate at its own slower rate, up to its own cap', () => {
    const g = gate('fireRate', 0.1);
    applyGateGrowth(g, 600, 600, balance);
    expect(g.value).toBeCloseTo(0.1 + balance.gates.growthPerSecond.fireRate, 9);
    focus(g, 600, 60);
    expect(g.value).toBe(gateCap('fireRate', 0.1, balance));
  });

  it('counts a curse down toward zero without flipping it early', () => {
    const g = gate('sub', 6);
    applyGateGrowth(g, 600, 600, balance);
    expect(g.kind).toBe('sub');
    expect(g.value).toBeCloseTo(6 - balance.gates.growthPerSecond.sub, 9);
  });

  it('flips a curse to a bonus at zero and keeps growing with the leftover', () => {
    const g = gate('sub', 1);
    // One second of full focus is two units of counting down: one to empty it,
    // one to pay out.
    applyGateGrowth(g, 600, 600, balance);
    expect(g.kind).toBe('add');
    expect(g.value).toBeCloseTo(1, 9);
    expect(g.hits).toBe(600);
  });

  it('flips exactly at zero, with no bonus for the shot that emptied it', () => {
    const g = gate('sub', 2);
    applyGateGrowth(g, 600, 600, balance);
    expect(g.kind).toBe('add');
    expect(g.value).toBe(0);
  });

  it('caps a flipped curse at what the curse was worth, not at the curse plus it', () => {
    const g = gate('sub', 3);
    focus(g, 600, 60);
    expect(g.kind).toBe('add');
    expect(g.value).toBe(gateCap('sub', 3, balance));
  });

  it('never shrinks a gate that already pays more than the cap', () => {
    const g = gate('add', 400);
    g.cap = 10;
    applyGateGrowth(g, 600, 600, balance);
    expect(g.value).toBe(400);
  });

  it('does nothing without a squad to fire, and nothing to solid gates', () => {
    const quiet = gate('add', 5);
    applyGateGrowth(quiet, 10, 0, balance);
    expect(quiet.value).toBe(5);
    expect(quiet.hits).toBe(10);

    const solid = gate('mul', 2);
    applyGateGrowth(solid, 600, 600, balance);
    expect(solid.value).toBe(2);
    expect(solid.hits).toBe(0);

    const staff = gate('weapon', 0);
    applyGateGrowth(staff, 600, 600, balance);
    expect(staff.hits).toBe(0);
  });

  it('pumps the gate the squad is walking into, so it pays more than the label', () => {
    const def = level({ startCount: 20, rows: [row(20, [null, { kind: 'add', value: 4 }, null])] });
    const run = runOf(def);
    const events = play(run, 5, 0);

    const passed = events.find((e) => e.type === 'gatePassed');
    expect(passed?.type).toBe('gatePassed');
    if (passed?.type !== 'gatePassed') throw new Error('no gate was passed');
    expect(passed.value).toBeGreaterThan(4);
    expect(passed.countAfter).toBe(20 + Math.floor(passed.value));
    expect(events.some((e) => e.type === 'gateHit')).toBe(true);
  });

  it('pays a wide squad no faster than a small one: the rate is the same', () => {
    // The whole point of D19: shooting a gate is a rate, so a 300-unit squad
    // and a 30-unit squad walk into about the same number.
    const rows = [row(20, [null, { kind: 'add', value: 4 }, null])];
    const small = runOf(level({ startCount: 30, rows }));
    const large = runOf(level({ startCount: 300, rows }));
    const value = (events: ReturnType<typeof play>): number => {
      const passed = events.find((e) => e.type === 'gatePassed');
      if (passed?.type !== 'gatePassed') throw new Error('no gate was passed');
      return passed.value;
    };

    const smallValue = value(play(small, 5, 0));
    const largeValue = value(play(large, 5, 0));
    expect(largeValue).toBeLessThan(smallValue * 1.6);
  });
});

describe('one gate per row', () => {
  it('applies only the gate in the lane the squad is in, and retires the rest', () => {
    const def = level({
      startCount: 10,
      rows: [
        row(20, [
          { kind: 'add', value: 5 },
          { kind: 'sub', value: 3 },
          { kind: 'add', value: 5 },
        ]),
      ],
    });
    const run = runOf(def);
    const events = play(run, 6, 2);

    const passes = events.filter((e) => e.type === 'gatePassed');
    expect(passes).toHaveLength(1);
    expect(passes[0]?.type === 'gatePassed' && passes[0].gateId).toBe(2);
    expect(run.state.gates.every((g) => g.passed)).toBe(true);
  });

  it('reports a loss when the gate empties the squad', () => {
    const def = level({ startCount: 5, rows: [row(2, [null, { kind: 'sub', value: 1000 }, null])] });
    const run = runOf(def);
    const events = play(run, 2, 0);

    expect(run.state.status).toBe('lost');
    expect(events.some((e) => e.type === 'unitsLost' && e.reason === 'gate')).toBe(true);
    expect(events.some((e) => e.type === 'runEnded' && e.status === 'lost')).toBe(true);
  });
});
