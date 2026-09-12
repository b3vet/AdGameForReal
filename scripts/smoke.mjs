/**
 * Smoke test: build, serve, drive the game in headless Chromium, screenshot.
 *
 * This file is the plan: which runs are played and what each frame is waiting
 * for. Three files sit behind it — `./smoke-browser.mjs` is the plumbing (the
 * static server, Chromium, the page, the blank-frame check), `./smoke-run.mjs`
 * drives one scripted run and asserts what a run owes, and `./smoke-stress.mjs`
 * drives the performance scene and its render-cost tripwire.
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
import { driveRun } from './smoke-run.mjs';
import { driveStress } from './smoke-stress.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT_DIR = path.join(ROOT, 'artifacts', 'smoke');

/**
 * `turbo=60` runs the sim sixty times faster than the wall clock — the app's
 * ceiling, and the only reason a scripted run fits in this budget.
 *
 * Milestone 2's scene is expensive under SwiftShader — a level-1 frame measured
 * about 800 ms on this machine and a level-10 crowd is slower still — so the
 * wall clock of a run is frames, not sim seconds: the sim advanced at 0.56x
 * real time at turbo 8 and 1.18x at turbo 20. The whole smoke has a five-minute
 * budget (docs/06-milestone-2-plan.md) and turbo is what buys it. The app's own
 * ceiling is 40.
 */
const TURBO = 60;

/**
 * The runs this smoke drives, in order. The first is the definition-of-done
 * run: a greedy clear of level 1, photographed early, mid and late down the
 * road and then in the boss fight. The others exist to prove a loss screen and
 * a big level-10 squad also render.
 *
 * A shot is keyed to a point on the road (`z`, in metres) or to an event, never
 * to the wall clock. The frame loop is stopped on the first frame that
 * satisfies each step and started again once the picture is taken, so the same
 * frames come out of a fast machine and a slow one — and a turbo frame, which
 * is three seconds of sim, cannot carry the run past the moment being
 * photographed. The `t1/t6/t12` names are historical: they were wall-clock
 * seconds in Milestone 1, and the distances below are where those seconds
 * landed.
 *
 * `screenshot=1` is on every URL here and nowhere else: it is what turns
 * `preserveDrawingBuffer` back on (`src/render/scene.ts`). The flag is off in
 * play because it makes the driver keep a second copy of the back buffer, and
 * without it the canvas the compositor hands Playwright can come back empty.
 */
const RUNS = [
  {
    label: 'greedy level 1',
    query: `?bot=greedy&level=1&seed=1&turbo=${TURBO}&screenshot=1`,
    titleShot: 'title.png',
    shots: [
      { at: 'z', value: 25, name: 't1.png' },
      { at: 'z', value: 65, name: 't6.png' },
      { at: 'z', value: 110, name: 't12.png' },
      // The fight, with the boss still standing: bar, HP label and stomp ring.
      { at: 'boss', name: 'boss.png' },
    ],
    endShot: 'end.png',
    // The frame the blank-frame check runs on: mid-run, squad and gates on screen.
    assertNotBlank: 't6.png',
  },
  {
    label: 'random level 3',
    query: `?bot=random&level=3&seed=2&turbo=${TURBO}&screenshot=1`,
    shots: [],
    endShot: 'end-random.png',
  },
  {
    label: 'greedy level 10',
    // Seed 2 is the one whose level 10 puts a staff gate on row 4 of twenty,
    // so the staff shot has something to photograph early in the run.
    query: `?bot=greedy&level=10&seed=2&turbo=${TURBO}&screenshot=1`,
    shots: [
      // A `weapon` gate on screen: the staff prop over the panel and its name
      // on it (plan, definition of done 5).
      { at: 'staff', name: 'staff-l10.png' },
      { at: 'z', value: 120, name: 't12-l10.png' },
    ],
    endShot: 'end-l10.png',
  },
];

async function main() {
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

  try {
    for (const run of RUNS) {
      const page = await openPage(browser, failures);
      try {
        written.push(
          ...(await driveRun(page, `http://127.0.0.1:${port}/${run.query}`, run, failures, OUT_DIR)),
        );
      } finally {
        await page.context().close();
      }
    }

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
  } finally {
    await browser.close();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }

  if (failures.length > 0) {
    throw new Error(`page reported ${failures.length} error(s):\n  ${failures.join('\n  ')}`);
  }

  console.log(`[smoke] PASS — ${written.join(', ')} in artifacts/smoke/`);
}

main().catch((error) => {
  console.error(`[smoke] FAIL — ${error.message}`);
  process.exitCode = 1;
});
