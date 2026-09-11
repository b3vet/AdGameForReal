/**
 * The inlining step both single-file builds share (plan, "Asset delivery in
 * builds"; decision D22).
 *
 * The page host that serves our playtest links blocks every runtime fetch, so a
 * single-file build may not leave one behind. This Vite plugin rewrites the three
 * things that would cause one:
 *
 *   1. `src/data/assets.json` — every `url` (and a VAT entry's `metaUrl`)
 *      becomes a `data:` URI of the file's bytes and `basePath` becomes empty.
 *      `resolveAssetUrl` already passes an absolute URI through untouched, so
 *      no runtime code changes; the glTF loader takes a `data:` URI through its
 *      `directLoad` path and `src/render/characters/manifest.ts` decodes the
 *      rest itself rather than fetching.
 *   2. Every `@font-face` in our CSS — the `url(/assets/fonts/*.woff2)` the
 *      browser would otherwise fetch becomes a `data:` URI of the file. The
 *      files are named by the `font` entries in `assets.json`, so the manifest
 *      stays the one place that says which faces we ship.
 *   3. `src/physics/havokWasm.ts` — the module that carries the Havok WASM.
 *      Normally it exports the `?url` Vite emits and an empty base64 string;
 *      here it is replaced wholesale with the base64 of the WASM and an empty
 *      URL, so the loader is handed a `wasmBinary` and never calls `locateFile`.
 *      Replacing the whole module (rather than adding a `define`) is what keeps
 *      the `?url` import out of the inlined build: Vite never sees it, so the
 *      2 MB of WASM is not also emitted as an asset.
 *
 * Used by `scripts/build-artifact.mjs` and `scripts/build-hosted.mjs` as an
 * inline plugin, so `npm run build` and `npm run dev` are untouched and keep
 * loading from `/assets/`.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_FILE = path.join(ROOT, 'src', 'data', 'assets.json');
const HAVOK_MODULE = path.join(ROOT, 'src', 'physics', 'havokWasm.ts');
const HAVOK_WASM = path.join(
  ROOT,
  'node_modules',
  '@babylonjs',
  'havok',
  'lib',
  'esm',
  'HavokPhysics.wasm',
);

/**
 * Media types per extension. The glTF loader only recognises a `.glb` data URI
 * as `model/gltf-binary` (or `application/octet-stream`), so these are not
 * cosmetic — see `canDirectLoad` in `@babylonjs/loaders`.
 */
const MIME = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ktx2': 'image/ktx2',
  '.woff2': 'font/woff2',
};

function mimeOf(file) {
  const type = MIME[path.extname(file).toLowerCase()];
  if (type === undefined) throw new Error(`inline-assets: no media type for "${file}"`);
  return type;
}

async function dataUri(basePath, url) {
  // `basePath` is a URL path (`/assets/`), so it is joined as one and then
  // resolved against the repo root to find the file on disk.
  const relative = `${basePath}${url}`.replace(/^\/+/, '');
  const file = path.join(ROOT, relative);
  const bytes = await readFile(file);
  return { uri: `data:${mimeOf(file)};base64,${bytes.toString('base64')}`, bytes: bytes.length };
}

/** The manifest with every URL replaced by its bytes, plus what that cost. */
export async function inlineManifest() {
  const manifest = JSON.parse(await readFile(MANIFEST_FILE, 'utf8'));
  const basePath = manifest.basePath ?? '';
  let bytes = 0;
  let files = 0;

  for (const entry of manifest.entries) {
    // A font's bytes ride in the `@font-face` rule (see `inlineFontCss`), and
    // nothing loads one through `resolveAssetUrl`. Inlining it here as well
    // would ship every glyph twice. The URL is absolutised instead, so it still
    // means what it meant before `basePath` was emptied.
    if (entry.kind === 'font') {
      entry.url = `${basePath}${entry.url}`;
      continue;
    }

    const asset = await dataUri(basePath, entry.url);
    entry.url = asset.uri;
    bytes += asset.bytes;
    files++;
    if (entry.metaUrl === undefined) continue;
    const meta = await dataUri(basePath, entry.metaUrl);
    entry.metaUrl = meta.uri;
    bytes += meta.bytes;
    files++;
  }

  manifest.basePath = '';
  return { manifest, bytes, files };
}

/**
 * Every `font` entry in the manifest as `<absolute url> -> data: URI`.
 *
 * The `@font-face` rules in `src/ui/styles.css` point at `/assets/fonts/...`.
 * That is all a normal build needs: the dev server serves the path straight
 * from the repo root, and `npm run build` resolves it against the root and
 * re-emits the file into `dist/bundle/` with a content hash. Only the
 * single-file builds need the bytes in the rule itself, and this is where they
 * come from.
 */
async function fontDataUris() {
  const manifest = JSON.parse(await readFile(MANIFEST_FILE, 'utf8'));
  const basePath = manifest.basePath ?? '';
  const map = new Map();
  let bytes = 0;

  for (const entry of manifest.entries) {
    if (entry.kind !== 'font') continue;
    const asset = await dataUri(basePath, entry.url);
    map.set(`${basePath}${entry.url}`, asset.uri);
    bytes += asset.bytes;
  }

  return { map, bytes };
}

/**
 * Replaces those URLs wherever they appear in a stylesheet. Runs before Vite's
 * own CSS plugin (`enforce: 'pre'`), which then leaves the `data:` URIs alone.
 * A URL that is in the CSS but not in the manifest is an error rather than a
 * silent pass-through: it would be a runtime fetch on a host that allows none.
 */
function inlineFontCss(code, fonts) {
  return code.replace(/url\(\s*(['"]?)(\/assets\/fonts\/[^'")]+)\1\s*\)/g, (match, _q, url) => {
    const uri = fonts.get(url);
    if (uri === undefined) {
      throw new Error(`inline-assets: ${url} is not a font entry in assets.json`);
    }
    return `url("${uri}")`;
  });
}

/** The replacement for `src/physics/havokWasm.ts`: the WASM as base64. */
async function inlineHavok() {
  const wasm = await readFile(HAVOK_WASM);
  return {
    code:
      `export const havokWasmUrl = '';\n` +
      `export const havokWasmBase64 = '${wasm.toString('base64')}';\n`,
    bytes: wasm.length,
  };
}

/**
 * @param {{ onReport?: (line: string) => void }} [options]
 * @returns {import('vite').Plugin}
 */
export function inlineAssets(options = {}) {
  const report = options.onReport ?? (() => {});
  /** Read once and shared by every stylesheet the build passes through. */
  let fonts = null;

  return {
    name: 'arcane-rush:inline-assets',
    // Before Vite's own JSON, CSS and asset plugins, so `load` wins for both
    // files and `transform` sees stylesheets as their author wrote them.
    enforce: 'pre',
    apply: 'build',

    async transform(code, id) {
      if (!/\.css(\?|$)/.test(id)) return null;
      if (!code.includes('/assets/fonts/')) return null;

      if (fonts === null) {
        fonts = await fontDataUris();
        report(`inlined ${String(fonts.map.size)} fonts, ${(fonts.bytes / 1024).toFixed(0)} KB raw`);
      }
      return { code: inlineFontCss(code, fonts.map), map: null };
    },

    async load(id) {
      const file = id.split('?')[0];

      if (file === MANIFEST_FILE) {
        const { manifest, bytes, files } = await inlineManifest();
        report(`inlined ${files} assets, ${(bytes / 1024 / 1024).toFixed(2)} MB raw`);
        // JSON text, not JS: Vite's own JSON plugin transforms it from here,
        // which is what turns 4 MB of base64 into one `JSON.parse` call.
        return JSON.stringify(manifest);
      }

      if (file === HAVOK_MODULE) {
        const { code, bytes } = await inlineHavok();
        report(`inlined Havok WASM, ${(bytes / 1024 / 1024).toFixed(2)} MB raw`);
        return code;
      }

      return null;
    },
  };
}
