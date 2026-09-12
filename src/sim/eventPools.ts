/**
 * The blank event each pool hands out.
 *
 * Split out of `./events.ts` in Milestone 4 Phase C, which had grown past the
 * file-size rule (CLAUDE.md). This half is the *shape* of every event — one
 * zeroed object per kind, which `Pool` hands out and the buffer fills in — and
 * `./events.ts` is the buffer itself: what each emitter writes into its blank
 * and the order the events come out in.
 *
 * Every field is on the blank, optional ones included, because a pool re-uses
 * its objects: an emitter that left a field alone would otherwise find the last
 * tick's value in it. The two fields that really are optional are deleted
 * rather than written (`enemyKilled`, `enemyShattered`), for the reason the
 * comment there gives.
 */

import { Pool } from './pool';
import type { SimEvent } from './types';

/** The one event of `SimEvent` whose `type` is `T`. */
export type EventOf<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;

/** One free list per event kind, keyed by the name the buffer emits it under. */
export type EventPools = ReturnType<typeof createEventPools>;

export function createEventPools() {
  return {
    fired: new Pool<EventOf<'projectileFired'>>(() => ({ type: 'projectileFired', x: 0, z: 0 })),
    impacts: new Pool<EventOf<'projectileHit'>>(() => ({
      type: 'projectileHit',
      weaponId: 'ember',
      x: 0,
      z: 0,
    })),
    splashes: new Pool<EventOf<'splash'>>(() => ({ type: 'splash', x: 0, z: 0, radius: 0 })),
    chains: new Pool<EventOf<'chain'>>(() => ({ type: 'chain', from: 0, to: 0 })),
    slows: new Pool<EventOf<'enemySlowed'>>(() => ({ type: 'enemySlowed', enemyId: 0, seconds: 0 })),
    shatters: new Pool<EventOf<'enemyShattered'>>(() => ({
      type: 'enemyShattered',
      enemyId: 0,
      x: 0,
      z: 0,
    })),
    burns: new Pool<EventOf<'enemyBurning'>>(() => ({
      type: 'enemyBurning',
      enemyId: 0,
      x: 0,
      z: 0,
      seconds: 0,
    })),
    familiarShots: new Pool<EventOf<'familiarShot'>>(() => ({
      type: 'familiarShot',
      x: 0,
      z: 0,
      targetId: 0,
    })),
    wallBlocks: new Pool<EventOf<'wallBlocked'>>(() => ({
      type: 'wallBlocked',
      boundary: 1,
      x: 0,
      z: 0,
    })),
    weaponSwaps: new Pool<EventOf<'weaponChanged'>>(() => ({
      type: 'weaponChanged',
      from: 'ember',
      to: 'ember',
    })),
    enrages: new Pool<EventOf<'bossEnraged'>>(() => ({ type: 'bossEnraged', enemyId: 0 })),
    gateHits: new Pool<EventOf<'gateHit'>>(() => ({
      type: 'gateHit',
      gateId: 0,
      kind: 'add',
      value: 0,
    })),
    gatePasses: new Pool<EventOf<'gatePassed'>>(() => ({
      type: 'gatePassed',
      gateId: 0,
      kind: 'add',
      value: 0,
      countBefore: 0,
      countAfter: 0,
    })),
    activations: new Pool<EventOf<'enemyActivated'>>(() => ({ type: 'enemyActivated', enemyId: 0 })),
    enemyHits: new Pool<EventOf<'enemyHit'>>(() => ({
      type: 'enemyHit',
      enemyId: 0,
      damage: 0,
      hp: 0,
      x: 0,
      z: 0,
    })),
    kills: new Pool<EventOf<'enemyKilled'>>(() => ({
      type: 'enemyKilled',
      enemyId: 0,
      kind: 'grunt',
      x: 0,
      z: 0,
    })),
    leaks: new Pool<EventOf<'enemyLeaked'>>(() => ({
      type: 'enemyLeaked',
      enemyId: 0,
      streamId: 0,
      x: 0,
      z: 0,
    })),
    streamStarts: new Pool<EventOf<'streamStarted'>>(() => ({
      type: 'streamStarted',
      streamId: 0,
      lane: 0,
      count: 0,
    })),
    streamClears: new Pool<EventOf<'streamCleared'>>(() => ({
      type: 'streamCleared',
      streamId: 0,
      lane: 0,
      leaked: 0,
    })),
    gained: new Pool<EventOf<'unitsGained'>>(() => ({
      type: 'unitsGained',
      amount: 0,
      reason: 'gate',
    })),
    lost: new Pool<EventOf<'unitsLost'>>(() => ({ type: 'unitsLost', amount: 0, reason: 'contact' })),
    bossActivations: new Pool<EventOf<'bossActivated'>>(() => ({
      type: 'bossActivated',
      enemyId: 0,
    })),
    stomps: new Pool<EventOf<'bossStomp'>>(() => ({ type: 'bossStomp', x: 0, z: 0 })),
    bossKills: new Pool<EventOf<'bossKilled'>>(() => ({ type: 'bossKilled' })),
    ends: new Pool<EventOf<'runEnded'>>(() => ({
      type: 'runEnded',
      status: 'won',
      survivors: 0,
      peakCount: 0,
    })),
  };
}

/** Every pool back to empty; the buffer calls this once per `tick`. */
export function resetEventPools(pools: EventPools): void {
  for (const pool of Object.values(pools)) pool.reset();
}
