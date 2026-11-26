import { describe, expect, it } from 'vitest';
import { CATEGORIES, LIB_LABELS, assets, categoryLabel, findAsset, libsLabel } from '../../src/assets/registry.js';
import { resolveParam } from '../../src/lib/params.js';

const PARAM_TYPES = ['range', 'color', 'select', 'text', 'boolean'];

describe('素材の一覧', () => {
  it('122 点の素材が載っている', () => {
    expect(assets).toHaveLength(122);
  });

  it('先頭は副文字盤が浮かぶ時計で、先頭に置く 36 点より後ろは同じ分類が続かない', () => {
    expect(assets[0].id).toBe('holo-chronograph');
    const rest = assets.slice(36, 36 + 34);
    for (let i = 1; i < rest.length; i += 1) expect(rest[i].category, rest[i].id).not.toBe(rest[i - 1].category);
  });

  it('id は重複せず、ファイル名と一致する', () => {
    const ids = assets.map((asset) => asset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const asset of assets) {
      expect(asset.id).toMatch(/^[a-z][a-z0-9-]+$/);
      expect(asset.path.endsWith(`/${asset.id}.js`)).toBe(true);
    }
  });

  it('どの分類にも 1 点以上の素材がある', () => {
    for (const category of CATEGORIES) {
      expect(assets.some((asset) => asset.category === category.id)).toBe(true);
    }
  });

  it.each(assets.map((asset) => [asset.id, asset]))('%s は決まった形の meta と mount を持つ', (_, asset) => {
    expect(typeof asset.mount).toBe('function');
    expect(asset.title.length).toBeGreaterThan(0);
    expect(asset.description.length).toBeGreaterThan(20);
    expect(CATEGORIES.map((c) => c.id)).toContain(asset.category);
    expect(asset.libs.length).toBeGreaterThan(0);
    for (const lib of asset.libs) expect(Object.keys(LIB_LABELS)).toContain(lib);
    for (const [key, spec] of Object.entries(asset.params)) {
      expect(PARAM_TYPES, `${key} の種類`).toContain(spec.type);
      expect(spec.label, `${key} の表示名`).toBeTruthy();
      // 既定値は、その設定自身の検証を通る値でなければならない。
      expect(resolveParam(spec, spec.default), `${key} の既定値`).toBe(spec.default);
    }
  });

  it('mount に要素以外を渡すと、分かる文面のエラーになる', () => {
    for (const asset of assets) {
      expect(() => asset.mount(null), asset.id).toThrow(TypeError);
    }
  });
});

describe('一覧の補助関数', () => {
  it('findAsset は id が合う素材を返し、無ければ null を返す', () => {
    expect(findAsset('liquid-orb')?.title).toBe('液体の球');
    expect(findAsset('nope')).toBeNull();
    expect(findAsset(null)).toBeNull();
    expect(findAsset({ id: 'liquid-orb' })).toBeNull();
  });

  it('分類とライブラリの表示名を返す', () => {
    expect(categoryLabel('ui')).toBe('UI 部品');
    expect(categoryLabel('unknown')).toBe('unknown');
    expect(libsLabel(['three', 'animejs'])).toBe('three.js + anime.js');
    expect(libsLabel(['other'])).toBe('other');
    expect(libsLabel()).toBe('');
  });
});
