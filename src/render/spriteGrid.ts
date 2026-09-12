/**
 * The spell sheet's layout: the grid it is cut into, which book lives where,
 * and how a phase becomes a cell.
 *
 * Split out of `./spriteSheets.ts` in Milestone 4 so the painters
 * (`./spritePainters.ts`) and the sheet builder can both read it without
 * importing each other. Nothing here draws; nothing here touches Babylon.
 *
 * One 1024x1024 texture, a nine-by-nine grid of 114 px cells, holding six
 * flipbooks, a sparkle and the wisp's four books:
 *
 *   cells  0..11   ember  — a fireball with a flame licking off its back
 *   cells 12..23   storm  — a crackling zigzag bolt
 *   cells 24..35   frost  — a spinning ice crystal trailing mist
 *   cells 36..43   ember impact, 44..51 storm impact, 52..59 frost impact
 *   cells 60..63   sparkle, the trail's twinkle
 *   cells 64..78   wisp   — orb, tier ring, spark, spark impact (D33)
 *
 * Nine columns rather than Milestone 3's eight: the wisp needed a book of its
 * own and the eight-by-eight grid was exactly full. Nine squares is 81 cells on
 * the same texture — same upload, same GPU memory, no power-of-two risk — at
 * 114 px a cell instead of 128. Every painter works in a normalised -1..1
 * square, so the cell size is a free parameter; a spell is about 40 px on
 * screen, so 114 is still oversampled.
 */

export const SHEET_SIZE = 1024;
export const GRID = 9;
export const CELL = SHEET_SIZE / GRID;

/** Where each flipbook starts in the grid, and how many frames it runs for. */
export const SPRITE_CELLS = {
  ember: { at: 0, frames: 12 },
  storm: { at: 12, frames: 12 },
  frost: { at: 24, frames: 12 },
  emberImpact: { at: 36, frames: 8 },
  stormImpact: { at: 44, frames: 8 },
  frostImpact: { at: 52, frames: 8 },
  sparkle: { at: 60, frames: 4 },
  /** The wisp (D33): its orb, the rings that count its tier, its spark and the
   *  flash that spark lands with. Cells 64 to 78; 79 and 80 are spare. */
  wispCore: { at: 64, frames: 4 },
  wispRing: { at: 68, frames: 3 },
  wispSpark: { at: 71, frames: 4 },
  wispBurst: { at: 75, frames: 4 },
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
