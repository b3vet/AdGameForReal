/**
 * A frame's worth of physics-relevant sim events, copied out of the sim's pool.
 *
 * `Run.tick` re-uses its event objects between ticks, so under `?turbo` — where
 * a frame runs several ticks — the events of every tick but the last are gone
 * by the time the frame ends. The renderer and the HUD deal with that by
 * consuming each tick as it happens; the physics layer cannot, because it must
 * run exactly once per frame, after the render and on real frame time.
 *
 * So the app absorbs each tick's events into here and hands the whole frame's
 * list to `PhysicsLayer.onEvents` once. Only the five kinds the layer acts on
 * are copied, and every copy comes from a pool that stops growing after the
 * first busy frame.
 */

import type { EnemyKind, GateKind, SimEvent } from '@/sim';

interface KilledEvent {
  type: 'enemyKilled';
  enemyId: number;
  kind: EnemyKind;
  x: number;
  z: number;
  /** Copied too: the layer's debris rule turns on it (Milestone 3, D29). */
  streamId?: number;
}

interface ShatteredEvent {
  type: 'enemyShattered';
  enemyId: number;
  x: number;
  z: number;
  streamId?: number;
}

interface GatePassedEvent {
  type: 'gatePassed';
  gateId: number;
  kind: GateKind;
  value: number;
  countBefore: number;
  countAfter: number;
}

interface StompEvent {
  type: 'bossStomp';
  x: number;
  z: number;
}

interface BossKilledEvent {
  type: 'bossKilled';
}

/** Hands out pre-built objects and takes them all back at once. */
class Pool<T> {
  private readonly items: T[] = [];
  private used = 0;

  constructor(private readonly make: () => T) {}

  take(): T {
    const existing = this.items[this.used];
    if (existing !== undefined) {
      this.used++;
      return existing;
    }
    const created = this.make();
    this.items.push(created);
    this.used++;
    return created;
  }

  reset(): void {
    this.used = 0;
  }
}

export class PhysicsEventQueue {
  /** The list handed to `PhysicsLayer.onEvents`. Truncated, never rebuilt. */
  private readonly list: SimEvent[] = [];

  private readonly killed = new Pool<KilledEvent>(() => ({
    type: 'enemyKilled',
    enemyId: 0,
    kind: 'grunt',
    x: 0,
    z: 0,
  }));
  private readonly shattered = new Pool<ShatteredEvent>(() => ({
    type: 'enemyShattered',
    enemyId: 0,
    x: 0,
    z: 0,
  }));
  private readonly gates = new Pool<GatePassedEvent>(() => ({
    type: 'gatePassed',
    gateId: 0,
    kind: 'add',
    value: 0,
    countBefore: 0,
    countAfter: 0,
  }));
  private readonly stomps = new Pool<StompEvent>(() => ({ type: 'bossStomp', x: 0, z: 0 }));
  private readonly bossKills = new Pool<BossKilledEvent>(() => ({ type: 'bossKilled' }));

  /** The events absorbed since the last `clear`. */
  get events(): readonly SimEvent[] {
    return this.list;
  }

  clear(): void {
    this.list.length = 0;
    this.killed.reset();
    this.shattered.reset();
    this.gates.reset();
    this.stomps.reset();
    this.bossKills.reset();
  }

  /** Copies the physics-relevant events out of one tick's list. */
  absorb(events: readonly SimEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'enemyKilled': {
          const slot = this.killed.take();
          slot.enemyId = event.enemyId;
          slot.kind = event.kind;
          slot.x = event.x;
          slot.z = event.z;
          // Deleted rather than left over from the last body this slot carried:
          // a pooled object that kept a stale `streamId` would tell the physics
          // layer a block was a stream body and swallow its ragdolls.
          if (event.streamId === undefined) delete slot.streamId;
          else slot.streamId = event.streamId;
          this.list.push(slot);
          break;
        }
        case 'enemyShattered': {
          const slot = this.shattered.take();
          slot.enemyId = event.enemyId;
          slot.x = event.x;
          slot.z = event.z;
          if (event.streamId === undefined) delete slot.streamId;
          else slot.streamId = event.streamId;
          this.list.push(slot);
          break;
        }
        case 'gatePassed': {
          const slot = this.gates.take();
          slot.gateId = event.gateId;
          slot.kind = event.kind;
          slot.value = event.value;
          slot.countBefore = event.countBefore;
          slot.countAfter = event.countAfter;
          this.list.push(slot);
          break;
        }
        case 'bossStomp': {
          const slot = this.stomps.take();
          slot.x = event.x;
          slot.z = event.z;
          this.list.push(slot);
          break;
        }
        case 'bossKilled':
          this.list.push(this.bossKills.take());
          break;
        default:
          // Everything else is the renderer's, the HUD's or the audio's.
          break;
      }
    }
  }
}
