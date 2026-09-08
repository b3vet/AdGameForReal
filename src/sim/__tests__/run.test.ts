import { describe, expect, it } from 'vitest';

import { halfWidth } from '../formation';
import type { GateDef } from '../types';
import { level, play, row, runOf, testBalance } from './fixtures';

describe('enemies', () => {
  it('activates a block once the squad is close enough, then walks it in', () => {
    const def = level({
      startCount: 4,
      rows: [row(40, [null, null, null], [{ kind: 'brute', lane: 0, units: 40 }])],
    });
    const run = runOf(def);
    const before = run.state.enemies[0];
    expect(before?.active).toBe(false);

    const events = play(run, 3, 0);
    expect(events.some((e) => e.type === 'enemyActivated')).toBe(true);
    const enemy = run.state.enemies[0];
    expect(enemy?.active).toBe(true);
    expect(enemy?.z).toBeLessThan(40);
  });

  it('eats the squad on contact and takes its remaining units with it', () => {
    const def = level({
      startCount: 60,
      rows: [row(4, [null, null, null], [{ kind: 'brute', lane: 0, units: 30 }])],
    });
    const run = runOf(def);
    const events = play(run, 2, 0);

    const lost = events.find((e) => e.type === 'unitsLost' && e.reason === 'contact');
    expect(lost?.type).toBe('unitsLost');
    if (lost?.type !== 'unitsLost') throw new Error('no contact loss');
    expect(lost.amount).toBeGreaterThan(0);
    expect(run.state.squad.count).toBe(60 - lost.amount);
    expect(run.state.enemies[0]?.alive).toBe(false);
    expect(events.some((e) => e.type === 'enemyKilled')).toBe(true);
  });

  it('shrinks a block as it takes damage and kills it at zero hp', () => {
    const def = level({
      startCount: 60,
      rows: [row(30, [null, null, null], [{ kind: 'brute', lane: 0, units: 4 }])],
    });
    const run = runOf(def);
    const events = play(run, 4, 0);

    const hits = events.filter((e) => e.type === 'enemyHit');
    expect(hits.length).toBeGreaterThan(1);
    // Units track remaining hp, so the label counts down as the block is shot.
    const shrinking = hits.map((e) => (e.type === 'enemyHit' ? e.hp : 0));
    expect(shrinking[shrinking.length - 1]).toBe(0);
    expect(run.state.enemies[0]?.alive).toBe(false);
    expect(events.some((e) => e.type === 'enemyKilled' && e.kind === 'brute')).toBe(true);
    // It died to fire, not by walking into the squad.
    expect(events.some((e) => e.type === 'unitsLost')).toBe(false);
  });

  it('lets a block that misses the squad walk past instead of hitting it', () => {
    const def = level({
      startCount: 6,
      rows: [row(20, [null, null, null], [{ kind: 'brute', lane: -1, units: 60 }])],
    });
    const run = runOf(def);
    const events = play(run, 5, 2.6);

    expect(events.some((e) => e.type === 'unitsLost')).toBe(false);
    expect(run.state.squad.count).toBe(6);
  });
});

describe('boss', () => {
  it('waits for the arena, then stomps the squad while it fights', () => {
    const def = level({ startCount: 200, rows: [], arenaZ: 10, boss: { hp: 4_000_000, units: 400_000 } });
    const run = runOf(def);

    const early = play(run, 1, 0);
    expect(early.some((e) => e.type === 'bossActivated')).toBe(false);
    expect(run.state.boss?.active).toBe(false);

    const events = play(run, 20, 0);
    expect(events.some((e) => e.type === 'bossActivated')).toBe(true);
    expect(run.state.squad.z).toBe(10);

    const stomps = events.filter((e) => e.type === 'bossStomp');
    expect(stomps.length).toBeGreaterThan(0);
    const balance = testBalance();
    expect(
      events.some((e) => e.type === 'unitsLost' && e.reason === 'stomp' && e.amount === balance.enemies.boss.stompKills),
    ).toBe(true);
  });

  it('tracks the squad sideways without leaving the road', () => {
    const def = level({ startCount: 50, rows: [], arenaZ: 4, boss: { hp: 4_000_000, units: 400_000 } });
    const balance = testBalance();
    const run = runOf(def, balance);
    play(run, 12, 2.6);

    const boss = run.state.boss;
    expect(boss?.x).toBeGreaterThan(0);
    expect(Math.abs(boss?.x ?? 0)).toBeLessThanOrEqual(balance.road.halfWidth - balance.enemies.boss.footprint + 1e-9);
  });

  it('ends the run as a win when the boss dies, and reports survivors', () => {
    const def = level({ startCount: 100, rows: [], arenaZ: 4, boss: { hp: 300, units: 30 } });
    const run = runOf(def);
    const events = play(run, 12, 0);

    expect(run.state.status).toBe('won');
    expect(events.some((e) => e.type === 'bossKilled')).toBe(true);
    const ended = events.find((e) => e.type === 'runEnded');
    if (ended?.type !== 'runEnded') throw new Error('run did not end');
    expect(ended.status).toBe('won');
    expect(ended.survivors).toBe(run.state.squad.count);
    expect(run.state.survivors).toBeGreaterThan(0);
  });

  it('grinds the squad down on contact and loses the run', () => {
    const def = level({ startCount: 60, rows: [], arenaZ: 4, boss: { hp: 4_000_000, units: 400_000 } });
    const run = runOf(def);
    const events = play(run, 60, 0);

    expect(run.state.status).toBe('lost');
    expect(run.state.survivors).toBe(0);
    expect(events.some((e) => e.type === 'unitsLost' && e.reason === 'stomp')).toBe(true);
    expect(events.some((e) => e.type === 'unitsLost' && e.reason === 'contact')).toBe(true);
    expect(events.filter((e) => e.type === 'runEnded')).toHaveLength(1);
  });
});

describe('projectiles', () => {
  it('fires from the formation, so a wide squad hits gates in several lanes', () => {
    const def = level({
      startCount: 120,
      rows: [
        row(24, [
          { kind: 'add', value: 3 },
          { kind: 'add', value: 3 },
          { kind: 'add', value: 3 },
        ]),
      ],
    });
    const run = runOf(def);
    play(run, 3, 0);

    const hitLanes = run.state.gates.filter((g) => g.hits > 0).map((g) => g.lane);
    expect(hitLanes.length).toBeGreaterThan(1);
  });

  it('never keeps more projectiles alive than the pool allows', () => {
    const balance = testBalance();
    balance.projectiles.max = 24;
    const def = level({ startCount: 300, rows: [] });
    const run = runOf(def, balance);

    for (let i = 0; i < 300; i++) {
      run.tick(1 / 60);
      expect(run.state.projectiles.length).toBeLessThanOrEqual(24);
    }
  });

  it('keeps firing above the cap by batching shots into hitscan', () => {
    const balance = testBalance();
    balance.projectiles.max = 8;
    const def = level({
      startCount: 200,
      rows: [row(20, [null, { kind: 'add', value: 3 }, null])],
    });
    const run = runOf(def, balance);
    const events = play(run, 1, 0);

    // One `projectileFired` per batch, so render still has something to draw.
    expect(events.filter((e) => e.type === 'projectileFired').length).toBeGreaterThan(8);
    const gate = run.state.gates[0];
    expect(gate?.hits).toBeGreaterThan(8);
  });

  it('cannot tunnel through a gate, however fast the shot is', () => {
    const balance = testBalance();
    balance.projectiles.speed = 6000;
    const def = level({ startCount: 5, rows: [row(20, [null, { kind: 'add', value: 3 }, null])] });
    const run = runOf(def, balance);
    const events = play(run, 1, 0);

    expect(events.some((e) => e.type === 'gateHit')).toBe(true);
    expect(run.state.gates[0]?.hits).toBeGreaterThan(0);
  });
});

describe('lifecycle', () => {
  it('moves the squad toward the target without leaving the road', () => {
    const balance = testBalance();
    // One unit: the crowd has no width to speak of, so the plan's flat clamp
    // is what limits it.
    const run = runOf(level({ startCount: 1, rows: [] }), balance);
    run.setTargetX(99);
    play(run, 2);
    expect(run.state.squad.x).toBeCloseTo(balance.road.clampX, 6);

    run.setTargetX(-99);
    play(run, 2);
    expect(run.state.squad.x).toBeCloseTo(-balance.road.clampX, 6);
  });

  it('keeps a growing crowd on the road by tapering its clamp', () => {
    const balance = testBalance();
    for (const count of [1, 10, 40, 80]) {
      const run = runOf(level({ startCount: count, rows: [] }), balance);
      run.setTargetX(99);
      play(run, 2);

      const x = run.state.squad.x;
      // Above the taper's floor the rule is exact: the outermost unit stands on
      // the road's edge, not past it.
      expect(x).toBeLessThanOrEqual(balance.road.clampX + 1e-9);
      expect(x + halfWidth(count)).toBeLessThanOrEqual(balance.road.halfWidth + 1e-9);
    }
  });

  it('never clamps the squad tighter than the side lanes', () => {
    const balance = testBalance();
    // A crowd of 500 is wider than the road can hold, so the taper bottoms out
    // on its floor instead of pinning the squad to the middle lane: reaching a
    // side gate matters more than the last few centimetres of overhang.
    const run = runOf(level({ startCount: balance.squad.maxCount, rows: [] }), balance);
    run.setTargetX(99);
    play(run, 2);

    expect(run.state.squad.x).toBeCloseTo(balance.road.clampMin, 6);
    expect(balance.road.clampMin).toBeLessThanOrEqual(balance.road.laneWidth);
    const overhang =
      balance.road.clampMin + halfWidth(balance.squad.maxCount) - balance.road.halfWidth;
    expect(overhang).toBeLessThan(0.4);
  });

  it('lets even the widest squad take a gate in either side lane', () => {
    const balance = testBalance();
    for (const [lane, targetX] of [
      [0, -99],
      [2, 99],
    ] as const) {
      const gates: [GateDef | null, GateDef | null, GateDef | null] = [null, null, null];
      gates[lane] = { kind: 'add', value: 7 };
      const def = level({ startCount: 400, rows: [row(30, gates)] });
      const run = runOf(def, balance);
      const events = play(run, 8, targetX);
      const passed = events.find((e) => e.type === 'gatePassed');
      // The floor sits on the lane boundary, and the boundary belongs to the
      // side lane on both sides of the road — not just the right-hand one.
      expect(passed?.type).toBe('gatePassed');
    }
  });

  it('pulls a squad that just grew back off the verge', () => {
    const balance = testBalance();
    const def = level({
      startCount: 4,
      rows: [row(20, [null, null, { kind: 'mul', value: 60 }])],
    });
    const run = runOf(def, balance);
    play(run, 3, 99);
    const before = run.state.squad.x;
    play(run, 2, 99);

    // The clamp follows the count, not only the player's finger: a squad that
    // multiplied at the road's edge is walked back in on the next step.
    expect(run.state.squad.count).toBeGreaterThan(200);
    expect(run.state.squad.x).toBeLessThan(before);
    expect(run.state.squad.x).toBeCloseTo(balance.road.clampMin, 6);
  });

  it('makes runEnded the last event of its tick', () => {
    // The run used to keep firing after the boss died, so the frame that ended
    // the run handed the UI events from a run that was already over.
    const def = level({ startCount: 100, rows: [], arenaZ: 4, boss: { hp: 300, units: 30 } });
    const run = runOf(def);

    for (let i = 0; i < 12 * 60; i++) {
      const events = run.tick(1 / 60);
      const endIndex = events.findIndex((e) => e.type === 'runEnded');
      if (endIndex < 0) continue;
      expect(endIndex).toBe(events.length - 1);
      return;
    }
    throw new Error('the run never ended');
  });

  it('reports the peak the squad reached, even if it lost it the same step', () => {
    // Two rows a hair apart: the squad walks a +400 gate and a wipe in one step.
    const def = level({
      startCount: 10,
      rows: [
        row(20, [null, { kind: 'add', value: 400 }, null]),
        row(20.001, [null, { kind: 'sub', value: 100_000 }, null]),
      ],
    });
    const run = runOf(def);
    const events = play(run, 6, 0);

    const ended = events.find((e) => e.type === 'runEnded');
    if (ended?.type !== 'runEnded') throw new Error('the run never ended');
    expect(run.state.status).toBe('lost');
    // 10 + the gate's own 400, plus whatever the squad shot into it on the way.
    expect(run.state.peakCount).toBeGreaterThanOrEqual(410);
    expect(ended.peakCount).toBe(run.state.peakCount);
  });

  it('is a no-op once the run is over', () => {
    const def = level({ startCount: 5, rows: [row(2, [null, { kind: 'sub', value: 1000 }, null])] });
    const run = runOf(def);
    play(run, 2, 0);
    expect(run.state.status).toBe('lost');

    const snapshot = JSON.stringify(run.state);
    const events = run.tick(1 / 60);
    expect(events).toHaveLength(0);
    expect(JSON.stringify(run.state)).toBe(snapshot);
  });

  it('runs at a fixed step: one big tick matches many small ones', () => {
    const rows = [row(20, [null, { kind: 'add', value: 4 }, null])];
    const a = runOf(level({ startCount: 12, rows }));
    const b = runOf(level({ startCount: 12, rows }));

    for (let i = 0; i < 8; i++) a.tick(1 / 60);
    b.tick(8 / 60);

    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });
});
