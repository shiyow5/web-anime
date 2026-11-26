// README に載せる GIF のもとになる、連続した画像を撮る。
//
//   先に開発用サーバーを起動しておく:  npx vite --port 5190 --strictPort
//   使い方:                          node scripts/capture.mjs <素材の id> [<id> ...]
//
// 素材ごとに test-results/capture/<id>/000.png からの連番画像を保存し、
// 最後に「id と、1 コマあたりの平均の間隔（ミリ秒）」を表示する。
// GIF にするときは、その間隔に合わせたコマ数で ffmpeg にかける。
//   ffmpeg -framerate 8 -i test-results/capture/<id>/%03d.png -vf "scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse" docs/media/<id>.gif

import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const PORT = process.env.SMOKE_PORT ?? '5190';
const BASE = `http://localhost:${PORT}`;
const FRAMES = Number(process.env.CAPTURE_FRAMES ?? 30);
const WAIT = Number(process.env.CAPTURE_WAIT ?? 3500);
const ids = process.argv.slice(2).filter((arg) => /^[a-z][a-z0-9-]+$/.test(arg));

if (ids.length === 0) {
  console.error('素材の id を 1 つ以上指定してください。例: node scripts/capture.mjs liquid-orb');
  process.exit(2);
}

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

try {
  for (const id of ids) {
    const dir = `test-results/capture/${id}`;
    mkdirSync(dir, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(120_000);
    await page.goto(`${BASE}/demo.html?id=${id}`);
    const stage = page.locator('#stage');
    await page.waitForTimeout(WAIT);
    const started = Date.now();
    for (let i = 0; i < FRAMES; i += 1) {
      // ポインターをゆっくり横切らせて、傾きなどの反応も写す。
      await page.mouse.move(300 + (i / FRAMES) * 420, 330 + Math.sin(i / 4) * 90);
      await stage.screenshot({ path: `${dir}/${String(i).padStart(3, '0')}.png` });
    }
    const interval = Math.round((Date.now() - started) / FRAMES);
    console.log(`${id} ${interval}`);
    await page.close();
  }
} finally {
  await browser.close();
}
