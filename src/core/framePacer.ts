/**
 * Which display refreshes the frame loop draws on (docs/28, note 5).
 *
 * `requestAnimationFrame` fires once per refresh of the display the page is on,
 * and the loop used to draw a whole frame on every one of them: sim, views,
 * `scene.render`, physics. On a 60 Hz screen that is the budget the game is
 * built for. On a 120 Hz one — the product owner's phone is ProMotion, and
 * whether its web view hands a page 120 callbacks a second depends on the iOS
 * version — it is twice the work for a picture the eye reads the same, on a
 * device that heats up and throttles under it; and a frame that needs 10 ms
 * cannot fit an 8.3 ms refresh, so the loop lands on one refresh or two in an
 * uneven mix, which is the stutter the owner called "not smooth".
 *
 * So the loop draws on a refresh only once a whole frame period at the cap
 * (`quality.json`, 60 a second) has nearly passed, and skips the ones in
 * between. On a 60 Hz display nothing changes: every callback is due. On a
 * 120 Hz one every other callback is, evenly. On a 90 Hz one two in three are
 * (sixty a second, the best a 90 Hz panel can pace them); on a 144 Hz one every
 * other is, which is 72 — two of its refreshes fall inside the slack, and even
 * pacing a little above the cap reads better than uneven pacing at it. A
 * skipped callback costs a subtraction.
 *
 * The cadence is kept rather than restarted at each frame, so a display a hair
 * faster than 60 Hz does not drift into skipping one frame in a hundred: the
 * next frame is due one period after the last one was *due*, never later than
 * the callback that drew it, and a stall longer than two periods starts afresh
 * instead of trying to catch up.
 *
 * It also counts every callback, drawn or not, which is how the device report
 * learns the display's own rate (`src/ui/capture.ts`).
 */

import { qualityTuning } from '@/data';

export class FramePacer {
  /** Milliseconds between drawn frames at the cap. */
  private readonly period: number;
  /**
   * The shortest gap that still counts as a frame. A 60 Hz display's callbacks
   * are 16.7 ms apart give or take a rounding; a 120 Hz one's are 8.3.
   */
  private readonly earliest: number;
  /** When the last drawn frame was due, or null before the first. */
  private lastDue: number | null = null;
  /** Every callback the loop has had, drawn or skipped. Read, never reset. */
  private seen = 0;

  constructor(
    maxFps: number = qualityTuning.frame.maxFps,
    slackMs: number = qualityTuning.frame.paceSlackMs,
  ) {
    this.period = 1000 / Math.max(1, maxFps);
    this.earliest = Math.max(0, this.period - slackMs);
  }

  /** Callbacks since the app started; the report divides a window's share. */
  get callbacks(): number {
    return this.seen;
  }

  /** The loop was stopped or paused: the next callback draws, whenever it is. */
  reset(): void {
    this.lastDue = null;
  }

  /** Whether the callback at `time` (milliseconds) should draw a frame. */
  due(time: number): boolean {
    this.seen++;
    const last = this.lastDue;
    if (last === null) {
      this.lastDue = time;
      return true;
    }
    const since = time - last;
    if (since < 0 || since > 2 * this.period) {
      this.lastDue = time;
      return true;
    }
    if (since < this.earliest) return false;
    this.lastDue = Math.min(time, last + this.period);
    return true;
  }
}
