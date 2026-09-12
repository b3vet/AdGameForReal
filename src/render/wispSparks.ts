/**
 * The wisp's fire (D33): the sparks it throws and the flashes they land with.
 *
 * Split out of `./wisp.ts` for the file-size rule; that file is the familiar
 * itself — where it hovers, how big it is, how many rings it wears — and this
 * is everything between a shot leaving it and a body reacting.
 *
 * The one rule that matters is the timing. The sim resolves a wisp shot as a
 * *delayed* hit: `Familiar.launch` sets `arriveAt = time + distance /
 * wisp.sparkSpeed`, measured from the wisp to the target at the moment of
 * firing, and the damage lands then. So this reads the same `sparkSpeed` out of
 * `progression.json` and gives a spark exactly that long to fly — and then
 * homes it on the target's *current* position every frame, so it arrives on the
 * body rather than on the patch of road the body stood on when the shot went
 * out. Damage and impact land on the same frame either way, which is the whole
 * point of the sim exposing the speed rather than hitscanning.
 *
 * A spark whose target dies mid-flight fizzles where it is, because the sim's
 * does too.
 */

import type { SpriteLayer } from './sprites';
import { bookCell, bookCellLooping } from './spriteSheets';
import {
  POOL,
  WISP_BURST_DURATION,
  WISP_BURST_SIZE,
  WISP_COLOR,
  WISP_FIZZLE_DURATION,
  WISP_SPARK_SIZE,
  WISP_SPARK_TAIL,
  WISP_SPARK_TAIL_GAP,
  WISP_SPARK_Y,
  WISP_Y,
} from './theme';
import { progression } from '@/sim';

/** Where a spark can be told the target is, frame by frame. */
export interface TargetLookup {
  (enemyId: number, out: { x: number; z: number }): boolean;
}

interface Spark {
  /** Where it was fired from, which is where the interpolation starts. */
  fromX: number;
  fromZ: number;
  /** Last known target position; a dead target freezes the spark's aim here. */
  toX: number;
  toZ: number;
  targetId: number;
  age: number;
  /** `distance / sparkSpeed`, the sim's own flight time for this shot. */
  flight: number;
  /** Counting down once the target is gone, or -1 while it is still flying. */
  fizzle: number;
}

interface Burst {
  x: number;
  z: number;
  age: number;
}

/** Scratch for the per-frame target lookup, which must not allocate. */
const scratchTarget = { x: 0, z: 0 };

export class SparkPool {
  private readonly sprites: SpriteLayer;
  private readonly sparkSpeed: number;

  private readonly sparks: Spark[] = [];
  private sparkCount = 0;
  private readonly bursts: Burst[] = [];
  private burstCount = 0;

  /** Shared with the orb, so head and trail shimmer on the same clock. */
  private phase = 0;

  constructor(sprites: SpriteLayer) {
    this.sprites = sprites;
    this.sparkSpeed = Math.max(1, progression.wisp.sparkSpeed);

    for (let i = 0; i < POOL.wispSparks; i++) {
      this.sparks.push({
        fromX: 0,
        fromZ: 0,
        toX: 0,
        toZ: 0,
        targetId: -1,
        age: 0,
        flight: 1,
        fizzle: -1,
      });
    }
    for (let i = 0; i < POOL.wispBursts; i++) this.bursts.push({ x: 0, z: 0, age: 0 });
  }

  reset(): void {
    this.sparkCount = 0;
    this.burstCount = 0;
    this.phase = 0;
  }

  /** Sparks in the air, for the debug panel and the dev harness. */
  get inFlight(): number {
    return this.sparkCount;
  }

  /**
   * `familiarShot`: fire a spark from the wisp at `(x, z)` toward `targetId`.
   *
   * The flight time is the sim's, recomputed here from the same data rather
   * than carried on the event: the event says who was shot at, the data says
   * how fast a spark flies, and the two together are the arrival the sim has
   * already scheduled.
   */
  launch(x: number, z: number, targetId: number, lookup: TargetLookup): void {
    if (this.sparkCount >= this.sparks.length) return;
    const spark = this.sparks[this.sparkCount];
    if (spark === undefined) return;
    if (!lookup(targetId, scratchTarget)) return;

    spark.fromX = x;
    spark.fromZ = z;
    spark.toX = scratchTarget.x;
    spark.toZ = scratchTarget.z;
    spark.targetId = targetId;
    spark.age = 0;
    spark.flight = Math.max(
      1 / 60,
      Math.hypot(scratchTarget.x - x, scratchTarget.z - z) / this.sparkSpeed,
    );
    spark.fizzle = -1;
    this.sparkCount++;
  }

  update(lookup: TargetLookup, dt: number): void {
    this.phase += dt;
    this.updateSparks(lookup, dt);
    this.updateBursts(dt);
  }

  private pushBurst(x: number, z: number): void {
    if (this.burstCount >= this.bursts.length) return;
    const burst = this.bursts[this.burstCount];
    if (burst === undefined) return;
    burst.x = x;
    burst.z = z;
    burst.age = 0;
    this.burstCount++;
  }

  private updateSparks(lookup: TargetLookup, dt: number): void {
    let write = 0;
    for (let i = 0; i < this.sparkCount; i++) {
      const spark = this.sparks[i];
      if (spark === undefined) continue;

      if (spark.fizzle >= 0) {
        spark.fizzle -= dt;
        if (spark.fizzle <= 0) continue;
        const fade = spark.fizzle / WISP_FIZZLE_DURATION;
        this.drawSpark(spark.toX, WISP_SPARK_Y, spark.toZ, 0, 0, fade);
        write = this.keep(spark, write, i);
        continue;
      }

      spark.age += dt;
      // Homing: the aim is refreshed from wherever the body is now, so the
      // spark meets it rather than the road it was standing on.
      if (lookup(spark.targetId, scratchTarget)) {
        spark.toX = scratchTarget.x;
        spark.toZ = scratchTarget.z;
      } else if (spark.age < spark.flight) {
        // Gone before the sim could resolve it: the sim's spark fizzles too.
        spark.fizzle = WISP_FIZZLE_DURATION;
        write = this.keep(spark, write, i);
        continue;
      }

      if (spark.age >= spark.flight) {
        this.pushBurst(spark.toX, spark.toZ);
        continue;
      }

      const t = spark.age / spark.flight;
      const x = spark.fromX + (spark.toX - spark.fromX) * t;
      const z = spark.fromZ + (spark.toZ - spark.fromZ) * t;
      const dx = spark.toX - spark.fromX;
      const dz = spark.toZ - spark.fromZ;
      const length = Math.max(0.001, Math.hypot(dx, dz));
      this.drawSpark(x, WISP_Y + (WISP_SPARK_Y - WISP_Y) * t, z, dx / length, dz / length, 1);
      write = this.keep(spark, write, i);
    }
    this.sparkCount = write;
  }

  /** The head, and the couple of quads trailing it along its own heading. */
  private drawSpark(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
    alpha: number,
  ): void {
    this.sprites.add(
      bookCellLooping('wispSpark', this.phase * 3),
      x,
      y,
      z,
      WISP_SPARK_SIZE,
      WISP_COLOR.r,
      WISP_COLOR.g,
      WISP_COLOR.b,
      alpha,
    );
    for (let tail = 1; tail <= WISP_SPARK_TAIL; tail++) {
      const back = tail * WISP_SPARK_TAIL_GAP;
      this.sprites.add(
        bookCellLooping('sparkle', this.phase * 2 + tail * 0.25),
        x - dirX * back,
        y,
        z - dirZ * back,
        WISP_SPARK_SIZE * (0.7 - tail * 0.18),
        WISP_COLOR.r,
        WISP_COLOR.g,
        WISP_COLOR.b,
        alpha * (0.5 - tail * 0.12),
      );
    }
  }

  private updateBursts(dt: number): void {
    let write = 0;
    for (let i = 0; i < this.burstCount; i++) {
      const burst = this.bursts[i];
      if (burst === undefined) continue;
      burst.age += dt;
      if (burst.age >= WISP_BURST_DURATION) continue;
      const phase = burst.age / WISP_BURST_DURATION;
      this.sprites.add(
        bookCell('wispBurst', phase),
        burst.x,
        WISP_SPARK_Y,
        burst.z,
        WISP_BURST_SIZE * (0.7 + phase * 0.6),
        WISP_COLOR.r,
        WISP_COLOR.g,
        WISP_COLOR.b,
        1,
      );
      const kept = this.bursts[write];
      if (kept !== undefined && write !== i) {
        kept.x = burst.x;
        kept.z = burst.z;
        kept.age = burst.age;
      }
      write++;
    }
    this.burstCount = write;
  }

  /** Compacts a live spark down to `write`; returns the next write index. */
  private keep(spark: Spark, write: number, index: number): number {
    const kept = this.sparks[write];
    if (kept !== undefined && write !== index) {
      kept.fromX = spark.fromX;
      kept.fromZ = spark.fromZ;
      kept.toX = spark.toX;
      kept.toZ = spark.toZ;
      kept.targetId = spark.targetId;
      kept.age = spark.age;
      kept.flight = spark.flight;
      kept.fizzle = spark.fizzle;
    }
    return write + 1;
  }
}
