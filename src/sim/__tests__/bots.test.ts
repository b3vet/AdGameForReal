/**
 * The scripted reference players: greedy and its mirror, and the random one.
 * The human bot and the fence sweep are next door in `botHuman.test.ts`; the
 * boards all three are asked about are in `botFixtures.ts`.
 */

import { describe, expect, it } from 'vitest';

import { createBot } from '../bots';
import { enemyFootprint } from '../enemies';
import { clampLimit, halfWidth, openRoadWidth } from '../formation';
import { laneCenter } from '../lanes';
import { block, body, gate, lane, ROW, staff, state } from './botFixtures';
import type { GateState } from '../types';
import { balance } from '@/data';

describe('bots', () => {
  it('sends greedy to the lane with the best outcome', () => {
    expect(lane(createBot('greedy', 1)(state(ROW)))).toBe(1);
  });

  it('sends worst to the lane with the worst outcome', () => {
    expect(lane(createBot('worst', 1)(state(ROW)))).toBe(-1);
  });

  it('prefers an empty lane to a penalty when the row is short of gates', () => {
    const partial = [gate(-1, 'sub', 4), gate(1, 'add', 6)];
    expect(lane(createBot('greedy', 1)(state(partial)))).toBe(1);
    // Nothing at all beats losing four units, so the worst bot still avoids -4.
    expect(lane(createBot('worst', 1)(state(partial)))).toBe(-1);
  });

  it('values a fireRate gate by what it prints, not as nothing', () => {
    const row = [gate(-1, 'fireRate', 0.1), gate(0, 'add', 1), null];
    const gates = row.filter((g): g is GateState => g !== null);
    // +10% rate on a hundred units beats a single extra body...
    expect(lane(createBot('greedy', 1)(state(gates, [], 100)))).toBe(-1);
    // ...and loses to a real handful of them.
    const better = [gate(-1, 'fireRate', 0.1), gate(0, 'add', 20)];
    expect(lane(createBot('greedy', 1)(state(better, [], 100)))).toBe(0);
  });

  it('takes a staff that suits the road ahead, and the worst bot takes the other', () => {
    // Three blocks strung out down the road: too far apart to splash, close
    // enough to chain, so storm is the upgrade and frost the downgrade.
    const strung = [block(0, 12, 4), block(0, 14.5, 4), block(0, 17, 4)];
    const row = [staff(-1, 'storm'), gate(0, 'add', 40), staff(1, 'frost')];
    expect(lane(createBot('greedy', 1)(state(row, strung, 200)))).toBe(-1);
    expect(lane(createBot('worst', 1)(state(row, strung, 200)))).toBe(1);
  });

  it('will not swap to a worse staff just because a gate offers one', () => {
    // Shoulder to shoulder is what the starting staff is for, so trading its
    // splash away for a slow is a downgrade and the bot walks the empty lane.
    const packed = [block(-2, 14, 4), block(0, 14, 4), block(2, 14, 4)];
    const row = [staff(-1, 'frost'), null, null];
    const gates = row.filter((g): g is GateState => g !== null);
    expect(lane(createBot('greedy', 1)(state(gates, packed, 100)))).not.toBe(-1);
  });

  it('makes greedy step out of a block that is about to reach it', () => {
    // A lane-wide column fits beside a block (D42), so greedy no longer holds
    // its ground and eats one: it goes to the nearest place its crowd clears
    // the block from, which is the neighbouring lane's centre.
    const small = block(0, balance.bots.threatLookahead / 2, 4);
    const blocked = state(ROW, [small]);
    blocked.squad.x = 0.4;
    const target = createBot('greedy', 1)(blocked);
    const squadHalf = halfWidth(blocked.squad.count, openRoadWidth());
    const blockHalf = enemyFootprint('grunt', small.units, balance);
    expect(target).toBe(laneCenter(1));
    expect(Math.abs(target - small.x)).toBeGreaterThanOrEqual(squadHalf + blockHalf);
  });

  it('holds its ground when there is nowhere a block does not reach', () => {
    // Both boundaries walled and a block filling the lane: nothing beats
    // standing still, so it stands still rather than swerving for nothing.
    const boxed = state(ROW, [block(0, balance.bots.threatLookahead / 2)]);
    boxed.squad.x = 0.3;
    boxed.walls = [
      { boundary: -1, zStart: -5, zEnd: 40 },
      { boundary: 1, zStart: -5, zEnd: 40 },
    ];
    expect(createBot('greedy', 1)(boxed)).toBe(0.3);
  });

  it('lets greedy commit to its lane once the row is close', () => {
    const close = [gate(-1, 'sub', 3), gate(0, 'add', 5), gate(1, 'mul', 2)].map((g) => ({
      ...g,
      z: balance.bots.gateCommitDistance - 1,
    }));
    const blocked = state(close, [block(0, 2)]);
    expect(lane(createBot('greedy', 1)(blocked))).toBe(1);
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

  it('moves onto the lane the river is coming down, between gate rows', () => {
    // The next gate row is far away, so what matters is the stream. A small
    // squad only covers the lane it stands on, so it has to go to the bodies.
    const far = [gate(-1, 'add', 5, 60), gate(1, 'add', 6, 60)];
    const left = [body(10, -1, 8), body(11, -1, 10), body(12, -1, 12), body(13, -1, 14)];
    const right = left.map((b, i) => ({ ...b, id: 20 + i, x: laneCenter(1) }));

    expect(createBot('greedy', 1)(state(far, left, 3))).toBeLessThan(0);
    expect(createBot('greedy', 1)(state(far, right, 3))).toBeGreaterThan(0);
  });

  it('stands between two lanes when a horde pours down both', () => {
    // Giving one of a horde's two lanes up is a soldier per body; standing in
    // the gap reaches both, which is why horde lanes are neighbours.
    const far = [gate(-1, 'add', 5, 60), gate(1, 'add', 6, 60)];
    const bodies = [
      body(10, -1, 8),
      body(11, -1, 10),
      body(12, -1, 12),
      body(13, 0, 9, 1),
      body(14, 0, 11, 1),
      body(15, 0, 13, 1),
    ];
    const stand = createBot('greedy', 1)(state(far, bodies, 3));
    expect(stand).toBeGreaterThan(laneCenter(-1));
    expect(stand).toBeLessThan(laneCenter(0));
  });

  it('goes for the gate once the row is close, stream or no stream', () => {
    const close = [gate(-1, 'sub', 3, 4), gate(0, 'add', 5, 4), gate(1, 'mul', 2, 4)];
    const bodies = [body(10, -1, 6), body(11, -1, 7), body(12, -1, 8)];
    expect(lane(createBot('greedy', 1)(state(close, bodies, 20)))).toBe(1);
  });

  it('holds station once every gate is behind the squad', () => {
    const done = state(ROW.map((g) => ({ ...g, passed: true })));
    // Inside the clamp a crowd of ten has, so "hold station" is the position
    // itself and not the clamp answering for it.
    done.squad.x = 1.1;
    expect(createBot('greedy', 1)(done)).toBe(1.1);
    expect(createBot('worst', 1)(done)).toBe(1.1);
  });

  it('steers by the balance its run was built on, not by the shipped one', () => {
    // A bot asks the formation how wide its crowd is and how much road the
    // clamp leaves it, and both are functions of a `Balance` (D37). Reading the
    // shipped object while the run reads its own is the same hazard the
    // formation cache has (`formation.test.ts`), one layer up: the bot asks for
    // a lane centre its crowd is too wide to reach and sails past the row.
    const tuned = structuredClone(balance);
    tuned.formation.spacing.max = balance.formation.spacing.max * 2;
    tuned.formation.spacing.min = balance.formation.spacing.min * 2;

    const width = openRoadWidth();
    // Wider spacing packs *fewer* units into the lane, so the tuned crowd is
    // the narrower one — the band is a lane either way now (D42), and which
    // way the number moves is beside the point: the bot must read its own.
    expect(halfWidth(8, width, tuned)).not.toBeCloseTo(halfWidth(8, width), 6);

    // Both want the `mul` in the right lane, each through its own clamp.
    const squad = state(ROW, [], 8);
    const onShipped = createBot('greedy', 1)(squad);
    const onTuned = createBot('greedy', 1, tuned)(squad);
    expect(lane(onShipped)).toBe(1);
    expect(lane(onTuned)).toBe(1);
    expect(onShipped).toBeCloseTo(Math.min(clampLimit(8, width), laneCenter(1)), 9);
    expect(onTuned).toBeCloseTo(Math.min(clampLimit(8, width, tuned), laneCenter(1)), 9);
  });
});
