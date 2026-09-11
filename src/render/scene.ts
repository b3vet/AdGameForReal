/**
 * Scene plumbing: the engine, the lights and the glow pass.
 *
 * Pulled out of `Renderer` so that file is about what happens every frame. The
 * dusk lighting is one warm key from behind the player's shoulder and a cool
 * sky fill (docs/06-milestone-2-plan.md, "Palette and tone"): the crowd's backs
 * and the enemies' faces are both lit by the key, and nothing in shadow goes
 * fully black.
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';

import { FOG_COLOR, FOG_END, FOG_START, SKY } from './theme';

/** Glow: a quarter-size buffer, per the plan, so a phone can afford the pass. */
const GLOW_TEXTURE_RATIO = 0.25;
const GLOW_INTENSITY = 0.5;
const GLOW_BLUR = 24;

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

  const sky = new HemisphericLight('sky', new Vector3(0.1, 1, -0.2), scene);
  sky.intensity = 0.7;
  sky.diffuse = new Color3(0.5, 0.58, 0.9);
  sky.groundColor = new Color3(0.12, 0.1, 0.16);

  const key = new DirectionalLight('key', new Vector3(-0.35, -0.85, 0.4), scene);
  key.intensity = 1.7;
  key.diffuse = new Color3(1, 0.8, 0.58);
  key.specular = new Color3(0.4, 0.3, 0.22);

  // Nothing in the scene is picked. Steering is read from raw pointer events in
  // `src/core/input.ts`, and every mesh here is `isPickable = false` anyway, so
  // a ray cast per pointer move is a scene graph walk for an answer nobody
  // reads — and a drag is a pointer move every frame.
  scene.skipPointerMovePicking = true;
  scene.constantlyUpdateMeshUnderPointer = false;

  return scene;
}

/**
 * The glow pass, on an explicit include list.
 *
 * A glow layer redraws every mesh it covers into its own buffer, so left to
 * itself it would double the frame's draw calls. Only the spell effects are on
 * the list: they are what should bloom, and they are the meshes that are
 * disabled when nothing is happening.
 *
 * Built on demand rather than at init (Milestone 3 plan, performance step 4):
 * the layer allocates a render target and two blur textures the moment it
 * exists, and the game no longer turns it on. The bolts and impacts carry their
 * own brightness now (`BOLT_GLOW_BOOST` in `theme.ts`), so nothing is waiting
 * on this.
 */
export function createGlow(scene: Scene, meshes: readonly Mesh[]): GlowLayer {
  const glow = new GlowLayer('spellGlow', scene, {
    mainTextureRatio: GLOW_TEXTURE_RATIO,
    blurKernelSize: GLOW_BLUR,
  });
  glow.intensity = GLOW_INTENSITY;
  for (const mesh of meshes) glow.addIncludedOnlyMesh(mesh);
  return glow;
}
