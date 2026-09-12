/**
 * A grow-once free list.
 *
 * The event buffer hands out one object per event and a busy tick emits one per
 * shot, so the objects are pooled rather than allocated (CLAUDE.md). `take`
 * allocates only until the high-water mark is reached; after that a run of any
 * length reuses the same objects for ever.
 */

export class Pool<T> {
  private readonly items: T[] = [];
  private used = 0;

  constructor(private readonly make: () => T) {}

  reset(): void {
    this.used = 0;
  }

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
}

