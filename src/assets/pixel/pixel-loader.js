import { animate, createTimer, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'pixel-loader',
  title: 'ドット絵のローダー集',
  category: 'pixel',
  libs: ['animejs'],
  description:
    '砂時計、数字つきの進捗の棒、順に跳ねる粒、回る輪の 4 種類のローダーを、ドット絵で並べます。設定で 1 種類だけを選ぶと、枠いっぱいに大きく出ます。クリックすると枠が光り、輪が一時的に速く回ります。読み込み中や処理待ちの表示に使えます。',
  params: {
    kind: {
      type: 'select',
      label: '種類',
      options: [
        { value: 'all', label: '4 種類を並べる' },
        { value: 'hourglass', label: '砂時計' },
        { value: 'bar', label: '進捗の棒' },
        { value: 'dots', label: '跳ねる粒' },
        { value: 'ring', label: '回る輪' },
      ],
      default: 'all',
    },
    speed: { type: 'range', label: '速さ', min: 0.4, max: 2.5, step: 0.1, default: 1 },
    color: { type: 'color', label: '主な色', default: '#7cf29a' },
    accent: { type: 'color', label: '差し色', default: '#ffd84a' },
    background: { type: 'color', label: '背景色', default: '#161a2b' },
  },
};

const CSS = `
.ua-pld{position:absolute;inset:0;overflow:hidden;cursor:pointer}
.ua-pld canvas{position:absolute;left:0;top:0;display:block;image-rendering:crisp-edges;image-rendering:pixelated}
`;

// 1 種類のローダーは 40 × 40 の升目の中に描く。
const BOX = 40;
const KINDS = ['hourglass', 'bar', 'dots', 'ring'];
const GLYPHS = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '001', '010', '010'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
  '%': ['101', '001', '010', '100', '101'],
};
const SEGMENTS = 7;
const DOTS = 4;

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

// 砂時計の内側の半幅。上は下へ向かって細くなり、下は逆に広がる。
function glassHalf(y) {
  if (y <= 18) return 8 - Math.floor((y - 7) * 0.6);
  if (y <= 20) return 1;
  return 8 - Math.floor((32 - y) * 0.6);
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-pld', { background: p.background });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const single = p.kind !== 'all';
  const shown = single ? [p.kind] : KINDS;
  const colors = {
    frame: mix(p.background, '#ffffff', 0.62),
    dim: mix(p.background, '#ffffff', 0.14),
    glass: mix(p.background, '#8fb8ff', 0.16),
    sand: p.accent,
    sandDark: mix(p.accent, '#000000', 0.3),
    main: p.color,
    light: mix(p.color, '#ffffff', 0.6),
    trail: [0.4, 0.65, 0.84].map((k) => mix(p.color, p.background, k)),
    shadow: mix(p.background, '#000000', 0.45),
    segments: Array.from({ length: SEGMENTS }, (_, i) => mix(p.color, p.accent, i / (SEGMENTS - 1))),
  };
  const state = { cycle: reduced ? 0.45 : 0, progress: reduced ? 0.6 : 0, pulse: 0 };
  const dots = Array.from({ length: DOTS }, (_, i) => ({ y: reduced && i === 1 ? -0.8 : 0 }));
  let time = 0;
  let destroyed = false;

  // 升目の左上と 1 目の大きさを受け取り、升目の座標で四角を描く関数を返す。
  const painter = (ctx, left, top, unit) => (x, y, w, hgt, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(left + Math.round(x * unit), top + Math.round(y * unit), Math.max(1, Math.round(w * unit)), Math.max(1, Math.round(hgt * unit)));
  };

  function drawHourglass(rect) {
    const sandTime = Math.min(1, state.cycle / 0.8);
    const flip = Math.max(0, (state.cycle - 0.8) / 0.2);
    // ひっくり返す間は、横幅を縮めてから戻す。半分を過ぎたら、砂が上に戻った絵にする。
    const squeeze = Math.abs(Math.cos(flip * Math.PI));
    const sand = flip > 0.5 ? 0 : sandTime;
    const box = (x, y, w, hgt, color) => rect(20 + (x - 20) * squeeze, y, Math.max(0.5, w * squeeze), hgt, color);
    box(9, 4, 22, 3, colors.frame);
    box(9, 33, 22, 3, colors.frame);
    for (let y = 7; y <= 32; y += 1) {
      const half = glassHalf(y);
      box(20 - half - 1, y, half * 2 + 2, 1, colors.frame);
      box(20 - half, y, half * 2, 1, colors.glass);
      const topSand = y <= 18 && y >= 7 + Math.ceil(sand * 12);
      const bottomSand = y >= 21 && y > 32 - sand * 12;
      if (topSand || bottomSand) box(20 - half, y, half * 2, 1, (y + Math.floor(time * 6)) % 3 === 0 ? colors.sandDark : colors.sand);
    }
    if (sand > 0 && sand < 1 && flip === 0) {
      const pileTop = Math.max(21, Math.floor(33 - sand * 12));
      for (let y = 19; y < pileTop; y += 1) if ((y + Math.floor(time * 16)) % 2 === 0) box(19.5, y, 1, 1, colors.sand);
    }
  }

  function drawText(rect, text, y) {
    const left = 20 - (text.length * 4 - 1) / 2;
    [...text].forEach((char, i) => {
      GLYPHS[char].forEach((row, r) => {
        [...row].forEach((bit, c) => {
          if (bit === '1') rect(left + i * 4 + c, y + r, 1, 1, colors.light);
        });
      });
    });
  }

  function drawBar(rect) {
    const filled = Math.round(state.progress * SEGMENTS);
    drawText(rect, `${Math.round((filled / SEGMENTS) * 100)}%`, 8);
    rect(4, 17, 32, 9, colors.frame);
    rect(5, 18, 30, 7, colors.shadow);
    for (let i = 0; i < SEGMENTS; i += 1) {
      rect(6 + i * 4, 19, 3, 5, i < filled ? colors.segments[i] : colors.dim);
      if (i < filled) rect(6 + i * 4, 19, 3, 1, colors.light);
      rect(7 + i * 4, 29, 1, 1, i < filled ? colors.main : colors.dim);
    }
  }

  function drawDots(rect) {
    dots.forEach((dot, i) => {
      const x = 5 + i * 8.5;
      const y = 24 + dot.y * 13;
      const high = dot.y < -0.4;
      rect(x + (high ? 1 : 0), 31, high ? 2 : 4, 1, colors.shadow);
      const color = i % 2 === 0 ? colors.main : p.accent;
      rect(x + 1, y, 2, 4, color);
      rect(x, y + 1, 4, 2, color);
      rect(x + 1, y + 1, 1, 1, colors.light);
    });
  }

  function drawRing(rect) {
    const head = Math.floor(time * 9 * p.speed * (1 + state.pulse * 2)) % 8;
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const distance = (head - i + 8) % 8;
      const color = distance === 0 ? colors.light : distance === 1 ? colors.main : distance <= 4 ? colors.trail[distance - 2] : colors.dim;
      rect(Math.round(20 + Math.cos(angle) * 11) - 2, Math.round(20 + Math.sin(angle) * 11) - 2, 4, 4, color);
    }
    const beat = Math.floor(time * 3 * p.speed) % 2;
    rect(19 - beat, 19 - beat, 2 + beat * 2, 2 + beat * 2, p.accent);
  }

  const drawers = { hourglass: drawHourglass, bar: drawBar, dots: drawDots, ring: drawRing };

  function drawCell(ctx, kind, x, y, w, hgt) {
    const unit = Math.max(1, Math.floor(Math.min(w, hgt) / (BOX + 2)));
    const left = Math.round(x + (w - BOX * unit) / 2);
    const top = Math.round(y + (hgt - BOX * unit) / 2);
    // 升目の四隅に、かぎ形の目印を置く。
    ctx.fillStyle = state.pulse > 0.3 ? p.accent : colors.dim;
    const inset = 2;
    const arm = Math.max(3, unit * 3);
    [[x + inset, y + inset, 1, 1], [x + w - inset - 1, y + inset, -1, 1], [x + inset, y + hgt - inset - 1, 1, -1], [x + w - inset - 1, y + hgt - inset - 1, -1, -1]].forEach(
      ([cx, cy, dx, dy]) => {
        ctx.fillRect(Math.round(dx > 0 ? cx : cx - arm + 1), Math.round(cy), arm, 1);
        ctx.fillRect(Math.round(cx), Math.round(dy > 0 ? cy : cy - arm + 1), 1, arm);
      },
    );
    drawers[kind](painter(ctx, left, top, unit));
  }

  function draw() {
    const { ctx, w, h: hgt } = view;
    ctx.fillStyle = p.background;
    ctx.fillRect(0, 0, w, hgt);
    if (single) {
      drawCell(ctx, shown[0], 0, 0, w, hgt);
      return;
    }
    const cellW = Math.floor(w / 2);
    const cellH = Math.floor(hgt / 2);
    shown.forEach((kind, i) => drawCell(ctx, kind, (i % 2) * cellW, Math.floor(i / 2) * cellH, cellW, cellH));
  }

  function pulse() {
    if (destroyed || reduced) return;
    animate(state, { pulse: [1, 0], duration: 900, ease: 'outQuad' });
  }

  const view = createPixelView(root, disposer, single ? 48 : 96, single ? 44 : 88, () => {
    if (reduced) draw();
  });
  view.fit();

  const destroyBase = () => {
    destroyed = true;
    utils.remove(state);
    utils.remove(dots);
    disposer.run();
    removeRoot(root);
  };
  if (reduced) return { pulse, destroy: destroyBase };

  animate(state, { cycle: [0, 1], duration: 3000 / p.speed, ease: 'linear', loop: true });
  animate(state, { progress: [0, 1], duration: 2800 / p.speed, ease: 'inOutQuad', loop: true, loopDelay: 500 });
  animate(dots, {
    y: [
      { to: -1, duration: 280 / p.speed, ease: 'outQuad' },
      { to: 0, duration: 280 / p.speed, ease: 'inQuad' },
    ],
    delay: stagger(110 / p.speed),
    loop: true,
    loopDelay: 300 / p.speed,
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
  disposer.listen(root, 'pointerdown', pulse);

  return {
    pulse,
    destroy() {
      timer.pause();
      destroyBase();
    },
  };
}
