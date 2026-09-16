/**
 * The simplifier's queue of candidate merges (`./simplify.ts`): a binary
 * min-heap over five parallel arrays, cheapest merge first. A queued merge is
 * never removed when it goes stale; it carries the stamps its two points had
 * when it was priced, and the simplifier skips it on the way out if either has
 * moved on since.
 */

/** A min-heap of candidate merges, stale entries skipped on the way out. */
export class Heap {
  private readonly cost: number[] = [];
  private readonly from: number[] = [];
  private readonly to: number[] = [];
  private readonly stampFrom: number[] = [];
  private readonly stampTo: number[] = [];

  get size(): number {
    return this.cost.length;
  }

  push(cost: number, from: number, to: number, stampFrom: number, stampTo: number): void {
    const c = this.cost;
    let i = c.length;
    c.push(cost);
    this.from.push(from);
    this.to.push(to);
    this.stampFrom.push(stampFrom);
    this.stampTo.push(stampTo);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((c[parent] ?? 0) <= cost) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  /** Removes the cheapest entry into `out` as `[cost, from, to, stampFrom, stampTo]`. */
  pop(out: number[]): void {
    const c = this.cost;
    out[0] = c[0] ?? 0;
    out[1] = this.from[0] ?? 0;
    out[2] = this.to[0] ?? 0;
    out[3] = this.stampFrom[0] ?? 0;
    out[4] = this.stampTo[0] ?? 0;
    const last = c.length - 1;
    this.swap(0, last);
    c.pop();
    this.from.pop();
    this.to.pop();
    this.stampFrom.pop();
    this.stampTo.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < last && (c[l] ?? 0) < (c[m] ?? 0)) m = l;
      if (r < last && (c[r] ?? 0) < (c[m] ?? 0)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
  }

  private swap(a: number, b: number): void {
    swapIn(this.cost, a, b);
    swapIn(this.from, a, b);
    swapIn(this.to, a, b);
    swapIn(this.stampFrom, a, b);
    swapIn(this.stampTo, a, b);
  }
}

function swapIn(list: number[], a: number, b: number): void {
  const x = list[a] ?? 0;
  list[a] = list[b] ?? 0;
  list[b] = x;
}
