import { animate, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'stagger-grid',
  title: '波打つ格子',
  category: 'ui',
  libs: ['animejs'],
  description:
    '格子状の点が、クリックした場所を中心に波のように広がって弾みます。何もしなくても、一定の間隔でどこかから波が起きます。背景や、読み込み完了の合図に使えます。',
  params: {
    cols: { type: 'range', label: '横の個数', min: 6, max: 36, step: 1, default: 20 },
    shape: {
      type: 'select',
      label: '形',
      options: [
        { value: 'dot', label: '丸' },
        { value: 'square', label: '四角' },
      ],
      default: 'dot',
    },
    colorA: { type: 'color', label: 'ふだんの色', default: '#3b3f8f' },
    colorB: { type: 'color', label: '波の色', default: '#ffd166' },
    background: { type: 'color', label: '背景色', default: '#15173a' },
    interval: { type: 'range', label: '自動の波の間隔（秒、0 で止める）', min: 0, max: 8, step: 0.5, default: 2.5 },
  },
};

const CSS = `
.ua-sg{position:absolute;inset:0;display:grid;overflow:hidden;background:var(--ua-bg);cursor:pointer}
.ua-sg__cell{display:grid;place-items:center}
.ua-sg__dot{width:78%;aspect-ratio:1;background:var(--ua-a);transform:scale(.3)}
`;

const REST_SCALE = 0.3;

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-sg', { '--ua-bg': p.background, '--ua-a': p.colorA });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const cols = Math.round(p.cols);
  const radius = p.shape === 'dot' ? '50%' : '12%';
  let rows = 1;
  let dots = [];
  let lastTouch = 0;

  function build() {
    utils.remove(dots);
    const { width, height } = root.getBoundingClientRect();
    rows = Math.max(1, Math.round(height / (Math.max(1, width) / cols)));
    root.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    root.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    dots = Array.from({ length: cols * rows }, () => h('i', { class: 'ua-sg__dot', style: { borderRadius: radius } }));
    root.replaceChildren(...dots.map((dot) => h('div', { class: 'ua-sg__cell' }, dot)));
  }

  function ripple(index) {
    if (reduced || dots.length === 0) return;
    animate(dots, {
      scale: [
        { to: 1, duration: 260, ease: 'outQuad' },
        { to: REST_SCALE, duration: 1300, ease: 'outElastic(1, .4)' },
      ],
      backgroundColor: [
        { to: p.colorB, duration: 260, ease: 'outQuad' },
        { to: p.colorA, duration: 1100, ease: 'inOutQuad' },
      ],
      delay: stagger(42, { grid: [cols, rows], from: index }),
    });
  }

  build();
  let resizeTimer = 0;
  const observer = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(build, 150);
  });
  observer.observe(root);
  disposer.add(() => {
    observer.disconnect();
    clearTimeout(resizeTimer);
  });

  disposer.listen(root, 'click', (event) => {
    const { x, y } = localPointer(event, root);
    const col = Math.min(cols - 1, Math.floor(x * cols));
    const row = Math.min(rows - 1, Math.floor(y * rows));
    lastTouch = performance.now();
    ripple(row * cols + col);
  });
  if (p.interval > 0) {
    disposer.interval(() => {
      if (performance.now() - lastTouch > 2000) ripple(Math.floor(Math.random() * dots.length));
    }, p.interval * 1000);
    disposer.timeout(() => ripple(Math.floor(dots.length / 2 + cols / 2)), 300);
  }

  return {
    ripple,
    destroy() {
      disposer.run();
      removeRoot(root);
    },
  };
}
