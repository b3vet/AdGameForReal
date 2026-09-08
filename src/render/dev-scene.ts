/**
 * `?scene=render-test` mode: drives the renderer with a fake `RunState` so the
 * render agent can work before the sim is finished.
 *
 * STUB for Phase A. Phase B2 fills in a fixture level plus a scripted state
 * that exercises gates, enemy blocks, the boss and every `SimEvent`.
 */

import type { Renderer } from './Renderer';

export function runRenderDevScene(renderer: Renderer): void {
  void renderer;
  console.info('[render] dev scene stub: nothing to drive yet (Phase B2)');
}
