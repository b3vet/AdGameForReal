/**
 * Two corner shapes in the overlay, and no third (docs/28, note 12).
 *
 * The kit's frames are cut square, so the owner's reading of a rounded pill
 * inside one — the streak plaque, the range tabs, the result badges — was that
 * it was wrong. Every `border-radius` in a stylesheet now names one of the two
 * tokens in `../tokens.css`, which is what keeps a literal radius from
 * creeping back in, and `--round` is held to the few things that are round by
 * nature: the sound and pause buttons, the milestone rivet and a tint swatch.
 *
 * The debug panel is a developer's readout rather than the game's furniture,
 * so it keeps its own softer blocks and is left out.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const UI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TOKENS = new Set(['var(--corner)', 'var(--round)']);
const EXEMPT = new Set(['debug.css', 'palette.css']);

/** The selectors allowed to be round, whitespace collapsed. */
const ROUND = new Set([
  '.mute, .pause',
  ".picker__level[data-milestone='true'] .picker__marks::before",
  '.tint__swatch',
]);

interface Radius {
  selector: string;
  value: string;
}

/** Every radius declaration in a sheet, with the selector of its rule. */
function radii(css: string): Radius[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Radius[] = [];
  for (const match of text.matchAll(/border(?:-[a-z]+)*-radius\s*:\s*([^;]+);/g)) {
    const at = match.index;
    const open = text.lastIndexOf('{', at);
    const before = Math.max(text.lastIndexOf('}', open), text.lastIndexOf('{', open - 1));
    const selector = text
      .slice(before + 1, open)
      .replace(/\s+/g, ' ')
      .trim();
    out.push({ selector, value: (match[1] ?? '').trim() });
  }
  return out;
}

describe('corner tokens', () => {
  it('square is the default and round is a circle', () => {
    const tokens = readFileSync(path.join(UI_DIR, 'tokens.css'), 'utf8');
    expect(tokens).toMatch(/--corner:\s*0;/);
    expect(tokens).toMatch(/--round:\s*999px;/);
  });

  const sheets = readdirSync(UI_DIR).filter(
    (file) => file.endsWith('.css') && !EXEMPT.has(file),
  );

  it('are read from more than a handful of sheets', () => {
    expect(sheets.length).toBeGreaterThan(8);
  });

  // Square everywhere else follows: a radius that is a token and not `--round`
  // is `--corner`, which is 0.
  for (const sheet of sheets) {
    it(`${sheet} names a token for every radius, and is round only where allowed`, () => {
      const found = radii(readFileSync(path.join(UI_DIR, sheet), 'utf8'));
      expect(found.filter((radius) => !TOKENS.has(radius.value))).toEqual([]);
      const round = found.filter((radius) => radius.value === 'var(--round)');
      expect(round.filter((radius) => !ROUND.has(radius.selector))).toEqual([]);
    });
  }

  it('finds the streak plaque, so the parser is reading real rules', () => {
    const board = radii(readFileSync(path.join(UI_DIR, 'board.css'), 'utf8'));
    expect(board.find((radius) => radius.selector === '.streak')?.value).toBe('var(--corner)');
  });
});
