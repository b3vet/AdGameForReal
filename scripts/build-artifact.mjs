/**
 * Single-file build for hosted playtest links (decision D11).
 *
 * Runs a `vite-plugin-singlefile` build into a temp directory, then rewrites the
 * output into `dist-artifact/arcane-rush.html` as a *fragment*: title, styles,
 * body markup and inline scripts, with no doctype/html/head/body wrapper,
 * because the hosting wrapper supplies those.
 *
 * Everything is inside that one file, models, baked animation, audio and the
 * Havok WASM included (`scripts/inline-assets.mjs`), so the page runs with the
 * network switched off.
 *
 *   npm run build:artifact
 */

import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

import { inlineAssets } from './inline-assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'dist-artifact');
const OUT_FILE = path.join(OUT_DIR, 'arcane-rush.html');
const TITLE = 'Arcane Rush';

/** Hosting limit (plan, "Asset delivery in builds"): 16 MB for the standalone. */
const MAX_BYTES = 16 * 1024 * 1024;

const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const STYLE_RE = /<style\b[^>]*>[\s\S]*?<\/style>/gi;

function extractFragment(html) {
  const styles = html.match(STYLE_RE) ?? [];
  const scripts = html.match(SCRIPT_RE) ?? [];

  const bodyMatch = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
  const bodyInner = (bodyMatch?.[1] ?? html)
    .replace(SCRIPT_RE, '')
    .replace(STYLE_RE, '')
    .trim();

  // The fragment must be self-contained: anything still pointing at a separate
  // file would 404 inside the hosting wrapper. Only the opening tag is
  // inspected — inline bundle code is full of unrelated `.src =` assignments.
  const external = [
    ...[...html.matchAll(/<script\b([^>]*)>/gi)]
      .filter((match) => /\bsrc\s*=/i.test(match[1] ?? ''))
      .map((match) => match[0]),
    ...(html.match(/<link\b[^>]*rel\s*=\s*["']?stylesheet[^>]*>/gi) ?? []),
  ];
  if (external.length > 0) {
    throw new Error(
      `singlefile left ${external.length} external reference(s):\n  ${external.join('\n  ')}`,
    );
  }

  return [`<title>${TITLE}</title>`, ...styles, bodyInner, ...scripts]
    .filter((part) => part.length > 0)
    .join('\n');
}

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arcane-artifact-'));

  try {
    console.log('[artifact] building single-file bundle...');
    await build({
      configFile: path.join(ROOT, 'vite.artifact.config.ts'),
      logLevel: 'warn',
      // Every asset and the Havok WASM become data URIs inside the bundle: the
      // page host blocks every runtime fetch (plan, "Asset delivery in builds").
      plugins: [inlineAssets({ onReport: (line) => console.log(`[artifact] ${line}`) })],
      build: { outDir: tempDir, emptyOutDir: true },
    });

    const html = await readFile(path.join(tempDir, 'index.html'), 'utf8');
    const fragment = extractFragment(html);

    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(OUT_FILE, fragment + '\n', 'utf8');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  const { size } = await stat(OUT_FILE);
  const megabytes = size / 1024 / 1024;
  console.log(`[artifact] ${path.relative(ROOT, OUT_FILE)} — ${megabytes.toFixed(2)} MB`);

  if (size > MAX_BYTES) {
    throw new Error(`artifact is ${megabytes.toFixed(2)} MB, over the 16 MB hosting limit`);
  }

  console.log('[artifact] PASS');
}

main().catch((error) => {
  console.error(`[artifact] FAIL — ${error.message}`);
  process.exitCode = 1;
});
