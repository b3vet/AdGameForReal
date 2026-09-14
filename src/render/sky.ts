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

import { CLOUD_CENTER_Y, buildCloudBand, buildCloudSheet, scrollClouds } from './skyClouds';
import type { CloudSheet } from './skyClouds';
import { SKY_HAZE, SKY_HORIZON, SKY_MID, SKY_ZENITH } from './theme';
import { mulberry32 } from '@/sim';

/**
 * Dome radius, in metres. Outside the fog's 260 m end and inside the camera's
 * far plane (`CAMERA.maxZ`), which is the pair that has to hold: a dome inside
 * the fog is a wall, and a dome outside the far plane is clipped away.
 */
const SKY_RADIUS = 420;

/**
 * Where the dome's rings sit, in degrees above the horizon.
 *
 * Crowded at the bottom because that is the *whole* sky this game ever shows.
 * The rig looks 13.6 degrees down with a 47-degree frame (`CAMERA`), so the top
 * of the screen is only about ten degrees above the horizon — fourteen on the
 * Academy's flatter backdrop. Everything above that is built for completeness
 * (a shake tips the frame, and the dome must not end) and costs a handful of
 * triangles.
 */
const RING_ELEVATIONS: readonly number[] = [
  -90, -40, -14, -6, -2.4, -0.8, 0, 0.4, 0.8, 1.3, 1.9, 2.6, 3.4, 4.4, 5.6, 7, 9, 12, 16, 24, 40,
  62, 90,
];
/** Azimuth steps. 96 puts about a dozen hills across a 47-degree frame. */
const DOME_SEGMENTS = 96;

/**
 * The gradient, as (height above the horizon / radius) → colour, which is the
 * sine of the elevation: 0.06 is 3.4 degrees up and 0.19 is 11.
 *
 * Those numbers are the framing, not a taste: the camera shows 0 to about 10
 * degrees of sky, so a gradient that reached `sky.top` at 30 degrees would
 * never show `sky.top` at all — the first version of this dome put the whole
 * blue half of the palette above the top of the screen and the frame read as
 * one flat pale band. The stops are packed into the strip the player sees.
 */
const GRADIENT: readonly { at: number; color: Color3 }[] = [
  { at: 0, color: SKY_HORIZON },
  { at: 0.06, color: SKY_MID },
  { at: 0.19, color: SKY_ZENITH },
  { at: 1, color: SKY_ZENITH },
];
// The four `Color3`s above are the palette's own shared instances, which a
// biome switch rewrites in place (`./palette.ts`). So the table is always the
// biome's gradient; what does *not* follow on its own is the vertex buffer
// baked from it, which is what `SkyDome.setBiome` rewrites.

/**
 * The hills, in the same units: a ridge line that wanders between `HILL_MIN`
 * and `HILL_MIN + HILL_RANGE` around the compass, filled with `sky.haze` and
 * softened over `HILL_SOFT` at the top so it is a haze bank rather than a
 * cut-out. Under two degrees of elevation — these are far hills, not a mountain
 * range, and with only ten degrees of sky in frame anything taller would fill
 * a fifth of it and fight the gate panels.
 */
const HILL_MIN = 0.005;
const HILL_RANGE = 0.032;
const HILL_SOFT = 0.009;
const HILL_SEED = 0x51c9_00d1;
/** How many bumps the ridge has around the full compass. */
const HILL_WAVES = 7;
/** Below the horizon the dome is the haze itself: see `colorAt`. */
const UNDER_HORIZON = 0.94;

export class SkyDome {
  private readonly dome: Mesh;
  private readonly clouds: Mesh;
  private readonly sheet: CloudSheet;
  private readonly materials: StandardMaterial[];

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

/**
 * The dome's whole colour buffer, in the biome now in force.
 *
 * A function rather than part of `buildDome` because it is run twice: once to
 * build the mesh, and again whenever the biome changes the roles it reads
 * (`SkyDome.setBiome`). The ridge is seeded, so both calls put the hills in the
 * same place.
 */
function domeColors(): Float32Array {
  const rings = RING_ELEVATIONS.length;
  const columns = DOME_SEGMENTS + 1;
  const colors = new Float32Array(rings * columns * 4);
  const ridge = ridgeLine(DOME_SEGMENTS);
  const color = new Color3();

  for (let r = 0; r < rings; r++) {
    const height = Math.sin(((RING_ELEVATIONS[r] ?? 0) * Math.PI) / 180);
    for (let c = 0; c < columns; c++) {
      // The last column repeats the first, so the seam's colours interpolate
      // the same way every other pair of columns does.
      const step = c % DOME_SEGMENTS;
      const index = r * columns + c;
      colorAt(height, ridge[step] ?? HILL_MIN, color);
      colors[index * 4] = color.r;
      colors[index * 4 + 1] = color.g;
      colors[index * 4 + 2] = color.b;
      colors[index * 4 + 3] = 1;
    }
  }
  return colors;
}

/**
 * The dome's colour at a height, given the hill ridge behind that column.
 *
 * Below the horizon the dome is the haze band slightly down: the ground plane
 * only reaches so far, and on a lateral drag the player briefly sees under the
 * road's edge. Keeping that a haze rather than a hole is what it is for.
 */
function colorAt(height: number, hillTop: number, out: Color3): void {
  gradientAt(Math.max(0, height), out);
  const hill =
    height <= 0 ? 1 : 1 - smoothstep(Math.max(0, hillTop - HILL_SOFT), hillTop, height);
  if (hill > 0) {
    out.r += (SKY_HAZE.r - out.r) * hill;
    out.g += (SKY_HAZE.g - out.g) * hill;
    out.b += (SKY_HAZE.b - out.b) * hill;
  }
  if (height < 0) {
    const under = Math.min(1, -height * 4);
    const scale = 1 + (UNDER_HORIZON - 1) * under;
    out.r *= scale;
    out.g *= scale;
    out.b *= scale;
  }
}

/** The gradient's colour at a height, linear between the stops. */
function gradientAt(height: number, out: Color3): void {
  let lower = GRADIENT[0];
  if (lower === undefined) return;
  for (let i = 1; i < GRADIENT.length; i++) {
    const upper = GRADIENT[i];
    if (upper === undefined) break;
    if (height <= upper.at) {
      const span = upper.at - lower.at;
      const t = span <= 0 ? 0 : (height - lower.at) / span;
      out.r = lower.color.r + (upper.color.r - lower.color.r) * t;
      out.g = lower.color.g + (upper.color.g - lower.color.g) * t;
      out.b = lower.color.b + (upper.color.b - lower.color.b) * t;
      return;
    }
    lower = upper;
  }
  out.copyFrom(lower.color);
}

/**
 * The ridge: one hill height per azimuth step, seeded so every screenshot and
 * every device gets the same skyline.
 *
 * A sum of sines rather than noise, because a ridge only has to be smooth and
 * closed: the frequencies are whole numbers so the line meets itself at the
 * seam, and three of them with random phases is already a skyline nobody reads
 * as periodic across the 47 degrees the camera can see at once.
 */
function ridgeLine(segments: number): Float32Array {
  const random = mulberry32(HILL_SEED);
  const phases = [random(), random(), random()];
  const line = new Float32Array(segments);
  for (let i = 0; i < segments; i++) {
    const turn = (i / segments) * Math.PI * 2;
    let value = 0;
    for (let h = 0; h < phases.length; h++) {
      const waves = HILL_WAVES * (h + 1);
      const phase = (phases[h] ?? 0) * Math.PI * 2;
      value += Math.sin(turn * waves + phase) / (h + 1);
    }
    // Sum of 1 + 1/2 + 1/3 either way, mapped to 0..1.
    line[i] = HILL_MIN + HILL_RANGE * (value / 3.667 + 0.5);
  }
  return line;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
