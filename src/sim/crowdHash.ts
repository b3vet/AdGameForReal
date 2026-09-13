/**
 * The neighbour index the separation force and the enemy shove read.
 *
 * A uniform grid folded into a fixed number of buckets by an integer hash,
 * rebuilt from scratch every step by a counting sort over pooled `Int32Array`s.
 * A dense grid would be simpler, but the crowd's bounding box is not bounded:
 * a straggler group left twenty metres behind the column would size the grid
 * for the gap rather than for the bodies. A hash has no bounding box at all,
 * costs one multiply-xor per cell, and a collision only ever adds a candidate
 * that fails the distance test.
 *
 * The cell each unit really sits in is kept alongside it (`cellX`, `cellZ`) so
 * a query can drop the colliders: two different cells sharing a bucket would
 * otherwise let the same neighbour be counted twice in one pass, and a doubled
 * separation push is a unit that jitters.
 *
 * Nothing here allocates after the constructor (CLAUDE.md).
 */

import type { CrowdState } from './types';

/** Odd 32-bit constants; the usual pair from Teschner's spatial hashing. */
const HASH_X = 92_837_111;
const HASH_Z = 689_287_499;

export class CrowdHash {
  /** Which cell each unit was in when the index was last built. */
  readonly cellX: Int32Array;
  readonly cellZ: Int32Array;

  /** `starts[b]` to `starts[b + 1]` is bucket `b`'s slice of `items`. */
  private readonly starts: Int32Array;
  private readonly cursor: Int32Array;
  private readonly items: Int32Array;
  private readonly mask: number;

  private inverseCell = 1;

  constructor(capacity: number) {
    const wanted = Math.max(64, capacity * 4);
    let buckets = 64;
    while (buckets < wanted) buckets *= 2;
    this.mask = buckets - 1;
    this.starts = new Int32Array(buckets + 1);
    this.cursor = new Int32Array(buckets + 1);
    this.items = new Int32Array(capacity);
    this.cellX = new Int32Array(capacity);
    this.cellZ = new Int32Array(capacity);
  }

  /** Files every live unit. `cell` is the query radius: neighbours are found
   *  by walking the nine cells around a point, so it must not be smaller than
   *  the furthest either the separation force or the body projection reaches. */
  build(crowd: CrowdState, cell: number): void {
    const inverse = 1 / Math.max(1e-3, cell);
    this.inverseCell = inverse;

    const starts = this.starts;
    starts.fill(0);

    const alive = crowd.alive;
    const x = crowd.x;
    const z = crowd.z;
    const capacity = crowd.capacity;

    for (let i = 0; i < capacity; i++) {
      if ((alive[i] ?? 0) === 0) continue;
      const cx = Math.floor((x[i] ?? 0) * inverse);
      const cz = Math.floor((z[i] ?? 0) * inverse);
      this.cellX[i] = cx;
      this.cellZ[i] = cz;
      const bucket = this.bucketOf(cx, cz) + 1;
      starts[bucket] = (starts[bucket] ?? 0) + 1;
    }

    for (let b = 1; b < starts.length; b++) {
      starts[b] = (starts[b] ?? 0) + (starts[b - 1] ?? 0);
    }
    this.cursor.set(starts);

    for (let i = 0; i < capacity; i++) {
      if ((alive[i] ?? 0) === 0) continue;
      const bucket = this.bucketOf(this.cellX[i] ?? 0, this.cellZ[i] ?? 0);
      const at = this.cursor[bucket] ?? 0;
      this.cursor[bucket] = at + 1;
      this.items[at] = i;
    }
  }

  /** Cell coordinate of a world coordinate, on either axis. */
  cellAt(value: number): number {
    return Math.floor(value * this.inverseCell);
  }

  bucketOf(cx: number, cz: number): number {
    return (Math.imul(cx, HASH_X) ^ Math.imul(cz, HASH_Z)) & this.mask;
  }

  /** First index of bucket `b`'s slice of `items`. */
  begin(bucket: number): number {
    return this.starts[bucket] ?? 0;
  }

  /** One past the last index of bucket `b`'s slice. */
  end(bucket: number): number {
    return this.starts[bucket + 1] ?? 0;
  }

  /** The unit filed at `slot` of `items`. */
  at(slot: number): number {
    return this.items[slot] ?? 0;
  }
}
