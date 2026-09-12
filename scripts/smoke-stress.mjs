/**
 * The smoke's performance scene (`?scene=stress`): 500 mages, 40 skeletons, 300
 * live stream bodies dying twenty times a second, and the ragdolls that rule
 * throws. This is the frame that says whether the crowd still draws in one call
 * each and whether a change made the renderer twice as expensive
 * (docs/06-milestone-2-plan.md, "Performance"; docs/09-milestone-3-plan.md,
 * "300 units plus 200 live stream enemies").
 *
 * Split out of `scripts/smoke.mjs` in Milestone 3 Phase D: that file is about
 * the scripted runs and the frames they photograph, this one is about the
 * perf scene and the tripwire on it.
 */

import { stat } from 'node:fs/promises';
import path from 'node:path';

import { SCREENSHOT_TIMEOUT_MS, assertNotBlank, sleep } from './smoke-browser.mjs';

/** How long each sampled window runs before its median is read. */
const STRESS_SECONDS = 8;

/**
 * Windows sampled, and how many of them have to be over budget before the smoke
 * fails.
 *
 * One window is three or four frames under SwiftShader, so a single hiccup —
 * another build on the same machine, a page fault, the rasteriser's own
 * scheduling — can own its median. Three windows and a two-of-three rule turn
 * that into a fact about the renderer rather than a fact about the box: a real
 * regression is over budget in every window, a busy machine in one. All three
 * are printed either way, because the numbers are the signal and the pass/fail
 * is only the tripwire.
 */
const STRESS_WINDOWS = 3;
const STRESS_WINDOWS_TO_FAIL = 2;

/**
 * Live stream bodies the measured frame must still have. The scene starts 300
 * and kills twenty a second, so a healthy run sits just under 300 as the corpse
 * window recycles them; anything far below that means the river drained and the
 * frame measured an empty road.
 */
const STRESS_MIN_STREAM_BODIES = 240;

/**
 * Tripwire on the stress scene's median `scene.render` cost, in milliseconds.
 *
 * Re-baselined in Milestone 3 Phase C, for two reasons. The scene is heavier —
 * 500 mages, 40 skeletons and 300 live stream bodies, with a kill every 50 ms
 * and 7 to 8 live ragdolls — and it is also *cheaper*, because it now runs the
 * renderer's warm-up pass before it measures anything: without it the first
 * frame that drew a corpse compiled its shader inside `scene.render` and cost
 * twelve to fifteen seconds under SwiftShader, which the median excluded and
 * nobody could see.
 *
 * Measured with the warm-up, four runs on this machine: medians 4.2, 4.6, 5.2
 * and 5.7 ms; worst frames 18 to 29 ms; first frames 30 to 34 ms, where they
 * were 490 to 1050 ms before the pass. The wall clock is still 600 to 900 ms
 * per frame, because the software rasteriser finishes long after
 * `scene.render` returns — which is why only three or four frames fit in each
 * eight-second window and a window's median is over a handful of samples.
 *
 * The limit is twice the top of that band, which is a real tripwire rather
 * than the old 125 ms formality: a change that doubles the renderer's cost
 * trips it, in every window. A machine that is also building something else
 * may trip one window, which is what the two-of-three rule above is for, and
 * `SMOKE_STRESS_RENDER_MS` is what raises the bar outright. The numbers every
 * run prints next to it are the real signal — watch them drift.
 */
const STRESS_RENDER_MS_LIMIT = Number(process.env.SMOKE_STRESS_RENDER_MS ?? 12);

/** One window: run for `STRESS_SECONDS`, read the stats, start the next clean. */
async function sampleWindow(page) {
  await sleep(STRESS_SECONDS * 1000);
  const stats = await page.evaluate(() => globalThis.__stress?.stats() ?? null);
  await page.evaluate(() => {
    globalThis.__stress?.resetSamples();
  });
  return stats;
}

/** `4.2 / 5.1 / 4.6 ms`, or `4.2 / - / 4.6 ms` where a window drew no frames. */
function describeWindows(windows) {
  return windows
    .map((window) => (window.samples === 0 ? '-' : window.renderMs.toFixed(1)))
    .join(' / ');
}

/**
 * Drives the scene, samples `STRESS_WINDOWS` windows, photographs the last
 * frame and pushes any failure onto `failures`. Returns the screenshot line for
 * the smoke's summary.
 */
export async function driveStress(page, url, failures, outDir) {
  console.log(`[smoke] stress scene: ${url.slice(url.indexOf('?'))}`);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => globalThis.__stress?.ready === true, null, { timeout: 60_000 });

  const windows = [];
  let stats = null;
  for (let i = 0; i < STRESS_WINDOWS; i++) {
    stats = await sampleWindow(page);
    if (stats === null) break;
    windows.push({ renderMs: stats.renderMs, samples: stats.renderSamples, max: stats.renderMsMax });
  }

  // Read first, then stop the loop: a paused page hands the compositor the
  // frame it already has instead of starving the screenshot request.
  await page.evaluate(() => {
    globalThis.__stress?.pause();
  });
  const file = path.join(outDir, 'stress.png');
  await page.screenshot({ path: file, timeout: SCREENSHOT_TIMEOUT_MS });
  console.log('[smoke] screenshot stress.png');
  const { size } = await stat(file);
  const line = `stress.png (${(size / 1024).toFixed(0)} KB)`;

  if (stats === null) {
    failures.push('stress scene: __stress.stats() returned nothing');
    return line;
  }

  const measured = windows.filter((window) => window.samples > 0);
  const over = measured.filter((window) => window.renderMs > STRESS_RENDER_MS_LIMIT);

  console.log(
    `[smoke] stress: ${stats.mages} mages + ${stats.skeletons} skeletons + ` +
      `${stats.streamBodies} stream bodies in ${stats.drawCalls} draw calls\n` +
      `[smoke]   render ${describeWindows(windows)} ms ` +
      `(${STRESS_WINDOWS} windows of ${STRESS_SECONDS}s, ` +
      `${measured.map((w) => String(w.samples)).join('/')} frames each, ` +
      `tripwire ${STRESS_RENDER_MS_LIMIT} ms, ${over.length} over)\n` +
      `[smoke]   worst frame ${stats.renderMsMax.toFixed(0)} ms, first frame ` +
      `${stats.renderMsFirst.toFixed(0)} ms\n` +
      `[smoke]   wall clock ${stats.frameMs.toFixed(0)} ms per frame, ` +
      `${stats.frames} frames in ${stats.seconds.toFixed(1)}s\n` +
      `[smoke]   ragdolls ${stats.ragdolls}, shards ${stats.shards}, ` +
      `physics quality ${stats.quality}`,
  );

  if (measured.length === 0) {
    console.log('[smoke] note: the stress scene drew too few frames to measure');
  } else if (over.length >= STRESS_WINDOWS_TO_FAIL) {
    failures.push(
      `stress scene: ${over.length} of ${measured.length} windows over the ` +
        `${STRESS_RENDER_MS_LIMIT} ms tripwire (${describeWindows(windows)} ms)`,
    );
  } else if (over.length > 0) {
    console.log(
      `[smoke] note: ${over.length} window over the tripwire, which is inside ` +
        'the two-of-three rule — a busy machine, not a regression',
    );
  }

  if (stats.ragdolls === 0) {
    console.log(
      stats.quality === 0
        ? '[smoke] note: no ragdolls — the physics layer degraded to quality 0'
        : '[smoke] note: no ragdolls were live in the measured frames',
    );
  }
  // The river is the point of the scene now: a frame measured without it is a
  // measurement of the old worst case, not of this one.
  if (stats.streamBodies < STRESS_MIN_STREAM_BODIES) {
    failures.push(
      `stress scene: only ${stats.streamBodies} stream bodies were on their feet ` +
        `(expected at least ${STRESS_MIN_STREAM_BODIES})`,
    );
  }

  await assertNotBlank(file, 'stress.png');
  return line;
}
