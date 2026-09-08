/**
 * Performance stress scene with a HUD: `npm run dev`, then open
 *
 *   /dev/stress-test.html
 *
 * 500 mages, 40 skeletons and a physics layer taking a scripted kill a second,
 * drawn by the real `Renderer` so the draw-call count is the game's own. The
 * scene itself is `src/core/stress.ts`, because the smoke test drives the same
 * thing through the app as `?scene=stress` and `dist/` carries no dev pages.
 *
 *   ?mages=500 ?skeletons=40   crowd sizes
 *   ?kill=1                    seconds between scripted kills; 0 turns them off
 *   ?physics=0|1|2             starting physics quality
 *
 * A screenshot script waits for `__stress.ready` and reads `__stress.stats()`.
 */

import { runStressScene } from '@/core/stress';
import type { PhysicsQuality } from '@/physics';
import { Renderer } from '@/render/Renderer';

const canvas = document.querySelector<HTMLCanvasElement>('#stress-canvas');
const hudElement = document.querySelector<HTMLElement>('#hud');
if (canvas === null || hudElement === null) {
  throw new Error('dev/stress-test.html is missing its canvas or HUD');
}
const hud: HTMLElement = hudElement;
const view: HTMLCanvasElement = canvas;

const params = new URLSearchParams(window.location.search);
const number = (key: string, fallback: number): number => {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const quality = Math.min(2, Math.max(0, Math.round(number('physics', 2)))) as PhysicsQuality;

async function main(): Promise<void> {
  const renderer = new Renderer(view);
  await renderer.init();

  const stress = await runStressScene(renderer, {
    mages: Math.round(number('mages', 500)),
    skeletons: Math.round(number('skeletons', 40)),
    killEvery: number('kill', 1),
    quality,
  });

  window.addEventListener('resize', () => {
    renderer.resize();
  });

  setInterval(() => {
    const stats = stress.stats();
    hud.innerHTML =
      `<b>draw calls</b> ${String(stats.drawCalls)}   <b>fps</b> ${stats.fps.toFixed(0)}\n` +
      `<b>render</b> ${stats.renderMs.toFixed(2)} ms   ` +
      `<b>worst</b> ${stats.renderMsMax.toFixed(2)} ms\n` +
      `<b>units</b> ${String(stats.mages)} mages + ${String(stats.skeletons)} skeletons\n` +
      `<b>ragdolls</b> ${String(stats.ragdolls)}   <b>shards</b> ${String(stats.shards)}` +
      `   <b>quality</b> ${String(stats.quality)}   <b>t</b> ${stats.seconds.toFixed(1)}s`;
  }, 250);
}

main().catch((error: unknown) => {
  hud.textContent = `FAILED: ${String(error)}`;
  console.error('[stress-test] failed to start', error);
});
