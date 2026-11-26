import { animate, createDrawable, createTimeline, stagger, steps, utils } from 'animejs';
import { createDisposer, createRoot, injectStyle, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'biometric-scan',
  title: '生体認証の走査',
  category: 'cyber',
  libs: ['animejs'],
  description:
    '乱数から描いた指紋の上を走査線が上下し、通った場所の筋が明るくなって、特徴点が 1 つずつ光ります。特徴点が線で結ばれると、照合の結果と一致率が出て、また最初からくり返します。タップすると指を置き直した扱いになり、タップした位置から波紋が広がって近い筋から順に灯り、走査がやり直されて、前回とは逆の照合結果が出ます。',
  params: {
    ridge: { type: 'color', label: '筋の色', default: '#5b8cff' },
    scan: { type: 'color', label: '走査線の色', default: '#ff4fa3' },
    match: { type: 'color', label: '一致の色', default: '#5dffb0' },
    background: { type: 'color', label: '背景色', default: '#080b19' },
    result: {
      type: 'select',
      label: '照合の結果',
      options: [
        { value: 'match', label: 'いつも一致' },
        { value: 'deny', label: 'いつも不一致' },
        { value: 'alternate', label: '交互に出す' },
      ],
      default: 'match',
    },
    points: { type: 'range', label: '特徴点の数', min: 4, max: 16, step: 1, default: 11 },
    speed: { type: 'range', label: '走査の速さ', min: 0.4, max: 3, step: 0.1, default: 1 },
  },
};

const CSS = `
.ua-bs{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;cursor:pointer;--ua-result:var(--ua-scan);
  background:radial-gradient(90% 90% at 36% 50%,color-mix(in srgb,var(--ua-ridge) 17%,var(--ua-bg)),var(--ua-bg) 70%)}
.ua-bs[data-state=match]{--ua-result:var(--ua-match)}
.ua-bs[data-state=deny]{--ua-result:#ff5a4d}
.ua-bs svg{width:100%;height:100%}
.ua-bs text{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;fill:var(--ua-ridge)}
.ua-bs__guide{fill:none;stroke:var(--ua-ridge);stroke-width:1;opacity:.22}
.ua-bs__tick{stroke:var(--ua-ridge);stroke-width:1;opacity:.6}
.ua-bs__bracket{fill:none;stroke:var(--ua-ridge);stroke-width:2;opacity:.9}
.ua-bs__oval{fill:none;stroke:var(--ua-result);stroke-width:1.4;stroke-dasharray:3 9;opacity:.8}
.ua-bs__pulse{fill:none;stroke:var(--ua-result);stroke-width:3;opacity:0;transform-box:fill-box;transform-origin:center}
.ua-bs__ridge{fill:none;stroke:var(--ua-ridge);stroke-width:2.6;stroke-linecap:round;opacity:.5}
.ua-bs__hot{fill:none;stroke:color-mix(in srgb,var(--ua-scan) 60%,#fff);stroke-width:3;stroke-linecap:round}
.ua-bs__beam{stroke:var(--ua-scan);stroke-width:2}
.ua-bs__beamglow{stroke:var(--ua-scan);stroke-width:14;opacity:.2}
.ua-bs__min{opacity:0;transform-box:fill-box;transform-origin:center}
.ua-bs__min circle{fill:none;stroke:var(--ua-result);stroke-width:1.8}
.ua-bs__min line{stroke:var(--ua-result);stroke-width:1.4}
.ua-bs__min .ua-bs__core{fill:var(--ua-result);stroke:none}
.ua-bs__min text{fill:var(--ua-result);font-size:9px}
.ua-bs__link{fill:color-mix(in srgb,var(--ua-result) 9%,transparent);stroke:var(--ua-result);stroke-width:1;opacity:.75}
.ua-bs__small{font-size:11px;letter-spacing:.14em;opacity:.75}
.ua-bs__value{font-size:13px;letter-spacing:.08em;fill:color-mix(in srgb,var(--ua-ridge) 45%,#fff) !important}
.ua-bs__score{font-size:50px;font-weight:700;fill:var(--ua-result) !important}
.ua-bs__hex{font-size:9px;letter-spacing:.1em;opacity:.45}
.ua-bs__box{fill:color-mix(in srgb,var(--ua-result) 12%,transparent);stroke:var(--ua-result);stroke-width:1.5}
.ua-bs__status{font-size:25px;font-weight:700;letter-spacing:.16em;fill:var(--ua-result) !important}
.ua-bs__sub{font-family:var(--ua-display,system-ui,sans-serif) !important;font-size:13px;letter-spacing:.2em;fill:var(--ua-result) !important;opacity:.85}
.ua-bs__bar{fill:var(--ua-result);transform-box:fill-box;transform-origin:0 50%}
.ua-bs__bartrack{fill:var(--ua-ridge);opacity:.18}
`;

const CX = 290;
const CY = 300;
const RX = 150;
const RY = 200;
const TOP = 96;
const BOTTOM = 504;
const RIDGES = 22;

function mulberry(seed) {
  let a = seed * 2654435761;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 筋 index の、角度 theta の位置。中心が少しずつずれる、ゆがんだ楕円の重なりで渦を作る。
export function ridgePoint(index, theta) {
  const r = 9 + index * 9.6;
  const x = CX + r * (1 + 0.07 * Math.sin(theta * 2 + index * 0.45)) * Math.cos(theta) + 5 * Math.sin(theta * 3 + index * 0.7);
  const y = CY + 26 - index * 1.1 + r * 1.3 * Math.sin(theta) + r * 0.13 * Math.cos(theta * 2 + 0.6);
  return [x, y];
}

const inPrint = (x, y, margin = 0.8) => ((x - CX) / RX) ** 2 + ((y - CY) / RY) ** 2 < margin;
// inOutSine の逆関数。走査線が高さ f に来る時刻（0〜1）を返す。
const whenAt = (f) => Math.acos(1 - 2 * Math.min(1, Math.max(0, f))) / Math.PI;

let uid = 0;

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-bs', { '--ua-bg': p.background, '--ua-ridge': p.ridge, '--ua-scan': p.scan, '--ua-match': p.match });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const random = mulberry(41);
  uid += 1;
  const ovalId = `ua-bs-oval-${uid}`;
  const bandId = `ua-bs-band-${uid}`;

  const ridgePaths = Array.from({ length: RIDGES }, (_, index) => {
    let d = '';
    for (let i = 0; i <= 90; i += 1) {
      const [x, y] = ridgePoint(index, (i / 90) * Math.PI * 2);
      d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    // 筋の切れ目。線を点線にして、ところどころ途切れさせる。
    const dash = Array.from({ length: 4 }, () => `${(30 + random() * 130).toFixed(0)} ${(3 + random() * 6).toFixed(0)}`).join(' ');
    return { d, dash };
  });
  const ridgeGroup = (className) => s('g', {}, ridgePaths.map(({ d, dash }) => s('path', { class: className, d, 'stroke-dasharray': dash })));

  const band = s('rect', { x: 0, y: -200, width: 800, height: 60 });
  const defs = s('defs', {}, s('clipPath', { id: ovalId }, s('ellipse', { cx: CX, cy: CY, rx: RX, ry: RY })), s('clipPath', { id: bandId }, band));
  const dim = ridgeGroup('ua-bs__ridge');
  const print = s('g', { 'clip-path': `url(#${ovalId})` }, dim, s('g', { 'clip-path': `url(#${bandId})` }, ridgeGroup('ua-bs__hot')));

  const guides = s('g', {}, [70, 130, 215].map((r) => s('circle', { class: 'ua-bs__guide', cx: CX, cy: CY, r })), s('line', { class: 'ua-bs__guide', x1: 70, y1: CY, x2: 510, y2: CY }), s('line', { class: 'ua-bs__guide', x1: CX, y1: 60, x2: CX, y2: 540 }));
  const ruler = s('g');
  for (let y = TOP; y <= BOTTOM; y += 8.5) {
    const major = Math.round((y - TOP) / 8.5) % 6 === 0;
    ruler.append(s('line', { class: 'ua-bs__tick', x1: 84, y1: y, x2: major ? 100 : 92, y2: y }));
    if (major) ruler.append(s('text', { class: 'ua-bs__hex', x: 78, y: y + 3, 'text-anchor': 'end', text: String(Math.round(y - TOP)).padStart(3, '0') }));
  }
  const brackets = [
    [108, 100, 1, 1],
    [472, 100, -1, 1],
    [108, 500, 1, -1],
    [472, 500, -1, -1],
  ].map(([x, y, dx, dy]) => s('path', { class: 'ua-bs__bracket', d: `M${x + dx * 26} ${y - dy * 22}H${x}V${y + dy * 4}` }));
  const oval = s('ellipse', { class: 'ua-bs__oval', cx: CX, cy: CY, rx: RX + 12, ry: RY + 12 });
  const pulse = s('ellipse', { class: 'ua-bs__pulse', cx: CX, cy: CY, rx: RX + 12, ry: RY + 12 });

  const beam = s(
    'g',
    {},
    s('line', { class: 'ua-bs__beamglow', x1: 112, y1: TOP, x2: 468, y2: TOP }),
    s('line', { class: 'ua-bs__beam', x1: 100, y1: TOP, x2: 480, y2: TOP }),
    s('path', { d: `M100 ${TOP - 6}L110 ${TOP}L100 ${TOP + 6}Z`, fill: p.scan }),
    s('path', { d: `M480 ${TOP - 6}L470 ${TOP}L480 ${TOP + 6}Z`, fill: p.scan }),
  );

  // 特徴点。筋の上から、指紋の内側に入るものだけを選ぶ。
  const wanted = Math.round(p.points);
  const minutiae = [];
  for (let attempt = 0; attempt < 400 && minutiae.length < wanted; attempt += 1) {
    const [x, y] = ridgePoint(3 + Math.floor(random() * 15), random() * Math.PI * 2);
    if (!inPrint(x, y) || minutiae.some((m) => Math.hypot(m.x - x, m.y - y) < 44)) continue;
    const id = String(minutiae.length + 1).padStart(2, '0');
    const el = s(
      'g',
      { class: 'ua-bs__min' },
      s('circle', { cx: x, cy: y, r: 7 }),
      s('circle', { class: 'ua-bs__core', cx: x, cy: y, r: 2 }),
      s('line', { x1: x - 13, y1: y, x2: x - 8, y2: y }),
      s('line', { x1: x + 8, y1: y, x2: x + 13, y2: y }),
      s('line', { x1: x, y1: y - 13, x2: x, y2: y - 8 }),
      s('text', { x: x + 10, y: y - 8, text: id }),
    );
    minutiae.push({ x, y, el });
  }
  const ordered = [...minutiae].sort((a, b) => Math.atan2(a.y - CY, a.x - CX) - Math.atan2(b.y - CY, b.x - CX));
  const link = s('path', { class: 'ua-bs__link', d: `${ordered.map((m, i) => `${i ? 'L' : 'M'}${m.x.toFixed(1)} ${m.y.toFixed(1)}`).join('')}Z` });
  const [linkDraw] = createDrawable(link);

  // 右側の表示欄。
  const X = 524;
  const label = (y, text) => s('text', { class: 'ua-bs__small', x: X, y, text });
  const value = (y, text) => s('text', { class: 'ua-bs__value', x: 770, y, 'text-anchor': 'end', text });
  const countText = value(170, `00/${String(minutiae.length).padStart(2, '0')}`);
  const scoreText = s('text', { class: 'ua-bs__score', x: X, y: 286, text: '0.0%' });
  const bar = s('rect', { class: 'ua-bs__bar', x: X, y: 300, width: 246, height: 5 });
  const hexLines = [0, 1, 2, 3].map((i) => s('text', { class: 'ua-bs__hex', x: X, y: 340 + i * 15, text: '' }));
  const statusText = s('text', { class: 'ua-bs__status', x: X + 123, y: 462, 'text-anchor': 'middle', text: 'SCANNING' });
  const subText = s('text', { class: 'ua-bs__sub', x: X + 123, y: 488, 'text-anchor': 'middle', text: '走査中' });
  const panel = s(
    'g',
    {},
    s('text', { class: 'ua-bs__value', x: X, y: 108, text: 'BIOMETRIC // ID-SCAN' }),
    s('line', { class: 'ua-bs__tick', x1: X, y1: 120, x2: 770, y2: 120 }),
    label(146, 'SUBJECT'),
    value(146, '7F-2A91'),
    label(170, 'MINUTIAE'),
    countText,
    label(194, 'RIDGES'),
    value(194, String(RIDGES)),
    s('line', { class: 'ua-bs__tick', x1: X, y1: 208, x2: 770, y2: 208, 'stroke-dasharray': '2 5' }),
    label(232, 'SCORE'),
    scoreText,
    s('rect', { class: 'ua-bs__bartrack', x: X, y: 300, width: 246, height: 5 }),
    bar,
    hexLines,
    s('rect', { class: 'ua-bs__box', x: X, y: 422, width: 246, height: 82, rx: 3 }),
    statusText,
    subText,
  );

  root.append(
    s('svg', { viewBox: '0 0 800 600', role: 'img', 'aria-label': '指紋を走査する認証画面' }, defs, guides, ruler, brackets, oval, pulse, print, link, minutiae.map((m) => m.el), beam, panel),
  );

  const score = { v: 0 };
  let cycle = 0;
  let timeline = null;
  const hexRow = () => Array.from({ length: 8 }, () => Math.floor(random() * 65536).toString(16).toUpperCase().padStart(4, '0')).join(' ');
  const showScore = () => {
    scoreText.textContent = `${score.v.toFixed(1)}%`;
    bar.style.transform = `scaleX(${(score.v / 100).toFixed(3)})`;
  };
  const outcomeOf = (n) => (p.result === 'alternate' ? (n % 2 === 0 ? 'match' : 'deny') : p.result);
  function showResult(outcome) {
    root.dataset.state = outcome;
    statusText.textContent = outcome === 'match' ? 'MATCH' : 'NO MATCH';
    subText.textContent = outcome === 'match' ? '照合一致' : '不一致';
  }

  if (reduced) {
    for (const m of minutiae) m.el.style.opacity = '1';
    beam.style.opacity = '0';
    score.v = p.result === 'deny' ? 41.7 : 98.4;
    showScore();
    countText.textContent = `${String(minutiae.length).padStart(2, '0')}/${String(minutiae.length).padStart(2, '0')}`;
    hexLines.forEach((line) => (line.textContent = hexRow()));
    showResult(outcomeOf(0));
    return { destroy: () => removeRoot(root) };
  }

  function run() {
    timeline?.pause();
    utils.remove([score, beam, band, pulse, statusText, link, ...minutiae.map((m) => m.el)]);
    const outcome = outcomeOf(cycle);
    cycle += 1;
    delete root.dataset.state;
    statusText.textContent = 'SCANNING';
    subText.textContent = '走査中';
    statusText.style.opacity = '1';
    for (const m of minutiae) m.el.style.opacity = '0';
    linkDraw.setAttribute('draw', '0 0');
    link.style.fillOpacity = '0';
    beam.style.opacity = '1';
    score.v = 0;
    showScore();
    let found = 0;
    countText.textContent = `00/${String(minutiae.length).padStart(2, '0')}`;

    const pass = 1800 / p.speed;
    const span = BOTTOM - TOP;
    const final = outcome === 'match' ? 98.4 : 41.7;
    timeline = createTimeline({ onComplete: run })
      .add(beam, { translateY: [0, span], duration: pass, ease: 'inOutSine' }, 0)
      .add(band, { y: [TOP - 30, BOTTOM - 30], duration: pass, ease: 'inOutSine' }, 0)
      .add(beam, { translateY: [span, 0], duration: pass, ease: 'inOutSine' }, pass)
      .add(band, { y: [BOTTOM - 30, TOP - 30], duration: pass, ease: 'inOutSine' }, pass)
      .add(score, { v: [0, final], duration: pass * 2, ease: 'inOutQuad', onUpdate: showScore }, 0);
    minutiae.forEach((m, i) => {
      const f = (m.y - TOP) / span;
      const at = i % 2 === 0 ? whenAt(f) * pass : pass + whenAt(1 - f) * pass;
      timeline.add(m.el, { opacity: [0, 1], scale: [2.6, 1], duration: 460, ease: 'outBack(2)' }, at);
      timeline.call(() => {
        found += 1;
        countText.textContent = `${String(found).padStart(2, '0')}/${String(minutiae.length).padStart(2, '0')}`;
        hexLines[found % hexLines.length].textContent = hexRow();
      }, at);
    });
    const done = pass * 2;
    timeline
      .add(beam, { opacity: 0, duration: 260, ease: 'outQuad' }, done)
      .add(band, { y: -200, duration: 10 }, done)
      .add(linkDraw, { draw: ['0 0', '0 1'], duration: 800, ease: 'inOutQuad' }, done + 80)
      .call(() => showResult(outcome), done + 760)
      .add(link, { fillOpacity: [0, 1], duration: 500, ease: 'outQuad' }, done + 760)
      .add(statusText, { opacity: [0, 1], duration: 300, ease: steps(3) }, done + 760)
      .add(pulse, { opacity: [0.9, 0], scale: [1, 1.14], duration: 1000, ease: 'outExpo' }, done + 760)
      .add(minutiae.map((m) => m.el), { scale: [{ to: 1.6, duration: 140, ease: 'outQuad' }, { to: 1, duration: 600, ease: 'outElastic(1, .5)' }], delay: stagger(40) }, done + 760)
      .add(pulse, { opacity: 0, duration: 2600 / Math.sqrt(p.speed) }, done + 1800);
  }

  animate(oval, { strokeDashoffset: [0, -120], duration: 6000, ease: 'linear', loop: true });
  animate([...root.querySelectorAll('.ua-bs__ridge')], { opacity: [0, 0.5], duration: 500, ease: 'outQuad', delay: stagger(40) });
  animate(brackets, { opacity: [0, 0.9], duration: 300, ease: steps(3), delay: stagger(90) });
  hexLines.forEach((line) => (line.textContent = hexRow()));
  run();
  disposer.add(() => timeline?.pause());

  // 指を置き直す。タップした位置から波紋が広がり、近い筋から順に灯り（準備）、そのまま走査がやり直されて
  // 特徴点が拾われ（山場）、照合の結果が出る（余韻）。結果は前回と入れ替わる。
  const svg = root.querySelector('svg');
  const ripples = [0, 1, 2].map(() => s('circle', { cx: CX, cy: CY, r: 4, fill: 'none', stroke: p.scan, 'stroke-width': 2, opacity: 0, 'pointer-events': 'none' }));
  svg.append(...ripples);
  const dimRidges = [...dim.children];
  function touch(event) {
    let x = CX;
    let y = CY;
    const matrix = event?.clientX === undefined ? null : svg.getScreenCTM();
    if (matrix) {
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      x = Math.min(480, Math.max(100, point.x));
      y = Math.min(BOTTOM, Math.max(TOP, point.y));
    }
    utils.remove([...ripples, ...dimRidges]);
    for (const ripple of ripples) {
      ripple.setAttribute('cx', x.toFixed(1));
      ripple.setAttribute('cy', y.toFixed(1));
    }
    animate(ripples, { r: [4, 250], opacity: [0.95, 0], strokeWidth: [4, 0.5], duration: 1100, ease: 'outQuart', delay: stagger(170) });
    // タップした位置から、筋の中心までの距離に近い番号の筋を先に灯す。
    const nearest = Math.min(RIDGES - 1, Math.round((Math.hypot(x - CX, y - CY) / RY) * RIDGES));
    animate(dimRidges, {
      opacity: [
        { to: 1, duration: 160, ease: 'outQuad' },
        { to: 0.5, duration: 700, ease: 'outQuad' },
      ],
      strokeWidth: [{ to: 4.4, duration: 160 }, { to: 2.6, duration: 700 }],
      delay: stagger(34, { from: nearest }),
    });
    run();
  }
  disposer.listen(root, 'click', touch);
  if (p.preview) disposer.interval(() => touch(), 6500);

  return {
    rescan: run,
    destroy() {
      disposer.run();
      utils.remove([score, ...ripples, ...dimRidges]);
      removeRoot(root);
    },
  };
}
