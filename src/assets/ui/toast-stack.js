import { animate, spring, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'toast-stack',
  title: '積み重なる通知',
  category: 'ui',
  libs: ['animejs'],
  description:
    '通知が横からばねの動きで入ってきて積み重なり、時間がたつと抜けて、残りが詰まります。成功・注意・失敗の 3 種類があり、乗せている間は消えません。戻り値の push(種類, 文) で、保存の完了や通信の失敗を知らせる場面に使います。',
  params: {
    position: {
      type: 'select',
      label: '出す位置',
      options: [
        { value: 'top', label: '右上' },
        { value: 'bottom', label: '右下' },
      ],
      default: 'top',
    },
    life: { type: 'range', label: '消えるまでの時間（秒）', min: 1.5, max: 10, step: 0.5, default: 4.5 },
    max: { type: 'range', label: '同時に出す数', min: 1, max: 5, step: 1, default: 4 },
    auto: { type: 'boolean', label: '自動で通知を出す', default: true },
    background: { type: 'color', label: '背景色', default: '#e9e6f2' },
  },
};

const CSS = `
.ua-ts{position:absolute;inset:0;overflow:hidden;container-type:size;background:var(--ua-bg);color:#231f36;
  font-family:var(--ua-display,system-ui,sans-serif)}
.ua-ts__in{position:absolute;inset:0;font-size:clamp(9px,min(2.3cqw,4.4cqh),16px)}
.ua-ts__panel{position:absolute;left:5cqw;top:50%;transform:translateY(-50%);display:grid;gap:.8em;width:min(17em,42cqw)}
.ua-ts__panel h2{margin:0;font-size:1.35em;font-weight:800;letter-spacing:-.01em}
.ua-ts__panel p{margin:0 0 .4em;font-size:.82em;line-height:1.6;opacity:.65}
.ua-ts__fire{display:flex;align-items:center;gap:.7em;padding:.7em 1em;border:1px solid #231f3622;border-radius:.8em;background:#fff;
  color:inherit;font:inherit;font-size:.9em;font-weight:700;text-align:left;cursor:pointer;box-shadow:0 1px 0 #231f3612}
.ua-ts__fire i{width:.7em;height:.7em;border-radius:50%;background:var(--c)}
.ua-ts__fire:hover{border-color:var(--c)}
.ua-ts__fire:focus-visible,.ua-ts__close:focus-visible{outline:3px solid #6a4cff;outline-offset:2px}
.ua-ts__stack{position:absolute;right:3.5cqw;width:min(19.5em,50cqw)}
.ua-ts__stack--top{top:3.5cqw}
.ua-ts__stack--bottom{bottom:3.5cqw}
.ua-ts__toast{position:absolute;right:0;width:100%;box-sizing:border-box;display:grid;grid-template-columns:auto 1fr auto;align-items:start;
  gap:.75em;padding:.85em .8em .95em .9em;border-radius:.9em;background:#1d1a2c;color:#f4f2fb;overflow:hidden;
  box-shadow:0 .8em 1.8em -0.6em #1d1a2c88,0 0 0 1px #ffffff14 inset;will-change:transform}
.ua-ts__stack--top .ua-ts__toast{top:0}
.ua-ts__stack--bottom .ua-ts__toast{bottom:0}
.ua-ts__icon{display:grid;place-items:center;width:1.7em;height:1.7em;border-radius:50%;background:var(--c);color:#1d1a2c}
.ua-ts__icon svg{width:1.05em;height:1.05em;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.ua-ts__body{min-width:0}
.ua-ts__body b{display:block;font-size:.92em;line-height:1.35}
.ua-ts__body span{display:block;margin-top:.2em;font-size:.78em;line-height:1.5;opacity:.7}
.ua-ts__close{display:grid;place-items:center;width:1.6em;height:1.6em;padding:0;border:0;border-radius:50%;background:#ffffff14;color:inherit;cursor:pointer}
.ua-ts__close svg{width:.8em;height:.8em;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round}
.ua-ts__life{position:absolute;left:0;right:0;bottom:0;height:.2em;background:var(--c);transform-origin:left;opacity:.9}
`;

const TYPES = {
  success: {
    color: '#3ddc97',
    label: '成功の通知を出す',
    icon: 'M5 12.5l4.5 4.5L19 7.5',
    samples: [
      ['保存しました', '下書き「11 月の請求書」を保存しました'],
      ['招待を送りました', '山田さんにメールが届きます'],
    ],
  },
  warning: {
    color: '#ffc145',
    label: '注意の通知を出す',
    icon: 'M12 6v7M12 17.5v.5',
    samples: [
      ['通信が不安定です', '再接続を試しています'],
      ['容量の残りが 10% です', '不要なファイルを整理してください'],
    ],
  },
  error: {
    color: '#ff6b6b',
    label: '失敗の通知を出す',
    icon: 'M7 7l10 10M17 7L7 17',
    samples: [
      ['アップロードできませんでした', 'ファイルが 20MB を超えています'],
      ['支払いが完了していません', 'カードの有効期限をご確認ください'],
    ],
  },
};
const ORDER = ['success', 'warning', 'error'];

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-ts', { '--ua-bg': p.background });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const fromTop = p.position === 'top';
  const max = p.preview ? Math.min(p.max, 3) : p.max;
  const settle = spring({ stiffness: 190, damping: 17 });
  const enter = spring({ stiffness: 170, damping: 14 });

  const stack = h('div', { class: `ua-ts__stack ua-ts__stack--${p.position}`, role: 'status', 'aria-live': 'polite' });
  const fires = ORDER.map((type) => {
    const button = h('button', { class: 'ua-ts__fire', type: 'button', style: { '--c': TYPES[type].color } }, h('i'), TYPES[type].label);
    disposer.listen(button, 'click', () => push(type));
    return button;
  });
  const panel = h('div', { class: 'ua-ts__panel' }, h('h2', { text: '通知の見本' }), h('p', { text: 'ボタンを押すと、右に通知が積み重なります。' }), fires);
  root.appendChild(h('div', { class: 'ua-ts__in' }, panel, stack));

  let items = [];
  let count = 0;
  let destroyed = false;
  let hovering = false;

  // 生きている通知を上（または下）から順に並べ直す。fresh は動かさずにその場へ置く。
  function layout(fresh, delay = 0) {
    const gap = parseFloat(getComputedStyle(stack).fontSize) * 0.6;
    let offset = 0;
    items
      .filter((item) => !item.leaving)
      .forEach((item, i) => {
        const y = fromTop ? offset : -offset;
        offset += item.el.offsetHeight + gap;
        if (item === fresh || reduced) utils.set(item.el, { y });
        else animate(item.el, { y, ease: settle, delay: delay + i * 40 });
      });
  }

  function dismiss(item) {
    if (item.leaving || destroyed) return;
    item.leaving = true;
    item.life?.pause();
    const drop = () => {
      item.el.remove();
      items = items.filter((other) => other !== item);
    };
    if (reduced) drop();
    else animate(item.el, { x: '118%', opacity: 0, scale: 0.94, duration: 340, ease: 'inQuart', onComplete: drop });
    layout(null, 140);
  }

  function push(type, text) {
    if (destroyed) return null;
    const kind = Object.hasOwn(TYPES, type) ? type : 'success';
    const spec = TYPES[kind];
    const [title, sample] = spec.samples[count % spec.samples.length];
    count += 1;
    const icon = h('span', { class: 'ua-ts__icon', 'aria-hidden': 'true' }, s('svg', { viewBox: '0 0 24 24' }, s('path', { d: spec.icon })));
    const close = h('button', { class: 'ua-ts__close', type: 'button', 'aria-label': '通知を閉じる' }, s('svg', { viewBox: '0 0 24 24' }, s('path', { d: 'M6 6l12 12M18 6L6 18' })));
    const lifeBar = h('i', { class: 'ua-ts__life' });
    const message = typeof text === 'string' && text.trim() ? text.slice(0, 80) : sample;
    const el = h('div', { class: 'ua-ts__toast', style: { '--c': spec.color } }, icon, h('div', { class: 'ua-ts__body' }, h('b', { text: title }), h('span', { text: message })), close, lifeBar);
    const item = { el, leaving: false, life: null };
    stack.appendChild(el);
    items.push(item);
    close.addEventListener('click', () => dismiss(item));

    const alive = items.filter((other) => !other.leaving);
    for (const old of alive.slice(0, Math.max(0, alive.length - max))) dismiss(old);
    layout(item);
    if (reduced) {
      lifeBar.style.display = 'none';
      return item.el;
    }

    animate(el, { x: ['118%', '0%'], opacity: [0, 1], ease: enter });
    animate(icon, { scale: [0, 1], rotate: [-60, 0], duration: 620, delay: 160, ease: 'outBack(2.4)' });
    item.life = animate(lifeBar, { scaleX: [1, 0], duration: p.life * 1000, ease: 'linear', onComplete: () => dismiss(item) });
    if (hovering) item.life.pause();
    return item.el;
  }

  // 通知に乗せている間は、消えるまでの時間を止める。
  disposer.listen(stack, 'pointerenter', () => {
    hovering = true;
    for (const item of items) item.life?.pause();
  });
  disposer.listen(stack, 'pointerleave', () => {
    hovering = false;
    for (const item of items) if (!item.leaving) item.life?.resume();
  });

  if (reduced) {
    ORDER.forEach((type) => push(type));
  } else if (p.auto || p.preview) {
    let turn = 0;
    const next = () => {
      if (hovering) return;
      push(ORDER[turn % ORDER.length]);
      turn += 1;
    };
    disposer.timeout(next, 350);
    disposer.timeout(next, 950);
    disposer.interval(next, p.preview ? 1500 : 2100);
  }

  return {
    push,
    destroy() {
      destroyed = true;
      disposer.run();
      removeRoot(root);
    },
  };
}
