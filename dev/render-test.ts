/**
 * Standalone render harness: `npm run dev` then open `/dev/render-test.html`.
 *
 * Same fixture the app's `?scene=render-test` mode runs, minus the app: no
 * state machine, no overlay, no sim. Screenshot scripts wait for
 * `window.__renderTest.ready`.
 */

import { Renderer } from '@/render/Renderer';
import { runRenderDevScene } from '@/render/dev-scene';
import type { RunState } from '@/sim';

interface RenderTestHandle {
  ready: boolean;
  /** The fake run being drawn, so a screenshot script can assert on it. */
  state: () => Readonly<RunState>;
}

declare global {
  // `var` is required here: this is a global augmentation, not a declaration.
  var __renderTest: RenderTestHandle | undefined;
}

const canvas = document.querySelector<HTMLCanvasElement>('#render-test-canvas');
if (canvas === null) throw new Error('dev/render-test.html is missing #render-test-canvas');

const renderer = new Renderer(canvas);

async function main(): Promise<void> {
  await renderer.init();

  window.addEventListener('resize', () => {
    renderer.resize();
  });

  const scene = runRenderDevScene(renderer);
  globalThis.__renderTest = { ready: true, state: () => scene.scenario.state };
}

main().catch((error: unknown) => {
  console.error('[render-test] failed to start', error);
});
