/**
 * The glyph sheet every number in the world is drawn from.
 *
 * One canvas, painted once at boot: the digits, the four operators a gate can
 * print, and the letters the three staff names need. Every label in the scene
 * is then quads cut out of this one texture (`./labels.ts`), which is what lets
 * the whole game's world text be a single draw call with *no* per-frame texture
 * upload — where Milestone 2's Babylon GUI re-painted and re-uploaded a
 * full-screen canvas whenever any number moved.
 *
 * The face is Cinzel (docs/09-milestone-3-plan.md, product-owner answer 3),
 * asked for through `document.fonts` with a short timeout: the UI phase embeds
 * it as a `@font-face`, and until that lands — or on a build where the font
 * never arrives — the canvas falls back to the system serif stack and the
 * numbers are still numbers.
 */

import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

/**
 * Everything the world can print: digits, `+ - x % .`, and the letters of
 * `Ember`, `Storm`, `Frost` and `Staff`. Anything else is skipped at layout
 * time rather than drawn as a blank, so a new gate kind that prints a new word
 * shows up as missing letters here, not as a corrupt sheet.
 */
const GLYPHS = '0123456789+-x%.EmberStormFrostaf';

/** The size the sheet is rasterised at. Labels scale it; they never re-draw it. */
export const ATLAS_FONT_PX = 64;
/** Outline width. Centred by the canvas, so half of it lands outside the ink. */
const OUTLINE_PX = 7;
/** Transparent margin each side of a glyph, so neighbours never bleed. */
const PAD_PX = 4;
/** Cell height: ascender, descender and the outline around both. */
const LINE_PX = Math.round(ATLAS_FONT_PX * 1.4);
/** Where the baseline sits inside a cell. */
const BASELINE_PX = Math.round(ATLAS_FONT_PX * 1.08);
const ATLAS_WIDTH = 512;
/** Enough rows for the glyph set with room to add a word; unused rows are free. */
const MAX_ROWS = 5;

const DISPLAY_FAMILY = 'Cinzel';
const FALLBACK_STACK = 'Georgia, "Times New Roman", serif';
const OUTLINE_COLOR = '#0d1018';
const INK_COLOR = '#ffffff';

/** Long enough for an embedded face to decode, short enough not to hold boot. */
const FONT_TIMEOUT_MS = 600;

/**
 * One glyph's place in the sheet and its size, both in em — multiples of the
 * label's own font size — so a label only has to multiply.
 */
export interface Glyph {
  /** Atlas rect: left edge, *bottom* edge, then the two spans. */
  readonly u: number;
  readonly v: number;
  readonly du: number;
  readonly dv: number;
  /** Quad size in em. Wider than the advance: the cell carries the outline. */
  readonly width: number;
  readonly height: number;
  /** Pen advance in em. */
  readonly advance: number;
}

export class GlyphAtlas {
  readonly texture: DynamicTexture;
  /** True when the real Cinzel face was used rather than the fallback stack. */
  readonly usedDisplayFont: boolean;

  private readonly glyphs = new Map<number, Glyph>();

  constructor(scene: Scene) {
    const probe = measuringContext();
    this.usedDisplayFont = probe !== null && hasDisplayFont(probe);

    const font = `700 ${String(ATLAS_FONT_PX)}px ${DISPLAY_FAMILY}, ${FALLBACK_STACK}`;
    const height = LINE_PX * MAX_ROWS;
    this.texture = new DynamicTexture(
      'glyphAtlas',
      { width: ATLAS_WIDTH, height },
      scene,
      // No mipmaps: labels are drawn at roughly one texel per pixel and a
      // mipmapped sheet bleeds one glyph's outline into the next one's cell.
      false,
      Texture.BILINEAR_SAMPLINGMODE,
    );
    this.texture.hasAlpha = true;
    this.texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.texture.wrapV = Texture.CLAMP_ADDRESSMODE;

    // Babylon's canvas interface carries no `textAlign`/`textBaseline`, so the
    // glyphs are drawn from the left at the default alphabetic baseline and the
    // margins are arithmetic instead.
    const context = this.texture.getContext();
    context.clearRect(0, 0, ATLAS_WIDTH, height);
    context.font = font;
    context.lineWidth = OUTLINE_PX;
    context.lineJoin = 'round';
    context.miterLimit = 2;
    context.strokeStyle = OUTLINE_COLOR;
    context.fillStyle = INK_COLOR;

    let penX = 0;
    let row = 0;
    for (const character of GLYPHS) {
      const code = character.codePointAt(0);
      if (code === undefined || this.glyphs.has(code)) continue;

      const advance = context.measureText(character).width;
      const cell = Math.ceil(advance) + OUTLINE_PX + PAD_PX * 2;
      if (penX + cell > ATLAS_WIDTH) {
        penX = 0;
        row++;
      }
      if (row >= MAX_ROWS) break;

      const top = row * LINE_PX;
      const inkX = penX + PAD_PX + OUTLINE_PX / 2;
      context.strokeText(character, inkX, top + BASELINE_PX);
      context.fillText(character, inkX, top + BASELINE_PX);

      this.glyphs.set(code, {
        u: penX / ATLAS_WIDTH,
        // Babylon uploads a dynamic texture flipped (`update(true)`), so v 0 is
        // the canvas *bottom*: the cell's bottom edge is its far side.
        v: 1 - (top + LINE_PX) / height,
        du: cell / ATLAS_WIDTH,
        dv: LINE_PX / height,
        width: cell / ATLAS_FONT_PX,
        height: LINE_PX / ATLAS_FONT_PX,
        advance: advance / ATLAS_FONT_PX,
      });
      penX += cell;
    }

    // The one and only upload. Everything after this is quads and buffers.
    this.texture.update(true);
  }

  /** The glyph for a character code, or undefined when the sheet has none. */
  get(code: number): Glyph | undefined {
    return this.glyphs.get(code);
  }

  /** How many glyphs the sheet carries; for the boot log and for tests. */
  get size(): number {
    return this.glyphs.size;
  }

  dispose(): void {
    this.texture.dispose();
    this.glyphs.clear();
  }
}

/**
 * Asks the browser for Cinzel and resolves once it is there, or once the
 * timeout is up. Never rejects: a missing face is a look, not a failure.
 */
export async function loadDisplayFont(): Promise<void> {
  const fonts = typeof document === 'undefined' ? undefined : document.fonts;
  if (fonts === undefined) return;
  const request = `700 ${String(ATLAS_FONT_PX)}px ${DISPLAY_FAMILY}`;
  try {
    await Promise.race([
      fonts.load(request),
      new Promise((resolve) => setTimeout(resolve, FONT_TIMEOUT_MS)),
    ]);
  } catch {
    // A family with no `@font-face` rule rejects on some engines; the canvas
    // falls back on its own and the sheet is still drawn.
  }
}

/** A throwaway 2D context, only for the font probe below. */
function measuringContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  return canvas.getContext('2d');
}

/**
 * Whether the real face is installed, by measuring the same string twice: once
 * in a generic the browser certainly has, and once in Cinzel *falling back to*
 * that same generic. Identical widths mean the fallback answered, so Cinzel is
 * not there. `document.fonts.check` cannot say this — it reports on
 * `@font-face` rules and returns true for any family it has never heard of.
 */
function hasDisplayFont(context: CanvasRenderingContext2D): boolean {
  const probe = 'Ember 0123';
  context.font = `700 ${String(ATLAS_FONT_PX)}px monospace`;
  const generic = context.measureText(probe).width;
  context.font = `700 ${String(ATLAS_FONT_PX)}px ${DISPLAY_FAMILY}, monospace`;
  return Math.abs(context.measureText(probe).width - generic) > 0.5;
}
