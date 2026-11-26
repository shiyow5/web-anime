// README に載せる GIF のもとになる、連続した画像を撮る。
//
//   先に開発用サーバーを起動しておく:  npx vite --port 5190 --strictPort
//   使い方:                          node scripts/capture.mjs <素材の id> [<id> ...]
//
// 素材ごとに test-results/capture/<id>/000.png からの連番画像を保存する。
// ページの中の時計を 80 ミリ秒ずつ進めて撮るので、GIF は毎秒 12.5 コマで作る。
// 途中（既定では 14 コマ目）で中央を 1 回タップする。
//   ffmpeg -framerate 12.5 -i test-results/capture/<id>/%03d.png -vf "scale=380:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=48:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" docs/media/<id>.gif

import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const PORT = process.env.SMOKE_PORT ?? '5190';
const BASE = `http://localhost:${PORT}`;
const FRAMES = Number(process.env.CAPTURE_FRAMES ?? 70);
const WAIT = Number(process.env.CAPTURE_WAIT ?? 3500);
const TAP_AT = Number(process.env.CAPTURE_TAP_AT ?? 14);
// 1 コマぶんの時間（ミリ秒）。半分ずつ 2 回進めて、動きの計算が粗くならないようにする。
const STEP = 80;
const HALF = STEP / 2;
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
    // ページの中の時計を止め、決まった幅で進めながら撮る。描画が遅いマシンでも等間隔のコマになる。
    await page.clock.install();
    await page.goto(`${BASE}/demo.html?id=${id}`);
    const stage = page.locator('#stage');
    await page.waitForTimeout(1500);
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
    for (let t = 0; t < WAIT; t += HALF) await page.clock.fastForward(HALF);
    const box = await stage.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    for (let i = 0; i < FRAMES; i += 1) {
      // ポインターをゆっくり横切らせて傾きなどの反応を写し、途中で 1 回タップする。
      if (i === TAP_AT) await page.mouse.click(cx, cy);
      else await page.mouse.move(cx - 200 + (i / FRAMES) * 400, cy + Math.sin(i / 9) * 80);
      await page.clock.fastForward(HALF);
      await page.clock.fastForward(HALF);
      await stage.screenshot({ path: `${dir}/${String(i).padStart(3, '0')}.png` });
    }
    console.log(`${id} ${FRAMES} コマ（1 コマ ${STEP} ミリ秒）`);
    await page.close();
  }
} finally {
  await browser.close();
}
