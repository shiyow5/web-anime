import { animate, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'confetti-burst',
  title: '紙吹雪',
  category: 'ui',
  libs: ['animejs'],
  description:
    'ボタンを押すと、その場所から色とりどりの紙吹雪が弾けて、回りながら落ちていきます。申し込みの完了、目標の達成、当選の発表など、うれしい瞬間に使います。戻り値の burst() で、好きな位置から出せます。',
  params: {
    count: { type: 'range', label: '紙の枚数', min: 20, max: 240, step: 10, default: 110 },
    spread: { type: 'range', label: '広がり', min: 0.2, max: 1.5, step: 0.05, default: 0.8 },
    color1: { type: 'color', label: '色 1', default: '#ff4d6d' },
    color2: { type: 'color', label: '色 2', default: '#ffd23f' },
    color3: { type: 'color', label: '色 3', default: '#3a86ff' },
    color4: { type: 'color', label: '色 4', default: '#06d6a0' },
    background: { type: 'color', label: '背景色', default: '#fffaf0' },
  },
};

const CSS = `
.ua-cb{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;container-type:size;background:var(--ua-bg);
  font-family:var(--ua-display,system-ui,sans-serif)}
.ua-cb__btn{position:relative;z-index:2;padding:1em 2.2em;border:0;border-radius:999px;background:#1c1d29;color:#fff;font:inherit;
  font-size:clamp(13px,3cqw,22px);font-weight:700;cursor:pointer}
.ua-cb__btn:focus-visible{outline:3px solid #3a86ff;outline-offset:4px}
.ua-cb__piece{position:absolute;left:0;top:0;pointer-events:none;will-change:transform}
`;

const SHAPES = [
  { width: 10, height: 10, radius: '2px' },
  { width: 6, height: 16, radius: '1px' },
  { width: 9, height: 9, radius: '50%' },
  { width: 14, height: 5, radius: '1px' },
];
const LABEL = 'お祝いする';
const DONE_LABEL = 'おめでとうございます';
// 同時に画面へ出す紙の上限。連打しても要素が増え続けないようにする。
const MAX_LIVE_PIECES = 480;

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-cb', { '--ua-bg': p.background });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const colors = [p.color1, p.color2, p.color3, p.color4];
  const button = h('button', { class: 'ua-cb__btn', type: 'button', text: LABEL });
  const status = h('span', { role: 'status', style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)' } });
  root.append(button, status);
  let labelTimer = 0;
  let live = 0;
  let destroyed = false;

  // x, y は素材の左上からの位置（px）。省くとボタンの中央から出す。
  function burst(x, y) {
    if (destroyed) return;
    const rect = root.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const originX = Number.isFinite(x) ? x : buttonRect.left - rect.left + buttonRect.width / 2;
    const originY = Number.isFinite(y) ? y : buttonRect.top - rect.top + buttonRect.height / 2;
    status.textContent = DONE_LABEL;
    button.textContent = DONE_LABEL;
    clearTimeout(labelTimer);
    labelTimer = setTimeout(() => {
      button.textContent = LABEL;
      status.textContent = '';
    }, 1800);
    if (reduced || live >= MAX_LIVE_PIECES) return;

    const amount = Math.min(Math.round(p.preview ? Math.min(p.count, 70) : p.count), MAX_LIVE_PIECES - live);
    live += amount;
    const pieces = Array.from({ length: amount }, (_, i) => {
      const shape = SHAPES[i % SHAPES.length];
      return h('i', {
        class: 'ua-cb__piece',
        style: {
          width: `${shape.width}px`,
          height: `${shape.height}px`,
          borderRadius: shape.radius,
          background: colors[i % colors.length],
          marginLeft: `${originX - shape.width / 2}px`,
          marginTop: `${originY - shape.height / 2}px`,
        },
      });
    });
    root.append(...pieces);
    const reach = Math.max(rect.width, 320) * 0.5 * p.spread;
    const rise = Math.max(rect.height, 240);
    animate(pieces, {
      x: { to: () => utils.random(-reach, reach), ease: 'outQuart' },
      // 勢いよく上がってから、重さで落ちる。
      y: [
        { to: () => -utils.random(rise * 0.15, rise * 0.6), duration: 550, ease: 'outQuad' },
        { to: () => rise * 0.7 + utils.random(0, 120), duration: 1500, ease: 'inQuad' },
      ],
      rotate: () => utils.random(-900, 900),
      rotateX: () => utils.random(-720, 720),
      opacity: [
        { to: 1, duration: 1400 },
        { to: 0, duration: 650 },
      ],
      duration: 2050,
      delay: stagger(3),
      onComplete() {
        live -= pieces.length;
        for (const piece of pieces) piece.remove();
      },
    });
    animate(button, {
      scale: [
        { to: 0.9, duration: 90, ease: 'outQuad' },
        { to: 1, duration: 700, ease: 'outElastic(1, .4)' },
      ],
    });
  }

  disposer.listen(button, 'click', (event) => {
    const { px, py } = localPointer(event, root);
    // キーボードで押したときは位置が取れないので、ボタンの中央から出す。
    if (event.detail === 0) burst();
    else burst(px, py);
  });
  disposer.add(() => clearTimeout(labelTimer));
  if (p.preview) {
    disposer.interval(() => burst(), 3400);
    disposer.timeout(() => burst(), 600);
  }

  return {
    burst,
    destroy() {
      destroyed = true;
      disposer.run();
      removeRoot(root);
    },
  };
}
