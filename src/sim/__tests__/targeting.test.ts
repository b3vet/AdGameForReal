import { describe, expect, it } from 'vitest';

import { level, play, row, runOf, staffRow, testBalance } from './fixtures';
import type { RowDef } from '../level';
import { Run } from '../Run';
import { TargetList } from '../targeting';
import type { EnemyState, SimEvent, StreamDef } from '../types';
import { balance } from '@/data';

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

function live(run: Run): EnemyState[] {
  return run.state.enemies.filter((e) => e.alive);
}

/** Every enemy id the events say was hit, in the order the hits landed. */
function hitIds(events: readonly SimEvent[]): number[] {
  return events.filter((e) => e.type === 'enemyHit').map((e) => (e.type === 'enemyHit' ? e.enemyId : -1));
}

describe('targeting', () => {
  it('hits the nearest live thing in the lane and nothing behind it', () => {
    // Two blocks, one lane, nothing else on the road: the near one absorbs
    // every shot until it dies, and only then does the far one take anything.
    const run = runOf(
      level({
        startCount: 6,
        rows: [
          row(20, [null, null, null], [{ kind: 'grunt', lane: 0, units: 6 }]),
          row(28, [null, null, null], [{ kind: 'brute', lane: 0, units: 40 }]),
        ],
        arenaZ: 100_000,
      }),
    );
    const near = run.state.enemies[0];
    const far = run.state.enemies[1];
    if (near === undefined || far === undefined) throw new Error('no blocks');

    // While the near block lives, nothing reaches the far one.
    for (let i = 0; i < 60 * 10; i++) {
      const hits = hitIds([...run.tick(1 / 60)]);
      if (!near.alive) break;
      for (const id of hits) expect(id).toBe(near.id);
    }
    expect(near.alive).toBe(false);
    expect(far.hp).toBeLessThan(far.maxHp + 1);

    // With it gone, the far one starts taking fire.
    const after = play(run, 2, 0);
    expect(hitIds(after)).toContain(far.id);
  });

  it('shoots a stream from the front of the queue backward', () => {
    // Frost, because it is the one staff that neither splashes nor chains: any
    // body that takes damage here took a shot aimed at it. Bodies tough enough
    // to survive the step, so what is measured is the order of the lane list.
    const run = runOf(
      level({
        startCount: 40,
        rows: [
          staffRow(2, 'frost'),
          streamRow(40, [stream({ count: 60, durationSeconds: 30, hpPerEnemy: 1e6, jitter: 0 })]),
        ],
        arenaZ: 100_000,
      }),
    );
    play(run, 8, 0);

    let checked = 0;
    for (let i = 0; i < 60 * 4; i++) {
      const queue = live(run)
        .filter((e) => e.z >= run.state.squad.z)
        .sort((a, b) => a.z - b.z);
      const hits = new Set(hitIds([...run.tick(1 / 60)]));
      if (queue.length < 6 || hits.size === 0) continue;
      checked++;
      // The front three. Not just the head: a shot fired a few steps ago has
      // already flown past whoever has since walked to the front of the queue.
      const front = new Set(queue.slice(0, 3).map((e) => e.id));
      for (const id of hits) expect(front.has(id)).toBe(true);
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('lets a shot in one lane pass a body standing in another', () => {
    const run = runOf(
      level({
        startCount: 1,
        rows: [
          streamRow(30, [
            stream({ lane: -1, count: 20, durationSeconds: 20, hpPerEnemy: 1e6, jitter: 0 }),
          ]),
        ],
        arenaZ: 100_000,
      }),
    );
    // The squad hugs the right-hand lane; the river is on the left.
    const events = play(run, 6, balance.road.clampX);
    expect(events.some((e) => e.type === 'enemyHit')).toBe(false);
    expect(events.some((e) => e.type === 'projectileFired')).toBe(true);
  });

  it('splashes the bodies around the one it hit', () => {
    // Ember is the starting staff: one shot, everything within its radius.
    const run = runOf(
      level({
        startCount: 250,
        rows: [streamRow(30, [stream({ count: 120, durationSeconds: 12, hpPerEnemy: 1e6 })])],
        arenaZ: 100_000,
      }),
    );
    play(run, 8, 0);
    const events = play(run, 1, 0);

    expect(events.some((e) => e.type === 'splash')).toBe(true);
    const perShot = new Map<number, number>();
    for (const id of hitIds(events)) perShot.set(id, (perShot.get(id) ?? 0) + 1);
    // More bodies took damage than there were direct impacts.
    const impacts = events.filter((e) => e.type === 'projectileHit').length;
    expect(perShot.size).toBeGreaterThan(1);
    expect(hitIds(events).length).toBeGreaterThan(impacts);
  });

  it('chains along a stream when the squad is carrying storm', () => {
    const run = runOf(
      level({
        startCount: 250,
        rows: [
          staffRow(2, 'storm'),
          streamRow(40, [stream({ count: 120, durationSeconds: 12, hpPerEnemy: 1e6 })]),
        ],
        arenaZ: 100_000,
      }),
    );
    play(run, 10, 0);
    const events = play(run, 1, 0);

    const chains = events.filter((e) => e.type === 'chain');
    expect(chains.length).toBeGreaterThan(0);
    for (const link of chains) {
      if (link.type !== 'chain') continue;
      expect(link.from).not.toBe(link.to);
    }
  });

  it('mows a lane down with one volley instead of wasting it on one body', () => {
    // Above the projectile cap a step's shots become one batch per lane. With
    // one-hit-point bodies a batch that stopped at its first target would throw
    // away almost all of its damage — this is the carry-over rule.
    const tuning = testBalance();
    tuning.projectiles.max = 1;
    const run = runOf(
      level({
        startCount: 300,
        rows: [streamRow(30, [stream({ count: 5400, durationSeconds: 30, hpPerEnemy: 1, jitter: 0 })])],
        arenaZ: 100_000,
      }),
      tuning,
    );
    play(run, 6, 0);

    // One step where a single lane's batch killed more than the step fired:
    // only carry-over can do that, because a batch is one `projectileFired`.
    let best = 0;
    for (let i = 0; i < 60 * 4; i++) {
      let kills = 0;
      let fired = 0;
      for (const event of run.tick(1 / 60)) {
        if (event.type === 'enemyKilled') kills++;
        if (event.type === 'projectileFired') fired++;
      }
      best = Math.max(best, kills - fired);
    }
    expect(best).toBeGreaterThan(0);
  });

  it('still lets a gate swallow a whole batch, so shooting one still grows it', () => {
    const tuning = testBalance();
    tuning.projectiles.max = 1;
    const run = runOf(
      level({
        startCount: 120,
        rows: [row(24, [null, { kind: 'add', value: 3 }, null])],
      }),
      tuning,
    );
    play(run, 2, 0);
    const gate = run.state.gates[0];
    expect(gate?.hits).toBeGreaterThan(50);
    expect(gate?.value).toBeGreaterThan(3);
  });

  /**
   * The lane a target is filed under has to come from the run's own tuning.
   * `add` used to reach for the shipped `balance.road.laneWidth` instead, so a
   * run with a different road filed everything against a two-metre lane: on a
   * six-metre road a body standing dead centre landed in all three lane lists,
   * and `sweepLane` — which has no band test of its own, because a batched
   * volley comes from a crowd spread across the lane — mowed it down from a
   * lane it was nowhere near.
   */
  it('files a target under the run\'s own lane width, not the shipped one', () => {
    const tuning = testBalance();
    tuning.road.laneWidth = 6;
    tuning.road.halfWidth = 9;
    tuning.road.clampX = 7;

    const targets = new TargetList();
    const body: EnemyState = {
      id: 1,
      kind: 'grunt',
      x: 0,
      z: 20,
      hp: 5,
      maxHp: 5,
      units: 1,
      speed: 3,
      active: true,
      alive: true,
      slowUntil: 0,
      streamId: 0,
    };
    targets.insert(body, tuning);

    // Even with the aim assist on it, the body is 1.34 m wide to a shot and the
    // lane is six metres: it stands in the middle lane and nowhere else.
    expect(targets.sweepLane(0, 0, 50)).not.toBeNull();
    expect(targets.sweepLane(1, 0, 50)).toBeNull();
    expect(targets.sweepLane(-1, 0, 50)).toBeNull();
  });

  it('drops targets that fall behind the squad instead of scanning them forever', () => {
    const run = runOf(
      level({
        startCount: 2,
        rows: [streamRow(30, [stream({ count: 40, durationSeconds: 6, hpPerEnemy: 1e6 })])],
        arenaZ: 100_000,
      }),
    );
    play(run, 20, 0);
    // Everything walked past and was retired: nothing is still standing behind.
    for (const enemy of live(run)) {
      expect(enemy.z).toBeGreaterThan(run.state.squad.z - balance.streams.despawnBehind - 1);
    }
  });
});
