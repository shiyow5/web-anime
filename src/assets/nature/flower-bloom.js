import { animate, spring, stagger, utils } from 'animejs';
import { createDisposer, createRoot, injectStyle, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'flower-bloom',
  title: '開く花',
  category: 'nature',
  libs: ['animejs'],
  description:
    '茎が伸びて葉が出たあと、花びらが 1 枚ずつ、ばねの動きで弾むように開きます。並んだ花は左から順に咲きます。クリックするといったん閉じて、押した場所に近い花から咲き直します。花の形は 4 種類から選べ、色も変えられます。',
  params: {
    shape: {
      type: 'select',
      label: '花の形',
      options: [
        { value: 'pointed', label: 'とがった花びら' },
        { value: 'round', label: '丸い花びら' },
        { value: 'slender', label: '細い花びら' },
        { value: 'notched', label: '切れ込みのある花びら' },
      ],
      default: 'pointed',
    },
    count: { type: 'range', label: '花の数', min: 1, max: 7, step: 1, default: 5 },
    petal: { type: 'color', label: '花びらの色', default: '#ff7f6e' },
    center: { type: 'color', label: '花の中心の色', default: '#ffd166' },
    stem: { type: 'color', label: '茎と葉の色', default: '#4f9a6a' },
    background: { type: 'color', label: '背景色', default: '#fdf3e3' },
    speed: { type: 'range', label: '咲く速さ', min: 0.3, max: 3, step: 0.1, default: 1 },
  },
};

// 花びらは根元を原点に、上へ長さ 1 で描く。使うときに花の大きさへ拡大する。
const SHAPES = {
  pointed: { count: 8, d: 'M0 0C-0.42 -0.3 -0.3 -0.7 0 -1C0.3 -0.7 0.42 -0.3 0 0Z' },
  round: { count: 6, d: 'M0 0C-0.52 -0.22 -0.56 -0.86 0 -1C0.56 -0.86 0.52 -0.22 0 0Z' },
  slender: { count: 14, d: 'M0 0C-0.16 -0.3 -0.17 -0.8 0 -1C0.17 -0.8 0.16 -0.3 0 0Z' },
  notched: { count: 5, d: 'M0 0C-0.52 -0.3 -0.54 -0.8 -0.14 -1L0 -0.86L0.14 -1C0.54 -0.8 0.52 -0.3 0 0Z' },
};
const HEAD_Y = [262, 176, 300, 150, 236, 196, 282];
const SIZES = [1, 1.2, 0.86, 1.3, 0.96, 1.1, 0.9];
const TINTS = [0, 0.3, -0.5, 0.45, -0.25, 0.15, -0.4];
const LEAF = 'M0 0C8 -15 30 -17 46 -4C30 7 10 8 0 0Z';

const CSS = `
.ua-fb{position:absolute;inset:0;overflow:hidden;background:var(--ua-bg);cursor:pointer}
.ua-fb__svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.ua-fb__stem{fill:none;stroke-linecap:round}
.ua-fb__ring{fill:none;stroke-width:1}
`;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const from = rgb(a);
  const to = rgb(b);
  return `#${from.map((v, i) => Math.round(v + (to[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-fb', { '--ua-bg': p.background });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const shape = SHAPES[p.shape];
  const count = Math.round(p.count);
  const ms = (value) => value / p.speed;
  const deep = mix(p.petal, '#3a1038', 0.55);
  const moving = [];

  // 背景: 淡い日の輪、遠い丘、地面。
  const backdrop = [
    s('circle', { cx: 590, cy: 190, r: 150, fill: mix(p.background, '#ffffff', 0.7) }),
    s('circle', { class: 'ua-fb__ring', cx: 590, cy: 190, r: 186, stroke: mix(p.background, p.petal, 0.3) }),
    s('circle', { class: 'ua-fb__ring', cx: 590, cy: 190, r: 228, stroke: mix(p.background, p.petal, 0.22), 'stroke-dasharray': '2 8' }),
    s('path', { d: 'M-1500 620L-1500 520Q-300 470 160 512T520 500T900 516T2300 500L2300 620Z', fill: mix(p.background, p.stem, 0.22) }),
    s('rect', { x: -1500, y: 572, width: 3800, height: 800, fill: mix(p.background, p.stem, 0.45) }),
  ];
  const pollen = Array.from({ length: p.preview ? 8 : 16 }, (_, i) =>
    s('circle', { cx: 60 + ((i * 137) % 680), cy: 120 + ((i * 89) % 380), r: 1.6 + (i % 3) * 0.8, fill: mix(p.center, '#ffffff', 0.3), opacity: reduced ? 0.6 : 0 }),
  );

  const gap = count > 1 ? Math.min(138, 580 / (count - 1)) : 0;
  const flowers = Array.from({ length: count }, (_, i) => {
    const baseX = 400 + (i - (count - 1) / 2) * gap;
    const size = SIZES[i % SIZES.length];
    const headY = HEAD_Y[i % HEAD_Y.length];
    const headX = baseX + (i % 2 === 0 ? 14 : -16);
    const bendX = baseX + (i % 2 === 0 ? -26 : 24);
    const reach = 60 * size * (count > 5 ? 0.85 : 1);
    const tint = TINTS[i % TINTS.length];
    const color = tint >= 0 ? mix(p.petal, '#ffffff', tint) : mix(p.petal, deep, -tint);

    const stem = s('path', { class: 'ua-fb__stem', d: `M${baseX} 600Q${bendX} ${(600 + headY) / 2} ${headX} ${headY}`, stroke: p.stem, 'stroke-width': 5 * size, pathLength: 1 });
    // 茎の途中に、左右 1 枚ずつ葉を付ける。
    const leaves = [0.32, 0.52].map((t, k) => {
      const u = 1 - t;
      const x = u * u * baseX + 2 * u * t * bendX + t * t * headX;
      const y = u * u * 600 + 2 * u * t * ((600 + headY) / 2) + t * t * headY;
      const side = k === 0 ? 1 : -1;
      const leaf = s('path', { d: LEAF, fill: mix(p.stem, k === 0 ? '#ffffff' : '#0c2f24', 0.18) });
      return { leaf, holder: s('g', { transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${side > 0 ? -28 : 208}) scale(${(size * 1.05).toFixed(2)} ${(side * size * 1.05).toFixed(2)})` }, leaf) };
    });

    const ring = (scale, fill, offset) =>
      Array.from({ length: shape.count }, (_, k) => {
        const petal = s(
          'g',
          {},
          s('path', { d: shape.d, fill, stroke: mix(fill, deep, 0.4), 'stroke-width': 0.014 }),
          s('path', { d: 'M0 -0.16L0 -0.66', stroke: mix(fill, '#ffffff', 0.55), 'stroke-width': 0.02, 'stroke-linecap': 'round', fill: 'none', opacity: 0.6 }),
        );
        const angle = ((k + offset) / shape.count) * 360;
        return { petal, holder: s('g', { transform: `rotate(${angle.toFixed(1)}) scale(${(reach * scale).toFixed(1)})` }, petal) };
      });
    const outer = ring(1, mix(color, deep, 0.14), 0);
    const inner = ring(0.64, mix(color, '#ffffff', 0.32), 0.5);
    const heart = s(
      'g',
      {},
      s('circle', { r: reach * 0.2, fill: p.center }),
      Array.from({ length: 9 }, (_, k) => {
        const a = (k / 9) * Math.PI * 2;
        return s('circle', { cx: (Math.cos(a) * reach * 0.25).toFixed(1), cy: (Math.sin(a) * reach * 0.25).toFixed(1), r: reach * 0.035, fill: mix(p.center, '#7a4a12', 0.45) });
      }),
      s('circle', { r: reach * 0.09, fill: mix(p.center, '#ffffff', 0.5) }),
    );
    const head = s('g', { transform: `translate(${headX} ${headY})` }, outer.map((o) => o.holder), inner.map((o) => o.holder), heart);
    const group = s('g', { style: { transformOrigin: `${baseX}px 600px` } }, stem, leaves.map((l) => l.holder), head);
    return { group, stem, head, heart, leaves: leaves.map((l) => l.leaf), outer: outer.map((o) => o.petal), inner: inner.map((o) => o.petal), index: i };
  });

  const svg = s(
    'svg',
    { class: 'ua-fb__svg', viewBox: '0 0 800 600', preserveAspectRatio: 'xMidYMax meet', role: 'img', 'aria-label': '順に開く花' },
    backdrop,
    pollen,
    flowers.map((flower) => flower.group),
  );
  root.appendChild(svg);

  const partsOf = (flower) => [...flower.outer, ...flower.inner, flower.heart];

  // 1 輪を咲かせる。外側の花びらから 1 枚ずつ、ばねで開く。
  function bloom(flower, delay) {
    const ease = spring({ stiffness: 130, damping: 9 });
    animate(flower.heart, { scale: [0, 1], duration: ms(500), delay, ease: 'outBack(2.5)' });
    animate(flower.outer, { scale: [0, 1], rotate: [-50, 0], delay: stagger(ms(42), { start: delay + ms(80) }), ease });
    animate(flower.inner, { scale: [0, 1], rotate: [60, 0], delay: stagger(ms(42), { start: delay + ms(300) }), ease });
  }

  // 押した場所に近い花から、閉じて咲き直す。
  function rebloom(event) {
    if (reduced) return;
    const at = event && Number.isFinite(event.clientX) ? { x: event.clientX, y: event.clientY } : null;
    const order = flowers
      .map((flower) => {
        const rect = flower.head.getBoundingClientRect();
        const distance = at ? Math.hypot(rect.left + rect.width / 2 - at.x, rect.top + rect.height / 2 - at.y) : flower.index;
        return { flower, distance };
      })
      .sort((a, b) => a.distance - b.distance);
    order.forEach(({ flower }, rank) => {
      animate(partsOf(flower), { scale: 0, duration: 220, ease: 'inQuad' });
      disposer.timeout(() => bloom(flower, 0), 240 + ms(rank * 230));
    });
  }

  if (!reduced) {
    for (const flower of flowers) {
      flower.stem.style.strokeDasharray = '1 2';
      flower.stem.style.strokeDashoffset = '1.01';
      for (const part of [...partsOf(flower), ...flower.leaves]) part.style.transform = 'scale(0)';
      moving.push(flower.group, flower.stem, ...flower.leaves, ...partsOf(flower));
      // 登場: 茎が伸び、葉が出て、花が左から順に開く。
      const at = ms(flower.index * 110);
      animate(flower.stem, { strokeDashoffset: [1.01, 0], duration: ms(750), delay: at, ease: 'outCubic' });
      animate(flower.leaves, { scale: [0, 1], duration: ms(600), delay: stagger(ms(130), { start: at + ms(330) }), ease: 'outBack(2)' });
      bloom(flower, ms(700 + flower.index * 300));
      animate(flower.group, { rotate: [-1.4, 1.4], duration: 2800 + flower.index * 420, loop: true, alternate: true, ease: 'inOutSine' });
    }
    // 花粉がゆっくり立ちのぼる。
    for (const dot of pollen) {
      const duration = utils.random(5000, 9000);
      animate(dot, {
        translateY: [30, -utils.random(60, 140)],
        translateX: [0, utils.random(-40, 40)],
        opacity: [
          { to: 0.75, duration: duration * 0.3 },
          { to: 0.75, duration: duration * 0.4 },
          { to: 0, duration: duration * 0.3 },
        ],
        duration,
        delay: utils.random(0, 3000),
        loop: true,
        ease: 'linear',
      });
    }
    moving.push(...pollen);
    disposer.listen(root, 'click', rebloom);
    if (p.preview) disposer.interval(() => rebloom(), 7000);
  }

  return {
    rebloom: () => rebloom(),
    destroy() {
      disposer.run();
      utils.remove(moving);
      removeRoot(root);
    },
  };
}
