/**
 * The App Store screenshot set: the hero frames at the 6.9" slot's own pixels.
 *
 * `npm run smoke` shoots the hero set at 390 x 844 CSS, a third of the store's
 * width (docs/STORE.md section 7). This drives the same hero pages through
 * `driveHeroSet`, but with every page opened at 440 x 956 CSS and device scale
 * 3 — 1320 x 2868, the iPhone 16 Pro Max frame — so nothing is upscaled. The
 * file suffixes still say 2x or 3x (the pages' own scale names); the pixels
 * are 3x for all of them.
 *
 *   npx vite build && node scripts/store-shots.mjs [outDir] [--swiftshader]
 *
 * Writes `<outDir>/hero/*.png` (default `artifacts/store`). The browser is
 * Playwright's Chromium with its own GPU path unless `--swiftshader` asks for
 * the smoke's software rasteriser, which is the same picture, slower.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { launchBrowser, serveDist } from './smoke-browser.mjs';
import { driveHeroSet } from './smoke-hero.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const OUT = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(ROOT, 'artifacts', 'store'));
const STORE_VIEWPORT = { width: 440, height: 956 };
const STORE_SCALE = 3;
const PARTS = new Set(['hero-meadow', 'hero-frost', 'hero-endless']);

const { server, port } = await serveDist(path.join(ROOT, 'dist'));
const browser = args.includes('--swiftshader') ? await launchBrowser() : await chromium.launch();
const failures = [];

const openStorePage = async (b, sink, overrides = {}) => {
  const context = await b.newContext({
    isMobile: true,
    hasTouch: true,
    ...overrides,
    viewport: STORE_VIEWPORT,
    deviceScaleFactor: STORE_SCALE,
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') sink.push(`console error: ${m.text()}`);
  });
  page.on('pageerror', (e) => sink.push(`page error: ${e.message}`));
  return page;
};

try {
  const written = await driveHeroSet(
    browser,
    `http://127.0.0.1:${String(port)}/`,
    OUT,
    failures,
    openStorePage,
    (part) => PARTS.has(part),
  );
  console.log(`[store] ${String(written.length)} frames in ${path.join(OUT, 'hero')}`);
} finally {
  await browser.close();
  server.close();
}
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
