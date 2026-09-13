/**
 * The cloud band: the one moving thing in the sky.
 *
 * Split out of `./sky.ts` for the file-size rule (CLAUDE.md). The line between
 * the two is what each is made of: the dome is geometry with its colour in the
 * vertex buffer and never changes after it is built, and this is a texture —
 * painted once, wrapped round a cylinder above the hills, and scrolled.
 *
 * A cylinder rather than a second sphere so only the band itself rasterises: an
 * alpha-blended sphere would blend a transparent pixel over every part of the
 * sky the clouds are not in, which on a software rasteriser is the whole frame.
 */

import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { SKY_HORIZON } from './theme';
import { mulberry32 } from '@/sim';

/**
 * A cylinder of this radius, between these two heights.
 *
 * Only the ratio matters — the band rides on the camera, so `y / radius` is the
 * elevation it covers: 2.7 to 15 degrees, which is the strip of sky between the
 * hills and the top of the frame. The first version reached 27 degrees and put
 * every cloud above the screen.
 */
const CLOUD_RADIUS = 300;
const CLOUD_BOTTOM_Y = 14;
const CLOUD_TOP_Y = 80;
const CLOUD_SEGMENTS = 48;
const CLOUD_TEXTURE_SIZE = 512;
/** Texture widths per second. One wrap takes four minutes; nobody sees it move. */
const CLOUD_SCROLL = 0.004;
/** Where the band's own centre sits, which is what the mesh is parked at. */
export const CLOUD_CENTER_Y = (CLOUD_BOTTOM_Y + CLOUD_TOP_Y) / 2;
/**
 * How many times the sheet wraps around the compass.
 *
 * Not one: the band is nineteen hundred metres around and sixty-six tall, so a
 * single wrap stretches a square texture twenty-eight to one and every cloud
 * comes out as a horizontal smear of gradient. Six puts one repeat across about
 * a screen's worth of sky, and each repeat carries `CLOUD_TILES` of noise, so
 * nothing in frame reads as periodic. The sheet tiles in `u` by construction
 * (`latticeNoise` wraps at `CLOUD_TILES` cells), so the repeats have no seam.
 */
const CLOUD_REPEATS = 6;
/** Repeats of the noise inside the sheet, and the octaves it is built from. */
const CLOUD_TILES = 3;
const CLOUD_OCTAVES = 4;
/**
 * Where the *normalised* noise turns into a cloud, and how soft that edge is.
 *
 * Normalised is the load-bearing word. Four octaves of value noise averaged
 * with their own amplitudes land in a narrow hump around 0.35 — the first
 * version thresholded the raw value at 0.55 and only seven percent of the sheet
 * ever crossed it, none of it by enough to reach full alpha, so the band was
 * empty sky. The sheet is stretched to its own min and max first, and these two
 * then mean what they look like: about a third of the band carries cloud.
 */
const CLOUD_THRESHOLD = 0.52;
const CLOUD_EDGE = 0.3;
/** The densest a cloud ever gets. Soft: these are a hundred metres of haze. */
const CLOUD_ALPHA = 0.62;
const CLOUD_SEED = 0x0c10_7d5a;

/** The cloud band: an open cylinder, so only the band itself rasterises. */
export function buildCloudBand(
  scene: Scene,
  texture: DynamicTexture,
  material: StandardMaterial,
): Mesh {
  const mesh = CreateCylinder(
    'skyClouds',
    {
      height: CLOUD_TOP_Y - CLOUD_BOTTOM_Y,
      diameter: CLOUD_RADIUS * 2,
      tessellation: CLOUD_SEGMENTS,
      cap: Mesh.NO_CAP,
    },
    scene,
  );

  material.diffuseTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  material.backFaceCulling = false;
  mesh.material = material;
  // First of everything transparent: the band is three hundred metres away and
  // must not sort itself in among the spell quads.
  mesh.alphaIndex = 0;
  return mesh;
}

/**
 * The cloud sheet: tileable value-noise fbm, thresholded into soft cloud
 * shapes, faded out at the top and bottom of the band.
 *
 * Tileable because the band wraps the compass and then scrolls: the lattice
 * wraps at `CLOUD_TILES` cells across the texture, so the left edge and the
 * right edge are the same samples and the seam never arrives.
 */
export function buildCloudTexture(scene: Scene): DynamicTexture {
  const size = CLOUD_TEXTURE_SIZE;
  const texture = new DynamicTexture('skyCloudSheet', { width: size, height: size }, scene, true);
  const context = texture.getContext();
  const image = context.getImageData(0, 0, size, size);
  const data = image.data;
  const noise = latticeNoise(CLOUD_SEED);

  // Pass one: the field, and the range it actually covers. See CLOUD_THRESHOLD.
  const field = new Float32Array(size * size);
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = fbm(noise, (x / size) * CLOUD_TILES, (y / size) * CLOUD_TILES * 0.5);
      field[y * size + x] = value;
      if (value < lowest) lowest = value;
      if (value > highest) highest = value;
    }
  }
  const span = highest - lowest || 1;

  // The band's own colour: the horizon's, lifted toward white so a cloud reads
  // as lit from above rather than as a grey smear on the gradient.
  const tint = Color3.Lerp(SKY_HORIZON, Color3.White(), 0.55);
  const red = Math.round(tint.r * 255);
  const green = Math.round(tint.g * 255);
  const blue = Math.round(tint.b * 255);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    // Cloud cover across the band: nothing at the very bottom (the hills are
    // there) or the very top, most of it in the middle third.
    const band = smoothstep(0.04, 0.34, v) * (1 - smoothstep(0.62, 0.98, v));
    for (let x = 0; x < size; x++) {
      const value = ((field[y * size + x] ?? lowest) - lowest) / span;
      const cloud = smoothstep(CLOUD_THRESHOLD, CLOUD_THRESHOLD + CLOUD_EDGE, value);
      const alpha = cloud * band * CLOUD_ALPHA;
      const at = (y * size + x) * 4;
      data[at] = red;
      data[at + 1] = green;
      data[at + 2] = blue;
      data[at + 3] = Math.round(alpha * 255);
    }
  }

  context.putImageData(image, 0, 0);
  texture.update(false);
  texture.hasAlpha = true;
  texture.uScale = CLOUD_REPEATS;
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  // Clamped vertically, or the band's bottom row bleeds into its top one.
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

/** A seeded value-noise lattice that wraps every `CLOUD_TILES` cells. */
function latticeNoise(seed: number): (x: number, y: number, period: number) => number {
  const size = 64;
  const random = mulberry32(seed);
  const table = new Float32Array(size * size);
  for (let i = 0; i < table.length; i++) table[i] = random();
  return (x: number, y: number, period: number): number => {
    const wrap = (value: number, by: number): number => ((value % by) + by) % by;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const at = (ix: number, iy: number): number =>
      table[wrap(wrap(iy, size) * size + wrap(ix, period), table.length)] ?? 0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return top + (bottom - top) * sy;
  };
}

/** Four octaves of it, each half the amplitude and twice the frequency. */
function fbm(noise: (x: number, y: number, period: number) => number, x: number, y: number): number {
  let value = 0;
  let amplitude = 0.5;
  let total = 0;
  let frequency = 1;
  for (let octave = 0; octave < CLOUD_OCTAVES; octave++) {
    value += noise(x * frequency, y * frequency, CLOUD_TILES * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total === 0 ? 0 : value / total;
}


function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Drifts the sheet. Wrapped by hand rather than left to grow: the offset is a
 * float uniform, and a session that runs for an hour would otherwise be adding
 * a slow drift to a number big enough to have lost the precision to hold it.
 */
export function scrollClouds(texture: DynamicTexture, dt: number): void {
  texture.uOffset = (texture.uOffset + CLOUD_SCROLL * dt) % 1;
}
