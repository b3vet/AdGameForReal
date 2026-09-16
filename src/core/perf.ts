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
 *   2. wait for the shader warm-up to finish, and then for the run to reach
 *      `LEAD_IN_SECONDS` of its own clock, so the capture measures the fight
 *      rather than the level start: on level 20 that is the dense road with
 *      a crowd in the hundreds and the first seconds of the demon
 *      (docs/28, note 5 — "the busiest fights" is where the target is set),
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

import type { Renderer } from '@/render/Renderer';
import type { Overlay } from '@/ui';
import { MAX_CAPTURE_SECONDS } from '@/ui';

/** How often a wait re-checks. Far below a frame, far above a busy loop. */
const POLL_MS = 100;

/**
 * Seconds of the run's own clock before the capture starts.
 *
 * Milestone 9 waited three — past the ladder's settle window, so the capture
 * did not report the level screen — and so measured a squad of seventy on an
 * open road. Thirty-five puts a 45-second window over the part of level 20
 * the owner's "below 60" is about: the thick of the road and the boss.
 */
const LEAD_IN_SECONDS = 35;
/** Wall-clock ceiling on the lead-in, for a phone that plays in slow motion. */
const LEAD_IN_TIMEOUT_MS = 120_000;

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
  /** Seconds of sim time the run has played, or null when none is on the road. */
  runTime: () => number | null;
  startCapture: (seconds: number) => void;
  captureActive: () => boolean;
  /** Renders the report in the panel and copies it; true when the copy took. */
  finish: () => Promise<boolean>;
  /** The app is going away; every wait gives up. */
  disposed: () => boolean;
}

/** The part of the app `perfHost` builds a host from. Structural, like `PerfHost`. */
export interface PerfApp {
  readonly renderer: Renderer;
  readonly overlay: Overlay;
  readonly session: { readonly state: { readonly time: number } } | null;
  startLevel: (level: number) => void;
}

/**
 * The host for `app`: the level to capture, and a thunk that says the app has
 * gone. Moved out of `App` with the pause menu (docs/27), for the file-size
 * rule; the capture itself is unchanged.
 */
export function perfHost(app: PerfApp, level: number, disposed: () => boolean): PerfHost {
  return {
    level,
    startLevel: (next) => {
      app.startLevel(next);
    },
    warming: () => app.renderer.shaderStats.warming,
    runTime: () => app.session?.state.time ?? null,
    startCapture: (seconds) => {
      app.overlay.startCapture(seconds);
    },
    captureActive: () => app.overlay.captureActive,
    finish: () => app.overlay.showAndCopyReport(),
    disposed,
  };
}

/**
 * Runs the whole sequence. Resolves when the report is up; never rejects, and
 * never throws into the caller's boot path.
 */
export async function runPerfCapture(host: PerfHost): Promise<void> {
  try {
    if (host.disposed()) return;
    host.startLevel(host.level);
    await waitUntil(() => !host.warming(), WARM_UP_TIMEOUT_MS, host.disposed);
    await waitUntil(() => host.runTime() !== null, WARM_UP_TIMEOUT_MS, host.disposed);
    // A run that ends before the lead-in (a wipe) is captured on whatever
    // comes next rather than not at all.
    await waitUntil(
      () => (host.runTime() ?? LEAD_IN_SECONDS) >= LEAD_IN_SECONDS,
      LEAD_IN_TIMEOUT_MS,
      host.disposed,
    );
    if (host.disposed()) return;

    host.startCapture(MAX_CAPTURE_SECONDS);
    // The recorder closes its own window on the frame it fills; this waits for
    // that rather than for a clock of its own, so a slow phone's capture is the
    // window it actually recorded.
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
