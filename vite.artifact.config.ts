import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One copy of the version, read from `package.json` by the main config.
import { appVersion } from './vite.config';

// Separate config so the normal `npm run build` stays a multi-file build.
// `scripts/build-artifact.mjs` drives this one into a temp dir and then
// extracts the fragment the hosting wrapper expects.
export default defineConfig({
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // The device report's header, so a capture pasted from a playtest link says
  // which build it came off (`src/core/report.ts`).
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_KIND__: JSON.stringify('artifact'),
  },
  build: {
    target: 'es2022',
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    reportCompressedSize: false,
  },
});
