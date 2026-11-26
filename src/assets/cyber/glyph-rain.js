import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'glyph-rain',
  title: '降る記号',
  category: 'cyber',
  libs: ['animejs'],
  description:
    '線と点を乱数でつないで作った架空の文字が、奥・中・手前の層に分かれて降ります。奥は小さく暗く、手前は大きくぼやけて、奥行きが出ます。ポインターの近くの列は速く明るくなり、タップすると雨が止まり、その位置から輪が広がって文字を押しのけ、輪の内側が同じ 1 文字にそろっていきます。そろった文字はやがてほどけて全体が光り、雨が勢いよく降り直します。',
  params: {
    near: { type: 'color', label: '手前の色', default: '#ffb86b' },
    far: { type: 'color', label: '奥の色', default: '#7a4dff' },
    background: { type: 'color', label: '背景色', default: '#0a0616' },
    layers: { type: 'range', label: '層の数', min: 2, max: 4, step: 1, default: 3 },
    density: { type: 'range', label: '列の多さ', min: 0.2, max: 1, step: 0.05, default: 0.7 },
    speed: { type: 'range', label: '降る速さ', min: 0.2, max: 3, step: 0.1, default: 1 },
    seed: { type: 'range', label: '文字の種', min: 1, max: 99, step: 1, default: 23 },
  },
};

const CSS = `
.ua-gr{position:absolute;inset:0;overflow:hidden;cursor:pointer;
  background:radial-gradient(120% 80% at 50% 105%,color-mix(in srgb,var(--ua-far) 34%,var(--ua-bg)),var(--ua-bg) 70%)}
.ua-gr canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.ua-gr__veil{position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(to bottom,var(--ua-bg),transparent 16%,transparent 78%,color-mix(in srgb,var(--ua-bg) 70%,transparent))}
`;

const GLYPHS = 40;

function mulberry(seed) {
  let a = seed * 2654435761;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 横 3 × 縦 4 の格子の点を、折れ線・点・小さな輪でつないで架空の文字を作る。
export function makeGlyphs(seed, count = GLYPHS) {
  const random = mulberry(seed);
  const node = () => [Math.floor(random() * 3), Math.floor(random() * 4)];
  return Array.from({ length: count }, () => {
    const strokes = Array.from({ length: 2 + Math.floor(random() * 2) }, () => Array.from({ length: 2 + Math.floor(random() * 2) }, node));
    const dots = Array.from({ length: Math.floor(random() * 3) }, node);
    const ring = random() < 0.3 ? node() : null;
    return { strokes, dots, ring };
  });
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

// 文字を 1 枚の画像に並べておく。上の段が本体の色、下の段が先頭の明るい色。
function buildAtlas(glyphs, size, body, head, blur) {
  const canvas = document.createElement('canvas');
  canvas.width = size * glyphs.length;
  canvas.height = size * 2;
  const ctx = canvas.getContext('2d');
  const pad = size * 0.2;
  const ux = (size - pad * 2) / 2;
  const uy = (size - pad * 2) / 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // ぼかした層は、線を薄くして影を広げることでにじませる。全体にぼかしをかけるより軽い。
  ctx.lineWidth = Math.max(1, size * (blur > 0 ? 0.11 : 0.085));
  ctx.globalAlpha = blur > 0 ? 0.55 : 1;
  [body, head].forEach((color, row) => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    // 影を広げすぎると、隣の升目にはみ出して四角い縁が見えるので、余白に収まる幅にする。
    ctx.shadowBlur = blur > 0 ? size * 0.16 : row === 1 ? size * 0.15 : size * 0.1;
    glyphs.forEach((glyph, i) => {
      const ox = i * size + pad;
      const oy = row * size + pad;
      for (const stroke of glyph.strokes) {
        ctx.beginPath();
        stroke.forEach(([x, y], j) => (j ? ctx.lineTo(ox + x * ux, oy + y * uy) : ctx.moveTo(ox + x * ux, oy + y * uy)));
        ctx.stroke();
      }
      for (const [x, y] of glyph.dots) {
        ctx.beginPath();
        ctx.arc(ox + x * ux, oy + y * uy, size * 0.075, 0, Math.PI * 2);
        ctx.fill();
      }
      if (glyph.ring) {
        ctx.beginPath();
        ctx.arc(ox + glyph.ring[0] * ux, oy + glyph.ring[1] * uy, size * 0.13, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  });
  return canvas;
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-gr', { '--ua-bg': p.background, '--ua-far': p.far });
  const canvas = h('canvas', { 'aria-hidden': 'true' });
  root.append(canvas, h('div', { class: 'ua-gr__veil' }));
  const ctx = canvas.getContext('2d');
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const glyphs = makeGlyphs(Math.round(p.seed));
  const random = mulberry(Math.round(p.seed) + 101);
  const farColor = hexToRgb(p.far);
  const nearColor = hexToRgb(p.near);
  const layerCount = Math.round(p.layers);
  const state = { fade: reduced ? 1 : 0, flash: 0 };
  const pointer = { x: 0.5, inside: false, sx: 0 };
  // 解読の波。r は輪の半径（px）、power は輪の強さ、lock が 1 のあいだ、輪の内側は同じ 1 文字にそろう。rate は降る速さの倍率。
  const wave = { x: 0, y: 0, r: 0, power: 0, lock: 0, glyph: 0, rate: 1 };
  let width = 1;
  let height = 1;
  let dpr = 1;
  let layers = [];

  function spawn(stream, rows, first) {
    stream.length = 6 + Math.floor(random() * 16);
    stream.rate = 0.6 + random() * 0.8;
    stream.head = first ? random() * (rows + stream.length) - stream.length * 0.5 : -random() * rows * 0.5;
  }

  function build() {
    const rect = root.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, p.preview ? 1.5 : 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    layers = Array.from({ length: layerCount }, (_, index) => {
      const depth = layerCount === 1 ? 1 : index / (layerCount - 1);
      // いちばん手前の層は、大きくぼかして前ぼけにする。
      const front = index === layerCount - 1 && layerCount >= 3;
      const cell = Math.max(7, height * (front ? 0.105 : 0.03 + depth * 0.035));
      const color = mix(mix(farColor, [255, 255, 255], 0.18 * (1 - depth)), nearColor, depth);
      const size = Math.ceil(cell * dpr);
      const blur = front ? size * 0.07 : index === 0 ? size * 0.04 : 0;
      const atlas = buildAtlas(glyphs, size, rgb(color), rgb(mix(color, [255, 255, 255], 0.78)), blur);
      const rows = Math.ceil(height / cell) + 1;
      const cols = Math.ceil(width / cell) + 4;
      const share = p.density * (front ? 0.4 : 1) * (p.preview ? 0.8 : 1);
      const streams = [];
      for (let col = 0; col < cols; col += 1) {
        if (random() > share) continue;
        const stream = { col, head: 0, length: 0, rate: 1, cells: Uint8Array.from({ length: rows }, () => Math.floor(random() * GLYPHS)) };
        spawn(stream, rows, true);
        streams.push(stream);
      }
      return { depth, front, cell, size, atlas, rows, streams, fall: 4 + depth * 6, alpha: front ? 0.6 : 0.6 + depth * 0.4 };
    });
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const layer of layers) {
      const { cell, size, atlas } = layer;
      const shift = -pointer.sx * layer.depth * cell * 1.6 - cell * 2;
      for (const stream of layer.streams) {
        const x = stream.col * cell + shift;
        const headRow = Math.floor(stream.head);
        for (let k = 0; k < stream.length; k += 1) {
          const row = headRow - k;
          if (row < 0 || row >= layer.rows) continue;
          const tail = 1 - k / stream.length;
          let px = x;
          let py = row * cell;
          let glyph = stream.cells[row];
          let band = 0;
          if (wave.power > 0.001 || wave.lock > 0) {
            const dx = px + cell / 2 - wave.x;
            const dy = py + cell / 2 - wave.y;
            const distance = Math.hypot(dx, dy) || 1;
            const gap = (distance - wave.r) / (cell * 2.4);
            band = Math.exp(-gap * gap) * wave.power;
            // 輪の上にある文字は外へ押し出され、輪の内側は同じ文字にそろう。
            px += (dx / distance) * band * cell * 0.9;
            py += (dy / distance) * band * cell * 0.9;
            if (wave.lock > 0 && distance < wave.r) glyph = wave.glyph;
          }
          ctx.globalAlpha = Math.min(1, (tail ** 1.35 * layer.alpha + state.flash * 0.5 + band * 0.9) * state.fade);
          ctx.drawImage(atlas, glyph * size, k === 0 || band > 0.45 ? size : 0, size, size, px, py, cell, cell);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function step(dt) {
    pointer.sx += ((pointer.inside ? pointer.x * 2 - 1 : 0) - pointer.sx) * Math.min(1, dt * 5);
    for (const layer of layers) {
      for (const stream of layer.streams) {
        const x = (stream.col * layer.cell) / width;
        const near = pointer.inside ? Math.max(0, 1 - Math.abs(x - pointer.x) / 0.14) : 0;
        const before = Math.floor(stream.head);
        stream.head += dt * layer.fall * stream.rate * p.speed * (1 + near * 2.2) * wave.rate;
        const after = Math.floor(stream.head);
        if (after !== before && after >= 0 && after < layer.rows) stream.cells[after] = Math.floor(random() * GLYPHS);
        // 降っている途中の文字も、ときどき別の文字に入れ替える。
        if (random() < dt * (1.5 + near * 8)) stream.cells[Math.floor(random() * layer.rows)] = Math.floor(random() * GLYPHS);
        if (stream.head - stream.length > layer.rows) spawn(stream, layer.rows, false);
      }
    }
  }

  const reshuffle = () => {
    for (const layer of layers) for (const stream of layer.streams) for (let i = 0; i < stream.cells.length; i += 1) stream.cells[i] = Math.floor(random() * GLYPHS);
  };
  // 解読。雨が止まり、タップした位置から輪が広がる（準備）→ 輪が文字を押しのけ、内側が同じ 1 文字にそろっていく（山場）
  // → そろった文字がほどけて全体が光り、雨が勢いよく降り直す（余韻）。
  function scramble(event) {
    if (reduced) {
      reshuffle();
      return draw();
    }
    const at = event?.clientX === undefined ? { px: width * (0.25 + Math.random() * 0.5), py: height * (0.3 + Math.random() * 0.4) } : localPointer(event, root);
    utils.remove(wave);
    Object.assign(wave, { x: at.px, y: at.py, r: 0, power: 1, lock: 1, glyph: Math.floor(random() * GLYPHS) });
    animate(wave, { r: Math.hypot(width, height) * 0.75, duration: 1500, delay: 100, ease: 'inOutSine' });
    animate(wave, {
      rate: [
        { to: 0.03, duration: 160, ease: 'outQuad' },
        { to: 0.03, duration: 1250 },
        { to: 3.4, duration: 260, ease: 'inQuad' },
        { to: 1, duration: 1300, ease: 'outExpo' },
      ],
    });
    animate(wave, {
      power: [
        { to: 1, duration: 1350 },
        { to: 0, duration: 500, ease: 'outQuad' },
      ],
    });
    animate(wave, {
      lock: [1, 1],
      duration: 1500,
      onComplete() {
        wave.lock = 0;
        reshuffle();
        animate(state, { flash: [1, 0], duration: 700, ease: 'outQuad' });
      },
    });
  }

  build();
  const observer = new ResizeObserver(() => {
    build();
    draw();
  });
  observer.observe(root);
  disposer.add(() => observer.disconnect());
  disposer.listen(root, 'click', scramble);

  if (reduced) {
    draw();
    return { scramble, destroy: () => (disposer.run(), removeRoot(root)) };
  }

  animate(state, { fade: [0, 1], duration: 1400, ease: 'outQuad' });
  disposer.listen(root, 'pointermove', (event) => {
    pointer.x = localPointer(event, root).x;
    pointer.inside = true;
  });
  disposer.listen(root, 'pointerleave', () => {
    pointer.inside = false;
  });
  let last = performance.now();
  const timer = createTimer({
    onUpdate() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      step(dt);
      draw();
    },
  });
  disposer.add(() => timer.pause());

  if (p.preview) disposer.interval(() => scramble(), 5000);

  return {
    scramble,
    destroy() {
      disposer.run();
      utils.remove([state, wave]);
      removeRoot(root);
    },
  };
}
