/**
 * Smoke test: build, serve, drive the game in headless Chromium, screenshot.
 *
 * This file is the *driver*: build, serve, open a browser, walk the three
 * phases and print the budget. Five files sit behind it — `./smoke-runs.mjs` is
 * the plan (which runs are played and what each frame is of),
 * `./smoke-browser.mjs` is the plumbing (the static server, Chromium, the page,
 * the blank-frame check), `./smoke-run.mjs` drives one scripted run and asserts
 * what a run owes, `./smoke-stress.mjs` drives the performance scene and its
 * render-cost tripwire, and `./smoke-hero.mjs` takes the hero set at the
 * phone's own pixel ratios.
 *
 * Proves the whole pipeline end to end — that the bundle loads, that Babylon
 * gets a WebGL context under SwiftShader, and that the frames are not blank.
 * See docs/03-milestone-1-plan.md.
 *
 *   npm run smoke
 */

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

import { launchBrowser, openPage, serveDist } from './smoke-browser.mjs';
import { driveHeroSet } from './smoke-hero.mjs';
import { driveRun } from './smoke-run.mjs';
import { RUNS } from './smoke-runs.mjs';
import { driveStress } from './smoke-stress.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT_DIR = path.join(ROOT, 'artifacts', 'smoke');

/**
 * Scripted runs driven at once. One by default — see below.
 *
 * ## The budget, and where it went
 *
 * The smoke measured 18 min 6 s in Milestone 7 Phase E — runs 532 s, stress
 * 39 s, hero 512 s — against the 7 min ceiling of docs/06-milestone-2-plan.md,
 * which it had already passed at 5 min 57 s before this milestone. Two things
 * account for nearly all of the difference, and both are content rather than
 * waste:
 *
 *   - the Frostfell run is 306 s of the 532 on its own. It walks 360 m of a
 *     level that stands at the 500-unit cap, and it stops the sim clock down
 *     three times on the way (`PACE` in `./smoke-run.mjs`) because the three
 *     moments it photographs are a second long each.
 *   - the hero set drives three pages instead of two, and the third walks that
 *     same Frostfell level at pixel ratio 2.
 *
 * What the Milestone 7 review took back, without dropping a frame or an
 * assertion: the meadow hero page is 2x only by default (`DEFAULT_SCALES` in
 * `./smoke-hero.mjs` carries the reasoning — the 3x half is the same picture at
 * more pixels), and the pace ladders that walk the Frostfell run down to its
 * three moments run a rung faster, on margins that are written out beside them.
 *
 * The lever that is still unused is `SMOKE_RUN_CONCURRENCY=2`. The runs are
 * independent — their own context, their own save, their own screenshots — and
 * every assertion a run carries is a *count*: draw calls, shader programs,
 * coins, a phase. None is a wall-clock measurement, so running two at once
 * cannot change an answer.
 *
 * Measured at 2 in Milestone 5 Phase F: the run phase dropped from 182 s to
 * about 105 s, and both attempts *failed* in the same place — the page that
 * boots while another is already playing does not finish `page.goto`'s `load`
 * inside Playwright's 30 s navigation default, because one page compiling
 * thirty-six programs through SwiftShader while another draws a five-hundred-
 * mage frame is all four cores. That timeout is raised now (`playRun` in
 * `./smoke-run.mjs` sets it, as the hero pages already did), so the one known
 * blocker is gone; what is not yet measured is whether a run at half speed
 * still reaches each of its shots inside `SHOT_TIMEOUT_MS`, which is why the
 * default is still 1. It is the next thing to try against a full run.
 */
const RUN_CONCURRENCY = Number(process.env.SMOKE_RUN_CONCURRENCY ?? 1);

/**
 * Drive one part of the smoke instead of all of it: `SMOKE_ONLY=academy`.
 *
 * The review takes a frame again when it has fixed what was wrong with it
 * (docs/24-milestone-8-log.md), and the whole suite is half an hour of this
 * container's wall clock. A part is a run's label, `stress`, or one of the hero
 * set's pages (`hero-meadow`, `hero-frost`, `hero-endless`); anything the
 * filter does not name is skipped. Unset — the default, and the only thing a
 * green run may be claimed from — drives everything.
 */
const ONLY = (process.env.SMOKE_ONLY ?? '')
  .split(',')
  .map((part) => part.trim())
  .filter((part) => part !== '');

/** True when `name` is one of the parts asked for, or when none were. */
function wantedPart(name) {
  return ONLY.length === 0 || ONLY.some((part) => name.includes(part) || part.includes(name));
}

/** Wall clock since `start`, for the budget line at the end. */
function since(start) {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`;
}

async function main() {
  const startedAt = Date.now();
  console.log('[smoke] building...');
  await build({ logLevel: 'warn' });

  if (!existsSync(path.join(DIST, 'index.html'))) {
    throw new Error('build produced no dist/index.html');
  }

  await mkdir(OUT_DIR, { recursive: true });

  const { server, port } = await serveDist(DIST);
  console.log(`[smoke] serving dist/ at http://127.0.0.1:${port}`);

  const browser = await launchBrowser();
  const failures = [];
  const written = [];

  const playOne = async (run) => {
    const page = await openPage(browser, failures);
    try {
      return await driveRun(page, `http://127.0.0.1:${port}/${run.query}`, run, failures, OUT_DIR);
    } finally {
      await page.context().close();
    }
  };

  const timings = [];
  try {
    const runsAt = Date.now();
    // A sliding window rather than fixed pairs: the moment one run finishes the
    // next one starts, so the long level-10 run never holds a core idle.
    const queue = RUNS.filter((run) => wantedPart(run.label));
    const workers = [];
    for (let i = 0; i < Math.max(1, Math.min(RUN_CONCURRENCY, queue.length)); i++) {
      workers.push(
        (async () => {
          for (let run = queue.shift(); run !== undefined; run = queue.shift()) {
            written.push(...(await playOne(run)));
          }
        })(),
      );
    }
    // `allSettled`, so a run that throws — a blank frame — does not leave its
    // partner running against a browser the `finally` below is closing. The
    // first rejection is rethrown once every worker has stopped.
    const settled = await Promise.allSettled(workers);
    timings.push(`runs ${since(runsAt)}`);
    const broke = settled.find((result) => result.status === 'rejected');
    if (broke !== undefined) throw broke.reason;

    if (wantedPart('stress')) {
      const stressAt = Date.now();
      const stressPage = await openPage(browser, failures);
      try {
        written.push(
          await driveStress(
            stressPage,
            `http://127.0.0.1:${port}/?scene=stress&screenshot=1`,
            failures,
            OUT_DIR,
          ),
        );
      } finally {
        await stressPage.context().close();
      }
      timings.push(`stress ${since(stressAt)}`);
    }

    // Last, and in its own file: the frames the milestone is *judged* on, at
    // the pixel ratios a phone renders at (`./smoke-hero.mjs`). Everything
    // above is an assertion with a picture attached; this is the picture.
    const heroAt = Date.now();
    written.push(
      ...(await driveHeroSet(
        browser,
        `http://127.0.0.1:${String(port)}/`,
        OUT_DIR,
        failures,
        openPage,
        wantedPart,
      )),
    );
    timings.push(`hero ${since(heroAt)}`);
  } finally {
    await browser.close();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }

  // The budget, every run: the whole smoke has a seven-minute ceiling
  // (docs/06-milestone-2-plan.md), and the phase line is what says which part
  // of it moved when a change makes it longer.
  console.log(`[smoke] ${timings.join(', ')}, total ${since(startedAt)}`);

  if (failures.length > 0) {
    throw new Error(`page reported ${failures.length} error(s):\n  ${failures.join('\n  ')}`);
  }

  console.log(`[smoke] PASS — ${written.join(', ')} in artifacts/smoke/`);
}

main().catch((error) => {
  console.error(`[smoke] FAIL — ${error.message}`);
  process.exitCode = 1;
});
