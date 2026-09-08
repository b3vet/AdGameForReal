/**
 * Asset pipeline proof scenes: `npm run dev`, then open
 *
 *   /dev/vat-test.html?scene=gltf      the three characters, skinned, playing
 *                                      an animation group each (glTF loading)
 *   /dev/vat-test.html?scene=crowd     500 mages plus 40 skeletons as thin
 *                                      instances driven by baked textures
 *   /dev/vat-test.html?scene=physics   Havok init: a box falls onto a ground
 *
 * The HUD prints draw calls and active meshes, which is what the crowd scene is
 * really there to show. A screenshot script waits for `__vatTest.ready`.
 */

import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
// Side-effect imports: `joinedPhysicsEngineComponent` is what actually puts
// `enablePhysics` on `Scene.prototype`; the v2 component wires bodies to nodes.
import '@babylonjs/core/Physics/joinedPhysicsEngineComponent';
import '@babylonjs/core/Physics/v2/physicsEngineComponent';
import { Scene } from '@babylonjs/core/scene';
import '@babylonjs/loaders/glTF/2.0';

import HavokPhysics from '@babylonjs/havok';
// Vite serves the WASM as a URL and `locateFile` overrides the emscripten
// default, which would otherwise look for it next to the pre-bundled module.
import havokWasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';

import { VatCrowd, loadCharacterAsset, resolveAssetUrl } from '@/render/characters';

interface VatTestHandle {
  ready: boolean;
  scene: string;
  stats: () => { drawCalls: number; activeMeshes: number; fps: number };
  note: string;
}

declare global {
  // `var` is required here: this is a global augmentation, not a declaration.
  var __vatTest: VatTestHandle | undefined;
}

const CROWD_MAGES = 500;
const CROWD_SKELETONS = 40;

const canvas = document.querySelector<HTMLCanvasElement>('#vat-test-canvas');
const hudElement = document.querySelector<HTMLElement>('#hud');
if (canvas === null || hudElement === null) {
  throw new Error('dev/vat-test.html is missing its canvas or HUD');
}
const hud: HTMLElement = hudElement;

const params = new URLSearchParams(window.location.search);
const which = params.get('scene') ?? 'gltf';
/** `?alpha=1.57` looks at the characters from the front instead of behind. */
const alpha = Number(params.get('alpha') ?? Number.NaN);

const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false }, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.043, 0.051, 0.078, 1);

const camera = new ArcRotateCamera('camera', -Math.PI / 2, 1.15, 6, Vector3.Zero(), scene);
camera.attachControl(canvas, true);

const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, 0.6), scene);
sun.intensity = 1.5;
const sky = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
sky.intensity = 0.75;

const instrumentation = new SceneInstrumentation(scene);
instrumentation.captureFrameTime = true;

let note = '';

/** The three characters as the artist shipped them, skinned and playing. */
async function gltfScene(): Promise<void> {
  camera.setTarget(new Vector3(0, 1.1, 0));
  camera.radius = 9;

  const models: { id: string; x: number; scale: number; clip: string }[] = [
    { id: 'mage', x: -2.6, scale: 1, clip: 'Running_A' },
    { id: 'skeleton_minion', x: 0, scale: 1, clip: 'Walking_D_Skeletons' },
    { id: 'boss_demon', x: 3, scale: 1, clip: 'Walk' },
  ];

  const played: string[] = [];
  for (const model of models) {
    const loaded = await ImportMeshAsync(resolveAssetUrl(model.id), scene);
    const root = loaded.meshes[0];
    if (root !== undefined) {
      root.position.x = model.x;
      root.scaling.scaleInPlace(model.scale);
    }
    for (const group of loaded.animationGroups) group.stop();
    const clip = loaded.animationGroups.find((group) => group.name === model.clip);
    if (clip === undefined) throw new Error(`${model.id} has no clip ${model.clip}`);
    clip.play(true);
    played.push(`${model.id}:${clip.name}`);
  }
  note = played.join('  ');
}

/**
 * The crowd the squad will be made of. One draw call per mesh is the point, so
 * the mages are one `VatCrowd` and the skeletons another.
 */
async function crowdScene(): Promise<void> {
  camera.setTarget(new Vector3(0, 0.5, 2.5));
  camera.radius = 16;
  camera.beta = 1.02;

  const mageAsset = await loadCharacterAsset(scene, 'mage', { variant: 'ember' });
  const mages = new VatCrowd(mageAsset, CROWD_MAGES);
  const skeletonAsset = await loadCharacterAsset(scene, 'skeleton_minion');
  const skeletons = new VatCrowd(skeletonAsset, CROWD_SKELETONS);

  // Phyllotaxis, the same spiral the sim's formation uses, so the shape of the
  // crowd here is the shape it will have in the game.
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < CROWD_MAGES; i++) {
    const radius = 0.16 * Math.sqrt(i);
    const angle = i * golden;
    mages.setInstance(
      i,
      Math.cos(angle) * radius * 1.6,
      0,
      Math.sin(angle) * radius,
      Math.sin(i) * 0.12,
      1,
      'run',
      (i % 17) * 0.037,
    );
  }
  mages.setCount(CROWD_MAGES);
  mages.commit();

  for (let i = 0; i < CROWD_SKELETONS; i++) {
    const row = Math.floor(i / 10);
    skeletons.setInstance(
      i,
      -2.2 + (i % 10) * 0.5,
      0,
      6 + row * 0.7,
      Math.PI,
      1,
      'walk',
      (i % 11) * 0.05,
    );
  }
  skeletons.setCount(CROWD_SKELETONS);
  skeletons.commit();

  scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000;
    mages.update(dt);
    skeletons.update(dt);
  });

  note =
    `${String(CROWD_MAGES)} mages (ember) + ${String(CROWD_SKELETONS)} skeletons, ` +
    `vat ${String(mageAsset.vat.width)}x${String(mageAsset.vat.height)} ` +
    `${mageAsset.vat.format}, ranges ${mages.animationIds().join('/')}`;
}

/** Known-good Havok init for the physics agent: a box falls onto a ground. */
async function physicsScene(): Promise<void> {
  camera.setTarget(new Vector3(0, 1, 0));
  camera.radius = 10;

  const havok = await HavokPhysics({ locateFile: () => havokWasmUrl });
  const plugin = new HavokPlugin(true, havok);
  if (!scene.enablePhysics(new Vector3(0, -9.81, 0), plugin)) {
    throw new Error('scene.enablePhysics refused the Havok plugin');
  }

  const ground = CreateGround('ground', { width: 8, height: 8 }, scene);
  const groundMaterial = new StandardMaterial('groundMat', scene);
  groundMaterial.diffuseColor = new Color3(0.22, 0.24, 0.3);
  ground.material = groundMaterial;
  new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0 }, scene);

  const box = CreateBox('box', { size: 1 }, scene);
  box.position.set(0, 4, 0);
  const boxMaterial = new StandardMaterial('boxMat', scene);
  boxMaterial.diffuseColor = new Color3(0.95, 0.45, 0.18);
  box.material = boxMaterial;
  const body = new PhysicsAggregate(box, PhysicsShapeType.BOX, { mass: 1, restitution: 0.4 }, scene);

  note = `havok ok, plugin ${plugin.name}, body ${String(body.body.transformNode.name)}`;
}

async function main(): Promise<void> {
  if (which === 'crowd') await crowdScene();
  else if (which === 'physics') await physicsScene();
  else await gltfScene();

  if (!Number.isNaN(alpha)) camera.alpha = alpha;

  engine.runRenderLoop(() => {
    scene.render();
  });
  window.addEventListener('resize', () => {
    engine.resize();
  });

  const stats = (): { drawCalls: number; activeMeshes: number; fps: number } => ({
    drawCalls: instrumentation.drawCallsCounter.current,
    activeMeshes: scene.getActiveMeshes().length,
    fps: Math.round(engine.getFps()),
  });

  scene.onAfterRenderObservable.add(() => {
    const current = stats();
    hud.innerHTML =
      `<b>scene</b> ${which}\n<b>draw calls</b> ${String(current.drawCalls)}` +
      `   <b>active meshes</b> ${String(current.activeMeshes)}   <b>fps</b> ${String(current.fps)}\n${note}`;
  });

  globalThis.__vatTest = { ready: true, scene: which, stats, note };
}

main().catch((error: unknown) => {
  hud.textContent = `FAILED: ${String(error)}`;
  console.error('[vat-test] failed to start', error);
});
