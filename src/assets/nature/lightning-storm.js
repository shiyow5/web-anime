import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'lightning-storm',
  title: '雷の夜',
  category: 'nature',
  libs: ['animejs'],
  description:
    '雨の降る夜空に、枝分かれする稲妻が走ります。稲妻の形は毎回、手続きで作ります。落ちた瞬間に空が明るくなり、重なった雲と山の輪郭が浮かび上がります。クリックすると、その場所へ雷が落ちます。嵐の場面や、緊張感を出したい画面の背景に使えます。',
  params: {
    frequency: { type: 'range', label: '雷の頻度', min: 0.3, max: 3, step: 0.1, default: 1 },
    rain: { type: 'range', label: '雨の量', min: 0, max: 800, step: 20, default: 360 },
    branches: { type: 'range', label: '枝分かれの多さ', min: 0, max: 1, step: 0.05, default: 0.6 },
    wind: { type: 'range', label: '風の強さ', min: -1, max: 1, step: 0.05, default: 0.35 },
    bolt: { type: 'color', label: '稲妻の色', default: '#eef1ff' },
    glow: { type: 'color', label: '光のにじみの色', default: '#8f6bff' },
  },
};

const CSS = `
.ua-ls{position:absolute;inset:0;overflow:hidden;background:#07061a;cursor:crosshair}
.ua-ls__c{position:absolute;inset:0;width:100%;height:100%;display:block}
`;

// 雲は奥・中・手前の 3 列。dark はふだんの色、lit は稲光に照らされた色。
const CLOUD_ROWS = [
  { y: 0.3, dark: '#2b2459', lit: '#c3b4ff', size: 0.11, drift: 5 },
  { y: 0.21, dark: '#1d1842', lit: '#9482e6', size: 0.14, drift: 9 },
  { y: 0.11, dark: '#120f2c', lit: '#5d4cab', size: 0.17, drift: 14 },
];
const FAR = { dark: '#191541', lit: '#5a4ca6' };
const NEAR = { dark: '#06050f', lit: '#191233' };

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const from = rgb(a);
  const to = rgb(b);
  return `rgb(${from.map((v, i) => Math.round(v + (to[i] - v) * t)).join(',')})`;
};
const rgba = (hex, alpha) => `rgba(${rgb(hex).join(',')},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
const hash = (n) => {
  const v = Math.sin(n * 127.1 + 3.7) * 43758.5453;
  return v - Math.floor(v);
};
const noise1 = (x) => {
  const i = Math.floor(x);
  const f = x - i;
  const t = f * f * (3 - 2 * f);
  return hash(i) + (hash(i + 1) - hash(i)) * t;
};

// 稲妻を折れ線の集まりとして作る。進むたびに横へふらつき、ところどころで枝を出す。
function makeBolt(x0, y0, x1, y1, branchiness, width, depth, lines) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(5, Math.round(dist / 16));
  const nx = -dy / (dist || 1);
  const ny = dx / (dist || 1);
  const points = [{ x: x0, y: y0 }];
  let wander = 0;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    wander = (wander + (Math.random() - 0.5) * dist * 0.085) * 0.88;
    const pull = 1 - Math.pow(t, 4);
    const point = { x: x0 + dx * t + nx * wander * pull, y: y0 + dy * t + ny * wander * pull };
    points.push(point);
    if (depth < 3 && i < steps - 1 && Math.random() < branchiness * (depth === 0 ? 0.22 : 0.12)) {
      const angle = Math.atan2(dy, dx) + (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.6);
      const reach = dist * (1 - t) * (0.3 + Math.random() * 0.4);
      makeBolt(point.x, point.y, point.x + Math.cos(angle) * reach, point.y + Math.sin(angle) * reach, branchiness, width * 0.55, depth + 1, lines);
    }
  }
  lines.push({ points, width });
  return lines;
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-ls');
  const canvas = h('canvas', { class: 'ua-ls__c', 'aria-hidden': 'true' });
  root.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const dropCount = Math.round(p.preview ? Math.min(p.rain, 180) : p.rain);

  let width = 1;
  let height = 1;
  let unit = 1;
  let farLine = [];
  let nearLine = [];
  let bolts = [];
  let strikeTimer = 0;
  let destroyed = false;
  const STEP = 3;
  const state = { reveal: reduced ? 1 : 0 };
  const drops = Array.from({ length: dropCount }, () => ({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7 }));
  const puffs = CLOUD_ROWS.map((row, r) =>
    Array.from({ length: 16 }, (_, i) => ({ x: (i + hash(r * 50 + i) * 0.7) / 16, dy: (hash(r * 90 + i) - 0.5) * 0.07, size: 0.75 + hash(r * 130 + i) * 0.6 })),
  );
  const lamps = Array.from({ length: 12 }, (_, i) => ({ x: hash(i + 300), drop: 0.01 + hash(i + 330) * 0.05, warm: hash(i + 360) > 0.3 }));

  const nearAt = (x) => nearLine[Math.max(0, Math.min(nearLine.length - 1, Math.round(x / STEP)))] ?? height * 0.9;

  function buildTerrain() {
    farLine = [];
    nearLine = [];
    for (let x = 0; x <= width + STEP; x += STEP) {
      const u = x / unit;
      farLine.push(height * (0.74 - 0.17 * (noise1(u * 2.2 + 3) * 0.65 + noise1(u * 6 + 9) * 0.35)));
      let y = height * (0.92 - 0.1 * (noise1(u * 1.6 + 20) * 0.7 + noise1(u * 5 + 31) * 0.3));
      // 手前の稜線には、針葉樹のとがった影を足す。
      const spacing = unit * 0.045;
      const cell = Math.round(x / spacing);
      for (const id of [cell - 1, cell, cell + 1]) {
        if (hash(id * 7.3) < 0.4) continue;
        const tall = unit * (0.03 + hash(id * 3.1) * 0.06);
        const spread = tall * 0.32;
        const center = (id + (hash(id * 5.9) - 0.5) * 0.6) * spacing;
        const inside = 1 - Math.abs(x - center) / spread;
        if (inside > 0) y -= tall * inside;
      }
      nearLine.push(y);
    }
  }

  function strike(x, y) {
    if (destroyed) return;
    const hitX = Number.isFinite(x) ? x : width * (0.15 + Math.random() * 0.7);
    const hitY = Number.isFinite(y) ? y : nearAt(hitX) + 2;
    const fromX = hitX + (Math.random() - 0.5) * width * 0.3;
    const fromY = height * 0.14;
    const bolt = { lines: makeBolt(fromX, fromY, hitX, hitY, p.branches, Math.max(1.4, unit * 0.006), 0, []), alpha: 1, fromX, fromY, hitX, hitY };
    bolts.push(bolt);
    if (reduced) return;
    // 光ってから、何度かまたたいて消える。
    animate(bolt, {
      alpha: [
        { to: 0.4, duration: 80, ease: 'linear' },
        { to: 1, duration: 60, ease: 'linear' },
        { to: 0.75, duration: 220, ease: 'outQuad' },
        { to: 0, duration: 1400, ease: 'inQuad' },
      ],
      onComplete() {
        bolts = bolts.filter((item) => item !== bolt);
      },
    });
  }

  function scheduleStrike(delay) {
    strikeTimer = setTimeout(() => {
      strike();
      scheduleStrike(((1800 + Math.random() * 3600) / p.frequency) * (p.preview ? 0.8 : 1));
    }, delay);
  }

  function fillLine(line, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, height + 2);
    line.forEach((y, i) => ctx.lineTo(i * STEP, y));
    ctx.lineTo(width + STEP, height + 2);
    ctx.closePath();
    ctx.fill();
  }

  function drawClouds(row, index, t, flash) {
    const glowNear = 0.08 + 0.06 * Math.sin(t * 0.7 + index * 2);
    ctx.fillStyle = mix(row.dark, row.lit, Math.min(1, flash * (0.9 - index * 0.12) + glowNear * state.reveal));
    const baseY = height * row.y - (1 - state.reveal) * height * 0.4;
    const span = width + unit * 0.5;
    ctx.beginPath();
    ctx.rect(0, -2, width, Math.max(0, baseY - unit * row.size * 0.4 + 2));
    for (const puff of puffs[index]) {
      const x = ((puff.x * span + t * row.drift) % span) - unit * 0.25;
      const r = unit * row.size * puff.size;
      const y = baseY + puff.dy * height;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  function drawBolt(bolt) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const [scale, color, alpha] of [[9, p.glow, 0.16], [4, p.glow, 0.34], [1, p.bolt, 1]]) {
      ctx.strokeStyle = rgba(color, alpha * bolt.alpha);
      for (const line of bolt.lines) {
        ctx.lineWidth = line.width * scale;
        ctx.beginPath();
        ctx.moveTo(line.points[0].x, line.points[0].y);
        for (const point of line.points) ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }
    }
  }

  function draw(t) {
    const flash = Math.min(1, bolts.reduce((max, bolt) => Math.max(max, bolt.alpha), 0));
    const lead = bolts.reduce((best, bolt) => (!best || bolt.alpha > best.alpha ? bolt : best), null);
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, mix('#07061a', '#3b3078', flash * 0.7));
    sky.addColorStop(1, mix('#241b4c', '#8c7ad6', flash * 0.6));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    // 稲妻の根元を中心に、空が明るくなる。
    if (lead) {
      ctx.globalCompositeOperation = 'lighter';
      const burst = ctx.createRadialGradient(lead.fromX, lead.fromY, 0, lead.fromX, lead.fromY, unit * 1.1);
      burst.addColorStop(0, rgba(p.glow, flash * 0.6));
      burst.addColorStop(1, rgba(p.glow, 0));
      ctx.fillStyle = burst;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';
    }
    drawClouds(CLOUD_ROWS[0], 0, t, flash);
    drawClouds(CLOUD_ROWS[1], 1, t, flash);

    fillLine(farLine, mix(FAR.dark, FAR.lit, flash * 0.8));
    // 遠い山のふもとに、町の小さな灯り。
    for (const lamp of lamps) {
      const x = lamp.x * width;
      const y = (farLine[Math.round(x / STEP)] ?? height * 0.7) + height * (0.03 + lamp.drop);
      ctx.fillStyle = lamp.warm ? `rgba(255,205,120,${0.75 * state.reveal})` : `rgba(190,215,255,${0.6 * state.reveal})`;
      ctx.fillRect(x, y, Math.max(1.2, unit * 0.004), Math.max(1.2, unit * 0.004));
    }

    // 雨。奥行きで 3 段階に分け、近い雨ほど長く、濃く描く。
    const slant = p.wind * 0.4;
    for (let band = 0; band < 3; band += 1) {
      ctx.strokeStyle = `rgba(190,205,255,${((0.12 + band * 0.11) * (1 + flash * 1.4) * state.reveal).toFixed(3)})`;
      ctx.lineWidth = 0.7 + band * 0.45;
      ctx.beginPath();
      for (const drop of drops) {
        if (Math.min(2, Math.floor((drop.z - 0.3) / 0.234)) !== band) continue;
        const len = height * 0.035 * (drop.z + 0.35);
        const x = drop.x * (width + height * Math.abs(slant)) - (slant > 0 ? height * slant : 0) + drop.y * height * slant;
        const y = drop.y * height;
        ctx.moveTo(x, y);
        ctx.lineTo(x + len * slant, y + len);
      }
      ctx.stroke();
    }

    fillLine(nearLine, mix(NEAR.dark, NEAR.lit, flash));
    // 光った瞬間だけ、手前の稜線の縁が浮かぶ。
    if (flash > 0.01) {
      ctx.strokeStyle = rgba(p.glow, flash * 0.85);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      nearLine.forEach((y, i) => (i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * STEP, y)));
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'lighter';
    for (const bolt of bolts) {
      drawBolt(bolt);
      const r = unit * 0.16;
      const hit = ctx.createRadialGradient(bolt.hitX, bolt.hitY, 0, bolt.hitX, bolt.hitY, r);
      hit.addColorStop(0, rgba(p.bolt, bolt.alpha * 0.85));
      hit.addColorStop(0.3, rgba(p.glow, bolt.alpha * 0.4));
      hit.addColorStop(1, rgba(p.glow, 0));
      ctx.fillStyle = hit;
      ctx.fillRect(bolt.hitX - r, bolt.hitY - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    drawClouds(CLOUD_ROWS[2], 2, t, flash);

    const edge = ctx.createRadialGradient(width / 2, height / 2, unit * 0.4, width / 2, height / 2, Math.hypot(width, height) * 0.62);
    edge.addColorStop(0, 'rgba(3,2,12,0)');
    edge.addColorStop(1, 'rgba(3,2,12,0.55)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, width, height);
  }

  const started = performance.now();
  const now = () => (reduced ? 4 : (performance.now() - started) / 1000);

  function resize() {
    const rect = root.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    unit = Math.min(width, height);
    const dpr = Math.min(window.devicePixelRatio || 1, p.preview ? 1 : 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildTerrain();
    if (reduced) {
      // 動きを止めるときは、稲妻が 1 本走った瞬間を見せる。
      bolts = [];
      strike(width * 0.58);
      bolts[0].alpha = 0.85;
    }
    draw(now());
  }
  const observer = new ResizeObserver(resize);
  observer.observe(root);
  disposer.add(() => observer.disconnect());
  resize();

  if (!reduced) {
    // 登場: 雲が上から降りてきて、雨と町の灯りが現れる。
    animate(state, { reveal: 1, duration: 1600, ease: 'outCubic' });
    let last = performance.now();
    const timer = createTimer({
      onUpdate() {
        const current = performance.now();
        const dt = Math.min(0.05, (current - last) / 1000);
        last = current;
        for (const drop of drops) {
          drop.y += dt * (0.9 + drop.z * 1.5);
          if (drop.y > 1) {
            drop.y -= 1;
            drop.x = Math.random();
          }
        }
        draw(now());
      },
    });
    disposer.add(() => timer.pause());
    disposer.listen(root, 'pointerdown', (event) => {
      const at = localPointer(event, root);
      strike(at.px, at.py);
    });
    scheduleStrike(2900);
    disposer.add(() => clearTimeout(strikeTimer));
  }

  return {
    strike,
    destroy() {
      destroyed = true;
      disposer.run();
      utils.remove(state);
      for (const bolt of bolts) utils.remove(bolt);
      removeRoot(root);
    },
  };
}
