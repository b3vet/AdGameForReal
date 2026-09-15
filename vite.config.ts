import { readFileSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

/**
 * What the device report calls this build (`src/core/report.ts`).
 *
 * The version is read from `package.json` rather than written twice: it is what
 * `npm run cap:version` stamps into the iOS project, so a report from the phone
 * and the build in Xcode have to agree, and the only way to be sure of that is
 * for both to read the same field.
 */
export const appVersion: string = (
  JSON.parse(readFileSync(path.resolve(ROOT, 'package.json'), 'utf8')) as { version: string }
).version;

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
  /**
   * The one subtree that must not be copied. `assets/app/` is the icon and
   * splash *source* (docs/ART.md, D57): 944 KB that `@capacitor/assets` reads on
   * the owner's Mac to generate the native catalogues, and that no page ever
   * requests — the web build's own marks are the small ones in `public/`.
   * Shipping it would put a second megabyte of PNG in `dist/` and in the app
   * bundle `npx cap sync` copies.
   */
  const appArt = path.resolve(ROOT, 'assets', 'app');
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
        // Returning false for a directory skips the whole subtree.
        filter: (source) => source !== appArt,
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
  // Stamped into the bundle for the device report. `web` covers the dev server,
  // `npm run build` and the build Capacitor wraps — the report says `native`
  // there from the platform, not from the bundler (`src/core/report.ts`).
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_KIND__: JSON.stringify('web'),
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
