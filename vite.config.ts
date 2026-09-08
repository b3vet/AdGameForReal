import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    // Babylon is ~1 MB minified; that is the floor for this app, not a smell.
    chunkSizeWarningLimit: 1500,
  },
  server: {
    host: true,
  },
});
