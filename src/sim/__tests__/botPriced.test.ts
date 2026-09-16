/**
 * The priced read (document 31, 4.4) on hand-made boards: a guarded prize, an
 * ambush behind a plus, a toll river, a flip curse, a fork and a commit fence.
 *
 * Each board is one gate row with the beat's threat placed by hand
 * (`botBoards.ts`), and "what a thoughtful player would do" is measured rather
 * than asserted from a table: the same board is played with the column held
 * in each lane from the start, and the lane that ends biggest is the answer
 * greedy is held to. Greedy may beat every held lane — it can wait beside a
 * river and step in once it has poured, which is a real player's move too —
 * but it may never end below the best of them.
 */

import { describe, expect, it } from 'vitest';

import { path, pricePath, WHOLE_BOARD } from '../botPrice';
import { Run } from '../Run';
import { add, bestHeld, board, brute, mul, playBoard, portal, ROW_Z, sub } from './botBoards';
import type { BoardSpec } from './botBoards';
import { fenceEntries, humanBalance } from './botFixtures';
import { exposeRoad } from './harness';
import { balance } from '@/data';

/** Greedy on a board, against the best a column held in one lane does there. */
function greedyAgainstHeld(spec: BoardSpec): { lane: number | null; count: number; best: number; bestLane: number } {
  const held = bestHeld(board(spec));
  const play = playBoard(board(spec), 'greedy');
  expect(`greedy ${String(play.count)} vs best held ${String(held.count)}`).toBe(
    `greedy ${String(Math.max(play.count, held.count))} vs best held ${String(held.count)}`,
  );
  return { lane: play.lane, count: play.count, best: held.count, bestLane: held.lane };
}

describe('the priced read on hand-made boards', () => {
  const guarded = (units: number): BoardSpec => ({
    start: 60,
    gates: [add(12), sub(10), mul(2)],
    enemies: [brute(1, -8, units, 45)],
  });

  it('shoots a guard it can kill and takes the prize behind it', () => {
    // Eighteen units at twelve hit points each is two seconds of sixty
    // soldiers' fire; the column has almost five from 34 m.
    const result = greedyAgainstHeld(guarded(18));
    expect(result.lane).toBe(1);
    expect(result.count).toBe(120);
  });

  it('does not walk into a guard it cannot kill', () => {
    // Ninety units is ten seconds of fire. Held in the prize lane the column
    // meets it and walks away with a fraction; greedy stands aside, and the
    // board lets it step back in once the guard has passed.
    const result = greedyAgainstHeld(guarded(90));
    expect(result.best).toBeLessThan(120);
  });

  const ambush = (wake: number): BoardSpec => ({
    start: 100,
    gates: [add(30), sub(15), add(50)],
    enemies: [brute(1, 5, 45, wake, true)],
  });

  it('takes a plus whose ambush wakes early enough to be shot as it comes through', () => {
    // Woken at 50 m the brute walks through the panel with four and a half
    // seconds of fire left: the +50 is worth more than the +30 beside it.
    const result = greedyAgainstHeld(ambush(50));
    expect(result.lane).toBe(1);
    expect(result.bestLane).toBe(1);
  });

  it('leaves a plus whose ambush arrives whole', () => {
    // Woken at 20 m it comes through the panel a fraction of a second before
    // the column arrives: 45 units against the 20 the bigger plus is worth.
    const result = greedyAgainstHeld(ambush(20));
    expect(result.lane).toBe(-1);
    expect(result.bestLane).toBe(-1);
  });

  it('lets the human see the ambush only within its reach behind the panel', () => {
    const late = ambush(20);
    const seeing = playBoard(board(late), 'human', 3);
    const blind = playBoard(board(late), 'human', 3, humanBalance({ behindReach: 0, readNoise: 0 }));
    expect(seeing.lane).toBe(-1);
    // A player who cannot see behind a panel reads the bigger plus and pays.
    expect(blind.lane).toBe(1);
    expect(blind.count).toBeLessThan(seeing.count);
  });

  const toll = (count: number, hp: number): BoardSpec => ({
    start: 100,
    gates: [add(25), sub(15), add(60)],
    streams: [portal(1, 8, 50, 6.5, count, hp)],
  });

  it('pays a small toll for the prize and refuses a dear one', () => {
    // The portal pours from 8 m behind the +60, so its tail comes through the
    // panel at the column's feet: twenty light bodies are nothing, two hundred
    // heavy ones are more than the prize is worth.
    const cheap = greedyAgainstHeld(toll(20, 5));
    expect(cheap.lane).toBe(1);
    const dear = greedyAgainstHeld(toll(200, 50));
    expect(dear.lane).toBe(-1);
    expect(dear.bestLane).toBe(-1);
  });

  it('stands in a small curse until it flips and walks it', () => {
    // A road with squad-share rates (document 31, 3.4): a hundred soldiers
    // count the -6 down in two seconds and pump it for the rest of the approach.
    const spec: BoardSpec = {
      start: 100,
      gates: [{ kind: 'sub', value: 6, cap: 20 }, add(5), null],
      squadRates: true,
    };
    const play = playBoard(board(spec), 'greedy');
    expect(play.lane).toBe(-1);
    expect(play.kind).toBe('sub');
    expect(play.walked).toBe('add');
    expect(play.count).toBeGreaterThanOrEqual(bestHeld(board(spec)).count);
    expect(play.count).toBeGreaterThan(110);
  });

  const fork = (left: number, middle: number): BoardSpec => ({
    start: 100,
    gates: [add(30), add(30), sub(12)],
    streams: [portal(-1, -10, 45, 5, 60, left), portal(0, -10, 45, 5, 30, middle)],
  });

  it('fights the lighter of two rivers and never pays the curse', () => {
    const heavyLeft = greedyAgainstHeld(fork(60, 10));
    expect(heavyLeft.lane).toBe(0);
    const heavyMiddle = greedyAgainstHeld({ ...fork(10, 10), streams: [portal(-1, -10, 45, 5, 60, 10), portal(0, -10, 45, 5, 30, 80)] });
    expect(heavyMiddle.lane).toBe(-1);
  });

  const fence = (count: number, hp: number): BoardSpec => ({
    start: 100,
    gates: [sub(15), add(30), add(70)],
    streams: [portal(1, 6, 50, 5, count, hp)],
    fence: { boundary: 1, from: 20 },
  });

  it('commits past a cheap toll to the fenced prize and stays inside for a dear one', () => {
    const cheap = greedyAgainstHeld(fence(20, 5));
    expect(cheap.lane).toBe(1);
    const dear = greedyAgainstHeld(fence(200, 60));
    expect(dear.lane).toBe(0);
    // Either way the whole column was on its side before the stretch held.
    for (const spec of [fence(20, 5), fence(200, 60)]) {
      for (const outside of fenceEntries(board(spec), 'greedy')) expect(outside).toBe(0);
    }
  });
});

describe('what the price sees', () => {
  /** Lane 1's price at the start of a board. */
  function priceOf(spec: BoardSpec): { cost: number; after: number } {
    const def = board(spec);
    const run = new Run(def, balance);
    exposeRoad(run, def);
    // Walk the column to the read distance, holding the lane being priced.
    while (run.state.squad.z < ROW_Z - balance.bots.readDistance) {
      run.setTargetX(2);
      run.tick(1 / 60);
    }
    pricePath(run.state, 0, ROW_Z, WHOLE_BOARD, balance);
    return { cost: path.cost[2] ?? 0, after: path.after[2] ?? 0 };
  }

  it('screens a block behind a panel that stops shots and not behind a multiplier', () => {
    const behindPlus = priceOf({ start: 100, gates: [null, null, add(20)], enemies: [brute(1, 5, 45, 26, true)] });
    const behindMul = priceOf({ start: 100, gates: [null, null, mul(2)], enemies: [brute(1, 5, 45, 26, true)] });
    expect(behindPlus.cost + behindPlus.after).toBeGreaterThan(behindMul.cost + behindMul.after);
    expect(behindMul.cost + behindMul.after).toBe(0);
  });

  it('prices a river pouring from behind the row after the gate', () => {
    // Its bodies meet the column past the panels, where a multiplier would not
    // double what they take.
    const priced = priceOf({ start: 100, gates: [null, null, add(60)], streams: [portal(1, 8, 50, 6.5, 200, 50)] });
    expect(priced.after).toBeGreaterThan(0);
    expect(priced.cost + priced.after).toBeGreaterThan(20);
  });
});
