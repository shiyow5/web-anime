import { animate, createAnimatable, createSeededRandom, utils } from 'animejs';
import { createRoot, injectStyle, localPointer, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'blob-morph',
  title: '形を変える色のかたまり',
  category: 'background',
  libs: ['animejs'],
  description:
    '3 つのやわらかい形が、輪郭を変えながら重なり合います。重なった部分は色が混ざります。ポインターを動かすと、奥行きがあるように少しずつずれて動きます。タップすると、3 つの形がその場所へ吸い寄せられて 1 つに溶け合い、しずくを飛ばしながら弾けて色を入れ替え、ゆれながら元の場所へ戻ります。SVG だけで描くので WebGL が要りません。',
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
.ua-bm__spin,.ua-bm__pop{transform-box:fill-box;transform-origin:center}
.ua-bm__drops{mix-blend-mode:screen}
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
    const path = s('path', { d: shapes[0] });
    const spin = s('g', { class: 'ua-bm__spin' }, path);
    // タップしたときの寄せ・伸び縮み・色の入れ替えは、この入れ物にかける。
    const pop = s('g', { class: 'ua-bm__pop', fill: colors[index] }, spin);
    const layer = s('g', { class: 'ua-bm__layer' }, pop);
    return { blob, shapes, path, spin, pop, layer, colorIndex: index };
  });
  const svgEl = s(
    'svg',
    { viewBox: '0 0 800 560', preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' },
    layers.map((l) => l.layer),
  );
  const dropLayer = s('g', { class: 'ua-bm__drops' });
  svgEl.appendChild(dropLayer);
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
  // タップした場所を、SVG の中の座標に直す。
  function toSvgPoint(event) {
    const rect = svgEl.getBoundingClientRect();
    if (typeof event?.clientX !== 'number' || !rect.width || !rect.height) return { x: 250 + Math.random() * 300, y: 180 + Math.random() * 200 };
    // preserveAspectRatio が slice なので、枠を覆う側の倍率で割る。
    const scale = Math.max(rect.width / 800, rect.height / 560);
    return {
      x: 400 + (event.clientX - rect.left - rect.width / 2) / scale,
      y: 280 + (event.clientY - rect.top - rect.height / 2) / scale,
    };
  }

  let drops = [];
  function clearDrops() {
    utils.remove(drops);
    for (const drop of drops) drop.remove();
    drops = [];
  }

  // 準備: 3 つの形がタップした場所へ吸い寄せられて縮み、1 つに溶け合う。
  // 山場: しずくを飛ばしながら弾けて、色が隣へ入れ替わる。余韻: しずくが吸い込まれ、形がゆれながら戻る。
  function merge(event) {
    if (reduced) return;
    const point = toSvgPoint(event);
    clearDrops();
    layers.forEach((item, index) => {
      const { blob, pop } = item;
      const dx = point.x - blob.cx;
      const dy = point.y - blob.cy;
      const distance = Math.hypot(dx, dy) || 1;
      const wait = index * 70;
      item.colorIndex = (item.colorIndex + 1) % colors.length;
      utils.remove(pop);
      animate(pop, {
        translateX: [
          { to: dx * 0.72, duration: 420, ease: 'inOutCubic' },
          { to: (-dx / distance) * 46, duration: 300, ease: 'outExpo' },
          { to: 0, duration: 1500, ease: 'outElastic(1, .5)' },
        ],
        translateY: [
          { to: dy * 0.72, duration: 420, ease: 'inOutCubic' },
          { to: (-dy / distance) * 46, duration: 300, ease: 'outExpo' },
          { to: 0, duration: 1500, ease: 'outElastic(1, .5)' },
        ],
        scale: [
          { to: 0.62, duration: 420, ease: 'inOutCubic' },
          { to: 1.2, duration: 300, ease: 'outExpo' },
          { to: 1, duration: 1500, ease: 'outElastic(1, .4)' },
        ],
        delay: wait,
      });
      animate(pop, { fill: colors[item.colorIndex], duration: 520, delay: 420 + wait, ease: 'outQuad' });

      // 形ごとに 3 つのしずくを、タップした場所から飛ばす。
      for (let k = 0; k < 3; k += 1) {
        const angle = (index * 3 + k) * ((Math.PI * 2) / 9) + Math.random() * 0.5;
        const reach = 150 + Math.random() * 130;
        const drop = s('circle', { cx: 0, cy: 0, r: 14 + Math.random() * 16, fill: colors[item.colorIndex] });
        dropLayer.appendChild(drop);
        drops.push(drop);
        utils.set(drop, { translateX: point.x, translateY: point.y, scale: 0 });
        animate(drop, {
          translateX: [
            { to: point.x + Math.cos(angle) * reach, duration: 620, ease: 'outExpo' },
            { to: blob.cx, duration: 900, ease: 'inOutCubic' },
          ],
          translateY: [
            { to: point.y + Math.sin(angle) * reach, duration: 620, ease: 'outExpo' },
            { to: blob.cy, duration: 900, ease: 'inOutCubic' },
          ],
          scale: [
            { to: 1, duration: 300, ease: 'outBack(2)' },
            { to: 1, duration: 520 },
            { to: 0, duration: 700, ease: 'inQuad' },
          ],
          delay: 440 + wait + k * 60,
          onComplete() {
            drop.remove();
            drops = drops.filter((other) => other !== drop);
          },
        });
      }
    });
  }
  root.addEventListener('pointerdown', merge);
  const auto = p.preview && !reduced ? setInterval(merge, 5200) : 0;

  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerleave', onLeave);

  return {
    merge,
    destroy() {
      clearInterval(auto);
      root.removeEventListener('pointerdown', merge);
      clearDrops();
      utils.remove(layers.map((item) => item.pop));
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
      for (const mover of movers) mover.revert();
      removeRoot(root);
    },
  };
}
