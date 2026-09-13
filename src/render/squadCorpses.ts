/**
 * The squad's dead: a fixed ring of shrinking mages, drawn out of the same
 * instance buffer as the living crowd.
 *
 * Split out of `./squad.ts` in D42, which had grown past the file-size rule
 * (CLAUDE.md) when the column's hop wave and depth lag went in. It is a clean
 * seam: the view decides *who* died and where they were drawn, and this decides
 * how long they stay and what they look like while they do.
 *
 * They are written straight after the live units in the crowd's buffer, so the
 * dead cost no draw call of their own and keep the staff the squad was holding
 * when they fell. A full ring simply drops the extras: a frame that kills more
 * mages than the pool holds is a frame nobody is counting corpses in.
 *
 * D43 gives each corpse the *velocity* its unit had on the last step it was
 * alive, as well as its position. A unit is an agent now: it is shoved back by
 * the body that is about to kill it, it is spilling along a fence, it is
 * scurrying home from a straggler group — and a corpse that stopped dead on the
 * frame it died threw all of that away. It carries the motion a short way and
 * loses it to `DRAG`, which is what reads as a body going down rather than a
 * mage being switched off.
 */

import type { Crowd } from './characters';
import { DEATH_DURATION, IDLE_CLIP_SPEED, MAGE_SCALE, POOL, timeOffsetOf, yawOf } from './theme';

/**
 * How much of its speed a corpse keeps per second, and how fast a body may be
 * carried at all. A tenth of the speed left after a second is a stumble
 * forward, not a slide; the cap is there because the sim's own speeds include a
 * slot whipping sideways at the head's 24 m/s, and a corpse thrown across a
 * lane would read as a ragdoll the renderer does not have.
 */
const DRAG = 0.1;
const MAX_SPEED = 3;

interface Corpse {
  x: number;
  z: number;
  /** Metres a second the body was moving at when it died; drained by `DRAG`. */
  vx: number;
  vz: number;
  age: number;
  /** The crowd scale this unit died at, so it shrinks from the size it had. */
  scale: number;
  /**
   * The formation slot this unit stood in. Its yaw and animation phase are
   * derived from it, and the ring compacts as corpses expire, so deriving them
   * from the *slot in the ring* instead would swing a dying mage's facing every
   * time an older one finished.
   */
  index: number;
}

export class CorpseRing {
  /** Preallocated in full: a death must not allocate on the frame path. */
  private readonly corpses: Corpse[] = [];
  private count = 0;

  constructor() {
    for (let i = 0; i < POOL.dyingUnits; i++) {
      this.corpses.push({ x: 0, z: 0, vx: 0, vz: 0, age: 0, scale: 1, index: 0 });
    }
  }

  /** A new level: nothing is left standing, or lying, from the run before. */
  clear(): void {
    this.count = 0;
  }

  /**
   * A unit left the crowd, at the position, velocity and size it was *drawn*
   * at: where the player last saw that mage standing and which way it was
   * going, not where a formation slot says it should have been.
   */
  push(x: number, z: number, vx: number, vz: number, scale: number, index: number): void {
    if (this.count >= POOL.dyingUnits) return;
    const corpse = this.corpses[this.count];
    if (corpse === undefined) return;
    corpse.x = x;
    corpse.z = z;
    corpse.vx = clampSpeed(vx);
    corpse.vz = clampSpeed(vz);
    corpse.age = 0;
    corpse.scale = scale;
    corpse.index = index;
    this.count++;
  }

  /**
   * Ages every corpse and writes the live ones into `crowd` from `base` on,
   * compacting the ring as it goes. Answers how many instances it wrote, which
   * is what the caller adds to its own count before committing.
   */
  write(crowd: Crowd, base: number, dt: number): number {
    let write = 0;
    for (let i = 0; i < this.count; i++) {
      const corpse = this.corpses[i];
      if (corpse === undefined) continue;
      corpse.age += dt;
      if (corpse.age >= DEATH_DURATION) continue;

      // Frame-rate independent drag, so a body goes down the same distance at
      // 30 fps and at 120.
      const keep = Math.pow(DRAG, dt);
      corpse.x += corpse.vx * dt;
      corpse.z += corpse.vz * dt;
      corpse.vx *= keep;
      corpse.vz *= keep;

      const fade = 1 - corpse.age / DEATH_DURATION;
      crowd.setInstance(
        base + write,
        corpse.x,
        0,
        corpse.z,
        yawOf(corpse.index),
        corpse.scale * MAGE_SCALE * fade,
        'idle',
        timeOffsetOf(corpse.index),
        IDLE_CLIP_SPEED,
      );

      const kept = this.corpses[write];
      if (kept !== undefined && write !== i) {
        kept.x = corpse.x;
        kept.z = corpse.z;
        kept.vx = corpse.vx;
        kept.vz = corpse.vz;
        kept.age = corpse.age;
        kept.scale = corpse.scale;
        kept.index = corpse.index;
      }
      write++;
    }
    this.count = write;
    return write;
  }
}

/** A body may go down fast; it may not be thrown across the road. */
function clampSpeed(value: number): number {
  return value > MAX_SPEED ? MAX_SPEED : value < -MAX_SPEED ? -MAX_SPEED : value;
}
