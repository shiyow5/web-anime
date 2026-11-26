import { animate, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'number-counter',
  title: '数字が回る実績の表示',
  category: 'ui',
  libs: ['animejs'],
  description:
    '実績の数値が、桁ごとに縦に回って目標の値で止まります。画面に入ったときに始まり、下の桁ほど長く回って、少し行き過ぎてから戻ります。会社案内やサービス紹介の「数字で見る」欄に使います。',
  params: {
    duration: { type: 'range', label: '回る時間（秒）', min: 0.6, max: 4, step: 0.1, default: 1.9 },
    accent: { type: 'color', label: '差し色', default: '#ffb23e' },
    ink: { type: 'color', label: '文字色', default: '#f4ecd8' },
    background: { type: 'color', label: '背景色', default: '#10302b' },
    replayButton: { type: 'boolean', label: '「もう一度」のボタンを出す', default: true },
  },
};

const CSS = `
.ua-nc{position:absolute;inset:0;overflow:hidden;container-type:size;background:var(--ua-bg);color:var(--ua-ink);
  font-family:var(--ua-display,system-ui,sans-serif)}
.ua-nc__in{position:absolute;inset:0;display:grid;align-content:center;gap:1.1em;padding:0 5cqw;font-size:clamp(9px,min(2.1cqw,4.2cqh),19px)}
.ua-nc__head{display:flex;align-items:baseline;justify-content:space-between;gap:1em;padding-bottom:.7em;
  border-bottom:1px solid color-mix(in srgb,var(--ua-ink) 22%,transparent)}
.ua-nc__head h2{margin:0;font-size:1.25em;font-weight:700;letter-spacing:.04em}
.ua-nc__head span{font-size:.8em;opacity:.6;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
.ua-nc__grid{display:grid;grid-template-columns:repeat(3,1fr);gap:0}
.ua-nc__stat{display:grid;gap:.55em;padding:.4em 1.3em;border-left:1px solid color-mix(in srgb,var(--ua-ink) 16%,transparent);min-width:0}
.ua-nc__stat:first-child{padding-left:0;border-left:0}
.ua-nc__idx{font-size:.75em;color:var(--ua-accent);font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.1em}
.ua-nc__num{display:flex;align-items:baseline;margin:0;font-size:3.2em;font-weight:800;line-height:1;white-space:nowrap;
  font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.ua-nc__cell{display:inline-block;height:1em;overflow:hidden;
  -webkit-mask-image:linear-gradient(#0000,#000 18%,#000 82%,#0000);mask-image:linear-gradient(#0000,#000 18%,#000 82%,#0000)}
.ua-nc__col{display:block;will-change:transform}
.ua-nc__col i{display:block;height:1em;font-style:normal;text-align:center}
.ua-nc__sep{display:inline-block}
.ua-nc__unit{margin-left:.25em;font-size:.36em;font-weight:700;letter-spacing:0;color:var(--ua-accent)}
.ua-nc__bar{position:relative;height:3px;border-radius:2px;background:color-mix(in srgb,var(--ua-ink) 14%,transparent)}
.ua-nc__bar i{position:absolute;inset:0;border-radius:2px;background:var(--ua-accent);transform-origin:left;transform:scaleX(var(--r))}
.ua-nc__bar b{position:absolute;top:-3px;width:1px;height:9px;background:color-mix(in srgb,var(--ua-ink) 35%,transparent)}
.ua-nc__label{margin:0;font-size:1em;font-weight:700}
.ua-nc__note{margin:0;font-size:.78em;line-height:1.5;opacity:.62}
.ua-nc__foot{display:flex;align-items:center;justify-content:space-between;gap:1em;min-height:2.2em}
.ua-nc__foot p{margin:0;font-size:.72em;opacity:.5}
.ua-nc__again{padding:.5em 1.2em;border:1px solid color-mix(in srgb,var(--ua-ink) 45%,transparent);border-radius:999px;background:none;
  color:inherit;font:inherit;font-size:.8em;font-weight:700;cursor:pointer}
.ua-nc__again:hover{border-color:var(--ua-accent);color:var(--ua-accent)}
.ua-nc__again:focus-visible{outline:3px solid var(--ua-accent);outline-offset:3px}
`;

const STATS = [
  { value: '1,280', unit: '社', label: '導入している企業', note: '2019 年の提供開始からの累計', ratio: 0.64 },
  { value: '98.6', unit: '%', label: '契約の継続率', note: '直近 12 か月の平均', ratio: 0.986 },
  { value: '4,500', unit: '万件', label: '1 か月の処理件数', note: '前年の同じ月の 1.8 倍', ratio: 0.82 },
];
const OVERSHOOT = 0.24;

// 1 つの数値を、回る桁（数字）と動かない記号（, や .）に分けて組み立てる。
function buildNumber(value) {
  const cols = [];
  let digitIndex = 0;
  const parts = [...value].map((char) => {
    if (!/\d/.test(char)) return h('span', { class: 'ua-nc__sep', text: char });
    const digit = Number(char);
    // 右の桁ほど多く回す。止まる位置の次の数字も 1 つ置いて、行き過ぎたときに見えるようにする。
    const travel = 10 * (1 + Math.min(digitIndex, 2)) + digit;
    digitIndex += 1;
    const col = h('span', { class: 'ua-nc__col' }, Array.from({ length: travel + 2 }, (_, k) => h('i', { text: String(k % 10) })));
    cols.push({ el: col, travel });
    return h('span', { class: 'ua-nc__cell' }, col);
  });
  return { parts, cols };
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-nc', { '--ua-bg': p.background, '--ua-ink': p.ink, '--ua-accent': p.accent });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();

  const stats = STATS.map(({ value, unit, label, note, ratio }, index) => {
    const { parts, cols } = buildNumber(value);
    const fill = h('i', { style: { '--r': ratio } });
    const texts = [h('p', { class: 'ua-nc__label', text: label }), h('p', { class: 'ua-nc__note', text: note })];
    const idx = h('span', { class: 'ua-nc__idx', text: `0${index + 1}`, 'aria-hidden': 'true' });
    const num = h('p', { class: 'ua-nc__num', role: 'img', 'aria-label': `${value}${unit}` }, parts, h('span', { class: 'ua-nc__unit', text: unit }));
    const ticks = [0.25, 0.5, 0.75].map((at) => h('b', { style: { left: `${at * 100}%` } }));
    const el = h('div', { class: 'ua-nc__stat' }, idx, num, h('div', { class: 'ua-nc__bar', 'aria-hidden': 'true' }, fill, ticks), texts);
    return { el, cols, fill, ratio, texts, idx };
  });
  const again = h('button', { class: 'ua-nc__again', type: 'button', text: 'もう一度回す' });
  const showButton = p.replayButton && !p.preview && !reduced;
  root.appendChild(
    h(
      'div',
      { class: 'ua-nc__in' },
      h('header', { class: 'ua-nc__head' }, h('h2', { text: '数字で見る 5 年間' }), h('span', { text: '2019 — 2024', 'aria-hidden': 'true' })),
      h('div', { class: 'ua-nc__grid' }, stats.map((stat) => stat.el)),
      h('footer', { class: 'ua-nc__foot' }, h('p', { text: '数値は 2024 年 12 月末の時点' }), showButton && again),
    ),
  );

  const finish = () => {
    for (const stat of stats) for (const { el, travel } of stat.cols) el.style.transform = `translateY(-${travel}em)`;
  };

  function play() {
    if (reduced) return;
    const base = p.duration * 1000;
    stats.forEach((stat, s) => {
      const targets = stat.cols.map((col) => col.el);
      utils.remove([...targets, stat.el, stat.fill, stat.idx, ...stat.texts]);
      stat.cols.forEach(({ el, travel }, i) => {
        el.style.transform = 'translateY(0em)';
        animate(el, {
          y: [
            { to: `-${travel + OVERSHOOT}em`, duration: base + i * 170, ease: 'outQuart' },
            { to: `-${travel}em`, duration: 620, ease: 'outElastic(1, .55)' },
          ],
          delay: s * 220 + i * 60,
        });
      });
      animate(stat.fill, { scaleX: [0, stat.ratio], duration: base + 700, delay: s * 220, ease: 'outExpo' });
      animate([stat.idx, ...stat.texts], { y: [10, 0], duration: 700, delay: stagger(90, { start: s * 220 + 150 }), ease: 'outQuart' });
      animate(stat.el, { opacity: [0, 1], duration: 600, delay: s * 220, ease: 'outQuad' });
    });
  }

  if (reduced) {
    finish();
  } else {
    // 画面に入ったときに 1 回だけ始める。
    let started = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (started || !entries.some((entry) => entry.isIntersecting)) return;
        started = true;
        observer.disconnect();
        play();
      },
      { threshold: 0.3 },
    );
    observer.observe(root);
    disposer.add(() => observer.disconnect());
    disposer.listen(again, 'click', play);
    if (p.preview) disposer.interval(play, 5200);
  }

  return {
    replay: play,
    destroy() {
      disposer.run();
      removeRoot(root);
    },
  };
}
