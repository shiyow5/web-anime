import { animate, createDrawable, createSeededRandom, createTimeline, stagger, utils } from 'animejs';
import { createDisposer, createRoot, injectStyle, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'magic-circle',
  title: '魔法陣',
  category: 'fantasy',
  libs: ['animejs'],
  description:
    '輪、星、文字の層が 1 本ずつ線で描かれて魔法陣になり、層ごとに逆向きにゆっくり回ります。クリックすると発動して、全体が脈打ち、光の粒が外へ飛び散ります。まわりの文字は、乱数から作った架空の文字です。',
  params: {
    color: { type: 'color', label: '線の色', default: '#ffd98a' },
    glow: { type: 'color', label: '光の色', default: '#ff9d3c' },
    background: { type: 'color', label: '背景色', default: '#140b2a' },
    points: { type: 'range', label: '星の頂点の数', min: 5, max: 9, step: 1, default: 7 },
    speed: { type: 'range', label: '回る速さ', min: 0, max: 3, step: 0.1, default: 1 },
    seed: { type: 'range', label: '文字の種', min: 1, max: 99, step: 1, default: 7 },
  },
};

const CSS = `
.ua-mc{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;cursor:pointer;
  background:radial-gradient(circle at 50% 50%,color-mix(in srgb,var(--ua-glow) 16%,var(--ua-bg)),var(--ua-bg) 62%)}
.ua-mc svg{width:94%;height:94%;overflow:visible}
.ua-mc__halo{fill:none;stroke:var(--ua-glow);stroke-width:9;opacity:.22}
.ua-mc__layer{transform-origin:300px 300px}
.ua-mc__stroke{fill:none;stroke:var(--ua-color);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.ua-mc__rune{fill:none;stroke:var(--ua-color);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;opacity:0}
.ua-mc__dot{fill:var(--ua-color);transform-box:fill-box;transform-origin:center}
.ua-mc__flash{fill:var(--ua-glow);opacity:0;transform-origin:300px 300px}
.ua-mc__spark{fill:var(--ua-color);opacity:0;transform-box:fill-box;transform-origin:center}
`;

const C = 300;
const RUNES = 24;
const SPARKS = 30;
const at = (radius, turn) => [C + Math.cos(turn * Math.PI * 2 - Math.PI / 2) * radius, C + Math.sin(turn * Math.PI * 2 - Math.PI / 2) * radius];
const fmt = ([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`;

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

// 頂点を step 個おきに結んだ図形。7 頂点なら 3 個おきに結ぶと一筆書きの星になる。
function starPolygon(radius, points, step) {
  return Array.from({ length: points }, (_, i) => fmt(at(radius, ((i * step) % points) / points))).join(' ');
}

// 星形を作る。6 頂点のように一筆で描けない数のときは、ずらした多角形を重ねて星にする。
export function starPolygons(radius, points) {
  const step = Math.max(1, Math.floor((points - 1) / 2));
  const pieces = gcd(points, step);
  const size = points / pieces;
  return Array.from({ length: pieces }, (_, piece) =>
    Array.from({ length: size }, (_, i) => fmt(at(radius, ((piece + i * step) % points) / points))).join(' '),
  );
}

// 3 × 4 の格子の点を、乱数で選んだ順につないで架空の文字を作る。
function runePath(random) {
  const node = () => [Math.floor(random() * 3) * 6 - 6, Math.floor(random() * 4) * 6 - 9];
  const strokes = 2 + Math.floor(random() * 2);
  let d = '';
  for (let i = 0; i < strokes; i += 1) {
    const [x1, y1] = node();
    const [x2, y2] = node();
    const [x3, y3] = node();
    d += `M${x1} ${y1}L${x2} ${y2}L${x3} ${y3}`;
  }
  return d;
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-mc', { '--ua-bg': p.background, '--ua-color': p.color, '--ua-glow': p.glow });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const random = createSeededRandom(Math.round(p.seed), 0, 1, 4);
  const points = Math.round(p.points);
  const stroke = (tag, attrs) => s(tag, { class: 'ua-mc__stroke', ...attrs });

  const runes = Array.from({ length: RUNES }, (_, i) => {
    const [x, y] = at(232, i / RUNES);
    return s('path', { class: 'ua-mc__rune', d: runePath(() => random()), transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(i / RUNES) * 360})` });
  });
  // 光彩。全体にぼかしをかけると重いので、太くて薄い線を下に敷いて光って見せる。
  const halos = [270, 212, 112].map((r) => s('circle', { class: 'ua-mc__halo', cx: C, cy: C, r }));
  const outer = s('g', { class: 'ua-mc__layer' }, stroke('circle', { cx: C, cy: C, r: 270 }), stroke('circle', { cx: C, cy: C, r: 252 }), stroke('circle', { cx: C, cy: C, r: 212 }), runes);
  const vertexDots = Array.from({ length: points }, (_, i) => {
    const [cx, cy] = at(204, i / points);
    return s('circle', { class: 'ua-mc__dot', cx: cx.toFixed(1), cy: cy.toFixed(1), r: 7 });
  });
  const star = s('g', { class: 'ua-mc__layer' }, starPolygons(204, points).map((pts) => stroke('polygon', { points: pts })), stroke('polygon', { points: starPolygon(204, points, 1) }), vertexDots);
  const inner = s(
    'g',
    { class: 'ua-mc__layer' },
    stroke('circle', { cx: C, cy: C, r: 112 }),
    stroke('polygon', { points: starPolygon(110, 3, 1) }),
    stroke('polygon', { points: [0, 1, 2].map((i) => fmt(at(110, i / 3 + 0.5))).join(' ') }),
    stroke('circle', { cx: C, cy: C, r: 54 }),
    stroke('polygon', { points: starPolygon(40, 8, 3) }),
  );
  const core = s('circle', { class: 'ua-mc__dot', cx: C, cy: C, r: 9 });
  const flash = s('circle', { class: 'ua-mc__flash', cx: C, cy: C, r: 270 });
  const sparks = Array.from({ length: SPARKS }, () => s('circle', { class: 'ua-mc__spark', cx: C, cy: C, r: 3.5 }));
  root.appendChild(s('svg', { viewBox: '0 0 600 600', role: 'img', 'aria-label': '魔法陣' }, flash, halos, outer, star, inner, core, sparks));

  const layers = [outer, star, inner];
  const dots = [...vertexDots, core];
  if (reduced) {
    for (const rune of runes) rune.style.opacity = '1';
    return { destroy: () => removeRoot(root) };
  }

  const strokes = [...root.querySelectorAll('.ua-mc__stroke')];
  const intro = createTimeline()
    .add(createDrawable(strokes), { draw: ['0 0', '0 1'], duration: 1600, ease: 'inOutQuart', delay: stagger(130) })
    .add(runes, { opacity: [0, 1], duration: 400, ease: 'outQuad', delay: stagger(45) }, 500)
    .add(dots, { scale: [0, 1], duration: 800, ease: 'outElastic(1, .5)', delay: stagger(70) }, 1500);
  disposer.add(() => intro.pause());

  if (p.speed > 0) {
    [90000, -60000, 40000].forEach((duration, index) => {
      animate(layers[index], { rotate: duration > 0 ? 360 : -360, duration: Math.abs(duration) / p.speed, ease: 'linear', loop: true });
    });
  }

  // 発動。全体を脈打たせ、光を広げ、粒を外へ飛ばす。
  function cast() {
    animate(layers, {
      scale: [
        { to: 1.07, duration: 180, ease: 'outQuad' },
        { to: 1, duration: 1300, ease: 'outElastic(1, .4)' },
      ],
      delay: stagger(70),
    });
    animate(flash, { opacity: [0.55, 0], scale: [0.3, 1.25], duration: 1100, ease: 'outExpo' });
    animate(dots, {
      scale: [
        { to: 1.9, duration: 160, ease: 'outQuad' },
        { to: 1, duration: 900, ease: 'outElastic(1, .5)' },
      ],
      delay: stagger(30),
    });
    animate(sparks, {
      translateX: { from: 0, to: () => utils.random(-330, 330) },
      translateY: { from: 0, to: () => utils.random(-330, 330) },
      opacity: [1, 0],
      scale: [1.4, 0.2],
      duration: () => utils.random(900, 1700),
      ease: 'outExpo',
      delay: stagger(10),
    });
  }
  disposer.listen(root, 'click', cast);
  if (p.preview) disposer.interval(cast, 4200);
  disposer.timeout(cast, 2700);

  return {
    cast,
    destroy() {
      disposer.run();
      removeRoot(root);
    },
  };
}
