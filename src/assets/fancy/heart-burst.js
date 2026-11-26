import { animate, createTimeline, spring, stagger, utils } from 'animejs';
import { createDisposer, createRoot, injectStyle, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'heart-burst',
  title: 'いいねのハート',
  category: 'fancy',
  libs: ['animejs'],
  description:
    'ハートのボタンを押すと、ハートがふくらんで弾み、小さなハートと輪が四方へ飛び散ります。押した回数は下の数字に足されていきます。投稿へのいいね、お気に入りの登録、応援のボタンに使えます。',
  params: {
    color: { type: 'color', label: 'ハートの色', default: '#ff5c8a' },
    accent: { type: 'color', label: '差し色', default: '#ffb347' },
    accent2: { type: 'color', label: '差し色 2', default: '#9d8cff' },
    background: { type: 'color', label: '背景色', default: '#fff3ef' },
    pieces: { type: 'range', label: '飛び散る数', min: 6, max: 24, step: 1, default: 14 },
    start: { type: 'range', label: '最初の数', min: 0, max: 999, step: 1, default: 128 },
    label: { type: 'text', label: '数字の横の言葉', default: 'いいね', maxLength: 12 },
  },
};

const CSS = `
.ua-hb{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;
  background:radial-gradient(circle at 50% 42%,#fff 0%,var(--ua-bg) 58%,color-mix(in srgb,var(--ua-color) 14%,var(--ua-bg)) 100%);
  font-family:var(--ua-display,system-ui,sans-serif)}
.ua-hb svg{width:100%;height:100%;display:block}
.ua-hb__c{transform-box:fill-box;transform-origin:center}
.ua-hb__btn{cursor:pointer;outline:none}
.ua-hb__btn:focus-visible .ua-hb__disc{stroke:var(--ua-accent2);stroke-width:4}
.ua-hb__shadow{fill:var(--ua-color);opacity:.16}
.ua-hb__disc{fill:#fff;stroke:color-mix(in srgb,var(--ua-color) 22%,#fff);stroke-width:2}
.ua-hb__heart{fill:#fff;stroke:var(--ua-color);stroke-width:7;stroke-linejoin:round;transition:fill .18s}
.ua-hb--on .ua-hb__heart{fill:var(--ua-color)}
.ua-hb__shine{fill:none;stroke:#fff;stroke-width:5;stroke-linecap:round;opacity:0;transition:opacity .2s}
.ua-hb--on .ua-hb__shine{opacity:.75}
.ua-hb__guide{fill:none;stroke:var(--ua-color);stroke-width:1.2;opacity:.22}
.ua-hb__tick{fill:var(--ua-color);opacity:.3}
.ua-hb__ring{fill:none;stroke-width:5;opacity:0}
.ua-hb__piece{opacity:0}
.ua-hb__deco{opacity:.5}
.ua-hb__num{font-size:44px;font-weight:800;fill:#4a3340;text-anchor:end;font-variant-numeric:tabular-nums}
.ua-hb__label{font-size:20px;font-weight:600;fill:#a0808e;text-anchor:start;letter-spacing:.08em}
`;

const HEART = 'M0,38 C-12,28 -50,6 -50,-18 C-50,-36 -37,-46 -24,-46 C-13,-46 -4,-40 0,-30 C4,-40 13,-46 24,-46 C37,-46 50,-36 50,-18 C50,6 12,28 0,38Z';
const CX = 300;
const CY = 190;
const TICKS = 36;
const MAX_COUNT = 99999;

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-hb', { '--ua-bg': p.background, '--ua-color': p.color, '--ua-accent': p.accent, '--ua-accent2': p.accent2 });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const palette = [p.color, p.accent, p.accent2];
  const pieceCount = Math.round(p.pieces);
  let count = Math.round(p.start);
  let destroyed = false;

  const guides = [150, 118].map((r) => s('circle', { class: 'ua-hb__guide', cx: CX, cy: CY, r, 'stroke-dasharray': r === 150 ? '2 9' : null }));
  const ticks = Array.from({ length: TICKS }, (_, i) => {
    const a = (i / TICKS) * Math.PI * 2;
    return s('circle', { class: 'ua-hb__tick ua-hb__c', cx: (CX + Math.cos(a) * 134).toFixed(1), cy: (CY + Math.sin(a) * 134).toFixed(1), r: i % 3 === 0 ? 3 : 1.6 });
  });
  // 背景にただよう小さなハート。
  const decoSpots = [[70, 80, 0.24, -18, 1], [530, 96, 0.3, 14, 2], [96, 330, 0.34, 10, 2], [506, 318, 0.22, -12, 0], [452, 46, 0.16, 20, 1], [150, 196, 0.15, -8, 0]];
  const decos = decoSpots.map(([x, y, size, turn, c]) =>
    s('g', { transform: `translate(${x} ${y}) rotate(${turn}) scale(${size})` }, s('path', { class: 'ua-hb__deco ua-hb__c', d: HEART, fill: palette[c] })),
  );
  const rings = [p.color, p.accent].map((color) => s('circle', { class: 'ua-hb__ring ua-hb__c', cx: CX, cy: CY, r: 80, stroke: color }));
  const pieces = Array.from({ length: pieceCount }, (_, i) =>
    s('g', { class: 'ua-hb__piece ua-hb__c' }, s('path', { d: HEART, fill: palette[i % palette.length], transform: `scale(${(0.2 + (i % 3) * 0.07).toFixed(2)})` })),
  );
  const dots = Array.from({ length: 10 }, (_, i) => s('circle', { class: 'ua-hb__piece ua-hb__c', r: 4 + (i % 3) * 1.5, fill: palette[(i + 1) % palette.length] }));
  const burstLayer = s('g', { transform: `translate(${CX} ${CY})` }, pieces, dots);

  const heart = s('g', { class: 'ua-hb__c' }, s('path', { class: 'ua-hb__heart', d: HEART }), s('path', { class: 'ua-hb__shine', d: 'M-33,-22 C-33,-30 -28,-35 -21,-35' }));
  const disc = s('g', { class: 'ua-hb__c' }, s('ellipse', { class: 'ua-hb__shadow', cx: 0, cy: 14, rx: 78, ry: 76 }), s('circle', { class: 'ua-hb__disc', r: 86 }));
  const button = s('g', { class: 'ua-hb__btn', role: 'button', tabindex: 0, 'aria-pressed': 'false', 'aria-label': `${p.label}を押す`, transform: `translate(${CX} ${CY})` }, disc, s('g', { transform: 'translate(0 4)' }, heart));

  const num = s('text', { class: 'ua-hb__num ua-hb__c', x: CX + 4, y: 406, text: String(count) });
  const label = s('text', { class: 'ua-hb__label', x: CX + 16, y: 402, text: p.label });
  const counter = s('g', { 'aria-live': 'polite' }, num, label);

  root.appendChild(s('svg', { viewBox: '0 0 600 450', preserveAspectRatio: 'xMidYMid meet' }, decos, guides, ticks, rings, burstLayer, button, counter));

  function press() {
    if (destroyed) return;
    count = Math.min(MAX_COUNT, count + 1);
    num.textContent = String(count);
    root.classList.add('ua-hb--on');
    button.setAttribute('aria-pressed', 'true');
    if (reduced) return;

    animate(heart, {
      scale: [
        { to: 0.62, duration: 110, ease: 'outQuad' },
        { to: 1, ease: spring({ stiffness: 260, damping: 7 }) },
      ],
      rotate: [
        { to: -10, duration: 110, ease: 'outQuad' },
        { to: 0, duration: 900, ease: 'outElastic(1, .35)' },
      ],
    });
    animate(disc, {
      scale: [
        { to: 0.92, duration: 110, ease: 'outQuad' },
        { to: 1, duration: 800, ease: 'outElastic(1, .45)' },
      ],
    });
    animate(rings, { scale: [0.5, 2.1], opacity: [0.9, 0], strokeWidth: [14, 0.5], duration: 800, ease: 'outExpo', delay: stagger(110) });
    animate(pieces, {
      translateX: { from: 0, to: (_, i) => Math.cos((i / pieceCount) * Math.PI * 2 + 0.3) * utils.random(120, 205) },
      translateY: { from: 0, to: (_, i) => Math.sin((i / pieceCount) * Math.PI * 2 + 0.3) * utils.random(105, 170) - 14 },
      rotate: { from: () => utils.random(-40, 40), to: () => utils.random(-70, 70) },
      scale: [
        { from: 0.2, to: 1.3, duration: 320, ease: 'outBack(3)' },
        { to: 0, duration: 620, ease: 'inQuad' },
      ],
      opacity: [
        { from: 1, to: 1, duration: 620 },
        { to: 0, duration: 320 },
      ],
      duration: 940,
      ease: 'outQuart',
      delay: stagger(12),
    });
    animate(dots, {
      translateX: { from: 0, to: () => utils.random(-230, 230) },
      translateY: { from: 0, to: () => utils.random(-170, 150) },
      scale: [1.2, 0],
      opacity: [1, 0.2],
      duration: () => utils.random(600, 1100),
      ease: 'outExpo',
    });
    animate(ticks, {
      scale: [
        { to: 2.4, duration: 160, ease: 'outQuad' },
        { to: 1, duration: 700, ease: 'outElastic(1, .5)' },
      ],
      delay: stagger(8),
    });
    animate(num, { translateY: [16, 0], opacity: [0.2, 1], ease: spring({ stiffness: 300, damping: 12 }) });
  }

  disposer.listen(button, 'click', press);
  disposer.listen(button, 'keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    press();
  });

  if (!reduced) {
    const intro = createTimeline()
      .add(button, { opacity: [0, 1], duration: 300, ease: 'outQuad' }, 0)
      .add(disc, { scale: [0, 1], ease: spring({ stiffness: 140, damping: 9 }) }, 0)
      .add(heart, { scale: [0, 1], ease: spring({ stiffness: 170, damping: 8 }) }, 180)
      .add(ticks, { scale: [0, 1], duration: 500, ease: 'outBack(3)', delay: stagger(14) }, 250)
      .add(decos.map((g) => g.firstChild), { scale: [0, 1], duration: 700, ease: 'outElastic(1, .5)', delay: stagger(80) }, 400)
      .add(counter, { opacity: [0, 1], duration: 500, ease: 'outQuad' }, 500);
    disposer.add(() => intro.pause());
    // 押されるのを待つあいだ、ハートが小さく脈を打つ。
    disposer.timeout(() => {
      animate(heart.firstChild, { scale: [1, 1.07], duration: 620, ease: 'inOutSine', alternate: true, loop: true });
      heart.firstChild.classList.add('ua-hb__c');
    }, 1500);
    animate(decos.map((g) => g.firstChild), {
      translateY: (_, i) => [0, i % 2 ? -26 : 26],
      rotate: (_, i) => [0, i % 2 ? 12 : -12],
      duration: (_, i) => 2600 + i * 350,
      ease: 'inOutSine',
      alternate: true,
      loop: true,
    });
    if (p.preview) {
      disposer.timeout(press, 1300);
      disposer.interval(press, 2400);
    }
  }

  return {
    press,
    destroy() {
      destroyed = true;
      disposer.run();
      removeRoot(root);
    },
  };
}
