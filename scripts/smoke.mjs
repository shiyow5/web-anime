// 素材を 1 点ずつブラウザーで開き、エラーの有無を確かめて画面を保存する。
// 全素材のテスト（npm run e2e）は時間がかかるので、素材を書いている最中の確認に使う。
//
//   先に開発用サーバーを起動しておく:  npx vite --port 5190 --strictPort
//   使い方:                          node scripts/smoke.mjs <素材の id> [<id> ...]
//
// 素材ごとに 2 枚の画像を test-results/smoke/ に保存する。
//   <id>.png          個別ページでの表示（幅 900px ほどの大きな枠）
//   <id>-preview.png  一覧の小さな枠と同じ条件（幅 380px、preview: true）での表示

import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const PORT = process.env.SMOKE_PORT ?? '5190';
const BASE = `http://localhost:${PORT}`;
const WAIT = Number(process.env.SMOKE_WAIT ?? 3500);
const OUT = 'test-results/smoke';
const ids = process.argv.slice(2).filter((arg) => /^[a-z][a-z0-9-]+$/.test(arg));

if (ids.length === 0) {
  console.error('素材の id を 1 つ以上指定してください。例: node scripts/smoke.mjs liquid-orb');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

function watch(page, problems) {
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error') problems.push(`error: ${text}`);
    else if (message.type() === 'warning' && /WebGL|context|deprecated/i.test(text)) problems.push(`warning: ${text}`);
  });
}

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let failed = false;

try {
  for (const id of ids) {
    const problems = [];

    // 個別ページ。ポインターを動かし、クリックもしてみる。
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    // マシンが混んでいると表示に時間がかかる。待ち時間を長めに取る。
    page.setDefaultTimeout(120_000);
    watch(page, problems);
    await page.goto(`${BASE}/demo.html?id=${id}`);
    const stage = page.locator('#stage');
    if (await stage.locator('.frame-error').count()) problems.push('個別ページに「表示できませんでした」が出ています');
    await page.waitForTimeout(WAIT);
    await page.mouse.move(300, 300);
    await page.mouse.move(620, 480, { steps: 8 });
    await stage.screenshot({ path: `${OUT}/${id}.png` });
    await page.mouse.click(450, 420);
    await page.waitForTimeout(600);
    await page.close();

    // 一覧の小さな枠と同じ条件。表示して画面を撮り、片付けて要素が残らないことを見る。
    const small = await browser.newPage({ viewport: { width: 420, height: 340 } });
    small.setDefaultTimeout(120_000);
    watch(small, problems);
    await small.goto(`${BASE}/demo.html?id=none`);
    const result = await small.evaluate(
      async ({ assetId, wait }) => {
        const { findAsset } = await import('/src/assets/registry.js');
        const asset = findAsset(assetId);
        if (!asset) return { missing: true };
        document.body.replaceChildren();
        const frame = document.createElement('div');
        Object.assign(frame.style, { position: 'fixed', left: '20px', top: '20px', width: '380px', height: '285px', overflow: 'hidden', background: '#0d0e14' });
        document.body.appendChild(frame);
        const handle = asset.mount(frame, { preview: true });
        await new Promise((resolve) => setTimeout(resolve, wait));
        window.__smoke = { frame, handle };
        return { missing: false };
      },
      { assetId: id, wait: WAIT },
    );
    if (result.missing) {
      problems.push(`registry に ${id} がありません。ファイル名と meta.id が同じか確かめてください`);
    } else {
      await small.screenshot({ path: `${OUT}/${id}-preview.png` });
      const left = await small.evaluate(() => {
        window.__smoke.handle.destroy();
        return window.__smoke.frame.childElementCount;
      });
      if (left !== 0) problems.push(`destroy のあとに要素が ${left} 個残っています`);
    }
    await small.close();

    if (problems.length) {
      failed = true;
      console.log(`NG  ${id}`);
      for (const problem of [...new Set(problems)].slice(0, 8)) console.log(`    ${problem.slice(0, 400)}`);
    } else {
      console.log(`OK  ${id}  →  ${OUT}/${id}.png, ${OUT}/${id}-preview.png`);
    }
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
