import { animate, createAnimatable, createSeededRandom } from 'animejs';
import { createRoot, injectStyle, localPointer, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'blob-morph',
  title: '形を変える色のかたまり',
  category: 'background',
  libs: ['animejs'],
  description:
    '3 つのやわらかい形が、輪郭を変えながら重なり合います。重なった部分は色が混ざります。ポインターを動かすと、奥行きがあるように少しずつずれて動きます。SVG だけで描くので WebGL が要りません。',
  params: {
    color1: { type: 'color', label: '色 1', default: '#ff4d8d' },
    color2: { type: 'color', label: '色 2', default: '#ffb400' },
    color3: { type: 'color', label: '色 3', default: '#3ddbd9' },
    background: { type: 'color', label: '背景色', default: '#1b1035' },
    variance: { type: 'range', label: '形の崩れ具合', min: 0.05, max: 0.45, step: 0.01, default: 0.26 },
    speed: { type: 'range', label: '速さ', min: 0.2, max: 3, step: 0.1, default: 1 },
    blur: { type: 'range', label: 'ぼかし（px）', min: 0, max: 40, step: 1, default: 8 },
  },
};

const CSS = `
.ua-bm{position:absolute;inset:0;overflow:hidden;background:var(--ua-bg)}
.ua-bm svg{position:absolute;inset:-6%;width:112%;height:112%}
.ua-bm__layer{mix-blend-mode:screen}
.ua-bm__spin{transform-box:fill-box;transform-origin:center}
`;

const POINTS = 8;
const SHAPES_PER_BLOB = 5;
const fmt = (n) => n.toFixed(1);

// 円周上の点を半径だけ乱して、なめらかな閉じた曲線でつなぐ。
// どの形も同じ数の数値でできた文字列になるので、anime.js が d 属性をそのまま補間できる。
export function blobPath(cx, cy, radius, variance, random) {
  const pts = Array.from({ length: POINTS }, (_, i) => {
    const angle = (i / POINTS) * Math.PI * 2;
    const r = radius * (1 - variance + random() * variance * 2);
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  });
  const at = (i) => pts[(i + POINTS) % POINTS];
  const segments = pts.map((_, i) => {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    return `C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(p2[0])} ${fmt(p2[1])}`;
  });
  return `M${fmt(pts[0][0])} ${fmt(pts[0][1])} ${segments.join(' ')} Z`;
}

const BLOBS = [
  { cx: 300, cy: 260, radius: 210, depth: 26, seed: 11 },
  { cx: 500, cy: 330, radius: 190, depth: -40, seed: 23 },
  { cx: 410, cy: 200, radius: 160, depth: 58, seed: 37 },
];

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-bm', { '--ua-bg': p.background });
  const colors = [p.color1, p.color2, p.color3];
  const reduced = prefersReducedMotion();

  const layers = BLOBS.map((blob, index) => {
    const random = createSeededRandom(blob.seed, 0, 1, 4);
    const shapes = Array.from({ length: SHAPES_PER_BLOB }, () =>
      blobPath(blob.cx, blob.cy, blob.radius, p.variance, () => random()),
    );
    const path = s('path', { d: shapes[0], fill: colors[index] });
    const spin = s('g', { class: 'ua-bm__spin' }, path);
    const layer = s('g', { class: 'ua-bm__layer' }, spin);
    return { blob, shapes, path, spin, layer };
  });
  const svgEl = s(
    'svg',
    { viewBox: '0 0 800 560', preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' },
    layers.map((l) => l.layer),
  );
  svgEl.style.filter = p.blur > 0 ? `blur(${p.blur}px)` : 'none';
  root.appendChild(svgEl);

  const movers = [];
  if (!reduced) {
    layers.forEach(({ shapes, path, spin, layer }, index) => {
      const step = (5200 + index * 900) / p.speed;
      const loopBack = [...shapes.slice(1), shapes[0]];
      animate(path, { d: loopBack.map((to) => ({ to, duration: step, ease: 'inOutSine' })), loop: true });
      animate(spin, { rotate: index % 2 ? -360 : 360, duration: (70000 + index * 20000) / p.speed, ease: 'linear', loop: true });
      movers.push(createAnimatable(layer, { translateX: 900 + index * 200, translateY: 900 + index * 200, ease: 'out(3)' }));
    });
  }

  function onMove(event) {
    const { x, y } = localPointer(event, root);
    movers.forEach((mover, index) => {
      mover.translateX((x - 0.5) * BLOBS[index].depth * 2);
      mover.translateY((y - 0.5) * BLOBS[index].depth * 2);
    });
  }
  function onLeave() {
    for (const mover of movers) {
      mover.translateX(0);
      mover.translateY(0);
    }
  }
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerleave', onLeave);

  return {
    destroy() {
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
      for (const mover of movers) mover.revert();
      removeRoot(root);
    },
  };
}
