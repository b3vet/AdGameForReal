/**
 * Staff evolutions and the wisp (D33): the second tier of each staff, and the
 * familiar that fights beside the squad.
 */

import { describe, expect, it } from 'vitest';

import { Burn } from '../burn';
import { EventBuffer } from '../events';
import { progression } from '../player';
import { Run } from '../Run';
import type { EnemyState, RunState, SimEvent } from '../types';
import { level, play, row, runOf, staffRow, testBalance, withFamiliar, withStaff } from './fixtures';
import type { RowEnemyDef } from '../level';
import { balance } from '@/data';
import type { FamiliarTier } from '@/data/types';

const BURN = progression.evolutions.ember.burn ?? { share: 0.3, seconds: 2, tickSeconds: 0.25 };
const SHATTER = progression.evolutions.frost.shatter ?? { radius: 1, share: 0.5 };
const WISP = progression.wisp;

function body(id: number, x: number, z: number, hp: number): EnemyState {
  return {
    id,
    kind: 'grunt',
    x,
    z,
    hp,
    maxHp: hp,
    units: 1,
    speed: 0,
    active: true,
    alive: true,
    slowUntil: 0,
    diedAt: 0,
  };
}

function damageTaken(run: Run, id: number): number {
  const enemy = run.state.enemies.find((e) => e.id === id);
  return enemy === undefined ? 0 : enemy.maxHp - enemy.hp;
}

describe('ember burn (tier 2)', () => {
  it('spends 30 percent of the hit over two seconds, a tick every quarter second', () => {
    const events = new EventBuffer();
    const hits: number[] = [];
    const burn = new Burn(BURN, events, (_state, _enemy, amount) => hits.push(amount));
    const enemy = body(1, 0, 10, 1e9);
    const state = { time: 0, status: 'running' } as RunState;

    burn.ignite(enemy, 100, 0);
    for (let step = 1; step <= 60 * 4; step++) {
      state.time = step / 60;
      burn.update(state);
    }

    expect(hits).toHaveLength(Math.round(BURN.seconds / BURN.tickSeconds));
    const total = hits.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(100 * BURN.share, 6);
  });

  it('refreshes rather than stacks, and takes the hotter of the two burns', () => {
    const events = new EventBuffer();
    const hits: number[] = [];
    const burn = new Burn(BURN, events, (_state, _enemy, amount) => hits.push(amount));
    const enemy = body(1, 0, 10, 1e9);
    const state = { time: 0, status: 'running' } as RunState;
    const ticks = Math.round(BURN.seconds / BURN.tickSeconds);

    burn.ignite(enemy, 100, 0);
    for (let step = 1; step <= 60 * 6; step++) {
      state.time = step / 60;
      // Set alight again and again: the burn must not become eight burns.
      if (step % 20 === 0 && state.time < 2) burn.ignite(enemy, 40, state.time);
      burn.update(state);
    }

    // Refreshed twice inside its own two seconds, so it burns longer than one
    // burn would — but never more than one tick at a time, at the hotter rate.
    const perTick = (100 * BURN.share) / ticks;
    for (const hit of hits) expect(hit).toBeCloseTo(perTick, 6);
    expect(hits.length).toBeGreaterThan(ticks);
    expect(hits.length).toBeLessThanOrEqual(ticks * 2);
  });

  it('burns a block the squad is shooting, and says so once per fire', () => {
    const rows = [row(30, [null, null, null], [{ kind: 'brute', lane: 0, units: 600 }])];
    const plain = runOf(level({ startCount: 20, rows }));
    const evolved = new Run(level({ startCount: 20, rows }), testBalance(), withStaff('ember', 2));

    play(plain, 2.5, 0);
    const events = play(evolved, 2.5, 0);

    expect(damageTaken(evolved, 0)).toBeGreaterThan(damageTaken(plain, 0));
    const lit = events.filter((e) => e.type === 'enemyBurning');
    expect(lit.length).toBeGreaterThan(0);
    // One announcement per body while it stays alight, not one per shot.
    expect(lit.length).toBeLessThan(events.filter((e) => e.type === 'projectileHit').length);
  });
});

describe('storm chain (tier 2)', () => {
  it('reaches one target further than the staff at tier one', () => {
    // Four blocks a hop and a half apart, all inside activation range so they
    // walk in step and the gaps stay put: the arc takes two of them at tier 1
    // and three at tier 2.
    const blocks: RowEnemyDef[] = [{ kind: 'grunt', lane: 0, units: 200 }];
    const rows = [
      row(20, [null, null, null], blocks),
      row(21.5, [null, null, null], [{ kind: 'grunt', lane: 1, units: 200 }]),
      row(23, [null, null, null], [{ kind: 'grunt', lane: 1, units: 200 }]),
      row(24.5, [null, null, null], [{ kind: 'grunt', lane: 1, units: 200 }]),
    ];
    const plain = new Run(level({ startCount: 3, rows }), testBalance(), withStaff('storm', 1));
    const evolved = new Run(level({ startCount: 3, rows }), testBalance(), withStaff('storm', 2));
    play(plain, 1.4, 0);
    play(evolved, 1.4, 0);

    expect(damageTaken(plain, 3)).toBe(0);
    expect(damageTaken(evolved, 3)).toBeGreaterThan(0);
    expect(damageTaken(evolved, 1)).toBeGreaterThan(0);
  });
});

describe('frost shatter (tier 2)', () => {
  it('takes the neighbours with it when a frozen body comes apart', () => {
    // A body that dies frozen, with a fat block half a metre off its shoulder:
    // near enough for the shatter, far enough that no shot of its own lands.
    const rows = [
      staffRow(1, 'frost'),
      row(24, [null, null, null], [
        { kind: 'grunt', lane: 0, units: 2 },
        { kind: 'grunt', lane: 1, units: 400, dz: 0.5 },
      ]),
    ];
    const plain = new Run(level({ startCount: 30, rows }), testBalance(), withStaff('frost', 1));
    const evolved = new Run(level({ startCount: 30, rows }), testBalance(), withStaff('frost', 2));
    const plainEvents = play(plain, 2, 0);
    const evolvedEvents = play(evolved, 2, 0);

    const shattered = (events: SimEvent[]): boolean => events.some((e) => e.type === 'enemyShattered');
    expect(shattered(plainEvents)).toBe(true);
    expect(shattered(evolvedEvents)).toBe(true);
    // The fat block standing next to the one that shattered takes the spray.
    expect(damageTaken(evolved, 2)).toBeGreaterThan(damageTaken(plain, 2));
    expect(SHATTER.share).toBeGreaterThan(0);
  });
});

describe('the wisp', () => {
  /** A run where only the wisp shoots, against one body that does not move. */
  function wispRun(tier: FamiliarTier): Run {
    const tuning = testBalance();
    tuning.squad.fireRate = 0;
    tuning.enemies.grunt.speed = 0;
    // The squad stands still and so does the body: what lands on it is the
    // wisp's own fire and nothing else.
    const def = level({
      startCount: 4,
      runSpeed: 0,
      rows: [row(20, [null, null, null], [{ kind: 'grunt', lane: 0, units: 40_000 }])],
    });
    return new Run(def, tuning, withFamiliar(tier));
  }

  it('hovers beside the squad at the offset the Sanctum built it with', () => {
    const run = wispRun(1);
    play(run, 0.5, 0);
    const wisp = run.state.familiar;
    const squad = run.state.squad;
    if (wisp === null || wisp === undefined) throw new Error('no wisp');
    expect(wisp.x).toBeCloseTo(squad.x + WISP.offsetX * wisp.side, 9);
    expect(wisp.z).toBeCloseTo(squad.z + WISP.offsetZ, 9);
    expect(wisp.side).toBe(1);
  });

  it('stays over the road when the squad hugs the right-hand edge', () => {
    const run = wispRun(1);
    play(run, 2, 99);
    const wisp = run.state.familiar;
    if (wisp === null || wisp === undefined) throw new Error('no wisp');
    expect(Math.abs(wisp.x)).toBeLessThanOrEqual(balance.road.halfWidth);
    expect(wisp.side).toBe(-1);
  });

  it('fires at the nearest body and lands the spark after its flight', () => {
    const run = wispRun(1);
    let shotAt = -1;
    let hitAt = -1;
    let shotDistance = 0;
    let damage = 0;

    for (let step = 1; step <= 60 * 3; step++) {
      for (const event of run.tick(1 / 60)) {
        if (event.type === 'familiarShot' && shotAt < 0) {
          shotAt = step;
          expect(event.targetId).toBe(0);
          const target = run.state.enemies[0];
          shotDistance = Math.hypot((target?.x ?? 0) - event.x, (target?.z ?? 0) - event.z);
        }
        if (event.type === 'enemyHit' && hitAt < 0 && shotAt > 0) {
          hitAt = step;
          damage = event.damage;
        }
      }
      // Nothing lands before the spark gets there.
      if (shotAt > 0 && hitAt < 0) expect(damageTaken(run, 0)).toBe(0);
    }

    expect(shotAt).toBeGreaterThan(0);
    expect(hitAt).toBeGreaterThan(shotAt);
    const flight = (hitAt - shotAt) / 60;
    expect(flight).toBeCloseTo(shotDistance / WISP.sparkSpeed, 1);
    expect(damage).toBeCloseTo(WISP.damage[1] ?? 0, 6);
  });

  it('fires faster and harder at every tier', () => {
    const damageAt = (tier: FamiliarTier): number => {
      const run = wispRun(tier);
      play(run, 6, 0);
      return damageTaken(run, 0);
    };
    const one = damageAt(1);
    const two = damageAt(2);
    const three = damageAt(3);
    expect(one).toBeGreaterThan(0);
    expect(two).toBeGreaterThan(one);
    expect(three).toBeGreaterThan(two);
    // And a run without one lands nothing at all, since the squad cannot fire.
    const none = new Run(
      level({
        startCount: 4,
        runSpeed: 0,
        rows: [row(20, [null, null, null], [{ kind: 'grunt', lane: 0, units: 40_000 }])],
      }),
      (() => {
        const tuning = testBalance();
        tuning.squad.fireRate = 0;
        tuning.enemies.grunt.speed = 0;
        return tuning;
      })(),
    );
    play(none, 6, 0);
    expect(damageTaken(none, 0)).toBe(0);
  });
});
