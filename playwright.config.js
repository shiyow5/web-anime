import { defineConfig } from '@playwright/test';

const PORT = 5183;

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/playwright',
  fullyParallel: true,
  // GPU の無い環境ではソフトウェア描画になり、重い素材が並ぶと遅い。余裕を持たせる。
  timeout: 150_000,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    // 手元に入っている Chrome を使う。GPU が無い環境でも WebGL が動くよう、ソフトウェア描画を許可する。
    channel: 'chrome',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
