import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const ASSET_DIR = join(import.meta.dirname, '../../src/assets');
const assetIds = readdirSync(ASSET_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((dir) => readdirSync(join(ASSET_DIR, dir.name)))
  .filter((file) => file.endsWith('.js'))
  .map((file) => file.replace(/\.js$/, ''))
  .sort();

// ページ内で出たエラーを集める。シェーダーのコンパイル失敗は three.js が console.error に出す。
function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

test('一覧にすべての素材が並び、分類で絞り込める', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.locator('.tile')).toHaveCount(assetIds.length);
  await expect(page.locator('#lead-count')).toHaveText(String(assetIds.length));

  await page.getByRole('button', { name: /ローダー/ }).click();
  await expect(page.locator('.tile:visible')).toHaveCount(1);
  await expect(page.locator('.tile:visible .tile__title')).toHaveText('ローダー 6 種');

  await page.getByRole('button', { name: /すべて/ }).click();
  await expect(page.locator('.tile:visible')).toHaveCount(assetIds.length);
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/shots/_gallery.png' });
  expect(errors).toEqual([]);
});

test('一覧の枠をクリックすると個別ページへ移動する', async ({ page }) => {
  await page.goto('/');
  await page.locator('.tile__frame').first().click();
  await expect(page).toHaveURL(/demo\.html\?id=text-particles/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('文字になる粒', { timeout: 60_000 });
});

for (const id of assetIds) {
  test(`${id} がエラーなく表示される`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`/demo.html?id=${id}`);
    await expect(page.locator('#stage > *').first()).toBeVisible();
    await expect(page.locator('#stage .frame-error')).toHaveCount(0);
    await page.mouse.move(500, 400);
    await page.mouse.move(560, 440, { steps: 5 });
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `test-results/shots/${id}.png` });
    expect(errors).toEqual([]);
  });
}

test('設定を変えるとコード例に反映され、初期値に戻せる', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/demo.html?id=kinetic-headline');
  const code = page.locator('.code code');
  await expect(code).not.toContainText('preset');
  await page.getByLabel('動き方').selectOption('flip');
  await expect(code).toContainText('preset: "flip"');
  await page.getByRole('button', { name: '初期値に戻す' }).click();
  await expect(code).not.toContainText('preset');
  expect(errors).toEqual([]);
});

test('存在しない素材を指定すると、案内を表示する', async ({ page }) => {
  await page.goto('/demo.html?id=%3Cscript%3Ealert(1)%3C/script%3E');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('素材が見つかりません');
  await expect(page.getByRole('link', { name: '見本帳を開く' })).toBeVisible();
  expect(await page.locator('#panel script').count()).toBe(0);
});

test('スマートフォンの幅でも横にはみ出さない', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'test-results/shots/_gallery-mobile.png' });
});
