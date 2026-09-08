import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Hosted-link build (decision D11, hosted variant).
 *
 * The page host that serves our playtest links rejects the fully inlined
 * artifact — something inside the inlined Babylon bundle trips it, not the size.
 * It does allow `<script src>` from jsdelivr, so this config builds *only our
 * code* as a single IIFE and leaves Babylon external, to be supplied by the
 * `babylonjs` / `babylonjs-gui` UMD bundles as the `BABYLON` and `BABYLON.GUI`
 * globals.
 *
 * `scripts/build-hosted.mjs` drives this into a temp dir and assembles the
 * fragment. Not used by `npm run build` — that stays a normal module build.
 */

/** Every `@babylonjs/core` and `@babylonjs/gui` id, root or deep. */
const BABYLON_EXTERNAL = /^@babylonjs\/(core|gui)(\/.*)?$/;

/**
 * Deep ES imports collapse onto the two UMD globals: the UMD bundles are flat,
 * so `@babylonjs/core/Meshes/Builders/boxBuilder` is just `BABYLON.CreateBox`.
 */
function babylonGlobal(id: string): string {
  if (/^@babylonjs\/gui(\/.*)?$/.test(id)) return 'BABYLON.GUI';
  if (/^@babylonjs\/core(\/.*)?$/.test(id)) return 'BABYLON';
  throw new Error(`vite.hosted.config.ts: no UMD global for external module "${id}"`);
}

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Lib mode skips Vite's HTML pipeline, which is also what strips the
  // `import.meta.env` replacements it normally injects. Our source never reads
  // them, but a dependency might, so they are defined here explicitly.
  define: {
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env.DEV': 'false',
    'import.meta.env.PROD': 'true',
    'import.meta.env.SSR': 'false',
    'import.meta.env.BASE_URL': JSON.stringify('./'),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    target: 'es2022',
    emptyOutDir: true,
    // Data JSON must land inside the bundle: the host allows no runtime fetches.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    reportCompressedSize: false,
    lib: {
      entry: fileURLToPath(new URL('./src/main.ts', import.meta.url)),
      formats: ['iife'],
      name: 'ArcaneRush',
      fileName: () => 'arcane-rush.js',
      cssFileName: 'arcane-rush',
    },
    rollupOptions: {
      external: BABYLON_EXTERNAL,
      output: {
        globals: babylonGlobal,
      },
    },
  },
});
