import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'ascii-clock',
  title: '文字の時計',
  category: 'ascii',
  libs: ['animejs'],
  description:
    '現在の時刻を、小さな記号を並べた大きな数字で表示します。まわりの輪には 60 個の印が並び、秒を表す記号が 1 秒ごとに弾みながら次の印へ進みます。数字が変わるときは上から下へ書き換わります。タップするとぜんまいを巻いたように、秒の記号がいったん後ろへ引いてから輪を 1 周駆け抜け、数字が左から順に回って今の時刻に止まり、触った場所から文字の輪が広がります。待ち受け画面や、作業中に置いておく時計として使えます。',
  params: {
    format: {
      type: 'select',
      label: '時刻の表し方',
      options: [
        { value: '24', label: '24 時間制' },
        { value: '12', label: '12 時間制' },
      ],
      default: '24',
    },
    color: { type: 'color', label: '文字の色', default: '#9bf0c1' },
    accent: { type: 'color', label: '秒の記号の色', default: '#ffe9a8' },
    background: { type: 'color', label: '背景色', default: '#07130f' },
    date: { type: 'boolean', label: '日付を出す', default: true },
    detail: { type: 'range', label: '文字の細かさ', min: 0.6, max: 1.6, step: 0.1, default: 1 },
  },
};

const RAMP = ' .\'`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
const RAMP_CODES = Array.from(RAMP, (ch) => ch.charCodeAt(0));
const LAST = RAMP_CODES.length - 1;
const BASE = 12;
const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';
const SPACE = 32;
const GLYPH_W = 5;
const GLYPH_H = 7;
// 「時時:分分」の 5 つの字の左端（字形の点を単位とする）。コロンは幅を詰めて置く。
const OFFSETS = [0, 6, 11.5, 16, 22];
const TOTAL_W = 27;
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const TRAIL = ['*', '+', '+', ':', ':', '.', '.'];

// 自作の 5×7 の字形。描くときにこの粗い形をなめらかにふくらませる。
const FONT_SOURCE = {
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
  ':': '00000 00110 00110 00000 00110 00110 00000',
};
const FONT = Object.fromEntries(Object.entries(FONT_SOURCE).map(([key, rows]) => [key, rows.split(' ').map((row) => parseInt(row, 2))]));

const CSS = `
.ua-acl{position:absolute;inset:0;overflow:hidden;background:var(--ua-bg)}
.ua-acl__pre,.ua-acl__probe{position:absolute;left:0;top:0;margin:0;padding:0;border:0;background:none;white-space:pre;
  font:${BASE}px/${BASE}px ${MONO};letter-spacing:0;font-variant-ligatures:none}
.ua-acl__pre{transform-origin:0 0;pointer-events:none;user-select:none;color:var(--ua-fg)}
.ua-acl__pre--1{color:var(--ua-accent)}
.ua-acl__probe{visibility:hidden}
`;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pad = (n) => String(n).padStart(2, '0');
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
      const c = Math.round(col) + i;
      if (c >= 0 && c < g.cols) g.layers[layer][row * g.cols + c] = text.charCodeAt(i);
    }
  };
  return g;
}

// 時刻を「HH:MM」の 5 文字にする。12 時間制では 0 時を 12 時と表す。
export function clockText(date, hour12 = false) {
  const hours = hour12 ? date.getHours() % 12 || 12 : date.getHours();
  return `${pad(hours)}:${pad(date.getMinutes())}`;
}

const bit = (glyph, x, y) => (x < 0 || x >= GLYPH_W || y < 0 || y >= GLYPH_H ? 0 : (glyph[y] >> (GLYPH_W - 1 - x)) & 1);

// 粗い字形を、まわり 4 点の重みづけ平均で読む。0〜1 のなだらかな値になる。
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
  const root = createRoot(container, 'ua-acl', { '--ua-bg': p.background, '--ua-fg': p.color, '--ua-accent': p.accent });
  root.setAttribute('role', 'timer');
  const disposer = createDisposer();
  const g = createSurface(root, 'ua-acl', 2, (w) => clamp(w / (preview ? 64 : 105) / p.detail, 4.5, 16));

  const slots = Array.from({ length: 5 }, () => ({ from: null, to: null, mix: 1 }));
  const hand = { pos: new Date().getSeconds() };
  const intro = { v: reduced ? 1 : 0 };
  let lastSecond = -1;
  let spin = 0;
  let ringTurn = 0;
  // タップの仕掛け。lap は秒の記号が余分に回る量（1 で 1 周）、rush は輪の回る勢い、wave は触った場所から広がる輪。
  const wind = { lap: 0, rush: 0, wave: -1 };
  const tap = { x: 0.5, y: 0.5 };
  const rollUntil = [0, 0, 0, 0, 0];
  const ROLLING = [0, 1, 3, 4];

  // ぜんまいを巻く。準備で秒の記号が後ろへ引き、山場で 1 周駆け抜けて数字が回り、余韻で輪の回転がゆっくり落ち着く。
  function windUp(event) {
    if (reduced) return;
    const local = event && g.cols ? localPointer(event, root) : { x: 0.5, y: 0.5 };
    tap.x = local.x;
    tap.y = local.y;
    utils.remove(wind);
    wind.lap = 0;
    wind.wave = 0;
    animate(wind, {
      lap: [
        { to: -0.1, duration: 220, ease: 'outQuad' },
        { to: 1, duration: 1500, ease: 'inOutCubic' },
      ],
      rush: [
        { to: -0.4, duration: 220, ease: 'outQuad' },
        { to: 1, duration: 520, ease: 'outQuad' },
        { to: 0, duration: 1900, ease: 'outCubic' },
      ],
      wave: { to: 1, duration: 1700, ease: 'outQuad' },
      onComplete() {
        wind.lap = 0;
        wind.wave = -1;
      },
    });
    // 数字は左から順に、時間差で止まる。
    ROLLING.forEach((k, order) => {
      rollUntil[k] = spin + 0.55 + order * 0.24;
    });
  }

  // 時刻を読み、変わった数字は書き換えを始め、秒の記号を次の印へ弾ませる。
  function sync(now) {
    const text = clockText(now, p.format === '12');
    slots.forEach((slot, i) => {
      if (slot.to === text[i]) return;
      slot.from = slot.to;
      slot.to = text[i];
      if (slot.from === null || reduced) {
        slot.mix = 1;
        return;
      }
      utils.remove(slot);
      slot.mix = 0;
      animate(slot, { mix: 1, duration: 620, ease: 'inOutCubic' });
    });
    const second = now.getSeconds();
    if (second === lastSecond) return;
    lastSecond = second;
    root.setAttribute('aria-label', `${text.slice(0, 2)}時${text.slice(3)}分`);
    utils.remove(hand);
    if (reduced) {
      hand.pos = second;
      return;
    }
    if (second < hand.pos) hand.pos -= 60;
    animate(hand, { pos: second, duration: 520, ease: 'outElastic(1, .55)' });
  }

  function draw(dt) {
    const { cols, rows, aspect } = g;
    const [ink, mark] = g.layers;
    ink.fill(SPACE);
    mark.fill(SPACE);
    const now = new Date();
    sync(now);
    spin += dt;
    ringTurn += dt * (1 + wind.rush * 45);
    // 回っている数字を進め、時間が来たものから今の時刻へ書き換える。
    for (const k of ROLLING) {
      if (!rollUntil[k]) continue;
      const slot = slots[k];
      if (spin < rollUntil[k]) slot.roll = String((Math.floor(spin * 16) * 7 + k * 3) % 10);
      else {
        rollUntil[k] = 0;
        slot.from = slot.roll ?? slot.to;
        slot.roll = null;
        utils.remove(slot);
        slot.mix = 0;
        animate(slot, { mix: 1, duration: 620, ease: 'inOutCubic' });
      }
    }
    const rollShift = ((spin * 16) % 1) - 0.5;
    const cx = cols / 2;
    const cy = rows / 2;
    const rx = cols / 2 - 4;
    const ry = rows / 2 - 2.5;
    const plot = (layer, col, row, ch) => {
      const c = Math.round(col);
      const r = Math.round(row);
      if (c >= 0 && c < cols && r >= 0 && r < rows) g.layers[layer][r * cols + c] = ch.charCodeAt(0);
    };
    const angleOf = (pos) => (pos / 60) * Math.PI * 2 - Math.PI / 2;

    // 内側の細い点の輪。ゆっくり回って、止まった絵に見えないようにする。
    const dots = Math.max(60, Math.round(cols * 0.9));
    for (let i = 0; i < dots; i += 1) {
      if (i / dots > intro.v) break;
      if ((i + Math.floor(spin * 3)) % 4 === 0) continue;
      const angle = (i / dots) * Math.PI * 2 + ringTurn * 0.05;
      plot(0, cx + Math.cos(angle) * rx * 0.88, cy + Math.sin(angle) * ry * 0.86, '.');
    }
    // 触った場所から広がる文字の輪。数字や印はこの上に描く。
    if (wind.wave >= 0 && wind.wave < 1) {
      const reach = wind.wave * Math.max(cols * aspect, rows) * 1.05;
      const steps = Math.max(12, Math.ceil(reach * 5));
      const ch = wind.wave < 0.35 ? '*' : wind.wave < 0.7 ? ':' : '.';
      for (let s = 0; s < steps; s += 1) {
        if (wind.wave > 0.5 && s % 2) continue;
        const angle = (s / steps) * Math.PI * 2;
        plot(1, tap.x * cols + (Math.cos(angle) * reach) / aspect, tap.y * rows + Math.sin(angle) * reach, ch);
      }
    }
    // 60 個の印。過ぎた秒は濃く、これからの秒は淡く描く。
    const second = lastSecond;
    const headPos = hand.pos + wind.lap * 60;
    const swept = wind.lap * 60;
    for (let i = 0; i < 60; i += 1) {
      if (i / 60 > intro.v) break;
      const angle = angleOf(i);
      const x = cx + Math.cos(angle) * rx;
      const y = cy + Math.sin(angle) * ry;
      const passed = i <= second;
      // 駆け抜けた直後の印は、別の色で光らせる。
      const behind = (((i - hand.pos) % 60) + 60) % 60;
      if (swept > 0 && behind < swept && behind > swept - 16) {
        plot(1, x, y, i % 5 === 0 ? '#' : swept - behind < 6 ? '*' : '+');
        continue;
      }
      if (i % 5 === 0) {
        plot(0, x, y, passed ? '#' : '+');
        const label = pad(i);
        g.put(0, Math.round(cy + Math.sin(angle) * (ry - 2)), cx + Math.cos(angle) * (rx - 5) - 1, label);
      } else plot(0, x, y, passed ? 'o' : ':');
    }
    // 秒の記号と、その後ろに続く尾。
    for (let k = TRAIL.length; k >= 1; k -= 1) {
      const angle = angleOf(headPos - k * (0.3 + Math.max(0, wind.rush) * 0.9));
      plot(1, cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry, TRAIL[k - 1]);
    }
    const headAngle = angleOf(headPos);
    const hx = Math.round(cx + Math.cos(headAngle) * rx);
    const hy = Math.round(cy + Math.sin(headAngle) * ry);
    g.put(1, hy, hx - 1, '(@)');
    for (let c = hx - 1; c <= hx + 1; c += 1) if (c >= 0 && c < cols && hy >= 0 && hy < rows) ink[hy * cols + c] = SPACE;

    // 大きな数字。横は輪の内側に収まる幅、縦は少し引き伸ばして背を高くする。
    const ux = Math.max(1, (cols * 0.54) / TOTAL_W);
    const uy = Math.max(0.7, Math.min(ux * aspect * 1.7, (rows * 0.4) / GLYPH_H));
    const left = cx - (TOTAL_W * ux) / 2;
    const top = cy - (GLYPH_H * uy) / 2 - (p.date ? 1.5 : 0);
    const r0 = Math.max(0, Math.floor(top - uy));
    const r1 = Math.min(rows - 1, Math.ceil(top + (GLYPH_H + 1) * uy));
    const c0 = Math.max(0, Math.floor(left - ux));
    const c1 = Math.min(cols - 1, Math.ceil(left + (TOTAL_W + 1) * ux));
    const colonOn = now.getMilliseconds() < 500 || reduced;
    const weight = 0.5 + (1 - intro.v) * 0.45;
    for (let r = r0; r <= r1; r += 1) {
      const fy = (r + 0.5 - top) / uy;
      for (let c = c0; c <= c1; c += 1) {
        const fxAll = (c + 0.5 - left) / ux;
        let best = 0;
        let flash = false;
        for (let k = 0; k < 5; k += 1) {
          const fx = fxAll - OFFSETS[k];
          if (fx < -0.5 || fx > GLYPH_W + 0.5) continue;
          const slot = slots[k];
          // 書き換えの境目より上は新しい数字、下は古い数字。
          const line = slot.mix * (GLYPH_H + 1.2) - 0.6;
          const key = slot.roll ?? (slot.mix >= 1 || fy < line ? slot.to : slot.from);
          const glyph = FONT[key];
          if (!glyph) continue;
          let cover = coverage(glyph, fx, slot.roll ? fy + rollShift * 2.4 : fy);
          if (k === 2 && !colonOn) cover *= 0.72;
          if (cover > best) best = cover;
          if (!slot.roll && slot.mix < 1 && Math.abs(fy - line) < 0.5 / uy + 0.2 && fx > -0.3 && fx < GLYPH_W + 0.3) flash = true;
        }
        const index = r * cols + c;
        if (flash) {
          mark[index] = 61; // =
          ink[index] = SPACE;
          continue;
        }
        const value = clamp((best - weight + 0.17) / 0.34, 0, 1);
        if (value > 0.03) {
          ink[index] = RAMP_CODES[Math.max(1, Math.round(value * (0.82 + 0.18 * grain(c, r)) * LAST))];
          mark[index] = SPACE;
        }
      }
    }

    // 数字の下に、秒と日付を小さく添える。
    const below = Math.round(top + GLYPH_H * uy) + 1;
    const small = `${p.format === '12' ? (now.getHours() < 12 ? 'AM ' : 'PM ') : ''}:${pad(now.getSeconds())}`;
    g.put(1, below, cx - small.length / 2, small);
    if (p.date) {
      const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${DAYS[now.getDay()]}`;
      g.put(0, below + 2, cx - date.length / 2, date);
    }
  }

  function tick(dt) {
    if (!g.cols) return;
    draw(dt);
    g.flush();
  }

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
  // 動きを止める設定でも時計としては進める。1 秒ごとに、動きなしで描き直す。
  if (reduced) disposer.interval(() => tick(0), 1000);
  else animate(intro, { v: 1, duration: 1500, ease: 'outCubic' });
  disposer.listen(root, 'pointerdown', windUp);
  if (preview && !reduced) disposer.interval(() => windUp(), 6500);

  const refit = () => {
    if (g.fit() && reduced) tick(0);
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
    windUp,
    destroy() {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      timer?.pause();
      utils.remove(intro);
      utils.remove(hand);
      utils.remove(wind);
      utils.remove(slots);
      disposer.run();
      removeRoot(root);
    },
  };
}
