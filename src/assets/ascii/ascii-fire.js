import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'ascii-fire',
  title: '文字の炎',
  category: 'ascii',
  libs: ['animejs'],
  description:
    '下から上へ燃え上がる炎を、熱いところほど濃い文字にして描きます。芯の熱い部分は別の色で重なり、火の粉が上へ舞います。ポインターを近づけると、そのあたりの炎が強く高くなります。見出しの背景や、勢いを出したい場面に使えます。',
  params: {
    color: { type: 'color', label: '炎の色', default: '#ff5a1c' },
    accent: { type: 'color', label: '芯の色', default: '#ffe28a' },
    background: { type: 'color', label: '背景色', default: '#120604' },
    height: { type: 'range', label: '炎の高さ', min: 0.4, max: 1.3, step: 0.05, default: 0.8 },
    speed: { type: 'range', label: '燃える速さ', min: 0.2, max: 3, step: 0.1, default: 1 },
    sparks: { type: 'range', label: '火の粉の数', min: 0, max: 60, step: 1, default: 28 },
    detail: { type: 'range', label: '文字の細かさ', min: 0.6, max: 1.6, step: 0.1, default: 1 },
  },
};

const RAMP = ' .\'`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
const RAMP_CODES = Array.from(RAMP, (ch) => ch.charCodeAt(0));
const LAST = RAMP_CODES.length - 1;
const BASE = 12;
const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';
const SPACE = 32;
const SPARK_CODES = [42, 43, 39, 46]; // * + ' .

const CSS = `
.ua-afr{position:absolute;inset:0;overflow:hidden;background:var(--ua-bg)}
.ua-afr__pre,.ua-afr__probe{position:absolute;left:0;top:0;margin:0;padding:0;border:0;background:none;white-space:pre;
  font:${BASE}px/${BASE}px ${MONO};letter-spacing:0;font-variant-ligatures:none}
.ua-afr__pre{transform-origin:0 0;pointer-events:none;user-select:none;color:var(--ua-fg)}
.ua-afr__pre--1{color:var(--ua-accent)}
.ua-afr__probe{visibility:hidden}
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
  return g;
}

// 格子点の乱数をなめらかにつないだ 3 次元のノイズ（0〜1）。炎のゆらぎに使う。
function createNoise() {
  const perm = new Uint8Array(512);
  let seed = 20261;
  const table = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [table[i], table[j]] = [table[j], table[i]];
  }
  for (let i = 0; i < 512; i += 1) perm[i] = table[i & 255];
  const at = (x, y, z) => perm[perm[perm[x & 255] + (y & 255)] + (z & 255)] / 255;
  const fade = (t) => t * t * (3 - 2 * t);
  const mix = (a, b, t) => a + (b - a) * t;
  return (x, y, z) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const u = fade(x - xi);
    const v = fade(y - yi);
    const w = fade(z - zi);
    return mix(
      mix(mix(at(xi, yi, zi), at(xi + 1, yi, zi), u), mix(at(xi, yi + 1, zi), at(xi + 1, yi + 1, zi), u), v),
      mix(mix(at(xi, yi, zi + 1), at(xi + 1, yi, zi + 1), u), mix(at(xi, yi + 1, zi + 1), at(xi + 1, yi + 1, zi + 1), u), v),
      w,
    );
  };
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const preview = Boolean(p.preview);
  const reduced = prefersReducedMotion();
  const root = createRoot(container, 'ua-afr', { '--ua-bg': p.background, '--ua-fg': p.color, '--ua-accent': p.accent });
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', '文字の濃淡で描いた、燃え上がる炎');
  const disposer = createDisposer();
  const g = createSurface(root, 'ua-afr', 2, (w) => clamp(w / (preview ? 64 : 105) / p.detail, 4.5, 16));
  const noise = createNoise();

  const ptr = { x: 0.5, y: 0.5, sx: 0.5, sy: 0.5, inside: false, gain: 0 };
  const intro = { v: reduced ? 1 : 0 };
  const sparkCount = Math.round(preview ? p.sparks * 0.5 : p.sparks);
  const sparks = Array.from({ length: sparkCount }, () => ({ x: 0, y: -1, vx: 0, vy: 0, life: 0, age: 1 }));
  let time = reduced ? 5 : 0;

  disposer.listen(root, 'pointermove', (event) => {
    const local = localPointer(event, root);
    ptr.x = local.x;
    ptr.y = local.y;
    ptr.inside = true;
  });
  disposer.listen(root, 'pointerleave', () => {
    ptr.inside = false;
  });

  function draw(dt) {
    const { cols, rows, aspect } = g;
    const [flame, core] = g.layers;
    time += dt * p.speed;
    const wide = (cols * aspect) / rows; // 枠の高さを 1 としたときの幅

    // 一覧の小さな枠では、触らなくても炎をあおる位置が左右に動く。
    const auto = preview && !ptr.inside;
    const tx = auto ? 0.5 + 0.34 * Math.sin(time * 0.7) : ptr.x;
    const ty = auto ? 0.62 : ptr.y;
    const ease = 1 - Math.exp(-dt * 5);
    ptr.sx += (tx - ptr.sx) * ease;
    ptr.sy += (ty - ptr.sy) * ease;
    ptr.gain += ((ptr.inside || auto ? 1 : 0) - ptr.gain) * (1 - Math.exp(-dt * 3));
    const px = ptr.sx * wide;
    const py = 1 - ptr.sy;
    const tall = p.height * intro.v;

    // 列ごとの炎の高さ。ゆっくり変わるノイズに、ポインターの分を足す。
    const reachOf = (x) => {
      const fan = Math.exp(-(((x - px) / 0.2) ** 2)) * ptr.gain;
      return tall * (0.5 + 0.55 * noise(x * 1.4, time * 0.45, 3.7)) + fan * (0.2 + 0.5 * py);
    };

    for (let c = 0; c < cols; c += 1) {
      const x = ((c + 0.5) / cols) * wide;
      const reach = Math.max(0.02, reachOf(x));
      const fan = Math.exp(-(((x - px) / 0.2) ** 2)) * ptr.gain;
      for (let r = 0; r < rows; r += 1) {
        const index = r * cols + c;
        const y = 1 - (r + 0.5) / rows;
        // 上へ行くほど横に揺らし、ノイズ全体を上へ流す。
        const sway = 0.05 * y * Math.sin(y * 7 - time * 3.2 + x * 5);
        const n = 0.62 * noise((x + sway) * 5.2, y * 3.4 - time * 2.1, time * 0.5) + 0.38 * noise((x + sway) * 11, y * 7.5 - time * 3.4, time * 0.9 + 9);
        const near = Math.exp(-(((x - px) ** 2 + (y - py) ** 2) / 0.02)) * ptr.gain;
        let heat = (1 - y / reach) * 1.2 + (n - 0.56) * 1.5 + near * 0.5 + fan * 0.12;
        heat = clamp(heat, 0, 1) * Math.min(1, intro.v * 1.4);
        if (heat <= 0.015) {
          flame[index] = SPACE;
          core[index] = SPACE;
          continue;
        }
        const code = RAMP_CODES[Math.max(1, Math.round(heat ** 0.85 * LAST))];
        if (heat > 0.68) {
          core[index] = code;
          flame[index] = SPACE;
        } else {
          flame[index] = code;
          core[index] = SPACE;
        }
      }
    }

    // 火の粉。炎の先から生まれ、揺れながら上って消える。
    for (const spark of sparks) {
      spark.age += dt * p.speed;
      if (spark.age >= spark.life) {
        if (intro.v < 0.6) continue;
        const nearPointer = ptr.gain > 0.5 && Math.random() < 0.4;
        spark.x = nearPointer ? px + (Math.random() - 0.5) * 0.3 : Math.random() * wide;
        spark.y = reachOf(spark.x) * (0.55 + Math.random() * 0.35);
        spark.vx = (Math.random() - 0.5) * 0.1;
        spark.vy = 0.22 + Math.random() * 0.3;
        spark.life = 0.9 + Math.random() * 1.6;
        spark.age = 0;
      }
      spark.y += spark.vy * dt * p.speed;
      spark.x += (spark.vx + 0.06 * Math.sin(time * 4 + spark.life * 20)) * dt * p.speed;
      const c = Math.floor((spark.x / wide) * cols);
      const r = Math.floor((1 - spark.y) * rows);
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      const index = r * cols + c;
      if (core[index] !== SPACE || flame[index] > 58) continue;
      flame[index] = SPACE;
      core[index] = SPARK_CODES[Math.min(3, Math.floor((spark.age / spark.life) * 4))];
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
  if (!reduced) animate(intro, { v: 1, duration: 1500, ease: 'outQuad' });

  const refit = () => {
    if (g.fit() && reduced) tick(0.05);
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
      disposer.run();
      removeRoot(root);
    },
  };
}
