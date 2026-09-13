/**
 * The human-like bot (D45): the player the difficulty bands are measured on,
 * and what it leaves outside a fence. Greedy and the random bot are next door
 * in `bots.test.ts`; the boards are in `botFixtures.ts`.
 */

import { describe, expect, it } from 'vitest';

import { createBot } from '../bots';
import { laneCenter } from '../lanes';
import {
  campaignEntries,
  gate,
  fenceEntries,
  fenceTrap,
  humanBalance,
  lane,
  rowGates,
  state,
} from './botFixtures';
import { playLevel } from './harness';
import { balance } from '@/data';

describe('the human bot', () => {
  it('acts on the board exactly `reactionSteps` after it changes', () => {
    // The hand alone: no misreads, and a finger fast enough to arrive the step
    // it is told to, so what is left to measure is the delay itself.
    const tuned = humanBalance({ swipeSpeed: 1000, laneAccuracy: 1 });
    const delay = tuned.bots.human.reactionSteps;
    const bot = createBot('human', 1, tuned);

    const close = balance.bots.gateCommitDistance - 3;
    const before = state(rowGates(close));
    for (let i = 0; i < delay + 5; i++) bot(before);
    const settled = bot(before);
    expect(lane(settled)).toBe(1);

    // The same row with the multiplier moved to the other side.
    const swapped = state([
      { ...gate(-1, 'mul', 2, close) },
      { ...gate(0, 'add', 5, close) },
      { ...gate(1, 'sub', 3, close) },
    ]);
    let changedAt = -1;
    for (let i = 0; i < delay * 2; i++) {
      const out = bot(swapped);
      if (changedAt < 0 && out !== settled) changedAt = i;
    }
    expect(changedAt).toBe(delay);
  });

  it('moves its finger no faster than `swipeSpeed`', () => {
    // A thumb, not a jump (D45): the target itself has a speed, on top of
    // whatever the crowd does to follow it.
    const tuned = humanBalance({ reactionSteps: 0, laneAccuracy: 1 });
    const cap = tuned.bots.human.swipeSpeed / 60;
    const bot = createBot('human', 1, tuned);
    const wanted = state(rowGates(balance.bots.gateCommitDistance - 3));

    let previous = wanted.squad.x;
    let biggest = 0;
    let steps = 0;
    while (previous !== laneCenter(1) && steps < 600) {
      const out = bot(wanted);
      biggest = Math.max(biggest, Math.abs(out - previous));
      previous = out;
      steps++;
    }
    expect(biggest).toBeLessThanOrEqual(cap + 1e-12);
    // And it really did take a lane change's worth of steps to get there.
    expect(previous).toBe(laneCenter(1));
    expect(steps).toBeGreaterThanOrEqual(Math.floor(laneCenter(1) / cap));
  });

  it('reads the row right about seven times in ten', () => {
    // Wrong is the *second* best lane, not the worst one: a player who misreads
    // a row takes the lesser gate, they do not walk into the curse.
    const tuned = humanBalance({ reactionSteps: 0, swipeSpeed: 1000 });
    const bot = createBot('human', 5, tuned);
    const rows = 400;
    let best = 0;
    for (let r = 0; r < rows; r++) {
      const picked = lane(bot(state(rowGates(balance.bots.gateCommitDistance - 3, r))));
      expect(picked).not.toBe(-1);
      if (picked === 1) best++;
    }
    const accuracy = best / rows;
    expect(accuracy).toBeGreaterThan(tuned.bots.human.laneAccuracy - 0.07);
    expect(accuracy).toBeLessThan(tuned.bots.human.laneAccuracy + 0.07);
  });

  it('rolls its lane once per row, not once per step', () => {
    const tuned = humanBalance({ reactionSteps: 0, swipeSpeed: 1000 });
    const bot = createBot('human', 2, tuned);
    const here = state(rowGates(balance.bots.gateCommitDistance - 3));
    const first = bot(here);
    for (let i = 0; i < 60; i++) expect(bot(here)).toBe(first);
  });

  it('answers the same board the same way from the same seed', () => {
    // It carries state now — a ring of past observations, a finger, and one
    // roll per row — so "reproducible" has to be pinned rather than assumed:
    // the balance bands are measured on this bot, run after run.
    const first = createBot('human', 9);
    const same = createBot('human', 9);
    const other = createBot('human', 10);
    let diverged = false;
    for (let r = 0; r < 40; r++) {
      const here = state(rowGates(balance.bots.gateCommitDistance - 3, r));
      for (let step = 0; step < 12; step++) {
        const answer = first(here);
        expect(same(here)).toBe(answer);
        if (other(here) !== answer) diverged = true;
      }
    }
    expect(diverged).toBe(true);
  });

  it('clears level 1 on every seed', () => {
    // D31's generous opening, through a thumb: the first level has to be a
    // level a real player finishes, or the campaign never starts.
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(`s${String(seed)} ${playLevel(1, seed, 'human').status}`).toBe(`s${String(seed)} won`);
    }
  }, 60_000);

  it('walks away with less of its crowd than greedy on a mid level', () => {
    // The whole point of D45: greedy is a ceiling, not a player. If the two
    // were within a hair of each other the bands would be measured on nobody.
    //
    // On the mean rather than seed by seed, which is how it read through wave
    // one. With the boss sized to the crowd the *human* brings (Phase C2), a
    // seed where the thumb happens to read every row right ends its fight
    // sooner than greedy's longer one against the same boss and walks away with
    // more — one such seed in five is not the bands being measured on nobody.
    let human = 0;
    let greedy = 0;
    let better = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const h = playLevel(7, seed, 'human');
      const g = playLevel(7, seed, 'greedy');
      const hShare = h.survivors / Math.max(1, h.peakCount);
      const gShare = g.survivors / Math.max(1, g.peakCount);
      if (hShare > gShare) better++;
      human += hShare;
      greedy += gShare;
    }
    expect(`seeds where the human kept more: ${String(better)}`).toBe(
      `seeds where the human kept more: ${String(Math.min(better, 1))}`,
    );
    expect(human / 5).toBeLessThan(greedy / 5);
  }, 60_000);
});

describe('bots at a fence', () => {
  it('has greedy inside the line with its whole column before the stretch holds', () => {
    // The trap: a multiplier on each side of the fence, and the near one three
    // metres before the approach zone. Greedy commits to a side at
    // `bots.wallCommitDistance` with both rows valued and does not revisit it,
    // so it takes the near multiplier and gives the far one up rather than
    // setting off across the road with a metre of road left.
    const entries = fenceEntries(fenceTrap(), 'greedy');
    expect(entries.length).toBe(1);
    expect(entries[0]).toBe(0);
  });

  it('leaves the human astride the line, which is where its stragglers come from', () => {
    // D44 from the steering side: the bot notices the fence within `wallReach`,
    // its hand is `reactionSteps` behind that and its finger crosses at
    // `swipeSpeed`, so a crossing it starts for the river or for a gate is
    // still happening when the stretch arrives. Phase A turns the units still
    // on the far side into a straggler group; from here it is simply that the
    // crowd was not all there yet.
    const entries = campaignEntries('human');
    expect(entries.length).toBeGreaterThan(10);
    const astride = entries.filter((outside) => outside > 0).length;
    expect(`${String(astride)} of ${String(entries.length)} astride`).not.toBe(
      `0 of ${String(entries.length)} astride`,
    );
    expect(astride / entries.length).toBeGreaterThan(0.25);
  }, 60_000);

  it('keeps greedy out of every fence in the campaign, not just the fixture', () => {
    // The regression this pins: through Milestone 5 greedy took a multiplier on
    // the wrong half of the road and then set off across it with a metre of
    // road left, entering 29 of the campaign's 102 stretches astride the line.
    const entries = campaignEntries('greedy');
    expect(entries.length).toBeGreaterThan(10);
    for (const outside of entries) {
      expect(`outside ${outside.toFixed(2)}`).toBe('outside 0.00');
    }
  }, 60_000);
});
