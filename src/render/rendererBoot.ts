/**
 * Standing the scene up: the engine, the scene, the camera rig and every view,
 * in the one order that works.
 *
 * Split out of `./Renderer.ts` in Milestone 7 Phase E, which had grown past the
 * file-size rule again (CLAUDE.md). The line is the same one `./views.ts`
 * already draws — that file is *what* exists, this one is *when* it is built —
 * and what is left in `Renderer` is the object the app holds: the public API,
 * the per-frame entry point and the numbers the debug panel reads.
 *
 * The order below is not arrangement, it is a list of things that went wrong
 * once each; every step says which.
 */

import type { Engine } from '@babylonjs/core/Engines/engine';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import type { Scene } from '@babylonjs/core/scene';

import { CameraRig } from './camera';
import { loadDisplayFont } from './glyphAtlas';
import { createEngine, createScene } from './scene';
import { buildPaletteSwatches, swatchesWanted } from './swatch';
import { DEFAULT_ROAD_END_Z, ROAD_START_Z } from './theme';
import { SceneViews } from './views';
import type { BiomeId } from '@/data/biome-types';

/** Everything `Renderer` owns once `bootScene` has answered. */
export interface RenderContext {
  engine: Engine;
  scene: Scene;
  rig: CameraRig;
  instrumentation: SceneInstrumentation;
  views: SceneViews;
}

export interface BootOptions {
  canvas: HTMLCanvasElement;
  preserveDrawingBuffer: boolean;
  /** What the scene renders at on the first frame; see `Renderer.pixelRatio`. */
  effectivePixelRatio: number;
  /** The biome the palette has already been switched to (`Renderer.init`). */
  biome: BiomeId;
  /** The renderer's own camera kick, which the views fire but do not own. */
  shake: (strength: number, seconds: number) => void;
}

/**
 * Builds the whole scene and hands it back ready to draw. Everything that can
 * be compiled before the title screen has been, except the warm-up pass itself:
 * that belongs to the renderer, which owns the tracker the smoke reads.
 */
export async function bootScene(options: BootOptions): Promise<RenderContext> {
  const engine = createEngine(options.canvas, {
    preserveDrawingBuffer: options.preserveDrawingBuffer,
    effectivePixelRatio: options.effectivePixelRatio,
  });
  // Before the scene is built, not after: `setHardwareScalingLevel` resizes the
  // canvas and every render target hanging off it, so a boot that ran at 1 and
  // was rescaled at the end would rebuild what it had just made ready.
  // `Renderer.setMaxPixelRatio` owns every later change.
  engine.setHardwareScalingLevel(1 / options.effectivePixelRatio);

  const scene = createScene(engine);
  const instrumentation = new SceneInstrumentation(scene);
  const rig = new CameraRig(scene);

  // Sixty gate materials, three crowds and the biome are all built in the next
  // few lines. Each `new StandardMaterial` would otherwise re-dirty every
  // material in the scene; blocking the mechanism makes it one pass at the end.
  scene.blockMaterialDirtyMechanism = true;

  // The glyph sheet is rasterised from whatever face is installed *now*, so the
  // font has to be asked for before the atlas is built. Fail-soft and
  // time-boxed: a missing Cinzel is a fallback serif, never a delayed boot.
  await loadDisplayFont();
  const views = new SceneViews(scene, options.shake);

  // A default stretch of road, so the very first frame — which the app draws
  // behind the title screen before any level exists — is not empty sky.
  views.road.setExtent(ROAD_START_Z, DEFAULT_ROAD_END_Z, 168);

  await views.load();
  // Every view's first reading of the biome, once its meshes and materials
  // exist. `Renderer.setBiome` is for *changes*, and there is none to make
  // here: the palette was switched before the scene was built.
  views.setBiome(options.biome);
  views.dressRoadside(1, ROAD_START_Z, DEFAULT_ROAD_END_Z);

  scene.blockMaterialDirtyMechanism = false;

  // Compiles shaders and uploads buffers, so the first `update` is not a blank
  // frame that the smoke test would screenshot. The labels join in with one
  // invisible glyph, or their shader would compile on the frame the first gate
  // comes into range — a stall exactly where the player is deciding.
  views.labels.warmUp();
  // `?swatch=1` only: a row of palette chips in front of the camera, which is
  // how the tone mapping's exposure was measured (`./swatch.ts`).
  if (swatchesWanted()) buildPaletteSwatches(scene, rig.camera);
  await scene.whenReadyAsync();
  views.labels.commit();

  // After the first readiness pass, never before: a material frozen while its
  // effect is still compiling never draws. None of these views ever changes
  // what its materials are made of, so re-checking them every frame is pure
  // cost (`SceneViews.freeze`).
  views.freeze();

  return { engine, scene, rig, instrumentation, views };
}
