/**
 * Generates `src/ui/palette.css` from `src/data/palette.json` (decision D36).
 *
 * The palette is the single source of colour for the whole game: the renderer
 * reads the JSON directly and the overlay reads it as CSS custom properties.
 * This is the bridge — one `--c-<role>-<shade>` per leaf of the JSON, with
 * nested keys flattened by `-`:
 *
 *   arcane.base        -> --c-arcane-base
 *   spell.ember.core   -> --c-spell-ember-core
 *   gate.add           -> --c-gate-add
 *
 * The output is checked in rather than generated during the build, so `npm run
 * dev`, `npm run build` and every single-file build stay one step each and the
 * stylesheet is readable in the repo. `src/ui/__tests__/palette.test.ts` fails
 * if the checked-in file and the JSON have drifted, which is what makes the
 * checked-in copy safe.
 *
 *   node scripts/palette-css.mjs        # rewrite src/ui/palette.css
 *   node scripts/palette-css.mjs --check # exit 1 if it is stale
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PALETTE_FILE = path.join(ROOT, 'src', 'data', 'palette.json');
export const CSS_FILE = path.join(ROOT, 'src', 'ui', 'palette.css');

const HEADER = `/*
 * GENERATED FILE — do not edit. Run \`node scripts/palette-css.mjs\` after
 * changing src/data/palette.json; src/ui/__tests__/palette.test.ts fails if
 * this file and the JSON disagree.
 *
 * One custom property per leaf of the palette (decision D36), nested keys
 * flattened with a dash: \`spell.ember.core\` is \`--c-spell-ember-core\`. These
 * are the only literal colours the overlay's CSS is allowed to contain; every
 * other stylesheet builds what it needs out of them.
 */`;

/** Leaves of the palette as `[name, hex]`, in the JSON's own order. */
export function flatten(palette, prefix = []) {
  const out = [];
  for (const [key, value] of Object.entries(palette)) {
    // `$comment` is documentation for the humans reading the JSON.
    if (key.startsWith('$')) continue;
    const next = [...prefix, key];
    if (typeof value === 'string') out.push([next.join('-'), value]);
    else if (value !== null && typeof value === 'object') out.push(...flatten(value, next));
    else throw new Error(`palette: ${next.join('.')} is neither a colour nor a group`);
  }
  return out;
}

/** The whole stylesheet, as it is written to disk. */
export function renderPaletteCss(palette) {
  const lines = flatten(palette).map(([name, hex]) => `  --c-${name}: ${hex};`);
  return `${HEADER}\n\n:root {\n${lines.join('\n')}\n}\n`;
}

async function main() {
  const palette = JSON.parse(await readFile(PALETTE_FILE, 'utf8'));
  const css = renderPaletteCss(palette);
  const current = await readFile(CSS_FILE, 'utf8').catch(() => null);

  if (process.argv.includes('--check')) {
    if (current === css) {
      console.log('[palette-css] src/ui/palette.css is up to date');
      return;
    }
    throw new Error('src/ui/palette.css is stale — run `node scripts/palette-css.mjs`');
  }

  if (current === css) {
    console.log('[palette-css] src/ui/palette.css already up to date');
    return;
  }
  await writeFile(CSS_FILE, css);
  console.log(`[palette-css] wrote src/ui/palette.css (${flatten(palette).length} colours)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`[palette-css] FAIL — ${error.message}`);
    process.exitCode = 1;
  });
}
