/**
 * The dials the degrade ladder turns on the renderer: the backing-store
 * resolution, and who draws a death.
 *
 * Split out of `./Renderer.ts` in Milestone 8 Phase E for the file-size rule
 * (CLAUDE.md), beside `./rendererStats.ts` and on the same seam: that file is
 * the scene's life — build it, load a level into it, draw it — and this is what
 * `src/core/quality.ts` is allowed to change about it while it runs. Free
 * functions for the same reason the stats are: the pieces they touch are owned
 * by `Renderer` and are null until `init`.
 */

import type { Engine } from '@babylonjs/core/Engines/engine';

import { screenPixelRatio } from './rendererStats';

/**
 * What the renderer renders at before the ladder has said anything: rung 0.
 *
 * Three, not Milestone 3's two. The product owner's verdict on that build was
 * "resolution very low" and they were reading a 3x phone at 2. There is no
 * device check here on purpose — the ladder starts at native and steps down on
 * its p95 rule, which is the only test that is true of the phone in the room.
 */
export const DEFAULT_MAX_PIXEL_RATIO = 3;

/** What the scene actually renders at: the screen's ratio under our cap. */
export function effectivePixelRatio(maxPixelRatio: number): number {
  return Math.min(screenPixelRatio(), maxPixelRatio);
}

/**
 * Caps the backing-store resolution; `1 / ratio` is the engine's scaling level.
 *
 * Guarded, because `setHardwareScalingLevel` resizes the canvas and every
 * render target hanging off it. It is called from `init`, from a rung change
 * and from `resize` — never per frame — and the guard keeps a resize that did
 * not change the ratio from costing a reallocation anyway.
 */
export function applyPixelRatio(engine: Engine | null, ratio: number): void {
  if (engine === null) return;
  const level = 1 / ratio;
  if (engine.getHardwareScalingLevel() === level) return;
  engine.setHardwareScalingLevel(level);
}

/**
 * The physics layer's quality as the renderer holds it: an integer 0 to 2.
 *
 * It decides who draws a death — at 1 and 2 `src/physics` spawns ragdolls and
 * shards, so the renderer only takes the block away; at 0 it plays the baked
 * death animation itself — which is why a value from outside is clamped rather
 * than trusted.
 *
 * The renderer starts at 0 whatever the layer will end up at, and that is the
 * important part: the layer is loaded without being awaited (two megabytes of
 * Havok must not hold the title screen), so for the first seconds of the
 * session there is no physics at all. Starting at 2 meant the renderer spent
 * those seconds skipping the deaths it believed Havok was about to throw —
 * every tenth stream body blinked out, and every block died without an
 * animation.
 */
export function clampPhysicsQuality(quality: number): number {
  return Math.max(0, Math.min(2, Math.round(quality)));
}
