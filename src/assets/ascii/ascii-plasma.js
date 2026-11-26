import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'ascii-plasma',
  title: '流れる模様',
  category: 'ascii',
  libs: ['animejs'],
  description:
    'ゆっくりうねる縞と渦を、文字の濃淡だけで描きます。明るい帯は別の色に切り替わり、2 色の模様が混ざり合って流れます。ポインターを置くと、そのまわりで流れが渦のように曲がります。タップすると、その場所に流れがきゅっと絞られてから輪が広がり、輪の通ったあとは文字が記号の集まりに書き換わって 2 色が入れ替わり、少し遅れて追いかける 2 本目の輪が元の文字へ戻していきます。長く眺める背景や、待ち時間の画面に使えます。',
  params: {
    color: { type: 'color', label: '暗い帯の色', default: '#a98bf5' },
    accent: { type: 'color', label: '明るい帯の色', default: '#84f2d2' },
    background: { type: 'color', label: '背景色', default: '#0d0a18' },
    speed: { type: 'range', label: '流れる速さ', min: 0, max: 3, step: 0.1, default: 1 },
    scale: { type: 'range', label: '模様の大きさ', min: 0.5, max: 2, step: 0.1, default: 1 },
    bend: { type: 'range', label: '曲がる強さ', min: 0, max: 2, step: 0.1, default: 1 },
    detail: { type: 'range', label: '文字の細かさ', min: 0.6, max: 1.6, step: 0.1, default: 1 },
  },
};

const RAMP = ' .\'`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
const RAMP_CODES = Array.from(RAMP, (ch) => ch.charCodeAt(0));
const LAST = RAMP_CODES.length - 1;
const BASE = 12;
const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';
const SPACE = 32;
// 書き換えたあとの文字集合。濃淡の順に並べた記号だけを使う。
const ALT_CODES = Array.from(' .:-=+<>/\\|[]{}#%@', (ch) => ch.charCodeAt(0));
const ALT_LAST = ALT_CODES.length - 1;

const CSS = `
.ua-apl{position:absolute;inset:0;overflow:hidden;background:var(--ua-bg)}
.ua-apl__pre,.ua-apl__probe{position:absolute;left:0;top:0;margin:0;padding:0;border:0;background:none;white-space:pre;
  font:${BASE}px/${BASE}px ${MONO};letter-spacing:0;font-variant-ligatures:none}
.ua-apl__pre{transform-origin:0 0;pointer-events:none;user-select:none;color:var(--ua-fg)}
.ua-apl__pre--1{color:var(--ua-accent)}
.ua-apl__probe{visibility:hidden}
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
  const root = createRoot(container, 'ua-apl', { '--ua-bg': p.background, '--ua-fg': p.color, '--ua-accent': p.accent });
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', '文字の濃淡で描いた、ゆっくり流れる模様');
  const disposer = createDisposer();
  const g = createSurface(root, 'ua-apl', 2, (w) => clamp(w / (preview ? 64 : 105) / p.detail, 4.5, 16));

  const ptr = { x: 0.5, y: 0.5, sx: 0.5, sy: 0.5, inside: false, gain: 0 };
  const intro = { v: reduced ? 1 : 0 };
  let time = reduced ? 9 : 3;
  // タップの仕掛け。front は書き換える輪の半径、heal は元へ戻す輪の半径、pinch は流れを絞る強さ。
  const shock = { x: 0, y: 0, front: 0, heal: 0, pinch: 0, on: false };

  function rewrite(event) {
    if (reduced || !g.cols) return;
    const local = event ? localPointer(event, root) : { x: 0.2 + Math.random() * 0.6, y: 0.25 + Math.random() * 0.5 };
    const halfW = (g.cols * g.aspect) / g.rows;
    utils.remove(shock);
    shock.x = (local.x * 2 - 1) * halfW;
    shock.y = 1 - local.y * 2;
    shock.front = 0;
    shock.heal = 0;
    shock.pinch = 0;
    shock.on = true;
    const far = Math.hypot(halfW, 1) * 2 + 0.3;
    animate(shock, {
      pinch: [
        { to: 1, duration: 200, ease: 'outQuad' },
        { to: 0, duration: 1600, ease: 'outElastic(1, .5)' },
      ],
      front: [
        { to: 0, duration: 160 },
        { to: far, duration: 1500, ease: 'outCubic' },
      ],
      heal: [
        { to: 0, duration: 1500 },
        { to: far, duration: 1900, ease: 'inOutSine' },
      ],
      onComplete() {
        shock.on = false;
      },
    });
  }
  disposer.listen(root, 'pointerdown', rewrite);

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
    const [low, high] = g.layers;
    time += dt * p.speed;
    const t = time * 0.45;
    const halfW = (cols * aspect) / rows;

    // 一覧の小さな枠では、触らなくても渦の中心が動き回る。
    const auto = preview && !ptr.inside;
    const tx = auto ? 0.5 + 0.3 * Math.sin(time * 0.5) : ptr.x;
    const ty = auto ? 0.5 + 0.28 * Math.sin(time * 0.37 + 1) : ptr.y;
    const ease = 1 - Math.exp(-dt * 5);
    ptr.sx += (tx - ptr.sx) * ease;
    ptr.sy += (ty - ptr.sy) * ease;
    ptr.gain += ((ptr.inside || auto ? 1 : 0) - ptr.gain) * (1 - Math.exp(-dt * 2.5));
    const cx = (ptr.sx * 2 - 1) * halfW;
    const cy = 1 - ptr.sy * 2;
    const twist = 2.6 * p.bend * ptr.gain;
    const f = 1 / p.scale;
    // 登場のときは、中心から外へ模様が広がる。
    const reach = intro.v * (halfW + 1.2);

    for (let r = 0; r < rows; r += 1) {
      const y0 = 1 - ((r + 0.5) / rows) * 2;
      for (let c = 0; c < cols; c += 1) {
        const index = r * cols + c;
        const x0 = (((c + 0.5) / cols) * 2 - 1) * halfW;
        // ポインターのまわりで座標を回して、流れを渦にする。
        const dx = x0 - cx;
        const dy = y0 - cy;
        const d2 = dx * dx + dy * dy;
        let angle = twist * Math.exp(-d2 * 2.6);
        let altered = false;
        let rim = 0;
        if (shock.on) {
          const sx = x0 - shock.x;
          const sy = y0 - shock.y;
          const sd = Math.hypot(sx, sy);
          angle += shock.pinch * 3.2 * Math.exp(-sd * sd * 5);
          altered = sd < shock.front && sd >= shock.heal;
          // 輪の縁は明るく縁取る。
          rim = Math.max(Math.exp(-(((sd - shock.front) / 0.07) ** 2)), 0.7 * Math.exp(-(((sd - shock.heal) / 0.07) ** 2)));
          if (shock.front <= 0) rim = 0;
        }
        const ca = Math.cos(angle);
        const sa = Math.sin(angle);
        let x = (cx + dx * ca - dy * sa) * f;
        let y = (cy + dx * sa + dy * ca) * f;
        // 座標そのものを波で揺らしてから、縞と輪を足し合わせる。
        x += 0.32 * Math.sin(y * 2.1 + t * 1.3);
        y += 0.32 * Math.sin(x * 1.7 - t * 1.1);
        const v =
          Math.sin(x * 2.4 + t) +
          Math.sin(y * 3.1 - t * 0.8) +
          Math.sin((x + y) * 1.9 + t * 0.6) +
          Math.sin(Math.hypot(x - Math.sin(t * 0.5) * 0.8, y - Math.cos(t * 0.4) * 0.6) * 4.2 - t * 1.4);
        const wave = 0.5 + 0.5 * Math.sin(v * 1.9 + t * 0.3);
        const edge = clamp((reach - Math.hypot(x0, y0)) * 3, 0, 1);
        const lum = Math.min(1, (0.04 + 0.96 * wave ** 1.35) * edge + rim * 0.8 * edge);
        const code = altered ? ALT_CODES[Math.round(lum * ALT_LAST)] : RAMP_CODES[Math.round(lum * LAST)];
        if (rim > 0.5 || v > 0.45 !== altered) {
          high[index] = code;
          low[index] = SPACE;
        } else {
          low[index] = code;
          high[index] = SPACE;
        }
      }
    }
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
  if (!reduced) animate(intro, { v: 1, duration: 1800, ease: 'outCubic' });
  if (preview && !reduced) disposer.interval(() => rewrite(), 5200);

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
    rewrite,
    destroy() {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      timer?.pause();
      utils.remove(intro);
      utils.remove(shock);
      disposer.run();
      removeRoot(root);
    },
  };
}
