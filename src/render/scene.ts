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
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
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
 * Tone mapping, in the materials rather than as a pass (D38).
 *
 * Babylon's image processing block is compiled *into* every material that has
 * one — `applyImageProcessing` at the end of both `default.fragment` and
 * `pbr.fragment` — so switching it on here costs no render target, no extra
 * full-screen draw and no second copy of the frame. A post-process pipeline
 * would cost all three, on a phone, for the same pixels.
 *
 * What it buys: the spell cores stop clipping. The bolts, impacts and the
 * wisp are additive quads with emissive above 1 (`BOLT_GLOW_BOOST` and friends)
 * over a light stone road, and without a curve everything above 1 is the same
 * flat white — which is why Milestone 3 had to keep the boosts small and the
 * storm bolts still read as steam. A tone curve rolls those off instead of
 * cutting them, so a hot core stays hot *and* keeps its hue.
 *
 * ## Which curve (Milestone 5 Phase E)
 *
 * KHR PBR Neutral, not ACES. Both roll the highlights off; the difference is
 * what they do to everything *below* them. ACES is a film emulation with a
 * desaturating matrix in front of it, so a palette put through it comes back
 * shifted — measured against `src/data/palette.json` through the real shader
 * (`scripts/swatch-check.mjs`) it scores rms 17 of 255 with a worst channel of
 * 40, and the error is concentrated exactly where this game lives: the saturated
 * greens and cyans of the gate kinds and the near-white parchment of the UI.
 * Neutral is built for the other errand — keep the colour, compress only what
 * cannot be shown — and the same measurement gives rms 11 with a worst of 26.
 * Side by side (`t6.png`, `academy.png`) the daylight is the same shot: the same
 * sky, the same grass, the same haze on the horizon. The palette is simply the
 * palette, which is what this milestone is about (plan, "Colors random").
 *
 * `EXPOSURE` is the calibration, not a brightness knob. A curve does not return
 * what it is given: at exposure 1 every role comes back dark. 1.185 is what
 * minimises the error over all 43 roles under Neutral, where ACES needed 1.45.
 *
 * `CONTRAST` at 1.1 is a gentle S applied after the gamma step, so it darkens
 * the road's shaded side and lifts the lit one without touching the middle.
 * The vignette is deliberately almost invisible: it is there to keep the eye
 * off the corners of a portrait frame, and anything stronger reads as a filter.
 */
const EXPOSURE = 1.185;
const CONTRAST = 1.1;
const VIGNETTE_WEIGHT = 1.1;
/** How far the vignette reaches in from the corners; higher is tighter. */
const VIGNETTE_STRETCH = 0.45;

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

  applyToneMapping(scene);

  // Nothing in the scene is picked. Steering is read from raw pointer events in
  // `src/core/input.ts`, and every mesh here is `isPickable = false` anyway, so
  // a ray cast per pointer move is a scene graph walk for an answer nobody
  // reads — and a drag is a pointer move every frame.
  scene.skipPointerMovePicking = true;
  scene.constantlyUpdateMeshUnderPointer = false;

  return scene;
}

/**
 * Switches the scene's image processing on, in the materials.
 *
 * `applyByPostProcess` stays false, which is what keeps this free: the defines
 * land in every material's own shader and the work happens on pixels that are
 * being shaded anyway. Every material in the scene shares this one
 * configuration object, so there is nothing to keep in step per view — and
 * because the defines are part of the shader, the warm-up pass has to run
 * *after* this (`Renderer.init` calls it from `createScene`, long before
 * `warmUp`), or every material would compile a second variant on first draw.
 */
function applyToneMapping(scene: Scene): void {
  const image = scene.imageProcessingConfiguration;
  image.applyByPostProcess = false;
  image.toneMappingEnabled = true;
  image.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
  image.exposure = EXPOSURE;
  image.contrast = CONTRAST;
  image.vignetteEnabled = true;
  image.vignetteWeight = VIGNETTE_WEIGHT;
  image.vignetteStretch = VIGNETTE_STRETCH;
  // Multiply rather than the opaque blend: an opaque vignette paints its own
  // colour into the corners, which on a portrait frame is a black border.
  image.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
  image.vignetteColor.set(0, 0, 0, 0);
}

