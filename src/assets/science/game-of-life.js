import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'game-of-life',
  title: 'ライフゲーム',
  category: 'science',
  libs: ['animejs'],
  description:
    '升目の生き物が、コンウェイの規則（まわり 8 升のうち 3 升が生きていれば生まれ、2 升か 3 升なら生き残る）で世代を重ねます。消えた升には跡が薄く残り、通った道筋が分かります。クリックすると選んだ形の生き物を置け、押したままなぞると 1 升ずつ描けます。',
  params: {
    cell: { type: 'range', label: '升目の大きさ', min: 5, max: 24, step: 1, default: 10 },
    rate: { type: 'range', label: '1 秒あたりの世代数', min: 1, max: 30, step: 1, default: 9 },
    stamp: {
      type: 'select',
      label: 'クリックで置く形',
      options: [
        { value: 'glider', label: 'グライダー' },
        { value: 'lwss', label: '宇宙船' },
        { value: 'rpent', label: 'R ペントミノ' },
        { value: 'pulsar', label: 'パルサー' },
      ],
      default: 'glider',
    },
    alive: { type: 'color', label: '生き物の色', default: '#c8f560' },
    trail: { type: 'color', label: '跡の色', default: '#2f8f6b' },
    background: { type: 'color', label: '背景色', default: '#0b1611' },
    fade: { type: 'range', label: '跡が残る世代数', min: 0, max: 60, step: 1, default: 22 },
  },
};

const PATTERNS = {
  glider: ['.#.', '..#', '###'],
  lwss: ['.#..#', '#....', '#...#', '####.'],
  rpent: ['.##', '##.', '.#.'],
  pulsar: [
    '..###...###..',
    '.............',
    '#....#.#....#',
    '#....#.#....#',
    '#....#.#....#',
    '..###...###..',
    '.............',
    '..###...###..',
    '#....#.#....#',
    '#....#.#....#',
    '#....#.#....#',
    '.............',
    '..###...###..',
  ],
};

// 1 世代進める。端は反対側につながっている。next に結果を書き、生きている数を返す。
export function lifeStep(current, next, cols, rows) {
  let population = 0;
  for (let y = 0; y < rows; y += 1) {
    const up = ((y + rows - 1) % rows) * cols;
    const mid = y * cols;
    const down = ((y + 1) % rows) * cols;
    for (let x = 0; x < cols; x += 1) {
      const l = (x + cols - 1) % cols;
      const r = (x + 1) % cols;
      const n = current[up + l] + current[up + x] + current[up + r] + current[mid + l] + current[mid + r] + current[down + l] + current[down + x] + current[down + r];
      const live = n === 3 || (n === 2 && current[mid + x] === 1) ? 1 : 0;
      next[mid + x] = live;
      population += live;
    }
  }
  return population;
}

const CSS = `
.ua-gol{position:absolute;inset:0;overflow:hidden;container-type:size;cursor:crosshair;touch-action:none;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
.ua-gol canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.ua-gol__info{position:absolute;left:3.2cqw;top:3.2cqw;padding:.5em .8em;font-size:clamp(8px,1.45cqw,13px);line-height:1.5;letter-spacing:.1em;
  pointer-events:none;background:color-mix(in srgb,var(--ua-bg) 82%,transparent);border-left:2px solid currentColor;font-variant-numeric:tabular-nums}
.ua-gol__info b{display:block;font-weight:500}
.ua-gol__info span{display:block;opacity:.7}
`;

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const reduced = prefersReducedMotion();
  const disposer = createDisposer();
  const root = createRoot(container, 'ua-gol', { background: p.background, color: p.alive, '--ua-bg': p.background });
  const canvas = h('canvas', { 'aria-hidden': 'true' });
  const genText = h('b');
  const popText = h('span');
  root.append(canvas, h('div', { class: 'ua-gol__info' }, genText, popText, h('span', { text: 'RULE B3/S23' })));
  const ctx = canvas.getContext('2d');
  const view = { width: 1, height: 1, dpr: 1, size: p.cell, ox: 0, oy: 0 };
  const ripples = [];

  let cols = 0;
  let rows = 0;
  let cells = new Uint8Array(0);
  let buffer = new Uint8Array(0);
  let age = new Uint16Array(0); // 生きている世代数
  let dead = new Uint16Array(0); // 消えてからの世代数。0 は跡なし
  let generation = 0;
  let population = 0;
  let blend = 1; // 直前の世代から今の世代への移り変わり（0〜1）
  let history = [];

  function stamp(pattern, cx, cy) {
    const shape = PATTERNS[pattern];
    const flip = Math.random() < 0.5;
    shape.forEach((line, j) => {
      [...line].forEach((ch, i) => {
        if (ch !== '#') return;
        const x = (cx + (flip ? shape[0].length - 1 - i : i) - (shape[0].length >> 1) + cols * 4) % cols;
        const y = (cy + j - (shape.length >> 1) + rows * 4) % rows;
        if (!cells[y * cols + x]) population += 1;
        cells[y * cols + x] = 1;
        age[y * cols + x] = 0;
      });
    });
  }

  function seed() {
    cells.fill(0);
    age.fill(0);
    dead.fill(0);
    population = 0;
    generation = 0;
    history = [];
    for (let i = 0; i < cells.length; i += 1) {
      if (Math.random() < 0.24) {
        cells[i] = 1;
        population += 1;
      }
    }
  }

  function step() {
    population = lifeStep(cells, buffer, cols, rows);
    for (let i = 0; i < cells.length; i += 1) {
      if (buffer[i]) {
        age[i] = cells[i] ? Math.min(age[i] + 1, 999) : 0;
        dead[i] = 0;
      } else if (cells[i]) dead[i] = 1;
      else if (dead[i]) dead[i] = dead[i] >= p.fade ? 0 : dead[i] + 1;
    }
    [cells, buffer] = [buffer, cells];
    generation += 1;
    // 止まったり、同じ動きの繰り返しになったら、新しい生き物を落として続ける。
    history.push(population);
    if (history.length > 40) history.shift();
    const stale = history.length === 40 && new Set(history.slice(-12)).size <= 2;
    if (population === 0 || stale) {
      history = [];
      for (let i = 0; i < 4; i += 1) stamp(i % 2 ? 'rpent' : 'glider', Math.floor(Math.random() * cols), Math.floor(Math.random() * rows));
    }
  }

  function resize() {
    const rect = root.getBoundingClientRect();
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    canvas.width = Math.round(view.width * view.dpr);
    canvas.height = Math.round(view.height * view.dpr);
    // 小さな枠では升目を少し小さくして、十分な広さを取る。
    view.size = Math.max(4, p.cell * (view.width < 500 ? 0.75 : 1));
    const nextCols = Math.max(8, Math.floor(view.width / view.size));
    const nextRows = Math.max(8, Math.floor(view.height / view.size));
    view.ox = (view.width - nextCols * view.size) / 2;
    view.oy = (view.height - nextRows * view.size) / 2;
    if (nextCols !== cols || nextRows !== rows) {
      cols = nextCols;
      rows = nextRows;
      cells = new Uint8Array(cols * rows);
      buffer = new Uint8Array(cols * rows);
      age = new Uint16Array(cols * rows);
      dead = new Uint16Array(cols * rows);
      seed();
      // 始めに少し進めて、跡のある状態から見せる。
      for (let i = 0; i < (reduced ? 40 : 12); i += 1) step();
    }
    draw();
  }

  function draw() {
    const { width, height, dpr, size, ox, oy } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    // 升目の点。
    ctx.fillStyle = p.trail;
    ctx.globalAlpha = 0.22;
    if (size >= 7) {
      for (let y = 0; y <= rows; y += 1) for (let x = 0; x <= cols; x += 1) ctx.fillRect(ox + x * size - 0.5, oy + y * size - 0.5, 1, 1);
    }
    const gap = size > 7 ? 1 : 0.5;
    const pop = 0.55 + 0.45 * blend;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const i = y * cols + x;
        if (cells[i]) {
          // 生まれたばかりの升は、小さく現れて広がる。
          const s = (age[i] === 0 ? pop : 1) * (size - gap);
          const inset = (size - s) / 2;
          ctx.globalAlpha = age[i] === 0 ? 1 : Math.max(0.62, 1 - age[i] * 0.03);
          ctx.fillStyle = p.alive;
          ctx.fillRect(ox + x * size + inset, oy + y * size + inset, s, s);
        } else if (dead[i]) {
          const left = 1 - (dead[i] - 1 + blend) / (p.fade + 1);
          if (left <= 0) continue;
          ctx.globalAlpha = 0.75 * left * left;
          ctx.fillStyle = p.trail;
          ctx.fillRect(ox + x * size + gap / 2, oy + y * size + gap / 2, size - gap, size - gap);
        }
      }
    }
    // 置いた場所から広がる輪。
    ctx.strokeStyle = p.alive;
    ctx.lineWidth = 1.5;
    for (const ripple of ripples) {
      ctx.globalAlpha = 1 - ripple.t;
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, size * (1 + ripple.t * 6), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    genText.textContent = `GEN ${String(generation).padStart(5, '0')}`;
    popText.textContent = `POP ${String(population).padStart(5, '0')}  ${cols}×${rows}`;
  }

  const cellAt = (event) => {
    const { px, py } = localPointer(event, root);
    return { px, py, x: Math.floor((px - view.ox) / view.size), y: Math.floor((py - view.oy) / view.size) };
  };
  let painting = false;
  let moved = false;
  function onDown(event) {
    painting = true;
    moved = false;
  }
  function onMove(event) {
    if (!painting) return;
    const { x, y } = cellAt(event);
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    moved = true;
    if (!cells[y * cols + x]) population += 1;
    cells[y * cols + x] = 1;
    age[y * cols + x] = 0;
    if (reduced) draw();
  }
  function onUp(event) {
    if (!painting) return;
    painting = false;
    if (moved) return;
    const { px, py, x, y } = cellAt(event);
    stamp(p.stamp, Math.min(cols - 1, Math.max(0, x)), Math.min(rows - 1, Math.max(0, y)));
    history = [];
    if (reduced) {
      draw();
      return;
    }
    const ripple = { x: px, y: py, t: 0 };
    ripples.push(ripple);
    animate(ripple, { t: 1, duration: 700, ease: 'outQuad', onComplete: () => ripples.splice(ripples.indexOf(ripple), 1) });
  }
  const cancel = () => {
    painting = false;
  };
  disposer.listen(root, 'pointerdown', onDown);
  disposer.listen(root, 'pointermove', onMove);
  disposer.listen(root, 'pointerup', onUp);
  disposer.listen(root, 'pointerleave', cancel);

  const observer = new ResizeObserver(resize);
  observer.observe(root);
  disposer.add(() => observer.disconnect());
  resize();

  if (!reduced) {
    let carry = 0;
    let last = performance.now();
    const timer = createTimer({
      onUpdate() {
        const now = performance.now();
        carry += (Math.min(Math.max(now - last, 0), 100) / 1000) * p.rate;
        last = now;
        let guard = 0;
        while (carry >= 1 && guard < 4) {
          step();
          carry -= 1;
          guard += 1;
        }
        if (carry >= 1) carry = 0;
        blend = Math.min(1, carry * 1.6);
        draw();
      },
    });
    disposer.add(() => timer.pause());
  }

  return {
    destroy() {
      disposer.run();
      utils.remove(ripples);
      removeRoot(root);
    },
  };
}
