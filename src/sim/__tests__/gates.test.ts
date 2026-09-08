import { describe, expect, it } from 'vitest';

import { applyGateHits, clampCount, countAfterGate, isShootable } from '../gates';
import type { GateState } from '../types';
import { level, play, row, runOf, testBalance } from './fixtures';

function gate(kind: GateState['kind'], value: number): GateState {
  return { id: 0, rowIndex: 0, lane: 0, z: 10, kind, value, hits: 0, passed: false };
}

describe('gate arithmetic', () => {
  it('applies each kind to the squad count', () => {
    expect(countAfterGate('add', 7, 10)).toBe(17);
    expect(countAfterGate('sub', 7, 10)).toBe(3);
    expect(countAfterGate('mul', 3, 10)).toBe(30);
    expect(countAfterGate('fireRate', 0.2, 10)).toBe(10);
  });

  it('floors a multiply rather than handing out half a wizard', () => {
    expect(countAfterGate('mul', 2.5, 7)).toBe(17);
  });

  it('clamps the count to the road and the pool', () => {
    const balance = testBalance();
    expect(clampCount(-40, balance)).toBe(0);
    expect(clampCount(9_000, balance)).toBe(balance.squad.maxCount);
  });
});

describe('shoot to grow', () => {
  const balance = testBalance();

  it('grows an add gate by one per hit, up to the cap', () => {
    const g = gate('add', 5);
    applyGateHits(g, 3, balance);
    expect(g.value).toBe(8);
    expect(g.hits).toBe(3);

    applyGateHits(g, 10_000, balance);
    expect(g.value).toBe(balance.gates.caps.add);
  });

  it('raises a fireRate gate in small steps, up to its own cap', () => {
    const g = gate('fireRate', 0.1);
    applyGateHits(g, 5, balance);
    expect(g.value).toBeCloseTo(0.1 + 5 * balance.gates.hitStep.fireRate, 6);

    applyGateHits(g, 10_000, balance);
    expect(g.value).toBe(balance.gates.caps.fireRate);
  });

  it('counts a sub gate down without flipping it early', () => {
    const g = gate('sub', 6);
    applyGateHits(g, 4, balance);
    expect(g.kind).toBe('sub');
    expect(g.value).toBe(2);
  });

  it('flips sub to add at zero and keeps growing with the leftover hits', () => {
    const g = gate('sub', 6);
    applyGateHits(g, 9, balance);
    expect(g.kind).toBe('add');
    expect(g.value).toBe(3);
    expect(g.hits).toBe(9);
  });

  it('flips exactly at zero, with no bonus for the hit that emptied it', () => {
    const g = gate('sub', 6);
    applyGateHits(g, 6, balance);
    expect(g.kind).toBe('add');
    expect(g.value).toBe(0);
  });

  it('leaves mul gates alone: shots pass through them', () => {
    const g = gate('mul', 2);
    applyGateHits(g, 50, balance);
    expect(g.value).toBe(2);
    expect(g.hits).toBe(0);
    expect(isShootable('mul')).toBe(false);
  });

  it('pumps the gate the squad is walking into, so it pays more than the label', () => {
    const def = level({ startCount: 20, rows: [row(20, [null, { kind: 'add', value: 4 }, null])] });
    const run = runOf(def);
    const events = play(run, 5, 0);

    const passed = events.find((e) => e.type === 'gatePassed');
    expect(passed?.type).toBe('gatePassed');
    if (passed?.type !== 'gatePassed') throw new Error('no gate was passed');
    expect(passed.value).toBeGreaterThan(4);
    expect(passed.countAfter).toBe(20 + passed.value);
    expect(events.some((e) => e.type === 'gateHit')).toBe(true);
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
