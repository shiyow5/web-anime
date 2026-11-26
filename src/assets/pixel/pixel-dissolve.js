import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'pixel-dissolve',
  title: 'ドット絵の崩れる切り替え',
  category: 'pixel',
  libs: ['animejs'],
  description:
    'いまの絵が四角い塊ごとに光って縮み、崩れ落ちて、下から次の絵が現れます。夕日の海、夜の山、昼の丘の 3 枚を順に切り替えます。クリックするか、戻り値の go() を呼ぶと、好きなときに切り替わります。場面転換やスライドの切り替えに使えます。',
  params: {
    pattern: {
      type: 'select',
      label: '崩れる順番',
      options: [
        { value: 'random', label: 'ばらばら' },
        { value: 'diagonal', label: '斜めに' },
        { value: 'center', label: '中心から' },
        { value: 'rows', label: '上から' },
      ],
      default: 'diagonal',
    },
    block: { type: 'range', label: '塊の大きさ', min: 4, max: 16, step: 2, default: 8 },
    duration: { type: 'range', label: '切り替えの時間（ミリ秒）', min: 600, max: 3000, step: 100, default: 1500 },
    interval: { type: 'range', label: '自動で切り替える間隔（秒）', min: 1.5, max: 8, step: 0.5, default: 3 },
    auto: { type: 'boolean', label: '自動で切り替える', default: true },
  },
};

const CSS = `
.ua-pds{position:absolute;inset:0;overflow:hidden;cursor:pointer;background:#1a1030}
.ua-pds canvas{position:absolute;left:0;top:0;display:block;image-rendering:crisp-edges;image-rendering:pixelated}
`;

const BASE_W = 160;
const BASE_H = 100;
// 崩れ始めから終わりまでの幅。大きいほど、多くの塊が同時に崩れる。
const SPREAD = 0.35;
const SCENE_COUNT = 3;

const hash = (n) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
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

function bands(ctx, w, bottom, colors) {
  const bandHeight = Math.ceil(bottom / colors.length);
  colors.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, i * bandHeight, w, bandHeight);
  });
}

function disc(ctx, cx, cy, radius, color) {
  ctx.fillStyle = color;
  for (let dy = -radius; dy <= radius; dy += 1) {
    const half = Math.round(Math.sqrt(Math.max(0, radius * radius - dy * dy)));
    ctx.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
  }
}

// 夕日の海。
function sceneSea(ctx, w, hgt) {
  const horizon = Math.round(hgt * 0.62);
  bands(ctx, w, horizon, ['#3a1c5c', '#7a2c6e', '#c8456a', '#f27a4e', '#ffb24a', '#ffd86a']);
  const radius = Math.round(hgt * 0.2);
  disc(ctx, Math.round(w / 2), horizon - 2, radius, '#fff2b0');
  ctx.fillStyle = '#ffb24a';
  for (let i = 0; i < 3; i += 1) ctx.fillRect(Math.round(w / 2) - radius, horizon - 5 - i * 5, radius * 2 + 1, 1 + (i === 0 ? 1 : 0));
  ctx.fillStyle = '#1b1f4e';
  ctx.fillRect(0, horizon, w, hgt - horizon);
  for (let y = horizon; y < hgt; y += 1) {
    const reach = Math.round(radius * (0.5 + ((y - horizon) / (hgt - horizon)) * 1.4));
    for (let x = 0; x < w; x += 1) {
      const near = Math.abs(x - w / 2) < reach;
      const n = hash(x * 0.37 + y * 13.1);
      if (near && n < 0.42) ctx.fillStyle = y % 2 ? '#ffb24a' : '#fff2b0';
      else if (n < 0.08) ctx.fillStyle = '#3d4a9a';
      else continue;
      ctx.fillRect(x, y, 2, 1);
    }
  }
  // 帆かけ舟の影絵。
  const boatX = Math.round(w * 0.24);
  ctx.fillStyle = '#12102a';
  ctx.fillRect(boatX, horizon + 3, 12, 2);
  ctx.fillRect(boatX + 2, horizon + 5, 8, 1);
  ctx.fillRect(boatX + 6, horizon - 8, 1, 11);
  for (let i = 0; i < 8; i += 1) ctx.fillRect(boatX + 7, horizon - 7 + i, Math.ceil(i * 0.6), 1);
}

// 夜の山。
function sceneMountain(ctx, w, hgt) {
  bands(ctx, w, hgt, ['#060a22', '#0b1236', '#121d4c', '#1b2b62', '#28407a']);
  for (let i = 0; i < 70; i += 1) {
    ctx.fillStyle = i % 5 === 0 ? '#ffffff' : '#8f9bd8';
    ctx.fillRect(Math.floor(hash(i) * w), Math.floor(hash(i + 40) * hgt * 0.6), 1, 1);
  }
  disc(ctx, Math.round(w * 0.78), Math.round(hgt * 0.22), Math.round(hgt * 0.09), '#f0ecd2');
  ctx.fillStyle = '#c9c4a6';
  ctx.fillRect(Math.round(w * 0.78) - 2, Math.round(hgt * 0.22) - 1, 2, 2);
  ctx.fillRect(Math.round(w * 0.78) + 2, Math.round(hgt * 0.22) + 2, 2, 1);
  const ridge = (x, period, peak, base) => base - Math.abs(((x / period) % 2) - 1) * peak - Math.sin(x * 0.21) * 1.5;
  for (let x = 0; x < w; x += 1) {
    const far = Math.round(ridge(x + 30, w * 0.36, hgt * 0.42, hgt * 0.82));
    ctx.fillStyle = '#2b3a78';
    ctx.fillRect(x, far, 1, hgt - far);
    // 雪をかぶった頂。
    if (far < hgt * 0.52) {
      ctx.fillStyle = '#dfe8ff';
      ctx.fillRect(x, far, 1, Math.max(1, Math.round((hgt * 0.52 - far) * 0.5 + hash(x) * 2)));
    }
  }
  for (let x = 0; x < w; x += 1) {
    const near = Math.round(ridge(x + 90, w * 0.5, hgt * 0.3, hgt * 0.95));
    ctx.fillStyle = '#131b40';
    ctx.fillRect(x, near, 1, hgt - near);
    if (x % 5 === 0) {
      const tree = 3 + Math.floor(hash(x + 5) * 4);
      ctx.fillStyle = '#0a0f28';
      ctx.fillRect(x, near - tree, 1, tree);
      ctx.fillRect(x - 1, near - tree + 2, 3, tree - 2);
    }
  }
}

// 昼の丘。
function sceneHills(ctx, w, hgt) {
  bands(ctx, w, hgt, ['#3f8fe0', '#5aa8ec', '#7cc0f2', '#a4d8f5', '#d0ecf7']);
  disc(ctx, Math.round(w * 0.18), Math.round(hgt * 0.2), Math.round(hgt * 0.08), '#fff6b8');
  [[0.42, 0.18, 9], [0.7, 0.3, 12], [0.9, 0.14, 7]].forEach(([fx, fy, size]) => {
    const x = Math.round(w * fx);
    const y = Math.round(hgt * fy);
    disc(ctx, x, y, Math.round(size / 2), '#ffffff');
    disc(ctx, x + Math.round(size * 0.6), y + 1, Math.round(size / 2.6), '#ffffff');
    disc(ctx, x - Math.round(size * 0.6), y + 2, Math.round(size / 3), '#ffffff');
    ctx.fillStyle = '#d0ecf7';
    ctx.fillRect(x - size, y + Math.round(size / 2) + 1, size * 2, 1);
  });
  for (let x = 0; x < w; x += 1) {
    const far = Math.round(hgt * 0.66 + Math.sin(x * 0.045 + 1) * hgt * 0.07);
    ctx.fillStyle = '#5fb86a';
    ctx.fillRect(x, far, 1, hgt - far);
    const near = Math.round(hgt * 0.8 + Math.sin(x * 0.03 + 4) * hgt * 0.08);
    ctx.fillStyle = '#3d9a52';
    ctx.fillRect(x, near, 1, hgt - near);
    ctx.fillStyle = '#8fdc7a';
    ctx.fillRect(x, near, 1, 1);
    if (hash(x * 2.3) < 0.1) {
      ctx.fillStyle = hash(x) < 0.5 ? '#ffe36a' : '#ff8fb0';
      ctx.fillRect(x, near + 2 + Math.floor(hash(x + 9) * (hgt - near - 3)), 1, 1);
    }
  }
  // 小さな家。
  const houseX = Math.round(w * 0.6);
  const houseY = Math.round(hgt * 0.66 + Math.sin(houseX * 0.045 + 1) * hgt * 0.07) - 7;
  ctx.fillStyle = '#f4ead0';
  ctx.fillRect(houseX, houseY, 10, 8);
  ctx.fillStyle = '#d0503a';
  for (let i = 0; i < 5; i += 1) ctx.fillRect(houseX - 1 + i, houseY - 1 - i, 12 - i * 2, 1);
  ctx.fillStyle = '#6a4a3a';
  ctx.fillRect(houseX + 4, houseY + 4, 2, 4);
  ctx.fillStyle = '#5aa8ec';
  ctx.fillRect(houseX + 7, houseY + 2, 2, 2);
}

const SCENES = [sceneSea, sceneMountain, sceneHills];

function renderScene(index, w, hgt) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  SCENES[index](canvas.getContext('2d'), w, hgt);
  return canvas;
}

// 塊ごとに、崩れ始める順番（0〜1）を決める。
function blockOrder(pattern, col, row, cols, rows) {
  const jitter = hash(col * 17.3 + row * 71.9);
  if (pattern === 'diagonal') return ((col / cols + row / rows) / 2) * 0.88 + jitter * 0.12;
  if (pattern === 'center') return Math.min(1, Math.hypot(col / cols - 0.5, row / rows - 0.5) * 1.3 * 0.9 + jitter * 0.1);
  if (pattern === 'rows') return (row / rows) * 0.85 + jitter * 0.15;
  return jitter;
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-pds');
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const size = Math.round(p.block);
  const state = { progress: 0 };
  let scenes = [];
  let current = 0;
  let next = 0;
  let moving = false;
  let idle = 0;
  let destroyed = false;

  function drawDots(ctx, w, hgt) {
    const left = Math.round(w / 2) - SCENE_COUNT * 3;
    for (let i = 0; i < SCENE_COUNT; i += 1) {
      ctx.fillStyle = '#0a0a18';
      ctx.fillRect(left + i * 6, hgt - 6, 4, 4);
      ctx.fillStyle = i === (moving ? next : current) ? '#ffffff' : '#6a6a8a';
      ctx.fillRect(left + i * 6 + 1, hgt - 5, 2, 2);
    }
  }

  function drawBlocks(ctx, w, hgt) {
    const cols = Math.ceil(w / size);
    const rows = Math.ceil(hgt / size);
    const from = scenes[current];
    // 下の段から描く。上の塊が落ちてきたとき、下の塊の上に重なる。
    for (let row = rows - 1; row >= 0; row -= 1) {
      for (let col = 0; col < cols; col += 1) {
        const order = blockOrder(p.pattern, col, row, cols, rows);
        const local = (state.progress * (1 + SPREAD) - order) / SPREAD;
        if (local >= 1) continue;
        const x = col * size;
        const y = row * size;
        if (local <= 0) {
          ctx.drawImage(from, x, y, size, size, x, y, size, size);
        } else if (local < 0.16) {
          ctx.fillStyle = '#fff8dc';
          ctx.fillRect(x, y, size, size);
        } else {
          const shrunk = Math.max(1, Math.round(size * (1 - local)));
          const inset = Math.floor((size - shrunk) / 2);
          const fall = Math.round(local * local * size * 2.5);
          ctx.drawImage(from, x, y, size, size, x + inset, y + inset + fall, shrunk, shrunk);
        }
      }
    }
  }

  function draw() {
    const { ctx, w, h: hgt } = view;
    if (scenes.length === 0) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scenes[moving ? next : current], 0, 0);
    if (moving) drawBlocks(ctx, w, hgt);
    drawDots(ctx, w, hgt);
  }

  // index を省くと、次の絵へ進む。切り替えの途中に呼ばれたときは何もしない。
  function go(index) {
    if (destroyed || moving) return;
    const target = Number.isInteger(index) ? ((index % SCENE_COUNT) + SCENE_COUNT) % SCENE_COUNT : (current + 1) % SCENE_COUNT;
    if (target === current) return;
    idle = 0;
    if (reduced) {
      current = target;
      draw();
      return;
    }
    next = target;
    moving = true;
    animate(state, {
      progress: [0, 1],
      duration: p.duration,
      ease: 'inOutQuad',
      onComplete() {
        current = next;
        moving = false;
        state.progress = 0;
      },
    });
  }

  const view = createPixelView(root, disposer, BASE_W, BASE_H, (v) => {
    scenes = SCENES.map((_, i) => renderScene(i, v.w, v.h));
    if (reduced) draw();
  });
  view.fit();
  disposer.listen(root, 'pointerdown', () => go());

  const destroyBase = () => {
    destroyed = true;
    utils.remove(state);
    disposer.run();
    removeRoot(root);
  };
  if (reduced) return { go, destroy: destroyBase };

  let last = performance.now();
  const timer = createTimer({
    frameRate: 30,
    onUpdate() {
      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      if (!view.visible) return;
      if (!moving) idle += dt;
      if (p.auto && idle > (p.preview ? Math.min(p.interval, 1.6) : p.interval)) go();
      draw();
    },
  });
  // 最初の切り替えを早めに見せる。
  disposer.timeout(() => go(), 900);

  return {
    go,
    destroy() {
      timer.pause();
      destroyBase();
    },
  };
}
