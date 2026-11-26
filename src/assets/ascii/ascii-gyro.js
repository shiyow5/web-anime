import { animate, createTimer, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'ascii-gyro',
  title: '文字のジャイロ',
  category: 'ascii',
  libs: ['animejs'],
  description:
    '入れ子になった 3 本の輪が、それぞれ別の軸で回り、中心で球が自転します。すべて小さな文字の濃淡で描き、手前ほど濃い文字、奥ほど薄い文字に置き換え、輪ごとに色を分けています。ポインターで全体が傾き、クリックすると、3 本の輪が外側から順に中心へ縮み、球がふくらみます。そこから一気に回りだして、輪が内側から順に弾けるように元の大きさへ広がり、揺れながら元の速さに戻ります。計器や技術の話題の見出しに使えます。',
  params: {
    outer: { type: 'color', label: '外の輪の色', default: '#7fe3d4' },
    middle: { type: 'color', label: '中の輪の色', default: '#f2c879' },
    inner: { type: 'color', label: '内の輪の色', default: '#f08ab0' },
    core: { type: 'color', label: '球の色', default: '#eef3ff' },
    background: { type: 'color', label: '背景色', default: '#0b0f16' },
    speed: { type: 'range', label: '回る速さ', min: 0, max: 3, step: 0.1, default: 1 },
    detail: { type: 'range', label: '文字の細かさ', min: 0.6, max: 1.5, step: 0.1, default: 1 },
  },
};

const RAMP = ' .\'`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
const RAMP_CODES = Array.from(RAMP, (ch) => ch.charCodeAt(0));
const LAST = RAMP_CODES.length - 1;
const BASE = 12;
const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';
const SPACE = 32;
const TAU = Math.PI * 2;
const CAM = 3.6;
// 層の番号。0 は背景と数値、1〜3 は輪、4 は球と軸。
const LAYERS = 5;
const RINGS = [
  { radius: 0.93, tube: 0.05 },
  { radius: 0.71, tube: 0.046 },
  { radius: 0.5, tube: 0.042 },
];
const CORE_RADIUS = 0.25;

const CSS = `
.ua-agy{position:absolute;inset:0;overflow:hidden;background:var(--ua-bg);cursor:pointer}
.ua-agy__pre,.ua-agy__probe{position:absolute;left:0;top:0;margin:0;padding:0;border:0;background:none;white-space:pre;
  font:${BASE}px/${BASE}px ${MONO};letter-spacing:0;font-variant-ligatures:none}
.ua-agy__pre{transform-origin:0 0;pointer-events:none;user-select:none}
.ua-agy__pre--0{color:var(--ua-dim)}
.ua-agy__pre--1{color:var(--ua-c1)}
.ua-agy__pre--2{color:var(--ua-c2)}
.ua-agy__pre--3{color:var(--ua-c3)}
.ua-agy__pre--4{color:var(--ua-c4)}
.ua-agy__probe{visibility:hidden}
`;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 3×3 の回転行列（行優先の配列）。
const rotX = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const rotY = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rotZ = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];

// ジャイロの入れ子の向きを求める。外の輪は X 軸、中の輪は外の輪に付いた Y 軸、
// 内の輪は中の輪に付いた X 軸、球は内の輪に付いた Y 軸で回る。
// angles は [外, 中, 内, 球] の角度（ラジアン）。戻り値は 4 つの 3×3 行列（行優先）。
export function gyroFrames(angles, tiltX = 0, tiltY = 0) {
  const [a = 0, b = 0, c = 0, d = 0] = angles;
  const outer = mul(mul(rotX(tiltX), rotY(tiltY)), rotX(a));
  const middle = mul(outer, rotY(b));
  const inner = mul(middle, rotX(c));
  const core = mul(inner, rotY(d));
  return [outer, middle, inner, core];
}

// 文字の升目を用意する。12px で組んでから transform で縮めるので、ブラウザーの最小文字サイズに左右されない。
function createSurface(root, cellPx) {
  const probe = h('span', { class: 'ua-agy__probe', 'aria-hidden': 'true', text: 'M'.repeat(20) });
  const pres = Array.from({ length: LAYERS }, (_, i) => h('pre', { class: `ua-agy__pre ua-agy__pre--${i}`, 'aria-hidden': 'true' }));
  root.append(probe, ...pres);
  const g = { cols: 0, rows: 0, aspect: 0.6, code: null, owner: null, depth: null };
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
    const count = g.cols * g.rows;
    g.code = new Uint16Array(count);
    g.owner = new Uint8Array(count);
    g.depth = new Float32Array(count);
    g.line = new Uint16Array(g.cols);
    const ox = (w - g.cols * cw * scale) / 2;
    const oy = (ht - g.rows * cell) / 2;
    for (const pre of pres) pre.style.transform = `translate(${ox.toFixed(2)}px,${oy.toFixed(2)}px) scale(${scale.toFixed(4)})`;
    return true;
  };
  // 升目ごとの持ち主（層の番号）を見て、層ごとの文字列に分けて書き出す。
  g.flush = () => {
    const { cols, rows, code, owner, line } = g;
    pres.forEach((pre, layer) => {
      const lines = [];
      for (let r = 0; r < rows; r += 1) {
        const from = r * cols;
        for (let c = 0; c < cols; c += 1) line[c] = owner[from + c] === layer ? code[from + c] : SPACE;
        lines.push(String.fromCharCode.apply(null, line));
      }
      pre.textContent = lines.join('\n');
    });
  };
  g.put = (row, col, text) => {
    if (row < 0 || row >= g.rows) return;
    for (let i = 0; i < text.length; i += 1) {
      const c = col + i;
      if (c >= 0 && c < g.cols) {
        g.code[row * g.cols + c] = text.charCodeAt(i);
        g.owner[row * g.cols + c] = 0;
      }
    }
  };
  return g;
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const preview = Boolean(p.preview);
  const reduced = prefersReducedMotion();
  const root = createRoot(container, 'ua-agy', {
    '--ua-bg': p.background,
    '--ua-dim': `color-mix(in srgb, ${p.outer} 38%, ${p.background})`,
    '--ua-c1': p.outer,
    '--ua-c2': p.middle,
    '--ua-c3': p.inner,
    '--ua-c4': p.core,
  });
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', '文字で描いた、3 本の輪が別々の軸で回るジャイロ');
  const disposer = createDisposer();
  const g = createSurface(root, (w) => clamp(w / (preview ? 92 : 132) / p.detail, 3.6, 16));

  const ptr = { x: 0.5, y: 0.5, inside: false };
  const state = { kick: 0 };
  // 登場のとき、輪は 1 本ずつ広がる。
  const grow = RINGS.map(() => ({ v: reduced ? 1 : 0 }));
  const coreGrow = { v: reduced ? 1 : 0 };
  const angles = [0.9, 0.6, 1.9, 0];
  const rates = [0.52, -0.83, 1.27, 1.6];
  let tiltX = 0.32;
  let tiltY = -0.38;
  let time = 0;

  disposer.listen(root, 'pointermove', (event) => {
    const local = localPointer(event, root);
    ptr.x = local.x;
    ptr.y = local.y;
    ptr.inside = true;
  });
  disposer.listen(root, 'pointerleave', () => {
    ptr.inside = false;
  });

  const light = (() => {
    const len = Math.hypot(-0.5, 0.65, -0.58);
    return [-0.5 / len, 0.65 / len, -0.58 / len];
  })();

  function draw(dt) {
    const { cols, rows, aspect, code, owner, depth } = g;
    time += dt;
    const ease = 1 - Math.exp(-dt * 4);
    tiltX += ((ptr.inside ? 0.32 + (ptr.y - 0.5) * 1.1 : 0.32 + Math.sin(time * 0.23) * 0.16) - tiltX) * ease;
    tiltY += ((ptr.inside ? (ptr.x - 0.5) * 1.5 : -0.38 + Math.sin(time * 0.17) * 0.3) - tiltY) * ease;
    const boost = p.speed * (1 + state.kick * 5);
    for (let i = 0; i < 4; i += 1) angles[i] += dt * rates[i] * boost;
    const frames = gyroFrames(angles, tiltX, tiltY);

    code.fill(SPACE);
    owner.fill(0);
    depth.fill(Infinity);

    const unit = Math.min(rows / 2, (cols * aspect) / 2) * 1.1;
    const cx = cols / 2;
    const cy = rows / 2;
    const focal = CAM - 0.4;

    // 背景。等間隔の目印と、中心から薄く広がる点。
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const index = r * cols + c;
        if (c % 14 === 7 && r % 7 === 3) code[index] = 43;
        else {
          const dx = ((c - cx) * aspect) / unit;
          const dy = (r - cy) / unit;
          const noise = (((c * 73856093) ^ (r * 19349663)) >>> 0) % 1000;
          if (noise < 70 * Math.exp(-(dx * dx + dy * dy) * 0.7)) code[index] = 46;
        }
      }
    }

    // 点を 1 つ置く。手前の点だけを残し、明るさと奥行きから文字を選ぶ。
    function plot(m, x, y, z, nx, ny, nz, layer, gain) {
      const wx = m[0] * x + m[1] * y + m[2] * z;
      const wy = m[3] * x + m[4] * y + m[5] * z;
      const wz = m[6] * x + m[7] * y + m[8] * z;
      const k = focal / (CAM + wz);
      const col = Math.round(cx + (wx * k * unit) / aspect - 0.5);
      const row = Math.round(cy - wy * k * unit - 0.5);
      if (col < 0 || col >= cols || row < 0 || row >= rows) return;
      const index = row * cols + col;
      if (wz >= depth[index]) return;
      depth[index] = wz;
      const lx = m[0] * nx + m[1] * ny + m[2] * nz;
      const ly = m[3] * nx + m[4] * ny + m[5] * nz;
      const lz = m[6] * nx + m[7] * ny + m[8] * nz;
      const diffuse = Math.max(0, lx * light[0] + ly * light[1] + lz * light[2]);
      // 奥ほど薄い文字にする。wz は -1（手前）から 1（奥）。
      const near = clamp(0.5 - wz * 0.5, 0, 1);
      const lum = (0.24 + 0.76 * diffuse) * (0.42 + 0.58 * near) * gain;
      code[index] = RAMP_CODES[Math.round(clamp(lum, 0.04, 1) * LAST)];
      owner[index] = layer;
    }

    // 輪。輪は自分の XY 平面にあり、管の断面を一周ぶん打つ。
    RINGS.forEach((ring, i) => {
      const s = grow[i].v;
      if (s <= 0.01) return;
      const m = frames[i];
      const radius = ring.radius * s;
      const around = Math.ceil(radius * unit * 9 / Math.max(0.5, aspect)) + 40;
      const across = 9;
      for (let a = 0; a < around; a += 1) {
        const theta = (a / around) * TAU;
        const ct = Math.cos(theta);
        const st = Math.sin(theta);
        // 輪に刻みを入れて、輪そのものの回転が分かるようにする。
        const notch = a % Math.round(around / 24) === 0 ? 0.55 : 1;
        for (let b = 0; b < across; b += 1) {
          const phi = (b / across) * TAU;
          const cp = Math.cos(phi);
          const sp = Math.sin(phi);
          const q = radius + ring.tube * cp;
          plot(m, q * ct, q * st, ring.tube * sp, cp * ct, cp * st, sp, i + 1, notch);
        }
      }
    });

    // 輪どうしをつなぐ軸。外と中は Y 軸、中と内は X 軸、内と球は Y 軸でつながる。
    const axle = (m, axis, from, to) => {
      const steps = Math.ceil(Math.abs(to - from) * unit * 2.2) + 2;
      for (const side of [-1, 1]) {
        for (let i = 0; i <= steps; i += 1) {
          const d = side * (from + ((to - from) * i) / steps);
          if (axis === 0) plot(m, d, 0, 0, 0, 0.6, -0.8, 4, 0.75);
          else plot(m, 0, d, 0, 0.6, 0, -0.8, 4, 0.75);
        }
      }
    };
    if (grow[1].v > 0.98) axle(frames[0], 1, RINGS[1].radius + RINGS[1].tube, RINGS[0].radius - RINGS[0].tube);
    if (grow[2].v > 0.98) axle(frames[1], 0, RINGS[2].radius + RINGS[2].tube, RINGS[1].radius - RINGS[1].tube);
    if (coreGrow.v > 0.98) axle(frames[2], 1, CORE_RADIUS, RINGS[2].radius - RINGS[2].tube);

    // 球。経線と緯線の帯で濃淡を付けて、自転が見えるようにする。
    const cr = CORE_RADIUS * coreGrow.v;
    if (cr > 0.01) {
      const m = frames[3];
      const latSteps = Math.ceil(cr * unit * 3.4) + 6;
      for (let a = 0; a <= latSteps; a += 1) {
        const lat = (a / latSteps) * Math.PI - Math.PI / 2;
        const cl = Math.cos(lat);
        const sl = Math.sin(lat);
        const lonSteps = Math.ceil((cl * cr * unit * 7) / Math.max(0.5, aspect)) + 4;
        for (let b = 0; b < lonSteps; b += 1) {
          const lon = (b / lonSteps) * TAU;
          const band = (Math.floor((lon / TAU) * 8) + Math.floor((lat / Math.PI + 0.5) * 5)) & 1;
          const nx = cl * Math.cos(lon);
          const nz = cl * Math.sin(lon);
          plot(m, nx * cr, sl * cr, nz * cr, nx, sl, nz, 4, band ? 1 : 0.62);
        }
      }
    }

    const deg = (rad) => String(Math.round((((rad * 180) / Math.PI) % 360 + 360) % 360)).padStart(3, '0');
    g.put(1, 2, 'GYRO  3 GIMBALS');
    g.put(rows - 2, 2, `X ${deg(angles[0])}  Y ${deg(angles[1])}  X' ${deg(angles[2])}`);
    const stamp = `${cols} x ${rows}`;
    g.put(rows - 2, cols - 2 - stamp.length, stamp);
  }

  function tick(dt) {
    if (!g.cols) return;
    draw(dt);
    g.flush();
  }

  // 勢いを付ける。回転が一気に速まり、ゆっくり元の速さへ戻る。
  function kick() {
    if (reduced) return;
    // 準備: 輪が外側から順に縮み、球がふくらむ。山場: 一気に回り、輪が内側から順に弾けて広がる。余韻: 揺れながら戻る。
    utils.remove(grow);
    utils.remove(coreGrow);
    animate(grow, {
      v: [
        { to: 0.55, duration: 240, ease: 'outQuad' },
        { to: 1, duration: 900, ease: 'outBack(0.7)' },
      ],
      delay: stagger(70, { from: 'last' }),
    });
    animate(coreGrow, {
      v: [
        { to: 1.45, duration: 300, ease: 'outQuad' },
        { to: 1, duration: 1100, ease: 'outElastic(1, .5)' },
      ],
    });
    animate(state, {
      kick: [
        { to: 0, duration: 260 },
        { to: 1, duration: 180, ease: 'outQuad' },
        { to: 0, duration: 2400, ease: 'outCubic' },
      ],
    });
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
  if (!reduced) {
    animate(grow, { v: 1, duration: 1300, delay: stagger(220), ease: 'outBack(1.6)' });
    animate(coreGrow, { v: 1, duration: 900, delay: 700, ease: 'outElastic(1, .6)' });
    if (preview) disposer.interval(kick, 5200);
  }
  disposer.listen(root, 'pointerdown', kick);

  const refit = () => {
    if (g.fit() && reduced) tick(0);
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
    kick,
    destroy() {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      timer?.pause();
      utils.remove(state);
      utils.remove(grow);
      utils.remove(coreGrow);
      disposer.run();
      removeRoot(root);
    },
  };
}
