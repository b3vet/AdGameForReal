/**
 * Smoke test: build, serve, drive the game in headless Chromium, screenshot.
 *
 * Proves the whole pipeline end to end — that the bundle loads, that Babylon
 * gets a WebGL context under SwiftShader, and that the frames are not blank.
 * See docs/03-milestone-1-plan.md.
 *
 *   npm run smoke
 */

import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { build } from 'vite';

import { decodePng, luminanceStats } from './png.mjs';

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
 * run: a greedy clear of level 1 with a shot at 1 s, 6 s and 12 s. The others
 * exist to prove a loss screen and a big level-10 squad also render.
 */
const RUNS = [
  {
    label: 'greedy level 1',
    query: `?bot=greedy&level=1&seed=1&turbo=${TURBO}`,
    titleShot: 'title.png',
    shots: [
      { at: 1, name: 't1.png' },
      { at: 6, name: 't6.png' },
      { at: 12, name: 't12.png' },
    ],
    // Taken BOSS_SHOT_DELAY_MS after the boss activates, so the frame is the
    // fight and not the walk up to it.
    bossShot: 'boss.png',
    endShot: 'end.png',
    // The frame the blank-frame check runs on: mid-run, squad and gates on screen.
    assertNotBlank: 't6.png',
  },
  {
    label: 'random level 3',
    query: `?bot=random&level=3&seed=2&turbo=${TURBO}`,
    shots: [],
    endShot: 'end-random.png',
  },
  {
    label: 'greedy level 10',
    query: `?bot=greedy&level=10&seed=1&turbo=${TURBO}`,
    shots: [{ at: 12, name: 't12-l10.png' }],
    endShot: 'end-l10.png',
  },
];

/**
 * How long after `boss.active` the boss frame is taken. The fight lasts 20 to
 * 30 s of sim time, which at turbo 20 is a handful of frames, so three seconds
 * lands inside it — and if the boss dies first, the shot is taken then rather
 * than after the result screen has replaced it.
 */
const BOSS_SHOT_DELAY_MS = 3_000;

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

/** The frame we assert on. A live scene is far above these floors. */
const BLANK_STD_DEV_FLOOR = 3;
const BLANK_BUCKET_FLOOR = 6;

/**
 * Playwright asks the compositor for a fresh frame and waits for it. A crowd
 * scene under SwiftShader can take over a second to draw, so the default 30 s
 * is not the comfortable margin it looks like.
 */
const SCREENSHOT_TIMEOUT_MS = 90_000;

const VIEWPORT = { width: 390, height: 844 };

/**
 * One device pixel per CSS pixel, where Milestone 1 shot at two.
 *
 * SwiftShader is fill-rate bound on this scene: at 2x the same run takes half
 * again as long, for a screenshot that is only bigger, not more informative.
 * 390x844 is a phone frame either way.
 */
const DEVICE_SCALE_FACTOR = 1;

/** SwiftShader: headless Chromium has no GPU, so force the software rasteriser. */
const CHROMIUM_ARGS = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

const CHROMIUM_FALLBACKS = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  // `assets/` is copied into dist by vite.config.ts; these are its types.
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wav': 'audio/wav',
  '.bin': 'application/octet-stream',
};

function serveDist(root) {
  const server = createServer((req, res) => {
    const requested = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
    const resolved = path.resolve(root, relative);

    // Never serve outside dist/, whatever the request path claims.
    const filePath =
      resolved.startsWith(root + path.sep) || resolved === root
        ? resolved
        : path.join(root, 'index.html');

    const target = existsSync(filePath) ? filePath : path.join(root, 'index.html');

    res.writeHead(200, {
      'content-type': MIME[path.extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(target).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function resolveChromiumPath() {
  try {
    const fromPlaywright = chromium.executablePath();
    if (existsSync(fromPlaywright)) return fromPlaywright;
  } catch {
    // Fall through to the preinstalled browser.
  }
  const fallback = CHROMIUM_FALLBACKS.find((candidate) => existsSync(candidate));
  if (fallback === undefined) {
    throw new Error(
      `Chromium not found. Looked in Playwright's cache and:\n  ${CHROMIUM_FALLBACKS.join('\n  ')}`,
    );
  }
  return fallback;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function assertNotBlank(file, label) {
  const stats = luminanceStats(decodePng(await readFile(file)));
  const summary =
    `mean ${stats.mean.toFixed(1)}, ` +
    `stdDev ${stats.stdDev.toFixed(2)}, ` +
    `${stats.distinctBuckets} luminance buckets`;

  if (stats.stdDev < BLANK_STD_DEV_FLOOR || stats.distinctBuckets < BLANK_BUCKET_FLOOR) {
    throw new Error(`${label} looks blank (${summary}). Nothing rendered.`);
  }
  console.log(`  ${label}: ${summary}`);
}

async function openPage(browser, failures, overrides = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    isMobile: true,
    hasTouch: true,
    ...overrides,
  });
  const page = await context.newPage();

  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    failures.push(`page error: ${error.message}`);
  });

  return page;
}

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

  await page.click('#play-button');
  const startedAt = Date.now();

  for (const frame of run.shots) {
    const wait = frame.at * 1000 - (Date.now() - startedAt);
    if (wait > 0) await sleep(wait);
    written.push(await shot(frame.name));
  }

  if (run.bossShot !== undefined) {
    const activated = await page
      .waitForFunction(() => globalThis.__arcane?.state()?.boss?.active === true, null, {
        timeout: RUN_END_TIMEOUT_MS,
      })
      .then(() => true)
      .catch(() => false);

    if (!activated) {
      failures.push(`${run.label}: the boss never activated`);
    } else {
      await Promise.race([sleep(BOSS_SHOT_DELAY_MS), waitForRunEnd(page).catch(() => {})]);
      written.push(await shot(run.bossShot));
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
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[smoke] ${run.label}: ${status} after ${seconds}s of wall clock, phase ${phase}`);
  if (phase !== 'result') failures.push(`${run.label}: run ended but the result screen never showed`);

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

  const executablePath = resolveChromiumPath();
  console.log(`[smoke] chromium: ${executablePath}`);

  const browser = await chromium.launch({ executablePath, args: CHROMIUM_ARGS });
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
      written.push(await driveStress(stressPage, `http://127.0.0.1:${port}/?scene=stress`, failures));
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
