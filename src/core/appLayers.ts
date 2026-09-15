/**
 * The two layers `App` owns but is not about: Havok, and the degrade ladder's
 * rung applied to whoever owns each step.
 *
 * Split out of `App` in Milestone 8 for the file-size rule (CLAUDE.md), beside
 * `./publishHandle.ts` and on the same seam: the state machine is three phases
 * and the screens between them, and this is the plumbing that hangs off it.
 * Both functions are pure wiring — they take what they need and hand back what
 * the app has to remember.
 */

import { PhysicsLayer } from '@/physics';
import type { PhysicsQuality } from '@/physics';
import type { Renderer } from '@/render/Renderer';
import type { LevelDef } from '@/sim';

import type { QualityRung } from './quality';

export interface PhysicsDeps {
  renderer: Renderer;
  /** The ceiling `?physics=` asked for; the ladder may still lower it. */
  quality: PhysicsQuality;
  /** The level on screen when the layer arrives, or null for none yet. */
  level: () => LevelDef | null;
  /** True once the app has been disposed, so a late load frees its own work. */
  disposed: () => boolean;
  /** The layer arrived after the ladder settled; hand it the current rung. */
  onReady: () => void;
}

/**
 * Havok, or nothing. A failed init is a downgrade and not a crash: a phone
 * that cannot afford physics should still play the game, and every ladder
 * rung below stays honest because the layer is marked unavailable.
 *
 * Returns null when the app went away while Havok was loading — two megabytes
 * take a while, and nothing else would free the layer.
 */
export async function initPhysics(deps: PhysicsDeps): Promise<PhysicsLayer | null> {
  const physics = new PhysicsLayer(deps.renderer.scene, { quality: deps.quality });
  try {
    await physics.init();
  } catch (error: unknown) {
    console.warn('[arcane-rush] physics unavailable, running without debris', error);
    physics.setQuality(0);
  }
  if (deps.disposed()) {
    physics.dispose();
    return null;
  }

  // Whatever is on screen was loaded before this finished, so the road
  // collider is built now rather than at the next `loadLevel`.
  const level = deps.level();
  if (level !== null) physics.loadLevel(level);
  deps.onReady();
  // Its debris pools are new meshes in the renderer's scene, so their shaders
  // have to be compiled too or the first kill of the first run pays for them
  // inside a frame (`src/render/warmup.ts`).
  await deps.renderer.warmUp();
  return physics;
}

export interface QualityDeps {
  renderer: Renderer;
  physics: PhysicsLayer | null;
  /** What `?physics=` asked for; the rung is a ceiling over it, not a floor. */
  wanted: PhysicsQuality;
}

/**
 * One rung of the degrade ladder, applied to whoever owns each step
 * (`./quality.ts`). Called on construction, when the physics layer arrives,
 * and on every step down.
 */
export function applyQuality(rung: QualityRung, deps: QualityDeps): void {
  deps.renderer.setMaxPixelRatio(rung.pixelRatio);
  const physics = deps.physics;
  if (physics === null) return;

  // The rung is a ceiling, not an instruction: `?physics=1` asked for less
  // than the ladder's top rung offers, and a layer whose init failed stays at
  // 0 whatever it is told (`PhysicsLayer.setQuality`).
  const wanted = Math.min(rung.physics, deps.wanted) as PhysicsQuality;
  physics.setQuality(wanted);
  // The renderer plays the baked death itself at quality 0, so it follows
  // whatever the layer actually ended up at rather than what was asked.
  deps.renderer.setPhysicsQuality(physics.stats.quality);
  // And keeps drawing every squad death itself unless the layer really has a
  // mage pool to throw the tenth one with (D43).
  deps.renderer.setUnitRagdolls(physics.throwsUnits);
}
