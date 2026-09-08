/**
 * Hosted-link build (decision D11, hosted variant).
 *
 * `npm run build:artifact` inlines Babylon, and the page host rejects the
 * result — pages without the Babylon bundle pass, and a page of filler script
 * the same size passes, so the trigger is content inside the inlined engine,
 * not bytes. That host does allow `<script src>` from jsdelivr, so this variant
 * loads Babylon from the CDN as UMD globals and inlines only our own code.
 *
 * Output is a *fragment* — title, styles, body markup, three CDN script tags
 * and one inline script — because the hosting wrapper supplies doctype/html/head.
 * Our own assets are not external: they are data URIs inside the inline script
 * (`scripts/inline-assets.mjs`), because the host blocks every runtime fetch.
 *
 *   npm run build:hosted
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

import { inlineAssets } from './inline-assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMP_DIR = path.join(ROOT, 'node_modules', '.vite-hosted');
const OUT_DIR = path.join(ROOT, 'dist-hosted');
const OUT_FILE = path.join(OUT_DIR, 'arcane-rush.html');
const TITLE = 'Arcane Rush';

/**
 * The only external references the host permits. Pinned to the version in
 * package.json: the UMD bundles and `@babylonjs/*` must be the same engine.
 */
const CDN_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/babylonjs@9.25.0/babylon.js',
  'https://cdn.jsdelivr.net/npm/babylonjs-gui@9.25.0/babylon.gui.min.js',
  // The glTF loader registers itself with the core bundle's scene loader when
  // this script runs, which is what the ES build's `import '@babylonjs/loaders/glTF'`
  // side effect does. Load order matters: it needs `BABYLON` to exist already.
  'https://cdn.jsdelivr.net/npm/babylonjs-loaders@9.25.0/babylonjs.loaders.min.js',
];

/** Hosting limit (plan, "Asset delivery in builds"): 12 MB for the hosted link. */
const MAX_BYTES = 12 * 1024 * 1024;

const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;

/**
 * A literal `</script` inside the bundle would close the inline tag early. The
 * escaped form is identical to the parser inside a string or regex literal.
 */
function escapeForInlineScript(code) {
  return code.replace(/<\/script/gi, '<\\/script');
}

/** The body of `index.html` minus its module script tag and its comments. */
function bodyMarkup(html) {
  const match = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
  if (match?.[1] === undefined) {
    throw new Error('index.html has no <body>');
  }

  return match[1]
    .replace(SCRIPT_RE, '')
    .replace(COMMENT_RE, '')
    // Comment removal leaves the indent of the line it sat on behind.
    .replace(/^[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The single JS and CSS file the lib build emits. */
async function collectBundle(dir) {
  const names = await readdir(dir);
  const js = names.filter((name) => name.endsWith('.js'));
  const css = names.filter((name) => name.endsWith('.css'));

  if (js.length !== 1) {
    throw new Error(`expected exactly one .js in the lib build, got [${js.join(', ')}]`);
  }
  if (css.length > 1) {
    throw new Error(`expected at most one .css in the lib build, got [${css.join(', ')}]`);
  }

  const styles = css.length === 1 ? await readFile(path.join(dir, css[0]), 'utf8') : '';

  return {
    js: await readFile(path.join(dir, js[0]), 'utf8'),
    // Vite's lib-mode CSS bookkeeping marker; meaningless outside the build.
    css: styles.replace(/\/\*\$vite\$[^*]*\*\//g, ''),
  };
}

async function main() {
  console.log('[hosted] building game bundle (Babylon external)...');
  await build({
    configFile: path.join(ROOT, 'vite.hosted.config.ts'),
    logLevel: 'warn',
    // Babylon comes from the CDN; everything else — models, baked animation,
    // audio, the Havok WASM — is inlined, because the host blocks every fetch.
    plugins: [inlineAssets({ onReport: (line) => console.log(`[hosted] ${line}`) })],
    build: { outDir: TEMP_DIR, emptyOutDir: true },
  });

  let bundle;
  try {
    bundle = await collectBundle(TEMP_DIR);
  } finally {
    await rm(TEMP_DIR, { recursive: true, force: true });
  }

  // Nothing may reference @babylonjs at runtime: the host blocks every fetch,
  // so a surviving bare specifier would be a blank page rather than a warning.
  if (/["'`]@babylonjs\//.test(bundle.js)) {
    throw new Error('the bundle still references a bare @babylonjs specifier');
  }

  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');

  const fragment = [
    `<title>${TITLE}</title>`,
    `<style>\n${bundle.css.trim()}\n</style>`,
    bodyMarkup(html),
    ...CDN_SCRIPTS.map((src) => `<script src="${src}"></script>`),
    `<script>\n${escapeForInlineScript(bundle.js.trim())}\n</script>`,
  ].join('\n');

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, fragment + '\n', 'utf8');

  const { size } = await stat(OUT_FILE);
  const megabytes = size / 1024 / 1024;
  const inlineBytes = Buffer.byteLength(bundle.js, 'utf8');
  console.log(
    `[hosted] ${path.relative(ROOT, OUT_FILE)} — ${megabytes.toFixed(2)} MB ` +
      `(inline script ${(inlineBytes / 1024 / 1024).toFixed(2)} MB, Babylon from jsdelivr)`,
  );

  if (size > MAX_BYTES) {
    throw new Error(`hosted build is ${megabytes.toFixed(2)} MB, over the 12 MB hosting limit`);
  }

  console.log('[hosted] PASS');
}

main().catch((error) => {
  console.error(`[hosted] FAIL — ${error.message}`);
  process.exitCode = 1;
});
