import { describe, expect, it } from 'vitest';

import { createBot } from '../bots';
import { laneCenter } from '../level';
import type { EnemyState, GateState, Lane, RunState } from '../types';
import { balance } from '@/data';

function gate(lane: Lane, kind: GateState['kind'], value: number, z = 20): GateState {
  return { id: lane + 1, rowIndex: 0, lane, z, kind, value, hits: 0, passed: false };
}

function block(x: number, z: number): EnemyState {
  return {
    id: 99,
    kind: 'grunt',
    x,
    z,
    hp: 300,
    maxHp: 300,
    units: 100,
    speed: 3,
    active: true,
    alive: true,
  };
}

function state(gates: GateState[], enemies: EnemyState[] = [], count = 10): RunState {
  return {
    levelIndex: 1,
    seed: 1,
    time: 0,
    status: 'running',
    squad: { count, x: 0, targetX: 0, z: 0, fireRate: 2, damage: 1, fireRateBonus: 0 },
    gates,
    enemies,
    projectiles: [],
    boss: null,
    peakCount: count,
    survivors: count,
    arenaZ: 200,
  };
}

const ROW = [gate(-1, 'sub', 3), gate(0, 'add', 5), gate(1, 'mul', 2)];

describe('bots', () => {
  it('sends greedy to the lane with the best outcome', () => {
    expect(createBot('greedy', 1)(state(ROW))).toBe(laneCenter(1));
  });

  it('sends worst to the lane with the worst outcome', () => {
    expect(createBot('worst', 1)(state(ROW))).toBe(laneCenter(-1));
  });

  it('prefers an empty lane to a penalty when the row is short of gates', () => {
    const partial = [gate(-1, 'sub', 4), gate(1, 'add', 6)];
    expect(createBot('greedy', 1)(state(partial))).toBe(laneCenter(1));
    // Nothing at all beats losing four units, so the worst bot still avoids -4.
    expect(createBot('worst', 1)(state(partial))).toBe(laneCenter(-1));
  });

  it('values a fireRate gate as a fraction of the squad, not as nothing', () => {
    const row = [gate(-1, 'fireRate', 0.1), gate(0, 'add', 1), null];
    const gates = row.filter((g): g is GateState => g !== null);
    expect(createBot('greedy', 1)(state(gates, [], 100))).toBe(laneCenter(-1));
  });

  it('makes greedy hold its ground when a block is about to reach it', () => {
    const blocked = state(ROW, [block(0, balance.bots.threatLookahead / 2)]);
    blocked.squad.x = 0.4;
    expect(createBot('greedy', 1)(blocked)).toBe(0.4);
  });

  it('lets greedy commit to its lane once the row is close', () => {
    const close = [gate(-1, 'sub', 3), gate(0, 'add', 5), gate(1, 'mul', 2)].map((g) => ({
      ...g,
      z: balance.bots.gateCommitDistance - 1,
    }));
    const blocked = state(close, [block(0, 2)]);
    expect(createBot('greedy', 1)(blocked)).toBe(laneCenter(1));
  });

  it('keeps the random bot on one lane for the whole row', () => {
    const bot = createBot('random', 3);
    const current = state(ROW);
    const first = bot(current);
    for (let i = 0; i < 50; i++) expect(bot(current)).toBe(first);
  });

  it('gives different random bots different lane sequences', () => {
    const lanes = (seed: number): number[] => {
      const bot = createBot('random', seed);
      const out: number[] = [];
      for (let row = 0; row < 12; row++) {
        const gates = [{ ...gate(0, 'add', 5), rowIndex: row }];
        for (let i = 0; i < row; i++) gates.unshift({ ...gate(0, 'add', 5), rowIndex: i, passed: true });
        out.push(bot(state(gates)));
      }
      return out;
    };
    expect(lanes(1)).not.toEqual(lanes(7));
  });

  it('holds station once every gate is behind the squad', () => {
    const done = state(ROW.map((g) => ({ ...g, passed: true })));
    done.squad.x = 1.3;
    expect(createBot('greedy', 1)(done)).toBe(1.3);
    expect(createBot('worst', 1)(done)).toBe(1.3);
  });
});
