import { animate, createDrawable, createTimer, spring, stagger, utils } from 'animejs';
import { createDisposer, createRoot, injectStyle, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'cotton-clouds',
  title: 'わたあめの雲',
  category: 'fancy',
  libs: ['animejs'],
  description:
    'ふわふわの雲が、奥・中・手前の 3 つの層で速さを変えて流れ、そのあいだに虹が 1 色ずつ線で描かれて架かります。クリックすると、いちばん近い雲がぎゅっとしぼられてからふくらみ、色とりどりの雨つぶを降らせます。まわりの雲は近い順に揺れ、雨が上がると虹が 1 色ずつ架かり直します。空の色は朝・昼・夕方・ミントから選べます。天気の案内、子ども向けのページ、やさしい見出しの背景に使えます。',
  params: {
    sky: {
      type: 'select',
      label: '空の色',
      default: 'noon',
      options: [
        { value: 'morning', label: '朝（もも色）' },
        { value: 'noon', label: '昼（水色）' },
        { value: 'evening', label: '夕方（すみれ色）' },
        { value: 'mint', label: 'ミント' },
      ],
    },
    tint: { type: 'color', label: '雲の影の色', default: '#ffd3e8' },
    count: { type: 'range', label: '雲の数', min: 4, max: 14, step: 1, default: 9 },
    speed: { type: 'range', label: '流れる速さ', min: 0, max: 3, step: 0.1, default: 1 },
    rainbow: { type: 'boolean', label: '虹を架ける', default: true },
  },
};

const SKIES = {
  morning: ['#ffc2d4', '#ffe9c9'],
  noon: ['#86cdfb', '#e2f5ff'],
  evening: ['#a99be8', '#ffcbb0'],
  mint: ['#9fe6d2', '#f3ffe9'],
};
const BANDS = ['#ff9aa8', '#ffbf8a', '#ffe78a', '#a8e6b0', '#93cdfa', '#c4a9f5'];

const CSS = `
.ua-cc{position:absolute;inset:0;overflow:hidden;cursor:pointer;background:var(--ua-top)}
.ua-cc svg{width:100%;height:100%;display:block}
.ua-cc__c{transform-box:fill-box;transform-origin:center}
.ua-cc__band{fill:none;stroke-width:15;stroke-linecap:round}
.ua-cc__glow{fill:none;stroke:#fff;stroke-width:108;opacity:.16}
.ua-cc__star{fill:#fff}
.ua-cc__drop{opacity:0;pointer-events:none}
`;

const W = 800;
const H = 600;
const SPARKLE = 'M0,-1 Q0.16,-0.16 1,0 Q0.16,0.16 0,1 Q-0.16,0.16 -1,0 Q-0.16,-0.16 0,-1Z';
// 雲 1 つぶんの丸の並び。[x, y, 半径]
const PUFFS = [[-56, 2, 28], [-22, -20, 36], [20, -28, 42], [58, -6, 32], [-4, 6, 38], [32, 8, 34], [-36, 10, 26], [70, 12, 20], [-74, 12, 18]];
// 層ごとの [大きさ, 速さ, 濃さ, 縦の位置の範囲]
const LAYERS = [
  { scale: 0.5, speed: 7, opacity: 0.62, top: 70, bottom: 300 },
  { scale: 0.85, speed: 15, opacity: 0.85, top: 110, bottom: 420 },
  { scale: 1.3, speed: 27, opacity: 1, top: 380, bottom: 560 },
];
const STARS = [[90, 80, 9], [250, 150, 6], [540, 70, 10], [700, 190, 7], [400, 40, 5], [150, 260, 5], [640, 330, 6], [330, 250, 4]];
let uid = 0;

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const [top, bottom] = SKIES[p.sky];
  const root = createRoot(container, 'ua-cc', { '--ua-top': top });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const id = `ua-cc-${(uid += 1)}`;
  const count = Math.round(p.preview ? Math.min(p.count, 8) : p.count);

  const defs = s(
    'defs',
    {},
    s('linearGradient', { id: `${id}-sky`, x1: 0, y1: 0, x2: 0, y2: 1 }, s('stop', { offset: 0, 'stop-color': top }), s('stop', { offset: 1, 'stop-color': bottom })),
    s('linearGradient', { id: `${id}-puff`, x1: 0, y1: 0, x2: 0.25, y2: 1 }, s('stop', { offset: 0.35, 'stop-color': '#ffffff' }), s('stop', { offset: 1, 'stop-color': p.tint })),
    s('radialGradient', { id: `${id}-sun`, cx: 0.5, cy: 0.5, r: 0.5 }, s('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': 0.75 }), s('stop', { offset: 1, 'stop-color': '#fff', 'stop-opacity': 0 })),
  );

  function makeCloud(scale, opacity) {
    const inner = s('g', { class: 'ua-cc__c' }, s('rect', { x: -78, y: 6, width: 156, height: 28, rx: 14, fill: p.tint }), PUFFS.map(([x, y, r]) => s('circle', { cx: x, cy: y, r, fill: `url(#${id}-puff)` })));
    const outer = s('g', { opacity }, s('g', { transform: `scale(${scale})` }, inner));
    return { outer, inner };
  }

  // 雲を 3 つの層に振り分ける。手前の層は大きく、速く流れる。
  const clouds = Array.from({ length: count }, (_, i) => {
    const layerIndex = i % 3;
    const layer = LAYERS[layerIndex];
    const k = Math.floor(i / 3);
    const scale = layer.scale * (0.85 + ((i * 5) % 4) * 0.1);
    const cloud = makeCloud(scale, layer.opacity);
    return {
      ...cloud,
      layerIndex,
      speed: layer.speed * (0.85 + ((i * 3) % 5) * 0.08),
      span: 100 * scale,
      x: ((i * 0.381 + layerIndex * 0.17) % 1) * (W + 200) - 100,
      y: layer.top + (((k * 0.47 + layerIndex * 0.3) % 1) * (layer.bottom - layer.top)),
    };
  });
  const layerGroups = LAYERS.map((_, index) => s('g', {}, clouds.filter((c) => c.layerIndex === index).map((c) => c.outer)));
  const place = (c) => c.outer.setAttribute('transform', `translate(${c.x.toFixed(1)} ${c.y.toFixed(1)})`);
  clouds.forEach(place);

  const CX = 400;
  const CY = 560;
  const arcs = p.rainbow
    ? BANDS.map((color, i) => {
        const r = 330 - i * 15;
        return s('path', { class: 'ua-cc__band', stroke: color, d: `M${CX - r} ${CY} A${r} ${r} 0 0 1 ${CX + r} ${CY}` });
      })
    : [];
  const glow = p.rainbow ? s('path', { class: 'ua-cc__glow', d: `M${CX - 292} ${CY} A292 292 0 0 1 ${CX + 292} ${CY}` }) : null;
  const rainbow = s('g', {}, glow, arcs);
  // 虹の両端を隠す、動かない雲。
  const anchors = [[110, 540, 1.35], [690, 546, 1.45]].map(([x, y, scale]) => {
    const cloud = makeCloud(scale, 1);
    cloud.outer.setAttribute('transform', `translate(${x} ${y})`);
    return cloud;
  });
  const stars = STARS.map(([x, y, size]) => s('g', { transform: `translate(${x} ${y})` }, s('path', { class: 'ua-cc__star ua-cc__c', d: SPARKLE, transform: `scale(${size})` })));
  const sun = s('circle', { cx: 610, cy: 130, r: 190, fill: `url(#${id}-sun)` });

  const svg = s(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid slice', role: 'img', 'aria-label': '雲と虹' },
    defs,
    s('rect', { width: W, height: H, fill: `url(#${id}-sky)` }),
    sun,
    stars,
    layerGroups[0],
    rainbow,
    layerGroups[1],
    anchors.map((a) => a.outer),
    layerGroups[2],
  );
  const rainLayer = s('g', {});
  svg.insertBefore(rainLayer, layerGroups[2]);
  root.appendChild(svg);

  if (reduced) return { destroy: () => removeRoot(root) };

  const inners = [...clouds, ...anchors].map((c) => c.inner);
  const drawables = arcs.length ? createDrawable(arcs) : [];

  function drawRainbow() {
    if (!arcs.length) return;
    animate(drawables, { draw: ['0 0', '0 1'], duration: 1500, ease: 'inOutQuart', delay: stagger(110) });
    animate(glow, { opacity: [0, 0.16], duration: 1800, delay: 500, ease: 'outQuad' });
  }

  const DROP = 'M0,-9 C4,-2 5,2 5,5 A5,5 0 0 1 -5,5 C-5,2 -4,-2 0,-9Z';
  let rainbowTimer = 0;
  disposer.add(() => clearTimeout(rainbowTimer));

  // 雲をしぼる。準備で縮み、ふくらんで雨を落とし、雨が上がってから虹を描き直す。
  function puff(event) {
    let px = NaN;
    let py = NaN;
    const matrix = event?.clientX === undefined ? null : svg.getScreenCTM?.();
    if (matrix) {
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      px = point.x;
      py = point.y;
    }
    const onScreen = clouds.filter((c) => c.x > 80 && c.x < W - 80 && c.y < 440);
    const pool = onScreen.length ? onScreen : clouds;
    let main = pool[Math.floor(Math.random() * pool.length)];
    if (Number.isFinite(px)) {
      main = clouds.reduce((best, c) => (Math.hypot(c.x - px, c.y - py) < Math.hypot(best.x - px, best.y - py) ? c : best), clouds[0]);
    } else {
      px = main.x;
      py = main.y;
    }

    utils.remove(inners);
    utils.set(main.inner, { scale: 1 });
    animate(main.inner, {
      scaleX: [
        { to: 1.18, duration: 170, ease: 'outQuad' },
        { to: 0.92, duration: 150, ease: 'outQuad' },
        { to: 1, ease: spring({ stiffness: 170, damping: 6 }) },
      ],
      scaleY: [
        { to: 0.66, duration: 170, ease: 'outQuad' },
        { to: 1.24, duration: 150, ease: 'outQuad' },
        { to: 1, ease: spring({ stiffness: 200, damping: 7 }) },
      ],
    });
    // ほかの雲は、近いものから順に小さく揺れる。
    for (const c of [...clouds, ...anchors]) {
      if (c === main) continue;
      const d = c.x === undefined ? 520 : Math.hypot(c.x - px, c.y - py);
      animate(c.inner, {
        scale: [
          { to: 1 + 0.16 * Math.max(0.25, 1 - d / 700), duration: 180, ease: 'outQuad' },
          { to: 1, ease: spring({ stiffness: 160, damping: 7 }) },
        ],
        delay: 240 + d * 0.9,
      });
    }

    if (rainLayer.childElementCount < 4) {
      const width = main.span * 1.25;
      const fall = Math.max(120, H - main.y - 10);
      const drops = Array.from({ length: p.preview ? 10 : 16 }, (_, i) =>
        s('path', { class: 'ua-cc__drop', d: DROP, fill: BANDS[i % BANDS.length] }),
      );
      const size = Math.min(1.4, main.span / 70);
      // 位置と大きさは外側の g の属性に持たせ、内側の雨つぶだけを動かす。
      const holders = drops.map((drop, i) => s('g', { transform: `translate(${((((i * 0.618) % 1) - 0.5) * width).toFixed(1)} 0) scale(${((0.7 + (i % 3) * 0.25) * size).toFixed(2)})` }, drop));
      const group = s('g', { transform: `translate(${main.x.toFixed(1)} ${(main.y + main.span * 0.3).toFixed(1)})` }, holders);
      rainLayer.appendChild(group);
      animate(drops, {
        translateY: { from: 0, to: () => (fall * utils.random(0.75, 1)) / size, ease: 'inQuad' },
        opacity: [
          { from: 0, to: 1, duration: 120 },
          { to: 1, duration: 520 },
          { to: 0, duration: 260 },
        ],
        duration: 900,
        delay: stagger(55, { start: 330, from: 'random' }),
        onComplete: () => group.remove(),
      });
    }

    if (arcs.length) {
      animate(rainbow, { opacity: 0, duration: 300, ease: 'outQuad' });
      clearTimeout(rainbowTimer);
      rainbowTimer = setTimeout(() => {
        utils.remove(rainbow);
        rainbow.style.opacity = '';
        drawRainbow();
      }, 1250);
    }
  }

  animate(inners, { scale: [0, 1], delay: stagger(70, { start: 100 }), ease: spring({ stiffness: 120, damping: 9 }) });
  if (arcs.length) {
    for (const arc of arcs) arc.style.opacity = '0';
    disposer.timeout(() => {
      for (const arc of arcs) arc.style.opacity = '';
      drawRainbow();
    }, 700);
  }
  animate(stars.map((g) => g.firstChild), {
    scale: [1, 0.35],
    rotate: [0, 45],
    duration: () => utils.random(700, 1300),
    delay: stagger(230),
    loopDelay: () => utils.random(300, 1500),
    ease: 'inOutSine',
    alternate: true,
    loop: true,
  });

  // 雲を流す。経過時間は performance.now() で測る。ポインターの位置で層ごとにずらす。
  const target = { x: 0, y: 0 };
  const now = { x: 0, y: 0 };
  let last = performance.now();
  let t = 0;
  const timer = createTimer({
    onUpdate() {
      const current = performance.now();
      const dt = Math.min(0.05, (current - last) / 1000);
      last = current;
      t += dt;
      for (const c of clouds) {
        c.x += c.speed * p.speed * dt;
        if (c.x > W + c.span + 20) c.x = -c.span - 20;
        c.outer.setAttribute('transform', `translate(${c.x.toFixed(1)} ${(c.y + Math.sin(t * 0.6 + c.speed) * 4).toFixed(1)})`);
      }
      now.x += (target.x - now.x) * 0.05;
      now.y += (target.y - now.y) * 0.05;
      layerGroups.forEach((group, index) => {
        const depth = [6, 14, 30][index];
        group.setAttribute('transform', `translate(${(-now.x * depth).toFixed(2)} ${(-now.y * depth * 0.6).toFixed(2)})`);
      });
      rainbow.setAttribute('transform', `translate(${(-now.x * 10).toFixed(2)} ${(-now.y * 6).toFixed(2)})`);
    },
  });
  disposer.add(() => timer.pause());

  disposer.listen(root, 'pointermove', (event) => {
    const rect = root.getBoundingClientRect();
    target.x = (event.clientX - rect.left) / rect.width - 0.5;
    target.y = (event.clientY - rect.top) / rect.height - 0.5;
  });
  disposer.listen(root, 'pointerleave', () => {
    target.x = 0;
    target.y = 0;
  });
  disposer.listen(root, 'click', puff);
  if (p.preview) disposer.interval(() => puff(), 5200);

  return {
    puff,
    destroy() {
      disposer.run();
      removeRoot(root);
    },
  };
}
