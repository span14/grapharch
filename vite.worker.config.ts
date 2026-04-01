import { defineConfig } from 'vite';

// https://vitejs.dev/config
// Worker utility process build config.
// We set build.lib explicitly to control the output filename so it doesn't
// collide with the main process index.js in the same .vite/build/ directory.
export default defineConfig({
  build: {
    lib: {
      entry: 'src/worker/index.ts',
      fileName: () => 'worker.js',
      formats: ['cjs'],
    },
  },
});
