import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'pixel-campfire',
  title: 'ドット絵の焚き火',
  category: 'pixel',
  libs: ['animejs'],
  description:
    '夜の森で焚き火が揺れ、火の粉が上がり、地面と木々が炎に合わせて明滅します。クリックすると薪がはぜて、炎が大きくなり火の粉が舞います。待機画面や、落ち着いた場面の背景に使えます。',
  params: {
    tone: {
      type: 'select',
      label: '炎の色',
      options: [
        { value: 'warm', label: '焚き火' },
        { value: 'spirit', label: '青い鬼火' },
        { value: 'witch', label: '緑の魔女火' },
      ],
      default: 'warm',
    },
    size: { type: 'range', label: '炎の大きさ', min: 0.6, max: 1.4, step: 0.05, default: 1 },
    sparks: { type: 'range', label: '火の粉の量', min: 0, max: 60, step: 2, default: 26 },
    flicker: { type: 'range', label: '明滅の強さ', min: 0, max: 1, step: 0.05, default: 0.7 },
    stars: { type: 'boolean', label: '星空を出す', default: true },
    sky: { type: 'color', label: '夜空の色', default: '#0b1030' },
  },
};

const CSS = `
.ua-pcf{position:absolute;inset:0;overflow:hidden;cursor:pointer}
.ua-pcf canvas{position:absolute;left:0;top:0;display:block;image-rendering:crisp-edges;image-rendering:pixelated}
`;

// 暗い色から明るい色へ 6 段階。炎の温度をこの番号に割り当てる。
const TONES = {
  warm: ['#5a1208', '#a82a0c', '#e2551a', '#ff9a2e', '#ffd35a', '#fff6c8'],
  spirit: ['#0d2a5a', '#1650a8', '#2a8ae2', '#4ec4ff', '#9be8ff', '#eafcff'],
  witch: ['#0f3d1c', '#1c7a2c', '#3cb83a', '#8be04a', '#d4f56a', '#f8ffd0'],
};
const GROUND = '#10160f';
const FIRE_W = 30;
const FIRE_H = 36;
const BASE_W = 160;
const BASE_H = 100;
const FIRE_STEP = 1 / 22;

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

// 横 1 画素の帯を積んで、輪郭のくっきりした楕円を描く。
function disc(ctx, cx, cy, rx, ry, color) {
  ctx.fillStyle = color;
  const radiusY = Math.max(1, Math.round(ry));
  for (let dy = -radiusY; dy <= radiusY; dy += 1) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (radiusY * radiusY + 0.5))));
    ctx.fillRect(Math.round(cx) - half, Math.round(cy) + dy, half * 2 + 1, 1);
  }
}

// 段になった針葉樹の影絵。
function pine(ctx, cx, base, height, spread, color) {
  ctx.fillStyle = color;
  const rows = Math.max(3, Math.round(height) - 2);
  const tiers = Math.max(2, Math.round(rows / 6));
  const tierHeight = rows / tiers;
  for (let i = 0; i < rows; i += 1) {
    const tier = Math.floor(i / tierHeight);
    const inTier = i - tier * tierHeight;
    const half = Math.round(spread * (0.4 + tier * tierHeight * 0.18 + inTier * 0.7));
    ctx.fillRect(cx - half, base - rows - 2 + i, half * 2 + 1, 1);
  }
  ctx.fillRect(cx, base - 2, 1, 2);
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-pcf', { background: p.sky });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const tone = TONES[p.tone];
  const skyBands = [0, 0.07, 0.15, 0.26].map((k) => mix(p.sky, '#5a4a9a', k));
  const farTrees = mix(p.sky, '#000000', 0.45);
  const litGround = [0.14, 0.28, 0.46].map((k) => mix(GROUND, tone[2], k));
  const starCount = p.preview ? 26 : 46;
  const heat = new Float32Array(FIRE_W * FIRE_H);
  const state = { glow: 1, boost: 0, intro: reduced ? 1 : 0 };
  const layout = { y0: 72, cx: 80, base: 77 };
  let sparks = [];
  let time = 0;
  let fireClock = 0;
  let sparkDebt = 0;
  let destroyed = false;

  function stepFire() {
    const power = (0.78 + state.boost * 0.5) * state.intro * p.size;
    const center = (FIRE_W - 1) / 2;
    const bottom = (FIRE_H - 1) * FIRE_W;
    for (let x = 0; x < FIRE_W; x += 1) {
      const d = Math.abs(x - center) / (FIRE_W * 0.36);
      heat[bottom + x] = d < 1 ? Math.min(1.2, (1 - d * d) * power * (0.75 + Math.random() * 0.5)) : 0;
    }
    const cooling = 1 / Math.max(0.4, p.size * (1 + state.boost * 0.4));
    for (let y = 0; y < FIRE_H - 1; y += 1) {
      for (let x = 0; x < FIRE_W; x += 1) {
        const from = Math.min(FIRE_W - 1, Math.max(0, x + Math.floor(Math.random() * 3) - 1));
        const d = Math.abs(x - center) / (FIRE_W * 0.5);
        const value = heat[(y + 1) * FIRE_W + from] - Math.random() * (0.07 + d * 0.08) * cooling;
        heat[y * FIRE_W + x] = value > 0 ? value : 0;
      }
    }
  }

  function addSpark(strong) {
    sparks.push({
      x: layout.cx + utils.random(-5, 5, 1),
      y: layout.base - utils.random(6, 14, 1),
      vx: utils.random(-5, 5, 1) * (strong ? 2.4 : 1),
      vy: -utils.random(12, 26, 1) * (strong ? 1.5 : 1),
      life: 0,
      max: utils.random(1.2, 2.8, 2),
      phase: Math.random() * 6.28,
    });
  }

  function update(dt) {
    time += dt;
    fireClock += dt;
    while (fireClock >= FIRE_STEP) {
      fireClock -= FIRE_STEP;
      stepFire();
    }
    sparkDebt += p.sparks * 0.22 * (p.preview ? 0.7 : 1) * state.intro * dt;
    while (sparkDebt >= 1) {
      sparkDebt -= 1;
      addSpark(false);
    }
    sparks = sparks
      .map((s) => ({ ...s, life: s.life + dt, x: s.x + (s.vx + Math.sin(time * 3 + s.phase) * 5) * dt, y: s.y + s.vy * dt }))
      .filter((s) => s.life < s.max && s.y > -2);
  }

  function drawSky(ctx, w) {
    const bandHeight = Math.ceil(layout.y0 / skyBands.length);
    skyBands.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, i * bandHeight, w, bandHeight);
    });
    if (p.stars) {
      for (let i = 0; i < starCount; i += 1) {
        const x = Math.floor(hash(i) * w);
        const y = Math.floor(hash(i + 50) * layout.y0 * 0.82);
        const twinkle = Math.sin(time * (0.8 + hash(i + 9) * 2.2) + hash(i + 3) * 6.28);
        if (twinkle < -0.55) continue;
        ctx.fillStyle = twinkle > 0.45 ? '#f6f2ff' : '#8c8fc4';
        ctx.fillRect(x, y, 1, 1);
        if (i % 9 === 0 && twinkle > 0.85) {
          ctx.fillRect(x - 1, y, 3, 1);
          ctx.fillRect(x, y - 1, 1, 3);
        }
      }
    }
    // 三日月。丸を描いてから、ずらした丸を空の色で重ねる。
    const moonX = Math.round(w * 0.8);
    const moonY = Math.round(layout.y0 * 0.24);
    disc(ctx, moonX, moonY, 5, 5, '#f4f0d8');
    disc(ctx, moonX + 3, moonY - 1, 5, 5, skyBands[0]);
  }

  function drawForest(ctx, w, glow) {
    const count = Math.ceil(w / 6) + 1;
    for (let i = 0; i < count; i += 1) {
      pine(ctx, i * 6 + Math.floor(hash(i + 20) * 3), layout.y0 + 1, 9 + hash(i + 31) * 13, 0.75, farTrees);
    }
    // 火に近い木は、炎の色を少し拾う。
    const nearColor = mix('#0a1410', tone[1], 0.1 + glow * 0.12);
    [0.2, 0.31, 0.68, 0.79].forEach((fx, i) => {
      pine(ctx, Math.round(w * fx), layout.y0 + 2, 26 + hash(i + 70) * 10, 0.95, nearColor);
    });
  }

  function drawGround(ctx, w, hgt, glow) {
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, layout.y0, w, hgt - layout.y0);
    const reach = w * (0.3 + 0.08 * p.size) * glow;
    [1, 0.66, 0.36].forEach((k, i) => {
      disc(ctx, layout.cx, layout.base + 1, reach * k, Math.max(2, reach * k * 0.24), litGround[i]);
    });
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, 0, 0);
  }

  function drawFire(ctx) {
    const left = layout.cx - FIRE_W / 2;
    const top = layout.base - FIRE_H;
    for (let y = 0; y < FIRE_H; y += 1) {
      for (let x = 0; x < FIRE_W; x += 1) {
        const value = heat[y * FIRE_W + x];
        if (value < 0.1) continue;
        ctx.fillStyle = tone[Math.min(5, Math.floor(value * 6))];
        ctx.fillRect(left + x, top + y, 1, 1);
      }
    }
    // 薪と石。炎の手前に置く。
    const { cx, base } = layout;
    ctx.fillStyle = '#2c190d';
    ctx.fillRect(cx - 9, base - 2, 18, 3);
    ctx.fillRect(cx - 6, base - 4, 4, 2);
    ctx.fillRect(cx + 3, base - 4, 4, 2);
    ctx.fillStyle = mix('#6b3e1c', tone[3], 0.35);
    ctx.fillRect(cx - 8, base - 2, 6, 1);
    ctx.fillRect(cx + 4, base - 4, 2, 1);
    ctx.fillStyle = '#4b4c58';
    ctx.fillRect(cx - 13, base - 1, 3, 2);
    ctx.fillRect(cx + 11, base - 1, 3, 2);
    ctx.fillRect(cx - 4, base + 1, 3, 1);
    ctx.fillStyle = '#7d7f90';
    ctx.fillRect(cx - 12, base - 1, 1, 1);
    ctx.fillRect(cx + 11, base - 1, 1, 1);
  }

  function drawSparks(ctx) {
    for (const s of sparks) {
      const k = s.life / s.max;
      if (k > 0.8 && Math.floor(time * 12 + s.phase) % 2 === 0) continue;
      ctx.fillStyle = k < 0.3 ? tone[5] : k < 0.65 ? tone[3] : tone[1];
      ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
    }
  }

  function drawForeground(ctx, w, hgt, glow) {
    const color = mix('#04060b', tone[1], glow * 0.07);
    pine(ctx, Math.round(w * 0.03), hgt + 6, hgt * 0.98, 1.25, color);
    pine(ctx, Math.round(w * 0.97), hgt + 4, hgt * 0.9, 1.25, color);
    pine(ctx, Math.round(w * 0.13), hgt + 3, hgt * 0.5, 1.1, color);
    pine(ctx, Math.round(w * 0.89), hgt + 3, hgt * 0.44, 1.1, color);
    ctx.fillStyle = color;
    for (let x = 0; x < w; x += 1) {
      const tuft = Math.floor(hash(x * 1.7 + 5) * 4);
      ctx.fillRect(x, hgt - 1 - tuft, 1, 1 + tuft);
    }
  }

  function draw() {
    const { ctx, w, h: hgt } = view;
    const glow = 1 + (state.glow - 1) * p.flicker + state.boost * 0.25;
    const lit = glow * state.intro;
    drawSky(ctx, w);
    drawForest(ctx, w, lit);
    drawGround(ctx, w, hgt, lit);
    drawFire(ctx);
    drawSparks(ctx);
    drawForeground(ctx, w, hgt, lit);
  }

  const view = createPixelView(root, disposer, BASE_W, BASE_H, (v) => {
    layout.y0 = Math.round(v.h * 0.72);
    layout.cx = Math.round(v.w / 2);
    layout.base = layout.y0 + 5;
    if (reduced) draw();
  });

  // 明るさを不規則に揺らす。終わるたびに次の値を決めて続ける。
  function flickerOnce() {
    if (destroyed) return;
    animate(state, {
      glow: utils.random(0.78, 1.12, 2),
      duration: utils.random(70, 240),
      ease: 'inOutSine',
      onComplete: flickerOnce,
    });
  }

  function crackle() {
    if (destroyed || reduced) return;
    animate(state, { boost: [1, 0], duration: 1300, ease: 'outQuad' });
    for (let i = 0; i < (p.preview ? 10 : 22); i += 1) addSpark(true);
  }

  if (reduced) {
    for (let i = 0; i < 70; i += 1) stepFire();
    view.fit();
    return {
      crackle,
      destroy() {
        destroyed = true;
        disposer.run();
        removeRoot(root);
      },
    };
  }

  view.fit();
  animate(state, { intro: [0, 1], duration: 1800, ease: 'outQuad' });
  flickerOnce();
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
  disposer.listen(root, 'pointerdown', (event) => {
    localPointer(event, root);
    crackle();
  });
  if (p.preview) disposer.interval(crackle, 4200);

  return {
    crackle,
    destroy() {
      destroyed = true;
      timer.pause();
      utils.remove(state);
      disposer.run();
      removeRoot(root);
    },
  };
}
