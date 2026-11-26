import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot, localPointer } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'pixel-night-city',
  title: 'ドット絵の夜の街',
  category: 'pixel',
  libs: ['animejs'],
  description:
    '奥・中・手前の 3 層のビルが違う速さで横に流れ、窓の明かりが点いたり消えたりします。雨か雪が降り、クリックすると、押した場所の真上に雷が落ちます。街全体が一瞬明るくなったあと停電して窓がいっせいに消え、押した場所から左右へ、灯りがちらつきながら順に戻っていきます。タイトル画面や、夜の場面の背景に使えます。',
  params: {
    weather: {
      type: 'select',
      label: '天気',
      options: [
        { value: 'rain', label: '雨' },
        { value: 'snow', label: '雪' },
        { value: 'clear', label: '晴れ' },
      ],
      default: 'rain',
    },
    density: { type: 'range', label: '雨や雪の量', min: 0.2, max: 2, step: 0.1, default: 1 },
    speed: { type: 'range', label: '流れる速さ', min: 0, max: 3, step: 0.1, default: 1 },
    lit: { type: 'range', label: '明かりの付いた窓の割合', min: 0.1, max: 0.9, step: 0.05, default: 0.45 },
    window: { type: 'color', label: '窓の色', default: '#ffd36b' },
    sky: { type: 'color', label: '夜空の色', default: '#171238' },
  },
};

const CSS = `
.ua-pnc{position:absolute;inset:0;overflow:hidden;cursor:pointer}
.ua-pnc canvas{position:absolute;left:0;top:0;display:block;image-rendering:crisp-edges;image-rendering:pixelated}
`;

const BASE_W = 160;
const BASE_H = 100;
// 奥から手前の順。speed は 1 秒に流れる画素数、shade は空の色に混ぜる黒の割合。
const LAYERS = [
  { speed: 3, shade: 0.3, minH: 0.34, maxH: 0.62, minW: 9, maxW: 18, winW: 1, winH: 1, gapX: 3, gapY: 3, dim: 0.5 },
  { speed: 8, shade: 0.56, minH: 0.22, maxH: 0.5, minW: 12, maxW: 24, winW: 1, winH: 2, gapX: 3, gapY: 4, dim: 0.22 },
  { speed: 18, shade: 0.8, minH: 0.1, maxH: 0.34, minW: 16, maxW: 30, winW: 2, winH: 2, gapX: 4, gapY: 5, dim: 0 },
];
const LAMP_GAP = 46;

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

// 1 層ぶんのビルを、画面より広い幅で並べる。この幅で繰り返して流す。
function buildLayer(spec, index, width, height) {
  const buildings = [];
  let x = 0;
  let id = index * 1000;
  while (x < width * 1.6 || buildings.length < 4) {
    id += 1;
    const w = Math.round(spec.minW + hash(id) * (spec.maxW - spec.minW));
    buildings.push({
      id,
      x,
      w,
      h: Math.round(height * (spec.minH + hash(id + 0.5) * (spec.maxH - spec.minH))),
      roof: hash(id + 0.25),
    });
    x += w + Math.floor(hash(id + 0.75) * 3);
  }
  return { spec, buildings, period: x };
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-pnc', { background: p.sky });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const skyBands = [0, 0.08, 0.18, 0.3, 0.42].map((k) => mix(p.sky, '#b0457a', k));
  const flashBands = skyBands.map((_, i) => mix(p.sky, '#cfd8ff', 0.45 + i * 0.08));
  const wallColors = LAYERS.map((layer) => mix(p.sky, '#000000', layer.shade));
  const wallFlash = LAYERS.map((layer) => mix(p.sky, '#8f9be0', 0.5 - layer.shade * 0.4));
  const windowColors = LAYERS.map((layer, i) => mix(p.window, p.sky, layer.dim));
  const coolWindow = LAYERS.map((layer) => mix('#9fe8ff', p.sky, layer.dim));
  const darkWindow = mix(p.sky, '#000000', 0.62);
  const road = mix(p.sky, '#000000', 0.88);
  const dropColor = p.weather === 'snow' ? '#f2f6ff' : mix('#8fb6ff', p.sky, 0.25);
  const state = { flash: 0, out: 0, relight: 0, rise0: reduced ? 0 : 1, rise1: reduced ? 0 : 1, rise2: reduced ? 0 : 1 };
  let layers = [];
  let drops = [];
  let bolt = [];
  let boltX = 0;
  let time = reduced ? 3 : 0;
  let destroyed = false;

  function rebuild(v) {
    layers = LAYERS.map((spec, i) => buildLayer(spec, i, v.w, v.h));
    const count = p.weather === 'clear' ? 0 : Math.round(((v.w * v.h) / 240) * p.density * (p.preview ? 0.7 : 1));
    drops = Array.from({ length: count }, (_, i) => ({
      x: hash(i + 400) * v.w,
      y: hash(i + 800) * v.h,
      fall: 0.7 + hash(i + 1200) * 0.6,
      phase: hash(i + 1600) * 6.28,
    }));
  }

  function drawSky(ctx, w, groundY) {
    const bands = state.flash > 0.55 ? flashBands : skyBands;
    const bandHeight = Math.ceil(groundY / bands.length);
    bands.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, i * bandHeight, w, bandHeight);
    });
    for (let i = 0; i < 22; i += 1) {
      if (Math.sin(time * (0.6 + hash(i + 2)) + i) < -0.4) continue;
      ctx.fillStyle = '#b9b6e6';
      ctx.fillRect(Math.floor(hash(i + 60) * w), Math.floor(hash(i + 90) * groundY * 0.45), 1, 1);
    }
    if (state.flash > 0.6) {
      ctx.fillStyle = '#ffffff';
      for (const [x, y, len] of bolt) ctx.fillRect(x, y, 1, len);
    }
  }

  function drawWindows(ctx, building, left, top, base, index) {
    const { spec } = layers[index];
    const allOn = state.flash > 0.12 && state.flash < 0.55;
    let row = 0;
    for (let y = top + 2; y + spec.winH < base - 1; y += spec.gapY) {
      let col = 0;
      for (let x = left + 1; x + spec.winW < left + building.w; x += spec.gapX) {
        const key = building.id * 97 + row * 13 + col;
        const period = 5 + hash(key) * 12;
        const epoch = Math.floor(time / period + hash(key + 1));
        let on = allOn || hash(key * 1.7 + epoch * 13.3) < p.lit;
        if (!allOn && state.out > 0.5) {
          // 停電のあいだは消える。灯りは雷の落ちた場所から外へ戻り、戻りぎわの窓はちらつく。
          const far = Math.abs(x - boltX) / Math.max(1, view.w) - hash(key + 9) * 0.06;
          const front = state.relight * 1.1;
          on = on && far < front && (far < front - 0.07 || hash(key + Math.floor(time * 14)) > 0.45);
        }
        if (on) ctx.fillStyle = hash(key + 5) < 0.18 ? coolWindow[index] : windowColors[index];
        else if (index === 2) ctx.fillStyle = darkWindow;
        if (on || index === 2) ctx.fillRect(x, y, spec.winW, spec.winH);
        col += 1;
      }
      row += 1;
    }
  }

  function drawBuilding(ctx, building, left, base, index) {
    const top = base - building.h;
    ctx.fillStyle = state.flash > 0.55 ? wallFlash[index] : wallColors[index];
    ctx.fillRect(left, top, building.w, building.h + 40);
    if (building.roof < 0.3) {
      // アンテナ。先の赤い灯りが点滅する。
      const mast = 4 + Math.floor(building.roof * 12);
      ctx.fillRect(left + Math.floor(building.w / 2), top - mast, 1, mast);
      if (Math.floor(time * 1.4 + building.id) % 2 === 0) {
        ctx.fillStyle = '#ff4d5e';
        ctx.fillRect(left + Math.floor(building.w / 2), top - mast - 1, 1, 1);
      }
    } else if (building.roof < 0.6) {
      ctx.fillRect(left + 2, top - 3, building.w - 4, 3);
    } else if (building.roof < 0.75) {
      ctx.fillRect(left + 1, top - 2, 3, 2);
      ctx.fillRect(left + building.w - 5, top - 4, 3, 4);
    }
    drawWindows(ctx, building, left, top, base, index);
  }

  function drawLayer(ctx, index, w, groundY, hgt) {
    const layer = layers[index];
    const offset = (time * layer.spec.speed * p.speed) % layer.period;
    const rise = [state.rise0, state.rise1, state.rise2][index];
    const base = groundY + Math.round(rise * hgt * 0.7);
    for (const building of layer.buildings) {
      for (let rep = 0; rep < 2; rep += 1) {
        const left = Math.floor(building.x - offset + rep * layer.period);
        if (left > w || left + building.w < 0) continue;
        drawBuilding(ctx, building, left, base, index);
      }
    }
  }

  function drawStreet(ctx, w, hgt, groundY) {
    ctx.fillStyle = road;
    ctx.fillRect(0, groundY, w, hgt - groundY);
    ctx.fillStyle = mix(p.sky, '#6f7bd0', 0.35);
    ctx.fillRect(0, groundY, w, 1);
    const offset = (time * 26 * p.speed) % LAMP_GAP;
    for (let x = -offset; x < w + LAMP_GAP; x += LAMP_GAP) {
      const left = Math.floor(x);
      ctx.fillStyle = '#05060d';
      ctx.fillRect(left, groundY - 13, 1, 13);
      ctx.fillRect(left, groundY - 13, 4, 1);
      ctx.fillStyle = '#fff1b8';
      ctx.fillRect(left + 3, groundY - 12, 2, 1);
      // 濡れた路面に落ちる明かり。
      ctx.fillStyle = mix(p.window, p.sky, 0.55);
      ctx.fillRect(left, groundY + 2, 8, 1);
      ctx.fillRect(left + 2, groundY + 4, 4, 1);
    }
    const lane = groundY + Math.max(3, Math.floor((hgt - groundY) / 2));
    const carA = ((time * 42) % (w + 60)) - 30;
    const carB = w + 30 - ((time * 30 + 70) % (w + 60));
    ctx.fillStyle = '#0a0b14';
    ctx.fillRect(Math.floor(carA), lane - 2, 8, 3);
    ctx.fillRect(Math.floor(carB), lane + 1, 8, 3);
    ctx.fillStyle = '#fff6c9';
    ctx.fillRect(Math.floor(carA) + 8, lane - 1, 1, 1);
    ctx.fillStyle = '#ff4d5e';
    ctx.fillRect(Math.floor(carB) + 8, lane + 2, 1, 1);
  }

  function drawWeather(ctx, w, hgt) {
    ctx.fillStyle = dropColor;
    const snow = p.weather === 'snow';
    for (const drop of drops) {
      if (snow) {
        const x = (drop.x + Math.sin(time * 1.2 + drop.phase) * 4 + w) % w;
        const y = (drop.y + time * 11 * drop.fall) % hgt;
        ctx.fillRect(Math.floor(x), Math.floor(y), drop.fall > 1.15 ? 2 : 1, drop.fall > 1.15 ? 2 : 1);
      } else {
        const y = (drop.y + time * 130 * drop.fall) % hgt;
        const x = (((drop.x - time * 30 * drop.fall) % w) + w) % w;
        ctx.fillRect(Math.floor(x), Math.floor(y), 1, drop.fall > 1 ? 3 : 2);
      }
    }
  }

  function draw() {
    const { ctx, w, h: hgt } = view;
    const groundY = hgt - Math.max(8, Math.round(hgt * 0.11));
    drawSky(ctx, w, groundY);
    // 月。
    ctx.fillStyle = '#f1e8c8';
    ctx.fillRect(Math.round(w * 0.16), Math.round(hgt * 0.12), 6, 6);
    ctx.fillStyle = skyBands[0];
    ctx.fillRect(Math.round(w * 0.16), Math.round(hgt * 0.12), 1, 1);
    ctx.fillRect(Math.round(w * 0.16) + 5, Math.round(hgt * 0.12), 1, 1);
    ctx.fillRect(Math.round(w * 0.16), Math.round(hgt * 0.12) + 5, 1, 1);
    ctx.fillRect(Math.round(w * 0.16) + 5, Math.round(hgt * 0.12) + 5, 1, 1);
    for (let i = 0; i < layers.length; i += 1) drawLayer(ctx, i, w, groundY, hgt);
    drawStreet(ctx, w, hgt, groundY);
    drawWeather(ctx, w, hgt);
  }

  function flash(event) {
    if (destroyed || reduced) return;
    const at = event && Number.isFinite(event.clientX) && view.scale > 0 ? localPointer(event, root).px / view.scale : NaN;
    const startX = Number.isFinite(at) ? Math.round(at) : Math.round(view.w * utils.random(0.2, 0.8, 2));
    boltX = startX;
    let x = startX;
    bolt = Array.from({ length: 9 }, (_, i) => {
      x += Math.round(utils.random(-3, 3));
      return [x, i * 4, 4];
    });
    animate(state, { flash: [1, 0], duration: 900, ease: 'outQuad' });
    // 余韻: 稲光が収まると停電し、灯りが順に戻る。
    animate(state, {
      out: [
        { to: 0, duration: 480 },
        { to: 1, duration: 1 },
        { to: 1, duration: 2500 },
        { to: 0, duration: 1 },
      ],
      relight: [
        { to: 0, duration: 1100 },
        { to: 1, duration: 1800, ease: 'inOutSine' },
      ],
    });
  }

  const view = createPixelView(root, disposer, BASE_W, BASE_H, (v) => {
    rebuild(v);
    if (reduced) draw();
  });
  view.fit();

  const destroyBase = () => {
    destroyed = true;
    utils.remove(state);
    disposer.run();
    removeRoot(root);
  };
  if (reduced) return { flash, destroy: destroyBase };

  // 奥の層から順に、ビルが下からせり上がる。
  animate(state, {
    rise0: { to: 0, duration: 1100, delay: 0 },
    rise1: { to: 0, duration: 1100, delay: 220 },
    rise2: { to: 0, duration: 1100, delay: 440 },
    ease: 'outExpo',
  });
  let last = performance.now();
  const timer = createTimer({
    frameRate: 30,
    onUpdate() {
      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      if (!view.visible) return;
      time += dt;
      draw();
    },
  });
  disposer.listen(root, 'pointerdown', flash);
  if (p.preview) disposer.interval(() => flash(), 5200);

  return {
    flash,
    destroy() {
      timer.pause();
      destroyBase();
    },
  };
}
