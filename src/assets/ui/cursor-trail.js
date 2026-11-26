import { animate, createAnimatable, createTimer } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'cursor-trail',
  title: '尾を引くカーソル',
  category: 'ui',
  libs: ['animejs'],
  description:
    '標準のカーソルの代わりに、点と輪、そのあとを追う尾を表示します。data-ua-hover を付けた要素に乗ると輪が広がり、押すと輪が縮んで力をため、その場所から波紋と火花が広がり、尾の粒が花火のように散ってからカーソルへ吸い戻されます。ポートフォリオなど、演出を前に出したいサイトに向いています。',
  params: {
    trail: { type: 'range', label: '尾の長さ', min: 0, max: 20, step: 1, default: 10 },
    accent: { type: 'color', label: 'カーソルの色', default: '#ff3d77' },
    ink: { type: 'color', label: '文字色', default: '#f5f2ff' },
    background: { type: 'color', label: '背景色', default: '#17112e' },
  },
};

const CSS = `
.ua-ct{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:4%;overflow:hidden;
  container-type:size;background:var(--ua-bg);color:var(--ua-ink);font-family:var(--ua-display,system-ui,sans-serif)}
.ua-ct.is-live,.ua-ct.is-live *{cursor:none}
.ua-ct__title{margin:0;font-size:clamp(20px,8cqw,104px);font-weight:800;letter-spacing:-0.03em;line-height:1}
.ua-ct__links{display:flex;flex-wrap:wrap;justify-content:center;gap:2cqw;font-size:clamp(11px,2.2cqw,18px)}
.ua-ct__link{padding:.7em 1.4em;border:1.5px solid currentColor;border-radius:999px;color:inherit;text-decoration:none;font-weight:600}
.ua-ct__link:focus-visible{outline:3px solid var(--ua-accent);outline-offset:3px}
.ua-ct__dot,.ua-ct__ring,.ua-ct__tail{position:absolute;left:0;top:0;border-radius:50%;pointer-events:none;will-change:transform}
.ua-ct__dot{width:8px;height:8px;margin:-4px;background:var(--ua-accent);z-index:3}
.ua-ct__ring{width:40px;height:40px;margin:-20px;border:1.5px solid #fff;mix-blend-mode:difference;z-index:2}
.ua-ct__tail{background:var(--ua-accent);z-index:1}
.ua-ct__wave{position:absolute;width:40px;height:40px;margin:-20px;border:1.5px solid var(--ua-accent);border-radius:50%;pointer-events:none;opacity:0}
.ua-ct__spark{position:absolute;width:0;height:0;pointer-events:none}
.ua-ct__spark b{position:absolute;left:0;top:-1px;width:14px;height:2px;border-radius:1px;background:var(--ua-ink);transform-origin:0 50%}
`;

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-ct', { '--ua-bg': p.background, '--ua-ink': p.ink, '--ua-accent': p.accent });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();

  const title = h('p', { class: 'ua-ct__title', 'data-ua-hover': true, text: 'Move around' });
  const links = h(
    'div',
    { class: 'ua-ct__links' },
    ['作品を見る', 'プロフィール', '連絡する'].map((text) => h('a', { class: 'ua-ct__link', href: '#', 'data-ua-hover': true, text })),
  );
  root.append(title, links);
  disposer.listen(links, 'click', (event) => event.preventDefault());
  if (reduced) return { destroy: () => removeRoot(root) };

  const count = Math.round(p.trail);
  const tails = Array.from({ length: count }, (_, i) => {
    const size = Math.max(3, 16 * (1 - i / (count + 1)));
    return h('i', { class: 'ua-ct__tail', style: { width: `${size}px`, height: `${size}px`, margin: `${-size / 2}px`, opacity: String(0.5 * (1 - i / (count + 1))) } });
  });
  const ring = h('i', { class: 'ua-ct__ring' });
  const dot = h('i', { class: 'ua-ct__dot' });
  root.append(...tails, ring, dot);

  // 後ろの要素ほど追いつくのを遅くして、尾に見せる。
  const followers = [
    createAnimatable(dot, { x: 40, y: 40, ease: 'out(2)' }),
    createAnimatable(ring, { x: 320, y: 320, ease: 'out(4)' }),
    ...tails.map((tail, i) => createAnimatable(tail, { x: 140 + i * 55, y: 140 + i * 55, ease: 'out(3)' })),
  ];
  disposer.add(() => followers.forEach((follower) => follower.revert()));
  // 散っている間は、尾の粒だけ追いかけるのをやめる。
  let scattered = false;
  const moveTo = (x, y) => {
    followers.forEach((follower, i) => {
      if (scattered && i >= 2) return;
      follower.x(x);
      follower.y(y);
    });
  };

  let inside = false;
  disposer.listen(root, 'pointerenter', () => {
    inside = true;
    root.classList.add('is-live');
  });
  disposer.listen(root, 'pointerleave', () => {
    inside = false;
    root.classList.remove('is-live');
  });
  disposer.listen(root, 'pointermove', (event) => {
    const { px, py } = localPointer(event, root);
    last = { x: px, y: py };
    moveTo(px, py);
  });
  // 押すと、輪が縮んで力をため、そこから波紋と火花が出る。尾の粒は花火のように散ってから、カーソルへ吸い戻される。
  let scatterTimer = 0;
  let last = { x: 0, y: 0 };
  const SPARKS = 8;
  function click(px, py) {
    last = { x: px, y: py };
    animate(ring, {
      scale: [
        { to: 0.4, duration: 110, ease: 'outQuad' },
        { to: 1.5, duration: 200, ease: 'outQuart' },
        { to: 1, duration: 700, ease: 'outElastic(1, .4)' },
      ],
    });
    animate(dot, { scale: [{ to: 2.6, duration: 110, ease: 'outQuad' }, { to: 1, duration: 500, ease: 'outBack(3)' }] });
    const waves = [0, 1].map(() => h('i', { class: 'ua-ct__wave', style: { left: `${px}px`, top: `${py}px` } }));
    const turn = Math.random() * Math.PI;
    const sparks = Array.from({ length: SPARKS }, (_, i) => {
      const deg = ((turn + (i / SPARKS) * Math.PI * 2) * 180) / Math.PI;
      return h('i', { class: 'ua-ct__spark', style: { left: `${px}px`, top: `${py}px`, transform: `rotate(${deg}deg)` } }, h('b'));
    });
    root.append(...waves, ...sparks);
    animate(waves, {
      scale: [0.2, (_, i) => 3.2 + i * 2.4],
      opacity: [{ to: 0.9, duration: 60 }, { to: 0, duration: 640, ease: 'outQuad' }],
      duration: 700,
      delay: (_, i) => 110 + i * 150,
      ease: 'outQuart',
      onComplete: () => waves.forEach((wave) => wave.remove()),
    });
    animate(sparks.map((spark) => spark.firstChild), {
      translateX: [{ from: 14, to: () => 46 + Math.random() * 30, duration: 420, ease: 'outQuart' }],
      scaleX: [{ from: 0.2, to: 1, duration: 160, ease: 'outQuad' }, { to: 0, duration: 300, ease: 'inQuad' }],
      delay: (_, i) => 120 + i * 14,
      onComplete: () => sparks.forEach((spark) => spark.remove()),
    });
    // 尾の粒を放射状に飛ばす。追いかける動きをそのまま使うので、手前の粒から順に遅れて散る。
    tails.forEach((_, i) => {
      const angle = turn + (i / Math.max(1, tails.length)) * Math.PI * 2;
      const reach = 54 + (i % 3) * 22;
      const follower = followers[i + 2];
      follower.x(px + Math.cos(angle) * reach);
      follower.y(py + Math.sin(angle) * reach);
    });
    scattered = true;
    clearTimeout(scatterTimer);
    scatterTimer = setTimeout(() => {
      scattered = false;
      tails.forEach((_, i) => {
        followers[i + 2].x(last.x);
        followers[i + 2].y(last.y);
      });
    }, 380);
  }
  disposer.add(() => clearTimeout(scatterTimer));
  disposer.listen(root, 'pointerdown', (event) => {
    const { px, py } = localPointer(event, root);
    click(px, py);
  });
  for (const target of root.querySelectorAll('[data-ua-hover]')) {
    disposer.listen(target, 'pointerenter', () => animate(ring, { scale: 2.3, duration: 380, ease: 'outBack(2)' }));
    disposer.listen(target, 'pointerleave', () => animate(ring, { scale: 1, duration: 380, ease: 'outQuart' }));
  }

  // ポインターが外にある間は、自動で 8 の字に動かして見本にする。
  const started = performance.now();
  const idle = createTimer({
    onUpdate() {
      if (inside) return;
      const t = (performance.now() - started) / 1000;
      const { width, height } = root.getBoundingClientRect();
      moveTo(width * (0.5 + Math.sin(t * 0.9) * 0.34), height * (0.5 + Math.sin(t * 1.8) * 0.26));
    },
  });
  disposer.add(() => idle.pause());
  if (p.preview) {
    disposer.interval(() => {
      if (inside) return;
      const t = (performance.now() - started) / 1000;
      const { width, height } = root.getBoundingClientRect();
      click(width * (0.5 + Math.sin(t * 0.9) * 0.34), height * (0.5 + Math.sin(t * 1.8) * 0.26));
    }, 2600);
  }

  return {
    destroy() {
      disposer.run();
      removeRoot(root);
    },
  };
}
