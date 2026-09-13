/**
 * Two rules about colour in the overlay (decision D36).
 *
 * 1. `src/ui/palette.css` is generated from `src/data/palette.json`. It is
 *    checked in so the build stays one step, which is only safe if something
 *    fails when the two drift — this is that something. The first test runs the
 *    generator's own `--check`, so what is verified is the command a human
 *    would run, not a copy of its logic; the second walks the JSON here, in a
 *    separate implementation, so a bug in the generator cannot agree with
 *    itself.
 * 2. Every other stylesheet in `src/ui` builds its colours out of those
 *    variables. A literal colour anywhere else is one the palette does not know
 *    about and the renderer can never match.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const UI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(UI_DIR, '..', '..');
const GENERATOR = path.join(ROOT, 'scripts', 'palette-css.mjs');
const PALETTE_FILE = path.join(ROOT, 'src', 'data', 'palette.json');
const CSS_FILE = path.join(UI_DIR, 'palette.css');

/**
 * `#` starts a lot of things in CSS that are not colours — `#hud-count`,
 * `#debug-panel` — so a match has to be hex all the way to a character that
 * cannot continue an identifier.
 */
const HEX_COLOUR = /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])/g;

/** `{ gold: { base: '#f2b33d' } }` as `[['gold-base', '#f2b33d']]`. */
function flatten(value: unknown, prefix: readonly string[] = []): [string, string][] {
  if (typeof value !== 'object' || value === null) return [];
  const out: [string, string][] = [];
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('$')) continue;
    const next = [...prefix, key];
    if (typeof child === 'string') out.push([next.join('-'), child]);
    else out.push(...flatten(child, next));
  }
  return out;
}

describe('palette.css', () => {
  it('is what the generator would write from palette.json', () => {
    expect(() => execFileSync(process.execPath, [GENERATOR, '--check'])).not.toThrow();
  });

  it('declares one variable per leaf of the palette and nothing else', () => {
    const leaves = flatten(JSON.parse(readFileSync(PALETTE_FILE, 'utf8')));
    const css = readFileSync(CSS_FILE, 'utf8');
    expect(leaves.length).toBeGreaterThan(20);
    for (const [name, hex] of leaves) {
      expect(css).toContain(`--c-${name}: ${hex};`);
    }
    expect(css.match(/^\s*--c-/gm)?.length ?? 0).toBe(leaves.length);
  });
});

describe('the overlay stylesheets', () => {
  const sheets = readdirSync(UI_DIR).filter((file) => file.endsWith('.css'));

  it('are more than a handful, so this test is looking at something', () => {
    expect(sheets.length).toBeGreaterThan(3);
  });

  for (const sheet of sheets) {
    if (sheet === 'palette.css') continue;
    it(`${sheet} has no literal colour`, () => {
      const css = readFileSync(path.join(UI_DIR, sheet), 'utf8');
      expect(css.match(HEX_COLOUR) ?? []).toEqual([]);
      // `rgb()`/`hsl()` with numbers in it is the same sin in another notation;
      // `color-mix(in srgb, var(--c-...) 40%, transparent)` is the way to a
      // translucent palette colour.
      expect(css.match(/\b(?:rgba?|hsla?)\(\s*[0-9]/g) ?? []).toEqual([]);
    });
  }
});
