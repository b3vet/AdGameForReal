/**
 * Smoke test: build, serve, drive the game in headless Chromium, screenshot.
 *
 * This file is the plan: which runs are played, what each frame is waiting for,
 * and what counts as a failure. The browser plumbing behind it — the static
 * server, Chromium, the page, the blank-frame check — is `./smoke-browser.mjs`.
 *
 * Proves the whole pipeline end to end — that the bundle loads, that Babylon
 * gets a WebGL context under SwiftShader, and that the frames are not blank.
 * See docs/03-milestone-1-plan.md.
 *
 *   npm run smoke
 */

import { existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

import {
  SCREENSHOT_TIMEOUT_MS,
  assertNotBlank,
  launchBrowser,
  openPage,
  serveDist,
  sleep,
} from './smoke-browser.mjs';

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

/** What a shot is waiting for, for the failure message. */
function describeShot(frame) {
  if (frame.at === 'z') return `${String(frame.value)} m of road`;
  if (frame.at === 'boss') return 'the boss fight';
  return 'a staff gate';
}

/**
 * How close a staff gate has to be before its frame is taken, in metres. Wider
 * than a turbo frame's fifteen metres of road, or the squad steps over the
 * window between two frames and the gate is never photographed; not much wider,
 * or the panel is a smudge in the fog and its staff prop is three pixels.
 */
const STAFF_SHOT_RANGE = 18;

/**
 * The boss frame is taken on the first frame where the boss is down to this
 * share of its health — half way through the fight, so the demon has walked
 * into the squad and has a stomp on the ground, with the bar and its HP label
 * both up. A turbo frame is about a seventh of the fight, so there is no risk
 * of stepping from above this straight to a dead boss.
 *
 * Milestone 2's boss.png was a picture of a *dead* boss: the shot was a fixed
 * delay after `boss.active`, and at turbo 60 one frame is three seconds of sim,
 * so the whole fight could pass inside it. Then the HUD's boss bar is hidden
 * (the bar follows `boss.alive`) and the world HP label is gone with the body,
 * which read as two missing-UI bugs and was one timing bug.
 */
const BOSS_SHOT_HP_SHARE = 0.5;
/** Ceiling on one shot's wait, so a run that never gets there still ends. */
const SHOT_TIMEOUT_MS = Number(process.env.SMOKE_SHOT_TIMEOUT_MS ?? 120_000);

/** The stress scene: how long it runs before the frame and the numbers. */
const STRESS_SECONDS = 8;

/**
 * Tripwire on the stress scene's median `scene.render` cost, in milliseconds.
 *
 * Measured here under SwiftShader with 500 mages, 40 skeletons and 8 to 16
 * live ragdolls: 7.4, 10.3, 12.6, 16.1 and — on a run where the machine was
 * also building something else — 62.4 ms. The first frame of each run is 490
 * to 1050 ms of shader compilation, which the median excludes, and the wall
 * clock is 540 to 1300 ms per frame because the software rasteriser finishes
 * long after `scene.render` returns; that is also why only two to four frames
 * fit in the eight-second window, so the median is over a handful of samples
 * and moves with whatever else the machine is doing.
 *
 * The limit is therefore twice the top of the *observed* band rather than
 * twice a single reading: a change that doubles the renderer's cost still
 * trips it, and a busy machine does not. The number every run prints is the
 * real signal — watch it drift. `SMOKE_STRESS_RENDER_MS` overrides.
 */
const STRESS_RENDER_MS_LIMIT = Number(process.env.SMOKE_STRESS_RENDER_MS ?? 125);

/**
 * How long to wait for a run to reach a terminal status. A greedy level-10 run
 * is about 75 s of sim time; at turbo 20 and the frame rate a 400-mage crowd
 * gets out of SwiftShader that is a little over a minute of wall clock, and
 * this leaves room for a slow machine without blowing the smoke's budget.
 */
const RUN_END_TIMEOUT_MS = Number(process.env.SMOKE_RUN_TIMEOUT_MS ?? 180_000);

/**
 * How long to wait for the result screen after the run reaches a terminal
 * status. The app holds it back ~0.8 s of *frame* time, which is several times
 * that in wall-clock time on a SwiftShader machine.
 */
const RESULT_SETTLE_MS = 20_000;

/**
 * Draw-call ceiling for a live run, physics and all (plan, "Performance": 40 at
 * 500 units for the render layer alone). Debris is what pushes past that — a
 * ragdoll is a skinned mesh and therefore a call of its own — and the caps in
 * `src/physics/tuning.ts` are what hold this line.
 */
const DRAW_CALL_LIMIT = Number(process.env.SMOKE_DRAW_CALLS ?? 52);

/** Resolves when the run reaches `won` or `lost`. */
function waitForRunEnd(page) {
  return page.waitForFunction(
    () => {
      const status = globalThis.__arcane?.state()?.status;
      return typeof status === 'string' && status !== 'running';
    },
    null,
    { timeout: RUN_END_TIMEOUT_MS },
  );
}

/**
 * Installs a page-side watcher that walks the run's shot list.
 *
 * Every frame it asks whether the current step's moment has arrived, and the
 * first frame that says yes stops the app's loop *from inside the page*. That
 * is the whole trick: a `waitForFunction` round trip back to Node costs a frame
 * or three, and a turbo frame is three seconds of sim — long enough for the
 * boss to die or the gate to end up behind the squad. With the loop stopped
 * nothing moves while the picture is taken, so the frame photographed is the
 * frame that qualified, on any machine.
 */
async function armShotPlan(page, shots, bossShare, staffRange) {
  await page.evaluate(
    ({ plan, share, range }) => {
      globalThis.__smokePlan = plan;
      globalThis.__smokeStep = 0;
      globalThis.__smokeStopped = false;

      const holds = (step, state) => {
        if (step.at === 'z') return state.squad.z >= step.value;
        if (step.at === 'boss') {
          const boss = state.boss;
          // Under way and still standing: bar and HP label are both up.
          return boss !== null && boss.active && boss.alive && boss.hp <= boss.maxHp * share;
        }
        return state.gates.some(
          (gate) =>
            gate.kind === 'weapon' &&
            !gate.passed &&
            gate.z - state.squad.z > 0 &&
            gate.z - state.squad.z < range,
        );
      };

      const tick = () => {
        globalThis.requestAnimationFrame(tick);
        if (globalThis.__smokeStopped) return;
        const step = globalThis.__smokePlan[globalThis.__smokeStep];
        const state = globalThis.__arcane?.state();
        if (step === undefined || !state) return;
        if (!holds(step, state)) return;
        globalThis.__arcane?.app.stop();
        globalThis.__smokeStopped = true;
      };
      globalThis.requestAnimationFrame(tick);
    },
    { plan: shots, share: bossShare, range: staffRange },
  );
}

/** Waits for the watcher to stop on the current step. False on a timeout. */
function waitForStop(page, timeout) {
  return page
    .waitForFunction(() => globalThis.__smokeStopped === true, null, { timeout })
    .then(() => true)
    .catch(() => false);
}

/** Releases the loop and moves the watcher on to the next step. */
function releaseStop(page) {
  return page.evaluate(() => {
    globalThis.__smokeStep = (globalThis.__smokeStep ?? 0) + 1;
    globalThis.__smokeStopped = false;
    globalThis.__arcane?.app.resume();
  });
}

/** Plays one scripted run to its result screen, writing every shot it asks for. */
async function driveRun(page, url, run, failures) {
  const shot = async (name) => {
    const file = path.join(OUT_DIR, name);
    await page.screenshot({ path: file, timeout: SCREENSHOT_TIMEOUT_MS });
    const { size } = await stat(file);
    console.log(`[smoke] screenshot ${name}`);
    return `${name} (${(size / 1024).toFixed(0)} KB)`;
  };

  console.log(`[smoke] ${run.label}: ${run.query}`);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => globalThis.__arcane?.ready === true, null, { timeout: 30_000 });

  const written = [];

  // The title screen is part of the definition of done, so it gets a frame of
  // its own before anything is clicked.
  await sleep(300);
  if (run.titleShot !== undefined) written.push(await shot(run.titleShot));

  await armShotPlan(page, run.shots, BOSS_SHOT_HP_SHARE, STAFF_SHOT_RANGE);
  await page.click('#play-button');
  const startedAt = Date.now();

  for (const frame of run.shots) {
    const reached = await waitForStop(page, SHOT_TIMEOUT_MS);
    if (!reached) {
      failures.push(`${run.label}: ${frame.name} — the run never reached ${describeShot(frame)}`);
      break;
    }
    try {
      written.push(await shot(frame.name));
    } finally {
      await releaseStop(page);
    }
  }

  await waitForRunEnd(page);

  const status = await page.evaluate(() => globalThis.__arcane?.state()?.status ?? 'unknown');
  // The app holds the result screen back a beat so the last frames play out.
  await page
    .waitForFunction(() => globalThis.__arcane?.app.status() === 'result', null, {
      timeout: RESULT_SETTLE_MS,
    })
    .catch(() => {});
  const phase = await page.evaluate(() => globalThis.__arcane?.app.status() ?? 'unknown');
  // The result numbers roll up over 0.7 s of wall clock, which is one frame
  // here: without this the picture is of a count-up caught at "1".
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
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const draws = await page.evaluate(
    () => globalThis.__arcane?.draws() ?? { current: 0, peak: 0 },
  );
  const quality = await page.evaluate(() => ({
    rung: globalThis.__arcane?.quality() ?? -1,
    physics: globalThis.__arcane?.physics()?.stats.quality ?? -1,
  }));
  console.log(`[smoke] ${run.label}: ${status} after ${seconds}s of wall clock, phase ${phase}`);
  console.log(
    `[smoke]   draw calls: peak ${draws.peak} (limit ${DRAW_CALL_LIMIT}), ` +
      `ladder rung ${quality.rung}, physics quality ${quality.physics}`,
  );
  if (phase !== 'result') failures.push(`${run.label}: run ended but the result screen never showed`);
  if (draws.peak > DRAW_CALL_LIMIT) {
    failures.push(
      `${run.label}: peak ${draws.peak} draw calls is over the ${DRAW_CALL_LIMIT} budget`,
    );
  }

  written.push(await shot(run.endShot));

  if (run.assertNotBlank !== undefined) {
    await assertNotBlank(path.join(OUT_DIR, run.assertNotBlank), run.assertNotBlank);
  }

  return written;
}

/**
 * The performance scene (`?scene=stress`): 500 mages, 40 skeletons and live
 * ragdolls, held for `STRESS_SECONDS` and then measured. This is the frame that
 * says whether the crowd still draws in one call each and whether a change made
 * the renderer twice as expensive (docs/06-milestone-2-plan.md, "Performance").
 */
async function driveStress(page, url, failures) {
  console.log(`[smoke] stress scene: ${url.slice(url.indexOf('?'))}`);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => globalThis.__stress?.ready === true, null, { timeout: 60_000 });

  await sleep(STRESS_SECONDS * 1000);

  const stats = await page.evaluate(() => globalThis.__stress?.stats() ?? null);
  // Read first, then stop the loop: a paused page hands the compositor the
  // frame it already has instead of starving the screenshot request.
  await page.evaluate(() => {
    globalThis.__stress?.pause();
  });
  const file = path.join(OUT_DIR, 'stress.png');
  await page.screenshot({ path: file, timeout: SCREENSHOT_TIMEOUT_MS });
  console.log('[smoke] screenshot stress.png');
  const { size } = await stat(file);

  if (stats === null) {
    failures.push('stress scene: __stress.stats() returned nothing');
    return `stress.png (${(size / 1024).toFixed(0)} KB)`;
  }

  console.log(
    `[smoke] stress: ${stats.mages} mages + ${stats.skeletons} skeletons in ` +
      `${stats.drawCalls} draw calls\n` +
      `[smoke]   render ${stats.renderMs.toFixed(1)} ms median of ${stats.renderSamples} ` +
      `frames (worst ${stats.renderMsMax.toFixed(0)} ms, first frame ` +
      `${stats.renderMsFirst.toFixed(0)} ms, tripwire ${STRESS_RENDER_MS_LIMIT} ms)\n` +
      `[smoke]   wall clock ${stats.frameMs.toFixed(0)} ms per frame, ` +
      `${stats.frames} frames in ${stats.seconds.toFixed(1)}s\n` +
      `[smoke]   ragdolls ${stats.ragdolls}, shards ${stats.shards}, ` +
      `physics quality ${stats.quality}`,
  );
  if (stats.renderSamples === 0) {
    console.log('[smoke] note: the stress scene drew too few frames to measure');
  } else if (stats.renderMs > STRESS_RENDER_MS_LIMIT) {
    failures.push(
      `stress scene: render ${stats.renderMs.toFixed(1)} ms is over the ` +
        `${STRESS_RENDER_MS_LIMIT} ms tripwire`,
    );
  }
  if (stats.ragdolls === 0) {
    console.log(
      stats.quality === 0
        ? '[smoke] note: no ragdolls — the physics layer degraded to quality 0'
        : '[smoke] note: no ragdolls were live in the measured frames',
    );
  }

  await assertNotBlank(file, 'stress.png');
  return `stress.png (${(size / 1024).toFixed(0)} KB)`;
}

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
        written.push(...(await driveRun(page, `http://127.0.0.1:${port}/${run.query}`, run, failures)));
      } finally {
        await page.context().close();
      }
    }

    const stressPage = await openPage(browser, failures);
    try {
      written.push(await driveStress(stressPage, `http://127.0.0.1:${port}/?scene=stress&screenshot=1`, failures));
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
