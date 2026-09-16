/**
 * The Rime Fiend (D49): boss 2, and the one thing it does that boss 1 does not.
 *
 * Every number the fight shares with the demon — the stomp, the grind, the
 * enrage, the hp ladder — is `./run.test.ts`'s and `./balance.test.ts`'s. What
 * is asserted here is the charge: that it happens on its own clock, that it
 * commits to the lane the column is standing in and winds up before it goes,
 * that it kills the people it runs over and nobody else (document 29), that a
 * column that left the lane in time loses nobody, that it comes back, and that
 * boss 1 still does none of it.
 */

import { describe, expect, it } from 'vitest';

import { level, play, runOf, testBalance } from './fixtures';
import type { Run } from '../Run';
import type { SimEvent } from '../types';
import type { Balance } from '@/data/types';

const DT = 1 / 60;

/** A short road and a boss that cannot be killed, so the clock is visible. */
function arena(kind: 'demon' | 'rime', tuning: Balance, hp = 5_000_000, startCount = 200) {
  return runOf(
    level({
      startCount,
      arenaZ: 10,
      rows: [],
      boss: { hp, units: Math.ceil(hp / tuning.enemies.boss.hpPerUnit), bite: 1, kind },
    }),
    tuning,
  );
}

/**
 * Tuning where only the charge takes anybody: no stomp — the floor under
 * `stompKills` is one soldier however small the dial is set, so the clock is
 * what has to be turned off — no contact grind, and a squad that does no damage.
 */
function chargeOnly(): Balance {
  const tuning = testBalance();
  tuning.squad.damage = 0;
  tuning.enemies.boss.stompInterval = 1000;
  tuning.enemies.boss.enrageStompInterval = 1000;
  tuning.enemies.boss.contactShare = 0;
  return tuning;
}

function charges(events: readonly SimEvent[]): Array<Extract<SimEvent, { type: 'charge' }>> {
  const out: Array<Extract<SimEvent, { type: 'charge' }>> = [];
  for (const event of events) if (event.type === 'charge') out.push(event);
  return out;
}

function lostTo(events: readonly SimEvent[], reason: string): number {
  let lost = 0;
  for (const event of events) {
    if (event.type === 'unitsLost' && event.reason === reason) lost += event.amount;
  }
  return lost;
}

/** The cap a charge set off against `count` units carries. */
function capOf(count: number, tuning: Balance): number {
  const charge = tuning.enemies.boss.rime.charge;
  return Math.max(charge.killFloor, Math.ceil(count * charge.killShare));
}

/**
 * Plays on, standing at `x`, until the boss has walked in to contact distance
 * and is between charges. A charge that starts while it is still walking in has
 * metres of open road in front of it; one from contact lands on the column the
 * moment it sets off, and that is the charge the wind-up has to make answerable.
 */
function atContact(run: Run, tuning: Balance, x: number): void {
  const boss = run.state.boss;
  const contact = tuning.enemies.contactDistance;
  for (let step = 0; step < 60 * 90; step++) {
    const gap = (boss?.z ?? 0) - run.state.squad.z;
    if (boss?.active === true && boss.charge === undefined && gap <= contact + 1e-6) return;
    run.setTargetX(x);
    run.tick(DT);
  }
  throw new Error('the boss never reached the column');
}

interface Dodge {
  /** Where the column stands until the charge is announced. */
  from: number;
  /** Where the thumb goes once it has seen it, or null to stay put. */
  to: number | null;
  /** Steps between the announcement and the thumb moving. */
  reaction: number;
  /** How fast the thumb travels, in m/s; Infinity for a jump. */
  swipe: number;
}

/**
 * One charge, played from the wake-up to the walk home, with a thumb that may
 * answer it. Every event is copied, as `play` does.
 */
function oneCharge(run: Run, tuning: Balance, dodge: Dodge): SimEvent[] {
  const events: SimEvent[] = [];
  let finger = dodge.from;
  let seenAt = -1;
  let home = false;
  for (let step = 0; step < 60 * 30 && !home; step++) {
    if (seenAt >= 0 && dodge.to !== null && step - seenAt >= dodge.reaction) {
      const most = dodge.swipe * DT;
      const gap = dodge.to - finger;
      finger += Math.abs(gap) <= most ? gap : Math.sign(gap) * most;
    }
    run.setTargetX(finger);
    for (const event of run.tick(DT)) {
      events.push({ ...event });
      if (event.type === 'charge') seenAt = step;
    }
    home = seenAt >= 0 && run.state.boss?.charge === undefined;
  }
  expect(charges(events)).toHaveLength(1);
  expect(tuning.enemies.boss.rime.charge.windup).toBeGreaterThan(0);
  return events;
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

  it('winds up where it stands before it runs, and says when it will go', () => {
    const tuning = chargeOnly();
    const windup = tuning.enemies.boss.rime.charge.windup;
    const run = arena('rime', tuning);
    const boss = run.state.boss;
    play(run, 2 + tuning.enemies.boss.rime.charge.interval - 0.5, -2);

    let announcedAt = -1;
    let standZ = 0;
    let lostInWindup = 0;
    let movedAt = -1;
    for (let step = 0; step < 120 && movedAt < 0; step++) {
      run.setTargetX(-2);
      for (const event of run.tick(DT)) {
        if (event.type === 'charge') {
          announcedAt = run.state.time;
          standZ = boss?.z ?? 0;
          // The run is announced with its start and its end, on the sim's clock.
          expect(boss?.charge?.from).toBeCloseTo(announcedAt + windup, 9);
          expect(boss?.charge?.until ?? 0).toBeGreaterThan(announcedAt + windup);
        }
        if (announcedAt >= 0 && event.type === 'unitsLost') lostInWindup += event.amount;
      }
      if (announcedAt >= 0 && (boss?.z ?? 0) < standZ - 1e-9) movedAt = run.state.time;
    }
    // Not a step forward, and nobody hurt, until the wind-up is over.
    expect(movedAt - announcedAt).toBeCloseTo(windup, 6);
    expect(lostInWindup).toBe(0);
    // ...and by then it has slid into the lane it picked.
    expect(boss?.x).toBeCloseTo(-tuning.road.laneWidth, 6);
  });

  it('runs past the column\'s front and walks back to where it stood', () => {
    const tuning = testBalance();
    tuning.squad.damage = 0;
    const charge = tuning.enemies.boss.rime.charge;
    const run = arena('rime', tuning);
    const boss = run.state.boss;
    expect(boss).toBeDefined();

    // Let it wake and settle beside a column in the outside lane, then watch
    // one whole charge.
    play(run, 2, -2);
    let deepest = Infinity;
    let sawCharge = false;
    let standX = 0;
    let standZ = 0;
    let widestStep = 0;
    let lastX = boss?.x ?? 0;
    for (let i = 0; i < 60 * 20; i++) {
      run.setTargetX(-2);
      run.tick(DT);
      const x = boss?.x ?? 0;
      const z = boss?.z ?? 0;
      widestStep = Math.max(widestStep, Math.abs(x - lastX));
      lastX = x;
      if (!sawCharge && boss?.charge !== undefined) {
        sawCharge = true;
        standZ = z;
        // The first step of the wind-up has already slid it one step across.
        standX = x + charge.lateralSpeed * DT;
      }
      if (sawCharge && z < deepest) deepest = z;
      if (sawCharge && boss?.charge === undefined) break;
    }
    expect(sawCharge).toBe(true);
    // Past the front of the column by the depth it is tuned for...
    expect(deepest).toBeLessThanOrEqual(run.state.squad.z - charge.depth + 1e-6);
    // ...and home again, no further forward than it was when it set off: the
    // charge must not be a free way to close the distance.
    expect(boss?.z ?? 0).toBeCloseTo(standZ, 6);
    expect(boss?.z ?? 0).toBeGreaterThan(run.state.squad.z);
    // Home across the road as well, at its own lateral speed: the standing
    // fight keeps the body inside the road's edge, and a charge that ended a
    // lane further out would be snapped back in one step.
    expect(boss?.x ?? 0).toBeCloseTo(standX, 6);
    expect(widestStep).toBeLessThanOrEqual(charge.lateralSpeed * DT + 1e-9);
  });

  it('kills the column it runs into, up to its cap, as it lands', () => {
    const tuning = chargeOnly();
    const run = arena('rime', tuning);
    play(run, 2, -2);
    const before = run.state.squad.count;
    const events = oneCharge(run, tuning, { from: -2, to: null, reaction: 0, swipe: 0 });

    const killed = lostTo(events, 'charge');
    // A column of two hundred fills the body's path several times over, so
    // what stops the killing is the cap and nothing else.
    expect(killed).toBe(capOf(before, tuning));
    expect(run.state.squad.count).toBe(before - killed);
    // Nothing else took anybody: the dead are the charge's.
    expect(lostTo(events, 'contact') + lostTo(events, 'stomp')).toBe(0);
    // The landing is told once, before the first of its dead.
    const hits = events.filter((event) => event.type === 'chargeHit');
    expect(hits).toHaveLength(1);
    const firstHit = events.findIndex((event) => event.type === 'chargeHit');
    const firstLoss = events.findIndex((event) => event.type === 'unitsLost');
    expect(firstHit).toBeGreaterThanOrEqual(0);
    expect(firstHit).toBeLessThan(firstLoss);
    expect(hits[0]).toMatchObject({ enemyId: run.state.boss?.id });
  });

  it('kills a small column it runs into down to the floor', () => {
    const tuning = chargeOnly();
    const run = arena('rime', tuning, 5_000_000, 12);
    play(run, 2, 2);
    const events = oneCharge(run, tuning, { from: 2, to: null, reaction: 0, swipe: 0 });
    expect(lostTo(events, 'charge')).toBe(tuning.enemies.boss.rime.charge.killFloor);
  });

  it('kills only the people standing under its body', () => {
    const tuning = chargeOnly();
    const charge = tuning.enemies.boss.rime.charge;
    const run = arena('rime', tuning);
    play(run, 2, 0);
    const crowd = run.state.crowd;
    const boss = run.state.boss;
    if (crowd === undefined || boss === null) throw new Error('no crowd or boss');

    // Where every unit stood as the step began, and where the body ended it:
    // a unit that died in a step died between those two.
    const x = new Float64Array(crowd.capacity);
    const z = new Float64Array(crowd.capacity);
    const alive = new Uint8Array(crowd.capacity);
    let dead = 0;
    let furthest = 0;
    for (let step = 0; step < 60 * 20; step++) {
      x.set(crowd.x);
      z.set(crowd.z);
      alive.set(crowd.alive);
      const bossZ = boss.z;
      run.setTargetX(0);
      run.tick(DT);
      for (let i = 0; i < crowd.capacity; i++) {
        if ((alive[i] ?? 0) === 0 || (crowd.alive[i] ?? 0) !== 0) continue;
        dead++;
        // Across: inside the footprint, give or take the step's own shove.
        furthest = Math.max(furthest, Math.abs((x[i] ?? 0) - boss.x));
        // Along: no further ahead of the body than its reach, and no further
        // behind it than where it now stands, less the same reach.
        expect(z[i] ?? 0).toBeLessThanOrEqual(bossZ + charge.hitReach + 1e-6);
        expect(z[i] ?? 0).toBeGreaterThanOrEqual(boss.z - charge.hitReach - 0.2);
      }
    }
    expect(dead).toBeGreaterThan(0);
    expect(furthest).toBeLessThanOrEqual(charge.hitHalfWidth + 0.2);
  });

  it('runs past a column that left its lane before it arrived', () => {
    const tuning = chargeOnly();
    const laneWidth = tuning.road.laneWidth;
    const human = tuning.bots.human;
    // A decent thumb (D45): it sees the tell a quarter of a second late and
    // swipes one lane over at the human bot's own speed, into the next lane,
    // which is the nearest the body's footprint comes to anyone left alive.
    for (const [from, to] of [
      [-laneWidth, 0],
      [0, laneWidth],
      [laneWidth, 0],
    ] as const) {
      const run = arena('rime', tuning);
      atContact(run, tuning, from);
      const before = run.state.squad.count;
      const events = oneCharge(run, tuning, {
        from,
        to,
        reaction: human.reactionSteps,
        swipe: human.swipeSpeed,
      });
      const lane = charges(events)[0]?.lane;
      expect(`${String(from)}>${String(to)} lane ${String(lane)}`).toBe(
        `${String(from)}>${String(to)} lane ${String(from / laneWidth)}`,
      );
      expect(`${String(from)}>${String(to)} lost ${String(lostTo(events, 'charge'))}`).toBe(
        `${String(from)}>${String(to)} lost 0`,
      );
      expect(events.some((event) => event.type === 'chargeHit')).toBe(false);
      expect(run.state.squad.count).toBe(before);
    }
  });

  it('still lands on a thumb that moves too late', () => {
    // The same swipe, started once the body is already on its way: the tell
    // is only worth something if it is answered while it is a tell.
    const tuning = chargeOnly();
    const run = arena('rime', tuning);
    atContact(run, tuning, -2);
    const late = Math.round(tuning.enemies.boss.rime.charge.windup / DT) + 1;
    const events = oneCharge(run, tuning, { from: -2, to: 0, reaction: late, swipe: 6 });
    expect(lostTo(events, 'charge')).toBeGreaterThan(0);
  });

  it('replays a charge fight step for step, dodges and all', () => {
    const tuning = chargeOnly();
    tuning.squad.damage = testBalance().squad.damage;
    const fight = (): { state: string; events: string[] } => {
      const run = arena('rime', tuning, 60_000);
      const events: string[] = [];
      for (let step = 0; step < 60 * 45; step++) {
        // A thumb that crosses the road every few seconds, so some charges
        // land and some do not.
        const x = [-2, 0, 2, 0][Math.floor(step / 170) % 4] ?? 0;
        run.setTargetX(x);
        for (const event of run.tick(DT)) {
          if (event.type === 'unitsLost' || event.type === 'chargeHit' || event.type === 'charge') {
            events.push(`${String(step)}:${JSON.stringify(event)}`);
          }
        }
      }
      return { state: JSON.stringify(run.state), events };
    };
    const a = fight();
    const b = fight();
    expect(a.events.some((e) => e.includes('chargeHit'))).toBe(true);
    expect(b.events).toEqual(a.events);
    expect(b.state).toBe(a.state);
  });

  it('respects the interval between one charge and the next', () => {
    const tuning = testBalance();
    tuning.squad.damage = 0;
    const run = arena('rime', tuning);
    const interval = tuning.enemies.boss.rime.charge.interval;

    const times: number[] = [];
    for (let i = 0; i < 60 * 60; i++) {
      run.setTargetX(0);
      for (const event of run.tick(DT)) {
        if (event.type === 'charge') times.push(run.state.time);
      }
    }
    expect(times.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < times.length; i++) {
      const gap = (times[i] ?? 0) - (times[i - 1] ?? 0);
      // The clock starts again when the charge *ends*, so the gap is the
      // interval plus however long the wind-up, the run out and back took.
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
    expect(events.some((event) => event.type === 'chargeHit')).toBe(false);
    expect(lostTo(events, 'charge')).toBe(0);
    expect(run.state.boss?.variant).toBe('demon');
    expect(run.state.boss?.charge).toBeUndefined();
    // It still walks the squad down and stops at contact, as it always has.
    expect(run.state.boss?.z ?? 0).toBeCloseTo(
      run.state.squad.z + tuning.enemies.contactDistance,
      3,
    );
  });
});
