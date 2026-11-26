import { animate, spring, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'sticker-pop',
  title: '貼られるシール',
  category: 'fancy',
  libs: ['animejs'],
  description:
    '星、花、雲、リボンなどの白いふちのシールが、手帳の紙の上にぺたっと 1 枚ずつ貼られます。ポインターを乗せるとシールが浮き、クリックすると貼り直します。紙の何もないところを押すと、全部を貼り直します。手帳や日記のアプリ、雑貨の紹介、ごほうびの演出に使えます。',
  params: {
    background: { type: 'color', label: '紙の色', default: '#fff8ea' },
    border: { type: 'color', label: 'ふちの色', default: '#ffffff' },
    count: { type: 'range', label: 'シールの枚数', min: 4, max: 8, step: 1, default: 8 },
    size: { type: 'range', label: '大きさ', min: 0.6, max: 1.3, step: 0.05, default: 1 },
    tilt: { type: 'range', label: '傾き（度）', min: 0, max: 25, step: 1, default: 11 },
    interval: { type: 'range', label: '貼る間隔（ミリ秒）', min: 60, max: 400, step: 10, default: 180 },
  },
};

const CSS = `
.ua-sp{position:absolute;inset:0;overflow:hidden;container-type:size;background-color:var(--ua-bg);cursor:pointer;
  background-image:radial-gradient(circle,rgba(150,120,90,.28) 0 1.1px,transparent 1.6px);background-size:22px 22px}
.ua-sp__tape{position:absolute;height:6.5cqmin;width:30cqmin;opacity:.8;
  background:repeating-linear-gradient(115deg,var(--t) 0 1.6cqmin,color-mix(in srgb,var(--t) 55%,#fff) 1.6cqmin 3.2cqmin);
  clip-path:polygon(0 0,100% 0,98% 25%,100% 50%,98% 75%,100% 100%,0 100%,2% 75%,0 50%,2% 25%)}
.ua-sp__slot{position:absolute;--w:calc(min(27cqmin,21cqw) * var(--k));width:var(--w);aspect-ratio:1;margin:calc(var(--w) / -2) 0 0 calc(var(--w) / -2)}
.ua-sp__lift{width:100%;height:100%}
.ua-sp__lift svg{display:block;width:100%;height:100%;overflow:visible}
.ua-sp__shade{opacity:.16}
`;

const starPoints = Array.from({ length: 10 }, (_, i) => {
  const r = i % 2 ? 17 : 35;
  const a = -Math.PI / 2 + (i * Math.PI) / 5;
  return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r + 2).toFixed(1)}`;
}).join(' ');
const petals = Array.from({ length: 6 }, (_, i) => {
  const a = (i / 6) * Math.PI * 2;
  return ['circle', { cx: (Math.cos(a) * 20).toFixed(1), cy: (Math.sin(a) * 20).toFixed(1), r: 14 }, { fill: '#ff9fbd' }];
});

// [タグ, 形, 塗り方]。detail が真のものは飾りで、白いふちと影には含めない。
const STICKERS = [
  [
    ['polygon', { points: starPoints }, { fill: '#ffd35c', stroke: '#ffd35c', width: 8 }],
    ['path', { d: 'M-12 -4 Q-9 -14 -2 -18' }, { stroke: '#fff3c4', width: 4, detail: true }],
  ],
  [...petals, ['circle', { r: 11 }, { fill: '#ffe08a', detail: true }], ['circle', { cx: -3, cy: -3, r: 3.5 }, { fill: '#fff6cf', detail: true }]],
  [
    ['circle', { cx: -20, cy: 8, r: 15 }, { fill: '#bfe6ff' }],
    ['circle', { cx: -2, cy: -6, r: 21 }, { fill: '#bfe6ff' }],
    ['circle', { cx: 21, cy: 7, r: 16 }, { fill: '#bfe6ff' }],
    ['rect', { x: -22, y: 6, width: 44, height: 17, rx: 8 }, { fill: '#bfe6ff' }],
    ['path', { d: 'M-12 -12 Q-5 -20 4 -17' }, { stroke: '#ffffff', width: 4, detail: true }],
  ],
  [
    ['path', { d: 'M0 0 C-14 -26 -40 -24 -38 -2 C-37 16 -14 16 0 0Z' }, { fill: '#ff7fa0' }],
    ['path', { d: 'M0 0 C14 -26 40 -24 38 -2 C37 16 14 16 0 0Z' }, { fill: '#ff7fa0' }],
    ['path', { d: 'M-4 4 L-20 32 L-8 28 L-4 38 L4 8Z' }, { fill: '#ff9db6' }],
    ['path', { d: 'M4 4 L20 32 L8 28 L4 38 L-4 8Z' }, { fill: '#ff9db6' }],
    ['rect', { x: -9, y: -10, width: 18, height: 20, rx: 7 }, { fill: '#ff5f88', detail: true }],
    ['path', { d: 'M-30 -8 Q-24 -16 -15 -13' }, { stroke: '#ffc4d4', width: 3.5, detail: true }],
  ],
  [
    ['path', { d: 'M12 -34 A35 35 0 1 0 30 20 A27 27 0 1 1 12 -34Z' }, { fill: '#ffe9a8' }],
    ['circle', { cx: 20, cy: -8, r: 4 }, { fill: '#ffd35c' }],
    ['circle', { cx: 31, cy: -22, r: 2.5 }, { fill: '#ffd35c' }],
  ],
  [
    ['path', { d: 'M-18 0 L-40 -15 L-36 0 L-40 15Z' }, { fill: '#8fdcc0' }],
    ['path', { d: 'M18 0 L40 -15 L36 0 L40 15Z' }, { fill: '#8fdcc0' }],
    ['circle', { r: 20 }, { fill: '#b9f0da' }],
    ['path', { d: 'M-12 -14 Q4 -4 -6 16' }, { stroke: '#ffffff', width: 5, detail: true }],
    ['path', { d: 'M4 -18 Q18 -2 8 17' }, { stroke: '#ffffff', width: 5, detail: true }],
  ],
  [
    ['path', { d: 'M-32 20 A32 32 0 0 1 32 20' }, { stroke: '#ff9aa8', width: 9 }],
    ['path', { d: 'M-23 20 A23 23 0 0 1 23 20' }, { stroke: '#ffe08a', width: 9 }],
    ['path', { d: 'M-14 20 A14 14 0 0 1 14 20' }, { stroke: '#9fd8f5', width: 9 }],
    ['circle', { cx: -30, cy: 22, r: 10 }, { fill: '#ffffff' }],
    ['circle', { cx: 30, cy: 22, r: 10 }, { fill: '#ffffff' }],
    ['circle', { cx: -20, cy: 26, r: 8 }, { fill: '#ffffff' }],
    ['circle', { cx: 20, cy: 26, r: 8 }, { fill: '#ffffff' }],
  ],
  [
    ['path', { d: 'M-16 12 Q-12 -18 6 -30 Q14 -10 16 16' }, { stroke: '#7cc08a', width: 4 }],
    ['path', { d: 'M6 -30 C16 -40 32 -36 34 -26 C24 -20 12 -22 6 -30Z' }, { fill: '#9ad6a4' }],
    ['circle', { cx: -16, cy: 18, r: 15 }, { fill: '#ff6b81' }],
    ['circle', { cx: 16, cy: 22, r: 15 }, { fill: '#ff6b81' }],
    ['circle', { cx: -21, cy: 13, r: 3.5 }, { fill: '#ffc0c9', detail: true }],
    ['circle', { cx: 11, cy: 17, r: 3.5 }, { fill: '#ffc0c9', detail: true }],
  ],
];
// [横の位置 %, 縦の位置 %, 傾きの向きと強さ]
const SPOTS = [[16, 30, -1], [39, 26, 0.7], [62, 31, -0.5], [85, 27, 1], [17, 72, 0.8], [40, 74, -0.9], [63, 71, 0.6], [85, 73, -0.7]];
const ORDER = [0, 5, 2, 7, 1, 4, 3, 6];
const BORDER = 13;

function layer(parts, mode, color) {
  return parts
    .filter(([, , paint]) => mode === 'art' || !paint.detail)
    .map(([tag, attrs, paint]) => {
      const isArt = mode === 'art';
      return s(tag, {
        ...attrs,
        fill: paint.fill ? (isArt ? paint.fill : color) : 'none',
        stroke: isArt ? paint.stroke ?? 'none' : color,
        'stroke-width': isArt ? paint.width ?? 0 : (paint.width ?? 0) + BORDER,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      });
    });
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-sp', { '--ua-bg': p.background });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const count = Math.round(p.count);

  root.append(
    h('i', { class: 'ua-sp__tape', style: { '--t': '#ffc9d6', left: '-4cqmin', top: '47%', transform: 'rotate(-7deg)' } }),
    h('i', { class: 'ua-sp__tape', style: { '--t': '#c6ecd9', right: '-5cqmin', top: '49%', transform: 'rotate(5deg)' } }),
  );

  const stickers = ORDER.filter((index) => index < count).map((index) => {
    const [x, y, lean] = SPOTS[index];
    const parts = STICKERS[index];
    const shade = s('g', { class: 'ua-sp__shade' }, layer(parts, 'shade', '#5b3a1e'));
    const svg = s('svg', { viewBox: '-58 -58 116 116', 'aria-hidden': 'true' }, shade, s('g', {}, layer(parts, 'border', p.border)), s('g', {}, layer(parts, 'art')));
    const lift = h('div', { class: 'ua-sp__lift' }, svg);
    const angle = lean * p.tilt;
    const slot = h('div', { class: 'ua-sp__slot', style: { '--k': p.size, left: `${x}%`, top: `${y}%`, transform: `rotate(${angle}deg)` } }, lift);
    root.appendChild(slot);
    if (!reduced) lift.style.opacity = '0';
    shade.style.transform = 'translate(2px, 4px)';
    return { slot, lift, shade, angle, lifted: false };
  });

  // 上から少し傾いて降りてきて、押しつけられて少しつぶれ、ばねで戻る。
  function stick(item, delay = 0) {
    if (reduced) return;
    const side = item.angle >= 0 ? 1 : -1;
    animate(item.lift, {
      opacity: { from: 0, to: 1, duration: 120, ease: 'outQuad' },
      y: { from: -34, to: 0, duration: 230, ease: 'inQuad' },
      rotate: { from: 16 * side, to: 0, duration: 230, ease: 'inQuad' },
      scale: [
        { from: 1.55, to: 0.88, duration: 230, ease: 'inQuad' },
        { to: 1, ease: spring({ stiffness: 320, damping: 9 }) },
      ],
      delay,
    });
    animate(item.shade, {
      translateX: { from: 12, to: 2 },
      translateY: { from: 22, to: 4 },
      opacity: { from: 0.07, to: 0.16 },
      duration: 230,
      ease: 'inQuad',
      delay,
    });
  }

  function hover(item, on) {
    if (reduced || item.lifted === on) return;
    item.lifted = on;
    animate(item.lift, { scale: on ? 1.14 : 1, y: on ? -7 : 0, rotate: on ? -item.angle * 0.7 : 0, ease: spring({ stiffness: 260, damping: 11 }) });
    animate(item.shade, { translateX: on ? 7 : 2, translateY: on ? 14 : 4, opacity: on ? 0.09 : 0.16, duration: 260, ease: 'outQuad' });
  }

  function stickAll() {
    stickers.forEach((item, i) => {
      item.lifted = false;
      stick(item, i * p.interval);
    });
  }

  for (const item of stickers) {
    disposer.listen(item.slot, 'pointerenter', () => hover(item, true));
    disposer.listen(item.slot, 'pointerleave', () => hover(item, false));
    disposer.listen(item.slot, 'click', (event) => {
      event.stopPropagation();
      item.lifted = false;
      stick(item);
    });
  }
  disposer.listen(root, 'click', stickAll);

  if (!reduced) {
    disposer.timeout(stickAll, 250);
    if (p.preview) {
      // 一覧では、1 枚ずつ浮かせて見せたあと、全部を貼り直す。
      let turn = 0;
      const cycle = stickers.length + 4;
      disposer.interval(() => {
        const step = turn % cycle;
        turn += 1;
        if (step < 3) return;
        if (step === cycle - 1) {
          stickAll();
          return;
        }
        const item = stickers[step - 3];
        hover(item, true);
        disposer.timeout(() => hover(item, false), 520);
      }, 700);
    }
  }

  return {
    stickAll,
    destroy() {
      disposer.run();
      utils.remove(stickers.flatMap((item) => [item.lift, item.shade]));
      removeRoot(root);
    },
  };
}
