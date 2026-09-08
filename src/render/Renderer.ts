/**
 * The Babylon layer. Owner: render agent (Phase B2).
 *
 * STUB for Phase A: `init` stands up a real engine, scene, camera, light and one
 * spinning box, which is what the smoke test screenshots to prove that WebGL
 * renders headless. `loadLevel` and `update` are otherwise no-ops.
 *
 * Rules that outlive the stub (docs/03-milestone-1-plan.md):
 *   - Babylon is imported here and nowhere else outside `src/render`.
 *   - Render reads sim state; it never mutates it.
 *   - Everything pooled; no mesh creation during a run.
 *
 * Deep imports (`@babylonjs/core/...`) rather than the package root, so the
 * single-file artifact build stays small.
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Scene } from '@babylonjs/core/scene';

import type { LevelDef, RunState, SimEvent } from '@/sim';

export class Renderer {
  private readonly canvas: HTMLCanvasElement;

  private engine: Engine | null = null;
  private scene: Scene | null = null;

  /** Placeholder subject so a Phase A frame is provably non-blank. */
  private box: Mesh | null = null;

  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init(): Promise<void> {
    const engine = createEngine(this.canvas);
    this.engine = engine;

    const scene = new Scene(engine);
    // Not black: the smoke test's variance check must be able to tell a rendered
    // frame from a dead canvas, and a lit box on sky is unambiguous.
    scene.clearColor = new Color4(0.42, 0.55, 0.75, 1);
    this.scene = scene;

    const camera = new UniversalCamera('camera', new Vector3(0, 4.5, -9), scene);
    camera.setTarget(new Vector3(0, 1, 2));
    camera.fov = 1.0;
    camera.minZ = 0.1;

    const light = new HemisphericLight('light', new Vector3(0.3, 1, -0.2), scene);
    light.intensity = 0.95;
    light.groundColor = new Color3(0.25, 0.22, 0.3);

    const groundMaterial = new StandardMaterial('groundMat', scene);
    groundMaterial.diffuseColor = new Color3(0.28, 0.3, 0.36);
    groundMaterial.specularColor = new Color3(0, 0, 0);
    const ground = CreateGround('ground', { width: 6, height: 80 }, scene);
    ground.position.z = 20;
    ground.material = groundMaterial;

    const boxMaterial = new StandardMaterial('boxMat', scene);
    boxMaterial.diffuseColor = new Color3(0.95, 0.45, 0.15);
    boxMaterial.emissiveColor = new Color3(0.3, 0.12, 0.02);
    const box = CreateBox('placeholder', { size: 2 }, scene);
    box.position = new Vector3(0, 1.4, 2);
    box.material = boxMaterial;
    this.box = box;

    // Compiles shaders and uploads buffers, so the first `update` is not a
    // blank frame that the smoke test would screenshot.
    await scene.whenReadyAsync();
  }

  /** Phase B2: builds road, gate meshes, enemy meshes, boss, labels; resets pools. */
  loadLevel(_level: LevelDef): void {
    // Intentionally empty in Phase A.
  }

  /** Called every frame after `Run.tick`. Phase B2 drives meshes from `state`. */
  update(_state: RunState, _events: readonly SimEvent[], dt: number): void {
    if (this.disposed) return;
    const scene = this.scene;
    if (scene === null) return;

    if (this.box !== null) {
      this.box.rotation.y += dt * 0.9;
      this.box.rotation.x += dt * 0.35;
    }

    scene.render();
  }

  resize(): void {
    this.engine?.resize();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.box = null;
    this.scene?.dispose();
    this.scene = null;
    this.engine?.dispose();
    this.engine = null;
  }
}

/**
 * SwiftShader in headless Chromium can refuse a WebGL2 context. Try the normal
 * antialiased WebGL2 engine first, then fall back to WebGL1 without
 * antialiasing rather than letting the whole app fail to boot.
 */
function createEngine(canvas: HTMLCanvasElement): Engine {
  try {
    return new Engine(canvas, true, {
      disableWebGL2Support: false,
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
  } catch (error) {
    console.warn('[render] WebGL2 engine failed, falling back to WebGL1', error);
    return new Engine(canvas, false);
  }
}
