import { animate, createDrawable, createSeededRandom, createTimeline, createTimer, stagger, utils } from 'animejs';
import { createDisposer, createRoot, injectStyle, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'star-twinkle',
  title: 'またたく星空',
  category: 'fancy',
  libs: ['animejs'],
  description:
    'パステルの夜空に、大小の星が左から順にまたたきます。いくつかの星は線で結ばれて星座になり、ときどき流れ星が弧を描いて落ちます。クリックした場所からも流れ星が出ます。寝かしつけの絵本、夜のイベントの告知、やさしい雰囲気の背景に使えます。',
  params: {
    skyTop: { type: 'color', label: '空の上の色', default: '#4b3f8f' },
    skyBottom: { type: 'color', label: '空の下の色', default: '#f3a9c4' },
    star: { type: 'color', label: '星の色', default: '#fff4c2' },
    count: { type: 'range', label: '星の数', min: 20, max: 140, step: 5, default: 80 },
    interval: { type: 'range', label: '流れ星の間隔（秒）', min: 1, max: 10, step: 0.5, default: 3 },
    constellations: { type: 'boolean', label: '星座を結ぶ', default: true },
    seed: { type: 'range', label: '星の並びの種', min: 1, max: 99, step: 1, default: 12 },
  },
};

const CSS = `
.ua-stw{position:absolute;inset:0;overflow:hidden;cursor:pointer;background:var(--ua-top)}
.ua-stw svg{width:100%;height:100%;display:block}
.ua-stw__c{transform-box:fill-box;transform-origin:center}
.ua-stw__line{fill:none;stroke:#fff;stroke-width:1.3;stroke-linecap:round;opacity:.55}
.ua-stw__node{fill:#fff}
.ua-stw__trail{fill:none;stroke:#fff;stroke-linecap:round}
.ua-stw__hill{stroke:none}
`;

const SPARKLE = 'M0,-1 Q0.16,-0.16 1,0 Q0.16,0.16 0,1 Q-0.16,0.16 -1,0 Q-0.16,-0.16 0,-1Z';
const W = 800;
const H = 600;
// 自作の星座。点を順に線で結ぶ。
const CONSTELLATIONS = [
  [[112, 150], [168, 112], [226, 138], [262, 92], [322, 118], [226, 138], [214, 204]],
  [[520, 250], [566, 206], [628, 220], [668, 172], [628, 220], [642, 284], [582, 306], [520, 250]],
  [[352, 330], [398, 296], [444, 322], [470, 372]],
];
let uid = 0;

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-stw', { '--ua-top': p.skyTop });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const random = createSeededRandom(Math.round(p.seed), 0, 1, 4);
  const id = `ua-stw-${(uid += 1)}`;
  const count = Math.round(p.preview ? Math.min(p.count, 60) : p.count);
  const tints = [p.star, '#ffffff', '#ffd0e4', '#c9f2ff', p.star];

  const defs = s(
    'defs',
    {},
    s('linearGradient', { id: `${id}-sky`, x1: 0, y1: 0, x2: 0, y2: 1 }, s('stop', { offset: 0, 'stop-color': p.skyTop }), s('stop', { offset: 0.55, 'stop-color': `color-mix(in srgb, ${p.skyTop} 45%, ${p.skyBottom})` }), s('stop', { offset: 1, 'stop-color': p.skyBottom })),
    s('radialGradient', { id: `${id}-glow` }, s('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': 0.5 }), s('stop', { offset: 1, 'stop-color': '#fff', 'stop-opacity': 0 })),
    s('mask', { id: `${id}-moon` }, s('circle', { cx: 0, cy: 0, r: 40, fill: '#fff' }), s('circle', { cx: 17, cy: -10, r: 35, fill: '#000' })),
  );

  // 星。x の順に並べ、左から右へ波のようにまたたかせる。
  const starData = Array.from({ length: count }, () => {
    const big = random() < 0.3;
    return { x: random() * W, y: random() ** 1.25 * 455 + 12, size: big ? 6 + random() * 7 : 1.2 + random() * 2, big, tint: tints[Math.floor(random() * tints.length)] };
  }).sort((a, b) => a.x - b.x);
  const starEls = starData.map((d) => {
    const shape = d.big
      ? s('path', { class: 'ua-stw__c', d: SPARKLE, fill: d.tint, transform: `scale(${d.size.toFixed(1)})` })
      : s('circle', { class: 'ua-stw__c', r: d.size.toFixed(1), fill: d.tint });
    return s('g', { transform: `translate(${d.x.toFixed(1)} ${d.y.toFixed(1)})` }, s('g', { class: 'ua-stw__c' }, shape));
  });
  const twinklers = starEls.map((g) => g.firstChild);
  const far = s('g', {}, starEls.filter((_, i) => !starData[i].big));
  const near = s('g', {}, starEls.filter((_, i) => starData[i].big));

  const lines = [];
  const nodes = [];
  if (p.constellations) {
    for (const points of CONSTELLATIONS) {
      lines.push(s('path', { class: 'ua-stw__line', d: points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('') }));
      const seen = new Set();
      for (const [x, y] of points) {
        if (seen.has(`${x},${y}`)) continue;
        seen.add(`${x},${y}`);
        nodes.push(s('g', { transform: `translate(${x} ${y})` }, s('circle', { r: 11, fill: `url(#${id}-glow)` }), s('path', { class: 'ua-stw__node ua-stw__c', d: SPARKLE, transform: 'scale(7)' })));
      }
    }
  }
  const constel = s('g', {}, lines, nodes);

  const moon = s('g', { transform: 'translate(676 96) rotate(-18)' }, s('circle', { r: 86, fill: `url(#${id}-glow)` }), s('circle', { r: 40, fill: '#fff6d6', mask: `url(#${id}-moon)` }));
  const hills = s(
    'g',
    {},
    s('path', { class: 'ua-stw__hill', d: 'M0 520 C120 468 220 500 330 520 C450 542 560 470 800 506 L800 600 L0 600Z', fill: `color-mix(in srgb, ${p.skyTop} 55%, ${p.skyBottom})`, opacity: 0.75 }),
    s('path', { class: 'ua-stw__hill', d: 'M0 562 C150 520 300 560 430 548 C560 536 660 560 800 540 L800 600 L0 600Z', fill: `color-mix(in srgb, ${p.skyTop} 78%, ${p.skyBottom})` }),
  );
  const trails = s('g', {});
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid slice', role: 'img', 'aria-label': '星空' }, defs, s('rect', { width: W, height: H, fill: `url(#${id}-sky)` }), far, moon, constel, near, trails, hills);
  root.appendChild(svg);

  if (reduced) return { destroy: () => removeRoot(root) };

  const intro = createTimeline().add(twinklers, { scale: [0, 1], opacity: [0, 1], duration: 700, ease: 'outBack(3)', delay: stagger(1400 / count) }, 0);
  if (lines.length) {
    intro
      .add(nodes, { opacity: [0, 1], duration: 400, ease: 'outQuad', delay: stagger(60) }, 500)
      .add(createDrawable(lines), { draw: ['0 0', '0 1'], duration: 1500, ease: 'inOutQuad', delay: stagger(300) }, 700);
  }
  disposer.add(() => intro.pause());

  // 入場が済んだら、左から順にまたたく波を回し続ける。
  disposer.timeout(() => {
    animate(twinklers, {
      opacity: (_, i) => [1, starData[i].big ? 0.35 : 0.15],
      scale: (_, i) => [1, starData[i].big ? 0.55 : 0.7],
      rotate: (_, i) => (starData[i].big ? [0, 45] : 0),
      duration: () => utils.random(500, 1100),
      delay: (_, i) => (starData[i].x / W) * 2200 + utils.random(0, 500),
      loopDelay: () => utils.random(600, 2400),
      ease: 'inOutSine',
      alternate: true,
      loop: true,
    });
    if (nodes.length) {
      animate(nodes.map((g) => g.lastChild), { scale: [1, 1.5], duration: 900, delay: stagger(140), ease: 'inOutSine', alternate: true, loop: true });
    }
  }, 2300);

  // 流れ星。弧を描く線の、見える区間を先頭から後ろへ送る。
  function shoot(x, y) {
    if (trails.childElementCount > 5) return;
    const sx = Number.isFinite(x) ? x : utils.random(140, 700);
    const sy = Number.isFinite(y) ? y : utils.random(30, 210);
    const dir = sx > W * 0.55 ? -1 : 1;
    const len = utils.random(210, 330);
    const d = `M${sx.toFixed(0)} ${sy.toFixed(0)} q${(dir * len * 0.55).toFixed(0)} ${(len * 0.12).toFixed(0)} ${(dir * len).toFixed(0)} ${(len * 0.62).toFixed(0)}`;
    const glow = s('path', { class: 'ua-stw__trail', d, 'stroke-width': 7, opacity: 0.22 });
    const core = s('path', { class: 'ua-stw__trail', d, 'stroke-width': 2.2 });
    const group = s('g', {}, glow, core);
    trails.appendChild(group);
    animate(createDrawable([glow, core]), {
      draw: [
        { from: '0 0', to: '0 0.4', duration: 380, ease: 'outQuad' },
        { to: '0.75 1', duration: 420, ease: 'linear' },
        { to: '1 1', duration: 260, ease: 'inQuad' },
      ],
      onComplete: () => group.remove(),
    });
  }
  disposer.timeout(() => shoot(), 1600);
  disposer.interval(() => shoot(), Math.max(1, p.preview ? Math.min(p.interval, 2.2) : p.interval) * 1000);
  disposer.listen(root, 'click', (event) => {
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    shoot(point.x, point.y);
  });

  // ポインターに合わせて、奥の星と手前の星をずらす。
  const target = { x: 0, y: 0 };
  const now = { x: 0, y: 0 };
  disposer.listen(root, 'pointermove', (event) => {
    const rect = root.getBoundingClientRect();
    target.x = (event.clientX - rect.left) / rect.width - 0.5;
    target.y = (event.clientY - rect.top) / rect.height - 0.5;
  });
  disposer.listen(root, 'pointerleave', () => {
    target.x = 0;
    target.y = 0;
  });
  const timer = createTimer({
    onUpdate() {
      now.x += (target.x - now.x) * 0.06;
      now.y += (target.y - now.y) * 0.06;
      far.setAttribute('transform', `translate(${(now.x * -8).toFixed(2)} ${(now.y * -6).toFixed(2)})`);
      near.setAttribute('transform', `translate(${(now.x * -22).toFixed(2)} ${(now.y * -16).toFixed(2)})`);
      constel.setAttribute('transform', `translate(${(now.x * -14).toFixed(2)} ${(now.y * -10).toFixed(2)})`);
      moon.setAttribute('transform', `translate(${(676 - now.x * 5).toFixed(2)} ${(96 - now.y * 4).toFixed(2)}) rotate(-18)`);
    },
  });
  disposer.add(() => timer.pause());

  return {
    shoot,
    destroy() {
      disposer.run();
      removeRoot(root);
    },
  };
}
