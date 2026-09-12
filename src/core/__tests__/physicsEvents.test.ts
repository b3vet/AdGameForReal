import { describe, expect, it } from 'vitest';

import type { SimEvent } from '@/sim';

import { PhysicsEventQueue } from '../physicsEvents';

describe('PhysicsEventQueue', () => {
  it('keeps only the events the physics layer acts on', () => {
    const queue = new PhysicsEventQueue();
    queue.absorb([
      { type: 'projectileFired', x: 0, z: 0 },
      { type: 'enemyKilled', enemyId: 3, kind: 'brute', x: 1, z: 2 },
      { type: 'enemyHit', enemyId: 3, damage: 1, hp: 2, x: 1, z: 2 },
      { type: 'enemyShattered', enemyId: 4, x: 3, z: 4 },
      { type: 'gatePassed', gateId: 7, kind: 'add', value: 5, countBefore: 10, countAfter: 15 },
      { type: 'bossStomp', x: 0, z: 30 },
      { type: 'bossKilled' },
      { type: 'runEnded', status: 'won', survivors: 12, peakCount: 40 },
    ]);

    expect(queue.events.map((event) => event.type)).toEqual([
      'enemyKilled',
      'enemyShattered',
      'gatePassed',
      'bossStomp',
      'bossKilled',
    ]);
  });

  /**
   * The reason this class exists: the sim re-uses its event objects between
   * ticks, so a reference held across a tick would report the wrong position.
   */
  it('copies, so a re-used source object cannot rewrite the frame', () => {
    const queue = new PhysicsEventQueue();
    const pooled: SimEvent = { type: 'enemyKilled', enemyId: 1, kind: 'grunt', x: 1, z: 1 };
    const source: SimEvent[] = [pooled];

    queue.absorb(source);
    // What the sim does on the next tick: same object, new numbers.
    pooled.x = 99;
    pooled.z = 99;
    pooled.enemyId = 2;
    queue.absorb(source);

    expect(queue.events).toHaveLength(2);
    expect(queue.events[0]).toMatchObject({ enemyId: 1, x: 1, z: 1 });
    expect(queue.events[1]).toMatchObject({ enemyId: 2, x: 99, z: 99 });
  });

  /**
   * The physics layer's whole stream rule turns on `streamId`, and the slot it
   * is copied into is pooled — so a block re-using the slot of a stream body
   * would inherit its id and lose its ragdolls.
   */
  it('carries streamId, and does not leave it on the next body in the slot', () => {
    const queue = new PhysicsEventQueue();
    queue.absorb([
      { type: 'enemyKilled', enemyId: 1, kind: 'grunt', x: 0, z: 0, streamId: 4 },
      { type: 'enemyShattered', enemyId: 1, x: 0, z: 0, streamId: 4 },
    ]);
    expect(queue.events[0]).toMatchObject({ streamId: 4 });
    expect(queue.events[1]).toMatchObject({ streamId: 4 });

    queue.clear();
    queue.absorb([
      { type: 'enemyKilled', enemyId: 2, kind: 'brute', x: 0, z: 0 },
      { type: 'enemyShattered', enemyId: 2, x: 0, z: 0 },
    ]);
    expect(queue.events[0]).not.toHaveProperty('streamId');
    expect(queue.events[1]).not.toHaveProperty('streamId');
  });

  it('re-uses its pool across frames without leaking the last one', () => {
    const queue = new PhysicsEventQueue();
    queue.absorb([
      { type: 'bossStomp', x: 1, z: 1 },
      { type: 'bossStomp', x: 2, z: 2 },
    ]);
    const first = queue.events[0];

    queue.clear();
    expect(queue.events).toHaveLength(0);

    queue.absorb([{ type: 'bossStomp', x: 5, z: 6 }]);
    expect(queue.events).toHaveLength(1);
    expect(queue.events[0]).toMatchObject({ x: 5, z: 6 });
    // Same slot, so the pool is not growing one object per frame.
    expect(queue.events[0]).toBe(first);
  });
});
