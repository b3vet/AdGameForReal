/**
 * Textures drawn in code rather than shipped as files.
 *
 * Two of them: the road's stone tile and the sky's dusk gradient. Both are
 * small `DynamicTexture`s painted once at init with the 2D canvas API, which
 * costs a few milliseconds of boot and nothing at all afterwards, and keeps the
 * single-file build (12 MB budget) free of image bytes.
 *
 * The stone tile is drawn to wrap: every cobble near an edge is painted again
 * on the opposite side, so the road has no visible seam where the tile repeats.
 */

import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

import { mulberry32 } from '@/sim';

const STONE_SIZE = 256;
const SKY_HEIGHT = 256;

/** Seeded, so the road looks the same in every screenshot and on every device. */
const STONE_SEED = 0x5a17_1000;

export interface StoneOptions {
  /** Cobbles per tile. */
  count?: number;
  /** Base grey, 0 to 1. */
  base?: number;
  /** How far a cobble's grey may wander from the base. */
  variance?: number;
  /** A cool blue lift on the darks, so the road is not a neutral grey. */
  cool?: number;
}

/**
 * A dark, desaturated cobbled tile. Multiplied over the road's own colour, so
 * the palette lives in `theme.ts` and this only carries the pattern.
 */
export function createStoneTexture(scene: Scene, options: StoneOptions = {}): DynamicTexture {
  const count = options.count ?? 320;
  const base = options.base ?? 0.62;
  const variance = options.variance ?? 0.22;
  const cool = options.cool ?? 0.06;

  const texture = new DynamicTexture(
    'stoneTile',
    { width: STONE_SIZE, height: STONE_SIZE },
    scene,
    true,
  );
  const context = texture.getContext();
  const random = mulberry32(STONE_SEED);

  context.fillStyle = grey(base * 0.72, cool);
  context.fillRect(0, 0, STONE_SIZE, STONE_SIZE);

  for (let i = 0; i < count; i++) {
    const x = random() * STONE_SIZE;
    const y = random() * STONE_SIZE;
    const w = 10 + random() * 26;
    const h = 8 + random() * 20;
    const shade = base + (random() - 0.5) * 2 * variance;
    context.fillStyle = grey(shade, cool);
    // Painted four times where it straddles an edge, which is what makes the
    // tile seamless: the road repeats it every two metres.
    for (const dx of [0, -STONE_SIZE, STONE_SIZE]) {
      for (const dy of [0, -STONE_SIZE, STONE_SIZE]) {
        if (x + dx > STONE_SIZE || x + dx + w < 0) continue;
        if (y + dy > STONE_SIZE || y + dy + h < 0) continue;
        context.fillRect(x + dx, y + dy, w, h);
      }
    }
  }

  // Grit: single-pixel speckle over the whole tile, which is what stops the
  // cobbles reading as flat rectangles at this size.
  for (let i = 0; i < STONE_SIZE * 12; i++) {
    const shade = base + (random() - 0.5) * 0.5;
    context.fillStyle = grey(shade, cool);
    context.fillRect(random() * STONE_SIZE, random() * STONE_SIZE, 1, 1);
  }

  texture.update(false);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.hasAlpha = false;
  return texture;
}

export interface GradientStop {
  /** 0 at the horizon, 1 at the zenith. */
  at: number;
  r: number;
  g: number;
  b: number;
}

/**
 * A vertical gradient for the sky dome, painted bottom (horizon) to top
 * (zenith). Sampled by a back-faced sphere's own v coordinate, so no shader.
 */
export function createGradientTexture(
  scene: Scene,
  name: string,
  stops: readonly GradientStop[],
): DynamicTexture {
  const texture = new DynamicTexture(name, { width: 4, height: SKY_HEIGHT }, scene, false);
  const context = texture.getContext();
  const gradient = context.createLinearGradient(0, SKY_HEIGHT, 0, 0);
  for (const stop of stops) {
    gradient.addColorStop(clamp01(stop.at), rgb(stop.r, stop.g, stop.b));
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, 4, SKY_HEIGHT);
  texture.update(false);
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

function grey(shade: number, cool: number): string {
  const v = clamp01(shade);
  return rgb(v * (1 - cool), v * (1 - cool * 0.4), v);
}

function rgb(r: number, g: number, b: number): string {
  const byte = (value: number): number => Math.round(clamp01(value) * 255);
  return `rgb(${String(byte(r))},${String(byte(g))},${String(byte(b))})`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
