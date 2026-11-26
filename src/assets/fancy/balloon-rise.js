import { animate, createTimer, spring, stagger, utils } from 'animejs';
import { createDisposer, createRoot, injectStyle, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'balloon-rise',
  title: '上がる風船',
  category: 'fancy',
  libs: ['animejs'],
  description:
    '色とりどりの風船が、ひもを揺らしながら空へ上がっていきます。小さい風船ほど遠くにあって、ゆっくり動きます。風船をクリックすると、ふくらんでから割れて紙片が散り、その勢いでまわりの風船が近い順に押しのけられて揺れます。空をクリックすると風の輪が広がり、風船がそこから逃げていきます。誕生日や開店のお祝い、キャンペーンの告知に使えます。',
  params: {
    color1: { type: 'color', label: '色 1', default: '#ff7b9c' },
    color2: { type: 'color', label: '色 2', default: '#ffc857' },
    color3: { type: 'color', label: '色 3', default: '#5fd4c4' },
    color4: { type: 'color', label: '色 4', default: '#9b8cff' },
    sky: { type: 'color', label: '空の色', default: '#bdeee8' },
    count: { type: 'range', label: '風船の数', min: 4, max: 20, step: 1, default: 11 },
    speed: { type: 'range', label: '上がる速さ', min: 0.2, max: 3, step: 0.1, default: 1 },
  },
};

const CSS = `
.ua-br{position:absolute;inset:0;overflow:hidden;background:linear-gradient(180deg,var(--ua-sky) 0%,color-mix(in srgb,var(--ua-sky) 35%,#fff8e4) 62%,#fff8e4 100%)}
.ua-br svg{position:absolute;inset:0;width:100%;height:100%;display:block}
.ua-br__c{transform-box:fill-box;transform-origin:center}
.ua-br__cloud{fill:#fff}
.ua-br__clouds{opacity:.7}
.ua-br__balloon{cursor:pointer}
.ua-br__string{fill:none;stroke:#8c7a9a;stroke-width:1.4;stroke-linecap:round;opacity:.75}
.ua-br__body{transform-box:fill-box;transform-origin:50% 60%}
.ua-br__shine{fill:#fff;opacity:.55}
.ua-br__arc{fill:none;stroke:#fff;stroke-width:2.5;stroke-linecap:round;opacity:.35}
.ua-br__piece{opacity:0;pointer-events:none}
.ua-br__gust{fill:none;stroke:#fff;stroke-linecap:round;opacity:0;pointer-events:none}
.ua-br__ray{stroke-width:3;stroke-linecap:round;opacity:0;pointer-events:none}
`;

const W = 800;
const H = 600;
const PIECES = 14;
const RAYS = 8;
let uid = 0;

const stringPath = (t, phase) => {
  const a = Math.sin(t * 2.1 + phase) * 9;
  const b = Math.sin(t * 1.6 + phase + 1.2) * 12;
  const c = Math.sin(t * 1.3 + phase + 2.3) * 15;
  return `M0 52 Q${a.toFixed(1)} 78 ${(b * 0.5).toFixed(1)} 104 T${c.toFixed(1)} 158`;
};

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-br', { '--ua-sky': p.sky });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const id = `ua-br-${(uid += 1)}`;
  const palette = [p.color1, p.color2, p.color3, p.color4];
  const count = Math.round(p.preview ? Math.min(p.count, 9) : p.count);

  const defs = s(
    'defs',
    {},
    palette.map((color, i) =>
      s(
        'radialGradient',
        { id: `${id}-g${i}`, cx: 0.36, cy: 0.3, r: 0.8 },
        s('stop', { offset: 0, 'stop-color': `color-mix(in srgb, ${color} 55%, #fff)` }),
        s('stop', { offset: 0.5, 'stop-color': color }),
        s('stop', { offset: 1, 'stop-color': `color-mix(in srgb, ${color} 78%, #5a3d7a)` }),
      ),
    ),
  );
  const cloud = (x, y, k) =>
    s('g', { transform: `translate(${x} ${y}) scale(${k})` }, s('ellipse', { class: 'ua-br__cloud', cx: 0, cy: 0, rx: 70, ry: 22 }), s('circle', { class: 'ua-br__cloud', cx: -24, cy: -14, r: 24 }), s('circle', { class: 'ua-br__cloud', cx: 16, cy: -22, r: 30 }));
  const clouds = s('g', { class: 'ua-br__clouds' }, cloud(170, 130, 1), cloud(610, 250, 0.8), cloud(330, 440, 1.2), cloud(700, 500, 0.7));

  // 小さい風船を先に置く。あとから置いた大きい風船が手前に重なる。
  const balloons = Array.from({ length: count }, (_, i) => ({
    lane: ((i * 0.618 + 0.1) % 1) * 0.86 + 0.07,
    size: 0.8 + (((i * 7) % count) / count) * 0.8,
    colorIndex: i % palette.length,
    phase: i * 2.3,
    y: ((i * 0.37 + 0.05) % 1) * (H + 80) + 20,
    popped: false,
    respawnAt: 0,
    ox: 0,
    oy: 0,
    vx: 0,
    vy: 0,
    kickAt: 0,
    kx: 0,
    ky: 0,
  }))
    .sort((a, b) => a.size - b.size)
    .map((data, index) => {
      const string = s('path', { class: 'ua-br__string', d: stringPath(0, data.phase) });
      const body = s(
        'g',
        { class: 'ua-br__body' },
        s('path', { d: 'M-7 55 L0 40 L7 55 Q0 51 -7 55Z', fill: palette[data.colorIndex] }),
        s('ellipse', { rx: 36, ry: 44, fill: `url(#${id}-g${data.colorIndex})` }),
        s('ellipse', { class: 'ua-br__shine', cx: -14, cy: -18, rx: 6, ry: 11, transform: 'rotate(28 -14 -18)' }),
        s('path', { class: 'ua-br__arc', d: 'M22 14 Q16 30 4 36' }),
      );
      const el = s('g', { class: 'ua-br__balloon', 'data-index': index }, string, body);
      return { ...data, el, string, body, x: 0 };
    });
  const balloonLayer = s('g', {}, balloons.map((b) => b.el));
  const effects = s('g', {});
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid slice', role: 'img', 'aria-label': '空へ上がる風船' }, defs, clouds, balloonLayer, effects);
  root.appendChild(svg);

  function place(b, t) {
    b.x = b.lane * W + Math.sin(t * 0.7 + b.phase) * 20 * b.size + b.ox;
    // 押しのけられているあいだは、進む向きへ傾く。
    const tilt = Math.cos(t * 0.7 + b.phase) * 6 + Math.max(-28, Math.min(28, b.vx * 0.09));
    b.el.setAttribute('transform', `translate(${b.x.toFixed(1)} ${(b.y + b.oy).toFixed(1)}) scale(${b.size.toFixed(2)}) rotate(${tilt.toFixed(1)})`);
    if (!b.popped) b.string.setAttribute('d', stringPath(t, b.phase));
  }
  for (const b of balloons) place(b, 0);

  if (reduced) return { destroy: () => removeRoot(root) };

  // (x, y) から外向きの力を、近い風船から順に伝える。届くまでの時間は距離で決まる。
  function shock(x, y, reach, power, now, skip) {
    for (const other of balloons) {
      if (other === skip || other.popped) continue;
      const dx = other.x - x;
      const dy = other.y + other.oy - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > reach) continue;
      const k = (1 - d / reach) ** 1.3 * power;
      other.kickAt = now + d * 1.5;
      other.kx = (dx / d) * k;
      other.ky = (dy / d) * k * 0.7 - k * 0.25;
    }
  }

  // 空を押したとき。風の輪が広がり、風船が逃げる。
  function gust(x, y, now = performance.now()) {
    if (effects.childElementCount > 8) return;
    const rings = [0, 1, 2].map((i) => s('circle', { class: 'ua-br__gust', cx: x.toFixed(1), cy: y.toFixed(1), r: 8, 'stroke-width': 5 - i * 1.5, 'stroke-dasharray': i === 1 ? '14 18' : i === 2 ? '3 16' : null }));
    const group = s('g', {}, rings);
    effects.appendChild(group);
    animate(rings, {
      r: [8, (_, i) => 150 + i * 70],
      opacity: [
        { from: 0, to: 0.85, duration: 90 },
        { to: 0, duration: 760, ease: 'outQuad' },
      ],
      duration: 850,
      delay: stagger(110),
      ease: 'outCubic',
      onComplete: () => group.remove(),
    });
    shock(x, y, 330, 620, now, null);
  }

  function pop(b, now = performance.now()) {
    if (!b || b.popped) return;
    b.popped = true;
    b.respawnAt = now + 1500;
    const color = palette[b.colorIndex];
    // 準備: ぐっとふくらむ。山場: 割れて、勢いがまわりへ伝わる。
    animate(b.body, {
      scale: [
        { to: 1.34, duration: 150, ease: 'outQuad' },
        { to: 0, duration: 50, ease: 'inQuad' },
      ],
    });
    shock(b.x, b.y, 300, 520, now + 150, b);
    animate(b.string, { translateY: [0, 150], opacity: [0.75, 0], duration: 800, ease: 'inQuad' });

    disposer.timeout(() => burst(b, color), 150);
  }

  function burst(b, color) {
    const rays = Array.from({ length: RAYS }, (_, i) => {
      const a = (i / RAYS) * Math.PI * 2;
      return s('line', { class: 'ua-br__ray', stroke: color, x1: (Math.cos(a) * 30).toFixed(1), y1: (Math.sin(a) * 34).toFixed(1), x2: (Math.cos(a) * 62).toFixed(1), y2: (Math.sin(a) * 66).toFixed(1) });
    });
    const pieces = Array.from({ length: PIECES }, (_, i) => {
      const fill = i % 3 === 0 ? color : palette[(b.colorIndex + i) % palette.length];
      return i % 2
        ? s('rect', { class: 'ua-br__piece ua-br__c', x: -5, y: -3, width: 10, height: 6, rx: 1.5, fill })
        : s('circle', { class: 'ua-br__piece ua-br__c', r: 3.5, fill });
    });
    const group = s('g', { transform: `translate(${b.x.toFixed(1)} ${b.y.toFixed(1)}) scale(${b.size.toFixed(2)})` }, rays, pieces);
    effects.appendChild(group);
    animate(rays, { opacity: [1, 0], scale: [0.7, 1.25], duration: 380, ease: 'outExpo' });
    for (const ray of rays) ray.style.transformOrigin = '0px 0px';
    animate(pieces, {
      translateX: { from: 0, to: () => utils.random(-120, 120), ease: 'outQuart' },
      translateY: [
        { from: 0, to: () => utils.random(-90, -10), duration: 380, ease: 'outQuad' },
        { to: () => utils.random(130, 240), duration: 1000, ease: 'inQuad' },
      ],
      rotate: () => utils.random(-540, 540),
      opacity: [
        { from: 1, to: 1, duration: 1000 },
        { to: 0, duration: 380 },
      ],
      duration: 1380,
      delay: stagger(6),
      onComplete: () => group.remove(),
    });
  }

  function respawn(b) {
    utils.remove([b.body, b.string]);
    b.popped = false;
    b.ox = 0;
    b.oy = 0;
    b.vx = 0;
    b.vy = 0;
    b.kickAt = 0;
    b.y = H + 70 + Math.random() * 60;
    b.lane = Math.random() * 0.86 + 0.07;
    b.body.style.transform = '';
    b.string.style.transform = '';
    b.string.style.opacity = '';
  }

  // 経過時間は performance.now() で測る。
  let last = performance.now();
  let t = 0;
  const timer = createTimer({
    onUpdate() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      for (const b of balloons) {
        if (b.popped) {
          if (now > b.respawnAt) respawn(b);
          continue;
        }
        if (b.kickAt && now >= b.kickAt) {
          b.vx += b.kx / b.size;
          b.vy += b.ky / b.size;
          b.kickAt = 0;
        }
        // ずれは、ばねでゆっくり元の列へ戻る。
        b.vx += (-b.ox * 9 - b.vx * 2.4) * dt;
        b.vy += (-b.oy * 9 - b.vy * 2.4) * dt;
        b.ox += b.vx * dt;
        b.oy += b.vy * dt;
        b.y -= dt * 46 * p.speed * (0.45 + b.size * 0.6);
        if (b.y < -110 * b.size) b.y = H + 70;
        place(b, t);
      }
    },
  });
  disposer.add(() => timer.pause());

  animate(balloons.map((b) => b.body), { scale: [0, 1], delay: stagger(70, { start: 100 }), ease: spring({ stiffness: 130, damping: 8 }) });

  disposer.listen(svg, 'pointerdown', (event) => {
    const el = event.target.closest?.('.ua-br__balloon');
    if (el) {
      pop(balloons[Number(el.getAttribute('data-index'))]);
      return;
    }
    const matrix = svg.getScreenCTM?.();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    gust(point.x, point.y);
  });
  const popVisible = () => {
    const candidates = balloons.filter((b) => !b.popped && b.y > 120 && b.y < 440);
    pop(candidates[Math.floor(Math.random() * candidates.length)]);
  };
  if (p.preview) {
    disposer.timeout(popVisible, 1500);
    disposer.interval(popVisible, 2100);
  }

  return {
    pop: popVisible,
    destroy() {
      disposer.run();
      removeRoot(root);
    },
  };
}
