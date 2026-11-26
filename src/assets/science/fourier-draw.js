import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'fourier-draw',
  title: 'フーリエ級数の作図',
  category: 'science',
  libs: ['animejs'],
  description:
    '大きさと速さの違う円が数珠つなぎになって回り、先端が図形を描いていきます。円の半径と回る速さは、目標の図形を離散フーリエ変換して求めたものです。円の数を増やすほど角が鋭くなり、目標との誤差が小さくなります。クリックすると図形が切り替わります。',
  params: {
    shape: {
      type: 'select',
      label: '描く図形',
      options: [
        { value: 'star', label: '星' },
        { value: 'heart', label: 'ハート' },
        { value: 'square', label: '正方形' },
        { value: 'triangle', label: '三角形' },
      ],
      default: 'star',
    },
    circles: { type: 'range', label: '円の数', min: 1, max: 60, step: 1, default: 12 },
    period: { type: 'range', label: '1 周の秒数', min: 3, max: 20, step: 0.5, default: 9 },
    ink: { type: 'color', label: '線と円の色', default: '#1f3a5f' },
    trace: { type: 'color', label: '描く線の色', default: '#d8452e' },
    background: { type: 'color', label: '紙の色', default: '#f2ead8' },
  },
};

const SAMPLES = 256;
const SHAPE_ORDER = ['star', 'heart', 'square', 'triangle'];

// 目標の図形の頂点。y は上が正。
function outline(shape) {
  if (shape === 'heart') {
    return Array.from({ length: 120 }, (_, i) => {
      const t = (i / 120) * Math.PI * 2;
      return [16 * Math.sin(t) ** 3 / 17, (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) + 2) / 17];
    });
  }
  if (shape === 'square') return [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([x, y]) => [x * 0.8, y * 0.8]);
  if (shape === 'triangle') return [0, 1, 2].map((i) => [Math.cos(Math.PI / 2 + (i * Math.PI * 2) / 3), Math.sin(Math.PI / 2 + (i * Math.PI * 2) / 3) - 0.2]);
  return Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 === 0 ? 1 : 0.42;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
}

// 折れ線を、道のりで等間隔な n 個の点に取り直す。
function resample(vertices, n) {
  const closed = [...vertices, vertices[0]];
  const lengths = closed.slice(1).map(([x, y], i) => Math.hypot(x - closed[i][0], y - closed[i][1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  const points = [];
  let segment = 0;
  let walked = 0;
  for (let i = 0; i < n; i += 1) {
    const target = (i / n) * total;
    while (segment < lengths.length - 1 && walked + lengths[segment] < target) {
      walked += lengths[segment];
      segment += 1;
    }
    const t = lengths[segment] ? (target - walked) / lengths[segment] : 0;
    const [ax, ay] = closed[segment];
    const [bx, by] = closed[segment + 1];
    points.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
  }
  return points;
}

// 離散フーリエ変換。各周波数 k について、円の半径（amp）と始めの角度（phase）を返す。
// 半径の大きい順に並べる。k = 0 は図形の重心なので除く。
export function fourierCoefficients(points) {
  const n = points.length;
  const terms = [];
  for (let k = -n / 2; k < n / 2; k += 1) {
    if (k === 0) continue;
    let re = 0;
    let im = 0;
    for (let j = 0; j < n; j += 1) {
      const angle = (-2 * Math.PI * k * j) / n;
      re += points[j][0] * Math.cos(angle) - points[j][1] * Math.sin(angle);
      im += points[j][0] * Math.sin(angle) + points[j][1] * Math.cos(angle);
    }
    terms.push({ k, amp: Math.hypot(re, im) / n, phase: Math.atan2(im, re) });
  }
  return terms.sort((a, b) => b.amp - a.amp);
}

const CSS = `
.ua-fd{position:absolute;inset:0;overflow:hidden;container-type:size;cursor:pointer;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
.ua-fd canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.ua-fd__info{position:absolute;left:3.2cqw;top:3.2cqw;font-size:clamp(8px,1.45cqw,13px);line-height:1.55;letter-spacing:.08em;pointer-events:none}
.ua-fd__info b{display:block;font-weight:600;font-size:1.2em}
.ua-fd__info span{display:block;opacity:.7}
.ua-fd__cap{position:absolute;right:3.2cqw;bottom:2.4cqw;font-size:clamp(7px,1.15cqw,11px);letter-spacing:.1em;opacity:.55;pointer-events:none}
`;

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const reduced = prefersReducedMotion();
  const disposer = createDisposer();
  const root = createRoot(container, 'ua-fd', { background: p.background, color: p.ink });
  const canvas = h('canvas', { 'aria-hidden': 'true' });
  const countText = h('b');
  const errorText = h('span');
  root.append(
    canvas,
    h('div', { class: 'ua-fd__info' }, countText, errorText, h('span', { text: 'z(t) = Σ cₖ e^(2πikt)' })),
    h('div', { class: 'ua-fd__cap', text: '|cₖ| spectrum' }),
  );
  const ctx = canvas.getContext('2d');
  const view = { width: 1, height: 1, dpr: 1 };
  const state = { reveal: reduced ? 1 : 0, flash: 0 };

  let shape = p.shape;
  let target = [];
  let terms = [];
  let trail = [];
  let phase = 0; // 0〜1。1 周で図形を 1 つ描く
  const count = Math.round(p.circles);

  function tip(t, upto = terms.length) {
    let x = 0;
    let y = 0;
    for (let i = 0; i < upto; i += 1) {
      const angle = 2 * Math.PI * terms[i].k * t + terms[i].phase;
      x += terms[i].amp * Math.cos(angle);
      y += terms[i].amp * Math.sin(angle);
    }
    return [x, y];
  }

  function prepare() {
    const raw = resample(outline(shape), SAMPLES);
    const cx = raw.reduce((sum, q) => sum + q[0], 0) / SAMPLES;
    const cy = raw.reduce((sum, q) => sum + q[1], 0) / SAMPLES;
    target = raw.map(([x, y]) => [x - cx, y - cy]);
    terms = fourierCoefficients(target).slice(0, count);
    // 目標との誤差（二乗平均平方根）を、図形の大きさに対する割合で出す。
    let squared = 0;
    let size = 0;
    target.forEach(([x, y], j) => {
      const [ax, ay] = tip(j / SAMPLES);
      squared += (ax - x) ** 2 + (ay - y) ** 2;
      size += x * x + y * y;
    });
    countText.textContent = `N = ${count} circles`;
    errorText.textContent = `RMS error ${(Math.sqrt(squared / size) * 100).toFixed(1)} %`;
    // 始めから途中まで描いた状態にして、何の図形か分かるようにする。
    trail = [];
    phase = reduced ? 1 : 0.55;
    const steps = Math.round(phase * 400);
    for (let i = 0; i <= steps; i += 1) trail.push(tip((i / steps) * phase));
    phase %= 1;
  }

  function resize() {
    const rect = root.getBoundingClientRect();
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    canvas.width = Math.round(view.width * view.dpr);
    canvas.height = Math.round(view.height * view.dpr);
    draw();
  }

  function draw() {
    const { width, height, dpr } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const specH = height * 0.13;
    const cx = width / 2;
    const cy = (height - specH) / 2 + height * 0.01;
    const unit = Math.min(width * 0.3, (height - specH) * 0.36);
    const sx = (x) => cx + x * unit;
    const sy = (y) => cy - y * unit;

    // 方眼。
    const grid = unit / 4;
    ctx.lineWidth = 1;
    ctx.strokeStyle = p.ink;
    for (let gx = cx % grid; gx < width; gx += grid) {
      ctx.globalAlpha = Math.abs(gx - cx) < 0.5 ? 0.3 : 0.07;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, height - specH);
      ctx.stroke();
    }
    for (let gy = cy % grid; gy < height - specH; gy += grid) {
      ctx.globalAlpha = Math.abs(gy - cy) < 0.5 ? 0.3 : 0.07;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(width, gy);
      ctx.stroke();
    }

    // 目標の図形（点線）。
    ctx.globalAlpha = 0.3 * state.reveal;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    target.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // 描いた線。
    ctx.globalAlpha = 1;
    ctx.strokeStyle = p.trace;
    ctx.lineWidth = Math.max(1.6, unit * 0.014) * (1 + state.flash);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    trail.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
    ctx.stroke();

    // 連なった円と、その半径の線。
    const shownCircles = Math.ceil(terms.length * state.reveal);
    let x = 0;
    let y = 0;
    ctx.strokeStyle = p.ink;
    ctx.fillStyle = p.ink;
    for (let i = 0; i < shownCircles; i += 1) {
      const term = terms[i];
      const angle = 2 * Math.PI * term.k * phase + term.phase;
      const nx = x + term.amp * Math.cos(angle);
      const ny = y + term.amp * Math.sin(angle);
      ctx.globalAlpha = Math.max(0.12, 0.5 - i * 0.02);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx(x), sy(y), term.amp * unit, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(sx(x), sy(y));
      ctx.lineTo(sx(nx), sy(ny));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx(x), sy(y), 1.6, 0, Math.PI * 2);
      ctx.fill();
      x = nx;
      y = ny;
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.trace;
    ctx.beginPath();
    ctx.arc(sx(x), sy(y), Math.max(3, unit * 0.022), 0, Math.PI * 2);
    ctx.fill();

    // 下の帯に、使っている円の半径を周波数の順に並べる。
    const base = height - height * 0.035;
    const left = width * 0.06;
    const right = width * 0.72;
    const maxK = Math.max(4, ...terms.map((term) => Math.abs(term.k)));
    const maxAmp = terms[0]?.amp || 1;
    ctx.strokeStyle = p.ink;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, base);
    ctx.lineTo(right, base);
    ctx.stroke();
    const kx = (k) => left + ((k + maxK) / (2 * maxK)) * (right - left);
    for (let k = -maxK; k <= maxK; k += 1) {
      ctx.beginPath();
      ctx.moveTo(kx(k), base);
      ctx.lineTo(kx(k), base + (k === 0 ? 5 : 2.5));
      ctx.stroke();
    }
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = Math.max(1.5, Math.min(4, (right - left) / (maxK * 4)));
    terms.slice(0, shownCircles).forEach((term) => {
      ctx.strokeStyle = term.k > 0 ? p.ink : p.trace;
      ctx.beginPath();
      ctx.moveTo(kx(term.k), base - 1);
      ctx.lineTo(kx(term.k), base - 1 - Math.sqrt(term.amp / maxAmp) * specH * 0.62);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  function nextShape() {
    shape = SHAPE_ORDER[(SHAPE_ORDER.indexOf(shape) + 1) % SHAPE_ORDER.length];
    prepare();
    if (reduced) {
      draw();
      return;
    }
    trail = [];
    phase = 0;
    animate(state, { reveal: [0, 1], duration: 900, ease: 'outQuad' });
    animate(state, { flash: [1, 0], duration: 600, ease: 'outQuad' });
  }

  prepare();
  const observer = new ResizeObserver(resize);
  observer.observe(root);
  disposer.add(() => observer.disconnect());
  disposer.listen(root, 'click', nextShape);
  resize();

  if (!reduced) {
    animate(state, { reveal: [0, 1], duration: 1600, ease: 'outQuad' });
    const maxTrail = 900;
    let last = performance.now();
    const timer = createTimer({
      onUpdate() {
        const now = performance.now();
        const dt = Math.min(Math.max(now - last, 0), 50) / 1000;
        last = now;
        const before = phase;
        phase += dt / p.period;
        // 速い円が角ばらないように、1 フレームを細かく刻んで点を足す。
        const sub = 4;
        for (let i = 1; i <= sub; i += 1) trail.push(tip(before + ((phase - before) * i) / sub));
        // 1 周ぶんより古い線は消す。
        const keep = Math.min(maxTrail * sub, Math.ceil((p.period * 0.97 * sub) / Math.max(dt, 1 / 240)));
        if (trail.length > keep) trail.splice(0, trail.length - keep);
        if (phase >= 1) phase -= 1;
        draw();
      },
    });
    disposer.add(() => timer.pause());
  }

  return {
    nextShape,
    destroy() {
      disposer.run();
      utils.remove(state);
      removeRoot(root);
    },
  };
}
