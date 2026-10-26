import { defineConfig } from 'vite';

// The site is published at https://markleary.github.io/driveboston/, so every
// asset path carries the repository name as its base.
export default defineConfig({
  base: '/driveboston/',
  server: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4188,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 2500,
  },
  assetsInclude: ['**/*.bin.gz'],
});
