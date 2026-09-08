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
 * `turbo=8` runs the sim eight times faster than the wall clock. SwiftShader
 * draws a few frames a second on a big squad, and a full level is a minute of
 * sim time; without this the smoke would take three minutes per run.
 */
const TURBO = 8;

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
 * How long to wait for a run to reach a terminal status. A greedy level-10 run
 * is about 75 s of sim time, which is ~10 s of wall clock at turbo 8 when the
 * renderer keeps up and well inside this when it does not.
 */
const RUN_END_TIMEOUT_MS = Number(process.env.SMOKE_RUN_TIMEOUT_MS ?? 120_000);

/**
 * How long to wait for the result screen after the run reaches a terminal
 * status. The app holds it back ~0.8 s of *frame* time, which is several times
 * that in wall-clock time on a SwiftShader machine.
 */
const RESULT_SETTLE_MS = 15_000;

/** The frame we assert on. A live scene is far above these floors. */
const BLANK_STD_DEV_FLOOR = 3;
const BLANK_BUCKET_FLOOR = 6;

const VIEWPORT = { width: 390, height: 844 };
const DEVICE_SCALE_FACTOR = 2;

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

async function openPage(browser, failures) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    isMobile: true,
    hasTouch: true,
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

/** Plays one scripted run to its result screen, writing every shot it asks for. */
async function driveRun(page, url, run, failures) {
  const shot = async (name) => {
    const file = path.join(OUT_DIR, name);
    await page.screenshot({ path: file });
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

  await page.waitForFunction(
    () => {
      const status = globalThis.__arcane?.state()?.status;
      return typeof status === 'string' && status !== 'running';
    },
    null,
    { timeout: RUN_END_TIMEOUT_MS },
  );

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
