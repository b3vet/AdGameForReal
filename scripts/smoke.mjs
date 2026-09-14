/**
 * Smoke test: build, serve, drive the game in headless Chromium, screenshot.
 *
 * This file is the plan: which runs are played and what each frame is waiting
 * for. Four files sit behind it — `./smoke-browser.mjs` is the plumbing (the
 * static server, Chromium, the page, the blank-frame check), `./smoke-run.mjs`
 * drives one scripted run and asserts what a run owes, `./smoke-stress.mjs`
 * drives the performance scene and its render-cost tripwire, and
 * `./smoke-hero.mjs` takes the hero set at the phone's own pixel ratios.
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

/** Wall clock since `start`, for the budget line at the end. */
function since(start) {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`;
}

/**
 * The runs this smoke drives, in order. The first is the definition-of-done
 * run: a greedy clear of level 1, photographed early, mid and late down the
 * road and then in the boss fight. The others exist to prove a loss screen, a
 * Frostfell level with both new kinds and its own boss (D49), and a big
 * level-10 squad all render.
 *
 * A shot is keyed to a point on the road (`z`, in metres) or to a moment in the
 * sim — a gate row, a shield breaking, a body charging — never to the wall
 * clock. The frame loop is stopped on the first frame that
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
    // The loss sheet: a defeat ribbon and, since D46, a purse that still fills
    // — a lost run pays 30 percent of the road it walked, and `src/ui/result.ts`
    // rolls those coins up where it used to skip the roll entirely.
    //
    // Level 4, not the level 3 this run photographed through Milestone 5: the
    // balance retune made levels 1 to 3 generous (D31) and a *random* bot now
    // clears level 3 on this seed, which quietly turned the smoke's loss frame
    // into a second win frame. Level 4 seed 2 is a loss in 53 s of sim.
    label: 'random level 4',
    query: `?bot=random&level=4&seed=2&turbo=${TURBO}&screenshot=1`,
    shots: [],
    endShot: 'end-random.png',
  },
  {
    // The Academy with something in it (D33): a save injected through the
    // debug handle before the home is photographed, so the purse, the bought
    // upgrades and the chosen staff are all on screen — and the result sheet
    // at the end is the one with coins on it.
    label: 'academy level 6',
    query: `?bot=greedy&level=6&seed=3&turbo=${TURBO}&screenshot=1`,
    // 6000 rather than Milestone 5's 2400: the economy re-priced the ladder
    // (D46), a Yard rung is `900 * 1.6^level`, and this save's next two rungs
    // cost 3686 and 2304. 2400 bought one row of five and greyed the rest;
    // 6000 buys two, which is what `yard.png` is a picture of.
    save: {
      coins: 6000,
      upgrades: { damage: 3, fireRate: 2, startCount: 0, gateBonus: 0, bossDamage: 0 },
      staffs: {
        ember: { unlocked: true, tier: 1 },
        storm: { unlocked: true, tier: 1 },
        frost: { unlocked: false, tier: 1 },
      },
      selectedStaff: 'storm',
      familiar: { unlocked: true, tier: 1 },
      unlockedLevel: 7,
    },
    titleShot: 'academy.png',
    menuShots: [{ open: '#academy-yard', name: 'yard.png', back: '#room-back' }],
    shots: [],
    endShot: 'result-coins.png',
  },
  {
    /**
     * Frostfell (D49), and the one run keyed to *moments* rather than to places:
     * a charger running its lane, a shielded brute before and after its shield
     * breaks, and the Rime Fiend's charge. `scripts/smoke-run.mjs` paces the sim
     * down as each comes into reach, because at turbo 60 a frame is three
     * seconds of sim and none of those windows is a second long.
     *
     * Level 23 because it is the first that carries both new kinds — one
     * charger row and one shield row (`src/data/levels.json`) — and seed 1 puts
     * the shielded brute at z 215 and the charger at z 342, so the road offers
     * them in the order the shot list asks for.
     *
     * Armed, because from level 21 the game is balanced for a player who has
     * shopped (Milestone 7 Phase D): the save below is what the campaign says
     * the human is holding when it first reaches level 23, read off
     * `runCampaign` rather than invented. Bare, the greedy bot clears 37 of 100
     * up here and this run would be a coin flip.
     *
     * Scale 1 like every other run: the boss's volley is additive fill, and
     * Phase C measured a fraction of a frame per second at 2x on this
     * rasteriser. The 2x pictures of all of this are the hero set's job.
     */
    label: 'greedy frost level 23',
    query: `?bot=greedy&level=23&seed=1&turbo=${TURBO}&screenshot=1`,
    save: {
      coins: 0,
      upgrades: { damage: 2, fireRate: 2, startCount: 2, gateBonus: 2, bossDamage: 1 },
      staffs: {
        ember: { unlocked: true, tier: 1 },
        storm: { unlocked: true, tier: 1 },
        frost: { unlocked: true, tier: 1 },
      },
      selectedStaff: 'frost',
      familiar: { unlocked: false, tier: 0 },
      unlockedLevel: 23,
    },
    shots: [
      { at: 'shield', name: 'frost-shield.png' },
      { at: 'shieldBroken', name: 'frost-shield-broken.png' },
      { at: 'charge', name: 'frost-charger.png' },
      { at: 'bossCharge', name: 'frost-boss-charge.png' },
    ],
    endShot: 'end-frost.png',
    // The Frostfell road, the crowd and the plaques in one frame: the biome has
    // to be able to fail this check too, not only the meadow.
    assertNotBlank: 'frost-charger.png',
    // A level with a charger row that drew none is a level whose charger frame
    // is a picture of an empty lane; see `smoke-run.mjs`.
    expectChargers: true,
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
    const queue = RUNS.slice();
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

    // Last, and in its own file: the frames the milestone is *judged* on, at
    // the pixel ratios a phone renders at (`./smoke-hero.mjs`). Everything
    // above is an assertion with a picture attached; this is the picture.
    const heroAt = Date.now();
    written.push(
      ...(await driveHeroSet(browser, `http://127.0.0.1:${String(port)}/`, OUT_DIR, failures, openPage)),
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
