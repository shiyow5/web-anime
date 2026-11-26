import { animate, createDrawable, createTimeline, stagger, steps, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'circuit-pulse',
  title: '回路を走る光',
  category: 'cyber',
  libs: ['animejs'],
  description:
    '乱数から配線を引いた基板の上を、光の粒が配線に沿って走ります。粒が出入りするたびに、部品の端子と配線の終点が点灯します。ポインターのまわりは基板が明るくなり、タップすると、その位置に探針の輪が絞り込まれて信号が注入され、波の輪が広がるのに合わせて、近い配線から順に光が枝分かれして走り、波が届いた部品が明滅します。',
  params: {
    pulse: { type: 'color', label: '光の色', default: '#ffd166' },
    trace: { type: 'color', label: '配線の色', default: '#2f8f77' },
    part: { type: 'color', label: '端子の色', default: '#ff8a4c' },
    background: { type: 'color', label: '基板の色', default: '#071814' },
    speed: { type: 'range', label: '光の速さ', min: 0.3, max: 3, step: 0.1, default: 1 },
    seed: { type: 'range', label: '配線の種', min: 1, max: 99, step: 1, default: 12 },
  },
};

const CSS = `
.ua-cp{position:absolute;inset:0;overflow:hidden;cursor:pointer;background:var(--ua-bg)}
.ua-cp svg{position:absolute;inset:0;width:100%;height:100%}
.ua-cp__light{position:absolute;inset:0;pointer-events:none;mix-blend-mode:screen;
  background:radial-gradient(circle at var(--mx,50%) var(--my,45%),color-mix(in srgb,var(--ua-trace) 42%,transparent),transparent 42%)}
.ua-cp__shade{position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 50% 50%,transparent 45%,rgba(0,0,0,.55))}
.ua-cp__dot{fill:var(--ua-trace);opacity:.35}
.ua-cp__trace{fill:none;stroke:var(--ua-trace);stroke-width:2.4;stroke-linejoin:round;stroke-linecap:round;opacity:.8}
.ua-cp__under{fill:none;stroke:#000;stroke-width:6;stroke-linejoin:round;opacity:.35}
.ua-cp__glow{fill:none;stroke:var(--ua-pulse);stroke-width:9;stroke-linejoin:round;opacity:.22}
.ua-cp__spark{fill:none;stroke:var(--ua-pulse);stroke-width:2.6;stroke-linejoin:round}
.ua-cp__via{fill:var(--ua-bg);stroke:var(--ua-trace);stroke-width:2}
.ua-cp__lit{fill:var(--ua-pulse);opacity:0}
.ua-cp__halo{fill:var(--ua-pulse);opacity:0}
.ua-cp__pin{fill:var(--ua-part);opacity:.55}
.ua-cp__chip{fill:color-mix(in srgb,var(--ua-bg) 55%,#000);stroke:color-mix(in srgb,var(--ua-trace) 70%,#fff);stroke-width:1.2}
.ua-cp__die{fill:none;stroke:var(--ua-trace);stroke-width:1;opacity:.7}
.ua-cp__core{fill:var(--ua-pulse);opacity:.25;transform-box:fill-box;transform-origin:center}
.ua-cp__label{fill:color-mix(in srgb,var(--ua-trace) 60%,#fff);font:600 9px ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.12em;opacity:.8}
.ua-cp__pad{fill:var(--ua-part);opacity:.7}
.ua-cp__body{fill:color-mix(in srgb,var(--ua-part) 25%,#000);stroke:var(--ua-part);stroke-width:.8;opacity:.9}
.ua-cp__group{transform-box:fill-box;transform-origin:center}
`;

const CELL = 40;
const COLS = 20;
const ROWS = 15;
const DIRS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

function mulberry(seed) {
  let a = seed * 2654435761;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 部品の置き場所と配線を決める。座標はすべて升目の番号で持つ。
export function layoutBoard(seed) {
  const random = mulberry(seed);
  const int = (min, max) => min + Math.floor(random() * (max - min + 1));
  const taken = new Set();
  const key = (x, y) => `${x},${y}`;
  const block = (x0, y0, x1, y1) => {
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) taken.add(key(x, y));
  };

  const chips = [{ x: 8, y: 5, w: 4, h: 4, name: 'U1', code: 'KX-4096', cpu: true }];
  const slots = [
    [int(2, 3), int(2, 3)],
    [int(14, 15), int(1, 2)],
    [int(2, 3), int(10, 11)],
    [int(14, 15), int(10, 11)],
  ];
  slots.forEach(([x, y], i) => chips.push({ x, y, w: 3, h: 2, name: `U${i + 2}`, code: ['RM-08', 'IO-22', 'PW-5V', 'DA-16'][i], cpu: false }));
  for (const chip of chips) block(chip.x, chip.y, chip.x + chip.w, chip.y + chip.h);

  const parts = [];
  for (let i = 0; i < 7; i += 1) {
    const x = int(1, COLS - 2);
    const y = int(1, ROWS - 1);
    const vertical = random() < 0.5;
    const x1 = vertical ? x : x + 1;
    const y1 = vertical ? y + 1 : y;
    if (y1 > ROWS - 1 || taken.has(key(x, y)) || taken.has(key(x1, y1))) continue;
    block(x, y, x1, y1);
    parts.push({ x, y, vertical, name: `${random() < 0.5 ? 'R' : 'C'}${i + 1}` });
  }

  const pins = [];
  for (const chip of chips) {
    const inset = chip.cpu ? 1 : 0;
    for (let x = chip.x + inset; x <= chip.x + chip.w - inset; x += 1) {
      pins.push({ x, y: chip.y, dir: 6, chip });
      pins.push({ x, y: chip.y + chip.h, dir: 2, chip });
    }
    if (chip.cpu) {
      for (let y = chip.y + 1; y <= chip.y + chip.h - 1; y += 1) {
        pins.push({ x: chip.x, y, dir: 4, chip });
        pins.push({ x: chip.x + chip.w, y, dir: 0, chip });
      }
    }
  }

  const traces = [];
  for (const pin of pins) {
    const points = [[pin.x, pin.y]];
    let [cx, cy] = points[0];
    let dir = pin.dir;
    const length = int(3, 9);
    let moved = 0;
    for (let i = 0; i < length; i += 1) {
      let next = dir;
      if (i > 0 && random() < 0.38) next = (pin.dir + int(-1, 1) + 8) % 8;
      const [dx, dy] = DIRS[next];
      const nx = cx + dx;
      const ny = cy + dy;
      const diagonal = dx !== 0 && dy !== 0;
      if (nx < 1 || nx > COLS - 1 || ny < 1 || ny > ROWS - 1 || taken.has(key(nx, ny))) break;
      if (diagonal && taken.has(key(cx + dx / 2, cy + dy / 2))) break;
      if (next !== dir) {
        points.push([cx, cy]);
        dir = next;
      }
      taken.add(key(nx, ny));
      if (diagonal) taken.add(key(cx + dx / 2, cy + dy / 2));
      cx = nx;
      cy = ny;
      moved += 1;
    }
    if (moved === 0) continue;
    points.push([cx, cy]);
    let total = 0;
    for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    traces.push({ pin, points, length: total * CELL, reverse: random() < 0.4, wait: random() });
  }
  return { chips, parts, traces };
}

let uid = 0;

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-cp', { '--ua-bg': p.background, '--ua-pulse': p.pulse, '--ua-trace': p.trace, '--ua-part': p.part });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const board = layoutBoard(Math.round(p.seed));
  uid += 1;
  const patternId = `ua-cp-grid-${uid}`;

  const defs = s('defs', {}, s('pattern', { id: patternId, width: CELL, height: CELL, patternUnits: 'userSpaceOnUse' }, s('circle', { class: 'ua-cp__dot', cx: 0.8, cy: 0.8, r: 0.8 })));
  const grid = s('rect', { x: 0, y: 0, width: COLS * CELL, height: ROWS * CELL, fill: `url(#${patternId})` });

  const traceLayer = s('g');
  const pulseLayer = s('g');
  const pinLayer = s('g');
  const runners = board.traces.map((trace) => {
    const d = trace.points.map(([x, y], i) => `${i ? 'L' : 'M'}${x * CELL} ${y * CELL}`).join('');
    const [sx, sy] = trace.points[0];
    const [ex, ey] = trace.points.at(-1);
    const [dx, dy] = DIRS[trace.pin.dir];
    const dash = Math.min(70, trace.length * 0.6);
    const dashStyle = { strokeDasharray: `${dash} ${trace.length + dash}`, strokeDashoffset: `${dash}` };
    const base = s('path', { class: 'ua-cp__trace', d });
    const glow = s('path', { class: 'ua-cp__glow', d, style: dashStyle });
    const spark = s('path', { class: 'ua-cp__spark', d, style: dashStyle });
    const pinBox = { x: sx * CELL - 4 + dx * 13, y: sy * CELL - 4 + dy * 13, width: 8, height: 8 };
    const pinLit = s('rect', { class: 'ua-cp__lit', ...pinBox });
    const pinHalo = s('circle', { class: 'ua-cp__halo', cx: sx * CELL + dx * 13, cy: sy * CELL + dy * 13, r: 13 });
    const viaLit = s('circle', { class: 'ua-cp__lit', cx: ex * CELL, cy: ey * CELL, r: 3.2 });
    const viaHalo = s('circle', { class: 'ua-cp__halo', cx: ex * CELL, cy: ey * CELL, r: 13 });
    traceLayer.append(s('path', { class: 'ua-cp__under', d, transform: 'translate(2 3)' }), base, s('circle', { class: 'ua-cp__via', cx: ex * CELL, cy: ey * CELL, r: 5 }));
    pulseLayer.append(glow, spark, viaHalo, viaLit);
    pinLayer.append(s('rect', { class: 'ua-cp__pin', ...pinBox }), pinHalo, pinLit);
    return { trace, dash, base, glow, spark, pinLit, pinHalo, viaLit, viaHalo, timeline: null };
  });

  const chipLayer = s('g');
  let core = null;
  const chipGroups = board.chips.map((chip) => {
    const x = chip.x * CELL - 10;
    const y = chip.y * CELL - 10;
    const w = chip.w * CELL + 20;
    const hgt = chip.h * CELL + 20;
    const group = s('g', { class: 'ua-cp__group' }, s('rect', { class: 'ua-cp__chip', x, y, width: w, height: hgt, rx: 5 }));
    group.append(s('circle', { class: 'ua-cp__pad', cx: x + 9, cy: y + 9, r: 2.2 }));
    if (chip.cpu) {
      const cx = x + w / 2;
      const cy = y + hgt / 2;
      for (const size of [112, 84]) group.append(s('rect', { class: 'ua-cp__die', x: cx - size / 2, y: cy - size / 2, width: size, height: size, rx: 2 }));
      for (let i = -3; i <= 3; i += 1) {
        group.append(s('line', { class: 'ua-cp__die', x1: cx + i * 12, y1: cy - 56, x2: cx + i * 12, y2: cy - 42 }));
        group.append(s('line', { class: 'ua-cp__die', x1: cx + i * 12, y1: cy + 42, x2: cx + i * 12, y2: cy + 56 }));
      }
      core = s('rect', { class: 'ua-cp__core', x: cx - 26, y: cy - 26, width: 52, height: 52, rx: 3 });
      group.append(core, s('text', { class: 'ua-cp__label', x: cx, y: cy + 3, 'text-anchor': 'middle', text: chip.code }));
    } else {
      group.append(s('text', { class: 'ua-cp__label', x: x + w / 2, y: y + hgt / 2 - 2, 'text-anchor': 'middle', text: chip.code }));
      group.append(s('line', { class: 'ua-cp__die', x1: x + 22, y1: y + hgt / 2 + 10, x2: x + w - 22, y2: y + hgt / 2 + 10 }));
    }
    group.append(s('text', { class: 'ua-cp__label', x: x + 2, y: y - 5, text: chip.name }));
    chipLayer.append(group);
    return group;
  });
  for (const part of board.parts) {
    const x = part.x * CELL;
    const y = part.y * CELL;
    const [ox, oy] = part.vertical ? [0, CELL] : [CELL, 0];
    chipLayer.append(
      s('rect', { class: 'ua-cp__pad', x: x - 5, y: y - 5, width: 10, height: 10, rx: 1.5 }),
      s('rect', { class: 'ua-cp__pad', x: x + ox - 5, y: y + oy - 5, width: 10, height: 10, rx: 1.5 }),
      s('rect', { class: 'ua-cp__body', x: x + ox / 2 - (part.vertical ? 6 : 11), y: y + oy / 2 - (part.vertical ? 11 : 6), width: part.vertical ? 12 : 22, height: part.vertical ? 22 : 12, rx: 2 }),
      s('text', { class: 'ua-cp__label', x: x + (part.vertical ? 12 : 0), y: y + (part.vertical ? 24 : -11), text: part.name }),
    );
  }

  const light = h('div', { class: 'ua-cp__light' });
  root.append(
    s('svg', { viewBox: `0 0 ${COLS * CELL} ${ROWS * CELL}`, preserveAspectRatio: 'xMidYMid slice', role: 'img', 'aria-label': '光の走る回路基板' }, defs, grid, traceLayer, chipLayer, pinLayer, pulseLayer),
    light,
    h('div', { class: 'ua-cp__shade' }),
  );

  if (reduced) {
    for (const runner of runners.filter((_, i) => i % 3 === 0)) {
      runner.spark.style.strokeDashoffset = `${-runner.trace.length * 0.4}`;
      runner.glow.style.strokeDashoffset = `${-runner.trace.length * 0.4}`;
      runner.pinLit.style.opacity = '1';
    }
    return { destroy: () => removeRoot(root) };
  }

  animate(createDrawable(runners.map((r) => r.base)), { draw: ['0 0', '0 1'], duration: 900, ease: 'inOutQuad', delay: stagger(14) });
  animate(chipGroups, { opacity: [0, 1], scale: [0.86, 1], duration: 700, ease: 'outBack(2)', delay: stagger(110) });
  if (core) animate(core, { opacity: [0.18, 0.6], scale: [0.92, 1.04], duration: 1300, ease: 'inOutSine', loop: true, alternate: true });

  const flashOf = (lit, halo, at) => [
    [lit, { opacity: [1, 0], duration: 900, ease: 'outQuad' }, at],
    [halo, { opacity: [0.4, 0], duration: 700, ease: 'outQuad' }, at],
  ];
  // 小さな枠では、光らせる配線を半分にして軽くする。
  const active = runners.filter((_, i) => !p.preview || i % 2 === 0);
  for (const runner of active) {
    const { trace, dash } = runner;
    const travel = (trace.length + dash) / (0.26 * p.speed);
    const timeline = createTimeline({ loop: true, delay: 1100 + trace.wait * 2600, loopDelay: 500 + trace.wait * 2400 });
    const [startLit, startHalo, endLit, endHalo] = trace.reverse
      ? [runner.viaLit, runner.viaHalo, runner.pinLit, runner.pinHalo]
      : [runner.pinLit, runner.pinHalo, runner.viaLit, runner.viaHalo];
    timeline.add([runner.spark, runner.glow], { strokeDashoffset: trace.reverse ? [-trace.length, dash] : [dash, -trace.length], duration: travel, ease: 'linear' }, 0);
    for (const args of [...flashOf(startLit, startHalo, 0), ...flashOf(endLit, endHalo, travel * 0.9)]) timeline.add(...args);
    runner.timeline = timeline;
    disposer.add(() => timeline.pause());
  }

  // 信号の注入。タップした位置に探針の輪が絞り込まれ（準備）、そこから波の輪が広がって、近い配線から順に、
  // タップに近い端を起点にして光が走り、波が届いた部品が順に明滅する（山場）。そのあと、ふだんの流れに戻る（余韻）。
  const svg = root.querySelector('svg');
  const probe = s('circle', { cx: 0, cy: 0, r: 6, fill: 'none', stroke: p.pulse, 'stroke-width': 2, opacity: 0, 'pointer-events': 'none' });
  const wave = s('circle', { cx: 0, cy: 0, r: 6, fill: 'none', stroke: p.pulse, 'stroke-width': 1.5, opacity: 0, 'pointer-events': 'none' });
  svg.append(wave, probe);
  const WAVE_MS = 1.15;
  const shots = new Set();
  function surge(event) {
    let x = (0.2 + Math.random() * 0.6) * COLS * CELL;
    let y = (0.25 + Math.random() * 0.5) * ROWS * CELL;
    const matrix = event?.clientX === undefined ? null : svg.getScreenCTM();
    if (matrix) ({ x, y } = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()));
    for (const shot of shots) shot.pause();
    shots.clear();
    utils.remove([probe, wave, ...chipGroups]);
    for (const circle of [probe, wave]) {
      circle.setAttribute('cx', x.toFixed(1));
      circle.setAttribute('cy', y.toFixed(1));
    }
    const reach = Math.hypot(COLS * CELL, ROWS * CELL);
    animate(probe, {
      r: [70, 7],
      opacity: [
        { to: 1, duration: 200 },
        { to: 0, duration: 500, delay: 300 },
      ],
      duration: 240,
      ease: 'outExpo',
    });
    animate(wave, { r: [7, reach], opacity: [0.8, 0], duration: reach * WAVE_MS, delay: 200, ease: 'linear' });
    for (const runner of active) {
      const { trace, dash } = runner;
      const [sx, sy] = trace.points[0];
      const [ex, ey] = trace.points.at(-1);
      const fromStart = Math.hypot(sx * CELL - x, sy * CELL - y);
      const fromEnd = Math.hypot(ex * CELL - x, ey * CELL - y);
      const backward = fromEnd < fromStart;
      const delay = 200 + Math.min(fromStart, fromEnd) * WAVE_MS;
      const [firstLit, firstHalo, lastLit, lastHalo] = backward
        ? [runner.viaLit, runner.viaHalo, runner.pinLit, runner.pinHalo]
        : [runner.pinLit, runner.pinHalo, runner.viaLit, runner.viaHalo];
      const travel = (trace.length + dash) / 0.7;
      runner.timeline.pause();
      utils.set([runner.spark, runner.glow], { strokeDashoffset: dash });
      const shot = createTimeline({
        delay,
        onComplete() {
          shots.delete(shot);
          runner.timeline.restart();
        },
      }).add([runner.spark, runner.glow], { strokeDashoffset: backward ? [-trace.length, dash] : [dash, -trace.length], duration: travel, ease: 'outQuad', composition: 'none' }, 0);
      // ふだんの流れの動きを消してしまわないように、重ねがけの扱いを切って足す。
      for (const [target, values, at] of [...flashOf(firstLit, firstHalo, 0), ...flashOf(lastLit, lastHalo, travel * 0.8)]) shot.add(target, { ...values, composition: 'none' }, at);
      shots.add(shot);
    }
    board.chips.forEach((chip, i) => {
      const distance = Math.hypot((chip.x + chip.w / 2) * CELL - x, (chip.y + chip.h / 2) * CELL - y);
      animate(chipGroups[i], {
        opacity: [
          { to: 0.3, duration: 70, ease: steps(1) },
          { to: 1, duration: 70, ease: steps(1) },
          { to: 0.5, duration: 70, ease: steps(1) },
          { to: 1, duration: 420, ease: 'outQuad' },
        ],
        scale: [
          { to: 1.05, duration: 140, ease: 'outQuad' },
          { to: 1, duration: 700, ease: 'outElastic(1, .5)' },
        ],
        delay: 200 + distance * WAVE_MS,
      });
      if (chip.cpu && core) animate(core, { opacity: [1, 0.3], scale: [1.5, 1], duration: 900, delay: 200 + distance * WAVE_MS, ease: 'outExpo' });
    });
  }
  disposer.add(() => {
    for (const shot of shots) shot.pause();
  });
  disposer.listen(root, 'click', surge);
  if (p.preview) disposer.interval(() => surge(), 4800);
  disposer.listen(root, 'pointermove', (event) => {
    const { x, y } = localPointer(event, root);
    light.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    light.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
  });
  if (p.preview) {
    const drift = { a: 0 };
    animate(drift, {
      a: Math.PI * 2,
      duration: 9000,
      ease: 'linear',
      loop: true,
      onUpdate() {
        light.style.setProperty('--mx', `${50 + Math.cos(drift.a) * 30}%`);
        light.style.setProperty('--my', `${50 + Math.sin(drift.a) * 26}%`);
      },
    });
    disposer.add(() => utils.remove(drift));
  }

  return {
    surge,
    destroy() {
      disposer.run();
      utils.remove([probe, wave, ...chipGroups]);
      removeRoot(root);
    },
  };
}
