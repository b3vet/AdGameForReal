/**
 * The dome's shape and its colours: where the rings sit, the gradient poured
 * through them, the hill band cut out near the horizon, and the two ways that
 * whole buffer is written — in one biome, and blended between two of them.
 *
 * Split out of `./sky.ts` in Milestone 8 for the file-size rule (CLAUDE.md), on
 * the seam that file already had: `sky.ts` is the two *meshes* — the dome and
 * the cloud band, what they are made of and how they follow the camera — and
 * this is what colour every vertex of the dome is. The endless road's
 * crossfade (D52) is what made the second half big enough to be its own file.
 */

import { Color3 } from '@babylonjs/core/Maths/math.color';

import type { SkyColors } from './biomeSpans';
import { SKY_HAZE, SKY_HORIZON, SKY_MID, SKY_ZENITH } from './theme';
import { mulberry32 } from '@/sim';

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
export const RING_ELEVATIONS: readonly number[] = [
  -90, -40, -14, -6, -2.4, -0.8, 0, 0.4, 0.8, 1.3, 1.9, 2.6, 3.4, 4.4, 5.6, 7, 9, 12, 16, 24, 40,
  62, 90,
];
/** Azimuth steps. 96 puts about a dozen hills across a 47-degree frame. */
export const DOME_SEGMENTS = 96;

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


/** Vertices in the dome; the colour buffer is four floats each. */
export function domeVertexCount(): number {
  return RING_ELEVATIONS.length * (DOME_SEGMENTS + 1);
}

/**
 * The dome's whole colour buffer, in the biome now in force.
 *
 * A function rather than part of `buildDome` because it is run twice: once to
 * build the mesh, and again whenever the biome changes the roles it reads
 * (`SkyDome.setBiome`). The ridge is seeded, so both calls put the hills in the
 * same place.
 */
export function domeColors(): Float32Array {
  const colors = new Float32Array(domeVertexCount() * 4);
  const ridge = ridgeLine(DOME_SEGMENTS);
  const color = new Color3();
  const columns = DOME_SEGMENTS + 1;

  for (let r = 0; r < RING_ELEVATIONS.length; r++) {
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
 * The same buffer, lerped between two biomes' skies. See `SkyDome.setBlend`.
 *
 * `colorAt` reads the palette's own roles, which is one biome at a time, so
 * the gradient and the hill band are evaluated here against the two `SkyColors`
 * instead — the same arithmetic with the stops handed in.
 */
export function writeDomeColors(
  colors: Float32Array,
  from: SkyColors,
  to: SkyColors,
  t: number,
  scratch: Color3,
): void {
  const ridge = ridgeLine(DOME_SEGMENTS);
  const columns = DOME_SEGMENTS + 1;

  for (let r = 0; r < RING_ELEVATIONS.length; r++) {
    const height = Math.sin(((RING_ELEVATIONS[r] ?? 0) * Math.PI) / 180);
    for (let c = 0; c < columns; c++) {
      const step = c % DOME_SEGMENTS;
      const index = r * columns + c;
      blendedColorAt(height, ridge[step] ?? HILL_MIN, from, to, t, scratch);
      colors[index * 4] = scratch.r;
      colors[index * 4 + 1] = scratch.g;
      colors[index * 4 + 2] = scratch.b;
      colors[index * 4 + 3] = 1;
    }
  }
}

/** `colorAt` over two skies at once; see `writeDomeColors`. */
function blendedColorAt(
  height: number,
  hillTop: number,
  from: SkyColors,
  to: SkyColors,
  t: number,
  out: Color3,
): void {
  blendedGradientAt(Math.max(0, height), from, to, t, out);

  const hill =
    height <= 0 ? 1 : 1 - smoothstep(Math.max(0, hillTop - HILL_SOFT), hillTop, height);
  if (hill > 0) {
    out.r += (mix(from.haze.r, to.haze.r, t) - out.r) * hill;
    out.g += (mix(from.haze.g, to.haze.g, t) - out.g) * hill;
    out.b += (mix(from.haze.b, to.haze.b, t) - out.b) * hill;
  }
  if (height < 0) {
    const under = Math.min(1, -height * 4);
    const scale = 1 + (UNDER_HORIZON - 1) * under;
    out.r *= scale;
    out.g *= scale;
    out.b *= scale;
  }
}

/**
 * The gradient at a height, over two skies.
 *
 * `GRADIENT` names its stops by palette role and a fade's two ends are
 * `SkyColors`, so the stops are read by *index*: 0 is the horizon, 1 the mid
 * band, and everything above is the zenith. That mapping is `GRADIENT`'s own
 * order and has to be kept in step with it by hand — the table is four stops
 * long and its comment says why each one is where it is.
 */
function blendedGradientAt(
  height: number,
  from: SkyColors,
  to: SkyColors,
  t: number,
  out: Color3,
): void {
  let lower = 0;
  for (let i = 1; i < GRADIENT.length; i++) {
    const upper = GRADIENT[i];
    if (upper === undefined) break;
    if (height <= upper.at) {
      const lowerAt = GRADIENT[lower]?.at ?? 0;
      const span = upper.at - lowerAt;
      const within = span <= 0 ? 0 : (height - lowerAt) / span;
      writeStop(lower, from, to, t, stopLow);
      writeStop(i, from, to, t, stopHigh);
      out.r = stopLow[0] + (stopHigh[0] - stopLow[0]) * within;
      out.g = stopLow[1] + (stopHigh[1] - stopLow[1]) * within;
      out.b = stopLow[2] + (stopHigh[2] - stopLow[2]) * within;
      return;
    }
    lower = i;
  }
  writeStop(lower, from, to, t, stopLow);
  out.set(stopLow[0], stopLow[1], stopLow[2]);
}

/** The two stops a gradient segment needs, reused: this runs per vertex. */
const stopLow: [number, number, number] = [0, 0, 0];
const stopHigh: [number, number, number] = [0, 0, 0];

function writeStop(
  index: number,
  from: SkyColors,
  to: SkyColors,
  t: number,
  out: [number, number, number],
): void {
  const a = index === 0 ? from.horizon : index === 1 ? from.mid : from.zenith;
  const b = index === 0 ? to.horizon : index === 1 ? to.mid : to.zenith;
  out[0] = mix(a.r, b.r, t);
  out[1] = mix(a.g, b.g, t);
  out[2] = mix(a.b, b.b, t);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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
