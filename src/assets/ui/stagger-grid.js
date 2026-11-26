import { animate, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'stagger-grid',
  title: '波打つ格子',
  category: 'ui',
  libs: ['animejs'],
  description:
    '格子状の点をクリックすると、まわりの点がその場所へ一度吸い寄せられてから、波に押し出されて外へ広がり、弱い 2 つ目の波が追いかけてから揺れて戻ります。何もしなくても、一定の間隔でどこかから波が起きます。背景や、読み込み完了の合図に使えます。',
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
  const mixed = `color-mix(in srgb, ${p.colorB} 55%, ${p.colorA})`;

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
    const from = utils.clamp(Math.round(Number(index) || 0), 0, dots.length - 1);
    const fromCol = from % cols;
    const fromRow = Math.floor(from / cols);
    const cell = (root.getBoundingClientRect().width || 0) / cols;
    // 震源から見た向きと、遠いほど弱くなる押し出しの量を、点ごとに求める。
    const push = dots.map((_, i) => {
      const dx = (i % cols) - fromCol;
      const dy = Math.floor(i / cols) - fromRow;
      const dist = Math.hypot(dx, dy);
      const power = cell * 0.62 * Math.exp(-dist / 7);
      return dist === 0 ? { x: 0, y: 0, dist } : { x: (dx / dist) * power, y: (dy / dist) * power, dist };
    });
    utils.remove(dots);
    animate(dots, {
      // 波が届く直前に震源のほうへ吸い寄せられ、波に押し出されて、揺れながら戻る。
      x: [
        { to: (_, i) => -push[i].x * 0.45, duration: 170, ease: 'outQuad' },
        { to: (_, i) => push[i].x, duration: 230, ease: 'outQuart' },
        { to: 0, duration: 1300, ease: 'outElastic(1, .35)' },
      ],
      y: [
        { to: (_, i) => -push[i].y * 0.45, duration: 170, ease: 'outQuad' },
        { to: (_, i) => push[i].y, duration: 230, ease: 'outQuart' },
        { to: 0, duration: 1300, ease: 'outElastic(1, .35)' },
      ],
      scale: [
        { to: 0.12, duration: 170, ease: 'outQuad' },
        { to: (_, i) => 0.7 + 0.55 * Math.exp(-push[i].dist / 9), duration: 230, ease: 'outQuart' },
        { to: REST_SCALE, duration: 420, ease: 'outQuad' },
        // 余韻。弱い 2 つ目の波が追いかけてくる。
        { to: 0.58, duration: 200, ease: 'outQuad' },
        { to: REST_SCALE, duration: 900, ease: 'outElastic(1, .4)' },
      ],
      backgroundColor: [
        { to: p.colorA, duration: 170 },
        { to: p.colorB, duration: 230, ease: 'outQuad' },
        { to: p.colorA, duration: 420, ease: 'inOutQuad' },
        { to: mixed, duration: 200, ease: 'outQuad' },
        { to: p.colorA, duration: 700, ease: 'inOutQuad' },
      ],
      delay: stagger(40, { grid: [cols, rows], from }),
    });
    // 震源の点だけは、押した手応えとして先に大きく光らせる。
    animate(dots[from], { scale: [{ to: 1.5, duration: 120, ease: 'outQuad' }, { to: REST_SCALE, duration: 900, ease: 'outElastic(1, .4)' }], backgroundColor: [{ to: p.colorB, duration: 120 }, { to: p.colorA, duration: 900 }] });
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
