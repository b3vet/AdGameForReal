/**
 * Scene plumbing: the engine, the lights and the fog.
 *
 * Pulled out of `Renderer` so that file is about what happens every frame.
 *
 * Daylight (D28): a high hemispheric ambient carrying the sky's own blue from
 * above and a warm bounce from the ground, plus one soft warm key over the
 * player's shoulder. The ambient does most of the work — nothing in the scene
 * is ever in shadow, which is what "bright and casual" means — and the key is
 * only there to give the toon ramp (`./toonRamp.ts`) a direction to band.
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';

import { FOG_COLOR, FOG_END, FOG_START, SKY } from './theme';

export interface EngineOptions {
  /**
   * Keep the drawing buffer around after a frame is presented. Off in play: it
   * forces the driver to keep a second copy of the back buffer and costs a
   * blit every frame on a tiled mobile GPU. Only the screenshot path needs it
   * (`?screenshot=1`, which `npm run smoke` passes).
   */
  preserveDrawingBuffer?: boolean;
  /**
   * The pixel ratio the scene will actually render at, so the engine can decide
   * about MSAA before the first frame — the flag is fixed at context creation.
   */
  effectivePixelRatio?: number;
}

/**
 * Pixel ratio at and above which MSAA is dropped.
 *
 * Multisampling and a dense backing store buy the same thing — smooth edges —
 * and on a phone the second one is already paid for. At 1.5x and up the
 * resolve costs bandwidth for an edge difference nobody can see at arm's
 * length; below it (a desktop window, the smoke's 1x frames) MSAA is what
 * keeps the gate panels' edges clean.
 */
const MSAA_PIXEL_RATIO_LIMIT = 1.5;

/**
 * The daylight pair (D28). High ambient, soft key: their sum is a little over
 * one, so an albedo of 1 renders at roughly 1 and the KayKit atlas keeps the
 * colours the artist painted instead of clipping.
 */
const AMBIENT_INTENSITY = 0.7;
const KEY_INTENSITY = 0.6;

/**
 * SwiftShader in headless Chromium can refuse a WebGL2 context. Try the normal
 * WebGL2 engine first, then fall back to WebGL1 rather than letting the whole
 * app fail to boot.
 */
export function createEngine(canvas: HTMLCanvasElement, options: EngineOptions = {}): Engine {
  const antialias = (options.effectivePixelRatio ?? 1) < MSAA_PIXEL_RATIO_LIMIT;
  try {
    return new Engine(
      canvas,
      antialias,
      {
        disableWebGL2Support: false,
        preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
        stencil: true,
        antialias,
        powerPreference: 'high-performance',
      },
      true,
    );
  } catch (error) {
    console.warn('[render] WebGL2 engine failed, falling back to WebGL1', error);
    return new Engine(canvas, false);
  }
}

/** The scene, its fog, and the two lights the whole biome is lit by. */
export function createScene(engine: Engine): Scene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(SKY.r, SKY.g, SKY.b, 1);
  // Linear fog into the sky's own haze band, so the road has no horizon seam.
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = FOG_COLOR.clone();
  scene.fogStart = FOG_START;
  scene.fogEnd = FOG_END;

  const sky = new HemisphericLight('sky', new Vector3(0.08, 1, -0.25), scene);
  sky.intensity = AMBIENT_INTENSITY;
  // Warm white from the sky half, a lit grass-and-stone bounce from the ground
  // half: a hemispheric light's `groundColor` is what fills the undersides, and
  // leaving it dark is what made the Milestone 2 crowd a row of black discs.
  sky.diffuse = new Color3(1, 0.98, 0.93);
  sky.groundColor = new Color3(0.62, 0.62, 0.52);
  sky.specular = Color3.Black();

  const key = new DirectionalLight('key', new Vector3(-0.35, -0.8, 0.45), scene);
  key.intensity = KEY_INTENSITY;
  key.diffuse = new Color3(1, 0.95, 0.82);
  // No specular at all: a flat casual look has no highlights in it, and the
  // KayKit atlas has no gloss map for one to sit on.
  key.specular = Color3.Black();

  // Nothing in the scene is picked. Steering is read from raw pointer events in
  // `src/core/input.ts`, and every mesh here is `isPickable = false` anyway, so
  // a ray cast per pointer move is a scene graph walk for an answer nobody
  // reads — and a drag is a pointer move every frame.
  scene.skipPointerMovePicking = true;
  scene.constantlyUpdateMeshUnderPointer = false;

  return scene;
}

