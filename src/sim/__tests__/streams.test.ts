import { describe, expect, it } from 'vitest';

import { level, play, runOf, testBalance } from './fixtures';
import type { RowDef } from '../level';
import { Run } from '../Run';
import type { EnemyState, SimEvent, StreamDef } from '../types';
import { balance } from '@/data';
import type { Balance } from '@/data/types';

function stream(overrides: Partial<StreamDef> = {}): StreamDef {
  return {
    lane: 0,
    kind: 'grunt',
    count: 40,
    durationSeconds: 8,
    hpPerEnemy: 1,
    speed: balance.streams.speed,
    jitter: balance.streams.jitter,
    ...overrides,
  };
}

function streamRow(z: number, streams: StreamDef[]): RowDef {
  return { z, gates: [null, null, null], enemies: [], streams };
}

/** A run whose only content is one stream, with the squad frozen at `count`. */
function streamRun(defs: StreamDef[], count: number, balanceOverride?: Balance): Run {
  return runOf(
    level({ startCount: count, rows: [streamRow(30, defs)], arenaZ: 100_000 }),
    balanceOverride,
  );
}

function liveBodies(run: Run): EnemyState[] {
  return run.state.enemies.filter((e) => e.alive && e.streamId !== undefined);
}

describe('streams', () => {
  it('spawns over the stream\'s duration rather than all at once', () => {
    // Bodies nothing can kill, and a squad big enough to survive all of them
    // walking in: what is on the road is exactly what the schedule released.
    const run = streamRun([stream({ count: 60, durationSeconds: 10, hpPerEnemy: 1e6 })], 200);
    play(run, 1, 0);
    const early = run.state.streams[0]?.spawned ?? 0;
    play(run, 5, 0);
    const middle = run.state.streams[0]?.spawned ?? 0;
    play(run, 8, 0);
    const late = run.state.streams[0]?.spawned ?? 0;

    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(15);
    expect(middle).toBeGreaterThan(early);
    expect(late).toBe(60);
  });

  it('spawns ahead of the squad, in its lane, with seeded scatter', () => {
    const run = streamRun([stream({ lane: 1, count: 40, hpPerEnemy: 1e6 })], 1);
    play(run, 3, 0);

    const bodies = liveBodies(run);
    expect(bodies.length).toBeGreaterThan(2);
    const laneX = balance.road.laneWidth;
    const xs = new Set<number>();
    for (const body of bodies) {
      expect(Math.abs(body.x - laneX)).toBeLessThanOrEqual(balance.streams.jitter + 1e-9);
      expect(body.units).toBe(1);
      expect(body.streamId).toBe(0);
      xs.add(body.x);
    }
    // Scattered, not stacked on the lane centre line.
    expect(xs.size).toBeGreaterThan(1);
  });

  it('replays the same scatter for the same seed and a different one otherwise', () => {
    const xsFor = (seed: number): number[] => {
      const def = level({
        seed,
        startCount: 1,
        rows: [streamRow(30, [stream({ count: 40, hpPerEnemy: 1e6 })])],
        arenaZ: 100_000,
      });
      const run = runOf(def);
      play(run, 3, 0);
      return liveBodies(run).map((e) => e.x);
    };
    expect(xsFor(11)).toEqual(xsFor(11));
    expect(xsFor(11)).not.toEqual(xsFor(12));
  });

  it('pauses spawning at the live ceiling and picks up again', () => {
    const tuning = testBalance();
    tuning.enemies.maxLive = 12;
    // Unkillable bodies, so nothing leaves the road except by walking past.
    const run = streamRun([stream({ count: 200, durationSeconds: 20, hpPerEnemy: 1e6 })], 1, tuning);

    for (let i = 0; i < 60 * 12; i++) {
      run.tick(1 / 60);
      expect(liveBodies(run).length).toBeLessThanOrEqual(tuning.enemies.maxLive);
    }
    // The ceiling slowed it down; it did not cancel what is still owed.
    const stream0 = run.state.streams[0];
    expect(stream0?.spawned).toBeLessThan(200);
    expect(stream0?.remaining).toBeGreaterThan(0);
  });

  it('clears a stream that spent most of its life held at the live ceiling', () => {
    // The regression this guards: a ceiling that *cancelled* the debt rather
    // than deferring it would leave `remaining` above zero for ever, and the
    // level would carry a stream that never cleared and a count that never
    // reached the player's screen as 0.
    const tuning = testBalance();
    tuning.enemies.maxLive = 10;
    const run = streamRun([stream({ count: 90, durationSeconds: 4, hpPerEnemy: 1 })], 120, tuning);

    const events = play(run, 40, 0);

    const state = run.state.streams[0];
    expect(state?.spawned).toBe(90);
    expect(state?.remaining).toBe(0);
    expect(state?.done).toBe(true);
    expect(events.filter((e) => e.type === 'streamCleared')).toHaveLength(1);
    // Everything the stream sent is accounted for: shot, leaked, or walked past.
    expect((state?.killed ?? 0) + (state?.leaked ?? 0)).toBeLessThanOrEqual(90);
    expect(state?.killed).toBeGreaterThan(0);
  });

  it('kills each body on its own and clears the stream when the last one goes', () => {
    const run = streamRun([stream({ count: 25, durationSeconds: 4, hpPerEnemy: 1 })], 60);
    const events = play(run, 14, 0);

    const started = events.filter((e) => e.type === 'streamStarted');
    expect(started).toHaveLength(1);
    expect(started[0]?.type === 'streamStarted' && started[0].count).toBe(25);

    const kills = events.filter((e) => e.type === 'enemyKilled' && e.streamId === 0);
    expect(kills.length).toBeGreaterThanOrEqual(20);
    // One body, one kill event: the ids never repeat.
    const ids = new Set(kills.map((e) => (e.type === 'enemyKilled' ? e.enemyId : -1)));
    expect(ids.size).toBe(kills.length);

    const cleared = events.filter((e) => e.type === 'streamCleared');
    expect(cleared).toHaveLength(1);
    expect(run.state.streams[0]?.done).toBe(true);
    expect(run.state.streams[0]?.remaining).toBe(0);
  });

  it('takes exactly one unit per body that reaches the squad', () => {
    // A squad of one fires two shots a second at bodies of a hundred hit points:
    // everything gets through, and every one of them costs a soldier.
    const run = streamRun([stream({ count: 6, durationSeconds: 3, hpPerEnemy: 100 })], 40);
    const events = play(run, 12, 0);

    const leaks = events.filter((e) => e.type === 'enemyLeaked');
    expect(leaks.length).toBeGreaterThan(0);
    const losses = events.filter((e) => e.type === 'unitsLost' && e.reason === 'leak');
    expect(losses).toHaveLength(leaks.length);
    for (const loss of losses) {
      expect(loss.type === 'unitsLost' && loss.amount).toBe(1);
    }
    expect(run.state.squad.count).toBe(40 - leaks.length);
    expect(run.state.streams[0]?.leaked).toBe(leaks.length);
    // A leaked body dies on contact rather than walking on through the crowd.
    for (const leak of leaks) {
      const id = leak.type === 'enemyLeaked' ? leak.enemyId : -1;
      expect(events.some((e) => e.type === 'enemyKilled' && e.enemyId === id)).toBe(true);
    }
  });

  it('lets a body that misses the squad walk past without costing anything', () => {
    const run = streamRun([stream({ lane: -1, count: 8, durationSeconds: 3, hpPerEnemy: 1e6 })], 1);
    const events = play(run, 12, balance.road.clampX);
    expect(events.some((e) => e.type === 'enemyLeaked')).toBe(false);
    expect(run.state.squad.count).toBe(1);
  });

  it("floats the count over the nearest live body and counts what is still coming", () => {
    const run = streamRun([stream({ count: 30, durationSeconds: 6, hpPerEnemy: 1e6 })], 1);
    play(run, 4, 0);

    const state = run.state.streams[0];
    if (state === undefined) throw new Error('no stream');
    const bodies = liveBodies(run);
    const nearest = Math.min(...bodies.map((e) => e.z));
    expect(state.headZ).toBeCloseTo(nearest, 9);
    expect(state.headZ).toBeGreaterThan(run.state.squad.z);
    // Everything not yet sent plus everything still standing.
    expect(state.remaining).toBe(state.count - state.spawned + state.alive);
    expect(state.alive).toBe(bodies.length);
  });

  it('pours a horde down two lanes at once', () => {
    const run = streamRun(
      [
        stream({ lane: -1, count: 20, hpPerEnemy: 1e6 }),
        stream({ lane: 0, count: 20, hpPerEnemy: 1e6 }),
      ],
      1,
    );
    const events = play(run, 4, 0);
    expect(events.filter((e) => e.type === 'streamStarted')).toHaveLength(2);
    const lanes = new Set(liveBodies(run).map((e) => (e.x < -1 ? -1 : 0)));
    expect(lanes.size).toBe(2);
  });

  it('sweeps corpses out of the enemy array so it cannot grow without bound', () => {
    const run = streamRun([stream({ count: 120, durationSeconds: 6, hpPerEnemy: 1 })], 200);
    let peak = 0;
    for (let i = 0; i < 60 * 20; i++) {
      run.tick(1 / 60);
      peak = Math.max(peak, run.state.enemies.length);
    }
    expect(run.state.streams[0]?.done).toBe(true);
    // Live bodies plus at most a second of corpses, never all 120 at once.
    expect(peak).toBeLessThan(120);
    expect(run.state.enemies).toHaveLength(0);
  });

  it('replays a whole run exactly for the same seed and level', () => {
    const trace = (seed: number): string => {
      const def = level({
        seed,
        startCount: 30,
        rows: [
          streamRow(30, [stream({ count: 40, durationSeconds: 6, hpPerEnemy: 4 })]),
          streamRow(90, [stream({ lane: -1, count: 40, durationSeconds: 6, hpPerEnemy: 4 })]),
        ],
        arenaZ: 100_000,
      });
      const run = runOf(def);
      const seen: SimEvent[] = [];
      for (let i = 0; i < 60 * 30; i++) {
        run.setTargetX(Math.sin(i / 40) * 2);
        for (const event of run.tick(1 / 60)) seen.push({ ...event });
      }
      return JSON.stringify([seen.length, run.state.streams, run.state.squad.count]);
    };
    expect(trace(5)).toBe(trace(5));
    expect(trace(5)).not.toBe(trace(6));
  });
});
