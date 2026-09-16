/**
 * What the result sheet and the coin chip owe (docs/28).
 *
 * Split out of `./smoke-run-checks.mjs` when the owner's second device round
 * added to both: the sheet has to fit without scrolling and roll the purse in
 * the corner, and the chip has to stand in one place on every menu screen.
 * Everything here reads the page and the debug handle; nothing is timed.
 */

/**
 * How long to wait for the result screen after the run reaches a terminal
 * status. The app holds it back ~0.8 s of *frame* time, which is several times
 * that in wall-clock time on a SwiftShader machine.
 */
export const RESULT_SETTLE_MS = 20_000;

/**
 * What the result sheet owes the payout that made it (D51 to D53).
 *
 * The identity is the whole point: the count-up rolls *everything the run
 * paid* — the road plus the streak, the missions and the bestiary rungs — and
 * the purse beside it ends where the save ended. Milestone 8's wave one shipped
 * a sheet that rolled the road's coins alone while the purse climbed by the
 * total, so the two numbers on one screen disagreed by the bonus. The purse is
 * the coin chip in the corner now (docs/28), which the sheet rolls with the
 * coins.
 *
 * And the sheet fits (docs/28): nothing in it scrolls at the smoke's 390x844,
 * and the chip's row is clear of the verdict under it.
 *
 * Waited for rather than slept through: the roll is driven by
 * `requestAnimationFrame` on the wall clock, and on this rasteriser a frame of
 * a five-hundred-mage scene behind the sheet is most of a second.
 */
export async function checkSheet(page, run, failures, say) {
  const rolled = await page
    .waitForFunction(
      () => {
        const payout = globalThis.__arcane?.meta().payout;
        if (payout === null || payout === undefined) return false;
        const want = Math.max(0, Math.round(payout.coins + payout.bonusCoins));
        const shown = globalThis.document.querySelector('#result-coins')?.textContent ?? '';
        return Number(shown) === want;
      },
      null,
      { timeout: RESULT_SETTLE_MS },
    )
    .then(() => true)
    .catch(() => false);

  const sheet = await page.evaluate((wanted) => {
    const text = (id) => globalThis.document.querySelector(id)?.textContent ?? '';
    const shown = (id) => {
      const element = globalThis.document.querySelector(id);
      return element !== null && !element.hidden;
    };
    const box = (id) => {
      const rect = globalThis.document.querySelector(id)?.getBoundingClientRect();
      return rect === undefined ? null : { top: rect.top, bottom: rect.bottom };
    };
    const scrollOver = (element) =>
      element === null ? 0 : element.scrollHeight - element.clientHeight;
    return {
      payout: globalThis.__arcane?.meta().payout ?? null,
      coins: Number(text('#result-coins')),
      total: Number(text('#coin-chip-value')),
      chip: shown('#purse-bar') ? box('#coin-chip') : null,
      ribbon: box('#result-ribbon'),
      // The sheet's own scroller, and the page under it.
      overflow: Math.max(
        scrollOver(globalThis.document.querySelector('#result-screen .screen__middle')),
        scrollOver(globalThis.document.scrollingElement),
      ),
      metres: Number(text('#result-metres')),
      bestMetres: text('#result-best-metres'),
      best: text('#result-best'),
      purse: globalThis.__arcane?.player().coins ?? -1,
      // The bottom of the last button, against the bottom of the screen.
      wayOut:
        (globalThis.document.querySelector('#home-button')?.getBoundingClientRect().bottom ?? 0) -
        globalThis.innerHeight,
      visible: (wanted.visible ?? []).map((id) => [id, shown(id)]),
      hidden: (wanted.hidden ?? []).map((id) => [id, shown(id)]),
      absent: (wanted.absent ?? []).map((id) => [
        id,
        globalThis.document.querySelector(id) !== null,
      ]),
    };
  }, run.sheet ?? {});

  const payout = sheet.payout;
  if (payout === null) {
    failures.push(`${run.label}: the run finished but paid no payout`);
    return;
  }
  const earned = Math.max(0, Math.round(payout.coins + payout.bonusCoins));
  say(
    `[smoke]   paid: ${payout.coins} from the road + ${payout.bonusCoins} bonus = ` +
      `${earned}, purse ${payout.totalCoins}`,
  );
  if (!rolled) {
    failures.push(
      `${run.label}: the sheet rolled to ${sheet.coins} coins, not the ${earned} the run paid`,
    );
  }
  if (sheet.total !== Math.round(payout.totalCoins)) {
    failures.push(
      `${run.label}: the coin chip reads ${sheet.total}, the payout says ${payout.totalCoins}`,
    );
  }
  if (sheet.chip === null) {
    failures.push(`${run.label}: the coin chip is not on the result sheet`);
  } else if (sheet.ribbon !== null && sheet.chip.bottom > sheet.ribbon.top + 0.5) {
    failures.push(
      `${run.label}: the coin chip (bottom ${sheet.chip.bottom.toFixed(0)}) runs into the ` +
        `verdict ribbon (top ${sheet.ribbon.top.toFixed(0)})`,
    );
  }
  // One pixel of slack, for a fractional layout height rounded up.
  if (sheet.overflow > 1) {
    failures.push(`${run.label}: the result sheet scrolls by ${sheet.overflow.toFixed(0)}px`);
  } else {
    say('[smoke]   result sheet: fits without scrolling');
  }
  if (sheet.purse !== payout.totalCoins) {
    failures.push(
      `${run.label}: the save's purse is ${sheet.purse}, the payout says ${payout.totalCoins}`,
    );
  }
  // `html` and `body` are `overflow: hidden` (`src/ui/styles.css`), so a button
  // past the bottom edge is not off screen, it is unreachable — and Home is the
  // way to spend what the run has just paid. A full sheet overflowed by
  // about thirty pixels before Phase E gave the middle of it a scroll.
  if (sheet.wayOut > 1) {
    failures.push(
      `${run.label}: the Home button is ${sheet.wayOut.toFixed(0)}px below the screen`,
    );
  }
  for (const [id, on] of sheet.visible) {
    if (!on) failures.push(`${run.label}: ${id} is not on the result sheet`);
  }
  for (const [id, on] of sheet.hidden) {
    if (on) failures.push(`${run.label}: ${id} is on the result sheet and should not be`);
  }
  for (const [id, there] of sheet.absent) {
    if (there) failures.push(`${run.label}: ${id} is still in the page`);
  }

  if (run.endless !== true) return;
  // The endless sheet (D52): metres instead of a level, and a record to beat.
  if (sheet.metres !== Math.floor(payout.metres)) {
    failures.push(
      `${run.label}: the sheet reads ${sheet.metres} m, the run walked ${payout.metres}`,
    );
  }
  if (!payout.endlessBest || sheet.bestMetres === '') {
    failures.push(`${run.label}: the first endless walk did not read as a new best`);
  }
  say(`[smoke]   endless sheet: ${sheet.metres} m, "${sheet.bestMetres}"`);
}

/**
 * Retry on an endless sheet walks the endless road again (D52).
 *
 * The button is mode-aware because the endless road has no level number: the
 * bug it guards against is a retry walking whatever campaign level the picker
 * happened to be pointed at.
 */
export async function checkRetryStaysEndless(page, run, failures, say) {
  await page.click('#retry-button');
  const again = await page
    .waitForFunction(
      () =>
        globalThis.__arcane?.app.status() === 'playing' &&
        globalThis.__arcane.state()?.endless !== undefined,
      null,
      { timeout: RESULT_SETTLE_MS },
    )
    .then(() => true)
    .catch(() => false);
  if (again) say('[smoke]   Retry from the endless sheet walked the endless road again');
  else failures.push(`${run.label}: Retry from the endless sheet did not start an endless run`);
}

/**
 * Where the coin chip stands on a menu screen (docs/28), or null when it is
 * not up. One element serves every screen that is not a run, so a box that
 * differs from the home's is a screen that moved it or hid it.
 */
export async function readCoinChip(page) {
  return page.evaluate(() => {
    const bar = globalThis.document.querySelector('#purse-bar');
    const chip = globalThis.document.querySelector('#coin-chip');
    if (bar === null || chip === null || bar.hidden) return null;
    const rect = chip.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });
}

/** The chip on `name` stands where it stood on the home, at the same size. */
export async function checkCoinChipPlace(page, run, name, home, failures, say) {
  const here = await readCoinChip(page);
  if (here === null) {
    failures.push(`${run.label}: ${name} has no coin chip`);
    return;
  }
  if (home === null) return;
  // Half a pixel either way for sub-pixel layout; the width may differ only
  // if the purse itself changed between the two screens.
  const moved = ['left', 'top', 'height'].filter((key) => Math.abs(here[key] - home[key]) > 0.5);
  if (moved.length > 0) {
    failures.push(
      `${run.label}: the coin chip on ${name} is not where the home has it ` +
        `(${JSON.stringify(here)} against ${JSON.stringify(home)})`,
    );
  } else {
    say(`[smoke]   ${name}: coin chip in the home's place`);
  }
}
