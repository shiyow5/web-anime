import { animate, createAnimatable, createTimer } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'cursor-trail',
  title: '尾を引くカーソル',
  category: 'ui',
  libs: ['animejs'],
  description:
    '標準のカーソルの代わりに、点と輪、そのあとを追う尾を表示します。data-ua-hover を付けた要素に乗ると輪が広がり、押すと縮んで弾みます。ポートフォリオなど、演出を前に出したいサイトに向いています。',
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
  const moveTo = (x, y) => {
    for (const follower of followers) {
      follower.x(x);
      follower.y(y);
    }
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
    moveTo(px, py);
  });
  disposer.listen(root, 'pointerdown', () => {
    animate(ring, {
      scale: [
        { to: 0.55, duration: 110, ease: 'outQuad' },
        { to: 1, duration: 650, ease: 'outElastic(1, .4)' },
      ],
    });
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

  return {
    destroy() {
      disposer.run();
      removeRoot(root);
    },
  };
}
