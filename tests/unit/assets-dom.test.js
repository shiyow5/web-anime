import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assets } from '../../src/assets/registry.js';
import { scrambleFrame } from '../../src/assets/text/scramble-text.js';
import { blobPath } from '../../src/assets/svg/blob-morph.js';
import { timeParts } from '../../src/assets/clock/flip-clock.js';
import { handAngles } from '../../src/assets/clock/analog-clock.js';
import { orbitFractions } from '../../src/assets/clock/orbit-clock.js';
import { clockText } from '../../src/assets/clock/particle-clock.js';
import { starPolygons } from '../../src/assets/fantasy/magic-circle.js';

// three.js を使わない素材は、テスト用の DOM でも実際に組み立てて片付けまで確かめる。
// WebGL を使う素材はブラウザーが要るので、tests/e2e で確かめる。
const domAssets = assets.filter((asset) => !asset.libs.includes('three'));

let container;
beforeEach(() => {
  // テスト用の DOM には document.fonts が無い。anime.js の文字分割が読むので、読み込み済みとして用意する。
  if (!document.fonts) {
    Object.defineProperty(document, 'fonts', { configurable: true, value: { status: 'loaded', ready: Promise.resolve(), addEventListener() {}, removeEventListener() {} } });
  }
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('DOM で動く素材', () => {
  it('three.js を使わない素材は 17 点ある', () => {
    expect(domAssets).toHaveLength(17);
  });

  describe.each([
    ['動きを減らす設定が無効', false],
    ['動きを減らす設定が有効', true],
  ])('%s', (_, reduced) => {
    beforeEach(() => {
      vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
    });

    it.each(domAssets.map((asset) => [asset.id, asset]))('%s は要素を入れ、destroy で元に戻す', (_, asset) => {
      const handle = asset.mount(container, { preview: true });
      expect(container.children.length).toBe(1);
      expect(container.firstElementChild.className).toContain('ua-');
      expect(typeof handle.destroy).toBe('function');
      handle.destroy();
      expect(container.children.length).toBe(0);
    });
  });

  it.each(domAssets.map((asset) => [asset.id, asset]))('%s はおかしな設定値を渡しても落ちない', (_, asset) => {
    const junk = Object.fromEntries(Object.keys(asset.params).map((key) => [key, { toString: () => '<script>' }]));
    const handle = asset.mount(container, junk);
    expect(container.querySelector('script')).toBeNull();
    handle.destroy();
  });
});

describe('scrambleFrame', () => {
  const glyph = () => '#';

  it('始まりは前の文のまま、終わりは次の文になる', () => {
    expect(scrambleFrame('abc', 'xyz', 0, glyph)).toEqual({ done: '', noise: '#', rest: 'bc' });
    expect(scrambleFrame('abc', 'xyz', 1, glyph)).toEqual({ done: 'xyz', noise: '', rest: '' });
  });

  it('途中では、確定・乱れ・未変更の順に並ぶ', () => {
    const frame = scrambleFrame('aaaaaaaaaa', 'bbbbbbbbbb', 0.5, glyph);
    expect(frame.done).toMatch(/^b+$/);
    expect(frame.noise).toMatch(/^#+$/);
    expect(frame.rest).toMatch(/^a+$/);
    expect(frame.done.length + frame.noise.length + frame.rest.length).toBe(10);
  });

  it('長さが違う文と、絵文字を含む文を扱える', () => {
    expect(scrambleFrame('abcdef', 'xy', 1, glyph).done).toBe('xy');
    expect(scrambleFrame('', '動き🎉', 1, glyph).done).toBe('動き🎉');
    expect(scrambleFrame('', '', 0.5, glyph)).toEqual({ done: '', noise: '', rest: '' });
  });

  it('空白は乱さない', () => {
    expect(scrambleFrame('', 'a b', 0.4, glyph).noise).not.toContain('# #'.replace(' ', '#'));
  });
});

describe('blobPath', () => {
  it('乱数が違っても、同じ数の数値でできた閉じた曲線を返す', () => {
    const a = blobPath(100, 100, 50, 0.2, () => 0.1);
    const b = blobPath(100, 100, 50, 0.2, () => 0.9);
    const numbers = (d) => d.match(/-?\d+\.\d/g).length;
    expect(a).not.toBe(b);
    expect(numbers(a)).toBe(numbers(b));
    expect(a.startsWith('M')).toBe(true);
    expect(a.endsWith('Z')).toBe(true);
    expect(a.match(/C/g)).toHaveLength(8);
  });
});

describe('時計の計算', () => {
  const at = (h, m, s, ms = 0) => new Date(2026, 0, 15, h, m, s, ms);

  it('timeParts は 2 桁ずつに分け、12 時間制では 0 時と 12 時を 12 と表す', () => {
    expect(timeParts(at(9, 5, 7))).toEqual(['09', '05', '07']);
    expect(timeParts(at(23, 59, 59))).toEqual(['23', '59', '59']);
    expect(timeParts(at(0, 0, 0), true)).toEqual(['12', '00', '00']);
    expect(timeParts(at(12, 30, 0), true)).toEqual(['12', '30', '00']);
    expect(timeParts(at(15, 4, 0), true)).toEqual(['03', '04', '00']);
  });

  it('handAngles は 0 時からの経過で針の角度を返す', () => {
    expect(handAngles(at(0, 0, 0))).toEqual({ hour: 0, minute: 0, second: 0, wholeSecond: 0 });
    const three = handAngles(at(3, 0, 0));
    expect(three.hour).toBe(90);
    expect(three.minute).toBe(1080);
    const half = handAngles(at(6, 30, 15, 500));
    expect(half.hour).toBeCloseTo(195.129, 2);
    expect(half.second).toBeCloseTo(half.wholeSecond + 3, 5);
  });

  it('handAngles は 59 秒から 0 秒へ進んでも角度が増え続ける', () => {
    expect(handAngles(at(1, 2, 0)).wholeSecond).toBeGreaterThan(handAngles(at(1, 1, 59)).wholeSecond);
  });

  it('orbitFractions は時・分・秒の進み具合を 0〜1 で返す', () => {
    expect(orbitFractions(at(0, 0, 0))).toEqual({ hour: 0, minute: 0, second: 0 });
    const f = orbitFractions(at(18, 30, 45, 900));
    expect(f.hour).toBeCloseTo(6.5127 / 12, 3);
    expect(f.minute).toBeCloseTo(30.765 / 60, 4);
    expect(f.second).toBe(0.75);
  });

  it('clockText は秒の有無を切り替えられる', () => {
    expect(clockText(at(7, 8, 9))).toBe('07:08:09');
    expect(clockText(at(7, 8, 9), false)).toBe('07:08');
  });
});

describe('starPolygons', () => {
  const corners = (pieces) => new Set(pieces.flatMap((piece) => piece.split(' '))).size;

  it.each([5, 6, 7, 8, 9])('%i 頂点でも、すべての頂点を通る星になる', (points) => {
    const pieces = starPolygons(100, points);
    expect(corners(pieces)).toBe(points);
    for (const piece of pieces) expect(piece.split(' ').length).toBeGreaterThanOrEqual(3);
  });

  it('6 頂点は 2 つの三角形を重ねる', () => {
    expect(starPolygons(100, 6)).toHaveLength(2);
    expect(starPolygons(100, 7)).toHaveLength(1);
  });
});
