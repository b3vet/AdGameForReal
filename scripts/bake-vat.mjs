/**
 * Bakes skeletal animation into vertex animation textures (VAT).
 *
 * A VAT holds one bone matrix per texel row: `(bones + 1) * 4` pixels wide,
 * one row per baked frame. The shader reads it with the vertex's existing
 * `matricesIndices` / `matricesWeights`, so a thin-instanced crowd animates
 * with no CPU skinning and no per-unit skeleton — one draw call for 500 mages.
 *
 * Two things this does *not* do, on purpose:
 *
 *   - It bakes the *skeleton*, not the mesh. The output is bone matrices, so a
 *     single texture drives every mesh rigged to that skeleton: the mage body,
 *     the hat, and each of the three staffs. The mesh side (merging and
 *     re-skinning the accessories) is `src/render/characters/asset.ts`, which
 *     runs in the browser against the same `.glb`.
 *   - It does not use `VertexAnimationBaker.bakeVertexDataSync`. That helper
 *     drives `scene.beginAnimation(skeleton, f, f)`, which needs animations on
 *     the bones themselves; glTF puts them on the transform nodes the bones
 *     are linked to, so the helper silently bakes whatever group the loader
 *     happened to auto-play. We step the `AnimationGroup` instead and read
 *     `skeleton.getTransformMatrices()` — the same array the helper writes —
 *     then convert to half-float with Babylon's own `ToHalfFloat`.
 *
 *   node scripts/bake-vat.mjs
 *
 * Writes `assets/vat/<rig>.bin` (raw half-float RGBA) and `<rig>.json`.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { ToHalfFloat } from '@babylonjs/core/Misc/textureTools.js';
import { Scene } from '@babylonjs/core/scene.js';
import '@babylonjs/loaders/glTF/2.0/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'assets');

/**
 * 30 Hz, not the 60 the glTF carries. Half the rows for a crowd whose units
 * are twenty pixels tall; the shader picks the nearest row either way.
 */
const FPS = 30;

/**
 * What to bake, and the game-facing id each source animation answers to.
 *
 * A looping range **keeps** its last frame, which duplicates the first. That
 * repeat is the loop's wrap partner and both samplers need it: Babylon's own
 * `bakedVertexAnimation` plays `from + 1 .. to` once its clock passes one
 * cycle, and ours (`src/render/characters/vatSampling.ts`) interpolates from
 * `to - 1` into `to`. Milestone 3 dropped it on the theory that a repeated
 * pose is a hitch; what it actually produced was a *skipped* pose — the wrap
 * stepped two baked frames at once, once per cycle (Milestone 4 task P).
 */
const RIGS = [
  {
    rig: 'mage',
    model: 'models/mage.glb',
    ranges: [
      { id: 'idle', animation: 'Idle', loop: true },
      { id: 'run', animation: 'Running_A', loop: true },
      { id: 'cast', animation: 'Spellcast_Shoot', loop: true },
      // The second cast (Milestone 3): a crowd where every firing unit throws
      // the same shape at the same tempo reads as one animated dummy repeated,
      // so `SquadView` alternates the two by formation index.
      { id: 'cast2', animation: 'Spellcast_Raise', loop: true },
      { id: 'cheer', animation: 'Cheer', loop: true },
    ],
  },
  {
    rig: 'skeleton_minion',
    model: 'models/skeleton_minion.glb',
    ranges: [
      { id: 'walk', animation: 'Walking_D_Skeletons', loop: true },
      // A stream is hundreds of bodies down one lane; mixing a run into the
      // walk (and jittering playback speed per body) is what makes it a river
      // rather than a conveyor belt.
      { id: 'walk2', animation: 'Running_C', loop: true },
      { id: 'death', animation: 'Death_C_Skeletons', loop: false },
    ],
  },
  {
    rig: 'skeleton_warrior',
    model: 'models/skeleton_warrior.glb',
    ranges: [
      { id: 'walk', animation: 'Walking_C', loop: true },
      { id: 'walk2', animation: 'Running_C', loop: true },
      { id: 'death', animation: 'Death_A', loop: false },
    ],
  },
];

/**
 * Ceiling on one rig's baked texture, in kilobytes (Milestone 3 plan: keep each
 * VAT under about 300 KB). A range costs `width * frames * 8` bytes, so a clip
 * added without looking is how a 180 KB texture becomes a megabyte.
 */
const MAX_VAT_KB = 300;

/** Babylon's glTF loader lands animations on a 60 fps timeline. */
const SOURCE_FPS = 60;

/**
 * Node has no XHR, so the loader cannot open a file path. A base64 `data:`
 * URL with an explicit plugin extension is the supported way in.
 */
async function loadModel(scene, relative) {
  const bytes = await readFile(path.join(ASSETS, relative));
  return await ImportMeshAsync(`data:base64,${bytes.toString('base64')}`, scene, {
    pluginExtension: '.glb',
  });
}

/**
 * Folds in the glTF right-handed to Babylon left-handed conversion.
 *
 * The loader expresses it as a `__root__` node scaled -1 on x. A thin instance
 * cannot inherit that node, so `src/render/characters/asset.ts` negates the x
 * of every vertex instead, and the bone matrices have to move with them:
 * `T * M * T` with `T = diag(-1, 1, 1, 1)`, which negates exactly the elements
 * where one — and only one — of the row and the column is x. Babylon stores a
 * matrix column-major, so the flat index `k` is `column * 4 + row`.
 */
function unmirror(matrices) {
  for (let k = 0; k < matrices.length; k++) {
    const row = k % 4;
    const column = Math.floor(k / 4) % 4;
    if ((row === 0) !== (column === 0)) matrices[k] = -matrices[k];
  }
  return matrices;
}

/**
 * Steps one animation group frame by frame and returns the skeleton's
 * transform matrices for each sample.
 *
 * `count` is the number of *intervals*, so the range is `count + 1` rows and
 * the last one sits on the clip's end pose. For a loop that end pose is the
 * start pose again, which is exactly the wrap partner the sampler reads; the
 * clip's own duration is therefore `count / FPS`, not `rows / FPS`.
 */
function sampleRange(scene, skeleton, group) {
  const seconds = (group.to - group.from) / SOURCE_FPS;
  const count = Math.max(2, Math.round(seconds * FPS));
  const samples = count + 1;

  group.play(false);
  group.pause();

  const frames = [];
  for (let i = 0; i < samples; i++) {
    const t = i / count;
    group.goToFrame(group.from + t * (group.to - group.from));
    // `prepare` pulls each bone's local matrix from the transform node the
    // glTF loader linked to it, then fills `_transformMatrices`.
    skeleton.prepare(true);
    skeleton.computeAbsoluteMatrices(true);
    frames.push(unmirror(Float32Array.from(skeleton.getTransformMatrices(null))));
  }
  group.stop();
  scene.render();
  return frames;
}

async function bakeRig(engine, spec) {
  const scene = new Scene(engine);
  // The loader refuses to render without one, and `render()` is what flushes
  // the animation state we just stepped.
  new FreeCamera('bake', new Vector3(0, 0, -5), scene);

  const loaded = await loadModel(scene, spec.model);
  const skeleton = loaded.skeletons[0];
  if (skeleton === undefined) throw new Error(`${spec.model} has no skeleton`);
  for (const group of loaded.animationGroups) group.stop();

  const floatsPerFrame = (skeleton.bones.length + 1) * 16;
  const rows = [];
  const ranges = {};

  for (const range of spec.ranges) {
    const group = loaded.animationGroups.find((each) => each.name === range.animation);
    if (group === undefined) {
      throw new Error(`${spec.model} has no animation "${range.animation}"`);
    }
    const frames = sampleRange(scene, skeleton, group);
    ranges[range.id] = {
      animation: range.animation,
      from: rows.length,
      to: rows.length + frames.length - 1,
      loop: range.loop,
    };
    for (const frame of frames) {
      if (frame.length !== floatsPerFrame) {
        throw new Error(`frame is ${String(frame.length)} floats, expected ${String(floatsPerFrame)}`);
      }
      rows.push(frame);
    }
  }

  const data = new Uint16Array(floatsPerFrame * rows.length);
  rows.forEach((frame, row) => {
    const base = row * floatsPerFrame;
    for (let i = 0; i < floatsPerFrame; i++) data[base + i] = ToHalfFloat(frame[i]);
  });

  const manifest = {
    rig: spec.rig,
    source: spec.model,
    boneCount: skeleton.bones.length,
    /** RGBA texels: four per bone matrix, plus Babylon's trailing identity. */
    width: (skeleton.bones.length + 1) * 4,
    height: rows.length,
    fps: FPS,
    format: 'half-float-rgba',
    ranges,
  };

  scene.dispose();
  return { manifest, data };
}

async function main() {
  const engine = new NullEngine({ renderWidth: 4, renderHeight: 4, textureSize: 4 });
  await mkdir(path.join(ASSETS, 'vat'), { recursive: true });

  let total = 0;
  for (const spec of RIGS) {
    const { manifest, data } = await bakeRig(engine, spec);
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    await writeFile(path.join(ASSETS, 'vat', `${spec.rig}.bin`), bytes);
    await writeFile(
      path.join(ASSETS, 'vat', `${spec.rig}.json`),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    total += bytes.length;
    if (bytes.length > MAX_VAT_KB * 1024) {
      throw new Error(
        `${spec.rig}: ${(bytes.length / 1024).toFixed(0)} KB is over the ${MAX_VAT_KB} KB budget`,
      );
    }
    const names = Object.entries(manifest.ranges)
      .map(([id, r]) => `${id} ${String(r.from)}-${String(r.to)}`)
      .join(', ');
    console.log(
      `[vat] ${spec.rig}: ${String(manifest.width)}x${String(manifest.height)} half-float ` +
        `(${(bytes.length / 1024).toFixed(0)} KB) — ${names}`,
    );
  }
  console.log(`[vat] ${(total / 1024).toFixed(0)} KB in assets/vat/`);
  engine.dispose();
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(`[vat] FAIL — ${error.message}`);
    process.exit(1);
  });
