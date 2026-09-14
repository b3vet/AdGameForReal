/**
 * The Rime Fiend (D49): boss 2, and the one thing it does that boss 1 does not.
 *
 * Every number the fight shares with the demon — the stomp, the grind, the
 * enrage, the hp ladder — is `./run.test.ts`'s and `./balance.test.ts`'s. What
 * is asserted here is the charge: that it happens on its own clock, that it
 * commits to the lane the column is standing in, that it kills along the path
 * it takes rather than a share of an anonymous total, that it comes back, and
 * that boss 1 still does none of it.
 */

import { describe, expect, it } from 'vitest';

import { level, play, runOf, testBalance } from './fixtures';
import type { SimEvent } from '../types';
import type { Balance } from '@/data/types';

/** A short road and a boss that cannot be killed, so the clock is visible. */
function arena(kind: 'demon' | 'rime', tuning: Balance, hp = 5_000_000) {
  return runOf(
    level({
      startCount: 200,
      arenaZ: 10,
      rows: [],
      boss: { hp, units: Math.ceil(hp / tuning.enemies.boss.hpPerUnit), bite: 1, kind },
    }),
    tuning,
  );
}

function charges(events: readonly SimEvent[]): Array<Extract<SimEvent, { type: 'charge' }>> {
  const out: Array<Extract<SimEvent, { type: 'charge' }>> = [];
  for (const event of events) if (event.type === 'charge') out.push(event);
  return out;
}

describe('the Rime Fiend', () => {
  it('charges on its own clock and not before it', () => {
    const tuning = testBalance();
    tuning.squad.damage = 0;
    const run = arena('rime', tuning);
    const interval = tuning.enemies.boss.rime.charge.interval;

    // It has to wake up first: the boss activates when the squad stops at the
    // arena, which is two seconds of road away.
    expect(charges(play(run, 2 + interval - 1, 0))).toHaveLength(0);
    const first = charges(play(run, 2, 0));
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: 'boss', enemyId: run.state.boss?.id });
  });

  it('commits to the lane the column is standing in', () => {
    const tuning = testBalance();
    tuning.squad.damage = 0;
    const laneWidth = tuning.road.laneWidth;
    for (const lane of [-1, 0, 1] as const) {
      const run = arena('rime', tuning);
      const seen = charges(play(run, 24, lane * laneWidth));
      expect(seen.length).toBeGreaterThan(0);
      for (const event of seen) expect(event.lane).toBe(lane);
    }
  });

  it('runs past the column\'s front and walks back to where it stood', () => {
    const tuning = testBalance();
    tuning.squad.damage = 0;
    const charge = tuning.enemies.boss.rime.charge;
    const run = arena('rime', tuning);
    const boss = run.state.boss;
    expect(boss).toBeDefined();

    // Let it wake and settle, then watch one whole charge.
    play(run, 2, 0);
    const stand = boss?.z ?? 0;
    let deepest = Infinity;
    let sawCharge = false;
    for (let i = 0; i < 60 * 20; i++) {
      run.setTargetX(0);
      run.tick(1 / 60);
      const z = boss?.z ?? 0;
      if (boss?.charge !== undefined) sawCharge = true;
      if (sawCharge && z < deepest) deepest = z;
      if (sawCharge && boss?.charge === undefined) break;
    }
    expect(sawCharge).toBe(true);
    // Past the front of the column by the depth it is tuned for...
    expect(deepest).toBeLessThanOrEqual(run.state.squad.z - charge.depth + 1e-6);
    // ...and home again, no further forward than it was when it set off: the
    // charge must not be a free way to close the distance.
    expect(boss?.z ?? 0).toBeLessThanOrEqual(stand + 1e-6);
    expect(boss?.z ?? 0).toBeGreaterThan(run.state.squad.z);
  });

  it('kills its share of the crowd on the way through', () => {
    const tuning = testBalance();
    tuning.squad.damage = 0;
    // Nothing else may take units while this is measured: no stomp — the floor
    // under `stompKills` is one soldier however small the dial is set, so the
    // clock is what has to be turned off — and no contact grind.
    tuning.enemies.boss.stompInterval = 1000;
    tuning.enemies.boss.enrageStompInterval = 1000;
    tuning.enemies.boss.contactShare = 0;
    const share = tuning.enemies.boss.rime.charge.share;

    const run = arena('rime', tuning);
    play(run, 2, 0);
    const before = run.state.squad.count;
    const events = play(run, tuning.enemies.boss.rime.charge.interval + 6, 0);

    let killed = 0;
    for (const event of events) if (event.type === 'unitsLost') killed += event.amount;
    expect(charges(events)).toHaveLength(1);
    // One charge, one share of the column it set off against, to the unit the
    // fractional carry rounds to.
    expect(killed).toBeGreaterThanOrEqual(Math.floor(before * share) - 1);
    expect(killed).toBeLessThanOrEqual(Math.ceil(before * share) + 1);
  });

  it('respects the interval between one charge and the next', () => {
    const tuning = testBalance();
    tuning.squad.damage = 0;
    const run = arena('rime', tuning);
    const interval = tuning.enemies.boss.rime.charge.interval;

    const times: number[] = [];
    for (let i = 0; i < 60 * 60; i++) {
      run.setTargetX(0);
      for (const event of run.tick(1 / 60)) {
        if (event.type === 'charge') times.push(run.state.time);
      }
    }
    expect(times.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < times.length; i++) {
      const gap = (times[i] ?? 0) - (times[i - 1] ?? 0);
      // The clock starts again when the charge *ends*, so the gap is the
      // interval plus however long the run out and back took.
      expect(gap).toBeGreaterThanOrEqual(interval);
    }
  });

  it('enrages like boss 1, and stops charging when it does', () => {
    const tuning = testBalance();
    const run = arena('rime', tuning, 900);
    const events = play(run, 60, 0);

    const enraged = events.findIndex((event) => event.type === 'bossEnraged');
    expect(enraged).toBeGreaterThanOrEqual(0);
    expect(run.state.boss?.enraged).toBe(true);
    // `whileEnraged` is false as shipped: the enraged stomp is already the
    // short clock, and a charge on top of it is a wipe rather than a fight.
    expect(tuning.enemies.boss.rime.charge.whileEnraged).toBe(false);
    const after = events.slice(enraged);
    expect(after.filter((event) => event.type === 'charge')).toHaveLength(0);
  });

  it('leaves boss 1 exactly as it was', () => {
    const tuning = testBalance();
    tuning.squad.damage = 0;
    const run = arena('demon', tuning);
    const events = play(run, 40, 0);
    expect(charges(events)).toHaveLength(0);
    expect(run.state.boss?.variant).toBe('demon');
    expect(run.state.boss?.charge).toBeUndefined();
    // It still walks the squad down and stops at contact, as it always has.
    expect(run.state.boss?.z ?? 0).toBeCloseTo(
      run.state.squad.z + tuning.enemies.contactDistance,
      3,
    );
  });
});
