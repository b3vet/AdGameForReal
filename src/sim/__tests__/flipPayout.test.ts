/**
 * Document 32, a flipped curse pays: on a scripted road a flip-sized curse
 * that is shot through to green grows as a plus up to `gates.flip.payout`
 * times its printed size, reaching it in `gates.flip.seconds` of the whole
 * column's fire (`GateDef.flipGrowth`), and the bots price it. Before, a flip
 * paid at most 0.6 of a 6 to 8 percent curse, about 4 percent of the squad,
 * so greedy never took a red lane.
 *
 * Dealt roads (Endless, the fixtures) carry no `flipGrowth` and flip exactly
 * as they did; their pins in `regression.test.ts` hold that to the byte.
 */

import { describe, expect, it } from 'vitest';

import { gateFor } from '../beats/beatSize';
import { WHOLE_BOARD } from '../botPrice';
import { exactRead, lanes, priceLanes } from '../botValue';
import { applyGateGrowth, gateCap } from '../gates';
import { Run } from '../Run';
import type { GateDef, GateState } from '../types';
import { add, board, bestHeld, holdLane, playBoard, ROW_Z } from './botBoards';
import type { BoardSpec } from './botBoards';
import { testLibrary } from './beatFixtures';
import { balance } from '@/data';

const FLIP = balance.gates.flip;

function state(def: GateDef): GateState {
  const gate: GateState = {
    id: 0,
    rowIndex: 0,
    lane: 0,
    z: 50,
    kind: def.kind,
    value: def.value,
    hits: 0,
    passed: false,
    cap: def.cap ?? gateCap(def.kind, def.value, balance),
  };
  if (def.flipGrowth !== undefined) gate.flipGrowth = def.flipGrowth;
  return gate;
}

/** `seconds` of the whole column's fire on the gate, in 1/60 s steps. */
function shoot(gate: GateState, seconds: number, squad: number): void {
  const shotRate = 10;
  for (let t = 0; t < Math.round(seconds * 60); t++) applyGateGrowth(gate, shotRate / 60, shotRate, balance, squad);
}

describe('the flip payout (document 32)', () => {
  it('is data: a multiple of the print, reached in a few seconds of fire', () => {
    expect(FLIP.payout).toBeGreaterThan(1);
    expect(FLIP.seconds).toBeGreaterThan(0);
  });

  it('is written on a scripted flip curse only, never on a price', () => {
    const flip = gateFor({ kind: 'sub', size: 'flip' }, 200, 0, 1, testLibrary);
    expect(flip?.cap).toBe(FLIP.payout * (flip?.value ?? 0));
    expect(flip?.flipGrowth).toBeCloseTo((flip?.cap ?? 0) / FLIP.seconds, 9);
    const price = gateFor({ kind: 'sub', size: 'price' }, 200, 0, 1, testLibrary);
    expect(price?.flipGrowth).toBeUndefined();
    expect(price?.cap).toBe(gateCap('sub', price?.value ?? 0, balance));
  });

  it('grows a paying flip to its payout, and a dealt flip as it always did', () => {
    const paying = state(gateFor({ kind: 'sub', size: 'flip' }, 100, 0, 1, testLibrary) ?? { kind: 'sub', value: 7 });
    shoot(paying, 6, 100);
    expect(paying.kind).toBe('add');
    expect(paying.value).toBeCloseTo(paying.cap ?? 0, 9);
    expect(paying.value).toBeGreaterThan(20);

    // No `flipGrowth`: the road's plus rate and the road's cap, number for number.
    const dealt = state({ kind: 'sub', value: 7 });
    const rates = balance.gates.growthPerSecond;
    const drop = rates.sub + rates.shares.sub * 100;
    const grow = rates.add + rates.shares.add * 100;
    shoot(dealt, 6, 100);
    expect(dealt.kind).toBe('add');
    const flat = Math.min(gateCap('sub', 7, balance), grow * (6 - 7 / drop));
    expect(dealt.value).toBeCloseTo(flat, 6);
    expect(dealt.value).toBeLessThan(paying.value);
  });

  it('pays in the seconds it names, however big the print', () => {
    for (const value of [3, 7, 20]) {
      const gate = state({ kind: 'sub', value, cap: FLIP.payout * value, flipGrowth: (FLIP.payout * value) / FLIP.seconds });
      const drop = balance.gates.growthPerSecond.sub + balance.gates.growthPerSecond.shares.sub * 100;
      // Shot green, then half the payout time: half the payout, give or take a step.
      shoot(gate, value / drop + FLIP.seconds / 2, 100);
      expect(gate.value / (FLIP.payout * value)).toBeCloseTo(0.5, 1);
    }
  });

  const flipBoard = (payout: boolean): BoardSpec => {
    const value = 7;
    const curse: GateDef = payout
      ? { kind: 'sub', value, cap: FLIP.payout * value, flipGrowth: (FLIP.payout * value) / FLIP.seconds }
      : { kind: 'sub', value, cap: gateCap('sub', value, balance) };
    return { start: 100, gates: [curse, add(8), add(6)], squadRates: true };
  };

  it('is priced by the bots as the sim pays it', () => {
    const def = board(flipBoard(true));
    const run = new Run(def, balance);
    const x = -balance.road.laneWidth;
    while (run.state.squad.z < ROW_Z - balance.bots.readDistance) {
      run.setTargetX(x);
      run.tick(1 / 60);
    }
    priceLanes(run.state, 0, ROW_Z, WHOLE_BOARD, exactRead(), balance);
    const projected = lanes.worth[0] ?? 0;
    const held = holdLane(def, -1).count;
    // What the read expects the red lane to leave, against what holding it does.
    expect(Math.abs(projected - held) / held).toBeLessThan(0.1);
    expect(projected).toBeGreaterThan((lanes.worth[1] ?? 0) + 5);
  });

  it('makes the red lane the right one on a board where it pays, and not where it does not', () => {
    const paying = playBoard(board(flipBoard(true)), 'greedy');
    expect(paying.kind).toBe('sub');
    expect(paying.walked).toBe('add');
    expect(paying.count).toBeGreaterThanOrEqual(bestHeld(board(flipBoard(true))).count);
    const flat = playBoard(board(flipBoard(false)), 'greedy');
    expect(flat.kind).toBe('add');
  });
});
