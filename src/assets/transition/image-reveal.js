import { animate, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

const VARIANTS = [
  { value: 'blinds', label: 'ブラインド' },
  { value: 'iris', label: '絞り' },
  { value: 'diagonal', label: '斜めの帯' },
  { value: 'tiles', label: 'タイル' },
];

export const meta = {
  id: 'image-reveal',
  title: '絵の現れ方',
  category: 'transition',
  libs: ['animejs'],
  description:
    '次の絵が、ブラインド、六角形の絞り、斜めの帯、タイルの形で、時間差を付けて現れます。絵を押すと、絞りは押した位置から開きます。写真の切り替えや、作品紹介の画面に使います。戻り値の go() で好きなときに切り替えられます。',
  params: {
    variant: { type: 'select', label: '現れ方', options: [{ value: 'cycle', label: '4 種類を順番に' }, ...VARIANTS], default: 'cycle' },
    pieces: { type: 'range', label: '帯やタイルの数', min: 3, max: 12, step: 1, default: 7 },
    speed: { type: 'range', label: '速さ', min: 0.4, max: 2.5, step: 0.1, default: 1 },
    interval: { type: 'range', label: '自動切り替え（秒、0 で止める）', min: 0, max: 10, step: 0.5, default: 4 },
    background: { type: 'color', label: '台紙の色', default: '#1d1c22' },
  },
};

const CSS = `
.ua-ir{position:absolute;inset:0;overflow:hidden;container-type:size;background:var(--ua-bg);color:#f3efe6;
  font-family:var(--ua-display,system-ui,sans-serif)}
.ua-ir__frame{position:absolute;left:5cqw;right:5cqw;top:6cqh;bottom:19cqh;overflow:hidden;border-radius:min(1.4cqw,2cqh);cursor:pointer;
  box-shadow:0 0 0 1px #ffffff1f}
.ua-ir__pic{position:absolute;inset:0;overflow:hidden;background:var(--bg)}
.ua-ir__pic i{position:absolute;display:block}
.ua-ir__bar{position:absolute;left:5cqw;right:5cqw;bottom:0;height:19cqh;display:flex;align-items:center;gap:1.2em;
  font-size:clamp(9px,min(2cqw,4.2cqh),17px)}
.ua-ir__no{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:.85em;letter-spacing:.1em;opacity:.6}
.ua-ir__cap{flex:1;min-width:0;overflow:hidden}
.ua-ir__cap b{display:block;font-size:1.25em;white-space:nowrap}
.ua-ir__cap span{display:block;margin-top:.15em;font-size:.76em;opacity:.6;white-space:nowrap}
.ua-ir__btn{flex:none;padding:.7em 1.4em;border:1px solid #f3efe680;border-radius:999px;background:none;color:inherit;font:inherit;
  font-size:.88em;font-weight:700;cursor:pointer}
.ua-ir__btn:hover{background:#f3efe6;color:#1d1c22}
.ua-ir__btn:focus-visible{outline:3px solid #f3efe6;outline-offset:3px}
`;

// 絵は、背景のグラデーションと、いくつかの図形（% で置く）で作る。
const circle = (left, top, size, background, extra = {}) => ({ left, top, width: size, aspectRatio: '1', borderRadius: '50%', background, ...extra });
const PICTURES = [
  {
    title: '砂丘の朝',
    bg: 'linear-gradient(#f7d9a6,#f2a65a 58%,#d97b3f)',
    shapes: [
      circle('64%', '14%', '13%', '#fff6dc'),
      { left: '-20%', top: '56%', width: '90%', height: '80%', borderRadius: '50%', background: '#c96a34' },
      { left: '30%', top: '50%', width: '100%', height: '90%', borderRadius: '50%', background: '#a94f2a' },
      { left: '-10%', top: '74%', width: '130%', height: '60%', borderRadius: '50%', background: '#6f2f1f' },
      { left: '12%', top: '30%', width: '22%', height: '1px', background: '#ffffffaa' },
      { left: '18%', top: '34%', width: '12%', height: '1px', background: '#ffffff88' },
    ],
  },
  {
    title: '夜の港',
    bg: 'linear-gradient(#0e1b3d,#1f3c73 60%,#2b5c8a)',
    shapes: [
      circle('16%', '12%', '10%', '#f4f1d0'),
      { left: '8%', top: '44%', width: '14%', height: '30%', background: '#0a1126' },
      { left: '24%', top: '34%', width: '10%', height: '40%', background: '#101a36' },
      { left: '58%', top: '40%', width: '18%', height: '34%', background: '#0a1126' },
      { left: '78%', top: '50%', width: '12%', height: '24%', background: '#101a36' },
      { left: '0', top: '74%', width: '100%', height: '26%', background: 'repeating-linear-gradient(#17335f 0 6%,#1f4576 6% 12%)' },
      { left: '26%', top: '40%', width: '2%', height: '3%', background: '#ffd166', boxShadow: '3cqw 6cqh 0 #ffd166,34cqw 4cqh 0 #ffd166,-13cqw 8cqh 0 #ffd166,38cqw 12cqh 0 #ffd166' },
    ],
  },
  {
    title: '若葉の丘',
    bg: 'linear-gradient(#cdeeda,#9fd8b0 55%,#62b37a)',
    shapes: [
      circle('74%', '12%', '11%', '#ffffff'),
      { left: '-15%', top: '52%', width: '80%', height: '90%', borderRadius: '50%', background: '#4c9a63' },
      { left: '35%', top: '60%', width: '90%', height: '90%', borderRadius: '50%', background: '#2f7a4a' },
      circle('22%', '34%', '10%', '#1f5c36'),
      { left: '26.5%', top: '48%', width: '1%', height: '12%', background: '#3b2a1a' },
      circle('62%', '44%', '8%', '#1f5c36'),
      { left: '65.6%', top: '55%', width: '.8%', height: '10%', background: '#3b2a1a' },
    ],
  },
  {
    title: '夕立のあと',
    bg: 'linear-gradient(#4b3f72,#c06c84 60%,#f8b195)',
    shapes: [
      circle('20%', '30%', '60%', 'transparent', { border: 'min(1.6cqw,2.4cqh) solid #ffd16699' }),
      circle('24%', '36%', '52%', 'transparent', { border: 'min(1.6cqw,2.4cqh) solid #9bf6ff80' }),
      { left: '6%', top: '20%', width: '26%', height: '11%', borderRadius: '999px', background: '#ffffffcc' },
      { left: '60%', top: '28%', width: '30%', height: '12%', borderRadius: '999px', background: '#ffffffaa' },
      { left: '-10%', top: '72%', width: '120%', height: '60%', borderRadius: '50%', background: '#2c2445' },
    ],
  },
];

const rect = (x, y, w, hh) => (w <= 0 || hh <= 0 ? '' : `M${x.toFixed(1)} ${y.toFixed(1)}h${w.toFixed(1)}v${hh.toFixed(1)}h${(-w).toFixed(1)}Z`);

// 現れ方ごとに、動かす値の数（count）と、値から切り抜きの形を作る関数（draw）を持つ。
const SHAPES = {
  blinds: {
    count: (n) => n,
    delay: () => stagger(70),
    draw(e, w, hh) {
      const strip = hh / e.length;
      return e.map((v, i) => rect(0, i * strip, w, strip * v + (v > 0.999 ? 1 : 0))).join('');
    },
  },
  diagonal: {
    count: (n) => n,
    delay: () => stagger(80),
    draw(e, w, hh) {
      const slant = hh * 0.6;
      const band = (w + slant) / e.length;
      return e
        .map((v, i) => {
          if (v <= 0) return '';
          const x = i * band - slant;
          const grow = band * v + (v > 0.999 ? 1 : 0);
          return `M${(x + slant).toFixed(1)} 0L${(x + slant + grow).toFixed(1)} 0L${(x + grow).toFixed(1)} ${hh.toFixed(1)}L${x.toFixed(1)} ${hh.toFixed(1)}Z`;
        })
        .join('');
    },
  },
  tiles: {
    grid: (n) => [n, Math.max(3, Math.round(n * 0.6))],
    count(n) {
      const [cols, rows] = this.grid(n);
      return cols * rows;
    },
    delay(n) {
      return stagger(55, { grid: this.grid(n), from: 'center' });
    },
    draw(e, w, hh, n) {
      const [cols, rows] = this.grid(n);
      const tw = w / cols;
      const th = hh / rows;
      return e
        .map((v, i) => {
          const pad = v > 0.999 ? 0.5 : 0;
          const cx = ((i % cols) + 0.5) * tw;
          const cy = (Math.floor(i / cols) + 0.5) * th;
          return rect(cx - (tw * v) / 2 - pad, cy - (th * v) / 2 - pad, tw * v + pad * 2, th * v + pad * 2);
        })
        .join('');
    },
  },
  iris: {
    count: () => 1,
    delay: () => 0,
    draw([v], w, hh, _n, origin) {
      if (v <= 0) return '';
      const ox = origin.x * w;
      const oy = origin.y * hh;
      const reach = Math.hypot(Math.max(ox, w - ox), Math.max(oy, hh - oy)) * 1.16;
      const turn = (1 - v) * 2.2;
      let d = '';
      for (let k = 0; k < 6; k += 1) {
        const a = turn + (k * Math.PI) / 3;
        d += `${k ? 'L' : 'M'}${(ox + Math.cos(a) * reach * v).toFixed(1)} ${(oy + Math.sin(a) * reach * v).toFixed(1)}`;
      }
      return `${d}Z`;
    },
  },
};

function buildPicture(index) {
  const { bg, shapes } = PICTURES[index];
  return h('div', { class: 'ua-ir__pic', style: { '--bg': bg }, 'aria-hidden': 'true' }, shapes.map((style) => h('i', { style })));
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-ir', { '--ua-bg': p.background });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const t = (ms) => ms / p.speed;
  const pieces = p.preview ? Math.min(p.pieces, 6) : p.pieces;

  let index = 0;
  let current = buildPicture(0);
  const frame = h('div', { class: 'ua-ir__frame' }, current);
  const no = h('span', { class: 'ua-ir__no' });
  const name = h('b');
  const kind = h('span');
  const caption = h('div', { class: 'ua-ir__cap', role: 'status' }, name, kind);
  const button = h('button', { class: 'ua-ir__btn', type: 'button', text: '次の絵へ' });
  root.append(frame, h('div', { class: 'ua-ir__bar' }, no, caption, !p.preview && button));

  let played = 0;
  let busy = false;
  let destroyed = false;
  let states = [];

  function label(variant) {
    no.textContent = `0${index + 1} / 0${PICTURES.length}`;
    name.textContent = PICTURES[index].title;
    kind.textContent = variant ? `現れ方: ${VARIANTS.find((v) => v.value === variant).label}` : '絵を押すと次へ進みます';
  }

  // 次の絵を上に重ね、切り抜きの形を広げて見せる。origin は絞りの中心（0〜1）。
  function go(variant, origin = { x: 0.5, y: 0.5 }) {
    if (busy || destroyed) return;
    const names = VARIANTS.map((v) => v.value);
    const chosen = names.includes(variant) ? variant : p.variant === 'cycle' ? names[played % names.length] : p.variant;
    played += 1;
    index = (index + 1) % PICTURES.length;
    const next = buildPicture(index);
    const previous = current;
    current = next;
    frame.appendChild(next);
    const finish = () => {
      next.style.clipPath = '';
      previous.remove();
      busy = false;
    };
    if (reduced) {
      label(chosen);
      finish();
      return;
    }
    busy = true;
    const shape = SHAPES[chosen];
    states = Array.from({ length: shape.count(pieces) }, () => ({ v: 0 }));
    const draw = () => {
      const d = shape.draw(states.map((state) => state.v), frame.clientWidth, frame.clientHeight, pieces, origin);
      next.style.clipPath = `path('${d || 'M0 0Z'}')`;
    };
    draw();
    animate(states, {
      v: 1,
      duration: t(chosen === 'iris' ? 1100 : 760),
      delay: shape.delay(pieces),
      ease: chosen === 'iris' ? 'inOutQuart' : 'inOutCubic',
      onUpdate: draw,
      onComplete: () => {
        if (!destroyed) finish();
      },
    });
    // 中の絵は少し大きい状態から収まり、前の絵は奥へ引く。
    animate(next.children, { scale: [1.25, 1], duration: t(1500), ease: 'outExpo', delay: stagger(t(40)) });
    animate(previous, { scale: 1.08, duration: t(1300), ease: 'outQuad' });
    animate(caption, {
      y: [{ to: '-60%', duration: t(220), ease: 'inQuad' }, { to: '60%', duration: 0 }, { to: '0%', duration: t(520), ease: 'outExpo' }],
      opacity: [{ to: 0, duration: t(220) }, { to: 1, duration: t(400) }],
    });
    disposer.timeout(() => {
      if (!destroyed) label(chosen);
    }, t(220));
  }

  label(null);
  let touchedAt = 0;
  disposer.listen(button, 'click', () => {
    touchedAt = performance.now();
    go();
  });
  disposer.listen(frame, 'click', (event) => {
    touchedAt = performance.now();
    const { x, y } = localPointer(event, frame);
    go(undefined, { x: utils.clamp(x, 0, 1), y: utils.clamp(y, 0, 1) });
  });
  if (!reduced) {
    animate(current.children, { scale: [0, 1], opacity: [0, 1], duration: 1000, ease: 'outBack(1.4)', delay: stagger(70) });
    const every = p.preview ? 2400 : p.interval * 1000;
    if (every > 0) {
      disposer.interval(() => {
        if (performance.now() - touchedAt > every) go();
      }, every);
    }
  }

  return {
    go,
    destroy() {
      destroyed = true;
      disposer.run();
      if (states.length) utils.remove(states);
      removeRoot(root);
    },
  };
}
