/**
 * The plumbing every hero page shares: how long it waits for things, how a
 * frame is written, and how the page-side watchers are stopped and released.
 *
 * Split out of `./smoke-hero.mjs` in the Milestone 7 review, which left that
 * file at 901 lines. The seam is the one the set already had: *which* frames
 * are taken and on what road is a decision per page — the meadow run, the
 * Frostfell run, the two swipes — and *how* a page is driven at all is the same
 * five calls three times over. Nothing here knows what a hero frame is of.
 */

import path from 'node:path';
import { stat } from 'node:fs/promises';

import { SCREENSHOT_TIMEOUT_MS } from './smoke-browser.mjs';

/**
 * Ninety seconds, not sixty: the set boots two or three pages at once on four
 * cores (`FROST_SCALES`, `SMOKE_HERO_SCALES`), and a page waiting behind others
 * compiling shaders through SwiftShader needs more than a minute to report
 * `ready`. Nothing is weakened — a page that never boots still fails the set.
 */
export const READY_TIMEOUT_MS = 90_000;
export const WARM_UP_TIMEOUT_MS = 120_000;
export const SHOT_TIMEOUT_MS = 240_000;
export const RUN_END_TIMEOUT_MS = 300_000;
export const RESULT_SETTLE_MS = 30_000;
export const MENU_SETTLE_MS = 900;

/** The env list, or the fallback — never empty, or a set silently vanishes. */
export function readScales(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = value
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0);
  return parsed.length > 0 ? parsed : fallback;
}

/**
 * Makes the `shot(name)` one page uses, which writes `name-2x.png` into the
 * hero directory, logs its size and records it in `written`.
 */
export function shotTaker(page, heroDir, scale, written) {
  const suffix = `-${String(scale)}x`;
  return async (name) => {
    const file = path.join(heroDir, `${name}${suffix}.png`);
    await page.screenshot({ path: file, timeout: SCREENSHOT_TIMEOUT_MS });
    const { size } = await stat(file);
    console.log(`[smoke]   hero/${name}${suffix}.png (${(size / 1024).toFixed(0)} KB)`);
    written.push(`hero/${name}${suffix}.png`);
  };
}

/**
 * Boots one hero page: navigate, wait for `ready`, wait for the warm-up.
 *
 * Nothing is photographed until every material is compiled — a hero shot taken
 * mid warm-up is a picture of an unfinished scene — and a warm-up that never
 * finishes is a failure rather than a throw, so the rest of the page's frames
 * are still attempted.
 */
export async function bootHeroPage(page, url, failures, label) {
  // With two or three pages booting together, Playwright's 30 s navigation
  // default is shorter than a cold boot on a busy rasteriser.
  page.setDefaultNavigationTimeout(READY_TIMEOUT_MS);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => globalThis.__arcane?.ready === true, null, {
    timeout: READY_TIMEOUT_MS,
  });
  await page
    .waitForFunction(
      () => {
        const shaders = globalThis.__arcane?.shaders();
        return shaders !== undefined && shaders.warming === false && shaders.warmed > 0;
      },
      null,
      { timeout: WARM_UP_TIMEOUT_MS },
    )
    .catch(() => {
      failures.push(`${label}: the shader warm-up never finished`);
    });
}

/** Waits for the page-side watcher to stop on the current step. False on a timeout. */
export function waitForHeroStop(page) {
  return page
    .waitForFunction(() => globalThis.__heroStopped === true, null, { timeout: SHOT_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
}

/**
 * Releases the loop and moves the watcher on to the next step.
 *
 * `resetSwipe` is for the swipe watcher only: the next step starts a swipe of
 * its own, so its frame count goes back to "not swiping yet".
 */
export function releaseHeroStop(page, resetSwipe = false) {
  return page.evaluate((reset) => {
    globalThis.__heroStep = (globalThis.__heroStep ?? 0) + 1;
    if (reset) globalThis.__heroSwipe = -1;
    globalThis.__heroStopped = false;
    globalThis.__arcane?.app.resume();
  }, resetSwipe);
}

/**
 * Walks a page through its shot plan: wait, photograph, release.
 *
 * The one loop all three pages run. A step that never arrives is reported and
 * stops the page's plan — the frames after it are of a road this run never
 * reached, and waiting for each of them in turn is `SHOT_TIMEOUT_MS` apiece.
 */
export async function takeHeroShots(page, shots, shot, failures, label, resetSwipe = false) {
  for (const frame of shots) {
    if (!(await waitForHeroStop(page))) {
      failures.push(`${label}: ${frame.name} — the run never reached it`);
      return false;
    }
    try {
      await shot(frame.name);
    } finally {
      await releaseHeroStop(page, resetSwipe);
    }
  }
  return true;
}

/**
 * Waits for the result sheet to be up with its numbers rolled.
 *
 * Every wait is a `catch(() => {})`: the sheet is a picture, not an assertion —
 * `./smoke-run.mjs` is what fails a run that never reaches one — so a slow
 * machine photographs a counter halfway up rather than failing the whole set.
 */
export async function settleResult(page) {
  await page.waitForFunction(
    () => {
      const status = globalThis.__arcane?.state()?.status;
      return typeof status === 'string' && status !== 'running';
    },
    null,
    { timeout: RUN_END_TIMEOUT_MS },
  );
  await page
    .waitForFunction(() => globalThis.__arcane?.app.status() === 'result', null, {
      timeout: RESULT_SETTLE_MS,
    })
    .catch(() => {});
  await page
    .waitForFunction(
      () => {
        const shown = globalThis.document.querySelector('#result-peak')?.textContent ?? '';
        const peak = globalThis.__arcane?.state()?.peakCount ?? 0;
        return Number(shown) === Math.round(peak);
      },
      null,
      { timeout: RESULT_SETTLE_MS },
    )
    .catch(() => {});
}
