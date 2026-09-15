/**
 * Safe-area probe (Milestone 9, Phase B).
 *
 * Opens `dist/` at 390x844 with a 47 px top inset and a 34 px bottom inset
 * simulated, walks the six screens, photographs five of them with the two
 * bands drawn over the picture, and asserts that nothing the player has to read
 * or press is inside either band.
 *
 * The insets are simulated by writing the four tokens `src/ui/tokens.css`
 * declares from `env(safe-area-inset-*)` as inline custom properties on
 * `:root`. An inline style beats the stylesheet's `:root` rule, every rule in
 * the overlay reads the tokens rather than `env()` directly, and Chromium has
 * no way to set a real inset — so this is the same arithmetic the phone does.
 *
 * Run: `npm run build && node scripts/probe-safe-area.mjs [outDir]`.
 */

import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchBrowser, openPage, serveDist, sleep } from './smoke-browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Screenshots land here; `artifacts/` is git-ignored, like the smoke's own. */
const OUT = process.argv[2] ?? path.join(ROOT, 'artifacts', 'device');
const DIST = path.join(ROOT, 'dist');

const INSET_TOP = 47;
const INSET_BOTTOM = 34;
const VIEWPORT = { width: 390, height: 844 };

const failures = [];

/** Writes the four tokens and paints the two bands over the page. */
const SIMULATE = `
  const root = globalThis.document.documentElement;
  root.style.setProperty('--safe-top', '${INSET_TOP}px');
  root.style.setProperty('--safe-bottom', '${INSET_BOTTOM}px');
  root.style.setProperty('--safe-left', '0px');
  root.style.setProperty('--safe-right', '0px');
  if (!globalThis.document.getElementById('probe-bands')) {
    const bands = globalThis.document.createElement('div');
    bands.id = 'probe-bands';
    bands.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999';
    bands.innerHTML =
      '<div style="position:absolute;left:0;right:0;top:0;height:${INSET_TOP}px;' +
      'background:rgba(220,40,60,0.28);border-bottom:1px solid rgba(220,40,60,0.9)"></div>' +
      '<div style="position:absolute;left:0;right:0;bottom:0;height:${INSET_BOTTOM}px;' +
      'background:rgba(220,40,60,0.28);border-top:1px solid rgba(220,40,60,0.9)"></div>';
    globalThis.document.body.appendChild(bands);
  }
`;

/** Bounding boxes of everything visible under `selectors`, by selector. */
function measure(selectors) {
  const out = [];
  for (const selector of selectors) {
    for (const element of globalThis.document.querySelectorAll(selector)) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (element.closest('[hidden]') !== null) continue;
      out.push({ selector, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
    }
  }
  return out;
}

function check(label, boxes) {
  if (boxes.length === 0) failures.push(`${label}: nothing measured — did the screen show?`);
  for (const box of boxes) {
    if (box.top < INSET_TOP - 0.5) {
      failures.push(
        `${label}: ${box.selector} top ${box.top.toFixed(1)} is inside the ${INSET_TOP}px notch`,
      );
    }
    if (box.bottom > VIEWPORT.height - INSET_BOTTOM + 0.5) {
      failures.push(
        `${label}: ${box.selector} bottom ${box.bottom.toFixed(1)} is inside the ` +
          `${INSET_BOTTOM}px home indicator`,
      );
    }
  }
  const worstTop = Math.min(...boxes.map((b) => b.top));
  const worstBottom = Math.max(...boxes.map((b) => b.bottom));
  console.log(
    `[probe] ${label}: ${boxes.length} boxes, highest top ${worstTop.toFixed(1)}, ` +
      `lowest bottom ${worstBottom.toFixed(1)} (limits ${INSET_TOP} and ${VIEWPORT.height - INSET_BOTTOM})`,
  );
}

async function shoot(page, name) {
  await page.evaluate(SIMULATE);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, timeout: 90_000 });
  console.log(`[probe] wrote ${file}`);
}

const { server, port } = await serveDist(DIST);
const browser = await launchBrowser();
const page = await openPage(browser, failures, { viewport: VIEWPORT });

try {
  await mkdir(OUT, { recursive: true });
  await page.goto(`http://127.0.0.1:${port}/?physics=0&debug=1`, { waitUntil: 'load' });
  await page.waitForFunction('globalThis.__arcane?.ready === true', null, { timeout: 120_000 });
  await page.evaluate(SIMULATE);
  await sleep(1500);

  // --- The touch rules, once: they are the same on every screen ------------
  const touch = await page.evaluate(`(() => {
    const body = getComputedStyle(globalThis.document.body);
    const canvas = getComputedStyle(globalThis.document.getElementById('game-canvas'));
    const root = getComputedStyle(globalThis.document.getElementById('overlay-root'));
    return {
      bodyTouchAction: body.touchAction,
      bodyOverscroll: body.overscrollBehavior,
      bodySelect: body.userSelect,
      bodyTapHighlight: body.webkitTapHighlightColor,
      canvasTouchAction: canvas.touchAction,
      canvasSelect: canvas.userSelect,
      canvasTapHighlight: canvas.webkitTapHighlightColor,
      overlayPadding: root.padding,
    };
  })()`);
  console.log('[probe] touch rules:', JSON.stringify(touch, null, 2));
  for (const [key, want] of [
    ['bodyTouchAction', 'none'],
    ['bodyOverscroll', 'none'],
    ['bodySelect', 'none'],
    ['canvasTouchAction', 'none'],
    ['canvasSelect', 'none'],
  ]) {
    if (touch[key] !== want) failures.push(`${key} is "${touch[key]}", wanted "${want}"`);
  }
  if (!/rgba\(0, 0, 0, 0\)|transparent/.test(touch.bodyTapHighlight)) {
    failures.push(`body tap highlight is "${touch.bodyTapHighlight}"`);
  }
  // `-webkit-touch-callout` is a Safari property. Chromium drops it on parse,
  // so neither `getComputedStyle` nor the CSSOM can see it — the shipped
  // bytes are read off disk instead. What matters is that it reaches the phone.
  const bundled = (await readdir(path.join(DIST, 'bundle')))
    .filter((name) => name.endsWith('.css'))
    .map((name) => path.join(DIST, 'bundle', name));
  const shippedCss = (
    await Promise.all(bundled.map((file) => readFile(file, 'utf8')))
  ).join('\n');
  for (const wanted of ['-webkit-touch-callout:none', '-webkit-tap-highlight-color:transparent']) {
    if (!shippedCss.includes(wanted)) failures.push(`the built CSS has no "${wanted}"`);
  }
  console.log(`[probe] read ${bundled.length} built stylesheet(s); callout and tap highlight present`);

  // --- Debug panel ----------------------------------------------------------
  // A sibling of the screens rather than a child, so it carries its own insets.
  check('debug panel', await page.evaluate(measure, ['#debug-panel']));

  // --- Academy home ---------------------------------------------------------
  const HOME = ['#academy-coins', '#academy-streak', '#title-wordmark', '#mute-title', '.card', '#academy-missions'];
  check('academy home', await page.evaluate(measure, HOME));
  await shoot(page, 'safe-area-title');

  // --- Level picker ---------------------------------------------------------
  await page.evaluate("globalThis.__arcane.openRoom('play')");
  await sleep(400);
  await page.evaluate(SIMULATE);
  check(
    'level picker',
    await page.evaluate(measure, ['#picker-endless', '#level-picker', '#play-button', '#levels-back']),
  );
  await shoot(page, 'safe-area-picker');

  // --- A room (the Bestiary is the tallest) --------------------------------
  await page.evaluate("globalThis.__arcane.openRoom('play')");
  await sleep(200);
  await page.evaluate("globalThis.__arcane.app.showHome()");
  await sleep(300);
  await page.evaluate("globalThis.__arcane.openRoom('yard')");
  await sleep(400);
  await page.evaluate(SIMULATE);
  // The panel itself, not its rows: the list scrolls inside it (`.room__panel`
  // in `rooms.css`), so a row below the fold is reachable rather than lost.
  check(
    'yard',
    await page.evaluate(measure, ['#room-title', '#room-coins', '#room-back', '.room__panel']),
  );
  await shoot(page, 'safe-area-room');

  // --- HUD ------------------------------------------------------------------
  await page.evaluate('globalThis.__arcane.app.startLevel(1)');
  await sleep(2500);
  await page.evaluate(SIMULATE);
  check('hud', await page.evaluate(measure, ['#hud-level', '#hud-plaque', '#mute-hud']));
  await shoot(page, 'safe-area-hud');

  // --- Result sheet ---------------------------------------------------------
  await page.evaluate('globalThis.__arcane.endRun()');
  await page.waitForFunction("globalThis.__arcane.app.status() === 'result'", null, { timeout: 60_000 });
  await sleep(2500);
  await page.evaluate(SIMULATE);
  check(
    'result sheet',
    await page.evaluate(measure, [
      '#result-ribbon',
      '#result-title',
      '#retry-button',
      '#levels-button',
      '#replay-button',
    ]),
  );
  // The sheet is a full-bleed background: it has to reach the glass, not stop
  // at the padding box it used to.
  const sheet = await page.evaluate(`(() => {
    const rect = globalThis.document.getElementById('result-screen').getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  })()`);
  if (sheet.top > 0.5 || sheet.bottom < VIEWPORT.height - 0.5) {
    failures.push(`result sheet stops short of the glass: ${JSON.stringify(sheet)}`);
  }
  console.log(`[probe] result sheet covers ${sheet.top} to ${sheet.bottom} of ${VIEWPORT.height}`);
  await shoot(page, 'safe-area-result');
} finally {
  await browser.close();
  server.close();
}

if (failures.length > 0) {
  console.error(`\n[probe] FAILED (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\n[probe] safe areas clean at 390x844 with 47/34 insets.');
