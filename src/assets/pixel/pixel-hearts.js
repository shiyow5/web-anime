import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'pixel-hearts',
  title: '弾けるドット絵ハート',
  category: 'pixel',
  libs: ['animejs'],
  description:
    'クリックした場所から、ドット絵のハートと星が弾けて飛び、重さで落ちて床で跳ねます。触らなくても、ときどき自動で弾けます。「いいね」を押したときや、お祝いの演出に使えます。戻り値の burst() で、好きな位置から出せます。',
  params: {
    shapes: {
      type: 'select',
      label: '形',
      options: [
        { value: 'mix', label: 'ハートと星' },
        { value: 'hearts', label: 'ハートだけ' },
        { value: 'stars', label: '星だけ' },
      ],
      default: 'mix',
    },
    count: { type: 'range', label: '1 回に出す数', min: 6, max: 60, step: 2, default: 26 },
    gravity: { type: 'range', label: '重さ', min: 0.3, max: 2, step: 0.1, default: 1 },
    color1: { type: 'color', label: '色 1', default: '#ff4f7b' },
    color2: { type: 'color', label: '色 2', default: '#ffd84a' },
    color3: { type: 'color', label: '色 3', default: '#6fe3ff' },
    background: { type: 'color', label: '背景色', default: '#241433' },
  },
};

const CSS = `
.ua-phe{position:absolute;inset:0;overflow:hidden;cursor:pointer}
.ua-phe canvas{position:absolute;left:0;top:0;display:block;image-rendering:crisp-edges;image-rendering:pixelated}
`;

const BASE_W = 96;
const BASE_H = 64;
const MAX_PIECES = 360;
const FLOOR = 6;

// o=輪郭 x=面 h=明るい点
const SPRITES = {
  bigHeart: ['.oo...oo.', 'oxxo.oxxo', 'oxhxoxxxo', 'oxxxxxxxo', '.oxxxxxo.', '..oxxxo..', '...oxo...', '....o....'],
  heart: ['.xx.xx.', 'xhxxxxx', 'xxxxxxx', '.xxxxx.', '..xxx..', '...x...'],
  miniHeart: ['x.x', 'xxx', '.x.'],
  star: ['...o...', '..oxo..', 'ooxhxoo', 'oxxxxxo', '.oxxxo.', 'oxxoxxo', 'oo...oo'],
  miniStar: ['.x.', 'xhx', '.x.'],
};
const KINDS = {
  mix: ['bigHeart', 'heart', 'heart', 'miniHeart', 'star', 'miniStar'],
  hearts: ['bigHeart', 'heart', 'heart', 'miniHeart'],
  stars: ['star', 'star', 'miniStar'],
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

function drawSprite(ctx, rows, x, y, palette, zoom = 1) {
  for (let r = 0; r < rows.length; r += 1) {
    for (let c = 0; c < rows[r].length; c += 1) {
      const color = palette[rows[r][c]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + c * zoom, y + r * zoom, zoom, zoom);
    }
  }
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-phe', { background: p.background });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const palettes = [p.color1, p.color2, p.color3].map((color) => ({
    o: mix(color, '#000000', 0.55),
    x: color,
    h: mix(color, '#ffffff', 0.7),
  }));
  const dotColor = mix(p.background, '#ffffff', 0.09);
  const floorColor = mix(p.background, '#ffffff', 0.16);
  const floorShade = mix(p.background, '#000000', 0.3);
  const kinds = KINDS[p.shapes];
  let pieces = [];
  let rings = [];
  let time = 0;
  let nextAuto = 0.5;
  let destroyed = false;

  function spawn(cx, cy) {
    const amount = Math.min(Math.round(p.count * (p.preview ? 0.7 : 1)), MAX_PIECES - pieces.length);
    for (let i = 0; i < amount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const power = utils.random(18, 62, 1);
      const kind = kinds[i % kinds.length];
      pieces.push({
        rows: SPRITES[kind],
        palette: palettes[i % palettes.length],
        x: cx,
        y: cy,
        vx: Math.cos(angle) * power,
        vy: Math.sin(angle) * power - 45,
        life: 0,
        max: utils.random(2.2, 3.8, 2),
        bounces: 0,
      });
    }
  }

  // x, y は素材の左上からの位置（px）。省くと、画面の上のほうのどこかから出す。
  function burst(x, y) {
    if (destroyed) return;
    const cx = Number.isFinite(x) ? x / view.scale : view.w * utils.random(0.2, 0.8, 2);
    const cy = Number.isFinite(y) ? y / view.scale : view.h * utils.random(0.25, 0.55, 2);
    if (reduced) return;
    spawn(cx, cy);
    const ring = { x: cx, y: cy, r: 1, pop: 1, palette: palettes[rings.length % palettes.length] };
    rings.push(ring);
    animate(ring, {
      r: { to: 15, duration: 520, ease: 'outExpo' },
      pop: { to: 0, duration: 420, ease: 'inQuad' },
      onComplete() {
        rings = rings.filter((item) => item !== ring);
      },
    });
  }

  function update(dt) {
    time += dt;
    const floorY = view.h - FLOOR;
    const pull = 120 * p.gravity;
    pieces = pieces
      .map((piece) => {
        const next = { ...piece, life: piece.life + dt, vy: piece.vy + pull * dt };
        next.x += next.vx * dt;
        next.y += next.vy * dt;
        const bottom = next.y + piece.rows.length;
        if (bottom >= floorY && next.vy > 0) {
          next.y = floorY - piece.rows.length;
          next.vy *= -0.46;
          next.vx *= 0.7;
          next.bounces += 1;
          if (Math.abs(next.vy) < 14) next.vy = 0;
        }
        return next;
      })
      .filter((piece) => piece.life < piece.max && piece.x > -12 && piece.x < view.w + 12);
    if (time > nextAuto) {
      nextAuto = time + utils.random(0.9, 1.7, 2);
      burst();
    }
  }

  function drawBackdrop(ctx, w, hgt) {
    ctx.fillStyle = p.background;
    ctx.fillRect(0, 0, w, hgt);
    ctx.fillStyle = dotColor;
    for (let y = 4; y < hgt - FLOOR; y += 8) {
      for (let x = 4 + ((y / 8) % 2) * 4; x < w; x += 8) ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillStyle = floorShade;
    ctx.fillRect(0, hgt - FLOOR, w, FLOOR);
    ctx.fillStyle = floorColor;
    ctx.fillRect(0, hgt - FLOOR, w, 1);
    for (let x = 2; x < w; x += 6) ctx.fillRect(x, hgt - FLOOR + 3, 3, 1);
  }

  function drawRings(ctx) {
    for (const ring of rings) {
      ctx.fillStyle = ring.r < 8 ? '#ffffff' : ring.palette.x;
      const steps = Math.max(8, Math.round(ring.r * 5));
      for (let i = 0; i < steps; i += 1) {
        if (ring.r > 10 && i % 2 === 0) continue;
        const angle = (i / steps) * Math.PI * 2;
        ctx.fillRect(Math.round(ring.x + Math.cos(angle) * ring.r), Math.round(ring.y + Math.sin(angle) * ring.r), 1, 1);
      }
      // 弾けた瞬間だけ、中心に大きなハートを出す。
      if (ring.pop > 0.35) drawSprite(ctx, SPRITES.bigHeart, Math.round(ring.x) - 9, Math.round(ring.y) - 8, ring.palette, 2);
    }
  }

  function draw() {
    const { ctx, w, h: hgt } = view;
    drawBackdrop(ctx, w, hgt);
    drawRings(ctx);
    for (const piece of pieces) {
      const k = piece.life / piece.max;
      if (k > 0.8 && Math.floor(time * 14) % 2 === 0) continue;
      drawSprite(ctx, piece.rows, Math.round(piece.x - piece.rows[0].length / 2), Math.round(piece.y), piece.palette);
    }
  }

  // 動きを止める設定のときは、弾けた途中の形を 1 枚だけ見せる。
  function drawStill() {
    const { ctx, w, h: hgt } = view;
    drawBackdrop(ctx, w, hgt);
    const cx = Math.round(w / 2);
    const cy = Math.round(hgt * 0.45);
    drawSprite(ctx, SPRITES.bigHeart, cx - 9, cy - 8, palettes[0], 2);
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const rows = SPRITES[kinds[i % kinds.length]];
      drawSprite(ctx, rows, Math.round(cx + Math.cos(angle) * 26 - 3), Math.round(cy + Math.sin(angle) * 18 - 3), palettes[i % 3]);
    }
  }

  const view = createPixelView(root, disposer, BASE_W, BASE_H, () => {
    if (reduced) drawStill();
  });
  view.fit();

  const destroyBase = () => {
    destroyed = true;
    utils.remove(rings);
    disposer.run();
    removeRoot(root);
  };
  if (reduced) return { burst, destroy: destroyBase };

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
    const { px, py } = localPointer(event, root);
    nextAuto = time + 3;
    burst(px, py);
  });

  return {
    burst,
    destroy() {
      timer.pause();
      destroyBase();
    },
  };
}
