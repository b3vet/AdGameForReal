/**
 * The stress scene's stream: three hundred bodies walking two lanes, dying on a
 * timer and being recycled, with no sim behind them.
 *
 * It exists because the frame the game has to hold up under is not five hundred
 * mages standing still (Milestone 2's worst case) but five hundred mages plus a
 * horde pouring down the road (D29): three hundred more animated instances in
 * the same crowd, a death animation starting twenty times a second, and a
 * ragdoll every tenth of those. Nothing here is gameplay — the bodies walk in a
 * straight line and respawn at the far end — but everything it costs the
 * renderer and the physics layer is what the real thing costs, because it goes
 * through the same crowd, the same `usesRagdoll` rule and the same events.
 *
 * Lives in `src/core` beside `stress.ts` for the same reason that file does:
 * the smoke drives it through the app and `dist/` carries no dev pages.
 */

import { balance } from '@/data';
import type { Crowd } from '@/render/characters';
import { usesRagdoll } from '@/render/deathStyle';
import { GRUNT_SCALE } from '@/render/theme';
import { laneCenter, mulberry32 } from '@/sim';
import type { SimEvent } from '@/sim';

/** Bodies face the squad, which is behind them down the road. */
const FACING = Math.PI;
/** One body in this many runs rather than walks, as `StreamBodies` does. */
const RUNNER_EVERY = 3;
const GAIT_SPREAD = 0.22;

/** The stretch of road the river occupies, in front of the crowd. */
const FAR_Z = 46;
const NEAR_Z = 6;

/**
 * Kills one call may make, however long the frame was.
 *
 * The kill timer runs on the wall clock rather than the clamped frame delta,
 * or a software rasteriser at one frame a second would kill one body a frame
 * and there would be nothing to measure. On such a machine a frame is worth
 * twenty-six kills, though, and firing all of them at once empties a quarter of
 * the river in one step — so the surplus is dropped rather than banked.
 */
const MAX_KILLS_PER_UPDATE = 8;

interface Body {
  readonly id: number;
  readonly lane: number;
  readonly offset: number;
  readonly gait: number;
  z: number;
  alive: boolean;
  /** Seconds since this body died; only meaningful while `alive` is false. */
  age: number;
}

/**
 * One pooled `enemyKilled` per body, so a kill costs no allocation on the frame
 * path. The physics layer reads `streamId` and nothing else about the stream.
 */
const STREAM_ID = 1;

export class StressBodies {
  private readonly bodies: Body[] = [];
  private readonly killEvents: SimEvent[] = [];
  private readonly killEvery: number;
  private sinceKill = 0;
  private nextKill = 0;
  private deathSeconds = 1;
  private live = 0;

  constructor(count: number, lanes: readonly number[], killEvery: number) {
    const random = mulberry32(0xb0_d1_e5);
    this.killEvery = killEvery;
    for (let i = 0; i < count; i++) {
      const lane = lanes[i % lanes.length] ?? 0;
      this.bodies.push({
        id: i + 1,
        lane: laneCenter(lane as -1 | 0 | 1),
        offset: (random() * 2 - 1) * balance.streams.jitter,
        gait: 1 + (random() * 2 - 1) * GAIT_SPREAD,
        // Spread down the road, so the river is already full on the first frame.
        z: NEAR_Z + ((i + 1) / count) * (FAR_Z - NEAR_Z),
        alive: true,
        age: 0,
      });
      this.killEvents.push({
        type: 'enemyKilled',
        enemyId: i + 1,
        kind: 'grunt',
        x: 0,
        z: 0,
        streamId: STREAM_ID,
      });
    }
    this.live = count;
  }

  /** How many are on their feet right now, for the readout. */
  get liveCount(): number {
    return this.live;
  }

  /** Told once, after the crowd is loaded: how long the baked death runs for. */
  setDeathSeconds(seconds: number): void {
    this.deathSeconds = Math.max(0.05, seconds);
  }

  /**
   * Walks every live body, ages every corpse, and kills bodies on the wall
   * clock — appending each kill to `events` exactly as the sim would, so the
   * physics layer's stream rule is the thing being measured.
   *
   * Two clocks, for the reason `stress.ts` gives: `dt` is the clamped frame
   * delta the game feeds its pools, so a body's stride is a stride; `real` is
   * the wall clock, so the deaths and the corpse recycle keep their rate on a
   * machine drawing one frame a second.
   */
  update(dt: number, real: number, events: SimEvent[]): void {
    const speed = balance.streams.speed;
    const corpse = balance.enemies.corpseSeconds;

    for (const body of this.bodies) {
      if (body.alive) {
        body.z -= speed * body.gait * dt;
        if (body.z < NEAR_Z) body.z = FAR_Z;
        continue;
      }
      body.age += real;
      if (body.age < corpse) continue;
      body.alive = true;
      this.live++;
      body.z = FAR_Z;
    }

    if (this.killEvery <= 0) return;
    this.sinceKill += real;
    let killed = 0;
    while (this.sinceKill >= this.killEvery && killed < MAX_KILLS_PER_UPDATE) {
      this.sinceKill -= this.killEvery;
      this.kill(events);
      killed++;
    }
    if (killed >= MAX_KILLS_PER_UPDATE) this.sinceKill = 0;
  }

  /**
   * Writes the river into `crowd` from `base`, and answers how many it wrote.
   *
   * The same two skips the game makes: a body the physics layer is about to
   * throw is not drawn here, and a corpse past its window is gone.
   */
  write(crowd: Crowd, base: number, physicsQuality: number): number {
    const ragdolls = physicsQuality > 0;
    const corpse = balance.enemies.corpseSeconds;
    let written = 0;

    for (const body of this.bodies) {
      if (base + written >= crowd.capacity) break;
      if (body.alive) {
        crowd.setInstance(
          base + written,
          body.lane + body.offset,
          0,
          body.z,
          FACING,
          GRUNT_SCALE,
          body.id % RUNNER_EVERY === 0 ? 'walk2' : 'walk',
          (body.id % 13) * 0.031,
          body.gait,
        );
        written++;
        continue;
      }
      if (ragdolls && usesRagdoll(body.id)) continue;
      // Speed 0 makes the offset *the frame*: a looping baked range played once.
      crowd.setInstance(
        base + written,
        body.lane + body.offset,
        0,
        body.z,
        FACING,
        GRUNT_SCALE,
        'death',
        (body.age / corpse) * this.deathSeconds,
        0,
      );
      written++;
    }
    return written;
  }

  /** The next live body in the ring, so every id — and every tenth — takes a turn. */
  private kill(events: SimEvent[]): void {
    for (let tries = 0; tries < this.bodies.length; tries++) {
      const index = this.nextKill;
      this.nextKill = (this.nextKill + 1) % this.bodies.length;
      const body = this.bodies[index];
      const event = this.killEvents[index];
      if (body === undefined || event === undefined || !body.alive) continue;
      body.alive = false;
      body.age = 0;
      this.live--;
      if (event.type === 'enemyKilled') {
        event.x = body.lane + body.offset;
        event.z = body.z;
      }
      events.push(event);
      return;
    }
  }
}
