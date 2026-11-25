import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertContainer, createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot, s } from '../../src/lib/dom.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('assertContainer', () => {
  it('HTML 要素はそのまま返す', () => {
    const el = document.createElement('div');
    expect(assertContainer(el)).toBe(el);
  });

  it('要素でなければ TypeError にする', () => {
    expect(() => assertContainer(null)).toThrow(TypeError);
    expect(() => assertContainer('#app')).toThrow('HTML 要素');
    expect(() => assertContainer(document.createTextNode('x'))).toThrow(TypeError);
  });
});

describe('h / s', () => {
  it('属性、スタイル、子要素を組み立てる', () => {
    const el = h('div', { class: 'a', 'data-x': 1, hidden: false, style: { color: 'red', '--v': '3px' } }, h('span', { text: 'hi' }), null, 'text');
    expect(el.className).toBe('a');
    expect(el.dataset.x).toBe('1');
    expect(el.hasAttribute('hidden')).toBe(false);
    expect(el.style.color).toBe('red');
    expect(el.style.getPropertyValue('--v')).toBe('3px');
    expect(el.textContent).toBe('hitext');
  });

  it('true の属性は空文字で付き、配列の子は展開する', () => {
    const el = h('button', { disabled: true }, [h('i'), h('b')]);
    expect(el.getAttribute('disabled')).toBe('');
    expect(el.children).toHaveLength(2);
  });

  it('text はタグとして解釈されない', () => {
    const el = h('p', { text: '<img src=x onerror=alert(1)>' });
    expect(el.children).toHaveLength(0);
    expect(el.textContent).toContain('<img');
  });

  it('s は SVG の名前空間で要素を作る', () => {
    const circle = s('circle', { cx: 5, r: 2 });
    expect(circle.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(circle.getAttribute('cx')).toBe('5');
    expect(circle.hasAttribute('svg')).toBe(false);
  });
});

describe('injectStyle', () => {
  it('同じ id のスタイルは 1 回だけ入れる', () => {
    injectStyle('unit-test', '.x{color:red}');
    injectStyle('unit-test', '.x{color:blue}');
    const styles = document.querySelectorAll('#ua-style-unit-test');
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toContain('red');
  });
});

describe('createRoot / removeRoot', () => {
  it('根元の要素を入れ、static の入れ物を relative にする', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container, 'ua-test', { '--c': '#fff' });
    expect(container.firstChild).toBe(root);
    expect(root.className).toBe('ua-test');
    expect(root.style.getPropertyValue('--c')).toBe('#fff');
    expect(container.style.position).toBe('relative');
    removeRoot(root);
    expect(container.children).toHaveLength(0);
  });

  it('入れ物が要素でなければエラーにする', () => {
    expect(() => createRoot(undefined, 'x')).toThrow(TypeError);
  });
});

describe('createDisposer', () => {
  it('登録の逆順で片付け、2 回目は何もしない', () => {
    const calls = [];
    const disposer = createDisposer();
    disposer.add(() => calls.push('a'));
    disposer.add(() => calls.push('b'));
    disposer.run();
    disposer.run();
    expect(calls).toEqual(['b', 'a']);
  });

  it('イベントとタイマーを外す', () => {
    vi.useFakeTimers();
    const disposer = createDisposer();
    const el = document.createElement('div');
    const onClick = vi.fn();
    const onTime = vi.fn();
    disposer.listen(el, 'click', onClick);
    disposer.timeout(onTime, 100);
    disposer.interval(onTime, 100);
    el.dispatchEvent(new Event('click'));
    disposer.run();
    el.dispatchEvent(new Event('click'));
    vi.advanceTimersByTime(500);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onTime).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('片付けの 1 つが失敗しても、残りを続ける', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = vi.fn();
    const disposer = createDisposer();
    disposer.add(after);
    disposer.add(() => {
      throw new Error('boom');
    });
    disposer.run();
    expect(after).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });
});

describe('localPointer / prefersReducedMotion', () => {
  it('要素内の位置を 0〜1 で返す', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ left: 100, top: 50, width: 200, height: 100 });
    const point = localPointer({ clientX: 150, clientY: 100 }, el);
    expect(point).toMatchObject({ x: 0.25, y: 0.5, px: 50, py: 50 });
  });

  it('大きさが 0 の要素では中央を返す', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
    expect(localPointer({ clientX: 10, clientY: 10 }, el)).toMatchObject({ x: 0.5, y: 0.5 });
  });

  it('matchMedia の結果を返す', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(prefersReducedMotion()).toBe(true);
    vi.stubGlobal('matchMedia', undefined);
    expect(prefersReducedMotion()).toBe(false);
    vi.unstubAllGlobals();
  });
});
