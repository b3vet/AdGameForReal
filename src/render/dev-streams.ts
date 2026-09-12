/**
 * The stream half of the render fixture: rivers of single bodies pouring down
 * the lanes so the Milestone 3 stream visuals can be reviewed without the sim.
 *
 * It mirrors the shape of `src/sim/streams.ts` — bodies with `units: 1` and a
 * `streamId`, spawned `spawnAhead` metres in front of the squad over the
 * stream's duration, walking toward it, with `headZ` and `remaining` kept up to
 * date for the floating count — but nothing here is authoritative. What it has
 * to get exactly right is the *contract* the renderer reads: `diedAt` on a
 * corpse, `alive` on a body, and the `enemyLeaked` event, because those are
 * what `src/render/streamBodies.ts` draws from.
 *
 * Split out of `dev-scenario.ts`, which owns the story, for the same reason
 * `dev-combat.ts` is: it is a third of the fixture on its own.
 */

import { balance } from '@/data';
import type { EnemyState, Lane, RunState, SimEvent, StreamState } from '@/sim';
import { laneCenter } from '@/sim';

/** The fixture's streams: lane, size, and where down the road they trigger. */
const DEV_STREAMS: readonly { lane: Lane; count: number; z: number; seconds: number }[] = [
  { lane: 0, count: 60, z: 18, seconds: 5 },
  { lane: -1, count: 90, z: 54, seconds: 6 },
  { lane: 1, count: 90, z: 56, seconds: 6 },
  { lane: 0, count: 120, z: 108, seconds: 7 },
  { lane: 1, count: 120, z: 110, seconds: 7 },
];

/** Ids start here so they cannot collide with the fixture's blocks or boss. */
const FIRST_BODY_ID = 20_000;

/** Bodies a stream releases in one step at most, matching the sim's own cap. */
const MAX_BURST = 3;

interface Runtime {
  state: StreamState;
  count: number;
  seconds: number;
  owed: number;
}

export class DevStreams {
  private readonly runtimes: Runtime[] = [];
  private nextId = FIRST_BODY_ID;
  /** Its own noise, deliberately not the sim's RNG. */
  private seed = 0x2b_c9_51_07;

  constructor(
    private readonly state: RunState,
    private readonly events: SimEvent[],
  ) {}

  /** A fresh pass: every stream is re-armed and every body taken off the road. */
  reset(): void {
    this.runtimes.length = 0;
    this.state.streams.length = 0;
    for (let i = this.state.enemies.length - 1; i >= 0; i--) {
      if (this.state.enemies[i]?.streamId !== undefined) this.state.enemies.splice(i, 1);
    }

    DEV_STREAMS.forEach((def, index) => {
      const stream: StreamState = {
        id: index,
        lane: def.lane,
        z: def.z,
        count: def.count,
        remaining: def.count,
        spawned: 0,
        alive: 0,
        killed: 0,
        leaked: 0,
        headZ: def.z,
        started: false,
        done: false,
      };
      this.state.streams.push(stream);
      this.runtimes.push({ state: stream, count: def.count, seconds: def.seconds, owed: 0 });
    });
  }

  step(dt: number): void {
    this.spawn(dt);
    this.move(dt);
    this.settle();
  }

  private spawn(dt: number): void {
    const trigger = this.state.squad.z + balance.streams.spawnAhead;
    for (const runtime of this.runtimes) {
      const stream = runtime.state;
      if (stream.done || stream.spawned >= runtime.count || trigger < stream.z) continue;

      runtime.owed += (runtime.count / runtime.seconds) * dt;
      let burst = Math.min(MAX_BURST, Math.floor(runtime.owed));
      while (burst > 0 && stream.spawned < runtime.count) {
        this.release(runtime, trigger);
        runtime.owed--;
        burst--;
      }
    }
  }

  private release(runtime: Runtime, z: number): void {
    const stream = runtime.state;
    const jitter = (this.random() * 2 - 1) * balance.streams.jitter;
    const edge = balance.road.halfWidth - balance.streams.footprint;
    const x = Math.min(edge, Math.max(-edge, laneCenter(stream.lane) + jitter));

    const body: EnemyState = {
      id: this.nextId++,
      kind: 'grunt',
      x,
      z,
      hp: 4,
      maxHp: 4,
      units: 1,
      speed: balance.streams.speed,
      active: true,
      alive: true,
      slowUntil: 0,
      streamId: stream.id,
      diedAt: 0,
    };
    this.state.enemies.push(body);
    stream.spawned++;
    if (!stream.started) {
      stream.started = true;
      this.events.push({ type: 'streamStarted', streamId: stream.id, lane: stream.lane, count: runtime.count });
    }
  }

  /** Walks every body at the squad, and books the ones that reach it. */
  private move(dt: number): void {
    const squad = this.state.squad;
    for (const enemy of this.state.enemies) {
      if (enemy.streamId === undefined || !enemy.alive) continue;
      enemy.z -= enemy.speed * dt;
      if (enemy.z - squad.z > balance.enemies.contactDistance) continue;

      // A leak costs exactly one unit, as the sim's contact rule does, and the
      // body is taken off the road rather than killed: `enemyLeaked` is what
      // tells the renderer to hide it instead of playing a death.
      enemy.alive = false;
      enemy.diedAt = this.state.time;
      const stream = this.state.streams[enemy.streamId];
      if (stream !== undefined) stream.leaked++;
      if (squad.count > 0) {
        squad.count -= 1;
        this.events.push({ type: 'unitsLost', amount: 1, reason: 'leak' });
      }
      this.events.push({
        type: 'enemyLeaked',
        enemyId: enemy.id,
        streamId: enemy.streamId,
        x: enemy.x,
        z: enemy.z,
      });
    }
  }

  /**
   * One pass once everything has moved: per-stream head and counts for the
   * floating label, the `streamCleared` edge, and the corpse sweep — the same
   * three jobs `Streams.settle` does in the sim, and in the same order, because
   * the renderer reads the result of all three.
   */
  private settle(): void {
    for (const stream of this.state.streams) {
      stream.alive = 0;
      stream.headZ = stream.z;
    }

    const enemies = this.state.enemies;
    const expiry = this.state.time - balance.enemies.corpseSeconds;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const enemy = enemies[i];
      if (enemy?.streamId === undefined) continue;
      const stream = this.state.streams[enemy.streamId];

      if (enemy.alive) {
        if (stream !== undefined) {
          stream.alive++;
          if (stream.alive === 1 || enemy.z < stream.headZ) stream.headZ = enemy.z;
        }
        continue;
      }
      if ((enemy.diedAt ?? 0) > expiry) continue;
      enemies.splice(i, 1);
    }

    for (const runtime of this.runtimes) {
      const stream = runtime.state;
      stream.remaining = runtime.count - stream.spawned + stream.alive;
      if (stream.done || !stream.started || stream.remaining > 0) continue;
      stream.done = true;
      this.events.push({
        type: 'streamCleared',
        streamId: stream.id,
        lane: stream.lane,
        leaked: stream.leaked,
      });
    }
  }

  /** xorshift32, so the scatter is the same in every screenshot pass. */
  private random(): number {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x;
    return (x >>> 0) / 4294967296;
  }
}
