/**
 * The debug panel's live hitch counter: frames over `SPIKE_MS` in the last
 * `SPIKE_WINDOW_SECONDS`.
 *
 * Split out of `./capture.ts` when the capture grew the phase split and the
 * display rate (docs/28, note 5): the capture is a window that closes, and
 * this is a window that rolls, and the two only share a threshold.
 */

/**
 * A frame longer than this is a hitch (Milestone 4, "Polish"). Sixty frames a
 * second is 16.7 ms, so 20 ms is the first frame the eye can see stumble; the
 * product owner's capture is meant to report under three of them.
 */
export const SPIKE_MS = 20;

/** How far back the panel's live spike count looks. */
export const SPIKE_WINDOW_SECONDS = 10;

/**
 * Spike timestamps kept for the live count. A window with more spikes than
 * this is already a broken frame rate, so the ring forgets its oldest rather
 * than growing — the number it reports stops being exact long after it has
 * stopped being useful.
 */
const SPIKE_CAPACITY = 512;

/**
 * How many of the last `SPIKE_WINDOW_SECONDS` of frames took longer than
 * `SPIKE_MS`, as a rolling count.
 *
 * The capture answers the same question for its own window; this one is for the
 * panel, which is up the whole time the product owner is playing. One
 * `Float64Array` allocated once, a head and a length: recording a frame is two
 * stores and no allocation, which matters because the thing being measured is
 * allocation-driven hitching.
 */
export class SpikeWindow {
  private readonly times = new Float64Array(SPIKE_CAPACITY);
  private start = 0;
  private length = 0;
  private last = 0;

  reset(): void {
    this.start = 0;
    this.length = 0;
    this.last = 0;
  }

  /** Records one drawn frame and returns the spikes now inside the window. */
  add(nowMs: number): number {
    if (this.last > 0 && nowMs - this.last > SPIKE_MS) this.push(nowMs);
    this.last = nowMs;
    this.trim(nowMs);
    return this.length;
  }

  private push(at: number): void {
    const index = (this.start + this.length) % SPIKE_CAPACITY;
    this.times[index] = at;
    if (this.length < SPIKE_CAPACITY) this.length++;
    // Full: the newest sample took the oldest one's slot, so the window starts
    // one later.
    else this.start = (this.start + 1) % SPIKE_CAPACITY;
  }

  private trim(nowMs: number): void {
    const floor = nowMs - SPIKE_WINDOW_SECONDS * 1000;
    while (this.length > 0 && (this.times[this.start] ?? 0) < floor) {
      this.start = (this.start + 1) % SPIKE_CAPACITY;
      this.length--;
    }
  }
}

