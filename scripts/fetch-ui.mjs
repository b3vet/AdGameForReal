/**
 * Downloads the game's UI kit (decision D39) into `assets/ui/`.
 *
 * Two CC0 packs from kenney.nl:
 *
 *   - **Fantasy UI Borders** for the nine-slice frames. The pack ships 140
 *     pieces as PNG *and* as one 1080x1080 vector sheet, and the vector sheet is
 *     what this script reads: each piece is a named `<g>` that `<use>`s one
 *     symbol from `<defs>`, so lifting a piece out is a matter of pairing the
 *     two and giving the result its own `viewBox`. The PNGs are 48x48, which is
 *     a blurry corner ornament on a 3x phone; an SVG is exact at any density
 *     and costs about a kilobyte.
 *   - **UI Pack** for the button bodies, whose vector versions are already
 *     drawn as nine-slices with a depth edge along the bottom — the bevel a
 *     button needs, without a `box-shadow` pretending to be one.
 *
 * Both are recoloured on the way through, from `src/data/palette.json` and
 * nothing else (decision D36): Kenney's white frames become a gold gradient and
 * the UI Pack's grey ramp becomes gold or stone. That is why these are
 * generated rather than copied — the hex in the shipped file comes from the
 * palette, so a palette change is one command away from the whole kit.
 *
 * **Kenney Game Icons** is fetched and its licence recorded, but nothing from
 * it ships: it is a 2014 set of interface glyphs (gamepads, arrows, volume) and
 * every icon this game needs is thematic — a coin, three staffs, five drills, a
 * wisp, four rooms. Those are drawn as an inline sprite in `index.html`, where
 * they cost no request at all and take their colours from the same variables.
 *
 *   node scripts/fetch-ui.mjs
 *
 * Idempotent, cached in `node_modules/.asset-cache/ui/` like the other fetch
 * scripts. Sources and licences are recorded in docs/ASSETS.md.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findZipEntry } from './fetch-assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'node_modules', '.asset-cache', 'ui');
const ASSETS = path.join(ROOT, 'assets');
const PALETTE_FILE = path.join(ROOT, 'src', 'data', 'palette.json');
const MANIFEST_FILE = path.join(ROOT, 'src', 'data', 'assets.json');

/** Packs on kenney.nl, by the slug in their page URL. */
const PACKS = ['fantasy-ui-borders', 'ui-pack', 'game-icons'];

/**
 * The frames, by the name Kenney gives the piece in the vector sheet.
 *
 * `panel_border_*` rather than `panel_*` or `panel_transparent_center_*`: those
 * two carry a centre fill that reaches into the edge slices, which would paint a
 * translucent band along every border. A `panel_border_*` piece is the frame and
 * nothing else, so the panel's own background is free to be parchment, a dark
 * chip, or a gold gradient.
 *
 * `slice` is the `border-image-slice` the stylesheet uses, in the piece's own
 * 48-unit grid: the corner ornament has to fit inside it and the edge beyond it
 * has to be a straight run, because that run is what gets stretched.
 */
const FRAMES = [
  { id: 'ui-frame-panel', piece: 'panel_border_026', file: 'frame-panel.svg', ramp: 'gold' },
  { id: 'ui-frame-card', piece: 'panel_border_001', file: 'frame-card.svg', ramp: 'gold' },
  { id: 'ui-frame-plaque', piece: 'panel_border_013', file: 'frame-plaque.svg', ramp: 'gold' },
  { id: 'ui-frame-bar', piece: 'panel_border_003', file: 'frame-bar.svg', ramp: 'gold' },
  { id: 'ui-frame-inset', piece: 'panel_border_012', file: 'frame-inset.svg', ramp: 'shade' },
  // Kenney's dividers are drawn one-ended — a rule with a flourish on the
  // right — because they are meant to be used in mirrored pairs. `mirror`
  // stamps the piece twice, the second copy flipped about x, so one file is a
  // symmetric ornament that can be centred under a heading.
  { id: 'ui-divider', piece: 'divider_003', file: 'divider.svg', ramp: 'gold', mirror: true },
];

/** The button bodies, from the UI Pack's grey set (the one with no hue to fight). */
const BUTTONS = [
  {
    id: 'ui-button-gold',
    entry: 'Vector/Grey/button_rectangle_depth_border.svg',
    file: 'button-gold.svg',
    ramp: 'gold',
  },
  {
    id: 'ui-button-stone',
    entry: 'Vector/Grey/button_rectangle_depth_border.svg',
    file: 'button-stone.svg',
    ramp: 'stone',
  },
];

/**
 * Kenney's grey ramp and what each step is once the shape is read from the
 * outside in: the depth edge under the button, the rim around it, the groove
 * just inside that rim, and the face the label sits on.
 *
 * The order is not the ramp's own brightness order — the *face* is the darkest
 * grey in the file and the rim is white — which is why these are named after
 * what they draw rather than after how light they are.
 */
const GREY_RAMP = ['#666880', '#989AAF', '#DADCE7', '#FFFFFF'];
const RAMP_ROLES = ['depth', 'face', 'groove', 'rim'];

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

async function exists(file) {
  try {
    return (await stat(file)).size > 0;
  } catch {
    return false;
  }
}

/** Fetches `url` into the cache once. Returns the cached file's contents. */
async function cached(url, name) {
  const file = path.join(CACHE, name);
  if (await exists(file)) return await readFile(file);

  await mkdir(path.dirname(file), { recursive: true });
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length === 0) throw new Error('empty body');
      await writeFile(file, body);
      console.log(`  fetched ${name} (${kb(body.length)})`);
      return body;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`${url}: ${String(lastError)}`);
}

async function writeAsset(relative, text) {
  const file = path.join(ASSETS, relative);
  await mkdir(path.dirname(file), { recursive: true });
  const bytes = Buffer.from(text);
  await writeFile(file, bytes);
  console.log(`  assets/${relative} — ${kb(bytes.length)}`);
  return bytes.length;
}

/** The pack's zip, found the way `fetch-assets.mjs` finds its own. */
async function pack(slug) {
  const page = await (await fetch(`https://kenney.nl/assets/${slug}`)).text();
  const url = new RegExp(`https://kenney\\.nl/media/pages/assets/${slug}/[^'"]*\\.zip`).exec(
    page,
  )?.[0];
  if (url === undefined) throw new Error(`no zip link on kenney.nl/assets/${slug}`);
  return await cached(url, `${slug}.zip`);
}

// --- Colour ----------------------------------------------------------------

const hex = ([r, g, b]) =>
  `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;

const rgb = (value) => [1, 3, 5].map((at) => Number.parseInt(value.slice(at, at + 2), 16));

/** `amount` of `b` into `a`, in plain sRGB. Good enough for a button's edge. */
function mix(a, b, amount) {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return hex([
    ar + (br - ar) * amount,
    ag + (bg - ag) * amount,
    ab + (bb - ab) * amount,
  ]);
}

/**
 * The four steps each ramp gives a button, and the two ends it gives a frame.
 *
 * `depth` is the only computed colour here: the palette has three golds and a
 * button's shadow edge has to sit under the darkest of them, so it is that gold
 * carried most of the way to ink. Everything else is a role, verbatim.
 */
function ramps(palette) {
  const ink = palette.ink.base;
  return {
    gold: {
      depth: mix(palette.gold.deep, ink, 0.45),
      groove: palette.gold.deep,
      face: palette.gold.base,
      rim: palette.gold.light,
      // The face is a gradient, not a flat fill: light at the top edge and
      // deep at the bottom, which is what a struck plate does to the light.
      faceTop: mix(palette.gold.light, palette.parchment.base, 0.35),
      faceBottom: mix(palette.gold.base, palette.gold.deep, 0.55),
      // The frame ornaments read light-to-deep top to bottom.
      highlight: palette.gold.light,
      border: palette.gold.deep,
    },
    // The secondary button is carved stone *rimmed* rather than stone through:
    // a parchment face keeps its label as readable as the gold one's, and a
    // face in `stone.base` read as a button that had been switched off.
    stone: {
      depth: mix(palette.stone.deep, ink, 0.45),
      groove: palette.stone.deep,
      face: palette.parchment.shade,
      rim: palette.parchment.base,
      faceTop: palette.parchment.base,
      faceBottom: mix(palette.parchment.shade, palette.stone.deep, 0.35),
      highlight: palette.parchment.base,
      border: palette.stone.deep,
    },
    shade: {
      highlight: palette.stone.light,
      face: palette.stone.base,
      border: palette.stone.deep,
    },
  };
}

// --- Fantasy UI Borders: one piece out of the vector sheet -------------------

/**
 * The sheet is machine-generated Flash export: `<g id="Symbol_N_0_Layer0_0_FILL">`
 * blocks in `<defs>`, then one `<g id="panel_border_007">` per piece that
 * `<use>`s a symbol. Pairing the two by id is the whole extraction.
 */
export function readSheet(svg) {
  const symbols = new Map(
    [...svg.matchAll(/<g id="(Symbol_[0-9A-Za-z_]+)">([\s\S]*?)\n<\/g>/g)].map((m) => [m[1], m[2]]),
  );
  const pieces = new Map();
  for (const match of svg.matchAll(
    /<g id="([a-z_0-9]+)" transform="[^"]*">\s*<g transform="[^"]*">\s*<use xlink:href="#([^"]+)"\/>/g,
  )) {
    const body = symbols.get(match[2]);
    if (body !== undefined) pieces.set(match[1], body.trim());
  }
  if (pieces.size === 0) throw new Error('the fantasy sheet has no named pieces');
  return pieces;
}

/**
 * The drawing's own bounds. Every path in the sheet is `M`/`L` only and the
 * pieces are drawn around the origin, so the numbers in the `d` attributes are
 * the coordinates and their extremes are the box. A piece has to keep its own
 * box rather than a shared one: the panels are 48 wide and the dividers are 96.
 */
export function boundsOf(body) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [, data] of body.matchAll(/\sd="([^"]*)"/g)) {
    const numbers = data.match(/-?\d+(?:\.\d+)?/g) ?? [];
    if (numbers.length % 2 !== 0) throw new Error('odd coordinate count in a path');
    for (let i = 0; i < numbers.length; i += 2) {
      const x = Number(numbers[i]);
      const y = Number(numbers[i + 1]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) throw new Error('a piece with no path in it');
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * One piece as a standalone SVG, its white swapped for a vertical gold ramp.
 *
 * The gradient is what stops a frame reading as a hairline box: light along the
 * top edge, base through the middle, deep along the bottom, so an ornament
 * catches the light the way a struck metal one would.
 */
export function framePiece(body, colours, mirror = false) {
  const box = boundsOf(body);
  const paths = body
    .replace(/fill="#FFFFFF"/g, 'fill="url(#g)"')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
  // A mirrored piece is drawn about x = 0, so its box is the wider of the two
  // sides on both sides of the origin.
  const half = Math.max(Math.abs(box.x), Math.abs(box.x + box.width));
  const view = mirror ? { x: -half, y: box.y, width: half * 2, height: box.height } : box;
  const art = mirror
    ? `<defs><g id="p">${paths}</g></defs><use href="#p"/><use href="#p" transform="scale(-1,1)"/>`
    : paths;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view.x} ${view.y} ${view.width} ${view.height}" ` +
    `width="${view.width}" height="${view.height}">` +
    `<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" ` +
    `x1="0" y1="${view.y}" x2="0" y2="${view.y + view.height}">` +
    `<stop offset="0" stop-color="${colours.highlight}"/>` +
    `<stop offset="0.5" stop-color="${colours.face}"/>` +
    `<stop offset="1" stop-color="${colours.border}"/>` +
    `</linearGradient></defs>${art}</svg>`
  );
}

/**
 * A UI Pack button with Kenney's grey ramp swapped for one of ours, and its
 * face turned into a vertical gradient.
 *
 * The gradient is `userSpaceOnUse` down the source's own 64 units. A nine-slice
 * takes a horizontal band out of the middle of that and stretches it to the
 * button's height, and stretching a vertical gradient vertically leaves it a
 * vertical gradient — so a 40 px button and a 300 px one are lit the same way.
 */
export function recolour(svg, colours) {
  let out = svg;
  for (const [index, grey] of GREY_RAMP.entries()) {
    const role = RAMP_ROLES[index];
    out = out.replaceAll(grey, colours[role]);
  }
  const gradient =
    `<defs><linearGradient id="face" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="60">` +
    `<stop offset="0" stop-color="${colours.faceTop}"/>` +
    `<stop offset="1" stop-color="${colours.faceBottom}"/>` +
    `</linearGradient></defs>`;
  out = out
    .replace(`fill="${colours.face}"`, 'fill="url(#face)"')
    .replace('<g>', `${gradient}<g>`);
  // A zero-area sliver Kenney's exporter leaves behind to mark the nine-slice
  // guides. It is invisible, but a stray pure red in a gold button is the kind
  // of thing that turns up in a screenshot review a month later.
  out = out.replace(/<path stroke="none" fill="#FF0000"[^/]*\/>\s*/g, '');
  return out.replace(/\n\s*/g, '').replace(/<defs\/>/, '');
}

/** Kenney's `License.txt`, verbatim, for `assets/licenses/`. */
function licenceOf(zip, slug) {
  const entry = findZipEntry(zip, /license\.txt$/i);
  if (entry === null) throw new Error(`no License.txt in the ${slug} zip`);
  return entry.toString('utf8');
}

/** The one line in a Kenney licence that says what the licence is. */
function licenceLine(text) {
  return /^\s*License.*$/m.exec(text)?.[0].trim() ?? '(no licence line)';
}

/**
 * Checks `assets.json` still says what this script just wrote. Hand-maintained
 * like the rest of the manifest, so it is verified rather than rewritten
 * (`fetch-fonts.mjs` does the same for the faces).
 */
async function checkManifest(written) {
  const manifest = JSON.parse(await readFile(MANIFEST_FILE, 'utf8'));
  const entries = new Map(
    manifest.entries.filter((entry) => entry.kind === 'ui').map((entry) => [entry.id, entry]),
  );
  for (const { id, url } of written) {
    const entry = entries.get(id);
    if (entry === undefined) console.warn(`  ! assets.json has no ui entry "${id}"`);
    else if (entry.url !== url) console.warn(`  ! ${id}: assets.json says "${entry.url}"`);
  }
  for (const id of entries.keys()) {
    if (!written.some((item) => item.id === id)) console.warn(`  ! assets.json has a stale "${id}"`);
  }
}

async function main() {
  console.log('[ui] cache:', path.relative(ROOT, CACHE));
  const palette = JSON.parse(await readFile(PALETTE_FILE, 'utf8'));
  const colours = ramps(palette);

  const zips = new Map();
  for (const slug of PACKS) {
    console.log(`[ui] kenney.nl/assets/${slug}`);
    zips.set(slug, await pack(slug));
  }

  let total = 0;
  const written = [];

  console.log('[ui] frames from the Fantasy UI Borders vector sheet');
  const sheetZip = zips.get('fantasy-ui-borders');
  const sheetEntry = findZipEntry(sheetZip, /Vector\/.*\.svg$/);
  if (sheetEntry === null) throw new Error('no vector sheet in the fantasy-ui-borders zip');
  const pieces = readSheet(sheetEntry.toString('utf8'));

  for (const frame of FRAMES) {
    const body = pieces.get(frame.piece);
    if (body === undefined) throw new Error(`the sheet has no piece "${frame.piece}"`);
    const url = `ui/${frame.file}`;
    total += await writeAsset(url, framePiece(body, colours[frame.ramp], frame.mirror === true));
    written.push({ id: frame.id, url });
  }

  console.log('[ui] buttons from the UI Pack');
  const uiZip = zips.get('ui-pack');
  for (const button of BUTTONS) {
    const entry = findZipEntry(uiZip, new RegExp(`${button.entry.replace(/[/.]/g, '\\$&')}$`));
    if (entry === null) throw new Error(`the ui-pack zip has no "${button.entry}"`);
    const url = `ui/${button.file}`;
    total += await writeAsset(url, recolour(entry.toString('utf8'), colours[button.ramp]));
    written.push({ id: button.id, url });
  }

  console.log('[ui] licences');
  for (const slug of PACKS) {
    const text = licenceOf(zips.get(slug), slug);
    total += await writeAsset(`licenses/kenney-${slug}.txt`, text);
    console.log(`    ${slug}: ${licenceLine(text)}`);
  }

  await checkManifest(written);
  console.log(`[ui] wrote ${kb(total)} into assets/`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`[ui] FAIL — ${error.message}`);
    process.exitCode = 1;
  });
}
