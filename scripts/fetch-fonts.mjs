/**
 * Downloads the two UI faces — Cinzel for display and numbers, Nunito for body
 * (decision D30) — into `assets/fonts/`, plus their OFL licence texts.
 *
 * Idempotent, and cached in the same git-ignored place as `fetch-assets.mjs`
 * (`node_modules/.asset-cache/`). Delete the cache to force a refresh.
 *
 * Three things about this are not obvious:
 *
 *   1. The Google Fonts CSS API (`css2`) serves *different* files to different
 *      user agents — a modern Chrome string is what gets woff2 rather than ttf,
 *      so the request below sends one.
 *   2. The API splits each family by unicode range (latin, latin-ext, cyrillic,
 *      vietnamese...). The game's copy is ASCII and the digit atlas rasterises
 *      digits, so only the `latin` block of each family is kept. That is the
 *      whole subsetting step: no font tooling in this repo, and none needed.
 *   3. Both families are *variable* fonts — the `latin` file for Cinzel 700 and
 *      for Cinzel 900 is byte-for-byte the same URL, because one file carries
 *      the whole weight axis. So this writes one file per family and
 *      `src/ui/styles.css` declares it once with a `font-weight` range. The
 *      script asserts that sameness rather than assuming it: if Google ever
 *      goes back to static instances the URLs will differ and this will fail
 *      loudly instead of silently shipping one weight twice.
 *
 * `github.com` is blocked from this sandbox, so the OFL texts come from
 * jsDelivr's GitHub mirror of `google/fonts`, the same route `fetch-assets.mjs`
 * uses for the KayKit packs.
 *
 *   node scripts/fetch-fonts.mjs
 *
 * Sources and licences are recorded in docs/ASSETS.md.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'node_modules', '.asset-cache', 'fonts');
const ASSETS = path.join(ROOT, 'assets');
const MANIFEST_FILE = path.join(ROOT, 'src', 'data', 'assets.json');

/** Sent to the CSS API; anything older gets ttf instead of woff2. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Safari/537.36';

const CSS_API =
  'https://fonts.googleapis.com/css2' +
  '?family=Cinzel:wght@700;900&family=Nunito:wght@400;700&display=swap';

/** jsDelivr mirrors `google/fonts`; github.com itself is unreachable here. */
const OFL = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl';

/** The subset comment the CSS API writes above the block we keep. */
const SUBSET = 'latin';

/**
 * What we ask for and where it lands. `weights` are the ones the CSS API is
 * asked for and the ones `styles.css` uses; `weightRange` is the `font-weight`
 * descriptor for the single variable face that covers them.
 */
const FAMILIES = [
  {
    family: 'Cinzel',
    slug: 'cinzel',
    weights: [700, 900],
    weightRange: '700 900',
    id: 'font-cinzel',
  },
  {
    family: 'Nunito',
    slug: 'nunito',
    weights: [400, 700],
    weightRange: '400 700',
    id: 'font-nunito',
  },
];

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

async function exists(file) {
  try {
    return (await stat(file)).size > 0;
  } catch {
    return false;
  }
}

/** Fetches `url` into the cache once. Returns the cached file's contents. */
async function cached(url, name, headers = {}) {
  const file = path.join(CACHE, name);
  if (await exists(file)) return await readFile(file);

  await mkdir(path.dirname(file), { recursive: true });
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'follow', headers });
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

async function writeAsset(relative, bytes) {
  const file = path.join(ASSETS, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  console.log(`  assets/${relative} — ${kb(bytes.length)} (${digest})`);
  return bytes.length;
}

/**
 * Every `@font-face` block in the API's answer, with the subset comment that
 * precedes it. The API's output is machine-generated and stable: one comment,
 * one block, no nesting, so a regex is the honest reader here.
 */
export function parseFontFaces(css) {
  const faces = [];
  const blocks = /\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/gi;
  for (const [, subset, body] of css.matchAll(blocks)) {
    const family = /font-family:\s*'([^']+)'/.exec(body)?.[1];
    const weight = /font-weight:\s*([0-9]+)/.exec(body)?.[1];
    const url = /src:\s*url\(([^)]+)\)/.exec(body)?.[1];
    if (family === undefined || weight === undefined || url === undefined) {
      throw new Error(`unreadable @font-face block:\n${body}`);
    }
    faces.push({ subset, family, weight: Number(weight), url });
  }
  if (faces.length === 0) throw new Error('the CSS API returned no @font-face blocks');
  return faces;
}

/** The one latin file a family's requested weights all point at. */
function latinFile(faces, spec) {
  const wanted = faces.filter(
    (face) =>
      face.subset === SUBSET && face.family === spec.family && spec.weights.includes(face.weight),
  );

  const missing = spec.weights.filter((w) => !wanted.some((face) => face.weight === w));
  if (missing.length > 0) {
    throw new Error(`${spec.family}: no ${SUBSET} face for weight(s) ${missing.join(', ')}`);
  }

  const urls = [...new Set(wanted.map((face) => face.url))];
  if (urls.length !== 1) {
    throw new Error(
      `${spec.family}: the ${SUBSET} subset is now ${String(urls.length)} files, one per weight ` +
        `(${urls.join(', ')}). The single variable face in src/ui/styles.css has to become one ` +
        `@font-face per weight, and this script has to write one file per weight.`,
    );
  }
  return urls[0];
}

/**
 * Checks `assets.json` still says what this script just wrote. The manifest is
 * hand-maintained (it carries model and audio entries this script knows nothing
 * about), so it is verified rather than rewritten.
 */
async function checkManifest(written) {
  const manifest = JSON.parse(await readFile(MANIFEST_FILE, 'utf8'));
  const entries = new Map(
    manifest.entries.filter((entry) => entry.kind === 'font').map((entry) => [entry.id, entry]),
  );

  for (const { spec, relative } of written) {
    const entry = entries.get(spec.id);
    if (entry === undefined) {
      console.warn(`  ! assets.json has no font entry "${spec.id}"`);
      continue;
    }
    if (entry.url !== relative) {
      console.warn(`  ! ${spec.id}: assets.json says "${entry.url}", wrote "${relative}"`);
    }
    if (entry.family !== spec.family || entry.weight !== spec.weightRange) {
      console.warn(
        `  ! ${spec.id}: assets.json says ${entry.family} ${entry.weight}, ` +
          `expected ${spec.family} ${spec.weightRange}`,
      );
    }
  }
}

async function main() {
  console.log('[fonts] cache:', path.relative(ROOT, CACHE));

  console.log('[fonts] Google Fonts CSS API');
  const css = (await cached(CSS_API, 'css2.css', { 'User-Agent': UA })).toString('utf8');
  const faces = parseFontFaces(css);

  let total = 0;
  const written = [];

  console.log(`[fonts] ${SUBSET} subsets`);
  for (const spec of FAMILIES) {
    const url = latinFile(faces, spec);
    const bytes = await cached(url, `${spec.slug}-${SUBSET}.woff2`);
    const relative = `fonts/${spec.slug}-${SUBSET}.woff2`;
    total += await writeAsset(relative, bytes);
    written.push({ spec, relative });
  }

  console.log('[fonts] OFL licences');
  for (const spec of FAMILIES) {
    const text = await cached(`${OFL}/${spec.slug}/OFL.txt`, `${spec.slug}-OFL.txt`);
    total += await writeAsset(`licenses/ofl-${spec.slug}.txt`, text);
  }

  await checkManifest(written);

  console.log(`[fonts] wrote ${kb(total)} into assets/`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`[fonts] FAIL — ${error.message}`);
    process.exitCode = 1;
  });
}
