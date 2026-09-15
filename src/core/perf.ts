/**
 * `?perf`: the scripted performance run (Milestone 9, plan section D).
 *
 * The owner opens one link on the phone, puts it down, and picks it up to a
 * report already on the clipboard. That is the whole design goal: certifying a
 * build's frame rate should not be a sequence of taps on a 10 px button while
 * a level 20 fight is happening, because the taps are themselves frames.
 *
 * The sequence, once the app has booted:
 *
 *   1. start the level (`PERF_LEVEL`, or the highest the save has reached —
 *      `./query.ts` picks it, the bot comes from there too),
 *   2. wait for the shader warm-up to finish and for the ladder's settle
 *      window to pass, so the capture measures play rather than level start,
 *   3. record `MAX_CAPTURE_SECONDS` through the debug panel's own recorder —
 *      the same code path the "Capture" button drives, so the numbers mean the
 *      same thing (`src/ui/capture.ts`),
 *   4. render the device report in the panel and put it on the clipboard.
 *
 * Nothing here is on the frame path: it polls on a timer rather than hooking
 * the loop, so a scripted capture costs the frames it is measuring nothing.
 * Every wait has a ceiling — a phone that never finishes warming up still ends
 * with a report, which is the one artefact this exists to produce.
 */

import { MAX_CAPTURE_SECONDS } from '@/ui';

/** How often a wait re-checks. Far below a frame, far above a busy loop. */
const POLL_MS = 100;

/**
 * Seconds between the level starting and the capture, once the warm-up is done.
 *
 * The ladder ignores its first two seconds for exactly this reason (generation,
 * pool hand-out, the first crowd upload — `SETTLE_SECONDS` in `./quality.ts`),
 * and a capture that started inside them would report the level screen. Three
 * gives the ladder a whole window of its own before the recording starts.
 */
const SETTLE_SECONDS = 3;

/** Ceilings, so a stall still produces a report rather than nothing. */
const WARM_UP_TIMEOUT_MS = 30_000;
const CAPTURE_TIMEOUT_MS = (MAX_CAPTURE_SECONDS + 20) * 1000;

/** What the run needs from the app. Structural, so this file imports no `App`. */
export interface PerfHost {
  /** The level `./query.ts` settled on. */
  level: number;
  startLevel: (level: number) => void;
  /** True while the renderer is still compiling materials (`Renderer.warmUp`). */
  warming: () => boolean;
  startCapture: (seconds: number) => void;
  captureActive: () => boolean;
  /** Renders the report in the panel and copies it; true when the copy took. */
  finish: () => Promise<boolean>;
  /** The app is going away; every wait gives up. */
  disposed: () => boolean;
}

/**
 * Runs the whole sequence. Resolves when the report is up; never rejects, and
 * never throws into the caller's boot path.
 */
export async function runPerfCapture(host: PerfHost): Promise<void> {
  try {
    host.startLevel(host.level);
    await waitUntil(() => !host.warming(), WARM_UP_TIMEOUT_MS, host.disposed);
    await sleep(SETTLE_SECONDS * 1000);
    if (host.disposed()) return;

    host.startCapture(MAX_CAPTURE_SECONDS);
    // The recorder closes its own window on the frame it fills; this waits for
    // that rather than for a clock of its own, so a slow phone's capture is the
    // thirty seconds it actually recorded.
    await waitUntil(() => !host.captureActive(), CAPTURE_TIMEOUT_MS, host.disposed);
    if (host.disposed()) return;

    await host.finish();
  } catch {
    // A scripted diagnostic may not take the app down with it.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls until `ready`, the timeout, or the app going away. */
async function waitUntil(
  ready: () => boolean,
  timeoutMs: number,
  disposed: () => boolean,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!ready()) {
    if (disposed() || Date.now() >= deadline) return;
    await sleep(POLL_MS);
  }
}
