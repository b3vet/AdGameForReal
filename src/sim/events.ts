/**
 * Event buffer for one `tick`.
 *
 * Events are pooled and the returned array is reused, because a busy tick emits
 * one event per shot and the sim must not allocate in hot loops (CLAUDE.md).
 * Consumers read the events inside the frame that produced them; anything kept
 * longer must be copied, since the next `tick` overwrites these objects.
 */

import { Pool } from './pool';
import type { EnemyKind, GateKind, Lane, RunStatus, SimEvent, UnitLossReason, WeaponId } from './types';

type EventOf<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;

export class EventBuffer {
  /** The array handed to callers. Same instance every tick. */
  readonly list: SimEvent[] = [];

  private readonly fired = new Pool<EventOf<'projectileFired'>>(() => ({
    type: 'projectileFired',
    x: 0,
    z: 0,
  }));

  private readonly impacts = new Pool<EventOf<'projectileHit'>>(() => ({
    type: 'projectileHit',
    weaponId: 'ember',
    x: 0,
    z: 0,
  }));

  private readonly splashes = new Pool<EventOf<'splash'>>(() => ({
    type: 'splash',
    x: 0,
    z: 0,
    radius: 0,
  }));

  private readonly chains = new Pool<EventOf<'chain'>>(() => ({ type: 'chain', from: 0, to: 0 }));

  private readonly slows = new Pool<EventOf<'enemySlowed'>>(() => ({
    type: 'enemySlowed',
    enemyId: 0,
    seconds: 0,
  }));

  private readonly shatters = new Pool<EventOf<'enemyShattered'>>(() => ({
    type: 'enemyShattered',
    enemyId: 0,
    x: 0,
    z: 0,
  }));

  private readonly burns = new Pool<EventOf<'enemyBurning'>>(() => ({
    type: 'enemyBurning',
    enemyId: 0,
    x: 0,
    z: 0,
    seconds: 0,
  }));

  private readonly familiarShots = new Pool<EventOf<'familiarShot'>>(() => ({
    type: 'familiarShot',
    x: 0,
    z: 0,
    targetId: 0,
  }));

  private readonly wallBlocks = new Pool<EventOf<'wallBlocked'>>(() => ({
    type: 'wallBlocked',
    boundary: 1,
    x: 0,
    z: 0,
  }));

  private readonly weaponSwaps = new Pool<EventOf<'weaponChanged'>>(() => ({
    type: 'weaponChanged',
    from: 'ember',
    to: 'ember',
  }));

  private readonly enrages = new Pool<EventOf<'bossEnraged'>>(() => ({
    type: 'bossEnraged',
    enemyId: 0,
  }));

  private readonly gateHits = new Pool<EventOf<'gateHit'>>(() => ({
    type: 'gateHit',
    gateId: 0,
    kind: 'add',
    value: 0,
  }));

  private readonly gatePasses = new Pool<EventOf<'gatePassed'>>(() => ({
    type: 'gatePassed',
    gateId: 0,
    kind: 'add',
    value: 0,
    countBefore: 0,
    countAfter: 0,
  }));

  private readonly activations = new Pool<EventOf<'enemyActivated'>>(() => ({
    type: 'enemyActivated',
    enemyId: 0,
  }));

  private readonly enemyHits = new Pool<EventOf<'enemyHit'>>(() => ({
    type: 'enemyHit',
    enemyId: 0,
    damage: 0,
    hp: 0,
    x: 0,
    z: 0,
  }));

  private readonly kills = new Pool<EventOf<'enemyKilled'>>(() => ({
    type: 'enemyKilled',
    enemyId: 0,
    kind: 'grunt',
    x: 0,
    z: 0,
  }));

  private readonly leaks = new Pool<EventOf<'enemyLeaked'>>(() => ({
    type: 'enemyLeaked',
    enemyId: 0,
    streamId: 0,
    x: 0,
    z: 0,
  }));

  private readonly streamStarts = new Pool<EventOf<'streamStarted'>>(() => ({
    type: 'streamStarted',
    streamId: 0,
    lane: 0,
    count: 0,
  }));

  private readonly streamClears = new Pool<EventOf<'streamCleared'>>(() => ({
    type: 'streamCleared',
    streamId: 0,
    lane: 0,
    leaked: 0,
  }));

  private readonly gained = new Pool<EventOf<'unitsGained'>>(() => ({
    type: 'unitsGained',
    amount: 0,
    reason: 'gate',
  }));

  private readonly lost = new Pool<EventOf<'unitsLost'>>(() => ({
    type: 'unitsLost',
    amount: 0,
    reason: 'contact',
  }));

  private readonly bossActivations = new Pool<EventOf<'bossActivated'>>(() => ({
    type: 'bossActivated',
    enemyId: 0,
  }));

  private readonly stomps = new Pool<EventOf<'bossStomp'>>(() => ({
    type: 'bossStomp',
    x: 0,
    z: 0,
  }));

  private readonly bossKills = new Pool<EventOf<'bossKilled'>>(() => ({ type: 'bossKilled' }));

  private readonly ends = new Pool<EventOf<'runEnded'>>(() => ({
    type: 'runEnded',
    status: 'won',
    survivors: 0,
    peakCount: 0,
  }));

  /** Called once per `tick`, before any step runs. */
  reset(): void {
    this.list.length = 0;
    this.fired.reset();
    this.impacts.reset();
    this.splashes.reset();
    this.chains.reset();
    this.slows.reset();
    this.shatters.reset();
    this.burns.reset();
    this.familiarShots.reset();
    this.wallBlocks.reset();
    this.weaponSwaps.reset();
    this.enrages.reset();
    this.gateHits.reset();
    this.gatePasses.reset();
    this.activations.reset();
    this.enemyHits.reset();
    this.kills.reset();
    this.leaks.reset();
    this.streamStarts.reset();
    this.streamClears.reset();
    this.gained.reset();
    this.lost.reset();
    this.bossActivations.reset();
    this.stomps.reset();
    this.bossKills.reset();
    this.ends.reset();
  }

  projectileFired(x: number, z: number): void {
    const e = this.fired.take();
    e.x = x;
    e.z = z;
    this.list.push(e);
  }

  projectileHit(weaponId: WeaponId, x: number, z: number): void {
    const e = this.impacts.take();
    e.weaponId = weaponId;
    e.x = x;
    e.z = z;
    this.list.push(e);
  }

  splash(x: number, z: number, radius: number): void {
    const e = this.splashes.take();
    e.x = x;
    e.z = z;
    e.radius = radius;
    this.list.push(e);
  }

  chain(from: number, to: number): void {
    const e = this.chains.take();
    e.from = from;
    e.to = to;
    this.list.push(e);
  }

  enemySlowed(enemyId: number, seconds: number): void {
    const e = this.slows.take();
    e.enemyId = enemyId;
    e.seconds = seconds;
    this.list.push(e);
  }

  enemyShattered(enemyId: number, x: number, z: number, streamId?: number): void {
    const e = this.shatters.take();
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
    const e = this.burns.take();
    e.enemyId = enemyId;
    e.x = x;
    e.z = z;
    e.seconds = seconds;
    this.list.push(e);
  }

  familiarShot(x: number, z: number, targetId: number): void {
    const e = this.familiarShots.take();
    e.x = x;
    e.z = z;
    e.targetId = targetId;
    this.list.push(e);
  }

  wallBlocked(boundary: -1 | 1, x: number, z: number): void {
    const e = this.wallBlocks.take();
    e.boundary = boundary;
    e.x = x;
    e.z = z;
    this.list.push(e);
  }

  weaponChanged(from: WeaponId, to: WeaponId): void {
    const e = this.weaponSwaps.take();
    e.from = from;
    e.to = to;
    this.list.push(e);
  }

  bossEnraged(enemyId: number): void {
    const e = this.enrages.take();
    e.enemyId = enemyId;
    this.list.push(e);
  }

  gateHit(gateId: number, kind: GateKind, value: number): void {
    const e = this.gateHits.take();
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
    const e = this.gatePasses.take();
    e.gateId = gateId;
    e.kind = kind;
    e.value = value;
    e.countBefore = countBefore;
    e.countAfter = countAfter;
    this.list.push(e);
  }

  enemyActivated(enemyId: number): void {
    const e = this.activations.take();
    e.enemyId = enemyId;
    this.list.push(e);
  }

  enemyHit(enemyId: number, damage: number, hp: number, x: number, z: number): void {
    const e = this.enemyHits.take();
    e.enemyId = enemyId;
    e.damage = damage;
    e.hp = hp;
    e.x = x;
    e.z = z;
    this.list.push(e);
  }

  enemyKilled(enemyId: number, kind: EnemyKind, x: number, z: number, streamId?: number): void {
    const e = this.kills.take();
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
    const e = this.leaks.take();
    e.enemyId = enemyId;
    e.streamId = streamId;
    e.x = x;
    e.z = z;
    this.list.push(e);
  }

  streamStarted(streamId: number, lane: Lane, count: number): void {
    const e = this.streamStarts.take();
    e.streamId = streamId;
    e.lane = lane;
    e.count = count;
    this.list.push(e);
  }

  streamCleared(streamId: number, lane: Lane, leaked: number): void {
    const e = this.streamClears.take();
    e.streamId = streamId;
    e.lane = lane;
    e.leaked = leaked;
    this.list.push(e);
  }

  unitsGained(amount: number): void {
    const e = this.gained.take();
    e.amount = amount;
    this.list.push(e);
  }

  unitsLost(amount: number, reason: UnitLossReason): void {
    const e = this.lost.take();
    e.amount = amount;
    e.reason = reason;
    this.list.push(e);
  }

  bossActivated(enemyId: number): void {
    const e = this.bossActivations.take();
    e.enemyId = enemyId;
    this.list.push(e);
  }

  bossStomp(x: number, z: number): void {
    const e = this.stomps.take();
    e.x = x;
    e.z = z;
    this.list.push(e);
  }

  bossKilled(): void {
    this.list.push(this.bossKills.take());
  }

  runEnded(status: RunStatus, survivors: number, peakCount: number): void {
    const e = this.ends.take();
    e.status = status;
    e.survivors = survivors;
    e.peakCount = peakCount;
    this.list.push(e);
  }
}
