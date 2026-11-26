import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'ascii-typewriter',
  title: '打ち出される大きな文字',
  category: 'ascii',
  libs: ['animejs'],
  description:
    '入力した英数字を、小さな記号を何百個も並べた大きな字形で 1 文字ずつ打ち出します。打った瞬間は線が太くにじみ、すぐに落ち着きます。打ち終わるとカーソルが点滅し、クリックすると最初から打ち直します。タイトルの登場や、短い合言葉を見せる場面に使えます。',
  params: {
    text: { type: 'text', label: '打ち出す文字（英数字）', default: 'HELLO WORLD', maxLength: 28 },
    color: { type: 'color', label: '文字の色', default: '#f3ead7' },
    accent: { type: 'color', label: 'カーソルの色', default: '#ff5d4a' },
    background: { type: 'color', label: '背景色', default: '#1b1916' },
    speed: { type: 'range', label: '打つ速さ（1 秒あたりの文字数）', min: 2, max: 20, step: 1, default: 7 },
    loop: { type: 'boolean', label: '打ち終わったら消して打ち直す', default: true },
    detail: { type: 'range', label: '文字の細かさ', min: 0.6, max: 1.6, step: 0.1, default: 1 },
  },
};

const RAMP = ' .\'`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
const RAMP_CODES = Array.from(RAMP, (ch) => ch.charCodeAt(0));
const LAST = RAMP_CODES.length - 1;
const BASE = 12;
const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';
const SPACE = 32;
const DOT = 46;
const GLYPH_W = 5;
const GLYPH_H = 7;
const ADVANCE = 6; // 1 文字ぶんの送り（字形 5 + すき間 1）
const LINE = 9; // 1 行ぶんの高さ（字形 7 + 上下のすき間）

// 自作の 5×7 の字形。1 行を 5 桁の 0/1 で書き、描くときにこの粗い形をなめらかにふくらませる。
const FONT_SOURCE = {
  A: '01110 10001 10001 11111 10001 10001 10001',
  B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111',
  F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111',
  H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110',
  J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001',
  N: '10001 11001 10101 10011 10001 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101',
  R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 11011 10001',
  X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100',
  Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110',
  1: '00100 01100 00100 00100 00100 00100 01110',
  2: '01110 10001 00001 00010 00100 01000 11111',
  3: '11110 00001 00001 01110 00001 00001 11110',
  4: '00010 00110 01010 10010 11111 00010 00010',
  5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110',
  7: '11111 00001 00010 00100 01000 01000 01000',
  8: '01110 10001 10001 01110 10001 10001 01110',
  9: '01110 10001 10001 01111 00001 00010 01100',
  '.': '00000 00000 00000 00000 00000 00110 00110',
  ',': '00000 00000 00000 00000 00110 00100 01000',
  '!': '00100 00100 00100 00100 00100 00000 00100',
  '?': '01110 10001 00001 00010 00100 00000 00100',
  '-': '00000 00000 00000 01110 00000 00000 00000',
  ':': '00000 00110 00110 00000 00110 00110 00000',
  '+': '00000 00100 00100 11111 00100 00100 00000',
  '/': '00001 00001 00010 00100 01000 10000 10000',
  '#': '01010 01010 11111 01010 11111 01010 01010',
  "'": '00100 00100 01000 00000 00000 00000 00000',
};
const FONT = Object.fromEntries(Object.entries(FONT_SOURCE).map(([key, rows]) => [key, rows.split(' ').map((row) => parseInt(row, 2))]));

const CSS = `
.ua-atw{position:absolute;inset:0;overflow:hidden;background:var(--ua-bg);cursor:pointer}
.ua-atw__pre,.ua-atw__probe{position:absolute;left:0;top:0;margin:0;padding:0;border:0;background:none;white-space:pre;
  font:${BASE}px/${BASE}px ${MONO};letter-spacing:0;font-variant-ligatures:none}
.ua-atw__pre{transform-origin:0 0;pointer-events:none;user-select:none;color:var(--ua-fg)}
.ua-atw__pre--1{color:var(--ua-accent)}
.ua-atw__probe{visibility:hidden}
`;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const grain = (c, r) => ((((c * 73856093) ^ (r * 19349663)) >>> 0) % 1000) / 1000;

// 文字の升目を用意する。12px で組んでから transform で縮めるので、ブラウザーの最小文字サイズに左右されない。
function createSurface(root, cls, layerCount, cellPx) {
  const probe = h('span', { class: `${cls}__probe`, 'aria-hidden': 'true', text: 'M'.repeat(20) });
  const pres = Array.from({ length: layerCount }, (_, i) => h('pre', { class: `${cls}__pre ${cls}__pre--${i}`, 'aria-hidden': 'true' }));
  root.append(probe, ...pres);
  const g = { cols: 0, rows: 0, aspect: 0.6, layers: [] };
  g.fit = () => {
    const w = root.clientWidth;
    const ht = root.clientHeight;
    if (w < 8 || ht < 8) return false;
    const cw = probe.getBoundingClientRect().width / 20 || BASE * 0.6;
    const cell = cellPx(w, ht);
    const scale = cell / BASE;
    g.cols = Math.max(12, Math.floor(w / (cw * scale)));
    g.rows = Math.max(6, Math.floor(ht / cell));
    g.aspect = cw / BASE;
    g.layers = pres.map(() => new Uint16Array(g.cols * g.rows).fill(SPACE));
    const ox = (w - g.cols * cw * scale) / 2;
    const oy = (ht - g.rows * cell) / 2;
    for (const pre of pres) pre.style.transform = `translate(${ox.toFixed(2)}px,${oy.toFixed(2)}px) scale(${scale.toFixed(4)})`;
    return true;
  };
  g.flush = () => {
    pres.forEach((pre, i) => {
      const buf = g.layers[i];
      const lines = [];
      for (let r = 0; r < g.rows; r += 1) lines.push(String.fromCharCode.apply(null, buf.subarray(r * g.cols, (r + 1) * g.cols)));
      pre.textContent = lines.join('\n');
    });
  };
  g.put = (layer, row, col, text) => {
    if (row < 0 || row >= g.rows) return;
    for (let i = 0; i < text.length; i += 1) {
      const c = col + i;
      if (c >= 0 && c < g.cols) g.layers[layer][row * g.cols + c] = text.charCodeAt(i);
    }
  };
  return g;
}

// 使える文字だけを残して大文字にそろえる。何も残らなければ既定の文字にする。
export function cleanText(text) {
  const kept = Array.from(String(text).toUpperCase())
    .filter((ch) => ch === ' ' || ch in FONT)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return kept || meta.params.text.default;
}

// 単語の切れ目で折り返す。1 行に入らない長い単語は途中で切る。
export function wrapText(text, max) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    let rest = word;
    while (rest.length > max) {
      if (line) lines.push(line);
      lines.push(rest.slice(0, max));
      rest = rest.slice(max);
      line = '';
    }
    if (!line) line = rest;
    else if (line.length + 1 + rest.length <= max) line += ` ${rest}`;
    else {
      lines.push(line);
      line = rest;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const bit = (glyph, x, y) => (x < 0 || x >= GLYPH_W || y < 0 || y >= GLYPH_H ? 0 : (glyph[y] >> (GLYPH_W - 1 - x)) & 1);

// 粗い字形を、まわり 4 点の重みづけ平均で読む。0〜1 のなだらかな値になり、しきい値で線の太さを変えられる。
function coverage(glyph, fx, fy) {
  const x = fx - 0.5;
  const y = fy - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const top = bit(glyph, x0, y0) * (1 - tx) + bit(glyph, x0 + 1, y0) * tx;
  const bottom = bit(glyph, x0, y0 + 1) * (1 - tx) + bit(glyph, x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const preview = Boolean(p.preview);
  const reduced = prefersReducedMotion();
  const text = cleanText(p.text);
  const root = createRoot(container, 'ua-atw', { '--ua-bg': p.background, '--ua-fg': p.color, '--ua-accent': p.accent });
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', text);
  const disposer = createDisposer();
  const g = createSurface(root, 'ua-atw', 2, (w) => clamp(w / (preview ? 64 : 105) / p.detail, 4.5, 16));

  const longest = Math.max(...text.split(' ').map((word) => word.length));
  let lines = [];
  let starts = [];
  let unit = 1; // 字形の 1 点が占める行数
  let slots = [];
  let inks = [];
  let typed = 0;
  let phase = 'typing';
  let clock = 0;
  let nextAt = 0.45;
  let doneAt = 0;

  function layout() {
    // 枠に収まるいちばん大きな字の大きさを探す。単語を途中で切らずに済む大きさを優先する。
    let best = null;
    for (let size = Math.min(g.rows / LINE, 7); size >= 0.6; size -= 0.1) {
      const max = Math.floor((g.cols - 4) / ((ADVANCE * size) / g.aspect)) - 1;
      if (max < 1) continue;
      const wrapped = wrapText(text, max);
      if (wrapped.length * LINE * size > g.rows - 5) continue;
      if (!best) best = { size, wrapped };
      if (max >= longest) {
        best = { size, wrapped };
        break;
      }
      if (best.size - size > 1.2) break;
    }
    if (!best) best = { size: 0.6, wrapped: wrapText(text, Math.max(1, Math.floor((g.cols - 4) / ((ADVANCE * 0.6) / g.aspect)) - 1)) };
    unit = best.size;
    lines = best.wrapped;
    starts = [];
    slots = [];
    lines.forEach((line, li) => {
      starts.push(slots.length);
      for (let ci = 0; ci < line.length; ci += 1) slots.push({ line: li, col: ci, glyph: FONT[line[ci]] ?? null });
    });
    utils.remove(inks);
    inks = slots.map(() => ({ v: 1 }));
    typed = reduced ? slots.length : Math.min(typed, slots.length);
  }

  function strike(index) {
    const ink = inks[index];
    ink.v = 0.2;
    animate(ink, {
      v: [
        { to: 1.5, duration: 70, ease: 'outQuad' },
        { to: 1, duration: 460, ease: 'outElastic(1, .5)' },
      ],
    });
  }

  function restart() {
    typed = 0;
    phase = 'typing';
    nextAt = clock + 0.3;
  }

  function advance(dt) {
    clock += dt;
    if (phase === 'typing') {
      while (typed < slots.length && clock >= nextAt) {
        strike(typed);
        const pause = slots[typed].glyph ? 0.6 + Math.random() * 0.8 : 1.6;
        typed += 1;
        nextAt += pause / p.speed;
      }
      if (typed >= slots.length) {
        phase = 'done';
        doneAt = clock;
      }
    } else if (phase === 'done' && p.loop && clock - doneAt > (preview ? 3 : 4.5)) {
      phase = 'erasing';
      nextAt = clock;
    } else if (phase === 'erasing') {
      while (typed > 0 && clock >= nextAt) {
        typed -= 1;
        nextAt += 0.035;
      }
      if (typed === 0) restart();
    }
  }

  function draw() {
    const { cols, rows, aspect } = g;
    const [ink, mark] = g.layers;
    ink.fill(SPACE);
    mark.fill(SPACE);
    const wide = unit / aspect; // 字形の 1 点が占める桁数
    const top = (rows - lines.length * LINE * unit) / 2;
    const cursorLine = typed < slots.length ? slots[typed].line : lines.length - 1;
    const cursorCol = typed < slots.length ? slots[typed].col : lines[lines.length - 1].length;
    const cursorOn = phase !== 'done' || Math.floor((clock - doneAt) * 2) % 2 === 0;

    for (let r = 0; r < rows; r += 1) {
      const ly = (r + 0.5 - top) / unit;
      const li = Math.floor(ly / LINE);
      if (li < 0 || li >= lines.length) continue;
      const fy = ly - li * LINE - 1;
      const length = lines[li].length;
      const left = (cols - length * ADVANCE * wide) / 2;
      // 行の下に、便せんの罫のような点線を引く。
      const ruled = Math.floor(fy) === GLYPH_H && Math.floor(fy - 1 / unit) !== GLYPH_H;
      for (let c = 2; c < cols - 2; c += 1) {
        const index = r * cols + c;
        if (ruled && c % 2 === 0) ink[index] = DOT;
        const lx = (c + 0.5 - left) / wide;
        const ci = Math.floor(lx / ADVANCE);
        const fx = lx - ci * ADVANCE - 0.5;
        if (ci < 0 || ci > length) continue;
        if (li === cursorLine && ci === cursorCol) {
          if (cursorOn && fx >= 0 && fx <= GLYPH_W && fy >= 0 && fy <= GLYPH_H) {
            mark[index] = RAMP_CODES[LAST - 2 - Math.floor(grain(c, r) * 6)];
            ink[index] = SPACE;
          }
          continue;
        }
        if (ci >= length) continue;
        const slot = starts[li] + ci;
        const glyph = slots[slot].glyph;
        if (!glyph || slot >= typed) continue;
        // 打った直後は ink が 1 を超え、しきい値が下がって線が太くにじむ。
        const amount = inks[slot].v;
        const value = clamp((coverage(glyph, fx, fy) - (0.5 - (amount - 1) * 0.42) + 0.17) / 0.34, 0, 1);
        if (value > 0.03) ink[index] = RAMP_CODES[Math.max(1, Math.round(value * (0.82 + 0.18 * grain(c, r)) * LAST))];
        else if (coverage(glyph, fx - 0.75, fy - 0.75) > 0.5) ink[index] = DOT;
      }
    }

    const shown = slots.slice(0, typed).map((slot) => lines[slot.line][slot.col]).join('');
    g.put(0, 1, 2, `TYPE  ${p.speed} CPS`);
    g.put(0, rows - 2, 2, `> ${shown.slice(-(cols - 22))}_`);
    const counter = `${String(typed).padStart(2, '0')}/${String(slots.length).padStart(2, '0')}`;
    g.put(1, rows - 2, cols - 2 - counter.length, counter);
  }

  function tick(dt) {
    if (!g.cols || !slots.length) return;
    if (!reduced) advance(dt);
    draw();
    g.flush();
  }

  disposer.listen(root, 'pointerdown', () => {
    if (!reduced) restart();
  });

  let last = performance.now();
  const timer = reduced
    ? null
    : createTimer({
        frameRate: 30,
        onUpdate() {
          const now = performance.now();
          const dt = clamp((now - last) / 1000, 0, 0.1);
          last = now;
          tick(dt);
        },
      });

  const refit = () => {
    if (!g.fit()) return;
    layout();
    if (reduced) tick(0);
  };
  const resizeObserver = new ResizeObserver(refit);
  resizeObserver.observe(root);
  const intersectionObserver = new IntersectionObserver((entries) => {
    if (!timer) return;
    if (entries.at(-1).isIntersecting) {
      last = performance.now();
      timer.resume();
    } else timer.pause();
  });
  intersectionObserver.observe(root);
  refit();

  return {
    destroy() {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      timer?.pause();
      utils.remove(inks);
      disposer.run();
      removeRoot(root);
    },
  };
}
