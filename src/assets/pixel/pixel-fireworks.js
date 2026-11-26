import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'pixel-fireworks',
  title: 'ドット絵の花火',
  category: 'pixel',
  libs: ['animejs'],
  description:
    '夜空に花火が打ち上がって開き、火の粉が重さで落ちながら消えていきます。下の水面には、揺れる映り込みが出ます。クリックした場所へ向けて、仕掛け花火を 1 発打ち上げます。大きく開いたあと、まわりに小さな花火が時間差で 3 つ続けて咲き、最後に中心で白く光る芯がはじけます。お祝いの画面や、夏の場面の背景に使えます。戻り値の launch() でも打ち上げられます。',
  params: {
    palette: {
      type: 'select',
      label: '色合い',
      options: [
        { value: 'festival', label: 'にぎやか' },
        { value: 'gold', label: '金色' },
        { value: 'cool', label: '涼しい色' },
      ],
      default: 'festival',
    },
    rate: { type: 'range', label: '打ち上げの頻度', min: 0.2, max: 3, step: 0.1, default: 1.1 },
    count: { type: 'range', label: '火の粉の数', min: 20, max: 120, step: 5, default: 60 },
    gravity: { type: 'range', label: '重さ', min: 0.2, max: 2, step: 0.1, default: 1 },
    reflect: { type: 'boolean', label: '水面に映す', default: true },
    skyline: { type: 'boolean', label: '遠くの街を出す', default: true },
  },
};

const CSS = `
.ua-pfw{position:absolute;inset:0;overflow:hidden;cursor:pointer;background:#070a20}
.ua-pfw canvas{position:absolute;left:0;top:0;display:block;image-rendering:crisp-edges;image-rendering:pixelated}
`;

const BASE_W = 120;
const BASE_H = 76;
const PALETTES = {
  festival: ['#ff4d6d', '#ffd23f', '#4de8ff', '#b388ff', '#7dff8a', '#ff9a3c'],
  gold: ['#ffd76a', '#ffb347', '#fff2b8', '#ff8a3c'],
  cool: ['#6ad4ff', '#8a9bff', '#c8f4ff', '#7dffd9'],
};
const SKY = ['#070a20', '#0a0f2c', '#0e1638', '#141f48'];
const SKY_FLASH = ['#0d1232', '#121a42', '#182452', '#203064'];
const WATER = '#060a1c';

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

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-pfw');
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  // 火の粉は、白 → 元の色 → 暗い色 の順に冷めていく。
  const ramps = PALETTES[p.palette].map((color) => ['#ffffff', color, mix(color, '#000000', 0.25), mix(color, '#000000', 0.5)]);
  const maxSparks = p.preview ? 380 : 900;
  const state = { flash: 0 };
  let rockets = [];
  let queued = [];
  let sparks = [];
  let time = 0;
  let nextLaunch = 0.3;
  let horizon = 70;
  let destroyed = false;

  function explode(x, y, colorIndex, scale = 1, finale = false) {
    const type = Math.floor(Math.random() * 3);
    const amount = Math.min(Math.round(p.count * (p.preview ? 0.6 : 1) * (scale < 1 ? 0.45 : 1)), maxSparks - sparks.length);
    const reach = Math.max(26, horizon * 0.55) * scale;
    if (finale) {
      // 仕掛け花火。まわりに小さな花火を時間差で咲かせ、最後に芯をはじけさせる。
      const turn = Math.random() * Math.PI * 2;
      for (let i = 0; i < 3; i += 1) {
        const angle = turn + (i / 3) * Math.PI * 2;
        queued.push({ at: time + 0.32 + i * 0.17, x: x + Math.cos(angle) * reach * 0.8, y: Math.min(horizon - 6, y + Math.sin(angle) * reach * 0.6), color: colorIndex + 1 + i, scale: 0.5 });
      }
      queued.push({ at: time + 0.95, x, y, color: colorIndex, scale: 0.3 });
    }
    for (let i = 0; i < amount; i += 1) {
      const angle = (i / amount) * Math.PI * 2 + Math.random() * 0.2;
      // 0 は球、1 は二重の輪、2 は長く垂れる柳。
      const power = type === 0 ? reach * (0.3 + 0.7 * Math.sqrt(Math.random())) : type === 1 ? reach * (i % 2 ? 1 : 0.55) : reach * (0.25 + Math.random() * 0.5);
      sparks.push({
        x,
        y,
        px: x,
        py: y,
        vx: Math.cos(angle) * power,
        vy: Math.sin(angle) * power,
        life: 0,
        max: type === 2 ? utils.random(1.6, 2.3, 2) : utils.random(1.1, 1.8, 2),
        weight: type === 2 ? 1.7 : 1,
        ramp: ramps[(colorIndex + (type === 1 && i % 2 ? 1 : 0)) % ramps.length],
      });
    }
    if (!reduced) animate(state, { flash: [1, 0], duration: 420, ease: 'outQuad' });
  }

  // x, y は素材の左上からの位置（px）。省くと、空のどこかへ向けて打ち上げる。
  function launch(x, y) {
    if (destroyed || reduced || rockets.length > 10) return;
    const targetX = Number.isFinite(x) ? x / view.scale : view.w * utils.random(0.14, 0.86, 2);
    const targetY = Number.isFinite(y) ? Math.min(horizon - 10, Math.max(6, y / view.scale)) : horizon * utils.random(0.16, 0.55, 2);
    rockets.push({ x: targetX + utils.random(-6, 6), y: horizon, targetX, targetY, color: Math.floor(Math.random() * ramps.length), finale: Number.isFinite(x) });
  }

  function update(dt) {
    time += dt;
    const arrived = [];
    rockets = rockets
      .map((r) => ({ ...r, y: r.y - (55 + (r.y - r.targetY) * 1.6) * dt, x: r.x + (r.targetX - r.x) * dt * 2 }))
      .filter((r) => {
        if (r.y > r.targetY + 1) return true;
        arrived.push(r);
        return false;
      });
    for (const r of arrived) explode(r.x, r.y, r.color, 1, r.finale);
    const due = queued.filter((item) => item.at <= time);
    queued = queued.filter((item) => item.at > time);
    for (const item of due) explode(item.x, item.y, item.color, item.scale);
    const drag = Math.exp(-1.7 * dt);
    const pull = 24 * p.gravity;
    sparks = sparks
      .map((s) => ({
        ...s,
        px: s.x,
        py: s.y,
        life: s.life + dt,
        vx: s.vx * drag,
        vy: s.vy * drag + pull * s.weight * dt,
        x: s.x + s.vx * dt,
        y: s.y + s.vy * dt,
      }))
      .filter((s) => s.life < s.max && s.y < horizon);
    if (time > nextLaunch) {
      nextLaunch = time + utils.random(0.5, 1.5, 2) / p.rate;
      launch();
    }
  }

  function drawSky(ctx, w) {
    const colors = state.flash > 0.5 ? SKY_FLASH : SKY;
    const bandHeight = Math.ceil(horizon / colors.length);
    colors.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, i * bandHeight, w, bandHeight);
    });
    for (let i = 0; i < 34; i += 1) {
      if (Math.sin(time * (0.5 + hash(i + 2)) + i) < -0.5) continue;
      ctx.fillStyle = i % 4 === 0 ? '#c9cff5' : '#6a72b0';
      ctx.fillRect(Math.floor(hash(i + 60) * w), Math.floor(hash(i + 90) * horizon * 0.7), 1, 1);
    }
  }

  function drawSkyline(ctx, w) {
    let x = 0;
    let id = 0;
    while (x < w) {
      id += 1;
      const width = 4 + Math.floor(hash(id) * 8);
      const height = 2 + Math.floor(hash(id + 0.5) * 11);
      ctx.fillStyle = state.flash > 0.5 ? '#0c1030' : '#04061a';
      ctx.fillRect(x, horizon - height, width, height);
      ctx.fillStyle = '#ffd98a';
      for (let wy = horizon - height + 1; wy < horizon - 1; wy += 3) {
        for (let wx = x + 1; wx < x + width - 1; wx += 2) {
          if (hash(id * 31 + wx * 7 + wy) < 0.28) ctx.fillRect(wx, wy, 1, 1);
        }
      }
      x += width;
    }
  }

  function drawFire(ctx) {
    for (const r of rockets) {
      ctx.fillStyle = '#fff2b8';
      ctx.fillRect(Math.round(r.x), Math.round(r.y), 1, 1);
      ctx.fillStyle = '#c98a3a';
      ctx.fillRect(Math.round(r.x), Math.round(r.y) + 1, 1, 2);
      if (Math.floor(time * 20) % 2 === 0) ctx.fillRect(Math.round(r.x) + (Math.floor(time * 10) % 2 ? 1 : -1), Math.round(r.y) + 3, 1, 1);
    }
    for (const s of sparks) {
      const k = s.life / s.max;
      if (k > 0.7 && Math.floor(time * 16 + s.x) % 2 === 0) continue;
      const level = Math.min(3, Math.floor(k * 4));
      ctx.fillStyle = s.ramp[Math.min(3, level + 1)];
      ctx.fillRect(Math.round(s.px), Math.round(s.py), 1, 1);
      ctx.fillStyle = s.ramp[level];
      ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
    }
  }

  // 空の絵を 1 行ずつ上下逆さに写し、行ごとに横へずらして水面の揺れを作る。
  function drawWater(ctx, w, hgt) {
    ctx.fillStyle = WATER;
    ctx.fillRect(0, horizon, w, hgt - horizon);
    if (p.reflect) {
      for (let y = horizon; y < hgt; y += 1) {
        const depth = y - horizon;
        const source = horizon - 1 - Math.floor(depth * 1.5);
        if (source < 0) break;
        const shift = Math.round(Math.sin(y * 1.3 + time * 2.6) * (0.6 + depth * 0.09));
        ctx.drawImage(view.canvas, 0, source, w, 1, shift, y, w, 1);
      }
      ctx.fillStyle = 'rgba(6,10,28,0.36)';
      ctx.fillRect(0, horizon, w, hgt - horizon);
    }
    ctx.fillStyle = WATER;
    for (let y = horizon + 1; y < hgt; y += 1) {
      if (hash(y * 7.3 + Math.floor(time * 3)) < 0.3) ctx.fillRect(Math.floor(hash(y + Math.floor(time * 2)) * w), y, Math.floor(w * 0.3), 1);
    }
    ctx.fillStyle = '#2a3670';
    ctx.fillRect(0, horizon, w, 1);
  }

  function draw() {
    const { ctx, w, h: hgt } = view;
    drawSky(ctx, w);
    drawFire(ctx);
    if (p.skyline) drawSkyline(ctx, w);
    drawWater(ctx, w, hgt);
  }

  const view = createPixelView(root, disposer, BASE_W, BASE_H, (v) => {
    horizon = Math.round(v.h * 0.72);
    if (reduced) {
      // 動きを止める設定のときは、開いた花火を 3 つ置いた 1 枚を見せる。
      sparks = [];
      [[0.25, 0.4], [0.55, 0.25], [0.8, 0.45]].forEach(([fx, fy], i) => explode(v.w * fx, horizon * fy, i));
      for (let i = 0; i < 12; i += 1) update(0.03);
      draw();
    }
  });
  view.fit();

  const destroyBase = () => {
    destroyed = true;
    utils.remove(state);
    disposer.run();
    removeRoot(root);
  };
  if (reduced) return { launch, destroy: destroyBase };

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
  // 始まりに 3 発を続けて上げる。
  [150, 420, 700].forEach((ms) => disposer.timeout(() => launch(), ms));
  disposer.listen(root, 'pointerdown', (event) => {
    const { px, py } = localPointer(event, root);
    launch(px, py);
  });

  return {
    launch,
    destroy() {
      timer.pause();
      destroyBase();
    },
  };
}
