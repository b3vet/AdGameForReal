/**
 * The spell sheet: every frame of every magical effect, painted once at boot on
 * a 2D canvas (Milestone 3 plan, "Shots look like bullets").
 *
 * Painted rather than shipped, for the same reason the road's cobbles are
 * (`./textures.ts`): the single-file builds have a 12 MB budget and a megabyte
 * of PNG buys nothing a canvas cannot draw. It costs a few milliseconds of boot
 * and nothing per frame afterwards.
 *
 * The layout — the grid, which book lives where, and how a phase becomes a
 * cell — is `./spriteGrid.ts`, and the drawing is `./spritePainters.ts`. This
 * file is the pass that puts the two together and uploads the result, and it
 * re-exports the layout so every view still reads one module.
 */

import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

import { SHEET_SIZE, SPRITE_CELLS } from './spriteGrid';
import type { SpriteBook } from './spriteGrid';
import {
  boltCell,
  burst,
  crystal,
  fireball,
  inCell,
  paintWisp,
  sparkle,
  type Context,
} from './spritePainters';
import { mulberry32 } from '@/sim';

export { bookCell, bookCellLooping, cellRect, SPRITE_CELLS } from './spriteGrid';
export type { CellRect, SpriteBook } from './spriteGrid';

/** Seeded, so every screenshot and every device gets the same flames. */
const SHEET_SEED = 0x5e_11_4f_00;

function context2d(texture: DynamicTexture): Context {
  return texture.getContext() as unknown as Context;
}

/** Paints the whole sheet. One upload, at boot, and never again. */
export function createSpellSheet(scene: Scene): DynamicTexture {
  const texture = new DynamicTexture(
    'spellSheet',
    { width: SHEET_SIZE, height: SHEET_SIZE },
    scene,
    // Mipmaps on: a spell forty metres away is a handful of pixels, and without
    // them the flipbook sparkles with aliasing as it flies.
    true,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  const context = context2d(texture);
  const random = mulberry32(SHEET_SEED);

  context.fillStyle = '#000000';
  context.fillRect(0, 0, SHEET_SIZE, SHEET_SIZE);

  for (let i = 0; i < SPRITE_CELLS.ember.frames; i++) {
    inCell(context, SPRITE_CELLS.ember.at + i, () => {
      fireball(context, i / SPRITE_CELLS.ember.frames, random);
    });
  }
  for (let i = 0; i < SPRITE_CELLS.storm.frames; i++) {
    inCell(context, SPRITE_CELLS.storm.at + i, () => {
      boltCell(context, i / SPRITE_CELLS.storm.frames, random);
    });
  }
  for (let i = 0; i < SPRITE_CELLS.frost.frames; i++) {
    inCell(context, SPRITE_CELLS.frost.at + i, () => {
      crystal(context, i / SPRITE_CELLS.frost.frames, random);
    });
  }

  const impacts: readonly [SpriteBook, 'ember' | 'storm' | 'frost'][] = [
    ['emberImpact', 'ember'],
    ['stormImpact', 'storm'],
    ['frostImpact', 'frost'],
  ];
  for (const [book, kind] of impacts) {
    const spec = SPRITE_CELLS[book];
    for (let i = 0; i < spec.frames; i++) {
      inCell(context, spec.at + i, () => {
        burst(context, kind, i / (spec.frames - 1), random);
      });
    }
  }

  for (let i = 0; i < SPRITE_CELLS.sparkle.frames; i++) {
    inCell(context, SPRITE_CELLS.sparkle.at + i, () => {
      sparkle(context, i / SPRITE_CELLS.sparkle.frames);
    });
  }

  paintWisp(context, random);

  texture.update(true);
  texture.hasAlpha = true;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

