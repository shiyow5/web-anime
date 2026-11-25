import { animate, createDrawable, stagger, utils } from 'animejs';
import { createRoot, h, injectStyle, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

const VARIANTS = [
  { value: 'dots', label: '跳ねる点' },
  { value: 'bars', label: '伸び縮みする棒' },
  { value: 'ring', label: '描かれる輪' },
  { value: 'morph', label: '形を変える四角' },
  { value: 'grid', label: '脈打つ格子' },
  { value: 'counter', label: '数字と進捗の線' },
];

export const meta = {
  id: 'loader-set',
  title: 'ローダー 6 種',
  category: 'loader',
  libs: ['animejs'],
  description:
    '読み込み中に出す小さなアニメーションを 6 種類まとめました。跳ねる点、伸び縮みする棒、描かれる輪、形を変える四角、脈打つ格子、数字と進捗の線です。1 種類だけを大きく出すこともできます。',
  params: {
    variant: { type: 'select', label: '表示する種類', options: [{ value: 'all', label: '6 種類すべて' }, ...VARIANTS], default: 'all' },
    color: { type: 'color', label: '色', default: '#2438f5' },
    background: { type: 'color', label: '背景色', default: '#f4f5f9' },
    speed: { type: 'range', label: '速さ', min: 0.3, max: 3, step: 0.1, default: 1 },
  },
};

const CSS = `
.ua-ls{position:absolute;inset:0;display:grid;grid-template-columns:repeat(3,1fr);place-items:center;overflow:hidden;
  container-type:size;padding:4%;background:var(--ua-bg);color:var(--ua-color);
  font-family:var(--ua-display,system-ui,sans-serif)}
.ua-ls--single{grid-template-columns:1fr}
.ua-ls__cell{display:grid;justify-items:center;gap:1.4em;font-size:clamp(8px,2.2cqw,18px)}
.ua-ls--single .ua-ls__cell{font-size:clamp(14px,5cqw,40px)}
.ua-ls__stage{display:flex;align-items:center;justify-content:center;width:5em;height:5em}
.ua-ls__name{margin:0;font-size:clamp(10px,.8em,14px);color:color-mix(in srgb,var(--ua-color) 30%,#444)}
.ua-ls--single .ua-ls__name{display:none}
.ua-ls__dots{display:flex;gap:.6em}
.ua-ls__dots i{width:.9em;height:.9em;border-radius:50%;background:currentColor}
.ua-ls__bars{display:flex;align-items:center;gap:.4em;height:3.4em}
.ua-ls__bars i{width:.5em;height:100%;border-radius:.3em;background:currentColor}
.ua-ls__ring{width:4em;height:4em;fill:none;stroke:currentColor;stroke-width:5;stroke-linecap:round}
.ua-ls__morph{width:2.8em;height:2.8em;border-radius:18%;background:currentColor}
.ua-ls__grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.35em;width:3.4em}
.ua-ls__grid i{aspect-ratio:1;border-radius:20%;background:currentColor}
.ua-ls__counter{display:grid;gap:.5em;width:5em;text-align:center}
.ua-ls__counter b{font-size:1.5em;font-weight:800;font-variant-numeric:tabular-nums;line-height:1}
.ua-ls__counter span{display:block;height:.3em;border-radius:.2em;background:color-mix(in srgb,currentColor 18%,transparent);overflow:hidden}
.ua-ls__counter span i{display:block;height:100%;background:currentColor;transform-origin:left;transform:scaleX(0)}
`;

const spans = (n) => Array.from({ length: n }, () => h('i'));

// 種類ごとに、要素を作る build と、動かす play を持つ。play は止めるときに使う対象の配列を返す。
const LOADERS = {
  dots: {
    build: () => h('div', { class: 'ua-ls__dots' }, spans(3)),
    play(el, t) {
      const dots = [...el.children];
      animate(dots, {
        y: [
          { to: '-1.1em', duration: t(320), ease: 'outQuad' },
          { to: '0em', duration: t(320), ease: 'inQuad' },
        ],
        delay: stagger(t(130)),
        loop: true,
        loopDelay: t(260),
      });
      return dots;
    },
  },
  bars: {
    build: () => h('div', { class: 'ua-ls__bars' }, spans(5)),
    play(el, t) {
      const bars = [...el.children];
      animate(bars, { scaleY: [0.25, 1], duration: t(480), ease: 'inOutSine', delay: stagger(t(90)), alternate: true, loop: true });
      return bars;
    },
  },
  ring: {
    build: () => s('svg', { class: 'ua-ls__ring', viewBox: '0 0 48 48' }, s('circle', { cx: 24, cy: 24, r: 19 })),
    play(el, t) {
      const drawable = createDrawable(el.firstChild);
      animate(drawable, { draw: ['0 0', '0 1', '1 1'], duration: t(1700), ease: 'inOutQuad', loop: true });
      animate(el, { rotate: 360, duration: t(2300), ease: 'linear', loop: true });
      return [el, ...drawable];
    },
  },
  morph: {
    build: () => h('div', { class: 'ua-ls__morph' }),
    play(el, t) {
      animate(el, {
        rotate: [0, 180],
        borderRadius: [{ to: '50%' }, { to: '18%' }],
        scale: [{ to: 0.6 }, { to: 1 }],
        duration: t(1500),
        ease: 'inOutQuart',
        loop: true,
      });
      return [el];
    },
  },
  grid: {
    build: () => h('div', { class: 'ua-ls__grid' }, spans(9)),
    play(el, t) {
      const cells = [...el.children];
      animate(cells, {
        scale: [1, 0.2],
        opacity: [1, 0.35],
        duration: t(600),
        ease: 'inOutQuad',
        delay: stagger(t(120), { grid: [3, 3], from: 'center' }),
        alternate: true,
        loop: true,
      });
      return cells;
    },
  },
  counter: {
    build: () => h('div', { class: 'ua-ls__counter' }, h('b', { text: '0%' }), h('span', {}, h('i'))),
    play(el, t) {
      const state = { value: 0 };
      const number = el.querySelector('b');
      const fill = el.querySelector('i');
      animate(state, {
        value: [0, 100],
        duration: t(2600),
        ease: 'inOutQuart',
        loop: true,
        loopDelay: t(600),
        onUpdate() {
          number.textContent = `${Math.round(state.value)}%`;
          fill.style.transform = `scaleX(${state.value / 100})`;
        },
      });
      return [state];
    },
  },
};

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const single = p.variant !== 'all';
  const root = createRoot(container, `ua-ls${single ? ' ua-ls--single' : ''}`, { '--ua-bg': p.background, '--ua-color': p.color });
  root.setAttribute('role', 'status');
  root.setAttribute('aria-label', '読み込み中');
  const reduced = prefersReducedMotion();
  const t = (ms) => ms / p.speed;
  const tracked = [];

  for (const { value, label } of VARIANTS.filter((v) => !single || v.value === p.variant)) {
    const el = LOADERS[value].build();
    root.appendChild(h('div', { class: 'ua-ls__cell' }, h('div', { class: 'ua-ls__stage' }, el), h('p', { class: 'ua-ls__name', text: label })));
    if (!reduced) tracked.push(...LOADERS[value].play(el, t));
  }

  return {
    destroy() {
      utils.remove(tracked);
      removeRoot(root);
    },
  };
}
