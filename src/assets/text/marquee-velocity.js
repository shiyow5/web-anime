import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams, splitList } from '../../lib/params.js';

export const meta = {
  id: 'marquee-velocity',
  title: '流れる帯文字',
  category: 'text',
  libs: ['animejs'],
  description:
    '文字の帯が上下 2 段で、逆向きに途切れずに流れます。ポインターを速く動かすと加速して、動かした向きへ斜めに傾き、手を止めるとゆっくり元の速さに戻ります。帯をタップすると、その段がつっかえて止まり、はじかれたように逆向きへ飛び出して、そのまま流れる向きが入れ替わります。もう一方の段は反動で押し戻されてから追いかけます。売り出しの告知や、ページの区切りの帯に使います。',
  params: {
    text: { type: 'text', label: '文（/ で区切る）', default: '秋の新作が入荷 / 送料無料 / 本日 21 時まで', maxLength: 120 },
    speed: { type: 'range', label: '流れる速さ', min: 0.2, max: 3, step: 0.1, default: 1 },
    boost: { type: 'range', label: '加速の強さ', min: 0, max: 3, step: 0.1, default: 1.2 },
    ink: { type: 'color', label: '文字と帯の色', default: '#161b0c' },
    background: { type: 'color', label: '背景色', default: '#d8f24a' },
  },
};

const CSS = `
.ua-mv{cursor:pointer;position:absolute;inset:0;display:grid;align-content:center;overflow:hidden;container-type:size;background:var(--ua-bg);
  color:var(--ua-ink);font-family:var(--ua-display,system-ui,sans-serif)}
.ua-mv__row{overflow:hidden;padding:.12em 0;font-size:clamp(22px,min(13cqw,26cqh),150px);font-weight:800;line-height:1.1;white-space:nowrap}
.ua-mv__row--solid{background:var(--ua-ink);color:var(--ua-bg)}
.ua-mv__row--line{color:transparent;-webkit-text-stroke:max(1px,.018em) var(--ua-ink)}
.ua-mv__track{display:flex;width:max-content;will-change:transform}
.ua-mv__skew{display:flex;transform-origin:50% 50%;will-change:transform}
.ua-mv__unit{display:flex;align-items:center;flex:none}
.ua-mv__unit span{padding:0 .28em;letter-spacing:-.02em}
.ua-mv__unit svg{flex:none;width:.5em;height:.5em;fill:var(--ua-bg);transform:rotate(var(--ua-spin,0deg))}
.ua-mv__row--line svg{fill:var(--ua-ink)}
.ua-mv__meter{display:flex;align-items:center;gap:1.2em;padding:.9em 5cqw;font-size:clamp(9px,1.7cqw,14px);
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.08em}
.ua-mv__meter i{flex:1;height:1px;background:color-mix(in srgb,var(--ua-ink) 35%,transparent)}
.ua-mv__meter b{min-width:4.2em;text-align:right;font-variant-numeric:tabular-nums}
.ua-mv__gauge{position:relative;flex:none;width:9em;height:.5em;border:1px solid var(--ua-ink);border-radius:1em;overflow:hidden}
.ua-mv__gauge em{position:absolute;inset:0;background:var(--ua-ink);transform-origin:left;transform:scaleX(.1)}
`;

const MAX_BOOST = 7;
const star = () => s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, s('path', { d: 'M12 0l2.6 9.4L24 12l-9.4 2.6L12 24l-2.6-9.4L0 12l9.4-2.6z' }));

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-mv', { '--ua-bg': p.background, '--ua-ink': p.ink });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const parsed = splitList(p.text, { separator: '/', maxItems: 6, maxLength: 30 });
  const phrases = parsed.length ? parsed : ['秋の新作が入荷', '送料無料'];
  root.setAttribute('role', 'marquee');
  root.setAttribute('aria-label', phrases.join('、'));

  const makeUnit = (list) => h('div', { class: 'ua-mv__unit' }, list.flatMap((text) => [h('span', { text }), star()]));
  const rows = [
    { kind: 'solid', dir: -1, list: phrases },
    { kind: 'line', dir: 1, list: [...phrases].reverse() },
  ].map(({ kind, dir, list }) => {
    const skew = h('div', { class: 'ua-mv__skew' });
    const track = h('div', { class: 'ua-mv__track' }, skew);
    const el = h('div', { class: `ua-mv__row ua-mv__row--${kind}`, 'aria-hidden': 'true' }, track);
    return { el, track, skew, dir, list, unit: 1, pos: 0, mul: 1, rest: 1 };
  });
  const value = h('b', { text: '×1.0' });
  const gauge = h('em');
  const meter = h('div', { class: 'ua-mv__meter', 'aria-hidden': 'true' }, h('span', { text: '流れる速さ' }), h('i'), h('span', { class: 'ua-mv__gauge' }, gauge), value);
  root.append(rows[0].el, meter, rows[1].el);

  // 帯が途切れないように、枠の幅を埋めて余るだけ同じ並びを複製する。
  function fill() {
    const width = root.clientWidth;
    for (const row of rows) {
      row.skew.replaceChildren(makeUnit(row.list));
      row.unit = Math.max(1, row.skew.firstChild.getBoundingClientRect().width);
      const copies = Math.min(24, Math.ceil(width / row.unit) + 2);
      for (let i = 1; i < copies; i += 1) row.skew.appendChild(makeUnit(row.list));
      place(row);
    }
  }
  function place(row) {
    const shift = ((row.pos % row.unit) + row.unit) % row.unit;
    row.track.style.transform = `translate3d(${row.dir < 0 ? -shift : shift - row.unit}px,0,0)`;
  }
  fill();
  const resize = new ResizeObserver(fill);
  resize.observe(root);
  disposer.add(() => resize.disconnect());
  if (reduced) {
    return {
      destroy() {
        disposer.run();
        removeRoot(root);
      },
    };
  }

  let target = 0; // ポインターの速さから決まる加速の目標
  let boost = 0; // 実際に効かせている加速。目標をなめらかに追う
  let lean = 0; // 傾きの向き（-1〜1）
  let leanTarget = 0;
  let spin = 0;
  let last = performance.now();
  let lastMove = null;
  let movedAt = 0;
  let shown = '';

  disposer.listen(root, 'pointermove', (event) => {
    const now = performance.now();
    if (lastMove && now > lastMove.t) {
      const dx = event.clientX - lastMove.x;
      const velocity = Math.hypot(dx, event.clientY - lastMove.y) / (now - lastMove.t);
      target = Math.min(MAX_BOOST, Math.max(target, velocity * 2.2 * p.boost));
      if (Math.abs(dx) > 1) leanTarget = Math.sign(dx);
    }
    lastMove = { x: event.clientX, y: event.clientY, t: now };
    movedAt = now;
  });
  disposer.listen(root, 'pointerleave', () => {
    lastMove = null;
  });

  // 触られていないときは、ときどき自分で加速して見せる。
  let gust = 0;
  disposer.interval(() => {
    if (performance.now() - movedAt < 2500 || p.boost === 0) return;
    gust += 1;
    target = Math.min(MAX_BOOST, 3.2 * p.boost);
    leanTarget = gust % 2 ? 1 : -1;
  }, p.preview ? 2300 : 3600);

  const timer = createTimer({
    onUpdate() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const follow = 1 - Math.exp(-dt * (target > boost ? 9 : 3.2));
      boost += (target - boost) * follow;
      target *= Math.exp(-dt * 2.4);
      lean += (leanTarget - lean) * (1 - Math.exp(-dt * 6));
      const base = root.clientWidth * 0.085 * p.speed;
      const factor = 1 + boost;
      const angle = utils.clamp(boost * 3.4, 0, 20) * lean;
      spin += dt * 50 * factor;
      root.style.setProperty('--ua-spin', `${spin.toFixed(1)}deg`);
      for (const row of rows) {
        row.pos += base * factor * row.mul * dt;
        place(row);
        // はじかれて速さが変わっているあいだは、その分だけ余計に傾く。
        const flickLean = utils.clamp((row.mul - row.rest) * 3.2, -22, 22) * row.dir;
        row.skew.style.transform = `skewX(${(-angle * (row.dir < 0 ? 1 : -1) + flickLean).toFixed(2)}deg)`;
      }
      const shownFactor = factor * Math.max(1, Math.abs(rows[0].mul), Math.abs(rows[1].mul));
      gauge.style.transform = `scaleX(${utils.clamp(shownFactor / (1 + MAX_BOOST), 0.06, 1).toFixed(3)})`;
      const text = `×${shownFactor.toFixed(1)}`;
      if (text !== shown) {
        shown = text;
        value.textContent = text;
      }
    },
  });
  disposer.add(() => timer.pause());

  // 準備: タップした段がつっかえて止まる。山場: はじかれて逆向きへ飛び出し、もう一方の段は反動で押し戻される。
  // 余韻: ゆれながら速さが落ち着き、タップした段は逆向きのまま流れ続ける。
  let flicks = 0;
  function flick(event) {
    const rect = root.getBoundingClientRect();
    const hasPoint = typeof event?.clientY === 'number' && rect.height > 0;
    const top = hasPoint ? event.clientY < rect.top + rect.height / 2 : flicks % 2 === 0;
    flicks += 1;
    movedAt = performance.now();
    rows.forEach((row, index) => {
      utils.remove(row);
      if ((index === 0) === top) {
        const next = -row.rest;
        row.rest = next;
        animate(row, {
          mul: [
            { to: -next * 0.04, duration: 260, ease: 'outCubic' },
            { to: next * 9, duration: 170, ease: 'outQuad' },
            { to: next, duration: 1700, ease: 'outElastic(1, .7)' },
          ],
        });
      } else {
        animate(row, {
          mul: [
            { to: -row.rest * 1.6, duration: 240, ease: 'outQuad' },
            { to: row.rest * 4.5, duration: 420, ease: 'inOutQuad' },
            { to: row.rest, duration: 1300, ease: 'outCubic' },
          ],
          delay: 250,
        });
      }
    });
  }
  disposer.listen(root, 'pointerdown', flick);
  disposer.add(() => utils.remove(rows));

  return {
    flick,
    destroy() {
      disposer.run();
      removeRoot(root);
    },
  };
}
