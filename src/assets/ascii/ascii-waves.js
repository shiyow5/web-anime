import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'ascii-waves',
  title: '文字の海',
  category: 'ascii',
  libs: ['animejs'],
  description:
    'いくつもの波源から広がる輪が重なり、強め合う所と打ち消し合う所ができる水面を、文字の濃淡で描きます。ポインターの位置も波源になり、クリックすると大きな輪が 1 つ広がります。落ち着いた背景や、音・通信を扱うページの飾りに使えます。',
  params: {
    color: { type: 'color', label: '水面の色', default: '#58b6c8' },
    accent: { type: 'color', label: '波頭の色', default: '#f0fbff' },
    background: { type: 'color', label: '背景色', default: '#06141c' },
    sources: { type: 'range', label: '波源の数', min: 1, max: 6, step: 1, default: 4 },
    wavelength: { type: 'range', label: '波の長さ', min: 0.5, max: 2, step: 0.1, default: 1 },
    speed: { type: 'range', label: '速さ', min: 0, max: 3, step: 0.1, default: 1 },
    detail: { type: 'range', label: '文字の細かさ', min: 0.6, max: 1.6, step: 0.1, default: 1 },
  },
};

const RAMP = ' .\'`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
const RAMP_CODES = Array.from(RAMP, (ch) => ch.charCodeAt(0));
const LAST = RAMP_CODES.length - 1;
const BASE = 12;
const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';
const SPACE = 32;
const MAX_RINGS = 4;

const CSS = `
.ua-awv{position:absolute;inset:0;overflow:hidden;background:var(--ua-bg);cursor:crosshair}
.ua-awv__pre,.ua-awv__probe{position:absolute;left:0;top:0;margin:0;padding:0;border:0;background:none;white-space:pre;
  font:${BASE}px/${BASE}px ${MONO};letter-spacing:0;font-variant-ligatures:none}
.ua-awv__pre{transform-origin:0 0;pointer-events:none;user-select:none;color:var(--ua-fg)}
.ua-awv__pre--1{color:var(--ua-accent)}
.ua-awv__probe{visibility:hidden}
`;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 文字の升目を用意する。12px で組んでから transform で縮めるので、ブラウザーの最小文字サイズに左右されない。
function createSurface(root, cls, layerCount, cellPx) {
  const probe = h('span', { class: `${cls}__probe`, 'aria-hidden': 'true', text: 'M'.repeat(20) });
  const pres = Array.from({ length: layerCount }, (_, i) => h('pre', { class: `${cls}__pre ${cls}__pre--${i}`, 'aria-hidden': 'true' }));
  root.append(probe, ...pres);
  const g = { cols: 0, rows: 0, aspect: 0.6, layers: [] };
  g.fit = () => {
    const w = root.clientWidth;
    const ht = root.clientHeight;
    if (w < 8 || ht < 8) return false;
    const cw = probe.getBoundingClientRect().width / 20 || BASE * 0.6;
    const cell = cellPx(w, ht);
    const scale = cell / BASE;
    g.cols = Math.max(12, Math.floor(w / (cw * scale)));
    g.rows = Math.max(6, Math.floor(ht / cell));
    g.aspect = cw / BASE;
    g.layers = pres.map(() => new Uint16Array(g.cols * g.rows).fill(SPACE));
    const ox = (w - g.cols * cw * scale) / 2;
    const oy = (ht - g.rows * cell) / 2;
    for (const pre of pres) pre.style.transform = `translate(${ox.toFixed(2)}px,${oy.toFixed(2)}px) scale(${scale.toFixed(4)})`;
    return true;
  };
  g.flush = () => {
    pres.forEach((pre, i) => {
      const buf = g.layers[i];
      const lines = [];
      for (let r = 0; r < g.rows; r += 1) lines.push(String.fromCharCode.apply(null, buf.subarray(r * g.cols, (r + 1) * g.cols)));
      pre.textContent = lines.join('\n');
    });
  };
  g.put = (layer, row, col, text) => {
    if (row < 0 || row >= g.rows) return;
    for (let i = 0; i < text.length; i += 1) {
      const c = col + i;
      if (c >= 0 && c < g.cols) g.layers[layer][row * g.cols + c] = text.charCodeAt(i);
    }
  };
  return g;
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const preview = Boolean(p.preview);
  const reduced = prefersReducedMotion();
  const root = createRoot(container, 'ua-awv', { '--ua-bg': p.background, '--ua-fg': p.color, '--ua-accent': p.accent });
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', '文字の濃淡で描いた、波が重なる水面');
  const disposer = createDisposer();
  const g = createSurface(root, 'ua-awv', 2, (w) => clamp(w / (preview ? 64 : 105) / p.detail, 4.5, 16));

  const count = Math.round(p.sources);
  // 波源ごとに、ゆっくり動く軌道と、少しずつ違う波長・速さを持たせる。
  const sources = Array.from({ length: count }, (_, i) => ({
    phase: i * 2.399,
    orbit: 0.11 + 0.05 * (i % 3),
    k: (7.5 + i * 1.3) / p.wavelength,
    w: 2.4 + i * 0.3,
    amp: 1 - i * 0.08,
  }));
  const ptr = { x: 0.5, y: 0.5, inside: false, gain: 0 };
  const intro = { v: reduced ? 1 : 0 };
  const rings = [];
  let time = reduced ? 6 : 0;

  disposer.listen(root, 'pointermove', (event) => {
    const local = localPointer(event, root);
    ptr.x = local.x;
    ptr.y = local.y;
    ptr.inside = true;
  });
  disposer.listen(root, 'pointerleave', () => {
    ptr.inside = false;
  });
  disposer.listen(root, 'pointerdown', (event) => {
    const local = localPointer(event, root);
    const ring = { x: local.x, y: local.y, age: 0, power: 0 };
    rings.push(ring);
    if (rings.length > MAX_RINGS) utils.remove(rings.shift());
    animate(ring, { power: [1.6, 0], duration: 3200, ease: 'outQuad', onComplete: () => rings.splice(rings.indexOf(ring), 1) });
  });

  function draw(dt) {
    const { cols, rows, aspect } = g;
    const [water, foam] = g.layers;
    time += dt * p.speed;
    for (const ring of rings) ring.age += dt * p.speed;
    const halfW = (cols * aspect) / rows;

    // 一覧の小さな枠では、触らなくても波源が 1 つ動き回る。
    const auto = preview && !ptr.inside;
    const tx = auto ? 0.5 + 0.34 * Math.sin(time * 0.6) : ptr.x;
    const ty = auto ? 0.5 + 0.3 * Math.cos(time * 0.47) : ptr.y;
    ptr.gain += ((ptr.inside || auto ? 1 : 0) - ptr.gain) * (1 - Math.exp(-dt * 3));

    const emit = sources.map((s) => ({
      x: Math.cos(time * 0.13 + s.phase) * halfW * (0.5 + s.orbit) + Math.sin(time * 0.21 + s.phase * 2) * s.orbit,
      y: Math.sin(time * 0.17 + s.phase * 1.3) * 0.62,
      k: s.k,
      wt: s.w * time,
      amp: s.amp,
    }));
    emit.push({ x: (tx * 2 - 1) * halfW, y: 1 - ty * 2, k: 11 / p.wavelength, wt: 3.4 * time, amp: 1.25 * ptr.gain });
    const live = rings.map((ring) => ({ x: (ring.x * 2 - 1) * halfW, y: 1 - ring.y * 2, front: ring.age * 0.55, power: ring.power }));

    const height = (x, y) => {
      let sum = 0.4 * Math.sin(x * 2.3 + y * 1.4 - time * 0.9);
      for (let i = 0; i < emit.length; i += 1) {
        const e = emit[i];
        if (e.amp < 0.01) continue;
        const d = Math.hypot(x - e.x, y - e.y);
        sum += (e.amp * Math.sin(e.k * d - e.wt)) / (1 + d * 1.1);
      }
      for (let i = 0; i < live.length; i += 1) {
        const e = live[i];
        const d = Math.hypot(x - e.x, y - e.y) - e.front;
        sum += e.power * Math.sin(d * 15) * Math.exp(-d * d * 9);
      }
      return sum;
    };

    const eps = 0.012;
    const tilt = 0.1 * intro.v;
    const dy = 2 / rows;
    for (let r = 0; r < rows; r += 1) {
      const y = 1 - ((r + 0.5) / rows) * 2;
      for (let c = 0; c < cols; c += 1) {
        const index = r * cols + c;
        const x = (((c + 0.5) / cols) * 2 - 1) * halfW;
        const h0 = height(x, y);
        const gx = ((height(x + eps, y) - h0) / eps) * tilt;
        const gy = ((height(x, y + eps) - h0) / eps) * tilt;
        // 水面の傾きから法線を作り、左上からの光で明るさを決める。
        const inv = 1 / Math.hypot(gx, gy, 1);
        const diffuse = Math.max(0, (0.52 * gx - 0.6 * gy + 0.61) * inv);
        const spec = Math.max(0, (0.29 * gx - 0.33 * gy + 0.9) * inv) ** 26;
        // 上へ行くほど遠いものとして、少し暗くする。
        const depth = 0.72 + 0.28 * (r * dy * 0.5);
        const lum = clamp((0.06 + 0.86 * diffuse ** 1.7 + 0.25 * spec) * depth, 0.02, 1) * intro.v;
        const code = RAMP_CODES[Math.round(lum * LAST)];
        if (spec > 0.6 && h0 > 0.2) {
          foam[index] = code;
          water[index] = SPACE;
        } else {
          water[index] = code;
          foam[index] = SPACE;
        }
      }
    }
  }

  function tick(dt) {
    if (!g.cols) return;
    draw(dt);
    g.flush();
  }

  let last = performance.now();
  const timer = reduced
    ? null
    : createTimer({
        frameRate: 30,
        onUpdate() {
          const now = performance.now();
          const dt = clamp((now - last) / 1000, 0, 0.1);
          last = now;
          tick(dt);
        },
      });
  if (!reduced) animate(intro, { v: 1, duration: 1800, ease: 'outCubic' });

  const refit = () => {
    if (g.fit() && reduced) tick(0);
  };
  const resizeObserver = new ResizeObserver(refit);
  resizeObserver.observe(root);
  const intersectionObserver = new IntersectionObserver((entries) => {
    if (!timer) return;
    if (entries.at(-1).isIntersecting) {
      last = performance.now();
      timer.resume();
    } else timer.pause();
  });
  intersectionObserver.observe(root);
  refit();

  return {
    destroy() {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      timer?.pause();
      utils.remove(intro);
      utils.remove(rings);
      disposer.run();
      removeRoot(root);
    },
  };
}
