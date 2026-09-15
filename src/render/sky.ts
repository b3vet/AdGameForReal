/**
 * The sky: the dome, its clouds and the hills at the end of the road.
 *
 * Milestone 3 kept a sixteen-segment sphere with a painted gradient inside
 * `./road.ts`. This replaces it, because Milestone 5's long view (D38) asks the
 * sky to do three jobs the old one could not:
 *
 *  1. **Reach past the fog.** Fog now ends at 260 m, so a dome at 190 m was
 *     inside the range the road is still visible in.
 *  2. **Hold the horizon.** The road runs to `arenaZ + 80` and fades into
 *     `sky.haze`; without something *at* the horizon carrying the same colour,
 *     the far end of a long level is a straight line of haze against blue.
 *     That line is what reads as "the world stops here". The hill band is the
 *     fix: the road arrives at hills instead of at nothing.
 *  3. **Move.** A still sky over a moving road reads as a painted backdrop.
 *
 * Two meshes and no more, because the shadows and the dome together may add at
 * most two draw calls to the frame (plan, Phase A). Milestone 3's own dome
 * (built by `RoadView`) went with the road it lived in:
 *
 *   dome    one inverted sphere, gradient and hills in its *vertex colours* —
 *           `sky.top` through `sky.mid` to `sky.horizon`, with the hill band
 *           cut out of `sky.haze` near the horizon. No texture at all: the
 *           gradient is interpolated by the vertex stage, which is free, and
 *           the material is emissive-white times the vertex colour.
 *   clouds   one open cylinder band above the hills carrying a tileable noise
 *           texture, drawn once at 512 px and scrolled by its own `uOffset`.
 *           It has a file of its own (`./skyClouds.ts`) for the file-size rule.
 *
 * The ring elevations are the reason the dome is built by hand rather than with
 * `CreateSphere`: a uniform sphere spaces its rings 3.75 degrees apart at 48
 * segments, and the hill band is under two degrees tall, so a uniform sphere
 * has no vertices to put a silhouette in. `RING_ELEVATIONS` crowds them at the
 * horizon, where the whole picture is, and spends almost none overhead.
 *
 * Both meshes ride on the camera — a dome that stays behind is a wall — and
 * neither writes depth or takes fog: the dome *is* what the fog fades to.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { Scene } from '@babylonjs/core/scene';

import type { SkyColors } from './biomeSpans';
import { CLOUD_CENTER_Y, buildCloudBand, buildCloudSheet, scrollClouds } from './skyClouds';
import type { CloudSheet } from './skyClouds';
import {
  DOME_SEGMENTS,
  RING_ELEVATIONS,
  domeColors,
  domeVertexCount,
  writeDomeColors,
} from './skyGradient';

/**
 * Dome radius, in metres. Outside the fog's 260 m end and inside the camera's
 * far plane (`CAMERA.maxZ`), which is the pair that has to hold: a dome inside
 * the fog is a wall, and a dome outside the far plane is clipped away.
 */
const SKY_RADIUS = 420;

export class SkyDome {
  private readonly dome: Mesh;
  private readonly clouds: Mesh;
  private readonly sheet: CloudSheet;
  private readonly materials: StandardMaterial[];

  /**
   * Scratch for `setBlend`, allocated once: a crossfade rewrites the dome's
   * whole colour buffer on every frame it lasts (D52's boundaries), and a
   * megabyte of `Float32Array` per frame is exactly what the no-allocation rule
   * is about. Null until the first fade, so a campaign-only session never pays
   * for it.
   */
  private blendBuffer: Float32Array | null = null;
  /** Reused by the lerp inside that loop, for the same reason. */
  private readonly blendColor = new Color3();

  constructor(scene: Scene) {
    this.dome = buildDome(scene);

    this.sheet = buildCloudSheet(scene);
    this.clouds = buildCloudBand(scene, this.sheet.texture, unlitSky(scene, 'skyCloudMat'));

    const materials: StandardMaterial[] = [];
    for (const mesh of [this.dome, this.clouds]) {
      mesh.isPickable = false;
      mesh.receiveShadows = false;
      // The sky is always in frame by construction, so the frustum test on the
      // two largest meshes in the scene is a check that can only ever say yes.
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.renderingGroupId = 0;
      if (mesh.material instanceof StandardMaterial) materials.push(mesh.material);
    }
    this.materials = materials;
  }

  /**
   * Repaints the sky in the biome now in force (D49): the dome's gradient and
   * its hill band, and the tint of the clouds over them.
   *
   * Both are *rewritten*, not rebuilt — `updateVerticesData` into the existing
   * colour buffer and `putImageData` into the existing sheet — so a level that
   * changes biome adds no mesh, no material and no texture to the scene. The
   * ridge line is seeded and the noise field is kept, so the skyline and the
   * cloud shapes are the same ones in both biomes; only their colour moves.
   */
  setBiome(): void {
    this.dome.updateVerticesData(VertexBuffer.ColorKind, domeColors(), false, false);
    this.sheet.repaint();
  }

  /**
   * Crossfades the dome between two biomes' skies (D52, `./biomeSpans.ts`).
   *
   * The gradient and the hill band are *baked into the vertex colours*, so a
   * fade cannot be a uniform: the two skies differ per stop, and a single
   * multiplier over the buffer would move the hills with the zenith. So the
   * whole buffer is rebuilt from the two ends — about two thousand vertices,
   * for the second and a half a boundary takes — into a scratch that is
   * allocated once and reused.
   *
   * The clouds are *not* repainted here: their sheet is a canvas, repainting it
   * is a `putImageData` of a 512-pixel texture, and the tint difference between
   * the two biomes' clouds is a shade. `setBiome` catches them at the crossing.
   */
  setBlend(from: SkyColors, to: SkyColors, t: number): void {
    const buffer = this.blendBuffer ?? new Float32Array(domeVertexCount() * 4);
    this.blendBuffer = buffer;
    writeDomeColors(buffer, from, to, Math.min(1, Math.max(0, t)), this.blendColor);
    this.dome.updateVerticesData(VertexBuffer.ColorKind, buffer, false, false);
  }

  /**
   * Locks both materials against the per-frame readiness check. Called after
   * the scene's first `whenReadyAsync`, never before — a material frozen while
   * its effect is still compiling is never drawn (`RoadView.freeze`).
   *
   * The world matrices are *not* frozen: both meshes move with the camera.
   */
  freeze(): void {
    for (const material of this.materials) material.freeze();
  }

  /**
   * Follows the camera and drifts the clouds.
   *
   * `x` and `z` only: the dome's centre stays on the ground plane, so the
   * horizon sits where the horizon is however high the camera stands.
   */
  update(cameraX: number, cameraZ: number, dt: number): void {
    this.dome.position.set(cameraX, 0, cameraZ);
    this.clouds.position.set(cameraX, CLOUD_CENTER_Y, cameraZ);
    scrollClouds(this.sheet.texture, dt);
  }

  dispose(): void {
    for (const material of this.materials) material.dispose();
    this.sheet.texture.dispose();
    this.dome.dispose();
    this.clouds.dispose();
  }
}

/**
 * The dome: rings of vertices at `RING_ELEVATIONS`, coloured per vertex.
 *
 * Built by hand because the ring spacing is the point (see the file's note).
 * No normals and no UVs are supplied: the material is unlit and untextured, so
 * nothing in the shader would read them, and leaving them out is two attribute
 * buffers the vertex stage does not have to fetch.
 */
function buildDome(scene: Scene): Mesh {
  const rings = RING_ELEVATIONS.length;
  const columns = DOME_SEGMENTS + 1;
  const positions = new Float32Array(rings * columns * 3);
  const indices: number[] = [];

  for (let r = 0; r < rings; r++) {
    const elevation = ((RING_ELEVATIONS[r] ?? 0) * Math.PI) / 180;
    const height = Math.sin(elevation);
    const around = Math.cos(elevation);
    for (let c = 0; c < columns; c++) {
      const angle = (c / DOME_SEGMENTS) * Math.PI * 2;
      const index = r * columns + c;
      positions[index * 3] = Math.sin(angle) * around * SKY_RADIUS;
      positions[index * 3 + 1] = height * SKY_RADIUS;
      positions[index * 3 + 2] = Math.cos(angle) * around * SKY_RADIUS;
    }
  }
  const colors = domeColors();

  for (let r = 0; r < rings - 1; r++) {
    for (let c = 0; c < DOME_SEGMENTS; c++) {
      const a = r * columns + c;
      const b = a + 1;
      const d = a + columns;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }

  const mesh = new Mesh('skyDome', scene);
  const data = new VertexData();
  data.positions = positions;
  data.colors = colors;
  data.indices = indices;
  data.applyToMesh(mesh, false);
  // The colour buffer — and only it — is updatable: the gradient and the hill
  // band are rewritten by `setBiome` and by the endless road's crossfade
  // (`setBlend`), and Babylon *silently ignores* an update to a buffer that was
  // not made updatable (`Buffer.updateDirectly`). The dome kept its boot
  // gradient in every biome until this was found by the Milestone 8 probe. The
  // positions and the indices stay static, because they never change.
  mesh.setVerticesData(VertexBuffer.ColorKind, colors, true);
  // Both faces, so the winding of a hand-built sphere seen from the inside is
  // not a thing anyone has to get right twice.
  mesh.material = unlitSky(scene, 'skyDomeMat');
  mesh.material.backFaceCulling = false;
  // Opaque with a vertex-colour buffer: without this Babylon assumes the alpha
  // channel means something and moves the dome into the transparent queue,
  // where it would be drawn *after* the road it is supposed to sit behind.
  mesh.hasVertexAlpha = false;
  return mesh;
}

/**
 * An unlit sky material: emissive white times whatever carries the colour (the
 * vertex buffer on the dome, the texture on the clouds).
 *
 * `emissiveColor` white and `diffuseColor` black with the lights off is the one
 * combination that yields the vertex colour unchanged —
 * `clamp(0 + emissive + ambient) * baseColor` in `default.fragment`, where
 * `baseColor` is the texture times the vertex colour. The scene's tone mapping
 * still applies, so the sky sits in the same curve as everything else.
 */
function unlitSky(scene: Scene, name: string): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.emissiveColor = Color3.White();
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.ambientColor = Color3.Black();
  material.disableLighting = true;
  // The sky is behind everything by construction; writing depth would clip the
  // far end of the road out of the frame.
  material.disableDepthWrite = true;
  // The dome is what the fog fades *to*. Fogging it would fade it to itself at
  // the horizon and to nothing at the zenith.
  material.fogEnabled = false;
  return material;
}

