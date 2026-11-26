import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// gallery.spec.js が「開いてエラーが出ない」ことを見るのに対して、
// こちらは操作、スマートフォンの幅、動きを減らす設定、くり返しの表示と片付けを確かめる。

const ASSET_DIR = join(import.meta.dirname, '../../src/assets');
const assetIds = readdirSync(ASSET_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((dir) => readdirSync(join(ASSET_DIR, dir.name)))
  .filter((file) => file.endsWith('.js'))
  .map((file) => file.replace(/\.js$/, ''))
  .sort();

// エラーに加えて、WebGL の使いすぎやコンテキスト消失、廃止予定の API を使ったときの警告も問題として集める。
function collectProblems(page) {
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error') problems.push(`console: ${text}`);
    else if (message.type() === 'warning' && /WebGL|context|deprecated/i.test(text)) problems.push(`warning: ${text}`);
  });
  return problems;
}

for (const id of assetIds) {
  test(`${id} はポインター操作とクリックに耐える`, async ({ page }) => {
    const problems = collectProblems(page);
    await page.goto(`/demo.html?id=${id}`);
    const stage = page.locator('#stage');
    await expect(stage.locator('> *').first()).toBeVisible();
    const box = await stage.boundingBox();
    const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];

    await page.mouse.move(...at(0.2, 0.3));
    await page.mouse.move(...at(0.8, 0.7), { steps: 12 });
    await page.mouse.move(...at(0.5, 0.5), { steps: 6 });
    await page.mouse.down();
    await page.waitForTimeout(300);
    await page.mouse.up();
    await page.mouse.click(...at(0.3, 0.6));
    await page.mouse.click(...at(0.7, 0.4));
    await page.mouse.wheel(0, 400);
    await page.mouse.move(box.x + box.width + 40, box.y + 20);
    await page.waitForTimeout(900);

    await expect(stage.locator('> *').first()).toBeVisible();
    await expect(stage.locator('.frame-error')).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test(`${id} はスマートフォンの幅で表示できる`, async ({ page }) => {
    const problems = collectProblems(page);
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(`/demo.html?id=${id}`);
    const stage = page.locator('#stage');
    await expect(stage.locator('> *').first()).toBeVisible();
    await page.touchscreen?.tap?.(195, 300).catch(() => {});
    await page.waitForTimeout(900);
    const metrics = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      stageHeight: document.querySelector('#stage').getBoundingClientRect().height,
    }));
    expect(metrics.overflow).toBeLessThanOrEqual(0);
    expect(metrics.stageHeight).toBeGreaterThan(200);
    await page.screenshot({ path: `test-results/shots-mobile/${id}.png` });
    expect(problems).toEqual([]);
  });

  test(`${id} は動きを減らす設定でも表示できる`, async ({ page }) => {
    const problems = collectProblems(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/demo.html?id=${id}`);
    const stage = page.locator('#stage');
    await expect(stage.locator('> *').first()).toBeVisible();
    await page.mouse.click(400, 400);
    await page.waitForTimeout(600);
    await expect(stage.locator('.frame-error')).toHaveCount(0);
    expect(problems).toEqual([]);
  });
}

// 素材の点数に比例して時間がかかる。GPU の無い環境で 122 点を 4 回ずつ表示できるだけの余裕を取る。
test('全素材を 4 回ずつ表示して片付けても、要素・イベント・タイマーが残らない', async ({ page }) => {
  test.setTimeout(1_500_000);
  const problems = collectProblems(page);
  await page.goto('/demo.html?id=none');
  const report = await page.evaluate(async () => {
    const { assets } = await import('/src/assets/registry.js');

    // window と document に付けたイベントの数、動いているタイマーの数を数える。
    const listeners = new Map();
    const key = (target, type, handler) => `${target === window ? 'window' : 'document'}:${type}:${handlerIds.get(handler)}`;
    const handlerIds = new WeakMap();
    let nextId = 0;
    const idOf = (handler) => {
      if (!handlerIds.has(handler)) handlerIds.set(handler, (nextId += 1));
      return handlerIds.get(handler);
    };
    for (const target of [window, document]) {
      const add = target.addEventListener.bind(target);
      const remove = target.removeEventListener.bind(target);
      target.addEventListener = (type, handler, options) => {
        if (handler) {
          idOf(handler);
          listeners.set(key(target, type, handler), type);
        }
        return add(type, handler, options);
      };
      target.removeEventListener = (type, handler, options) => {
        if (handler && handlerIds.has(handler)) listeners.delete(key(target, type, handler));
        return remove(type, handler, options);
      };
    }
    const intervals = new Set();
    const timeouts = new Set();
    const nativeSetInterval = window.setInterval.bind(window);
    const nativeClearInterval = window.clearInterval.bind(window);
    const nativeSetTimeout = window.setTimeout.bind(window);
    const nativeClearTimeout = window.clearTimeout.bind(window);
    window.setInterval = (fn, ms, ...rest) => {
      const id = nativeSetInterval(fn, ms, ...rest);
      intervals.add(id);
      return id;
    };
    window.clearInterval = (id) => {
      intervals.delete(id);
      nativeClearInterval(id);
    };
    window.setTimeout = (fn, ms, ...rest) => {
      const id = nativeSetTimeout(
        (...args) => {
          timeouts.delete(id);
          fn(...args);
        },
        ms,
        ...rest,
      );
      // すぐ終わる短いタイマーは数えない。長く残るものだけを漏れとして扱う。
      if (ms >= 1000) timeouts.add(id);
      return id;
    };
    window.clearTimeout = (id) => {
      timeouts.delete(id);
      nativeClearTimeout(id);
    };

    const wait = (ms) => new Promise((resolve) => nativeSetTimeout(resolve, ms));
    const container = document.createElement('div');
    Object.assign(container.style, { position: 'fixed', left: '0', top: '0', width: '640px', height: '420px' });
    document.body.appendChild(container);

    const leaks = [];
    for (const asset of assets) {
      const before = { listeners: listeners.size, intervals: intervals.size, timeouts: timeouts.size };
      for (let round = 0; round < 4; round += 1) {
        const handle = asset.mount(container, { preview: round % 2 === 0 });
        await wait(160);
        handle.destroy();
        await wait(40);
        if (container.childElementCount !== 0) leaks.push(`${asset.id}: destroy 後に要素が ${container.childElementCount} 個残った`);
        container.replaceChildren();
      }
      await wait(60);
      if (listeners.size !== before.listeners) leaks.push(`${asset.id}: イベントが ${listeners.size - before.listeners} 個残った（${[...listeners.values()].join(', ')}）`);
      if (intervals.size !== before.intervals) leaks.push(`${asset.id}: setInterval が ${intervals.size - before.intervals} 個残った`);
      if (timeouts.size !== before.timeouts) leaks.push(`${asset.id}: setTimeout が ${timeouts.size - before.timeouts} 個残った`);
    }
    return { count: assets.length, leaks, canvases: document.querySelectorAll('canvas').length };
  });
  expect(report.count).toBe(assetIds.length);
  expect(report.leaks).toEqual([]);
  expect(report.canvases).toBe(0);
  expect(problems).toEqual([]);
});

test('一覧を端まで往復しても、WebGL の上限に当たらない', async ({ page }) => {
  test.setTimeout(900_000);
  const problems = collectProblems(page);
  await page.goto('/');
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 450) {
    await page.mouse.wheel(0, 450);
    await page.waitForTimeout(350);
  }
  const atBottom = await page.evaluate(() => document.querySelectorAll('canvas').length);
  for (let y = height; y > 0; y -= 900) {
    await page.mouse.wheel(0, -900);
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(500);
  const atTop = await page.evaluate(() => document.querySelectorAll('canvas').length);
  // 見えている枠の分だけが動いていればよい。全素材ぶんが残っていたら片付けが効いていない。
  expect(atBottom).toBeLessThanOrEqual(10);
  expect(atTop).toBeLessThanOrEqual(10);
  expect(problems).toEqual([]);
});
