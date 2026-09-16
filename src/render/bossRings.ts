/**
 * The boss's shockwave rings: a stomp landing, and since document 29 the Rime
 * Fiend's charge landing on the column.
 *
 * Split out of `./boss.ts` for the file-size rule (CLAUDE.md). It is the one
 * part of that view that is about the ground rather than the body, and a ring
 * started here lives out its sweep whatever the body does next.
 */

import type { Scene } from '@babylonjs/core/scene';

import { RingPool } from './rings';
import {
  POOL,
  STOMP_ALPHA,
  STOMP_COLOR,
  STOMP_DURATION,
  STOMP_MAX_RADIUS,
  STOMP_THICKNESS,
} from './theme';

/** Rings start as a tight shockwave under the boss and sweep outward. */
const RING_START_RADIUS = 0.8;

interface Ring {
  x: number;
  z: number;
  age: number;
}

export class ShockRings {
  private readonly pool: RingPool;
  private readonly rings: Ring[] = [];

  constructor(scene: Scene) {
    // Thin: the ring is a tell, not the event. A fat bright ring swallows the
    // boss it is meant to sell — which is exactly what the Phase B2 frames
    // showed, and the additive blend does the rest.
    this.pool = new RingPool(scene, 'stomp', STOMP_COLOR, POOL.stompRings, {
      thickness: STOMP_THICKNESS,
      alpha: STOMP_ALPHA,
      additive: true,
      y: 0.12,
    });
    for (let i = 0; i < POOL.stompRings; i++) this.rings.push({ x: 0, z: 0, age: -1 });
  }

  /** A ring starting at `(x, z)`. */
  start(x: number, z: number): void {
    // A free ring, or the one that has swept out furthest: the pool is small on
    // purpose (see `POOL.stompRings`), and the newest wave is the one that
    // matters.
    let chosen = this.rings[0];
    for (const ring of this.rings) {
      if (ring.age < 0) {
        chosen = ring;
        break;
      }
      if (chosen !== undefined && chosen.age >= 0 && ring.age > chosen.age) chosen = ring;
    }
    if (chosen !== undefined) {
      chosen.x = x;
      chosen.z = z;
      chosen.age = 0;
    }
  }

  update(dt: number): void {
    this.pool.begin();
    for (const ring of this.rings) {
      if (ring.age < 0) continue;
      ring.age += dt;
      if (ring.age >= STOMP_DURATION) {
        ring.age = -1;
        continue;
      }
      const p = ring.age / STOMP_DURATION;
      this.pool.add(ring.x, ring.z, RING_START_RADIUS + (STOMP_MAX_RADIUS - RING_START_RADIUS) * p);
    }
    this.pool.end();
  }

  reset(): void {
    for (const ring of this.rings) ring.age = -1;
    this.pool.reset();
  }

  dispose(): void {
    this.pool.dispose();
    this.rings.length = 0;
  }
}
