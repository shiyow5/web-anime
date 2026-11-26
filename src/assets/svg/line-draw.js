import { animate, createDrawable, createTimeline, stagger, utils } from 'animejs';
import { createRoot, injectStyle, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'line-draw',
  title: '一筆で描かれる線画',
  category: 'svg',
  libs: ['animejs'],
  description:
    'SVG の線が 1 本ずつ引かれて図になり、最後に点が弾んで現れます。タップすると、図が軌道の模型のように動き出します。目盛りの輪が少し巻き戻ってから回り、2 本の軌道が傾きを入れ替え、三角が回って、点が軌道を 1 周します。タップした場所には印の輪が描かれ、右側をタップすると時計回り、左側なら反時計回りです。ロゴの登場、図解、区切りの装飾に使えます。SVG の中身を差し替えれば、自分の図でも同じ動きになります。',
  params: {
    stroke: { type: 'color', label: '線の色', default: '#1c2340' },
    accent: { type: 'color', label: '点の色', default: '#ff5a36' },
    background: { type: 'color', label: '背景色', default: '#f2efe4' },
    width: { type: 'range', label: '線の太さ', min: 0.5, max: 6, step: 0.5, default: 2 },
    speed: { type: 'range', label: '描く速さ', min: 0.3, max: 3, step: 0.1, default: 1 },
    loop: { type: 'boolean', label: 'くり返す', default: true },
  },
};

const CSS = `
.ua-ld{cursor:pointer;position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;background:var(--ua-bg)}
.ua-ld svg{width:min(92%,900px);height:92%}
.ua-ld__stroke{fill:none;stroke:var(--ua-stroke);stroke-linecap:round;stroke-linejoin:round}
.ua-ld__dot{fill:var(--ua-accent);transform-box:fill-box;transform-origin:center}
.ua-ld__ping{fill:none;stroke:var(--ua-accent);stroke-linecap:round}
`;

const CENTER = { x: 300, y: 200 };

function buildStrokes() {
  const { x, y } = CENTER;
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2;
    const point = (r) => [x + Math.cos(angle) * r, y + Math.sin(angle) * r].map((v) => v.toFixed(1));
    const [x1, y1] = point(160);
    const [x2, y2] = point(174);
    return s('line', { x1, y1, x2, y2 });
  });
  return [
    s('circle', { cx: x, cy: y, r: 150 }),
    s('ellipse', { cx: x, cy: y, rx: 236, ry: 72, transform: `rotate(-18 ${x} ${y})` }),
    s('ellipse', { cx: x, cy: y, rx: 236, ry: 72, transform: `rotate(18 ${x} ${y})` }),
    s('circle', { cx: x, cy: y, r: 96 }),
    s('polygon', { points: '300,104 383,248 217,248' }),
    s('circle', { cx: x, cy: y, r: 40 }),
    s('line', { x1: x, y1: 14, x2: x, y2: 386 }),
    s('line', { x1: 50, y1: y, x2: 550, y2: y }),
    s('path', { d: 'M40 340 C140 280 200 400 300 340 S460 280 560 340' }),
    ...ticks,
  ];
}

const DOTS = [
  [524, 127, 9],
  [76, 273, 7],
  [300, 104, 6],
  [383, 248, 6],
  [217, 248, 6],
  [300, 200, 10],
];

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-ld', { '--ua-bg': p.background, '--ua-stroke': p.stroke, '--ua-accent': p.accent });
  const strokes = buildStrokes();
  for (const stroke of strokes) {
    stroke.setAttribute('class', 'ua-ld__stroke');
    stroke.setAttribute('stroke-width', String(p.width));
  }
  const dots = DOTS.map(([cx, cy, r]) => s('circle', { class: 'ua-ld__dot', cx, cy, r }));
  const svgEl = s('svg', { viewBox: '0 0 600 400', role: 'img', 'aria-label': '軌道を描いた線画' }, strokes, dots);
  root.appendChild(svgEl);
  const reduced = prefersReducedMotion();

  let timeline = null;
  let drawnAt = 0; // 図が描き上がる時刻
  if (!reduced) {
    const drawables = createDrawable(strokes);
    const t = (ms) => ms / p.speed;
    timeline = createTimeline({ loop: p.loop, loopDelay: t(500) })
      .add(drawables, { draw: ['0 0', '0 1'], duration: t(1700), ease: 'inOutQuart', delay: stagger(t(90)) })
      .add(dots, { scale: [0, 1], opacity: [0, 1], duration: t(900), ease: 'outElastic(1, .5)', delay: stagger(t(70)) }, `-=${t(700)}`);
    drawnAt = timeline.iterationDuration;
    if (p.loop) {
      timeline
        .add(dots, { scale: 0, opacity: 0, duration: t(350), ease: 'inQuad', delay: stagger(t(30)) }, `+=${t(1800)}`)
        .add(drawables, { draw: '1 1', duration: t(1100), ease: 'inOutQuart', delay: stagger(t(45)) }, `-=${t(200)}`);
    }
  }

  // タップで動かす部品。strokes の並びは buildStrokes と同じ。
  const [, orbitA, orbitB, , triangle, core] = strokes;
  const ticks = strokes.slice(9);
  const TRIANGLE = [-90, 30, 150].map((deg) => (deg * Math.PI) / 180);
  const gear = { ticks: 0, tilt: 0, turn: 0, lap: 0, pulse: 0 };
  const rot = (deg) => `rotate(${deg.toFixed(2)} ${CENTER.x} ${CENTER.y})`;
  function apply() {
    for (const tick of ticks) tick.setAttribute('transform', rot(gear.ticks));
    // 2 本の軌道は、逆向きに傾いて互いの角度を入れ替える。
    const tiltA = -18 + gear.tilt;
    orbitA.setAttribute('transform', rot(tiltA));
    orbitB.setAttribute('transform', rot(18 - gear.tilt));
    triangle.setAttribute('transform', rot(gear.turn));
    core.setAttribute('r', (40 + gear.pulse * 14).toFixed(2));
    // 軌道の両端にあった 2 つの点が、軌道の上を 1 周する。
    const tilt = (tiltA * Math.PI) / 180;
    [0, Math.PI].forEach((offset, index) => {
      const a = gear.lap + offset;
      const ex = Math.cos(a) * 236;
      const ey = Math.sin(a) * 72;
      dots[index].setAttribute('cx', (CENTER.x + ex * Math.cos(tilt) - ey * Math.sin(tilt)).toFixed(1));
      dots[index].setAttribute('cy', (CENTER.y + ex * Math.sin(tilt) + ey * Math.cos(tilt)).toFixed(1));
    });
    // 三角の頂点の点は、三角と一緒に回る。
    TRIANGLE.forEach((base, index) => {
      const a = base + (gear.turn * Math.PI) / 180;
      dots[2 + index].setAttribute('cx', (CENTER.x + Math.cos(a) * 96).toFixed(1));
      dots[2 + index].setAttribute('cy', (CENTER.y + Math.sin(a) * 96).toFixed(1));
    });
    dots[5].setAttribute('r', (10 + gear.pulse * 7).toFixed(2));
  }

  let pings = [];
  let swapped = false;
  let resumeTimer = 0;
  // 準備: 目盛りの輪が巻き戻り、タップした場所に印の輪が描かれる。
  // 山場: 目盛り、軌道、三角、点が、時間差を付けて別々の速さで回る。余韻: 行き過ぎてゆれながら止まり、中心が脈を打つ。
  function orbit(event) {
    if (reduced || !timeline) return;
    const rect = svgEl.getBoundingClientRect();
    const hasPoint = typeof event?.clientX === 'number' && rect.width > 0 && rect.height > 0;
    const scale = hasPoint ? Math.min(rect.width / 600, rect.height / 400) : 1;
    const x = hasPoint ? 300 + (event.clientX - rect.left - rect.width / 2) / scale : 300;
    const y = hasPoint ? 200 + (event.clientY - rect.top - rect.height / 2) / scale : 200;
    const way = x < CENTER.x ? -1 : 1;

    // 線が消えている途中でも見えるように、描き上がった状態で止めてから動かす。
    // seek は全体の通し時刻を取るので、くり返しの何周目でも効くように、周の中の時刻で指定する。
    timeline.pause();
    timeline.iterationCurrentTime = drawnAt;
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => timeline?.play(), 3200);

    utils.remove(gear);
    // 回り終えた姿は元と同じ形なので、続けてタップされたら角度を巻き直して始める。
    gear.ticks %= 30;
    gear.turn %= 120;
    gear.lap %= Math.PI * 2;
    const run = { onUpdate: apply };
    animate(gear, {
      ticks: [
        { to: gear.ticks - 14 * way, duration: 220, ease: 'outQuad' },
        { to: gear.ticks + 210 * way, duration: 1500, ease: 'outElastic(1, .7)' },
      ],
      ...run,
    });
    swapped = !swapped;
    animate(gear, { tilt: swapped ? 36 : 0, duration: 1300, delay: 200, ease: 'inOutBack(2.2)', ...run });
    animate(gear, { turn: gear.turn + 120 * way, duration: 1100, delay: 340, ease: 'outElastic(1, .55)', ...run });
    animate(gear, { lap: gear.lap + Math.PI * 2 * way, duration: 1900, delay: 200, ease: 'inOutCubic', ...run });
    animate(gear, {
      pulse: [
        { to: 1, duration: 200, ease: 'outQuad' },
        { to: 0, duration: 900, ease: 'outElastic(1, .4)' },
      ],
      delay: 1500,
      ...run,
    });

    const ping = s('circle', { class: 'ua-ld__ping', cx: x.toFixed(1), cy: y.toFixed(1), r: 6, 'stroke-width': String(p.width) });
    svgEl.appendChild(ping);
    pings.push(ping);
    animate(ping, {
      r: [6, 46],
      opacity: [
        { to: 1, duration: 120 },
        { to: 0, duration: 780, ease: 'inQuad' },
      ],
      duration: 900,
      ease: 'outExpo',
      onComplete() {
        ping.remove();
        pings = pings.filter((other) => other !== ping);
      },
    });
  }
  root.addEventListener('pointerdown', orbit);
  const auto = p.preview && !reduced ? setInterval(orbit, 6000) : 0;

  return {
    replay: () => timeline?.restart(),
    orbit,
    destroy() {
      clearInterval(auto);
      clearTimeout(resumeTimer);
      root.removeEventListener('pointerdown', orbit);
      utils.remove(gear);
      utils.remove(pings);
      timeline?.pause();
      removeRoot(root);
    },
  };
}
