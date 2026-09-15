/**
 * The one smoke check that is about the *page* rather than about the run.
 *
 * Its own file rather than another entry in `./smoke-run-checks.mjs`, for the
 * file-size rule (CLAUDE.md) and because it is a different kind of thing: every
 * check there reads a count off the debug handle once a run is over, and this
 * one reaches into the page mid-run, takes the page away, and watches the sim
 * clock. Milestone 9, definition of done 3.
 */

/**
 * How long the page is held hidden, and then watched after it comes back.
 *
 * A second of wall clock each way. Long enough that a loop that had not stopped
 * would have run dozens of frames — the assertion is an exact equality, so one
 * frame would be enough, but a second makes the failure message obvious — and
 * short enough to cost the smoke two seconds.
 */
const VISIBILITY_HOLD_MS = 1000;

/** How long the run is given to reach the road after the Play tap. */
const RUN_START_TIMEOUT_MS = 20_000;

/**
 * The sim clock stops while the page is away, and starts again when it is back
 * (Milestone 9, definition of done 3).
 *
 * Run mid-road rather than on a menu, because the thing being proved is that a
 * *run* is where the player left it: a title screen has no sim clock to hold
 * still. The page is made hidden the way a phone makes it hidden — the property
 * first, the event second — because `src/device/lifecycle.ts` reads
 * `document.visibilityState` inside its handler rather than trusting the event,
 * and a bare `dispatchEvent` on a visible page would deliver *foreground*.
 * Chromium cannot background a page from the outside, so the property is
 * shadowed with a configurable own property and deleted again afterwards.
 *
 * The caller has already taken the sim clock down to real time and passes what
 * it took away as `restoreTurbo`, which this hands back on the way out. At a
 * run's own turbo 60 a second of wall clock is a minute of sim, which is enough
 * to end the run inside the check and make "the clock moved again" unprovable.
 *
 * Every read and every event happens page-side inside one `evaluate`, so no
 * round trip to Node can land between reading the clock and stopping it.
 */
export async function checkVisibilityPause(page, run, failures, say, restoreTurbo) {
  // `time > 0`, not merely `running`: a clock that has never moved reads the
  // same frozen as one that has been stopped, and the whole check would then
  // pass on a run that had not started ticking.
  const playing = await page
    .waitForFunction(
      () =>
        globalThis.__arcane?.app.status() === 'playing' &&
        globalThis.__arcane.state()?.status === 'running' &&
        (globalThis.__arcane.state()?.time ?? 0) > 0,
      null,
      { timeout: RUN_START_TIMEOUT_MS },
    )
    .then(() => true)
    .catch(() => false);
  if (!playing) {
    failures.push(`${run.label}: visibility pause — no run reached the road with a moving clock`);
    // The caller slowed the clock down for this and is waiting for it back.
    await page.evaluate((turbo) => {
      globalThis.__arcane?.setTurbo(turbo);
    }, restoreTurbo);
    return;
  }

  const result = await page.evaluate(async ({ holdMs, turbo }) => {
    const handle = globalThis.__arcane;
    const clock = () => handle?.state()?.time ?? null;
    const wait = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));
    const setHidden = (hidden) => {
      Object.defineProperty(globalThis.document, 'visibilityState', {
        value: hidden ? 'hidden' : 'visible',
        configurable: true,
      });
      globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange'));
    };

    try {
      // Hidden and read in the same task: nothing can run a frame in between,
      // so `before` is the last value the loop wrote.
      setHidden(true);
      const before = clock();
      await wait(holdMs);
      const held = clock();

      setHidden(false);
      await wait(holdMs);
      const after = clock();

      if (before === null || held === null || after === null) {
        return { ok: false, why: 'the run ended during the check' };
      }
      if (before <= 0) return { ok: false, why: 'the sim clock had not started' };
      if (held !== before) {
        return { ok: false, why: `the sim ran while hidden: ${before}s -> ${held}s` };
      }
      if (!(after > held)) {
        return { ok: false, why: `the sim did not restart: still ${held}s` };
      }
      return { ok: true, why: `held at ${held.toFixed(2)}s, ran on to ${after.toFixed(2)}s` };
    } finally {
      // Whatever happened above, the page is left with a real `visibilityState`
      // and the run at the speed the plan expects.
      delete globalThis.document.visibilityState;
      handle?.setTurbo(turbo);
    }
  }, { holdMs: VISIBILITY_HOLD_MS, turbo: restoreTurbo });

  if (result.ok) say(`[smoke]   visibility pause: ${result.why}`);
  else failures.push(`${run.label}: visibility pause — ${result.why}`);
}
