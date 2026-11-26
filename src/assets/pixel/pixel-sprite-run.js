import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'pixel-sprite-run',
  title: '走るドット絵ロボット',
  category: 'pixel',
  libs: ['animejs'],
  description:
    '一つ目の小さなロボットが、流れる地面の上を 4 コマの足踏みで走り続けます。クリックすると跳ねて、着地で土ぼこりが上がります。宙にいる間にもう一度クリックすると、足もとに噴射の粒を出して 2 段目を跳び、着地では大きな土ぼこりが上がって、頭の上に「!」の吹き出しが点滅します。読み込み中の画面や、ページの隅に置く飾りに使えます。戻り値の jump() でも跳ねさせられます。',
  params: {
    scene: {
      type: 'select',
      label: '場面',
      options: [
        { value: 'sunset', label: '夕暮れ' },
        { value: 'night', label: '夜' },
        { value: 'day', label: '昼' },
      ],
      default: 'sunset',
    },
    speed: { type: 'range', label: '走る速さ', min: 0.3, max: 2.5, step: 0.1, default: 1 },
    jump: { type: 'range', label: '跳ねる高さ', min: 6, max: 30, step: 1, default: 17 },
    body: { type: 'color', label: '体の色', default: '#4fd6c0' },
    accent: { type: 'color', label: '差し色', default: '#ffcf4a' },
  },
};

const CSS = `
.ua-psr{position:absolute;inset:0;overflow:hidden;cursor:pointer}
.ua-psr canvas{position:absolute;left:0;top:0;display:block;image-rendering:crisp-edges;image-rendering:pixelated}
`;

const BASE_W = 96;
const BASE_H = 64;
const OUTLINE = '#1a1626';

const SCENES = {
  sunset: { sky: ['#2b1b4f', '#5a2a6e', '#a3407a', '#e8695a', '#ffb35a'], sun: '#ffe9a0', far: '#4a2a66', mid: '#33204f', ground: '#1d1433', top: '#b05a8a', detail: '#4d2c63' },
  night: { sky: ['#070a1f', '#0d1433', '#152048', '#1e2f5e', '#2a4273'], sun: '#e8f0ff', far: '#132048', mid: '#0b1430', ground: '#060a18', top: '#3b5c96', detail: '#16264a' },
  day: { sky: ['#3f8fe0', '#5aa8ec', '#7cc0f2', '#a4d8f5', '#d0ecf7'], sun: '#fff6c0', far: '#7fb0c8', mid: '#4f9a7a', ground: '#2f6a4a', top: '#8fdc7a', detail: '#3f8a5a' },
};

// 自作のロボット。o=輪郭 b=体 h=明るい面 s=影 e=目 p=瞳 a=差し色
const BODY = [
  '.....a......',
  '.....o......',
  '..oooooooo..',
  '.obhhbbbbbo.',
  '.obhbbeeeeo.',
  '.obbbbeeppo.',
  '.obbbbeeppo.',
  '.oabbbbbbso.',
  '.obbbbbssso.',
  '..oooooooo..',
];
// 足の 4 コマ。o=手前の足 d=奥の足
const LEGS = [
  ['...dd..oo...', '..dd....oo..', '.dd.....ooo.'],
  ['....ddoo....', '....d.oo....', '......ooo...'],
  ['...oo..dd...', '..oo....dd..', '.ooo.....dd.'],
  ['....oodd....', '....oo.d....', '....ooo.....'],
];
const LEGS_AIR = ['...oo..dd...', '...ooo.ddd..', '............'];
const SPRITE_W = 12;
const SPRITE_H = BODY.length + 3;

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

function drawSprite(ctx, rows, x, y, palette) {
  for (let r = 0; r < rows.length; r += 1) {
    for (let c = 0; c < rows[r].length; c += 1) {
      const color = palette[rows[r][c]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + c, y + r, 1, 1);
    }
  }
}

function disc(ctx, cx, cy, radius, color) {
  ctx.fillStyle = color;
  for (let dy = -radius; dy <= radius; dy += 1) {
    const half = Math.round(Math.sqrt(Math.max(0, radius * radius - dy * dy)));
    ctx.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
  }
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const scene = SCENES[p.scene];
  const root = createRoot(container, 'ua-psr', { background: scene.sky[0] });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const palette = {
    o: OUTLINE,
    b: p.body,
    h: mix(p.body, '#ffffff', 0.55),
    s: mix(p.body, '#000000', 0.35),
    e: '#f4f8ff',
    p: OUTLINE,
    a: p.accent,
    d: mix(OUTLINE, p.body, 0.35),
  };
  const dustColor = mix(scene.top, '#ffffff', 0.35);
  const cloudColor = mix(scene.sky[2], '#ffffff', 0.4);
  const state = { y: 0, enter: reduced ? 0 : -40 };
  const fx = { bubble: 0 };
  let jumps = 0;
  let firstJump = null;
  let dust = [];
  let time = 0;
  let run = 0;
  let scroll = 0;
  let lastFrame = 0;
  let lastJump = 0;
  let airborne = false;
  let destroyed = false;

  function puff(x, y, amount) {
    for (let i = 0; i < amount; i += 1) {
      dust.push({ x, y, vx: -utils.random(8, 26, 1), vy: -utils.random(2, 12, 1), life: 0, max: utils.random(0.25, 0.55, 2) });
    }
  }

  function drawBackdrop(ctx, w, groundY) {
    const bandHeight = Math.ceil(groundY / scene.sky.length);
    scene.sky.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, i * bandHeight, w, bandHeight);
    });
    disc(ctx, Math.round(w * 0.72), Math.round(groundY * 0.52), Math.max(4, Math.round(groundY * 0.2)), scene.sun);
    // 流れる雲。小さな横長の塊を 2 段に重ねる。
    for (let i = 0; i < 4; i += 1) {
      const span = w + 30;
      const x = Math.floor(((hash(i + 3) * span - scroll * (0.03 + i * 0.012)) % span + span) % span) - 15;
      const y = Math.floor(3 + hash(i + 11) * groundY * 0.35);
      ctx.fillStyle = cloudColor;
      ctx.fillRect(x, y, 9, 2);
      ctx.fillRect(x + 2, y - 1, 5, 1);
    }
  }

  function drawHills(ctx, w, groundY) {
    for (let x = 0; x < w; x += 1) {
      const far = x + scroll * 0.1;
      const farHeight = Math.round(groundY * 0.2 + Math.sin(far * 0.06) * 4 + Math.sin(far * 0.023 + 1.3) * 6);
      ctx.fillStyle = scene.far;
      ctx.fillRect(x, groundY - farHeight, 1, farHeight);
    }
    for (let x = 0; x < w; x += 1) {
      const world = Math.floor(x + scroll * 0.3);
      const height = Math.round(groundY * 0.09 + Math.sin(world * 0.045 + 2) * 3 + Math.sin(world * 0.11) * 1.5);
      ctx.fillStyle = scene.mid;
      ctx.fillRect(x, groundY - height, 1, height);
      // ところどころに立つ電波塔。
      if (((world % 41) + 41) % 41 === 0) {
        ctx.fillRect(x, groundY - height - 7, 1, 7);
        ctx.fillRect(x - 1, groundY - height - 5, 3, 1);
      }
    }
  }

  function drawGround(ctx, w, hgt, groundY) {
    ctx.fillStyle = scene.ground;
    ctx.fillRect(0, groundY, w, hgt - groundY);
    ctx.fillStyle = scene.top;
    ctx.fillRect(0, groundY, w, 1);
    const depth = hgt - groundY;
    for (let x = 0; x < w; x += 1) {
      const world = Math.floor(x + scroll);
      if (hash(world * 3.1) < 0.07) {
        ctx.fillStyle = scene.top;
        ctx.fillRect(x, groundY - 1, 1, 1);
      }
      if (hash(world) < 0.08) {
        ctx.fillStyle = scene.detail;
        ctx.fillRect(x, groundY + 2 + Math.floor(hash(world + 7) * (depth - 3)), 2, 1);
      }
      if (((world % 16) + 16) % 16 < 6) {
        ctx.fillStyle = scene.detail;
        ctx.fillRect(x, groundY + Math.floor(depth / 2), 1, 1);
      }
    }
  }

  function drawRobot(ctx, w, groundY) {
    const frame = Math.floor(run) % 4;
    const lift = Math.round(state.y);
    const x = Math.round(w * 0.3 - SPRITE_W / 2 + state.enter);
    const bob = !airborne && frame % 2 === 1 ? 1 : 0;
    const top = groundY - SPRITE_H + lift;
    const shrink = Math.min(3, Math.floor(-lift / 5));
    ctx.fillStyle = mix(scene.ground, '#000000', 0.5);
    ctx.fillRect(x + 2 + shrink, groundY + 1, SPRITE_W - 4 - shrink * 2, 1);
    const blink = Math.floor(time * 3) % 2 === 0;
    drawSprite(ctx, BODY, x, top - bob, { ...palette, a: blink ? p.accent : '#ffffff' });
    drawSprite(ctx, airborne ? LEGS_AIR : LEGS[frame], x, top + BODY.length, palette);
    // 2 段跳びの着地で出る吹き出し。点滅しながら消える。
    if (fx.bubble > 0 && Math.floor(fx.bubble * 9) % 2 === 0) {
      const bx = x + SPRITE_W;
      const by = top - 9;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(bx, by, 7, 7);
      ctx.fillRect(bx - 1, by + 6, 2, 2);
      ctx.fillStyle = '#1a1a2a';
      ctx.fillRect(bx + 3, by + 1, 1, 3);
      ctx.fillRect(bx + 3, by + 5, 1, 1);
    }
  }

  function draw() {
    const { ctx, w, h: hgt } = view;
    const groundY = hgt - Math.max(9, Math.round(hgt * 0.2));
    drawBackdrop(ctx, w, groundY);
    drawHills(ctx, w, groundY);
    drawGround(ctx, w, hgt, groundY);
    ctx.fillStyle = dustColor;
    for (const d of dust) ctx.fillRect(Math.round(d.x), Math.round(d.y), d.life < d.max * 0.5 ? 2 : 1, 1);
    drawRobot(ctx, w, groundY);
  }

  function jump() {
    if (destroyed || reduced) return;
    if (airborne) {
      // 宙にいる間の 2 回目。足もとから噴射して、もう一段高く跳ぶ。
      if (jumps >= 2) return;
      jumps = 2;
      lastJump = time;
      // 1 段目の動きは止める。止めないと、1 段目の着地の処理が途中で走る。
      firstJump?.pause();
      const groundY = view.h - Math.max(9, Math.round(view.h * 0.2));
      for (let i = 0; i < 8; i += 1) dust.push({ x: view.w * 0.3 + utils.random(-4, 4, 1), y: groundY + state.y, vx: utils.random(-14, 14, 1), vy: utils.random(10, 30, 1), life: 0, max: utils.random(0.25, 0.5, 2) });
      animate(state, {
        y: [
          { to: Math.min(state.y, -p.jump * 0.6) - p.jump * 0.8, duration: 280, ease: 'outQuad' },
          { to: 0, duration: 400, ease: 'inQuad' },
        ],
        onComplete() {
          airborne = false;
          jumps = 0;
          puff(view.w * 0.3, groundY, 16);
          for (let i = 0; i < 8; i += 1) dust.push({ x: view.w * 0.3, y: groundY, vx: utils.random(8, 30, 1), vy: -utils.random(2, 14, 1), life: 0, max: utils.random(0.3, 0.6, 2) });
          animate(fx, { bubble: [1, 0], duration: 1000, ease: 'linear' });
        },
      });
      return;
    }
    jumps = 1;
    airborne = true;
    lastJump = time;
    firstJump = animate(state, {
      y: [
        { to: -p.jump, duration: 300, ease: 'outQuad' },
        { to: 0, duration: 320, ease: 'inQuad' },
      ],
      onComplete() {
        airborne = false;
        jumps = 0;
        const groundY = view.h - Math.max(9, Math.round(view.h * 0.2));
        puff(view.w * 0.3, groundY, 6);
      },
    });
  }

  function update(dt) {
    time += dt;
    run += dt * 10 * p.speed;
    scroll += dt * 46 * p.speed;
    const frame = Math.floor(run) % 4;
    if (frame !== lastFrame && !airborne && frame % 2 === 0) {
      const groundY = view.h - Math.max(9, Math.round(view.h * 0.2));
      puff(view.w * 0.3 - 3, groundY, 1);
    }
    lastFrame = frame;
    dust = dust.map((d) => ({ ...d, life: d.life + dt, x: d.x + d.vx * dt, y: d.y + d.vy * dt })).filter((d) => d.life < d.max);
    // しばらく触られなければ、自分で跳ねる。
    if (time - lastJump > (p.preview ? 2.4 : 4.5)) jump();
  }

  const view = createPixelView(root, disposer, BASE_W, BASE_H, () => {
    if (reduced) draw();
  });
  view.fit();

  const destroyBase = () => {
    destroyed = true;
    utils.remove(state);
    utils.remove(fx);
    disposer.run();
    removeRoot(root);
  };
  if (reduced) return { jump, destroy: destroyBase };

  animate(state, { enter: 0, duration: 900, ease: 'outBack(1.4)' });
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
  disposer.listen(root, 'pointerdown', jump);

  return {
    jump,
    destroy() {
      timer.pause();
      destroyBase();
    },
  };
}
