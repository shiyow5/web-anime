import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'ascii-rain',
  title: '静かな雨',
  category: 'ascii',
  libs: ['animejs'],
  description:
    '細い線の雨が降り、地面に落ちた場所で文字の輪が広がって消えます。遠くの雨は淡く短く、手前の雨は濃く長く描いて奥行きを出しています。ポインターを左右に動かすと風向きが変わり、クリックした場所には大きな波紋が立ちます。落ち着いた背景に使えます。',
  params: {
    color: { type: 'color', label: '雨の色', default: '#8fa6cf' },
    accent: { type: 'color', label: '波紋の色', default: '#dcecff' },
    background: { type: 'color', label: '背景色', default: '#0a0e19' },
    density: { type: 'range', label: '雨の量', min: 0.2, max: 2.5, step: 0.1, default: 1 },
    speed: { type: 'range', label: '落ちる速さ', min: 0.2, max: 2.5, step: 0.1, default: 1 },
    wind: { type: 'range', label: '風の強さ', min: -1, max: 1, step: 0.05, default: 0.15 },
    detail: { type: 'range', label: '文字の細かさ', min: 0.6, max: 1.6, step: 0.1, default: 1 },
  },
};

const BASE = 12;
const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';
const SPACE = 32;
const code = (ch) => ch.charCodeAt(0);
const DOT = code('.');
const COLON = code(':');
const TICK = code("'");
const BAR = code('|');
const SLASH = code('/');
const BACK = code('\\');
const DASH = code('-');
const TILDE = code('~');
const OPEN = code('(');
const CLOSE = code(')');
const UNDER = code('_');
const MAX_RIPPLES = 90;

const CSS = `
.ua-arn{position:absolute;inset:0;overflow:hidden;background:var(--ua-bg);cursor:crosshair}
.ua-arn__pre,.ua-arn__probe{position:absolute;left:0;top:0;margin:0;padding:0;border:0;background:none;white-space:pre;
  font:${BASE}px/${BASE}px ${MONO};letter-spacing:0;font-variant-ligatures:none}
.ua-arn__pre{transform-origin:0 0;pointer-events:none;user-select:none;color:var(--ua-fg)}
.ua-arn__pre--1{color:var(--ua-accent)}
.ua-arn__probe{visibility:hidden}
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

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const preview = Boolean(p.preview);
  const reduced = prefersReducedMotion();
  const root = createRoot(container, 'ua-arn', { '--ua-bg': p.background, '--ua-fg': p.color, '--ua-accent': p.accent });
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', '文字で描いた雨と、地面に広がる波紋');
  const disposer = createDisposer();
  const g = createSurface(root, 'ua-arn', 2, (w) => clamp(w / (preview ? 64 : 105) / p.detail, 4.5, 16));

  const ptr = { x: 0.5, inside: false };
  const intro = { v: reduced ? 1 : 0 };
  let wind = p.wind;
  let drops = [];
  let ground = new Uint16Array(0);
  let horizon = 0;
  const ripples = [];

  // 地面の行。奥（地平線）から手前（下端）へ、depth が 0 から 1 に進む。
  const landingRow = (depth) => horizon + 1 + Math.floor(depth ** 1.6 * (g.rows - horizon - 2));

  function resetDrop(drop, scatter) {
    drop.depth = 0.08 + Math.random() * 0.92;
    drop.land = landingRow(drop.depth);
    drop.landX = Math.random() * (g.cols + 30) - 15;
    drop.length = 2 + drop.depth * 6;
    drop.speed = g.rows * (0.55 + 0.75 * drop.depth);
    drop.y = scatter ? Math.random() * drop.land : -drop.length - Math.random() * g.rows * 0.4;
    return drop;
  }

  function addRipple(x, row, depth, power) {
    if (ripples.length >= MAX_RIPPLES) ripples.shift();
    ripples.push({ x, row, depth, age: 0, life: (0.9 + depth * 0.9) * power, power });
  }

  function layout() {
    horizon = Math.floor(g.rows * 0.56);
    const count = Math.round(((g.cols * g.rows) / (preview ? 46 : 38)) * p.density);
    drops = Array.from({ length: count }, () => resetDrop({}, true));
    ripples.length = 0;
    // 地面の下地。奥ほど点を詰め、地平線には途切れた線を引く。
    ground = new Uint16Array(g.cols * g.rows).fill(SPACE);
    for (let r = horizon; r < g.rows; r += 1) {
      const depth = (r - horizon) / Math.max(1, g.rows - 1 - horizon);
      for (let c = 0; c < g.cols; c += 1) {
        const noise = (((c * 73856093) ^ (r * 19349663)) >>> 0) % 1000;
        if (r === horizon) ground[r * g.cols + c] = noise < 620 ? UNDER : noise < 760 ? DOT : SPACE;
        else if (noise < 70 - depth * 48) ground[r * g.cols + c] = noise % 5 === 0 ? TICK : DOT;
      }
    }
  }

  function plot(layer, col, row, value) {
    const c = Math.round(col);
    if (c < 0 || c >= g.cols || row < 0 || row >= g.rows) return;
    g.layers[layer][row * g.cols + c] = value;
  }

  function draw(dt) {
    const { cols, rows, aspect } = g;
    const [rain, rings] = g.layers;
    rain.set(ground);
    rings.fill(SPACE);
    const step = dt * p.speed;
    const target = ptr.inside ? clamp((ptr.x - 0.5) * 2.4, -1, 1) : p.wind;
    wind += (target - wind) * (1 - Math.exp(-dt * 2));
    const slant = wind * 1.1; // 1 行落ちるあいだに横へ進む桁数
    const body = Math.abs(slant) < 0.28 ? BAR : slant > 0 ? BACK : SLASH;
    const active = Math.floor(drops.length * intro.v);

    for (let i = 0; i < active; i += 1) {
      const drop = drops[i];
      drop.y += drop.speed * step;
      if (drop.y >= drop.land) {
        if (i % 5 < 3) addRipple(drop.landX, drop.land, drop.depth, 1);
        resetDrop(drop, false);
        continue;
      }
      const head = Math.floor(drop.y);
      const far = drop.depth < 0.4;
      for (let k = 0; k < drop.length; k += 1) {
        const row = head - k;
        if (row < 0) break;
        if (row >= rows) continue;
        const col = drop.landX - (drop.land - row) * slant;
        const fade = k / drop.length;
        const value = far ? (fade < 0.5 ? COLON : DOT) : fade < 0.55 ? body : fade < 0.8 ? COLON : DOT;
        plot(0, col, row, value);
      }
    }

    // 波紋。横長の輪が広がりながら薄れる。内側にもう 1 本、遅れて細い輪を出す。
    for (let i = ripples.length - 1; i >= 0; i -= 1) {
      const ripple = ripples[i];
      ripple.age += step;
      const life = ripple.age / ripple.life;
      if (life >= 1) {
        ripples.splice(i, 1);
        continue;
      }
      const size = (2.5 + 11 * ripple.depth) * ripple.power * (cols / 170 + 0.45);
      if (ripple.age < 0.14) {
        plot(1, ripple.x - 1, ripple.row - 1, TICK);
        plot(1, ripple.x + 1, ripple.row - 1, TICK);
        plot(1, ripple.x, ripple.row - 1, DOT);
      }
      for (let ring = 0; ring < 2; ring += 1) {
        const grow = life - ring * 0.22;
        if (grow <= 0) continue;
        const rx = size * Math.sqrt(grow);
        const ry = rx * aspect * (0.22 + 0.3 * ripple.depth);
        const strength = (1 - life) * (ring ? 0.6 : 1);
        const steps = Math.max(10, Math.ceil(rx * 5));
        for (let s = 0; s < steps; s += 1) {
          const angle = (s / steps) * Math.PI * 2;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const row = Math.round(ripple.row + sin * ry);
          if (row <= horizon) continue;
          let value = DOT;
          if (strength > 0.3) {
            if (ry >= 0.8 && Math.abs(cos) > 0.82) value = cos > 0 ? CLOSE : OPEN;
            else value = strength > 0.62 ? DASH : TILDE;
          }
          plot(1, ripple.x + cos * rx, row, value);
        }
      }
    }
    // 波紋の文字がある升目は、下の層を空けて色が混ざらないようにする。
    for (let i = horizon * cols; i < rings.length; i += 1) if (rings[i] !== SPACE) rain[i] = SPACE;
  }

  function tick(dt) {
    if (!g.cols) return;
    draw(dt);
    g.flush();
  }

  disposer.listen(root, 'pointermove', (event) => {
    ptr.x = localPointer(event, root).x;
    ptr.inside = true;
  });
  disposer.listen(root, 'pointerleave', () => {
    ptr.inside = false;
  });
  disposer.listen(root, 'pointerdown', (event) => {
    if (!g.cols) return;
    const local = localPointer(event, root);
    const row = clamp(Math.floor(local.y * g.rows), horizon + 2, g.rows - 2);
    const depth = (row - horizon) / Math.max(1, g.rows - horizon);
    addRipple(local.x * g.cols, row, clamp(depth, 0.3, 1), 2.2);
  });

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
  if (!reduced) animate(intro, { v: 1, duration: 1600, ease: 'inOutSine' });

  const refit = () => {
    if (!g.fit()) return;
    layout();
    if (!reduced) return;
    // 動きを止める設定では、波紋が出そろうまで進めた 1 枚を見せる。
    for (let i = 0; i < 45; i += 1) draw(1 / 30);
    g.flush();
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
