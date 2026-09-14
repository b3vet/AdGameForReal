/**
 * The two Frostfell kinds (D49): the charger and the shielded brute.
 *
 * Both are tested on hand-made levels rather than generated ones, because what
 * is being checked is a *rule* — a charger waits, picks a lane, runs it, shoves
 * and takes a bite; a shield halves what a hit is worth and breaks once — and a
 * generated level is a place those rules happen to meet, not a statement of
 * them. The levels 21 to 40 that stand them are `./frost.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { chargeLane, chargerKills } from '../chargers';
import { level, play, row, runOf, testBalance } from './fixtures';
import { hitShield, shieldFor } from '../shields';
import { CROWD_SHOVED } from '../types';
import type { EnemyState, SimEvent } from '../types';
import { balance } from '@/data';

/** A balance whose squad cannot shoot, so a body's own behaviour is visible. */
function harmless() {
  const tuning = testBalance();
  tuning.squad.damage = 0;
  return tuning;
}

function chargerOf(enemies: readonly EnemyState[]): EnemyState {
  const found = enemies.find((enemy) => enemy.kind === 'charger');
  // Every level in this file stands exactly one, and a missing one is the
  // failure the test is about.
  expect(found).toBeDefined();
  return found as EnemyState;
}

function lost(events: readonly SimEvent[]): number {
  let total = 0;
  for (const event of events) if (event.type === 'unitsLost') total += event.amount;
  return total;
}

describe('the charger', () => {
  it('stands still until the column is inside its trigger range', () => {
    const tuning = harmless();
    const trigger = tuning.enemies.charger.triggerRange;
    // Far enough that the squad needs a couple of seconds to reach the trigger.
    const run = runOf(level({ startCount: 60, rows: [row(40, [null, null, null], [{ kind: 'charger', lane: 0, units: 6 }])] }), tuning);

    const charger = chargerOf(run.state.enemies);
    const before = play(run, 1, 0);
    expect(charger.z).toBe(40);
    expect(charger.active).toBe(false);
    expect(charger.charge).toBeUndefined();
    expect(before.some((event) => event.type === 'charge')).toBe(false);

    // Walk on until the gap closes to the trigger, then it is away.
    const after = play(run, 3, 0);
    expect(charger.z - run.state.squad.z).toBeLessThanOrEqual(trigger);
    expect(charger.active).toBe(true);
    const started = after.filter((event) => event.type === 'charge');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ kind: 'charger', lane: 0 });
    expect(charger.charge?.lane).toBe(0);
  });

  it('runs at its own speed, far above anything else on the road', () => {
    const tuning = harmless();
    const run = runOf(level({ startCount: 60, rows: [row(40, [null, null, null], [{ kind: 'charger', lane: 0, units: 6 }])] }), tuning);
    const charger = chargerOf(run.state.enemies);

    play(run, 4, 0);
    const z = charger.z;
    play(run, 0.5, 0);
    const speed = (z - charger.z) / 0.5;
    expect(speed).toBeCloseTo(tuning.enemies.charger.speed, 3);
    expect(speed).toBeGreaterThan(tuning.enemies.grunt.speed * 2);
  });

  it('picks the column\'s lane, but only within its own reach', () => {
    // `lanePick` is the whole mechanic: one lane over and it comes at you, two
    // lanes over and it is a lane to steer out of.
    const tuning = testBalance();
    tuning.enemies.charger.lanePick = 1;
    const laneWidth = tuning.road.laneWidth;
    expect(chargeLane(-laneWidth, -laneWidth, tuning)).toBe(-1);
    expect(chargeLane(-laneWidth, 0, tuning)).toBe(0);
    expect(chargeLane(-laneWidth, laneWidth, tuning)).toBe(0);
    tuning.enemies.charger.lanePick = 0;
    expect(chargeLane(-laneWidth, laneWidth, tuning)).toBe(-1);
  });

  it('shoves the column it runs into', () => {
    const tuning = harmless();
    const run = runOf(level({ startCount: 120, rows: [row(40, [null, null, null], [{ kind: 'charger', lane: 0, units: 6 }])] }), tuning);
    const crowd = run.state.crowd;
    expect(crowd).toBeDefined();

    // Watched step by step rather than sampled at the end: the flags are one
    // step's news (`crowdForces.ts`), and by the time the charger has met the
    // crowd it is dead and nothing is pushing anybody.
    let most = 0;
    for (let step = 0; step < 60 * 5; step++) {
      run.setTargetX(0);
      run.tick(1 / 60);
      let shoved = 0;
      for (let i = 0; i < (crowd?.capacity ?? 0); i++) {
        if (((crowd?.flags[i] ?? 0) & CROWD_SHOVED) !== 0) shoved++;
      }
      if (shoved > most) most = shoved;
    }
    expect(most).toBeGreaterThan(0);
  });

  it('takes its bite of the crowd on contact and dies doing it', () => {
    const tuning = harmless();
    const run = runOf(level({ startCount: 120, rows: [row(40, [null, null, null], [{ kind: 'charger', lane: 0, units: 6 }])] }), tuning);
    const charger = chargerOf(run.state.enemies);

    const before = run.state.squad.count;
    const events = play(run, 6, 0);
    expect(charger.alive).toBe(false);
    const killed = events.filter((event) => event.type === 'enemyKilled' && event.kind === 'charger');
    expect(killed).toHaveLength(1);
    // The bite is a floor or a share of whoever was standing there, and it is
    // the charger's own number rather than a share of its printed units.
    expect(before - run.state.squad.count).toBe(chargerKills(before, tuning));
  });

  it('costs nothing at all when it is shot down first', () => {
    // The other half of the mechanic: a charger in the lane the squad's fire is
    // already in is something to kill, not something to dodge.
    const run = runOf(
      level({ startCount: 200, rows: [row(40, [null, null, null], [{ kind: 'charger', lane: 0, units: 1 }])] }),
    );
    const charger = chargerOf(run.state.enemies);
    const events = play(run, 6, 0);
    expect(charger.alive).toBe(false);
    expect(lost(events)).toBe(0);
    expect(run.state.squad.count).toBe(200);
  });
});

describe('the shielded brute', () => {
  it('is a brute with a shield sized from its own body', () => {
    const run = runOf(
      level({ startCount: 1, rows: [row(400, [null, null, null], [{ kind: 'shieldBrute', lane: 0, units: 10 }])] }),
    );
    const brute = run.state.enemies[0];
    expect(brute?.kind).toBe('shieldBrute');
    // A shielded brute reads `enemies.brute`: same hit points per unit, same
    // speed, same footprint. Only the shield is new.
    expect(brute?.hp).toBe(10 * balance.enemies.brute.hpPerUnit);
    expect(brute?.speed).toBe(balance.enemies.brute.speed);
    expect(brute?.shield).toBe(shieldFor(brute?.hp ?? 0, balance));
    expect(brute?.units).toBe(10);
  });

  it('takes a hit at the shield\'s rate and leaves the body alone', () => {
    const tuning = testBalance();
    const enemy = { hp: 100, shield: 60 } as EnemyState;
    const hit = hitShield(enemy, 40, tuning);
    expect(hit.toBody).toBe(0);
    expect(hit.broke).toBe(false);
    // Half rate as shipped: 40 of damage is 20 off the shield.
    expect(enemy.shield).toBe(60 - 40 * tuning.enemies.shield.damageMul);
    expect(enemy.hp).toBe(100);
  });

  it('breaks once, and lets everything through afterwards', () => {
    const tuning = testBalance();
    const enemy = { hp: 100, shield: 10 } as EnemyState;
    expect(hitShield(enemy, 1000, tuning).broke).toBe(true);
    expect(enemy.shield).toBe(0);
    // The breaking hit's overflow is absorbed: a shield is a wall of time, and
    // one volley that broke it and killed the body would make the kind a
    // rounding error. The next hit is the first one that hurts.
    expect(enemy.hp).toBe(100);
    const after = hitShield(enemy, 30, tuning);
    expect(after.broke).toBe(false);
    expect(after.toBody).toBe(30);
  });

  it('holds its number up until the shield breaks, and breaks exactly once', () => {
    const units = 40;
    const make = (kind: 'brute' | 'shieldBrute') =>
      runOf(level({ startCount: 300, rows: [row(120, [null, null, null], [{ kind, lane: 0, units }])] }));

    /** Seconds to the body's death, and what its label read when it broke. */
    function fight(kind: 'brute' | 'shieldBrute'): { died: number; breaks: number; unitsAtBreak: number } {
      const run = make(kind);
      const enemy = run.state.enemies[0];
      let died = Infinity;
      let breaks = 0;
      let unitsAtBreak = -1;
      for (let step = 0; step < 60 * 30; step++) {
        run.setTargetX(0);
        for (const event of run.tick(1 / 60)) {
          if (event.type === 'shieldBreak') {
            breaks++;
            unitsAtBreak = enemy?.units ?? -1;
          }
        }
        if (died === Infinity && enemy?.alive === false) died = step / 60;
      }
      return { died, breaks, unitsAtBreak };
    }

    const plain = fight('brute');
    const shielded = fight('shieldBrute');

    expect(plain.breaks).toBe(0);
    expect(shielded.breaks).toBe(1);
    // The whole of the kind: the number on the block does not move until the
    // shield is gone, and the shield costs the squad seconds it did not have
    // to spend on a plain brute of the same size.
    expect(shielded.unitsAtBreak).toBe(units);
    expect(shielded.died).toBeGreaterThan(plain.died);
    expect(plain.died).toBeLessThan(Infinity);
    expect(shielded.died).toBeLessThan(Infinity);
  });
});
