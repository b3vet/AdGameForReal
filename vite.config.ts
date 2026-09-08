import { cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

/**
 * Copies `assets/` into the build output.
 *
 * Vite only copies `publicDir`, and `assets/` is not that — it is the game's
 * own art, baked animation and audio, addressed by `src/data/assets.json` as
 * `/assets/...`. The dev server serves those paths straight from the repo root,
 * so this is what makes a production build agree with it (docs/ASSETS.md, open
 * issue 1). `build.assetsDir` moves Vite's own chunks to `dist/bundle/` so the
 * name is free.
 *
 * `fs.cp` rather than a plugin: no dependency, and it is one call.
 */
function copyGameAssets(): Plugin {
  let outDir = 'dist';
  return {
    name: 'arcane-rush:copy-assets',
    apply: 'build',
    configResolved(config) {
      // Read rather than assumed: a caller can pass its own `build.outDir`,
      // and Vite has already resolved this one to an absolute path.
      outDir = config.build.outDir;
    },
    async closeBundle() {
      await cp(path.resolve(ROOT, 'assets'), path.resolve(ROOT, outDir, 'assets'), {
        recursive: true,
      });
    },
  };
}

export default defineConfig({
  plugins: [copyGameAssets()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    // `dist/assets/` is the game's own assets; Vite's chunks go next door.
    assetsDir: 'bundle',
    emptyOutDir: true,
    // Babylon is ~1 MB minified; that is the floor for this app, not a smell.
    chunkSizeWarningLimit: 1500,
  },
  server: {
    host: true,
  },
});
