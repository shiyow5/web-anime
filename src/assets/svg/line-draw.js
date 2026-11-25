import { createDrawable, createTimeline, stagger } from 'animejs';
import { createRoot, injectStyle, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'line-draw',
  title: '一筆で描かれる線画',
  category: 'svg',
  libs: ['animejs'],
  description:
    'SVG の線が 1 本ずつ引かれて図になり、最後に点が弾んで現れます。ロゴの登場、図解、区切りの装飾に使えます。SVG の中身を差し替えれば、自分の図でも同じ動きになります。',
  params: {
    stroke: { type: 'color', label: '線の色', default: '#1c2340' },
    accent: { type: 'color', label: '点の色', default: '#ff5a36' },
    background: { type: 'color', label: '背景色', default: '#f2efe4' },
    width: { type: 'range', label: '線の太さ', min: 0.5, max: 6, step: 0.5, default: 2 },
    speed: { type: 'range', label: '描く速さ', min: 0.3, max: 3, step: 0.1, default: 1 },
    loop: { type: 'boolean', label: 'くり返す', default: true },
  },
};

const CSS = `
.ua-ld{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;background:var(--ua-bg)}
.ua-ld svg{width:min(92%,900px);height:92%}
.ua-ld__stroke{fill:none;stroke:var(--ua-stroke);stroke-linecap:round;stroke-linejoin:round}
.ua-ld__dot{fill:var(--ua-accent);transform-box:fill-box;transform-origin:center}
`;

const CENTER = { x: 300, y: 200 };

function buildStrokes() {
  const { x, y } = CENTER;
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2;
    const point = (r) => [x + Math.cos(angle) * r, y + Math.sin(angle) * r].map((v) => v.toFixed(1));
    const [x1, y1] = point(160);
    const [x2, y2] = point(174);
    return s('line', { x1, y1, x2, y2 });
  });
  return [
    s('circle', { cx: x, cy: y, r: 150 }),
    s('ellipse', { cx: x, cy: y, rx: 236, ry: 72, transform: `rotate(-18 ${x} ${y})` }),
    s('ellipse', { cx: x, cy: y, rx: 236, ry: 72, transform: `rotate(18 ${x} ${y})` }),
    s('circle', { cx: x, cy: y, r: 96 }),
    s('polygon', { points: '300,104 383,248 217,248' }),
    s('circle', { cx: x, cy: y, r: 40 }),
    s('line', { x1: x, y1: 14, x2: x, y2: 386 }),
    s('line', { x1: 50, y1: y, x2: 550, y2: y }),
    s('path', { d: 'M40 340 C140 280 200 400 300 340 S460 280 560 340' }),
    ...ticks,
  ];
}

const DOTS = [
  [524, 127, 9],
  [76, 273, 7],
  [300, 104, 6],
  [383, 248, 6],
  [217, 248, 6],
  [300, 200, 10],
];

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-ld', { '--ua-bg': p.background, '--ua-stroke': p.stroke, '--ua-accent': p.accent });
  const strokes = buildStrokes();
  for (const stroke of strokes) {
    stroke.setAttribute('class', 'ua-ld__stroke');
    stroke.setAttribute('stroke-width', String(p.width));
  }
  const dots = DOTS.map(([cx, cy, r]) => s('circle', { class: 'ua-ld__dot', cx, cy, r }));
  root.appendChild(s('svg', { viewBox: '0 0 600 400', role: 'img', 'aria-label': '軌道を描いた線画' }, strokes, dots));

  let timeline = null;
  if (!prefersReducedMotion()) {
    const drawables = createDrawable(strokes);
    const t = (ms) => ms / p.speed;
    timeline = createTimeline({ loop: p.loop, loopDelay: t(500) })
      .add(drawables, { draw: ['0 0', '0 1'], duration: t(1700), ease: 'inOutQuart', delay: stagger(t(90)) })
      .add(dots, { scale: [0, 1], opacity: [0, 1], duration: t(900), ease: 'outElastic(1, .5)', delay: stagger(t(70)) }, `-=${t(700)}`);
    if (p.loop) {
      timeline
        .add(dots, { scale: 0, opacity: 0, duration: t(350), ease: 'inQuad', delay: stagger(t(30)) }, `+=${t(1800)}`)
        .add(drawables, { draw: '1 1', duration: t(1100), ease: 'inOutQuart', delay: stagger(t(45)) }, `-=${t(200)}`);
    }
  }

  return {
    replay: () => timeline?.restart(),
    destroy() {
      timeline?.pause();
      removeRoot(root);
    },
  };
}
