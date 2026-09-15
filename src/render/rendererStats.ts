/**
 * What the renderer is asked about itself: draw calls, how full its pools are,
 * and what the backing store is running at.
 *
 * Split out of `./Renderer.ts` in Milestone 7 Phase E for the file-size rule
 * (CLAUDE.md). None of it is part of drawing a frame — every reader is a
 * *diagnostic*: the debug panel (`src/ui/debug.ts`), the dev harness and the
 * smoke's assertions (`scripts/smoke-run.mjs`). Keeping them here leaves that
 * file about the scene's life and this one about what is measured off it, and
 * the reason each number exists stays next to the number.
 *
 * Free functions rather than a class: the pieces they read are owned by
 * `Renderer` and are null until `init`, and a second object holding the same
 * three references is a second thing to keep in step. Two of them are read
 * every frame (`drawCallsOf` for the peak, `chargerBodiesOf` with it), so none
 * of the per-body ones may allocate.
 */

import type { Engine } from '@babylonjs/core/Engines/engine';
import type { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';

import type { SceneViews } from './views';

export interface LabelReadout {
  labels: number;
  glyphs: number;
  dropped: number;
}

/**
 * Fence pieces, wisp sparks and burning bodies drawn last frame: what Milestone
 * 4 added to the road, and all three have a pool a level can run into.
 */
export interface FeatureReadout {
  walls: number;
  wisp: boolean;
  sparks: number;
  burning: number;
  /**
   * The two Milestone 8 evolutions a frame can be *waiting for* (D54): meteors
   * in the air, and whether an ice wall is standing.
   *
   * They are here for the same reason the chargers are: both are rare — a
   * meteor every seven seconds, a wall every eight — so a probe that wants a
   * picture of one cannot find it by taking frames and hoping. It polls this
   * and shoots the frame that has one.
   */
  meteors: number;
  /** Craters and pulse rings still on the road; see `EvolutionView.marks`. */
  marks: number;
  glacier: boolean;
}

/** Draw calls in the last rendered frame; the budget is 40 at 500 units. */
export function drawCallsOf(instrumentation: SceneInstrumentation | null): number {
  return instrumentation?.drawCallsCounter.current ?? 0;
}

/**
 * Stream bodies written into the crowd last frame. What the horde costs the
 * renderer, and a ceiling a level can quietly run into (`POOL.grunts`), so the
 * debug panel prints it next to the draw calls.
 */
export function streamBodiesOf(views: SceneViews | null): number {
  return views?.enemies.streamBodies ?? 0;
}

/**
 * Chargers drawn last frame (D49). Beside the stream bodies for the same
 * reason — a pool a level can run into — and the number the Frostfell smoke run
 * asserts went above zero, which is how that run proves it photographed a
 * charger rather than an empty lane.
 */
export function chargerBodiesOf(views: SceneViews | null): number {
  return views?.enemies.chargerBodies ?? 0;
}

/** World labels drawn over the crowd, and how many the glyph budget dropped. */
export function labelStatsOf(views: SceneViews | null): LabelReadout {
  return views?.labels.stats ?? { labels: 0, glyphs: 0, dropped: 0 };
}

export function featureStatsOf(views: SceneViews | null): FeatureReadout {
  return {
    walls: views?.walls.drawn ?? 0,
    wisp: views?.wisp.drawn ?? false,
    sparks: views?.wisp.sparksInFlight ?? 0,
    burning: views?.burn.drawn ?? 0,
    meteors: views?.evolutions.inFlight ?? 0,
    marks: views?.evolutions.marksDrawn ?? 0,
    glacier: views?.glacier.drawn ?? false,
  };
}

/**
 * Backing-store pixels per CSS pixel. Read with `screenPixelRatio` below,
 * because on the product owner's phone the two together are what say whether a
 * frame-rate reading came from a degraded rung or a full-resolution one
 * (docs/06-milestone-2-plan.md, definition of done 9).
 */
export function pixelRatioOf(engine: Engine | null): number {
  if (engine === null) return 0;
  const scaling = engine.getHardwareScalingLevel();
  return scaling > 0 ? 1 / scaling : 0;
}

/** What the screen offers, whatever the ladder has capped the renderer to. */
export function screenPixelRatio(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
}
