import { animate, createTimer, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'ocean-waves',
  title: '打ち寄せる波',
  category: 'nature',
  libs: ['animejs'],
  description:
    '水平線から手前へ、何層もの波が重なって寄せてきます。波頭は白く光り、太陽や月の光が海面にちらつきます。ポインターを動かすと層がずれて奥行きが見え、クリックすると大きなうねりが奥から手前へ伝わります。時刻は朝・昼・夕・夜から選べます。',
  params: {
    time: {
      type: 'select',
      label: '時刻',
      options: [
        { value: 'morning', label: '朝' },
        { value: 'noon', label: '昼' },
        { value: 'sunset', label: '夕' },
        { value: 'night', label: '夜' },
      ],
      default: 'sunset',
    },
    layers: { type: 'range', label: '波の層の数', min: 4, max: 10, step: 1, default: 7 },
    height: { type: 'range', label: '波の高さ', min: 0.3, max: 2, step: 0.1, default: 1 },
    speed: { type: 'range', label: '速さ', min: 0.2, max: 3, step: 0.1, default: 1 },
    foam: { type: 'range', label: '波頭の白さ', min: 0, max: 1, step: 0.05, default: 0.7 },
  },
};

const PALETTES = {
  morning: { top: '#6fa9dd', bottom: '#ffd8c0', sun: '#fff3d6', glow: '#ffc39a', elevation: 0.3, far: '#8cc4cf', near: '#17567a', foam: '#ffffff', stars: 0 },
  noon: { top: '#2386dc', bottom: '#c4e8ff', sun: '#ffffff', glow: '#fff6c9', elevation: 0.82, far: '#4fb4dc', near: '#0a4a86', foam: '#ffffff', stars: 0 },
  sunset: { top: '#3a2a6e', bottom: '#ff9860', sun: '#ffe490', glow: '#ff7a4d', elevation: 0.14, far: '#e58462', near: '#281d55', foam: '#ffeadb', stars: 0 },
  night: { top: '#040a22', bottom: '#1c2d60', sun: '#e9f1ff', glow: '#7f9cff', elevation: 0.62, far: '#2a457f', near: '#050b22', foam: '#c3d6ff', stars: 1 },
};

const CSS = `
.ua-ow{position:absolute;inset:0;overflow:hidden;background:#0a1030}
.ua-ow__c{position:absolute;inset:0;width:100%;height:100%;display:block}
`;

const HORIZON = 0.42;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const from = rgb(a);
  const to = rgb(b);
  return `rgb(${from.map((v, i) => Math.round(v + (to[i] - v) * t)).join(',')})`;
};
const rgba = (hex, alpha) => `rgba(${rgb(hex).join(',')},${alpha})`;
const hash = (n) => {
  const v = Math.sin(n * 127.1) * 43758.5453;
  return v - Math.floor(v);
};

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-ow');
  const canvas = h('canvas', { class: 'ua-ow__c', 'aria-hidden': 'true' });
  root.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const pal = PALETTES[p.time];
  const count = Math.round(p.preview ? Math.min(p.layers, 6) : p.layers);

  // 奥（0）から手前（1）へ。色と大きさと速さを奥行きで変える。
  const layers = Array.from({ length: count }, (_, i) => {
    const depth = count === 1 ? 1 : i / (count - 1);
    const color = mix(pal.far, pal.near, Math.pow(depth, 0.8));
    return {
      depth,
      color,
      light: mix(pal.far, pal.foam, 0.25 + 0.15 * (1 - depth)),
      direction: i % 2 === 0 ? 1 : -1,
      phase: hash(i + 1) * 900,
      rise: reduced ? 0 : 1,
      swell: 0,
    };
  });
  const stars = Array.from({ length: 70 }, (_, i) => ({ x: hash(i * 3 + 1), y: hash(i * 3 + 2), r: 0.5 + hash(i * 3 + 3) * 1.1 }));
  const clouds = Array.from({ length: 5 }, (_, i) => ({ x: hash(i + 40), y: 0.35 + hash(i + 50) * 0.5, w: 0.12 + hash(i + 60) * 0.2 }));
  const state = { sun: reduced ? 0 : 1, pointer: 0, pointerTarget: 0 };
  let width = 1;
  let height = 1;

  function drawSky(t) {
    const horizon = height * HORIZON;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, pal.top);
    sky.addColorStop(1, pal.bottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, horizon + 2);

    for (const star of stars) {
      if (!pal.stars) break;
      ctx.globalAlpha = (0.35 + 0.65 * Math.abs(Math.sin(t * (0.6 + star.r) + star.x * 40))) * (1 - star.y * 0.6);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(star.x * width, star.y * horizon * 0.92, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 太陽（夜は月）。登場のときは水平線の下から上がる。
    const sunX = width * 0.62;
    const sunY = horizon - pal.elevation * horizon * 0.85 + state.sun * horizon * 0.5;
    const radius = Math.min(width, height) * 0.055;
    const glow = ctx.createRadialGradient(sunX, sunY, radius * 0.4, sunX, sunY, radius * 7);
    glow.addColorStop(0, rgba(pal.glow, 0.75));
    glow.addColorStop(0.35, rgba(pal.glow, 0.22));
    glow.addColorStop(1, rgba(pal.glow, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, horizon + 2);
    ctx.fillStyle = pal.sun;
    ctx.beginPath();
    ctx.arc(sunX, sunY, radius, 0, Math.PI * 2);
    ctx.fill();

    // 水平線の近くにたなびく薄い雲。
    ctx.fillStyle = rgba(pal.foam, pal.stars ? 0.1 : 0.32);
    for (const cloud of clouds) {
      const w = cloud.w * width;
      const x = ((cloud.x * (width + w) + t * 4 * (0.5 + cloud.w * 2)) % (width + w)) - w;
      const y = cloud.y * horizon;
      const r = Math.max(2, height * 0.008);
      ctx.beginPath();
      ctx.roundRect(x, y, w, r * 2, r);
      ctx.roundRect(x + w * 0.2, y - r * 1.6, w * 0.5, r * 2, r);
      ctx.fill();
    }
    return { sunX, horizon };
  }

  function drawLayer(layer, index, t, sunX, horizon) {
    const { depth } = layer;
    const scale = Math.max(0.55, Math.min(width / 900, 1.4));
    const sea = height - horizon;
    const amp = (2.5 + 26 * depth * depth) * p.height * Math.max(0.5, height / 520);
    const length = (46 + 300 * depth) * scale;
    const offset = layer.phase + layer.direction * t * (10 + 54 * depth) + state.pointer * 46 * depth;
    const base =
      horizon + sea * Math.pow(depth, 1.4) * 0.86 + 3 + Math.sin(t * 0.55 + index * 0.9) * amp * 0.28 - layer.swell * amp * 1.5 + layer.rise * (sea + 40);
    const step = p.preview ? 6 : 7;
    const points = [];
    for (let x = -step; x <= width + step; x += step) {
      const a = ((x + offset) / length) * Math.PI * 2;
      // とがった波頭になるように、正弦波を持ち上げてべき乗する。
      const crest = Math.pow(0.5 + 0.5 * Math.sin(a), 2.1);
      const y = base - amp * (crest * 1.5 - 0.4 + 0.25 * Math.sin(a * 0.37 + index));
      points.push({ x, y, crest, key: Math.round((x + offset) / step) });
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points) ctx.lineTo(point.x, point.y);
    ctx.lineTo(width + step, height + 2);
    ctx.lineTo(-step, height + 2);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, base - amp * 1.2, 0, base + amp * 2.5 + 14);
    fill.addColorStop(0, layer.light);
    fill.addColorStop(1, layer.color);
    ctx.fillStyle = fill;
    ctx.fill();

    // 波の背に沿う細い明るい線。
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(pal.foam, 0.2 + 0.25 * p.foam);
    ctx.lineWidth = 0.8 + depth * 1.1;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points) ctx.lineTo(point.x, point.y);
    ctx.stroke();

    if (p.foam > 0) {
      // 波頭の白い帯。高くなったところだけ太く塗る。
      ctx.strokeStyle = rgba(pal.foam, 0.55 + 0.4 * p.foam);
      ctx.lineWidth = (1.2 + depth * 5.5) * (0.5 + p.foam * 0.6);
      ctx.beginPath();
      let open = false;
      for (const point of points) {
        if (point.crest > 0.62) {
          if (open) ctx.lineTo(point.x, point.y + ctx.lineWidth * 0.35);
          else ctx.moveTo(point.x, point.y + ctx.lineWidth * 0.35);
          open = true;
        } else open = false;
      }
      ctx.stroke();
      // 波頭から散るしぶき。
      ctx.fillStyle = rgba(pal.foam, 0.75 * p.foam);
      for (const point of points) {
        if (point.crest < 0.88 || depth < 0.35) continue;
        const r = hash(point.key * 0.37 + index);
        if (r < 0.45) continue;
        ctx.beginPath();
        ctx.arc(point.x + (r - 0.7) * 14, point.y - 2 - r * 12 * depth, 0.6 + r * 1.8 * depth, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 太陽や月の光が海面でちらつく。
    ctx.strokeStyle = rgba(pal.sun, 1);
    for (let j = 0; j < 5; j += 1) {
      const flicker = 0.5 + 0.5 * Math.sin(t * 3.1 + index * 2.3 + j * 1.7);
      const gx = sunX + Math.sin(index * 12.9 + j * 78.2) * (10 + 70 * depth) * scale;
      const gy = base + amp * 0.4 + 5 + j * (2 + 5 * depth);
      const len = (4 + 20 * depth) * (0.4 + flicker);
      ctx.globalAlpha = flicker * (0.55 - depth * 0.25);
      ctx.lineWidth = 1 + depth * 1.4;
      ctx.beginPath();
      ctx.moveTo(gx - len, gy);
      ctx.lineTo(gx + len, gy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function draw(t) {
    ctx.clearRect(0, 0, width, height);
    const { sunX, horizon } = drawSky(t);
    ctx.fillStyle = pal.far;
    ctx.fillRect(0, horizon, width, height - horizon);
    // 水平線のかすみ。
    const haze = ctx.createLinearGradient(0, horizon - 10, 0, horizon + 22);
    haze.addColorStop(0, rgba(pal.bottom, 0));
    haze.addColorStop(0.45, rgba(pal.bottom, 0.7));
    haze.addColorStop(1, rgba(pal.bottom, 0));
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizon - 10, width, 32);
    layers.forEach((layer, index) => drawLayer(layer, index, t, sunX, horizon));
    const shade = ctx.createLinearGradient(0, height * 0.7, 0, height);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,10,0.3)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, height * 0.7, width, height * 0.3);
  }

  const started = performance.now();
  const now = () => (reduced ? 6 : 6 + ((performance.now() - started) / 1000) * p.speed);

  function resize() {
    const rect = root.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, p.preview ? 1 : 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(now());
  }
  const observer = new ResizeObserver(resize);
  observer.observe(root);
  disposer.add(() => observer.disconnect());
  resize();

  // クリックで、うねりが奥から手前へ順に伝わる。
  function swell() {
    if (reduced) return;
    animate(layers, {
      swell: [
        { to: 1, duration: 420, ease: 'outQuad' },
        { to: 0, duration: 1300, ease: 'inOutSine' },
      ],
      delay: stagger(110),
    });
  }

  if (!reduced) {
    // 登場: 太陽が上がり、波が奥から順にせり上がる。
    animate(layers, { rise: 0, duration: 1300, delay: stagger(90, { start: 100 }), ease: 'outExpo' });
    animate(state, { sun: 0, duration: 1800, ease: 'outCubic' });
    const timer = createTimer({
      onUpdate() {
        state.pointer += (state.pointerTarget - state.pointer) * 0.06;
        draw(now());
      },
    });
    disposer.add(() => timer.pause());
    disposer.listen(root, 'pointermove', (event) => {
      state.pointerTarget = localPointer(event, root).x * 2 - 1;
    });
    disposer.listen(root, 'pointerleave', () => {
      state.pointerTarget = 0;
    });
    disposer.listen(root, 'pointerdown', swell);
    if (p.preview) disposer.interval(swell, 5200);
  }

  return {
    swell,
    destroy() {
      disposer.run();
      utils.remove(layers);
      utils.remove(state);
      removeRoot(root);
    },
  };
}
