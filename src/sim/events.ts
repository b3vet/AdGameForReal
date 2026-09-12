/**
 * Event buffer for one `tick`.
 *
 * Events are pooled and the returned array is reused, because a busy tick emits
 * one event per shot and the sim must not allocate in hot loops (CLAUDE.md).
 * Consumers read the events inside the frame that produced them; anything kept
 * longer must be copied, since the next `tick` overwrites these objects.
 */

import { createEventPools, resetEventPools } from './eventPools';
import type { EventPools } from './eventPools';
import type { EnemyKind, GateKind, Lane, RunStatus, SimEvent, UnitLossReason, WeaponId } from './types';

export class EventBuffer {
  /** The array handed to callers. Same instance every tick. */
  readonly list: SimEvent[] = [];

  /** One free list per event kind; the blanks they hand out are `./eventPools.ts`. */
  private readonly pools: EventPools = createEventPools();

  /** Called once per `tick`, before any step runs. */
  reset(): void {
    this.list.length = 0;
    resetEventPools(this.pools);
  }

  projectileFired(x: number, z: number): void {
    const e = this.pools.fired.take();
    e.x = x;
    e.z = z;
    this.list.push(e);
  }

  projectileHit(weaponId: WeaponId, x: number, z: number): void {
    const e = this.pools.impacts.take();
    e.weaponId = weaponId;
    e.x = x;
    e.z = z;
    this.list.push(e);
  }

  splash(x: number, z: number, radius: number): void {
    const e = this.pools.splashes.take();
    e.x = x;
    e.z = z;
    e.radius = radius;
    this.list.push(e);
  }

  chain(from: number, to: number): void {
    const e = this.pools.chains.take();
    e.from = from;
    e.to = to;
    this.list.push(e);
  }

  enemySlowed(enemyId: number, seconds: number): void {
    const e = this.pools.slows.take();
    e.enemyId = enemyId;
    e.seconds = seconds;
    this.list.push(e);
  }

  enemyShattered(enemyId: number, x: number, z: number, streamId?: number): void {
    const e = this.pools.shatters.take();
    e.enemyId = enemyId;
    e.x = x;
    e.z = z;
    // Deleted rather than set to `undefined`, for the reason `enemyKilled`
    // gives below.
    if (streamId === undefined) delete e.streamId;
    else e.streamId = streamId;
    this.list.push(e);
  }

  enemyBurning(enemyId: number, x: number, z: number, seconds: number): void {
    const e = this.pools.burns.take();
    e.enemyId = enemyId;
    e.x = x;
    e.z = z;
    e.seconds = seconds;
    this.list.push(e);
  }

  familiarShot(x: number, z: number, targetId: number): void {
    const e = this.pools.familiarShots.take();
    e.x = x;
    e.z = z;
    e.targetId = targetId;
    this.list.push(e);
  }

  wallBlocked(boundary: -1 | 1, x: number, z: number): void {
    const e = this.pools.wallBlocks.take();
    e.boundary = boundary;
    e.x = x;
    e.z = z;
    this.list.push(e);
  }

  weaponChanged(from: WeaponId, to: WeaponId): void {
    const e = this.pools.weaponSwaps.take();
    e.from = from;
    e.to = to;
    this.list.push(e);
  }

  bossEnraged(enemyId: number): void {
    const e = this.pools.enrages.take();
    e.enemyId = enemyId;
    this.list.push(e);
  }

  gateHit(gateId: number, kind: GateKind, value: number): void {
    const e = this.pools.gateHits.take();
    e.gateId = gateId;
    e.kind = kind;
    e.value = value;
    this.list.push(e);
  }

  gatePassed(
    gateId: number,
    kind: GateKind,
    value: number,
    countBefore: number,
    countAfter: number,
  ): void {
    const e = this.pools.gatePasses.take();
    e.gateId = gateId;
    e.kind = kind;
    e.value = value;
    e.countBefore = countBefore;
    e.countAfter = countAfter;
    this.list.push(e);
  }

  enemyActivated(enemyId: number): void {
    const e = this.pools.activations.take();
    e.enemyId = enemyId;
    this.list.push(e);
  }

  enemyHit(enemyId: number, damage: number, hp: number, x: number, z: number): void {
    const e = this.pools.enemyHits.take();
    e.enemyId = enemyId;
    e.damage = damage;
    e.hp = hp;
    e.x = x;
    e.z = z;
    this.list.push(e);
  }

  enemyKilled(enemyId: number, kind: EnemyKind, x: number, z: number, streamId?: number): void {
    const e = this.pools.kills.take();
    e.enemyId = enemyId;
    e.kind = kind;
    e.x = x;
    e.z = z;
    // Deleted rather than set to `undefined`: the pool re-uses this object, and
    // `exactOptionalPropertyTypes` means an absent field is the only way to say
    // "this body was not part of a stream".
    if (streamId === undefined) delete e.streamId;
    else e.streamId = streamId;
    this.list.push(e);
  }

  enemyLeaked(enemyId: number, streamId: number, x: number, z: number): void {
    const e = this.pools.leaks.take();
    e.enemyId = enemyId;
    e.streamId = streamId;
    e.x = x;
    e.z = z;
    this.list.push(e);
  }

  streamStarted(streamId: number, lane: Lane, count: number): void {
    const e = this.pools.streamStarts.take();
    e.streamId = streamId;
    e.lane = lane;
    e.count = count;
    this.list.push(e);
  }

  streamCleared(streamId: number, lane: Lane, leaked: number): void {
    const e = this.pools.streamClears.take();
    e.streamId = streamId;
    e.lane = lane;
    e.leaked = leaked;
    this.list.push(e);
  }

  unitsGained(amount: number): void {
    const e = this.pools.gained.take();
    e.amount = amount;
    this.list.push(e);
  }

  unitsLost(amount: number, reason: UnitLossReason): void {
    const e = this.pools.lost.take();
    e.amount = amount;
    e.reason = reason;
    this.list.push(e);
  }

  bossActivated(enemyId: number): void {
    const e = this.pools.bossActivations.take();
    e.enemyId = enemyId;
    this.list.push(e);
  }

  bossStomp(x: number, z: number): void {
    const e = this.pools.stomps.take();
    e.x = x;
    e.z = z;
    this.list.push(e);
  }

  bossKilled(): void {
    this.list.push(this.pools.bossKills.take());
  }

  runEnded(status: RunStatus, survivors: number, peakCount: number): void {
    const e = this.pools.ends.take();
    e.status = status;
    e.survivors = survivors;
    e.peakCount = peakCount;
    this.list.push(e);
  }
}
