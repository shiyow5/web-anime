import { animate, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'confetti-burst',
  title: '紙吹雪',
  category: 'ui',
  libs: ['animejs'],
  description:
    'ボタンを押すと、ボタンが押しつぶされてから跳ね上がり、押した場所から色とりどりの紙吹雪が弾けます。少し遅れて左右の下の角からも斜めに撃ち上がり、最後に上から紙がゆっくり揺れながら降ってきます。申し込みの完了、目標の達成、当選の発表など、うれしい瞬間に使います。戻り値の burst() で、好きな位置から出せます。',
  params: {
    count: { type: 'range', label: '紙の枚数', min: 20, max: 240, step: 10, default: 110 },
    spread: { type: 'range', label: '広がり', min: 0.2, max: 1.5, step: 0.05, default: 0.8 },
    color1: { type: 'color', label: '色 1', default: '#ff4d6d' },
    color2: { type: 'color', label: '色 2', default: '#ffd23f' },
    color3: { type: 'color', label: '色 3', default: '#3a86ff' },
    color4: { type: 'color', label: '色 4', default: '#06d6a0' },
    background: { type: 'color', label: '背景色', default: '#fffaf0' },
  },
};

const CSS = `
.ua-cb{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;container-type:size;background:var(--ua-bg);
  font-family:var(--ua-display,system-ui,sans-serif)}
.ua-cb__btn{position:relative;z-index:2;padding:1em 2.2em;border:0;border-radius:999px;background:#1c1d29;color:#fff;font:inherit;
  font-size:clamp(13px,3cqw,22px);font-weight:700;cursor:pointer}
.ua-cb__btn:focus-visible{outline:3px solid #3a86ff;outline-offset:4px}
.ua-cb__piece{position:absolute;left:0;top:0;pointer-events:none;will-change:transform}
.ua-cb__ring{position:absolute;width:40px;height:40px;margin:-20px;border:2px solid #1c1d29;border-radius:50%;opacity:0;pointer-events:none}
`;

const SHAPES = [
  { width: 10, height: 10, radius: '2px' },
  { width: 6, height: 16, radius: '1px' },
  { width: 9, height: 9, radius: '50%' },
  { width: 14, height: 5, radius: '1px' },
];
const LABEL = 'お祝いする';
const DONE_LABEL = 'おめでとうございます';
// 同時に画面へ出す紙の上限。連打しても要素が増え続けないようにする。
const MAX_LIVE_PIECES = 480;

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-cb', { '--ua-bg': p.background });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const colors = [p.color1, p.color2, p.color3, p.color4];
  const button = h('button', { class: 'ua-cb__btn', type: 'button', text: LABEL });
  const status = h('span', { role: 'status', style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)' } });
  root.append(button, status);
  let labelTimer = 0;
  let live = 0;
  let destroyed = false;

  // x, y は素材の左上からの位置（px）。省くとボタンの中央から出す。
  function burst(x, y) {
    if (destroyed) return;
    const rect = root.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const originX = Number.isFinite(x) ? x : buttonRect.left - rect.left + buttonRect.width / 2;
    const originY = Number.isFinite(y) ? y : buttonRect.top - rect.top + buttonRect.height / 2;
    status.textContent = DONE_LABEL;
    button.textContent = DONE_LABEL;
    clearTimeout(labelTimer);
    labelTimer = setTimeout(() => {
      button.textContent = LABEL;
      status.textContent = '';
    }, 1800);
    if (reduced || live >= MAX_LIVE_PIECES) return;

    const budget = Math.min(Math.round(p.preview ? Math.min(p.count, 70) : p.count), MAX_LIVE_PIECES - live);
    // 紙を 3 つに分ける。押した場所からの大きな一発、少し遅れて左右の下から撃つ 2 発、最後に上からゆっくり降る分。
    const side = Math.floor(budget * 0.18);
    const drift = Math.floor(budget * 0.12);
    const main = budget - side * 2 - drift;
    const reach = Math.max(rect.width, 320) * 0.5 * p.spread;
    const rise = Math.max(rect.height, 240);
    let made = 0;
    const make = (amount, fromX, fromY) => {
      live += amount;
      const pieces = Array.from({ length: amount }, () => {
        const shape = SHAPES[made % SHAPES.length];
        made += 1;
        return h('i', {
          class: 'ua-cb__piece',
          style: {
            width: `${shape.width}px`,
            height: `${shape.height}px`,
            borderRadius: shape.radius,
            background: colors[made % colors.length],
            marginLeft: `${fromX() - shape.width / 2}px`,
            marginTop: `${fromY() - shape.height / 2}px`,
            opacity: '0',
          },
        });
      });
      root.append(...pieces);
      return pieces;
    };
    const fire = (pieces, params) => (pieces.length ? animate(pieces, params) : null);
    const clear = (pieces) => () => {
      live -= pieces.length;
      for (const piece of pieces) piece.remove();
    };

    // 準備。ボタンが押しつぶされ、輪が走る。
    const ring = h('i', { class: 'ua-cb__ring', style: { left: `${originX}px`, top: `${originY}px` } });
    root.append(ring);
    animate(ring, { scale: [0.2, 7], opacity: [{ to: 0.8, duration: 60 }, { to: 0, duration: 560, ease: 'outQuad' }], duration: 620, delay: 90, ease: 'outQuart', onComplete: () => ring.remove() });
    utils.remove(button);
    animate(button, {
      scaleY: [{ to: 0.72, duration: 110, ease: 'outQuad' }, { to: 1.14, duration: 180, ease: 'outQuad' }, { to: 1, duration: 900, ease: 'outElastic(1, .35)' }],
      scaleX: [{ to: 1.14, duration: 110, ease: 'outQuad' }, { to: 0.94, duration: 180, ease: 'outQuad' }, { to: 1, duration: 900, ease: 'outElastic(1, .35)' }],
      y: [{ to: 5, duration: 110, ease: 'outQuad' }, { to: -22, duration: 240, ease: 'outQuad' }, { to: 0, duration: 520, ease: 'outBounce' }],
      rotate: [{ to: 0, duration: 110 }, { to: () => utils.random(-7, 7), duration: 240, ease: 'outQuad' }, { to: 0, duration: 520, ease: 'outBack(2)' }],
    });

    // 山場 1。押した場所から、勢いよく上がってから重さで落ちる。
    const center = make(main, () => originX, () => originY);
    fire(center, {
      x: { to: () => utils.random(-reach, reach), ease: 'outQuart' },
      y: [
        { to: () => -utils.random(rise * 0.15, rise * 0.6), duration: 550, ease: 'outQuad' },
        { to: () => rise * 0.7 + utils.random(0, 120), duration: 1500, ease: 'inQuad' },
      ],
      rotate: () => utils.random(-900, 900),
      rotateX: () => utils.random(-720, 720),
      opacity: [
        { to: 1, duration: 60 },
        { to: 1, duration: 1340 },
        { to: 0, duration: 650 },
      ],
      duration: 2050,
      delay: stagger(3, { start: 100 }),
      onComplete: clear(center),
    });

    // 山場 2。左右の下の角から、中央の上へ向けて斜めに撃ち上げる。
    [-1, 1].forEach((dir, n) => {
      const cannon = make(side, () => (dir < 0 ? 0 : rect.width), () => rect.height);
      fire(cannon, {
        x: { to: () => -dir * utils.random(rect.width * 0.12, rect.width * 0.55), ease: 'outQuart' },
        y: [
          { to: () => -utils.random(rect.height * 0.45, rect.height * 0.95), duration: 620, ease: 'outQuad' },
          { to: () => utils.random(20, 140), duration: 1500, ease: 'inQuad' },
        ],
        rotate: () => utils.random(-900, 900),
        rotateY: () => utils.random(-720, 720),
        opacity: [
          { to: 1, duration: 60 },
          { to: 1, duration: 1400 },
          { to: 0, duration: 660 },
        ],
        duration: 2120,
        delay: stagger(5, { start: 330 + n * 140 }),
        onComplete: clear(cannon),
      });
    });

    // 余韻。上から、左右に揺れながらゆっくり降ってくる。
    const slow = make(drift, () => utils.random(rect.width * 0.08, rect.width * 0.92), () => -20);
    fire(slow, {
      y: { to: () => rect.height + 40, ease: 'linear' },
      x: [
        { to: () => utils.random(18, 46), duration: 520, ease: 'inOutSine' },
        { to: () => -utils.random(18, 46), duration: 520, ease: 'inOutSine' },
        { to: () => utils.random(18, 46), duration: 520, ease: 'inOutSine' },
        { to: () => -utils.random(18, 46), duration: 520, ease: 'inOutSine' },
        { to: 0, duration: 520, ease: 'inOutSine' },
      ],
      rotateX: () => utils.random(-1080, 1080),
      rotate: () => utils.random(-200, 200),
      opacity: [
        { to: 1, duration: 120 },
        { to: 1, duration: 2000 },
        { to: 0, duration: 480 },
      ],
      duration: 2600,
      delay: stagger(55, { start: 750 }),
      onComplete: clear(slow),
    });
  }

  disposer.listen(button, 'click', (event) => {
    const { px, py } = localPointer(event, root);
    // キーボードで押したときは位置が取れないので、ボタンの中央から出す。
    if (event.detail === 0) burst();
    else burst(px, py);
  });
  disposer.add(() => clearTimeout(labelTimer));
  if (p.preview) {
    disposer.interval(() => burst(), 3400);
    disposer.timeout(() => burst(), 600);
  }

  return {
    burst,
    destroy() {
      destroyed = true;
      disposer.run();
      removeRoot(root);
    },
  };
}
