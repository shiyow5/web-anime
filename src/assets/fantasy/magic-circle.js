import { animate, createDrawable, createSeededRandom, createTimeline, stagger, utils } from 'animejs';
import { createDisposer, createRoot, injectStyle, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'magic-circle',
  title: '魔法陣',
  category: 'fantasy',
  libs: ['animejs'],
  description:
    '輪、星、文字の層が 1 本ずつ線で描かれて魔法陣になり、層ごとに逆向きにゆっくり回ります。タップすると発動します。タップした側の文字から輪に沿って順に文字が灯り、星形がいったん消えて頂点を灯しながら描き直され、中心から光の柱が立ちのぼって粒が舞い上がり、柱が細って収まります。まわりの文字は、乱数から作った架空の文字です。',
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
.ua-mc__beam{opacity:0;transform-origin:300px 300px;pointer-events:none}
.ua-mc__spark{fill:var(--ua-color);opacity:0;transform-box:fill-box;transform-origin:center}
`;

const C = 300;
const RUNES = 24;
const SPARKS = 30;
let uid = 0;
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
  // 光の柱。中心から上へ伸びる、上ほど薄い帯を、幅を変えて重ねる。重ねるほど中心が明るくなり、縁がやわらぐ。
  uid += 1;
  const beamId = `ua-mc-beam-${uid}`;
  const defs = s(
    'defs',
    {},
    s('linearGradient', { id: beamId, x1: 0, y1: 1, x2: 0, y2: 0 }, s('stop', { offset: 0, 'stop-color': p.color, 'stop-opacity': 0.95 }), s('stop', { offset: 0.6, 'stop-color': p.glow, 'stop-opacity': 0.5 }), s('stop', { offset: 1, 'stop-color': p.glow, 'stop-opacity': 0 })),
  );
  const beams = [136, 104, 72, 42, 18].map((width) => s('rect', { class: 'ua-mc__beam', x: C - width / 2, y: C - 330, width, height: 330, rx: width / 2, fill: `url(#${beamId})`, 'fill-opacity': 0.42 }));
  root.appendChild(s('svg', { viewBox: '0 0 600 600', role: 'img', 'aria-label': '魔法陣' }, defs, flash, halos, outer, star, inner, beams, core, sparks));

  const layers = [outer, star, inner];
  const dots = [...vertexDots, core];
  if (reduced) {
    for (const rune of runes) rune.style.opacity = '1';
    return { destroy: () => removeRoot(root) };
  }

  const strokes = [...root.querySelectorAll('.ua-mc__stroke')];
  const drawables = createDrawable(strokes);
  const starLines = drawables.filter((_, i) => star.contains(strokes[i]));
  const intro = createTimeline()
    .add(drawables, { draw: ['0 0', '0 1'], duration: 1600, ease: 'inOutQuart', delay: stagger(130) })
    .add(runes, { opacity: [0, 1], duration: 400, ease: 'outQuad', delay: stagger(45) }, 500)
    .add(dots, { scale: [0, 1], duration: 800, ease: 'outElastic(1, .5)', delay: stagger(70) }, 1500);
  disposer.add(() => intro.pause());

  if (p.speed > 0) {
    [90000, -60000, 40000].forEach((duration, index) => {
      animate(layers[index], { rotate: duration > 0 ? 360 : -360, duration: Math.abs(duration) / p.speed, ease: 'linear', loop: true });
    });
  }

  // 発動。タップした側から文字が順に灯り、星形が消えて描き直される（準備）→ 光の柱が立ち、粒が舞い上がる（山場）
  // → 柱が細って消え、輪がゆるんで収まる（余韻）。
  function cast(event) {
    let first = 0;
    if (event?.clientX !== undefined) {
      const rect = root.getBoundingClientRect();
      const turn = Math.atan2(event.clientY - rect.top - rect.height / 2, event.clientX - rect.left - rect.width / 2) / (Math.PI * 2) + 0.25;
      first = Math.round((((turn % 1) + 1) % 1) * RUNES) % RUNES;
    }
    intro.pause();
    utils.remove([...runes, ...starLines, ...vertexDots, core, flash, ...beams, ...sparks]);
    utils.set(runes, { opacity: 1 });
    for (const line of drawables) if (!starLines.includes(line)) line.setAttribute('draw', '0 1');
    utils.set(dots, { scale: 1 });
    // 輪の文字を、タップした側から両回りに灯す。
    const ringDelay = (_, i) => Math.min((i - first + RUNES) % RUNES, (first - i + RUNES) % RUNES) * 55;
    animate(runes, {
      strokeWidth: [
        { to: 4, duration: 140, ease: 'outQuad' },
        { to: 1.5, duration: 900, ease: 'outQuad' },
      ],
      opacity: [
        { to: 0.25, duration: 1 },
        { to: 1, duration: 140 },
      ],
      delay: ringDelay,
    });
    // 星形を消して、線を 1 本ずつ描き直す。描き終わりに合わせて頂点が灯る。
    animate(starLines, { draw: ['0 1', '1 1'], duration: 380, ease: 'inQuad', delay: stagger(40) });
    animate(starLines, { draw: ['0 0', '0 1'], duration: 620, ease: 'inOutQuart', delay: stagger(110, { start: 520 }) });
    animate(vertexDots, {
      scale: [
        { to: 0, duration: 200, ease: 'inQuad' },
        { to: 2, duration: 180, delay: 500, ease: 'outQuad' },
        { to: 1, duration: 800, ease: 'outElastic(1, .5)' },
      ],
      delay: stagger(60),
    });
    // 光の柱。細く立ち上がってから太り、細って消える。
    animate(beams, {
      opacity: [
        { to: 0.9, duration: 160, ease: 'outQuad' },
        { to: 0.9, duration: 500 },
        { to: 0, duration: 800, ease: 'inQuad' },
      ],
      scaleY: [{ from: 0, to: 1, duration: 320, ease: 'outExpo' }],
      scaleX: [
        { from: 0.15, to: 1, duration: 420, ease: 'outBack(3)' },
        { to: 1, duration: 300 },
        { to: 0.05, duration: 740, ease: 'inQuad' },
      ],
      delay: stagger(40, { start: 1050 }),
    });
    animate(core, {
      scale: [
        { to: 0.4, duration: 900, ease: 'inQuad' },
        { to: 3.2, duration: 200, delay: 150, ease: 'outQuad' },
        { to: 1, duration: 1100, ease: 'outElastic(1, .5)' },
      ],
    });
    animate(flash, { opacity: [0.5, 0], scale: [0.2, 1.2], duration: 1200, delay: 1050, ease: 'outExpo' });
    animate(layers, {
      scale: [
        { to: 0.96, duration: 900, ease: 'inOutQuad' },
        { to: 1.06, duration: 200, delay: 100, ease: 'outQuad' },
        { to: 1, duration: 1300, ease: 'outElastic(1, .4)' },
      ],
      delay: stagger(60),
    });
    // 粒は柱に沿って舞い上がり、広がりながら消える。
    animate(sparks, {
      translateX: { from: () => utils.random(-30, 30), to: () => utils.random(-150, 150) },
      translateY: { from: 0, to: () => utils.random(-150, -330) },
      opacity: [
        { to: 1, duration: 80 },
        { to: 0, duration: () => utils.random(700, 1400), ease: 'inQuad' },
      ],
      scale: [1.5, 0.2],
      duration: () => utils.random(900, 1600),
      ease: 'outQuart',
      delay: stagger(22, { start: 1080 }),
    });
  }
  disposer.listen(root, 'click', cast);
  if (p.preview) disposer.interval(cast, 4200);
  disposer.timeout(cast, 3300);

  return {
    cast,
    destroy() {
      disposer.run();
      utils.remove([...runes, ...drawables, ...dots, flash, ...beams, ...sparks, ...layers]);
      removeRoot(root);
    },
  };
}
