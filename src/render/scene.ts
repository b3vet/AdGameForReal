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

/**
 * SwiftShader in headless Chromium can refuse a WebGL2 context. Try the normal
 * antialiased WebGL2 engine first, then fall back to WebGL1 without
 * antialiasing rather than letting the whole app fail to boot.
 */
export function createEngine(canvas: HTMLCanvasElement): Engine {
  try {
    return new Engine(
      canvas,
      true,
      {
        disableWebGL2Support: false,
        preserveDrawingBuffer: true,
        stencil: true,
        antialias: true,
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

  return scene;
}

/**
 * The glow pass, on an explicit include list.
 *
 * A glow layer redraws every mesh it covers into its own buffer, so left to
 * itself it would double the frame's draw calls. Only the spell effects are on
 * the list: they are what should bloom, and they are the meshes that are
 * disabled when nothing is happening.
 */
export function createGlow(scene: Scene, meshes: readonly Mesh[], enabled: boolean): GlowLayer {
  const glow = new GlowLayer('spellGlow', scene, {
    mainTextureRatio: GLOW_TEXTURE_RATIO,
    blurKernelSize: GLOW_BLUR,
  });
  glow.intensity = GLOW_INTENSITY;
  glow.isEnabled = enabled;
  for (const mesh of meshes) glow.addIncludedOnlyMesh(mesh);
  return glow;
}
