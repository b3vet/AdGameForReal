/**
 * Palette fidelity check: renders `?swatch=1` and compares every chip's pixel
 * to the hex it came from in `src/data/palette.json`.
 *
 * This is the instrument the tone mapping is tuned with. Babylon's image
 * processing is a curve — exposure, then the tone mapper, then gamma, then
 * contrast (`src/render/scene.ts`) — so a colour does not come out of it the
 * way it went in, and the only honest way to choose between two curves, or to
 * pick an exposure for one, is to render the palette through the real shader
 * and read the pixels back. `src/render/swatch.ts` is the scene side: a grid of
 * unlit chips parented to the camera, and the screen position of each one.
 *
 * Written in Milestone 5 Phase A as a throwaway and promoted here in Phase E,
 * because the numbers it prints are what the ACES-versus-Neutral decision was
 * made on and the next person to touch the curve needs the same instrument.
 *
 *   npm run build && node scripts/swatch-check.mjs
 *
 * What it prints: every chip with the rgb it measured and its worst channel
 * error, worst first, then the rms over all channels. A curve that returned the
 * palette exactly would score 0; anything under about 12 of 255 is inside what
 * a phone screen and a JPEG of it will do to the colour anyway.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng } from './png.mjs';
import { launchBrowser, openPage, serveDist } from './smoke-browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

/** Long enough for the warm-up and the first real frame under SwiftShader. */
const READY_TIMEOUT_MS = 60_000;
const SETTLE_MS = 1500;

/** Chips this close to an edge are skipped: a clipped chip cannot be read. */
const EDGE_MARGIN = 0.02;

const toRgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

/** A 3x3 average around the chip's centre, so a stray edge pixel cannot own it. */
function sample(image, nx, ny) {
  const x = Math.round(nx * image.width);
  const y = Math.round(ny * image.height);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = Math.min(image.width - 1, Math.max(0, x + dx));
      const py = Math.min(image.height - 1, Math.max(0, y + dy));
      const at = (py * image.width + px) * image.channels;
      r += image.pixels[at];
      g += image.pixels[at + 1];
      b += image.pixels[at + 2];
      n++;
    }
  }
  return [r / n, g / n, b / n];
}

async function main() {
  const { server, port } = await serveDist(DIST);
  const browser = await launchBrowser();
  const failures = [];
  const page = await openPage(browser, failures);

  try {
    await page.goto(`http://127.0.0.1:${String(port)}/?swatch=1&screenshot=1&level=1&seed=1`, {
      waitUntil: 'load',
    });
    await page.waitForFunction(() => globalThis.__swatch?.ready === true, null, {
      timeout: READY_TIMEOUT_MS,
    });
    await page.waitForTimeout(SETTLE_MS);
    // The HTML overlay draws on top of the canvas; a chip under the wordmark
    // would be measured as the wordmark.
    await page.evaluate(() => {
      const root = globalThis.document.querySelector('#overlay-root');
      if (root !== null) root.style.display = 'none';
    });
    await page.waitForTimeout(500);

    const points = await page.evaluate(() => globalThis.__swatch.points());
    const image = decodePng(await page.screenshot({ timeout: 60_000 }));

    let worst = 0;
    let sumSq = 0;
    let channels = 0;
    const rows = [];
    for (const point of points) {
      const inside =
        point.x > EDGE_MARGIN &&
        point.x < 1 - EDGE_MARGIN &&
        point.y > EDGE_MARGIN &&
        point.y < 1 - EDGE_MARGIN;
      if (!inside) continue;
      const want = toRgb(point.hex);
      const got = sample(image, point.x, point.y);
      const diff = want.map((value, i) => got[i] - value);
      const error = Math.max(...diff.map(Math.abs));
      if (error > worst) worst = error;
      for (const d of diff) sumSq += d * d;
      channels += 3;
      rows.push({ role: point.role, hex: point.hex, got: got.map(Math.round), error });
    }

    rows.sort((a, b) => b.error - a.error);
    console.log(`[swatch] ${rows.length} of ${points.length} chips measured`);
    for (const row of rows) {
      console.log(
        `  ${row.role.padEnd(18)} ${row.hex} -> rgb(${row.got.join(',')})` +
          `  worst channel ${row.error.toFixed(0)}`,
      );
    }
    console.log(
      `[swatch] rms ${Math.sqrt(sumSq / Math.max(1, channels)).toFixed(1)}/255, ` +
        `worst ${worst.toFixed(0)}/255`,
    );
    if (failures.length > 0) console.log('[swatch] page errors:', failures.join('; '));
  } finally {
    await page.context().close();
    await browser.close();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}

main().catch((error) => {
  console.error(`[swatch] FAIL — ${error.message}`);
  process.exitCode = 1;
});
