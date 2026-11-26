import { animate, spring, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams, splitList } from '../../lib/params.js';

export const meta = {
  id: 'jelly-buttons',
  title: 'ぷるぷるのボタン',
  category: 'fancy',
  libs: ['animejs'],
  description:
    '形と色の違う 4 つのボタンが並びます。押すとゼリーのように横へつぶれ、離すと揺れながら元の形に戻って、小さな粒が跳ねます。申し込みや購入のボタン、ゲームのメニュー、子ども向けの画面に使えます。',
  params: {
    color1: { type: 'color', label: '色 1', default: '#ff8fab' },
    color2: { type: 'color', label: '色 2', default: '#ffd166' },
    color3: { type: 'color', label: '色 3', default: '#7bdcb5' },
    color4: { type: 'color', label: '色 4', default: '#a5b4fc' },
    background: { type: 'color', label: '背景色', default: '#f4fbf6' },
    wobble: { type: 'range', label: '揺れの大きさ', min: 0.3, max: 2, step: 0.1, default: 1 },
    labels: { type: 'text', label: '文字（カンマ区切りで 4 つ）', default: 'はじめる, OK, ぷるん, もういちど', maxLength: 60 },
  },
};

const CSS = `
.ua-jb{position:absolute;inset:0;overflow:hidden;container-type:size;background-color:var(--ua-bg);
  background-image:radial-gradient(circle,color-mix(in srgb,var(--ua-c3) 30%,transparent) 0 3px,transparent 3.5px),radial-gradient(circle,color-mix(in srgb,var(--ua-c1) 24%,transparent) 0 2px,transparent 2.5px);
  background-size:44px 44px,44px 44px;background-position:0 0,22px 22px;font-family:var(--ua-display,system-ui,sans-serif)}
.ua-jb__grid{position:absolute;inset:0;display:grid;grid-template-columns:auto auto;justify-content:center;align-content:center;
  justify-items:center;align-items:center;column-gap:9cqmin;row-gap:11cqmin}
.ua-jb__btn{position:relative;display:block;padding:0;border:0;background:none;font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;
  touch-action:manipulation;outline:none}
.ua-jb__body{position:relative;display:grid;place-items:center;width:var(--w);height:var(--h);border-radius:var(--r);transform-origin:50% 100%;
  background:linear-gradient(180deg,color-mix(in srgb,var(--c) 62%,#fff) 0%,var(--c) 52%,color-mix(in srgb,var(--c) 84%,#5a3d7a) 100%);
  box-shadow:inset 0 -1.6cqmin 2.4cqmin color-mix(in srgb,var(--c) 70%,#5a3d7a),inset 0 1cqmin 1.4cqmin rgba(255,255,255,.65),
    0 0 0 .5cqmin color-mix(in srgb,var(--c) 55%,#fff)}
.ua-jb__btn:focus-visible .ua-jb__body{box-shadow:inset 0 -1.6cqmin 2.4cqmin color-mix(in srgb,var(--c) 70%,#5a3d7a),inset 0 1cqmin 1.4cqmin rgba(255,255,255,.65),
    0 0 0 .5cqmin #fff,0 0 0 1.1cqmin color-mix(in srgb,var(--c) 60%,#3b2a5c)}
.ua-jb__gloss{position:absolute;left:14%;right:14%;top:8%;height:34%;border-radius:999px;
  background:linear-gradient(180deg,rgba(255,255,255,.85),rgba(255,255,255,.08));pointer-events:none}
.ua-jb__spark{position:absolute;right:16%;bottom:20%;width:1.6cqmin;height:1.6cqmin;border-radius:50%;background:rgba(255,255,255,.7);pointer-events:none}
.ua-jb__label{position:relative;font-size:4.6cqmin;font-weight:800;letter-spacing:.06em;white-space:nowrap;
  color:color-mix(in srgb,var(--c) 30%,#3b2a5c);text-shadow:0 .25cqmin 0 rgba(255,255,255,.55)}
.ua-jb__shadow{position:absolute;left:8%;right:8%;bottom:-3.4cqmin;height:3cqmin;border-radius:50%;
  background:color-mix(in srgb,var(--c) 45%,#8a7aa8);opacity:.3;filter:blur(.8cqmin);pointer-events:none}
.ua-jb__drop{position:absolute;left:50%;top:0;width:1.8cqmin;height:1.8cqmin;margin-left:-.9cqmin;border-radius:50%;background:var(--c);
  box-shadow:inset 0 .3cqmin .3cqmin rgba(255,255,255,.7);pointer-events:none;opacity:0}
`;

// [幅, 高さ, 角の丸み]。単位は入れ物の短い辺に対する割合。
const SHAPES = [
  ['46cqmin', '19cqmin', '999px'],
  ['25cqmin', '25cqmin', '50%'],
  ['30cqmin', '23cqmin', '58% 42% 52% 48% / 55% 52% 48% 45%'],
  ['44cqmin', '21cqmin', '7cqmin'],
];
const DEFAULT_LABELS = ['はじめる', 'OK', 'ぷるん', 'もういちど'];
const DROPS = 5;

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const colors = [p.color1, p.color2, p.color3, p.color4];
  const root = createRoot(container, 'ua-jb', { '--ua-bg': p.background, '--ua-c1': p.color1, '--ua-c3': p.color3 });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const given = splitList(p.labels, { maxItems: 4, maxLength: 8 });
  const labels = DEFAULT_LABELS.map((fallback, i) => given[i] ?? fallback);
  const k = p.wobble;

  const items = SHAPES.map(([w, hgt, r], i) => {
    const body = h('span', { class: 'ua-jb__body' }, h('span', { class: 'ua-jb__gloss' }), h('span', { class: 'ua-jb__spark' }), h('span', { class: 'ua-jb__label', text: labels[i] }));
    const shadow = h('span', { class: 'ua-jb__shadow' });
    const drops = Array.from({ length: DROPS }, () => h('i', { class: 'ua-jb__drop' }));
    const button = h('button', { class: 'ua-jb__btn', type: 'button', style: { '--c': colors[i], '--w': w, '--h': hgt, '--r': r } }, shadow, drops, body);
    return { button, body, shadow, drops, pressed: false };
  });
  const grid = h('div', { class: 'ua-jb__grid' }, items.map((item) => item.button));
  root.appendChild(grid);

  function squash(item) {
    if (reduced || item.pressed) return;
    item.pressed = true;
    animate(item.body, { scaleX: 1 + 0.16 * k, scaleY: 1 - 0.24 * k, duration: 130, ease: 'outQuad' });
    animate(item.shadow, { scaleX: 1 + 0.22 * k, opacity: 0.42, duration: 130, ease: 'outQuad' });
  }

  // 縦と横で、ばねの硬さを少し変える。ずれて揺れるので、ゼリーらしく見える。
  function release(item) {
    if (reduced || !item.pressed) return;
    item.pressed = false;
    const unit = root.getBoundingClientRect().height / 100;
    animate(item.body, { scaleY: 1, ease: spring({ stiffness: 320, damping: 6.5 / Math.sqrt(k) }) });
    animate(item.body, { scaleX: 1, ease: spring({ stiffness: 250, damping: 6 / Math.sqrt(k) }) });
    animate(item.body, {
      skewX: [
        { to: 5 * k, duration: 110, ease: 'outQuad' },
        { to: 0, duration: 1100, ease: 'outElastic(1.2, .28)' },
      ],
    });
    animate(item.shadow, { scaleX: 1, opacity: 0.3, ease: spring({ stiffness: 250, damping: 7 }) });
    animate(item.drops, {
      x: { from: 0, to: (_, i) => (i - (DROPS - 1) / 2) * unit * utils.random(5, 9) },
      y: [
        { from: unit * 3, to: () => -unit * utils.random(9, 17), duration: 320, ease: 'outQuad' },
        { to: unit * 4, duration: 380, ease: 'inQuad' },
      ],
      scale: [
        { from: 0.4, to: 1, duration: 320 },
        { to: 0.3, duration: 380 },
      ],
      opacity: [
        { from: 1, to: 1, duration: 520 },
        { to: 0, duration: 180 },
      ],
      delay: stagger(25),
    });
  }

  function poke(index) {
    const item = items[((index % items.length) + items.length) % items.length];
    squash(item);
    disposer.timeout(() => release(item), 170);
  }

  for (const item of items) {
    disposer.listen(item.button, 'pointerdown', () => squash(item));
    disposer.listen(item.button, 'pointerup', () => release(item));
    disposer.listen(item.button, 'pointerleave', () => release(item));
    disposer.listen(item.button, 'pointercancel', () => release(item));
    // キーボードで押したときは位置の情報が無い。そのときも同じようにつぶす。
    disposer.listen(item.button, 'click', (event) => {
      if (event.detail === 0) poke(items.indexOf(item));
    });
  }

  if (!reduced) {
    animate(items.map((item) => item.button), {
      scale: [0, 1],
      delay: stagger(110, { start: 150 }),
      ease: spring({ stiffness: 160, damping: 8 }),
    });
    // 待っているあいだも、少しだけ息をするように揺れる。
    disposer.timeout(() => {
      animate(items.map((item) => item.button), {
        y: [0, -4],
        duration: 1500,
        delay: stagger(260),
        ease: 'inOutSine',
        alternate: true,
        loop: true,
      });
    }, 1400);
    if (p.preview) {
      let turn = 0;
      disposer.timeout(() => {
        disposer.interval(() => {
          poke(turn);
          turn += 1;
        }, 1000);
      }, 900);
    }
  }

  return {
    poke,
    destroy() {
      disposer.run();
      removeRoot(root);
    },
  };
}
