import { animate, createTimeline, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'text-highlight',
  title: '線を引かれる文章',
  category: 'text',
  libs: ['animejs'],
  description:
    '文が 1 語ずつ現れ、大事な語に蛍光ペンで引いたような線が順に伸びます。線を引いた語にポインターを乗せると、もう一度引き直します。記事の要点や、サービスの特長を読ませたい段落に使います。',
  params: {
    style: {
      type: 'select',
      label: '線の種類',
      options: [
        { value: 'marker', label: '蛍光ペン' },
        { value: 'underline', label: '下線' },
      ],
      default: 'marker',
    },
    speed: { type: 'range', label: '速さ', min: 0.4, max: 2.5, step: 0.1, default: 1 },
    loop: { type: 'boolean', label: 'くり返す', default: true },
    marker: { type: 'color', label: '線の色', default: '#ffd84a' },
    ink: { type: 'color', label: '文字色', default: '#23263a' },
    background: { type: 'color', label: '背景色', default: '#fbf8f1' },
  },
};

const CSS = `
.ua-th{position:absolute;inset:0;overflow:hidden;container-type:size;background:var(--ua-bg);color:var(--ua-ink);
  font-family:var(--ua-display,system-ui,sans-serif)}
.ua-th__in{position:absolute;inset:0;display:grid;align-content:center;gap:1em;padding:0 8cqw;font-size:clamp(12px,min(4.1cqw,6.4cqh),38px)}
.ua-th__head{display:flex;align-items:center;gap:.8em;font-size:.36em;letter-spacing:.14em;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
.ua-th__head i{flex:1;height:1px;background:color-mix(in srgb,var(--ua-ink) 25%,transparent);transform-origin:left}
.ua-th__head b{padding:.25em .7em;border-radius:999px;background:var(--ua-ink);color:var(--ua-bg);font-weight:700}
.ua-th__text{margin:0;font-weight:700;line-height:1.85;letter-spacing:.01em}
.ua-th__w{position:relative;z-index:0;display:inline-block;white-space:nowrap}
.ua-th__w i{position:absolute;z-index:-1;background:var(--ua-marker);transform-origin:left;pointer-events:none}
.ua-th--marker .ua-th__w i{left:-.12em;right:-.12em;top:22%;bottom:12%;border-radius:.18em .5em .22em .6em/.5em .2em .6em .25em;
  transform:skewX(-8deg);opacity:.9}
.ua-th--underline .ua-th__w i{left:0;right:0;bottom:.2em;height:.16em;border-radius:.1em}
.ua-th__foot{display:flex;align-items:center;justify-content:space-between;gap:1em;min-height:2.6em;font-size:.36em}
.ua-th__foot span{opacity:.55}
.ua-th__again{padding:.55em 1.2em;border:1px solid color-mix(in srgb,var(--ua-ink) 50%,transparent);border-radius:999px;background:none;
  color:inherit;font:inherit;font-weight:700;cursor:pointer}
.ua-th__again:focus-visible{outline:3px solid var(--ua-ink);outline-offset:3px}
`;

// 文を、改行してよい区切りで分けたもの。2 つめが true の語に線を引く。
const CHUNKS = [
  ['伝わる文章は、'],
  ['読む人の'],
  ['時間を'],
  ['奪いません。'],
  ['まず'],
  ['結論を先に', true],
  ['書き、'],
  ['理由は'],
  ['三つまで', true],
  ['に絞ります。'],
  ['一文は'],
  ['短く', true],
  ['して、'],
  ['主語と述語を'],
  ['近づける。'],
  ['それだけで、'],
  ['読み返す回数が'],
  ['半分になります', true],
  ['。'],
];

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, `ua-th ua-th--${p.style}`, { '--ua-bg': p.background, '--ua-ink': p.ink, '--ua-marker': p.marker });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const t = (ms) => ms / p.speed;

  const marks = [];
  const words = CHUNKS.map(([text, marked], index) => {
    const line = marked ? h('i', { 'aria-hidden': 'true' }) : null;
    const word = h('span', { class: 'ua-th__w' }, line, text);
    if (line) marks.push({ word, line, index });
    return word;
  });
  const rule = h('i');
  const text = h('p', { class: 'ua-th__text' }, words);
  const again = h('button', { class: 'ua-th__again', type: 'button', text: 'もう一度読む' });
  root.appendChild(
    h(
      'div',
      { class: 'ua-th__in' },
      h('div', { class: 'ua-th__head', 'aria-hidden': 'true' }, h('b', { text: '書き方のメモ' }), h('span', { text: 'No. 04' }), rule),
      text,
      h('div', { class: 'ua-th__foot' }, h('span', { text: '社内向け「文章の手引き」より' }), !p.preview && !reduced && again),
    ),
  );

  let timeline = null;
  let destroyed = false;
  const base = () => (p.style === 'marker' ? { skewX: -8 } : {});

  function play() {
    if (reduced || destroyed) return;
    timeline?.pause();
    utils.remove([text, rule, ...words, ...marks.map((mark) => mark.line)]);
    utils.set(text, { opacity: 1 });
    utils.set(words, { opacity: 0 });
    utils.set(marks.map((mark) => mark.line), { scaleX: 0, ...base() });
    const step = t(75);
    timeline = createTimeline({
      onComplete() {
        if (p.loop || p.preview) play();
      },
    });
    timeline.add(rule, { scaleX: [0, 1], duration: t(900), ease: 'outExpo' }, 0);
    timeline.add(words, { opacity: [0, 1], y: ['.55em', '0em'], duration: t(520), ease: 'outQuart', delay: stagger(step) }, t(150));
    // 線は、その語が現れたあとに、前の線が引き終わるのを待って順に伸ばす。
    let free = 0;
    for (const { line, index } of marks) {
      const at = Math.max(t(150) + index * step + t(320), free);
      timeline.add(line, { scaleX: [0, 1], duration: t(620), ease: 'inOutQuart' }, at);
      free = at + t(480);
    }
    timeline.add(text, { opacity: 0, duration: t(450), ease: 'inQuad' }, `+=${t(2600)}`);
  }

  if (!reduced) {
    play();
    disposer.listen(again, 'click', play);
    for (const { word, line } of marks) {
      disposer.listen(word, 'pointerenter', () => {
        if (timeline && !timeline.completed && timeline.currentTime < timeline.duration - t(3000)) return;
        animate(line, { scaleX: [0, 1], duration: t(520), ease: 'inOutQuart' });
      });
    }
    disposer.add(() => timeline?.pause());
  }

  return {
    replay: play,
    destroy() {
      destroyed = true;
      disposer.run();
      removeRoot(root);
    },
  };
}
