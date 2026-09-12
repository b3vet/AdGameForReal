/**
 * Enemy streams: hundreds of single bodies pouring down a lane (D29).
 *
 * A stream is not a block. Each body is its own `EnemyState` with `units: 1`, a
 * `streamId` and its own HP; it dies on its own, and one that reaches the squad
 * takes exactly one unit with it. What the player reads is the count floating
 * over the stream's head — `StreamState.headZ` is the nearest live body, and
 * `remaining` is everything still to come, unspawned and live together.
 *
 * Bodies appear `balance.streams.spawnAhead` metres in front of the squad
 * rather than at a fixed point on the road: the squad runs at 5 m/s, so a fixed
 * spawner would be behind it within seconds, and a spawner that keeps pace is
 * what makes the lane read as a river. The row's own `z` is the trigger — the
 * stream starts when the squad is `spawnAhead` short of it, so its first body
 * appears exactly on the row.
 *
 * This module also owns the corpse sweep: a dead body stays in `state.enemies`
 * for `balance.enemies.corpseSeconds` so render can play its death, and is then
 * compacted out and its object re-used. Nothing here allocates in steady state.
 */

import type { EventBuffer } from './events';
import { laneCenter } from './lanes';
import { mulberry32 } from './rng';
import type { Rng } from './rng';
import type { TargetList } from './targeting';
import type { EnemyState, RunState, StreamDef, StreamState } from './types';
import type { Balance } from '@/data/types';

/** Mixed into the level seed so stream jitter is not the level's own stream. */
const STREAM_SALT = 0x5f_27_ea_11;

/** Most bodies one stream may release in a single step while catching up. */
const MAX_SPAWN_BURST = 3;

interface StreamRuntime {
  def: StreamDef;
  state: StreamState;
  /** Bodies the schedule says are due but that have not been released yet. */
  owed: number;
}

export class Streams {
  private readonly balance: Balance;
  private readonly events: EventBuffer;
  private readonly targets: TargetList;
  private readonly rng: Rng;
  private readonly runtimes: StreamRuntime[] = [];

  /** Retired bodies, re-used rather than re-allocated. */
  private readonly free: EnemyState[] = [];

  private nextId: number;
  /** Live bodies on the road right now, boss excluded: the `maxLive` ceiling. */
  private live = 0;

  constructor(
    balance: Balance,
    events: EventBuffer,
    targets: TargetList,
    seed: number,
    nextId: number,
  ) {
    this.balance = balance;
    this.events = events;
    this.targets = targets;
    this.rng = mulberry32((seed ^ STREAM_SALT) >>> 0);
    this.nextId = nextId;
  }

  /** Registers one stream from the level and returns the state render reads. */
  add(def: StreamDef, z: number): StreamState {
    const state: StreamState = {
      id: this.runtimes.length,
      lane: def.lane,
      z,
      count: def.count,
      remaining: def.count,
      spawned: 0,
      alive: 0,
      killed: 0,
      leaked: 0,
      headZ: z,
      started: false,
      done: false,
    };
    this.runtimes.push({ def, state, owed: 0 });
    return state;
  }

  /** Counts the blocks the level starts with, so they share the live ceiling. */
  countStanding(enemies: readonly EnemyState[]): void {
    let live = 0;
    for (const enemy of enemies) if (enemy.alive) live++;
    this.live = live;
  }

  /**
   * Releases whatever the schedule owes this step.
   *
   * A stream whose release would push the road past `enemies.maxLive` simply
   * keeps its debt: it goes on spawning as soon as the squad has thinned the
   * river, so the ceiling slows a stream down instead of shrinking it.
   */
  spawn(state: RunState, dt: number): void {
    const streams = this.balance.streams;
    const trigger = state.squad.z + streams.spawnAhead;
    const ceiling = this.balance.enemies.maxLive;

    for (const runtime of this.runtimes) {
      const stream = runtime.state;
      if (stream.done || stream.spawned >= stream.count) continue;
      if (trigger < stream.z) continue;

      const def = runtime.def;
      runtime.owed += (def.count / Math.max(0.1, def.durationSeconds)) * dt;
      let burst = Math.min(MAX_SPAWN_BURST, Math.floor(runtime.owed));
      while (burst > 0 && stream.spawned < stream.count && this.live < ceiling) {
        this.release(state, runtime, trigger);
        runtime.owed--;
        burst--;
      }
    }
  }

  /**
   * One pass over the road once everything has moved: per-stream head and
   * counts for the floating label, the `streamCleared` edge, and the corpse
   * sweep that keeps `state.enemies` from growing without bound.
   */
  settle(state: RunState): void {
    for (const runtime of this.runtimes) {
      runtime.state.alive = 0;
      runtime.state.headZ = runtime.state.z;
    }

    const enemies = state.enemies;
    const expiry = state.time - this.balance.enemies.corpseSeconds;
    let live = 0;

    for (let i = enemies.length - 1; i >= 0; i--) {
      const enemy = enemies[i];
      if (enemy === undefined) continue;

      if (enemy.alive) {
        live++;
        const stream = this.streamOf(enemy);
        if (stream !== null) {
          stream.alive++;
          if (stream.alive === 1 || enemy.z < stream.headZ) stream.headZ = enemy.z;
        }
        continue;
      }

      if ((enemy.diedAt ?? 0) > expiry) continue;
      const last = enemies.pop();
      if (last !== undefined && i < enemies.length) enemies[i] = last;
      if (enemy.streamId !== undefined) this.free.push(enemy);
    }

    this.live = live;

    for (const runtime of this.runtimes) {
      const stream = runtime.state;
      stream.remaining = stream.count - stream.spawned + stream.alive;
      if (stream.done || !stream.started) continue;
      if (stream.remaining > 0) continue;
      stream.done = true;
      this.events.streamCleared(stream.id, stream.lane, stream.leaked);
    }
  }

  /** Books a stream body's death against its stream. Called from the kill path. */
  noteKilled(enemy: EnemyState): void {
    const stream = this.streamOf(enemy);
    if (stream !== null) stream.killed++;
  }

  /** Books a body that walked into the squad. Called from the contact path. */
  noteLeaked(enemy: EnemyState): void {
    const stream = this.streamOf(enemy);
    if (stream !== null) stream.leaked++;
  }

  private streamOf(enemy: EnemyState): StreamState | null {
    const id = enemy.streamId;
    if (id === undefined) return null;
    return this.runtimes[id]?.state ?? null;
  }

  private release(state: RunState, runtime: StreamRuntime, z: number): void {
    const def = runtime.def;
    const stream = runtime.state;
    const streams = this.balance.streams;

    const spread = (this.rng() * 2 - 1) * def.jitter;
    const edge = Math.max(0, this.balance.road.halfWidth - streams.footprint);
    const x = Math.min(edge, Math.max(-edge, laneCenter(def.lane, this.balance.road.laneWidth) + spread));

    const body = this.take();
    body.id = this.nextId++;
    body.kind = def.kind;
    body.x = x;
    body.z = z;
    body.hp = def.hpPerEnemy;
    body.maxHp = def.hpPerEnemy;
    body.units = 1;
    body.speed = def.speed;
    // Already inside projectile range, so there is nothing to wake up: a stream
    // body walks and can be shot from the instant it exists.
    body.active = true;
    body.alive = true;
    body.slowUntil = 0;
    body.streamId = stream.id;
    body.diedAt = 0;
    // A recycled body is a new person: it cannot inherit the fire the last one
    // died in. Guarded so a body that never burned keeps the smaller shape.
    if (body.burning === true) {
      body.burning = false;
      body.burnUntil = 0;
    }

    state.enemies.push(body);
    this.targets.insert(body, this.balance);
    this.live++;

    stream.spawned++;
    if (!stream.started) {
      stream.started = true;
      this.events.streamStarted(stream.id, stream.lane, stream.count);
    }
    this.events.enemyActivated(body.id);
  }

  private take(): EnemyState {
    const recycled = this.free.pop();
    if (recycled !== undefined) return recycled;
    return {
      id: 0,
      kind: 'grunt',
      x: 0,
      z: 0,
      hp: 1,
      maxHp: 1,
      units: 1,
      speed: 0,
      active: true,
      alive: true,
      slowUntil: 0,
      streamId: 0,
      diedAt: 0,
    };
  }
}
