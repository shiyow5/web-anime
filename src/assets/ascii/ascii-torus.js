import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'ascii-torus',
  title: '回るドーナツ形',
  category: 'ascii',
  libs: ['animejs'],
  description:
    '小さな文字を敷き詰めて、回り続けるドーナツ形を描きます。光の当たり方を 70 段階の文字の濃さに置き換え、強い照り返しだけ別の色で重ねています。ポインターを中心から離すと、その向きに回転が速まります。見出しの背景や読み込み中の画面に使えます。',
  params: {
    color: { type: 'color', label: '文字の色', default: '#f1c98a' },
    accent: { type: 'color', label: '照り返しの色', default: '#fff7e0' },
    background: { type: 'color', label: '背景色', default: '#17110d' },
    speed: { type: 'range', label: '回る速さ', min: 0, max: 3, step: 0.1, default: 1 },
    thickness: { type: 'range', label: '輪の太さ', min: 0.16, max: 0.36, step: 0.01, default: 0.28 },
    detail: { type: 'range', label: '文字の細かさ', min: 0.6, max: 1.6, step: 0.1, default: 1 },
  },
};

const RAMP = ' .\'`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
const RAMP_CODES = Array.from(RAMP, (ch) => ch.charCodeAt(0));
const LAST = RAMP_CODES.length - 1;
const BASE = 12;
const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';
const SPACE = 32;

const CSS = `
.ua-atr{position:absolute;inset:0;overflow:hidden;background:var(--ua-bg)}
.ua-atr__pre,.ua-atr__probe{position:absolute;left:0;top:0;margin:0;padding:0;border:0;background:none;white-space:pre;
  font:${BASE}px/${BASE}px ${MONO};letter-spacing:0;font-variant-ligatures:none}
.ua-atr__pre{transform-origin:0 0;pointer-events:none;user-select:none;color:var(--ua-fg)}
.ua-atr__pre--1{color:var(--ua-accent)}
.ua-atr__probe{visibility:hidden}
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
  g.put = (layer, row, col, text) => {
    if (row < 0 || row >= g.rows) return;
    for (let i = 0; i < text.length; i += 1) {
      const c = col + i;
      if (c >= 0 && c < g.cols) g.layers[layer][row * g.cols + c] = text.charCodeAt(i);
    }
  };
  return g;
}

const FOCAL = 3.7;
const CAM = 4;
const BOUND = 0.93;

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const preview = Boolean(p.preview);
  const reduced = prefersReducedMotion();
  const root = createRoot(container, 'ua-atr', { '--ua-bg': p.background, '--ua-fg': p.color, '--ua-accent': p.accent });
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', '文字で描いた、回るドーナツ形');
  const disposer = createDisposer();
  const g = createSurface(root, 'ua-atr', 2, (w) => clamp(w / (preview ? 64 : 105) / p.detail, 4.5, 16));

  const tubeR = p.thickness;
  const ringR = 0.9 - tubeR;
  const ptr = { x: 0.5, y: 0.5, inside: false };
  const intro = { v: reduced ? 1 : 0 };
  let angleA = 1.0;
  let angleB = 0.5;
  let pushX = 0;
  let pushY = 0;
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

  function draw(dt) {
    const { cols, rows, aspect } = g;
    const [shade, glint] = g.layers;
    time += dt;
    const targetX = ptr.inside ? (ptr.x - 0.5) * 2 : 0;
    const targetY = ptr.inside ? (ptr.y - 0.5) * 2 : 0;
    const ease = 1 - Math.exp(-dt * 4);
    pushX += (targetX - pushX) * ease;
    pushY += (targetY - pushY) * ease;
    angleA += dt * p.speed * (0.55 + pushY * 2.6);
    angleB += dt * p.speed * (0.85 + pushX * 2.6);

    // 視点側の座標から、ドーナツ形に固定した座標へ移す回転（X 軸まわりのあと Z 軸まわり）。
    const ca = Math.cos(angleA);
    const sa = Math.sin(angleA);
    const cb = Math.cos(angleB);
    const sb = Math.sin(angleB);
    const m = [cb, -sb * ca, sb * sa, sb, cb * ca, -cb * sa, 0, sa, ca];
    const rot = (x, y, z) => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
    const [ox, oy, oz] = rot(0, 0, -CAM);
    const lightLen = Math.hypot(-0.55, 0.7, -0.6);
    const [lx, ly, lz] = rot(-0.55 / lightLen, 0.7 / lightLen, -0.6 / lightLen);

    const halfW = (cols * aspect) / rows;
    const zoom = Math.min(1, halfW) * 0.97 * (0.35 + 0.65 * intro.v);
    const gain = intro.v;
    const cc = CAM * CAM - BOUND * BOUND;

    for (let r = 0; r < rows; r += 1) {
      const sv = 1 - ((r + 0.5) / rows) * 2;
      for (let c = 0; c < cols; c += 1) {
        const index = r * cols + c;
        const su = (((c + 0.5) / cols) * 2 - 1) * halfW;
        const u = su / zoom;
        const v = sv / zoom;
        const inv = 1 / Math.hypot(u, v, FOCAL);
        const wz = FOCAL * inv;
        let lum = -1;
        let spec = 0;
        const b = -CAM * wz;
        const disc = b * b - cc;
        if (disc > 0) {
          const [dx, dy, dz] = rot(u * inv, v * inv, wz);
          const root2 = Math.sqrt(disc);
          const far = -b + root2;
          let t = -b - root2;
          for (let step = 0; step < 36 && t < far; step += 1) {
            const px = ox + dx * t;
            const py = oy + dy * t;
            const pz = oz + dz * t;
            const ring = Math.hypot(px, pz);
            const q = ring - ringR;
            const dist = Math.hypot(q, py) - tubeR;
            if (dist < 0.004) {
              const k = q / (ring || 1e-6);
              const nx = (px * k) / tubeR;
              const ny = py / tubeR;
              const nz = (pz * k) / tubeR;
              const diffuse = Math.max(0, nx * lx + ny * ly + nz * lz);
              const hx = lx - dx;
              const hy = ly - dy;
              const hz = lz - dz;
              const hl = Math.hypot(hx, hy, hz) || 1;
              spec = Math.max(0, (nx * hx + ny * hy + nz * hz) / hl) ** 34;
              const rim = (1 - Math.abs(nx * dx + ny * dy + nz * dz)) ** 3;
              // 表面に薄い市松の帯を入れて、輪の軸まわりの回転も見えるようにする。
              const band = (Math.floor((Math.atan2(pz, px) / Math.PI) * 10 + 20) + Math.floor((Math.atan2(py, q) / Math.PI) * 4 + 8)) & 1;
              lum = (0.12 + 0.7 * diffuse + 0.1 * rim) * (band ? 1 : 0.84) + 0.6 * spec;
              break;
            }
            t += dist;
          }
        }
        if (lum >= 0) {
          const code = RAMP_CODES[Math.round(clamp(lum * gain, 0.03, 1) * LAST)];
          if (spec > 0.4) {
            glint[index] = code;
            shade[index] = SPACE;
          } else {
            shade[index] = code;
            glint[index] = SPACE;
          }
        } else {
          // 背景。中心ほど濃い点の霧と、等間隔の目印。
          glint[index] = SPACE;
          const halo = 0.16 * Math.exp(-(su * su + sv * sv) * 0.9) * gain;
          const noise = (((c * 73856093) ^ (r * 19349663)) >>> 0) % 1000;
          if (c % 12 === 6 && r % 6 === 3) shade[index] = 43;
          else shade[index] = noise < halo * 1000 ? 46 : SPACE;
        }
      }
    }

    const deg = (rad) => String(Math.round((((rad * 180) / Math.PI) % 360 + 360) % 360)).padStart(3, '0');
    g.put(0, 1, 2, `TORUS  R ${ringR.toFixed(2)}  r ${tubeR.toFixed(2)}`);
    g.put(0, rows - 2, 2, `A ${deg(angleA)}  B ${deg(angleB)}`);
    const stamp = `${cols} x ${rows}`;
    g.put(0, rows - 2, cols - 2 - stamp.length, stamp);
  }

  function tick(dt) {
    if (!g.cols) return;
    draw(dt);
    g.flush();
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
  if (!reduced) animate(intro, { v: 1, duration: 1600, ease: 'outExpo' });

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
