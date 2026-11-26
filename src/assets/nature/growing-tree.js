import { animate, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'growing-tree',
  title: '伸びる木',
  category: 'nature',
  libs: ['animejs'],
  description:
    '地面から幹が伸び、枝が線で描かれながら分かれていき、先から順に葉が芽吹きます。枝ぶりは乱数の種から手続きで作るので、種を変えると別の木になります。クリックするたびに春・夏・秋・冬と季節が移り、葉の色と空気が変わります。',
  params: {
    seed: { type: 'range', label: '乱数の種', min: 1, max: 999, step: 1, default: 7 },
    depth: { type: 'range', label: '枝分かれの深さ', min: 4, max: 8, step: 1, default: 7 },
    spread: { type: 'range', label: '枝の広がり', min: 0.5, max: 1.5, step: 0.05, default: 1 },
    season: {
      type: 'select',
      label: '最初の季節',
      options: [
        { value: 'spring', label: '春' },
        { value: 'summer', label: '夏' },
        { value: 'autumn', label: '秋' },
        { value: 'winter', label: '冬' },
      ],
      default: 'spring',
    },
    speed: { type: 'range', label: '伸びる速さ', min: 0.3, max: 3, step: 0.1, default: 1 },
    trunk: { type: 'color', label: '幹の色', default: '#5a3b2c' },
  },
};

const SEASONS = [
  { id: 'spring', name: '春', sub: 'SPRING', bg: '#fdeef2', glow: '#ffd3de', hill: '#f4cdd8', ground: '#cfe3b4', leaves: ['#ffb3c7', '#ff8fb0', '#ffdfe8'], fleck: '#ff9dbb', keep: 1 },
  { id: 'summer', name: '夏', sub: 'SUMMER', bg: '#e2f4ec', glow: '#fff4b5', hill: '#b6dcc2', ground: '#7dbd78', leaves: ['#3fa860', '#6cc36b', '#2c8a57'], fleck: null, keep: 1 },
  { id: 'autumn', name: '秋', sub: 'AUTUMN', bg: '#fbe9d0', glow: '#ffc98a', hill: '#ecc496', ground: '#c79a5d', leaves: ['#e2622b', '#f2a93b', '#b8402a'], fleck: '#e2622b', keep: 0.72 },
  { id: 'winter', name: '冬', sub: 'WINTER', bg: '#b7c7dc', glow: '#e9f1fb', hill: '#a2b4cc', ground: '#f5f9fd', leaves: ['#ffffff', '#ffffff', '#ffffff'], fleck: '#ffffff', keep: 0 },
];

const CSS = `
.ua-gt{position:absolute;inset:0;overflow:hidden;container-type:size;background-color:var(--ua-bg);cursor:pointer;
  font-family:var(--ua-display,system-ui,sans-serif)}
.ua-gt--smooth{transition:background-color 1s}
.ua-gt__svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.ua-gt--smooth .ua-gt__tone{transition:fill 1s,stroke 1s,opacity 1s}
.ua-gt--smooth .ua-gt__leaf{transition:fill .9s}
.ua-gt__branch{fill:none;stroke-linecap:round}
.ua-gt__ring{fill:none;stroke-width:1}
.ua-gt__sway{transform-origin:300px 540px}
.ua-gt--smooth .ua-gt__sway{animation:ua-gt-sway 7s ease-in-out infinite alternate}
@keyframes ua-gt-sway{from{transform:rotate(-.6deg)}to{transform:rotate(.6deg)}}
.ua-gt__label{position:absolute;left:5cqw;bottom:5cqh;display:flex;align-items:baseline;gap:.5em;color:#3b2a22;opacity:.75;pointer-events:none}
.ua-gt__name{font-size:clamp(16px,5cqw,40px);font-weight:700;line-height:1}
.ua-gt__sub{font:600 clamp(8px,1.5cqw,12px)/1 ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.18em}
`;

const BASE = { x: 300, y: 540 };
const LEAF_PATH = 'M0 0C3 -5 9 -6 14 0C9 6 3 5 0 0Z';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 幹から再帰的に枝を分ける。戻り値は枝（曲線）と、葉を付ける位置。
function buildTree(rng, maxDepth, spread) {
  const branches = [];
  const spots = [];
  function grow(x, y, angle, length, depth, width) {
    const ex = x + Math.cos(angle) * length;
    const ey = y + Math.sin(angle) * length;
    const bend = (rng() - 0.5) * length * 0.3;
    const mx = (x + ex) / 2 + Math.cos(angle + Math.PI / 2) * bend;
    const my = (y + ey) / 2 + Math.sin(angle + Math.PI / 2) * bend;
    branches.push({ d: `M${x.toFixed(1)} ${y.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`, depth, width, ex, ey });
    if (depth >= maxDepth) {
      for (let i = 0; i < 3; i += 1) spots.push({ x: ex + (rng() - 0.5) * 22, y: ey + (rng() - 0.5) * 22, depth });
      return;
    }
    if (depth >= maxDepth - 2) spots.push({ x: ex + (rng() - 0.5) * 12, y: ey + (rng() - 0.5) * 12, depth });
    const children = depth > 0 && rng() < 0.2 ? 3 : 2;
    for (let i = 0; i < children; i += 1) {
      const side = i / (children - 1) - 0.5;
      let next = angle + side * spread * (0.8 + rng() * 0.55) + (rng() - 0.5) * 0.25;
      // 枝は少しだけ上へ向き直る。
      next += (-Math.PI / 2 - next) * 0.1;
      grow(ex, ey, next, length * (0.68 + rng() * 0.14), depth + 1, width * 0.7);
    }
  }
  grow(BASE.x, BASE.y, -Math.PI / 2 + (rng() - 0.5) * 0.12, 118, 0, 16);
  return { branches, spots };
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const reduced = prefersReducedMotion();
  const disposer = createDisposer();
  const rng = mulberry32(Math.round(p.seed) * 7919 + 13);
  const maxDepth = Math.round(p.preview ? Math.min(p.depth, 6) : p.depth);
  const { branches, spots } = buildTree(rng, maxDepth, p.spread);
  let seasonIndex = Math.max(0, SEASONS.findIndex((season) => season.id === p.season));

  const root = createRoot(container, 'ua-gt');
  const ms = (value) => value / p.speed;

  // 木が枠に収まるように、根元を基準に全体を縮める。
  const reach = Math.max(...branches.map((b) => Math.abs(b.ex - BASE.x)), 1);
  const rise = Math.max(...branches.map((b) => BASE.y - b.ey), 1);
  const fit = Math.min(1.2, 255 / reach, 450 / rise);

  const glow = s('circle', { class: 'ua-gt__tone', cx: 420, cy: 190, r: 96 });
  const rings = [128, 164, 204].map((r) => s('circle', { class: 'ua-gt__ring ua-gt__tone', cx: 420, cy: 190, r, 'stroke-dasharray': r === 164 ? '2 7' : null }));
  const hill = s('path', { class: 'ua-gt__tone', d: 'M-1500 560L-1500 500Q-400 440 60 492T420 470T900 488T2100 470L2100 560Z' });
  const ground = s('rect', { class: 'ua-gt__tone', x: -1500, y: 538, width: 3600, height: 900 });
  const shadow = s('ellipse', { cx: BASE.x, cy: 541, rx: 120 * fit, ry: 9, fill: '#000000', opacity: 0.12 });
  const grass = Array.from({ length: 26 }, (_, i) => {
    const x = 40 + i * 21 + rng() * 10;
    const tall = 5 + rng() * 9;
    return s('path', { class: 'ua-gt__tone', d: `M${x.toFixed(1)} 539l${(rng() * 4 - 2).toFixed(1)} ${(-tall).toFixed(1)}`, 'stroke-width': 1.4, 'stroke-linecap': 'round', fill: 'none', opacity: 0.55 });
  });

  const branchEls = branches.map((b) =>
    s('path', { class: 'ua-gt__branch', d: b.d, stroke: p.trunk, 'stroke-width': b.width.toFixed(2), pathLength: 1 }),
  );
  const leafLimit = p.preview ? 220 : 520;
  const stride = Math.max(1, Math.ceil(spots.length / leafLimit));
  const leaves = spots
    .filter((_, i) => i % stride === 0)
    .map((spot, i) => {
      const size = 0.8 + rng() * 0.9;
      const path = s('path', { class: 'ua-gt__leaf', d: LEAF_PATH });
      const holder = s('g', { transform: `translate(${spot.x.toFixed(1)} ${spot.y.toFixed(1)}) rotate(${Math.round(rng() * 360)}) scale(${size.toFixed(2)})` }, path);
      return { path, holder, tone: i % 3, chance: rng() };
    });
  const flecks = Array.from({ length: p.preview ? 9 : 16 }, () => s('ellipse', { class: 'ua-gt__tone', rx: 4.5, ry: 2.6, opacity: 0 }));
  const fleckGroup = s('g', { class: 'ua-gt__tone' }, flecks);

  const tree = s(
    'g',
    { class: 'ua-gt__sway' },
    s('g', { transform: `translate(${BASE.x} ${BASE.y}) scale(${fit.toFixed(3)}) translate(${-BASE.x} ${-BASE.y})` }, branchEls, leaves.map((leaf) => leaf.holder)),
  );
  const svg = s('svg', { class: 'ua-gt__svg', viewBox: '0 0 600 600', preserveAspectRatio: 'xMidYMax meet', role: 'img', 'aria-label': '枝を伸ばす木' }, glow, rings, hill, ground, grass, shadow, tree, fleckGroup);
  const name = h('span', { class: 'ua-gt__name' });
  const sub = h('span', { class: 'ua-gt__sub' });
  root.append(svg, h('div', { class: 'ua-gt__label' }, name, sub));

  const leafTarget = (leaf, season) => (leaf.chance < season.keep ? 1 : 0);

  // 季節ごとの色を当てる。withMotion が真なら、葉の出入りを動かす。
  function applySeason(withMotion) {
    const season = SEASONS[seasonIndex];
    root.style.setProperty('--ua-bg', season.bg);
    glow.style.fill = season.glow;
    for (const ring of rings) ring.style.stroke = season.glow;
    hill.style.fill = season.hill;
    ground.style.fill = season.ground;
    for (const blade of grass) blade.style.stroke = season.hill;
    fleckGroup.style.opacity = season.fleck ? '1' : '0';
    if (season.fleck) for (const fleck of flecks) fleck.style.fill = season.fleck;
    name.textContent = season.name;
    sub.textContent = `${season.sub} · SEED ${Math.round(p.seed)}`;
    for (const leaf of leaves) if (season.keep > 0) leaf.path.style.fill = season.leaves[leaf.tone];
    if (!withMotion) {
      for (const leaf of leaves) leaf.path.style.transform = `scale(${leafTarget(leaf, season)})`;
      return;
    }
    animate(
      leaves.map((leaf) => leaf.path),
      {
        scale: (_, i) => leafTarget(leaves[i], season),
        duration: ms(700),
        delay: () => utils.random(0, ms(800)),
        ease: season.keep > 0 ? 'outBack(2.4)' : 'inQuad',
      },
    );
  }

  if (reduced) {
    applySeason(false);
  } else {
    for (const el of branchEls) {
      el.style.strokeDasharray = '1 2';
      el.style.strokeDashoffset = '1.01';
    }
    for (const leaf of leaves) leaf.path.style.transform = 'scale(0)';
    applySeason(false);
    for (const leaf of leaves) leaf.path.style.transform = 'scale(0)';

    // 登場: 幹から枝先へ、深さの順に線が伸びる。伸びきった枝から葉が開く。
    animate(branchEls, {
      strokeDashoffset: [1.01, 0],
      duration: ms(440),
      delay: (_, i) => ms(branches[i].depth * 270),
      ease: 'outQuad',
    });
    animate([glow, ...rings], { opacity: [0, (_, i) => (i === 0 ? 0.7 : 0.55)], duration: ms(1200), delay: stagger(ms(140)), ease: 'outQuad' });
    const season = SEASONS[seasonIndex];
    animate(
      leaves.map((leaf) => leaf.path),
      {
        scale: [0, (_, i) => leafTarget(leaves[i], season)],
        duration: ms(650),
        delay: () => ms(maxDepth * 270 - 250) + utils.random(0, ms(1000)),
        ease: 'outBack(2.4)',
      },
    );
    // 舞い落ちる花びら・落ち葉・雪。色は季節で変わる。
    for (const fleck of flecks) {
      const from = utils.random(20, 580);
      const duration = utils.random(5200, 9000);
      animate(fleck, {
        translateX: [from, from + utils.random(-120, 120)],
        translateY: [utils.random(40, 180), 560],
        rotate: [0, utils.random(-540, 540)],
        opacity: [
          { to: 0.9, duration: 500 },
          { to: 0.9, duration: duration - 1100 },
          { to: 0, duration: 600 },
        ],
        duration,
        delay: utils.random(1800, 7000),
        loop: true,
        ease: 'linear',
      });
    }
    disposer.timeout(() => root.classList.add('ua-gt--smooth'), 60);
  }

  function nextSeason() {
    seasonIndex = (seasonIndex + 1) % SEASONS.length;
    applySeason(!reduced);
  }
  disposer.listen(root, 'click', nextSeason);
  if (p.preview && !reduced) disposer.interval(nextSeason, 4600);

  return {
    nextSeason,
    destroy() {
      disposer.run();
      removeRoot(root);
    },
  };
}
