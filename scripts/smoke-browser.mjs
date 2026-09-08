/**
 * The browser half of the smoke test: serving `dist/`, finding Chromium,
 * opening a page that reports its own errors, and deciding whether a frame is
 * blank.
 *
 * Split out of `scripts/smoke.mjs` (Milestone 2, Phase D) so that file is about
 * *what* the smoke photographs and this one is about *how* a headless browser
 * is pointed at a build. Nothing here knows about the game.
 */

import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

import { chromium } from 'playwright';

import { decodePng, luminanceStats } from './png.mjs';

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

export const VIEWPORT = { width: 390, height: 844 };

/**
 * One device pixel per CSS pixel, where Milestone 1 shot at two.
 *
 * SwiftShader is fill-rate bound on this scene: at 2x the same run takes half
 * again as long, for a screenshot that is only bigger, not more informative.
 * 390x844 is a phone frame either way.
 */
export const DEVICE_SCALE_FACTOR = 1;

/**
 * Playwright asks the compositor for a fresh frame and waits for it. A crowd
 * scene under SwiftShader can take over a second to draw, so the default 30 s
 * is not the comfortable margin it looks like.
 */
export const SCREENSHOT_TIMEOUT_MS = 90_000;

/** The frame we assert on. A live scene is far above these floors. */
const BLANK_STD_DEV_FLOOR = 3;
const BLANK_BUCKET_FLOOR = 6;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A static file server over one directory, falling back to `index.html`. */
export function serveDist(root) {
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

/** The browser the whole smoke runs in, with the software rasteriser forced. */
export async function launchBrowser() {
  const executablePath = resolveChromiumPath();
  console.log(`[smoke] chromium: ${executablePath}`);
  return chromium.launch({ executablePath, args: CHROMIUM_ARGS });
}

/**
 * A phone-shaped page that pushes its own console errors onto `failures`, so a
 * warning-free run is part of what the smoke asserts.
 */
export async function openPage(browser, failures, overrides = {}) {
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

/**
 * Throws unless the PNG at `file` has real contrast in it. A blank canvas, a
 * lost WebGL context and a scene that never drew all look the same from Node:
 * a picture with one luminance in it.
 */
export async function assertNotBlank(file, label) {
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
