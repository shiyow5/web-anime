import { describe, expect, it } from 'vitest';
import { defaultsOf, diffFromDefaults, resolveParam, resolveParams, splitList } from '../../src/lib/params.js';

const specs = {
  count: { type: 'range', min: 10, max: 100, step: 1, default: 50 },
  color: { type: 'color', default: '#ff0000' },
  mode: { type: 'select', options: ['a', { value: 'b', label: 'B' }], default: 'a' },
  text: { type: 'text', default: 'hello', maxLength: 5 },
  loop: { type: 'boolean', default: true },
};

describe('resolveParam', () => {
  it('値が無いときは既定値を返す', () => {
    expect(resolveParam(specs.count, undefined)).toBe(50);
    expect(resolveParam(specs.color, null)).toBe('#ff0000');
  });

  it('range は範囲内に収め、数値でないものは既定値に戻す', () => {
    expect(resolveParam(specs.count, 5)).toBe(10);
    expect(resolveParam(specs.count, 999)).toBe(100);
    expect(resolveParam(specs.count, '42')).toBe(42);
    expect(resolveParam(specs.count, 'abc')).toBe(50);
    expect(resolveParam(specs.count, NaN)).toBe(50);
    expect(resolveParam(specs.count, Infinity)).toBe(50);
  });

  it('color は 6 桁の 16 進数だけを受け付ける', () => {
    expect(resolveParam(specs.color, '#00FFaa')).toBe('#00ffaa');
    expect(resolveParam(specs.color, 'red')).toBe('#ff0000');
    expect(resolveParam(specs.color, '#fff')).toBe('#ff0000');
    expect(resolveParam(specs.color, 'url(javascript:alert(1))')).toBe('#ff0000');
  });

  it('select は選択肢にある値だけを受け付ける', () => {
    expect(resolveParam(specs.mode, 'b')).toBe('b');
    expect(resolveParam(specs.mode, 'zzz')).toBe('a');
  });

  it('text は空文字を既定値に戻し、長すぎる文字列を切り詰める', () => {
    expect(resolveParam(specs.text, '   ')).toBe('hello');
    expect(resolveParam(specs.text, 'abcdefgh')).toBe('abcde');
    expect(resolveParam(specs.text, 123)).toBe('hello');
  });

  it('boolean は真偽値と文字列の true/false を受け付ける', () => {
    expect(resolveParam(specs.loop, false)).toBe(false);
    expect(resolveParam(specs.loop, 'false')).toBe(false);
    expect(resolveParam(specs.loop, 'true')).toBe(true);
    expect(resolveParam(specs.loop, 'yes')).toBe(true);
  });

  it('未対応の種類はエラーにする', () => {
    expect(() => resolveParam({ type: 'unknown', default: 1 }, 2)).toThrow('未対応');
    expect(() => resolveParam(undefined, 2)).toThrow('未対応');
  });
});

describe('resolveParams', () => {
  it('既定値で埋め、specs にない項目は通す', () => {
    const result = resolveParams(specs, { count: 20, preview: true });
    expect(result).toEqual({ count: 20, color: '#ff0000', mode: 'a', text: 'hello', loop: true, preview: true });
  });

  it('結果は凍結され、元のオブジェクトは変えない', () => {
    const options = { count: 999 };
    const result = resolveParams(specs, options);
    expect(Object.isFrozen(result)).toBe(true);
    expect(options).toEqual({ count: 999 });
    expect(result.count).toBe(100);
  });

  it('options がオブジェクトでなくても落ちない', () => {
    expect(resolveParams(specs, null).count).toBe(50);
    expect(resolveParams(specs, 'x').mode).toBe('a');
    expect(resolveParams()).toEqual({});
  });
});

describe('defaultsOf / diffFromDefaults', () => {
  it('既定値の一覧を返す', () => {
    expect(defaultsOf(specs)).toEqual({ count: 50, color: '#ff0000', mode: 'a', text: 'hello', loop: true });
    expect(defaultsOf()).toEqual({});
  });

  it('既定値から変えた項目だけを返す', () => {
    expect(diffFromDefaults(specs, { count: 50, color: '#00ff00', other: 1 })).toEqual({ color: '#00ff00' });
    expect(diffFromDefaults()).toEqual({});
  });
});

describe('splitList', () => {
  it('区切って前後の空白を除き、空要素を捨てる', () => {
    expect(splitList(' A, B ,,C ')).toEqual(['A', 'B', 'C']);
  });

  it('件数と 1 件の長さに上限をかける', () => {
    expect(splitList('a,b,c,d', { maxItems: 2 })).toEqual(['a', 'b']);
    expect(splitList('abcdef', { maxLength: 3 })).toEqual(['abc']);
    expect(splitList('a/b', { separator: '/' })).toEqual(['a', 'b']);
  });

  it('文字列でなければ空配列を返す', () => {
    expect(splitList(undefined)).toEqual([]);
    expect(splitList(42)).toEqual([]);
  });
});
