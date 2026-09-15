/**
 * WebGL context loss and restore (Milestone 9, Phase B).
 *
 * Takes the GPU context away mid-run with `WEBGL_lose_context`, gives it back,
 * and asserts the three things the plan asks for: the run survives, frames are
 * drawn again, and nothing threw on the way through.
 *
 * `loseContext()` is the same event iOS produces when it reclaims the GPU from
 * a backgrounded WKWebView — a real `webglcontextlost` on the canvas, with
 * every GL object invalidated — so this is the one case that cannot be reasoned
 * about and has to be run.
 *
 * Run: `npm run build && node scripts/probe-context-loss.mjs [outDir]`.
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertNotBlank, launchBrowser, openPage, serveDist, sleep } from './smoke-browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] ?? path.join(ROOT, 'artifacts', 'device');
const DIST = path.join(ROOT, 'dist');
const SHOT = path.join(OUT, 'context-restored.png');

const failures = [];
const warnings = [];

const { server, port } = await serveDist(DIST);
const browser = await launchBrowser();
const page = await openPage(browser, failures, { viewport: { width: 390, height: 844 } });
page.on('console', (message) => {
  if (message.type() === 'warning') warnings.push(message.text());
});

/**
 * Calls one method on `WEBGL_lose_context`, from inside the page.
 *
 * The extension object is taken *before* the loss and parked on `window`:
 * `getExtension` on a lost context answers null, so a probe that looked it up
 * again would have no way to give the context back — which is exactly the
 * mistake iOS does not make, because it restores the context itself.
 */
function callLoseContext(which) {
  if (which === 'grab') {
    const canvas = globalThis.document.getElementById('game-canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (gl === null) return 'no context';
    globalThis.__probeLose = gl.getExtension('WEBGL_lose_context');
    return globalThis.__probeLose == null ? 'no WEBGL_lose_context' : 'ok';
  }
  const extension = globalThis.__probeLose;
  if (extension == null) return 'no WEBGL_lose_context';
  if (which === 'lose') extension.loseContext();
  else extension.restoreContext();
  return 'ok';
}

const snapshot = () => {
  const state = globalThis.__arcane.state();
  return {
    phase: globalThis.__arcane.app.status(),
    time: state === null ? null : state.time,
    z: state === null ? null : state.squad.z,
    count: state === null ? null : state.squad.count,
    draws: globalThis.__arcane.draws().current,
  };
};

try {
  await mkdir(OUT, { recursive: true });
  await page.goto(`http://127.0.0.1:${port}/?physics=0`, { waitUntil: 'load' });
  await page.waitForFunction('globalThis.__arcane?.ready === true', null, { timeout: 120_000 });

  await page.evaluate('globalThis.__arcane.app.startLevel(1)');
  // SwiftShader draws this scene at a few frames a second, so "a few seconds of
  // play" is a real wait rather than a formality.
  await sleep(10_000);
  const grabbed = await page.evaluate(callLoseContext, 'grab');
  console.log(`[probe] WEBGL_lose_context: ${grabbed}`);
  if (grabbed !== 'ok') failures.push(`could not reach the extension: ${grabbed}`);

  const before = await page.evaluate(snapshot);
  console.log('[probe] before loss:', JSON.stringify(before));
  if (before.phase !== 'playing') failures.push(`expected to be playing, was ${before.phase}`);
  if (before.draws <= 0) failures.push('nothing was being drawn before the loss');

  const lost = await page.evaluate(callLoseContext, 'lose');
  console.log(`[probe] loseContext(): ${lost}`);
  if (lost !== 'ok') failures.push(`could not lose the context: ${lost}`);
  await sleep(4000);

  const during = await page.evaluate(snapshot);
  console.log('[probe] while lost:', JSON.stringify(during));
  if (during.phase !== 'playing') failures.push(`the run ended while the context was lost`);
  // The frame loop is paused, so the sim clock must not have moved on.
  if (during.time - before.time > 0.15) {
    failures.push(
      `the sim ran on while the context was lost: ${before.time} -> ${during.time}`,
    );
  }

  const restored = await page.evaluate(callLoseContext, 'restore');
  console.log(`[probe] restoreContext(): ${restored}`);
  if (restored !== 'ok') failures.push(`could not restore the context: ${restored}`);
  await sleep(12_000);

  const after = await page.evaluate(snapshot);
  console.log('[probe] after restore:', JSON.stringify(after));
  if (after.phase !== 'playing') failures.push(`the run did not survive: phase ${after.phase}`);
  if (after.time <= during.time) failures.push('the sim did not resume after the restore');
  if (after.z <= during.z) failures.push('the squad did not move again after the restore');
  if (after.count !== before.count && after.count === 0) {
    failures.push('the squad was lost across the restore');
  }
  if (after.draws <= 0) failures.push(`no frame was drawn after the restore (draws ${after.draws})`);

  // A frame that draws but draws nothing is the failure mode that matters, so
  // the picture is checked for contrast the way the smoke checks its own.
  await page.screenshot({ path: SHOT, timeout: 90_000 });
  console.log(`[probe] wrote ${SHOT}`);
  console.log(await assertNotBlank(SHOT, 'frame after restore'));
} finally {
  await browser.close();
  server.close();
}

console.log(`[probe] warnings seen: ${warnings.length}`);
for (const warning of warnings.slice(0, 12)) console.log(`  warn: ${warning}`);

if (failures.length > 0) {
  console.error(`\n[probe] FAILED (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\n[probe] the run survived a lost and restored WebGL context, 0 exceptions.');
