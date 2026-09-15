/**
 * `?scene=stress` and `?scene=render-test`: the two scenes that are not the
 * game.
 *
 * Split out of `App` in Milestone 8 for the file-size rule (CLAUDE.md). They
 * belong together and they belong outside the state machine, because they
 * *bypass* it: both drive the renderer themselves, so there is no session, no
 * HUD, no frame loop and no phase while one is up. All `App` keeps is the
 * handle that stops them again.
 */

import type { Renderer } from '@/render/Renderer';
import { runRenderDevScene } from '@/render/dev-scene';
import type { PhysicsQuality } from '@/physics';

import { runStressScene } from './stress';
import type { StressHandle } from './stress';
import type { SceneKind } from './query';

/** Whatever was started, with the one call that takes it down again. */
export interface DevScene {
  dispose: () => void;
}

/**
 * Starts the scene `kind` names. The caller has already hidden the overlay:
 * these scenes draw into the same canvas and there is nothing on them to tap.
 */
export async function startDevScene(
  kind: Exclude<SceneKind, 'game'>,
  renderer: Renderer,
  quality: PhysicsQuality,
): Promise<DevScene> {
  if (kind === 'render-test') {
    // Structural on purpose: the handle's shape is the render layer's to
    // change, and the app only ever stops it.
    const scene: { stop: () => void } = runRenderDevScene(renderer);
    return { dispose: () => { scene.stop(); } };
  }
  const stress: StressHandle = await runStressScene(renderer, { quality });
  return { dispose: () => { stress.dispose(); } };
}
