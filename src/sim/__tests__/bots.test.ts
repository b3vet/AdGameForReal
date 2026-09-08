import { describe, expect, it } from 'vitest';

import { createBot } from '../bots';
import { laneCenter } from '../level';
import type { EnemyState, GateState, Lane, RunState, WeaponId } from '../types';
import { balance } from '@/data';

function gate(lane: Lane, kind: GateState['kind'], value: number, z = 20): GateState {
  return { id: lane + 1, rowIndex: 0, lane, z, kind, value, hits: 0, passed: false };
}

function staff(lane: Lane, weaponId: WeaponId, z = 20): GateState {
  return { id: lane + 1, rowIndex: 0, lane, z, kind: 'weapon', value: 0, hits: 0, passed: false, weaponId };
}

function block(x: number, z: number, units = 100): EnemyState {
  return {
    id: 99,
    kind: 'grunt',
    x,
    z,
    hp: units * 3,
    maxHp: units * 3,
    units,
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
    squad: {
      count,
      x: 0,
      targetX: 0,
      z: 0,
      fireRate: 2,
      damage: 1,
      fireRateBonus: 0,
      weaponId: 'ember',
    },
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

  it('values a fireRate gate by what it prints, not as nothing', () => {
    const row = [gate(-1, 'fireRate', 0.1), gate(0, 'add', 1), null];
    const gates = row.filter((g): g is GateState => g !== null);
    // +10% rate on a hundred units beats a single extra body...
    expect(createBot('greedy', 1)(state(gates, [], 100))).toBe(laneCenter(-1));
    // ...and loses to a real handful of them.
    const better = [gate(-1, 'fireRate', 0.1), gate(0, 'add', 20)];
    expect(createBot('greedy', 1)(state(better, [], 100))).toBe(laneCenter(0));
  });

  it('takes a staff that suits the road ahead, and the worst bot takes the other', () => {
    // Three blocks strung out down the road: too far apart to splash, close
    // enough to chain, so storm is the upgrade and frost the downgrade.
    const strung = [block(0, 12, 4), block(0, 14.5, 4), block(0, 17, 4)];
    const row = [staff(-1, 'storm'), gate(0, 'add', 40), staff(1, 'frost')];
    expect(createBot('greedy', 1)(state(row, strung, 200))).toBe(laneCenter(-1));
    expect(createBot('worst', 1)(state(row, strung, 200))).toBe(laneCenter(1));
  });

  it('will not swap to a worse staff just because a gate offers one', () => {
    // Shoulder to shoulder is what the starting staff is for, so trading its
    // splash away for a slow is a downgrade and the bot walks the empty lane.
    const packed = [block(-2, 14, 4), block(0, 14, 4), block(2, 14, 4)];
    const row = [staff(-1, 'frost'), null, null];
    const gates = row.filter((g): g is GateState => g !== null);
    expect(createBot('greedy', 1)(state(gates, packed, 100))).not.toBe(laneCenter(-1));
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
