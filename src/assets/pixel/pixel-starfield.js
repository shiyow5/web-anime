import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'pixel-starfield',
  title: 'ドット絵の星空',
  category: 'pixel',
  libs: ['animejs'],
  description:
    '奥行きの違う 3 層の星が瞬きながら流れ、縞模様の惑星がゆっくり自転し、ときどき流れ星が横切ります。ポインターを動かすと層がずれて奥行きが見え、クリックすると、押した場所を中心に星が外へ尾を引いて伸び、ワープに入ったようになります。いちばん伸びたところで空が光って、その場所から流れ星が飛び出し、星の尾はゆっくり縮んで元の星空に戻ります。ゲームのタイトル画面や宇宙の場面の背景に使えます。',
  params: {
    density: { type: 'range', label: '星の数', min: 0.3, max: 2, step: 0.1, default: 1 },
    speed: { type: 'range', label: '流れる速さ', min: 0, max: 3, step: 0.1, default: 1 },
    meteors: { type: 'range', label: '流れ星の頻度', min: 0, max: 3, step: 0.1, default: 1 },
    ring: { type: 'boolean', label: '惑星に輪を付ける', default: true },
    planet: { type: 'color', label: '惑星の色', default: '#e8794a' },
    background: { type: 'color', label: '宇宙の色', default: '#070616' },
  },
};

const CSS = `
.ua-psf{position:absolute;inset:0;overflow:hidden;cursor:pointer}
.ua-psf canvas{position:absolute;left:0;top:0;display:block;image-rendering:crisp-edges;image-rendering:pixelated}
`;

const BASE_W = 160;
const BASE_H = 100;
const STAR_COLORS = ['#ffffff', '#bcd4ff', '#fff0b8', '#ffc4e0'];
// 奥から手前の順。speed は 1 秒に流れる画素数、shift はポインターでずれる量。
const STAR_LAYERS = [
  { count: 60, speed: 0.8, shift: 1, dim: 0.55 },
  { count: 34, speed: 2.2, shift: 3, dim: 0.25 },
  { count: 16, speed: 5, shift: 6, dim: 0 },
];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const LIGHT = [-0.56, -0.5, 0.66];

const hash = (n) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const from = rgb(a);
  const to = rgb(b);
  return `rgb(${from.map((v, i) => Math.round(v + (to[i] - v) * t)).join(',')})`;
};

// 入れ物の大きさから、整数倍で拡大できる画素数を決める。画面外では visible が偽になる。
function createPixelView(root, disposer, baseW, baseH, onResize) {
  const canvas = h('canvas', { 'aria-hidden': 'true' });
  root.appendChild(canvas);
  const view = { canvas, ctx: canvas.getContext('2d'), w: 0, h: 0, scale: 1, visible: true };
  view.fit = () => {
    const cw = root.clientWidth || baseW;
    const ch = root.clientHeight || baseH;
    const scale = Math.max(1, Math.floor(Math.min(cw / baseW, ch / baseH)));
    const w = Math.ceil(cw / scale);
    const hh = Math.ceil(ch / scale);
    if (w === view.w && hh === view.h && scale === view.scale) return;
    Object.assign(view, { w, h: hh, scale });
    canvas.width = w;
    canvas.height = hh;
    canvas.style.width = `${w * scale}px`;
    canvas.style.height = `${hh * scale}px`;
    onResize(view);
  };
  const resizeObserver = new ResizeObserver(() => view.fit());
  resizeObserver.observe(root);
  disposer.add(() => resizeObserver.disconnect());
  const intersectionObserver = new IntersectionObserver((entries) => {
    view.visible = entries[entries.length - 1].isIntersecting;
  });
  intersectionObserver.observe(root);
  disposer.add(() => intersectionObserver.disconnect());
  return view;
}

// 格子点の乱数をなめらかにつないだノイズ。星雲の形に使う。
function valueNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const at = (ix, iy) => hash(ix * 37.7 + iy * 91.3);
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
  const bottom = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
  return top + (bottom - top) * sy;
}

// 星雲を別のキャンバスに 1 回だけ描いておく。
function renderNebula(w, hgt, colors) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < hgt; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const n = valueNoise(x / 26 + 3, y / 20 + 7) * 0.7 + valueNoise(x / 9, y / 9) * 0.3;
      const level = n + (BAYER[(x & 3) + (y & 3) * 4] / 16 - 0.5) * 0.16;
      if (level < 0.56) continue;
      ctx.fillStyle = level > 0.7 ? colors[1] : colors[0];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-psf', { background: p.background });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const textures = [p.planet, mix(p.planet, '#ffffff', 0.32), mix(p.planet, '#4a1a7a', 0.45)];
  // 模様の色ごとに、影から光まで 4 段階の色を用意する。
  const planetPalette = textures.map((color) => [
    mix(color, '#05030f', 0.86),
    mix(color, '#05030f', 0.5),
    color,
    mix(color, '#ffffff', 0.3),
  ]);
  const ringColors = [mix(p.planet, '#ffffff', 0.55), mix(p.planet, '#ffffff', 0.2)];
  const nebulaColors = [mix(p.background, '#5a2a9a', 0.32), mix(p.background, '#2a6ab0', 0.4)];
  const starColors = STAR_LAYERS.map((layer) => STAR_COLORS.map((color) => mix(color, p.background, layer.dim)));
  const state = { intro: reduced ? 1 : 0, shiftX: 0, shiftY: 0, flash: 0, warp: 0 };
  const warpAt = { x: 0, y: 0 };
  const pointer = { x: 0, y: 0 };
  let nebula = null;
  let meteors = [];
  let time = reduced ? 2 : 0;
  let nextMeteor = 1.2;
  let destroyed = false;

  function drawStars(ctx, w, hgt) {
    STAR_LAYERS.forEach((layer, li) => {
      const count = Math.round(layer.count * p.density * (p.preview ? 0.7 : 1));
      for (let i = 0; i < count; i += 1) {
        const key = li * 500 + i;
        if (hash(key + 77) > state.intro) continue;
        const x = Math.floor((((hash(key) * w - time * layer.speed * p.speed + state.shiftX * layer.shift) % w) + w) % w);
        const y = Math.floor((((hash(key + 0.5) * hgt + state.shiftY * layer.shift) % hgt) + hgt) % hgt);
        const twinkle = Math.sin(time * (0.7 + hash(key + 9) * 2.6) + hash(key + 3) * 6.28);
        if (twinkle < -0.7) continue;
        ctx.fillStyle = starColors[li][Math.floor(hash(key + 5) * STAR_COLORS.length)];
        ctx.fillRect(x, y, 1, 1);
        if (state.warp > 0.03) {
          // ワープ。押した場所から遠い星ほど、手前の層ほど、長い尾を引く。
          const dx = x - warpAt.x;
          const dy = y - warpAt.y;
          const d = Math.hypot(dx, dy) || 1;
          const len = Math.round(state.warp * (2 + li * 3) * (0.4 + (d / w) * 2.4));
          for (let k = 1; k <= len; k += 1) ctx.fillRect(Math.round(x + (dx / d) * k), Math.round(y + (dy / d) * k), 1, 1);
        }
        if (li === 2 && twinkle > 0.5) {
          ctx.fillRect(x - 1, y, 3, 1);
          ctx.fillRect(x, y - 1, 1, 3);
        }
      }
    });
  }

  // 輪の半周ぶんを描く。front が真なら手前側、偽なら惑星の奥側。
  function drawRing(ctx, cx, cy, radius, front) {
    [1.95, 1.72, 1.5].forEach((k, i) => {
      const rx = radius * k;
      ctx.fillStyle = ringColors[i % 2];
      for (let a = 0; a < Math.PI; a += 0.6 / rx) {
        const angle = front ? a : a + Math.PI;
        const x = Math.cos(angle) * rx;
        ctx.fillRect(Math.round(cx + x), Math.round(cy + Math.sin(angle) * rx * 0.24 + x * 0.2), 1, 1);
      }
    });
  }

  function drawPlanet(ctx, cx, cy, radius) {
    const spin = time * 0.22 * (0.4 + p.speed * 0.6);
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const nx = dx / radius;
        const ny = dy / radius;
        const rest = 1 - nx * nx - ny * ny;
        if (rest < 0) continue;
        const nz = Math.sqrt(rest);
        // 球の表面の経度と緯度から、縞と斑点の模様を決める。
        const lon = (Math.atan2(nx, nz) + spin) / (Math.PI * 2);
        const band = Math.floor((Math.asin(ny) / Math.PI + 0.5) * 8);
        const cell = Math.floor((lon - Math.floor(lon)) * 26 + band * 0.4);
        const spot = hash(band * 31 + (cell % 26));
        const texture = spot < 0.22 ? 1 : band % 3 === 1 ? 2 : 0;
        const lightness = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2] + (BAYER[((cx + dx) & 3) + ((cy + dy) & 3) * 4] / 16 - 0.5) * 0.3;
        const level = lightness < 0.02 ? 0 : lightness < 0.34 ? 1 : lightness < 0.78 ? 2 : 3;
        ctx.fillStyle = planetPalette[texture][level];
        ctx.fillRect(cx + dx, cy + dy, 1, 1);
      }
    }
  }

  function drawMoon(ctx, cx, cy, radius, front) {
    const angle = time * 0.5;
    if (Math.sin(angle) > 0 !== front) return;
    const x = Math.round(cx + Math.cos(angle) * radius * 2.4);
    const y = Math.round(cy - radius * 0.5 + Math.sin(angle) * radius * 0.5);
    ctx.fillStyle = '#d9d6e8';
    ctx.fillRect(x - 1, y - 2, 3, 5);
    ctx.fillRect(x - 2, y - 1, 5, 3);
    ctx.fillStyle = '#8f8aa8';
    ctx.fillRect(x, y, 2, 2);
  }

  function drawMeteors(ctx) {
    for (const m of meteors) {
      const length = 10;
      const speed = Math.hypot(m.vx, m.vy);
      for (let i = length; i >= 0; i -= 1) {
        const k = i / length;
        ctx.fillStyle = i === 0 ? '#ffffff' : k < 0.35 ? '#bfe6ff' : k < 0.7 ? '#5f8fe0' : '#2c3f8a';
        ctx.fillRect(Math.round(m.x - (m.vx / speed) * i), Math.round(m.y - (m.vy / speed) * i), 1, 1);
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(m.x) - 1, Math.round(m.y), 3, 1);
      ctx.fillRect(Math.round(m.x), Math.round(m.y) - 1, 1, 3);
    }
  }

  function draw() {
    const { ctx, w, h: hgt } = view;
    ctx.fillStyle = state.flash > 0.6 ? mix(p.background, '#3a4a9a', 0.35) : p.background;
    ctx.fillRect(0, 0, w, hgt);
    if (nebula) {
      const offset = Math.floor((time * 0.5 * p.speed) % w);
      ctx.drawImage(nebula, -offset, 0);
      ctx.drawImage(nebula, w - offset, 0);
    }
    drawStars(ctx, w, hgt);
    const radius = Math.round(Math.min(w, hgt) * 0.2);
    const cx = Math.round(w * 0.66 + state.shiftX * 9);
    const cy = Math.round(hgt * 0.56 + state.shiftY * 9 + (1 - state.intro) * hgt * 0.7);
    drawMoon(ctx, cx, cy, radius, false);
    if (p.ring) drawRing(ctx, cx, cy, radius, false);
    drawPlanet(ctx, cx, cy, radius);
    if (p.ring) drawRing(ctx, cx, cy, radius, true);
    drawMoon(ctx, cx, cy, radius, true);
    drawMeteors(ctx);
  }

  // x, y は素材の左上からの位置（px）。省くと画面の上のほうから出す。
  function shoot(x, y) {
    if (destroyed || reduced || meteors.length > 8) return;
    const direction = Math.random() < 0.5 ? -1 : 1;
    const startX = Number.isFinite(x) ? x / view.scale : view.w * (direction > 0 ? utils.random(0, 0.5, 2) : utils.random(0.5, 1, 2));
    const startY = Number.isFinite(y) ? y / view.scale : view.h * utils.random(0, 0.35, 2);
    meteors.push({ x: startX, y: startY, vx: direction * utils.random(70, 110), vy: utils.random(30, 55), life: 0, max: utils.random(0.7, 1.2, 2) });
    animate(state, { flash: [1, 0], duration: 500, ease: 'outQuad' });
  }

  function update(dt) {
    time += dt;
    state.shiftX += (pointer.x - state.shiftX) * Math.min(1, dt * 4);
    state.shiftY += (pointer.y - state.shiftY) * Math.min(1, dt * 4);
    meteors = meteors.map((m) => ({ ...m, life: m.life + dt, x: m.x + m.vx * dt, y: m.y + m.vy * dt })).filter((m) => m.life < m.max);
    if (p.meteors > 0 && time > nextMeteor) {
      nextMeteor = time + utils.random(1.6, 4.5, 2) / p.meteors;
      shoot();
    }
  }

  const view = createPixelView(root, disposer, BASE_W, BASE_H, (v) => {
    nebula = renderNebula(v.w, v.h, nebulaColors);
    if (reduced) draw();
  });
  view.fit();

  const destroyBase = () => {
    destroyed = true;
    utils.remove(state);
    disposer.run();
    removeRoot(root);
  };
  if (reduced) return { shoot, destroy: destroyBase };

  // 星が少しずつ増え、惑星が下から昇ってくる。
  animate(state, { intro: [0, 1], duration: 1800, ease: 'outExpo' });
  let last = performance.now();
  const timer = createTimer({
    frameRate: 30,
    onUpdate() {
      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      if (!view.visible) return;
      update(dt);
      draw();
    },
  });
  disposer.listen(root, 'pointermove', (event) => {
    const { x, y } = localPointer(event, root);
    pointer.x = 0.5 - x;
    pointer.y = 0.5 - y;
  });
  disposer.listen(root, 'pointerleave', () => {
    pointer.x = 0;
    pointer.y = 0;
  });
  disposer.listen(root, 'pointerdown', (event) => {
    const { px, py } = localPointer(event, root);
    if (destroyed || reduced || view.scale <= 0) return;
    warpAt.x = px / view.scale;
    warpAt.y = py / view.scale;
    // 準備: 星が尾を引き始める。山場: 伸びきって流れ星が飛び出す。余韻: 尾がゆっくり縮む。
    animate(state, {
      warp: [
        { to: 1, duration: 420, ease: 'inQuad' },
        { to: 0, duration: 1300, ease: 'outCubic' },
      ],
    });
    disposer.timeout(() => shoot(px, py), 400);
  });

  return {
    shoot,
    destroy() {
      timer.pause();
      destroyBase();
    },
  };
}
