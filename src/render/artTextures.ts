/**
 * The textures Milestone 5's road, gates and motes are painted with.
 *
 * Two kinds live here. The two *photographic* albedos — the ambientCG paving
 * stones and grass (CC0, `docs/ASSETS.md`) — are loaded from the manifest, and
 * everything else is drawn in code on a 2D canvas exactly as `./textures.ts`
 * draws the stone tile and the sky gradient: a gradient, a mask or a plaque
 * face is a few hundred bytes of drawing commands and would be a hundred
 * kilobytes of PNG, and the single-file builds have a 12 MB budget (D25).
 *
 * Every loader here is fail-soft, because a build whose `/assets/` never
 * arrived must still be playable: a missing albedo falls back to the procedural
 * stone tile rather than leaving an untextured white road.
 */

import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';

import { resolveAssetUrl } from './characters';
import { createStoneTexture } from './textures';
import { paletteHex } from './theme';
import { mulberry32 } from '@/sim';

/** Seeded, so the runes and tufts are the same in every screenshot. */
const PAINT_SEED = 0x9e_37_79_b1;

/**
 * The gate shimmer's vertical profile, bottom of the texture to top: nothing at
 * either end, brightest a third of the way in. Both the gradient and the
 * streaks painted over it are scaled by this, so the veil ends where the arch
 * does.
 */
const VEIL: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.3, 0.55],
  [0.75, 0.3],
  [1, 0],
];

/** The veil's alpha at `v`, linearly between the stops above. */
function veilAt(v: number): number {
  let previous = VEIL[0] ?? ([0, 0] as const);
  for (const stop of VEIL) {
    if (v <= stop[0]) {
      const span = stop[0] - previous[0];
      const t = span <= 0 ? 0 : (v - previous[0]) / span;
      return previous[1] + (stop[1] - previous[1]) * t;
    }
    previous = stop;
  }
  return previous[1];
}

/**
 * Hands `material` a tiled albedo from the manifest, and the procedural stone
 * tile instead if that file cannot be loaded.
 *
 * The swap happens in Babylon's `onError`, so a failed fetch costs one frame of
 * flat colour rather than the whole road.
 */
export function tiledAlbedo(
  scene: Scene,
  material: StandardMaterial,
  assetId: string,
  uScale: number,
  vScale: number,
): Texture {
  const texture = new Texture(resolveAssetUrl(assetId), scene, {
    // Mipmaps on, trilinear: the road runs to the horizon and the far half of it
    // is a handful of texels per metre.
    samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
    onError: () => {
      console.warn(`[render] texture "${assetId}" failed to load; drawing the painted tile`);
      const fallback = createStoneTexture(scene, { base: 0.86, variance: 0.12, cool: -0.04 });
      fallback.uScale = uScale;
      fallback.vScale = vScale;
      material.diffuseTexture = fallback;
    },
  });
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.uScale = uScale;
  texture.vScale = vScale;
  material.diffuseTexture = texture;
  return texture;
}

/**
 * A one-dimensional alpha ramp across a ground strip's width, as an opacity
 * texture: `stops` are `[u, alpha]` pairs from the strip's inner edge out.
 *
 * Four texels wide, because nothing varies along the strip's length; the
 * hardware's own filtering is what makes the ramp smooth.
 */
export function createBandOpacity(
  scene: Scene,
  name: string,
  stops: readonly (readonly [number, number])[],
): DynamicTexture {
  const width = 128;
  const texture = new DynamicTexture(name, { width, height: 4 }, scene, false);
  const context = texture.getContext();
  const gradient = context.createLinearGradient(0, 0, width, 0);
  for (const [at, alpha] of stops) {
    gradient.addColorStop(clamp01(at), `rgba(255,255,255,${String(clamp01(alpha))})`);
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, 4);
  texture.update(false);
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.hasAlpha = true;
  return texture;
}

/**
 * The rune plaque a gate's number is printed on: a dark slate with a bevelled
 * rim and a scatter of faint carved marks.
 *
 * The marks matter more than they look. The plaque is the darkest thing in the
 * frame and the number sits on it in near-white, so a flat black rectangle
 * reads as a hole; the carving is what makes it stone the number is cut into.
 */
export function createPlaqueTexture(scene: Scene): DynamicTexture {
  const size = 256;
  const texture = new DynamicTexture('gatePlaque', { width: size, height: size }, scene, true);
  const context = texture.getContext();
  const random = mulberry32(PAINT_SEED ^ 0x51);

  context.fillStyle = paletteHex('ink.base');
  context.fillRect(0, 0, size, size);

  // The bevel: a lighter rim on the top and left, a darker one below and right.
  const rim = size * 0.07;
  context.fillStyle = paletteHex('ink.soft');
  context.fillRect(0, 0, size, rim);
  context.fillRect(0, 0, rim, size);
  context.fillStyle = paletteHex('arcane.deep');
  context.fillRect(0, size - rim, size, rim);
  context.fillRect(size - rim, 0, rim, size);

  // A carved inner line, and the marks inside it.
  context.strokeStyle = paletteHex('arcane.base');
  context.lineWidth = size * 0.016;
  context.globalAlpha = 0.55;
  context.strokeRect(rim * 1.6, rim * 1.6, size - rim * 3.2, size - rim * 3.2);
  context.globalAlpha = 0.22;
  for (let i = 0; i < 18; i++) {
    const x = rim * 2.4 + random() * (size - rim * 4.8);
    const y = rim * 2.4 + random() * (size - rim * 4.8);
    const length = size * (0.04 + random() * 0.09);
    context.beginPath();
    context.moveTo(x, y);
    if (random() < 0.5) context.lineTo(x + length, y);
    else context.lineTo(x, y + length);
    context.stroke();
  }
  context.globalAlpha = 1;

  texture.update(false);
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

/**
 * The shimmer that fills a gate's arch: a veil of light with runes drifting in
 * it, painted white on black and tinted per instance by the gate's kind
 * (`./tintedQuads.ts`).
 *
 * It tiles *horizontally* and fades out at the top and the bottom. That is the
 * opposite of the obvious arrangement and it is deliberate: the quad scrolls
 * sideways through the pattern, so the axis it scrolls along has to wrap, while
 * the axis it does not scroll along is where the veil has to end — a shimmer
 * with a hard top edge is a lit rectangle hanging in an arch, which is exactly
 * what the first build of this looked like. The left and right edges need no
 * fade of their own: the arch's legs stand in front of them.
 */
export function createShimmerTexture(scene: Scene): DynamicTexture {
  const size = 256;
  const texture = new DynamicTexture('gateShimmer', { width: size, height: size }, scene, true);
  const context = texture.getContext();
  const random = mulberry32(PAINT_SEED ^ 0xa7);

  context.fillStyle = '#000000';
  context.fillRect(0, 0, size, size);

  // The veil: brightest a third of the way up, nothing at either end, so the
  // light sits *in* the arch rather than filling a rectangle.
  const veil = context.createLinearGradient(0, 0, 0, size);
  for (const [at, alpha] of VEIL) {
    veil.addColorStop(at, `rgba(255,255,255,${String(alpha)})`);
  }
  context.fillStyle = veil;
  context.fillRect(0, 0, size, size);

  // Vertical streaks, wrapped across the tile: each is drawn again one tile
  // left and right, so a streak that leaves one edge arrives at the other.
  // Their own alpha is scaled by the veil at their height rather than masked
  // afterwards — the canvas interface Babylon exposes has no compositing ops.
  for (let i = 0; i < 26; i++) {
    const x = random() * size;
    const y = size * (0.1 + random() * 0.6);
    const length = size * (0.12 + random() * 0.3);
    const fade = (0.3 + random() * 0.6) * veilAt((y + length / 2) / size);
    context.strokeStyle = `rgba(255,255,255,${String(fade.toFixed(3))})`;
    context.lineWidth = 1 + random() * 3;
    for (const offset of [-size, 0, size]) {
      context.beginPath();
      context.moveTo(x + offset, y);
      context.lineTo(x + offset + (random() - 0.5) * 6, y + length);
      context.stroke();
    }
  }

  // A few rune sparks riding the veil.
  for (let i = 0; i < 14; i++) {
    const x = random() * size;
    const y = size * (0.15 + random() * 0.7);
    const radius = size * (0.008 + random() * 0.018);
    const bright = 0.9 * veilAt(y / size);
    for (const offset of [-size, 0, size]) {
      const glow = context.createRadialGradient(x + offset, y, 0, x + offset, y, radius * 4);
      glow.addColorStop(0, `rgba(255,255,255,${String(bright.toFixed(3))})`);
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = glow;
      context.beginPath();
      context.arc(x + offset, y, radius * 4, 0, Math.PI * 2);
      context.fill();
    }
  }

  texture.update(false);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.hasAlpha = true;
  return texture;
}

/** A soft round speck: the ambient motes, and anything else that wants a blob. */
export function createMoteTexture(scene: Scene): DynamicTexture {
  const size = 64;
  const texture = new DynamicTexture('ambientMote', { width: size, height: size }, scene, true);
  const context = texture.getContext();
  context.fillStyle = '#000000';
  context.fillRect(0, 0, size, size);
  const glow = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, size, size);
  texture.update(false);
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.hasAlpha = true;
  return texture;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
