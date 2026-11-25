import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        demo: resolve(import.meta.dirname, 'demo.html'),
      },
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.js'],
    coverage: {
      // stage.js は WebGL が要るので、tests/e2e で確かめる。
      include: ['src/lib/params.js', 'src/lib/dom.js', 'src/assets/registry.js'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
