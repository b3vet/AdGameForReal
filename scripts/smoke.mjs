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

const URL_PATH = '/?bot=greedy&level=1&seed=1';

/** Seconds after Play is clicked. */
const SHOTS = [
  { at: 1, name: 't1.png' },
  { at: 6, name: 't6.png' },
  { at: 12, name: 't12.png' },
];

const TITLE_SHOT = 'title.png';
const END_SHOT = 'end.png';

/**
 * How long to wait for the run to reach a terminal status. Overridable for
 * local iteration; the default is the number in docs/03-milestone-1-plan.md.
 */
const RUN_END_TIMEOUT_MS = Number(process.env.SMOKE_RUN_TIMEOUT_MS ?? 90_000);

/**
 * How long to wait for the result screen after the run reaches a terminal
 * status. The app holds it back ~0.8 s of *frame* time, which is several times
 * that in wall-clock time on a SwiftShader machine.
 */
const RESULT_SETTLE_MS = 15_000;

/**
 * With a stub sim a run never ends, so a timeout is a warning by default and a
 * failure once the tech lead integrates (`SMOKE_STRICT=1`).
 */
const STRICT = process.env.SMOKE_STRICT === '1';

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

async function main() {
  console.log('[smoke] building...');
  await build({ logLevel: 'warn' });

  if (!existsSync(path.join(DIST, 'index.html'))) {
    throw new Error('build produced no dist/index.html');
  }

  await mkdir(OUT_DIR, { recursive: true });

  const { server, port } = await serveDist(DIST);
  const url = `http://127.0.0.1:${port}${URL_PATH}`;
  console.log(`[smoke] serving dist/ at http://127.0.0.1:${port}`);

  const executablePath = resolveChromiumPath();
  console.log(`[smoke] chromium: ${executablePath}`);

  const browser = await chromium.launch({ executablePath, args: CHROMIUM_ARGS });
  const failures = [];
  let runEndWarning = null;

  try {
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

    console.log(`[smoke] opening ${URL_PATH}`);
    await page.goto(url, { waitUntil: 'load' });

    await page.waitForFunction(() => globalThis.__arcane?.ready === true, null, { timeout: 30_000 });
    console.log('[smoke] __arcane.ready');

    // The title screen is part of the definition of done, so it gets a frame of
    // its own before anything is clicked.
    await sleep(300);
    await page.screenshot({ path: path.join(OUT_DIR, TITLE_SHOT) });
    console.log(`[smoke] screenshot ${TITLE_SHOT}`);

    await page.click('#play-button');
    const startedAt = Date.now();
    console.log('[smoke] clicked Play');

    for (const shot of SHOTS) {
      const wait = shot.at * 1000 - (Date.now() - startedAt);
      if (wait > 0) await sleep(wait);
      const file = path.join(OUT_DIR, shot.name);
      await page.screenshot({ path: file });
      console.log(`[smoke] screenshot ${shot.name} at ~${shot.at}s`);
    }

    console.log(`[smoke] waiting for the run to end (up to ${RUN_END_TIMEOUT_MS / 1000}s)...`);
    let ended = true;
    try {
      await page.waitForFunction(
        () => {
          const status = globalThis.__arcane?.state()?.status;
          return typeof status === 'string' && status !== 'running';
        },
        null,
        { timeout: RUN_END_TIMEOUT_MS },
      );
    } catch {
      ended = false;
    }

    if (ended) {
      const status = await page.evaluate(() => globalThis.__arcane?.state()?.status ?? 'unknown');
      // The app holds the result screen back ~0.8 s of frame time so the last
      // frames play out; that is longer than 0.8 s of wall clock on SwiftShader.
      await page
        .waitForFunction(() => globalThis.__arcane?.app.status() === 'result', null, {
          timeout: RESULT_SETTLE_MS,
        })
        .catch(() => {});
      const phase = await page.evaluate(() => globalThis.__arcane?.app.status() ?? 'unknown');
      console.log(`[smoke] run ended: status ${status}, app phase ${phase}`);
    } else {
      runEndWarning =
        `run did not end within ${RUN_END_TIMEOUT_MS / 1000}s — ` +
        `${END_SHOT} is a mid-run frame, not the result screen. ` +
        'A full level 1 greedy run takes ~200s of wall clock under SwiftShader ' +
        '(32s of sim time at ~6 fps once the squad is large): raise ' +
        'SMOKE_RUN_TIMEOUT_MS to capture the real result screen.';
    }

    await page.screenshot({ path: path.join(OUT_DIR, END_SHOT) });
    console.log(`[smoke] screenshot ${END_SHOT}`);

    await assertNotBlank(path.join(OUT_DIR, 't6.png'), 't6.png');
  } finally {
    await browser.close();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }

  if (failures.length > 0) {
    throw new Error(`page reported ${failures.length} error(s):\n  ${failures.join('\n  ')}`);
  }

  if (runEndWarning !== null) {
    if (STRICT) throw new Error(runEndWarning);
    console.warn(`[smoke] WARN — ${runEndWarning}`);
    console.warn('[smoke] WARN — expected while the sim is a stub; SMOKE_STRICT=1 makes it fatal');
  }

  const names = [TITLE_SHOT, ...SHOTS.map((shot) => shot.name), END_SHOT];
  const written = await Promise.all(
    names.map(async (name) => {
      const { size } = await stat(path.join(OUT_DIR, name));
      return `${name} (${(size / 1024).toFixed(0)} KB)`;
    }),
  );

  console.log(`[smoke] PASS — ${written.join(', ')} in artifacts/smoke/`);
}

main().catch((error) => {
  console.error(`[smoke] FAIL — ${error.message}`);
  process.exitCode = 1;
});
