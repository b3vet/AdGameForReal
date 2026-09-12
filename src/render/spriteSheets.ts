/**
 * The spell sheet: every frame of every magical effect, painted once at boot on
 * a 2D canvas (Milestone 3 plan, "Shots look like bullets").
 *
 * One 1024x1024 texture, an eight-by-eight grid of 128 px cells, holding six
 * flipbooks and a sparkle:
 *
 *   cells  0..11   ember  — a fireball with a flame licking off its back
 *   cells 12..23   storm  — a crackling zigzag bolt
 *   cells 24..35   frost  — a spinning ice crystal trailing mist
 *   cells 36..43   ember impact, 44..51 storm impact, 52..59 frost impact
 *   cells 60..63   sparkle, the trail's twinkle
 *
 * Painted rather than shipped, for the same reason the road's cobbles are
 * (`./textures.ts`): the single-file builds have a 12 MB budget and a megabyte
 * of PNG buys nothing a canvas cannot draw. It costs a few milliseconds of boot
 * and nothing per frame afterwards.
 *
 * Everything is drawn white-hot in the middle fading to its own hue at the
 * edge, on black. The sprites are additive (`./sprites.ts`) and carry a
 * per-instance tint, so the sheet only has to hold *shape and falloff*: the
 * ember, storm and frost cells differ in silhouette and motion, not in colour.
 */

import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

import { mulberry32 } from '@/sim';

/** The sheet, and the grid it is cut into. */
const SHEET_SIZE = 1024;
const GRID = 8;
const CELL = SHEET_SIZE / GRID;

/** Seeded, so every screenshot and every device gets the same flames. */
const SHEET_SEED = 0x5e_11_4f_00;

/** Where each flipbook starts in the grid, and how many frames it runs for. */
export const SPRITE_CELLS = {
  ember: { at: 0, frames: 12 },
  storm: { at: 12, frames: 12 },
  frost: { at: 24, frames: 12 },
  emberImpact: { at: 36, frames: 8 },
  stormImpact: { at: 44, frames: 8 },
  frostImpact: { at: 52, frames: 8 },
  sparkle: { at: 60, frames: 4 },
} as const;

export type SpriteBook = keyof typeof SPRITE_CELLS;

/** One cell's uv rect, so `sprites.ts` can hand it straight to an instance. */
export interface CellRect {
  u: number;
  v: number;
  du: number;
  dv: number;
}

/**
 * The uv rect of cell `index`. Babylon uploads a dynamic texture flipped
 * (`update(true)`), so v 0 is the canvas *bottom* and a cell's v is measured
 * from its far side — the same rule the glyph atlas follows.
 */
export function cellRect(index: number, out: CellRect): CellRect {
  const column = index % GRID;
  const row = Math.floor(index / GRID);
  out.u = column / GRID;
  out.v = 1 - (row + 1) / GRID;
  out.du = 1 / GRID;
  out.dv = 1 / GRID;
  return out;
}

/**
 * The cell a flipbook shows at `phase` (0 to 1 through the book). Clamped, not
 * wrapped: a one-shot burst that overruns holds its last frame rather than
 * starting again, which is the bug that made Milestone 2's block deaths play
 * twice (docs/ASSETS.md, open issue 4).
 */
export function bookCell(book: SpriteBook, phase: number): number {
  const { at, frames } = SPRITE_CELLS[book];
  const index = Math.floor(phase * frames);
  return at + Math.max(0, Math.min(frames - 1, index));
}

/** The same, wrapped: for a projectile, whose flipbook loops while it flies. */
export function bookCellLooping(book: SpriteBook, phase: number): number {
  const { at, frames } = SPRITE_CELLS[book];
  const index = Math.floor(phase * frames) % frames;
  return at + (index < 0 ? index + frames : index);
}

/**
 * The 2D context the sheet is painted with.
 *
 * Babylon types `getContext()` as its own `ICanvasRenderingContext`, which is
 * the subset it needs and carries neither `lineCap` nor
 * `globalCompositeOperation`. Both are standard on every browser canvas and
 * both are load-bearing here — the flipbooks are built out of round-capped
 * strokes added on top of each other — so the context is narrowed once, here,
 * rather than at eight call sites.
 */
type Context = CanvasRenderingContext2D;

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

  texture.update(true);
  texture.hasAlpha = true;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

/**
 * Runs `draw` with the origin at the centre of cell `index` and the unit square
 * scaled to the cell, so every painter below works in -1..1 and never has to
 * know where in the sheet it landed.
 */
function inCell(context: Context, index: number, draw: () => void): void {
  const column = index % GRID;
  const row = Math.floor(index / GRID);
  context.save();
  context.translate(column * CELL + CELL / 2, row * CELL + CELL / 2);
  context.scale(CELL / 2, CELL / 2);
  // Everything is drawn on black and blended additively on the GPU, so
  // overlapping strokes inside a cell should add here too.
  context.globalCompositeOperation = 'lighter';
  draw();
  context.restore();
  context.globalCompositeOperation = 'source-over';
}

/** A soft radial blob: white core, hue at the rim, nothing at the edge. */
function glow(
  context: Context,
  x: number,
  y: number,
  radius: number,
  rim: string,
  strength = 1,
): void {
  if (radius <= 0) return;
  // A *small* white core. The sprites are additive and they overlap — a volley
  // is four hundred of them — so a wide white centre stacks into paper white
  // and every staff ends up looking the same.
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(255,255,255,${String(strength)})`);
  gradient.addColorStop(0.16, rim.replace('ALPHA', String(strength * 0.95)));
  gradient.addColorStop(1, rim.replace('ALPHA', '0'));
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
}

const EMBER_RIM = 'rgba(255,135,25,ALPHA)';
const STORM_RIM = 'rgba(140,80,255,ALPHA)';
const FROST_RIM = 'rgba(90,205,255,ALPHA)';

/**
 * Ember: a round core with a flame licking off the back of it. The lick is
 * three teardrops whose length and sideways lean cycle over the book, so a
 * fireball in flight looks like it is burning rather than spinning.
 */
function fireball(context: Context, phase: number, random: () => number): void {
  const wobble = Math.sin(phase * Math.PI * 2);
  const flicker = 0.86 + 0.14 * Math.sin(phase * Math.PI * 4);

  // The tail first, so the core sits on top of it.
  for (let i = 0; i < 3; i++) {
    const spread = (i - 1) * 0.22;
    const reach = 0.5 + 0.35 * Math.abs(Math.sin(phase * Math.PI * 2 + i));
    for (let s = 0; s < 5; s++) {
      const t = s / 4;
      glow(
        context,
        spread * t + wobble * 0.12 * t,
        -0.15 - reach * t,
        0.3 * (1 - t * 0.75),
        EMBER_RIM,
        0.42 * (1 - t) * flicker,
      );
    }
  }

  glow(context, 0, 0.16, 0.62 * flicker, EMBER_RIM, 1);
  // Embers thrown off the core, seeded so they sit still across a re-bake but
  // move from frame to frame.
  for (let i = 0; i < 4; i++) {
    const angle = random() * Math.PI * 2;
    const distance = 0.45 + random() * 0.35;
    glow(
      context,
      Math.cos(angle) * distance,
      Math.sin(angle) * distance * 0.7,
      0.07 + random() * 0.05,
      EMBER_RIM,
      0.6,
    );
  }
}

/**
 * Storm: a zigzag of light down the cell, re-broken every frame, with a bead of
 * charge at the head. The seed is per-frame on purpose — a bolt whose kinks
 * stayed put between frames would read as a solid painted shape.
 */
function boltCell(context: Context, phase: number, random: () => number): void {
  const segments = 7;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  for (const [width, color, alpha] of [
    [0.3, 'rgba(110,50,255,ALPHA)', 0.55],
    [0.1, 'rgba(190,150,255,ALPHA)', 0.9],
  ] as const) {
    context.strokeStyle = color.replace('ALPHA', String(alpha));
    context.lineWidth = width;
    context.beginPath();
    context.moveTo(0, -0.92);
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const kink = (random() - 0.5) * 0.62 * Math.sin(t * Math.PI);
      context.lineTo(kink, -0.92 + t * 1.84);
    }
    context.stroke();
  }

  // A bead of charge at the head, not a lamp: this used to be half the cell
  // wide, and at that size the zigzag behind it never read at all.
  const head = 0.3 + 0.12 * Math.sin(phase * Math.PI * 2);
  glow(context, 0, 0.68, head, STORM_RIM, 1);
  // Two short forks off the shaft, so the bolt crackles rather than bends.
  for (let i = 0; i < 2; i++) {
    const y = -0.4 + i * 0.7;
    context.strokeStyle = 'rgba(165,110,255,0.8)';
    context.lineWidth = 0.05;
    context.beginPath();
    context.moveTo((random() - 0.5) * 0.2, y);
    context.lineTo((random() - 0.5) * 0.9, y + 0.3);
    context.stroke();
  }
}

/**
 * Frost: a six-pointed crystal turning a sixth of a revolution over the book,
 * so the loop is seamless, inside a puff of mist.
 */
function crystal(context: Context, phase: number, random: () => number): void {
  const spin = phase * (Math.PI / 3);

  for (let i = 0; i < 5; i++) {
    const angle = random() * Math.PI * 2;
    const distance = 0.35 + random() * 0.55;
    glow(
      context,
      Math.cos(angle) * distance,
      Math.sin(angle) * distance,
      0.28 + random() * 0.16,
      FROST_RIM,
      0.24,
    );
  }

  context.save();
  context.rotate(spin);
  context.strokeStyle = 'rgba(150,235,255,0.95)';
  context.lineCap = 'round';
  for (let arm = 0; arm < 6; arm++) {
    const angle = (arm / 6) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    context.lineWidth = 0.12;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(dx * 0.85, dy * 0.85);
    context.stroke();
    // The barbs that make a snowflake a snowflake rather than an asterisk.
    context.lineWidth = 0.07;
    for (const at of [0.42, 0.64]) {
      for (const side of [-1, 1]) {
        const branch = angle + side * 0.7;
        context.beginPath();
        context.moveTo(dx * at, dy * at);
        context.lineTo(dx * at + Math.cos(branch) * 0.26, dy * at + Math.sin(branch) * 0.26);
        context.stroke();
      }
    }
  }
  context.restore();

  glow(context, 0, 0, 0.4, FROST_RIM, 1);
}

/**
 * An impact: a flash that expands and thins over the book. Ember blooms into a
 * ball of fire, storm throws crossed sparks, frost throws shards.
 */
function burst(
  context: Context,
  kind: 'ember' | 'storm' | 'frost',
  phase: number,
  random: () => number,
): void {
  const rim = kind === 'ember' ? EMBER_RIM : kind === 'storm' ? STORM_RIM : FROST_RIM;
  // Out fast, then out of existence — the same curve the meshes used to grow on.
  const size = Math.sin(Math.min(1, phase) * Math.PI) ** 0.55;
  const fade = 1 - phase * 0.85;
  if (size <= 0.01) return;

  glow(context, 0, 0, 0.55 * size + 0.12, rim, fade);

  const spokes = kind === 'ember' ? 0 : kind === 'storm' ? 6 : 8;
  context.lineCap = 'round';
  context.strokeStyle = rim.replace('ALPHA', String(fade * 0.9));
  for (let i = 0; i < spokes; i++) {
    const angle = (i / spokes) * Math.PI * 2 + (kind === 'frost' ? 0.4 : 0);
    const inner = 0.15 + 0.35 * phase;
    const outer = inner + (kind === 'storm' ? 0.75 : 0.45) * (0.4 + 0.6 * phase);
    context.lineWidth = (kind === 'storm' ? 0.07 : 0.12) * (1 - phase * 0.6);
    context.beginPath();
    context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    context.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
    context.stroke();
  }

  if (kind === 'ember') {
    for (let i = 0; i < 6; i++) {
      const angle = random() * Math.PI * 2;
      const distance = (0.3 + random() * 0.5) * (0.4 + phase);
      glow(
        context,
        Math.cos(angle) * distance,
        Math.sin(angle) * distance,
        0.13 * (1 - phase * 0.5),
        rim,
        fade * 0.8,
      );
    }
  }
}

/**
 * A twinkle: a soft dot with a four-point star through it, breathing.
 *
 * Deliberately faint. It is drawn hundreds of times a second behind the volley
 * and it is additive, so a bright one paves the road behind the squad in white.
 */
function sparkle(context: Context, phase: number): void {
  const size = 0.55 + 0.35 * Math.sin(phase * Math.PI * 2);
  glow(context, 0, 0, 0.45 * size, 'rgba(255,230,180,ALPHA)', 0.8);
  context.strokeStyle = 'rgba(255,250,235,0.5)';
  context.lineCap = 'round';
  context.lineWidth = 0.06;
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
  ] as const) {
    context.beginPath();
    context.moveTo(-dx * size, -dy * size);
    context.lineTo(dx * size, dy * size);
    context.stroke();
  }
}
