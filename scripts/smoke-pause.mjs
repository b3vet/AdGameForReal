/**
 * The pause menu's smoke check (docs/27, section B).
 *
 * Beside `./smoke-visibility.mjs` rather than inside it, for the file-size rule
 * (CLAUDE.md) and because it is a different gesture: that check takes the page
 * away, and this one is the player pressing the button. Both reach into the
 * page mid-run and watch the sim clock, and both ride the same run for the
 * reason that file gives — it is the one with no shot plan to disturb.
 */

/**
 * How long the menu is held up, and then how long the run is watched after
 * Resume. A second each way, as for the visibility check: the assertion is an
 * exact equality, and a second of wall clock makes a failure obvious.
 */
const PAUSE_HOLD_MS = 1000;

/** How long the run is given to be on the road with a moving clock. */
const RUN_START_TIMEOUT_MS = 20_000;

/** How long a click or a key is given to change the menu. */
const MENU_TIMEOUT_MS = 5_000;

/**
 * Pauses with the HUD's button, photographs the menu, resumes with its Resume
 * button, and then does the same with P and Escape.
 *
 * What is asserted, in order:
 *
 *   - the button pauses: the handle says so, the menu is up, focus is on
 *     Resume, and the sim clock does not move for a second;
 *   - the menu is photographed (`run.pauseShot`), frozen road and all — the
 *     loop is stopped while the picture is taken, which is itself the check
 *     that a held frame survives a screenshot;
 *   - Resume takes the menu down and the clock moves again;
 *   - P pauses and Escape resumes, the keyboard's way to the same two states.
 *
 * The caller has already taken the clock down to real time and passes back
 * the turbo it took away; this hands it back however the check ends.
 * Answers the shot's line for the smoke's list, or null when none was taken.
 */
export async function checkPauseMenu(page, run, failures, say, shot, restoreTurbo) {
  let failed = false;
  const fail = (why) => {
    failed = true;
    failures.push(`${run.label}: pause menu — ${why}`);
  };
  try {
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
      fail('no run reached the road with a moving clock');
      return null;
    }

    // A real click, so the button's wiring is what is tested; the handle is
    // only read.
    await page.click('#pause-hud', { timeout: MENU_TIMEOUT_MS });
    const held = await page.evaluate(async (holdMs) => {
      const handle = globalThis.__arcane;
      const clock = () => handle?.state()?.time ?? null;
      const before = clock();
      await new Promise((resolve) => globalThis.setTimeout(resolve, holdMs));
      return {
        paused: handle?.isPaused() ?? false,
        menu: globalThis.document.getElementById('pause-screen')?.hidden === false,
        focus: globalThis.document.activeElement?.id ?? '',
        before,
        after: clock(),
      };
    }, PAUSE_HOLD_MS);
    if (!held.paused) fail('the button did not pause the run');
    if (!held.menu) fail('the menu did not come up');
    if (held.focus !== 'pause-resume') fail(`focus went to "${held.focus}", not Resume`);
    if (held.before === null || held.after !== held.before) {
      fail(`the sim ran while paused: ${held.before}s -> ${held.after}s`);
    }

    const written = run.pauseShot === undefined ? null : await shot(run.pauseShot);

    await page.click('#pause-resume', { timeout: MENU_TIMEOUT_MS });
    const resumed = await page.evaluate(async (holdMs) => {
      const handle = globalThis.__arcane;
      const before = handle?.state()?.time ?? null;
      await new Promise((resolve) => globalThis.setTimeout(resolve, holdMs));
      return {
        paused: handle?.isPaused() ?? true,
        menu: globalThis.document.getElementById('pause-screen')?.hidden === false,
        before,
        after: handle?.state()?.time ?? null,
      };
    }, PAUSE_HOLD_MS);
    if (resumed.paused || resumed.menu) fail('Resume left the run paused');
    if (resumed.before === null || resumed.after === null || !(resumed.after > resumed.before)) {
      fail(`the sim did not run on after Resume: ${resumed.before}s -> ${resumed.after}s`);
    }

    // The keyboard: P opens, Escape closes. Only the flag is read — the clock
    // half of it is what the button checks above already proved.
    await page.keyboard.press('KeyP');
    const byKey = await page.evaluate(() => globalThis.__arcane?.isPaused() ?? false);
    await page.keyboard.press('Escape');
    const byEscape = await page.evaluate(() => globalThis.__arcane?.isPaused() ?? true);
    if (!byKey) fail('P did not pause the run');
    if (byEscape) fail('Escape did not resume the run');

    if (!failed) {
      say(
        `[smoke]   pause menu: held at ${Number(held.after).toFixed(2)}s, ` +
          `ran on to ${Number(resumed.after).toFixed(2)}s after Resume; P and Escape toggle`,
      );
    }
    return written;
  } finally {
    await page.evaluate((turbo) => {
      globalThis.__arcane?.resumeRun();
      globalThis.__arcane?.setTurbo(turbo);
    }, restoreTurbo);
  }
}
