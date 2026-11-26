import { animate, splitText, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

const VARIANTS = ['curve', 'stripes', 'circle'];

export const meta = {
  id: 'page-curtain',
  title: 'ページ切り替えの幕',
  category: 'transition',
  libs: ['animejs'],
  description:
    'ページを切り替えるときに、幕で画面を覆ってから次の内容を見せます。曲線でせり上がる幕、縦じまの幕、円が広がる幕の 3 種類があります。画面のどこを押しても切り替わり、押した位置が起点になります。題名の文字が押した側から順に抜け落ち、曲線の幕は押した位置を山の頂点にしてせり上がり、縦じまは押した列から左右へ広がり、円は押した点から広がって、同じ点から穴が開いて次のページが見えます。戻り値の go() を呼ぶと、好きなタイミングで切り替えられます。',
  params: {
    variant: {
      type: 'select',
      label: '幕の種類',
      options: [
        { value: 'cycle', label: '3 種類を順番に' },
        { value: 'curve', label: '曲線でせり上がる' },
        { value: 'stripes', label: '縦じま' },
        { value: 'circle', label: '円が広がる' },
      ],
      default: 'cycle',
    },
    speed: { type: 'range', label: '速さ', min: 0.4, max: 2.5, step: 0.1, default: 1 },
    interval: { type: 'range', label: '自動切り替え（秒、0 で止める）', min: 0, max: 10, step: 0.5, default: 0 },
  },
};

const PAGES = [
  { title: 'Index', note: 'はじめに', bg: '#f3efe6', fg: '#1b1d2e', curtain: '#ff5a36' },
  { title: 'Works', note: '作ったもの', bg: '#2438f5', fg: '#f6f4ff', curtain: '#16182b' },
  { title: 'About', note: '私たちについて', bg: '#ffcf3f', fg: '#231a05', curtain: '#2438f5' },
  { title: 'Contact', note: '連絡先', bg: '#16182b', fg: '#f3efe6', curtain: '#ffcf3f' },
];
const STRIPES = 6;

const CSS = `
.ua-pc{position:absolute;inset:0;overflow:hidden;container-type:size;cursor:pointer;font-family:var(--ua-display,system-ui,sans-serif)}
.ua-pc__page{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:2.5cqw;background:var(--bg);color:var(--fg)}
.ua-pc__title{margin:0;font-size:clamp(28px,15cqw,200px);font-weight:800;letter-spacing:-0.04em;line-height:1}
.ua-pc__note{margin:0;font-size:clamp(11px,2.2cqw,20px)}
.ua-pc__next{margin-top:1cqw;padding:.8em 1.6em;border:2px solid currentColor;border-radius:999px;background:none;color:inherit;
  font:inherit;font-size:clamp(11px,2cqw,17px);font-weight:700;cursor:pointer}
.ua-pc__next:focus-visible{outline:3px solid currentColor;outline-offset:4px}
.ua-pc__layer{position:absolute;inset:0;pointer-events:none;color:var(--curtain)}
.ua-pc__layer svg{width:100%;height:100%;display:block}
.ua-pc__stripes{display:flex}
.ua-pc__stripes i{flex:1;margin-right:-1px;background:currentColor;transform:scaleY(0)}
.ua-pc__disc{background:currentColor;clip-path:circle(0% at 50% 50%)}
`;

// 曲線の幕。同じ命令の並びにそろえてあるので、d 属性をそのまま補間できる。
// rising と leaving は、山の頂点の左右の位置（0〜100）を受け取る。
const CURVE = {
  hiddenBottom: 'M 0 100 V 100 Q 50 100 100 100 V 100 Z',
  rising: (x) => `M 0 100 V 52 Q ${x} -30 100 52 V 100 Z`,
  coverFromBottom: 'M 0 100 V 0 Q 50 0 100 0 V 100 Z',
  coverFromTop: 'M 0 0 V 100 Q 50 100 100 100 V 0 Z',
  leaving: (x) => `M 0 0 V 48 Q ${x} 130 100 48 V 0 Z`,
  hiddenTop: 'M 0 0 V 0 Q 50 0 100 0 V 0 Z',
};

// アニメーションの完了を待つ。anime.js の戻り値をそのまま await しないための包み。
const run = (targets, params) => new Promise((resolve) => animate(targets, { ...params, onComplete: () => resolve() }));

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-pc');
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const t = (ms) => ms / p.speed;

  const title = h('h2', { class: 'ua-pc__title' });
  const note = h('p', { class: 'ua-pc__note' });
  const nextButton = h('button', { class: 'ua-pc__next', type: 'button', text: '次のページへ' });
  const page = h('div', { class: 'ua-pc__page' }, title, note, !p.preview && nextButton);

  const curvePath = s('path', { d: CURVE.hiddenBottom, fill: 'currentColor' });
  const curveLayer = h('div', { class: 'ua-pc__layer' }, s('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none' }, curvePath));
  const stripes = Array.from({ length: STRIPES }, () => h('i'));
  const stripeLayer = h('div', { class: 'ua-pc__layer ua-pc__stripes' }, stripes);
  const disc = h('div', { class: 'ua-pc__layer ua-pc__disc' });
  const discState = { radius: 0, hole: 0 };
  root.append(page, curveLayer, stripeLayer, disc);

  // 幕ごとの覆い方と外し方。o は起点（押した位置、0〜1）。
  const stripeFrom = (o) => Math.min(STRIPES - 1, Math.floor(o.x * STRIPES));
  const setHole = (o) => {
    const hole = `radial-gradient(circle at ${o.x * 100}% ${o.y * 100}%,transparent ${discState.hole}cqmax,#000 calc(${discState.hole}cqmax + 1px))`;
    disc.style.webkitMaskImage = hole;
    disc.style.maskImage = hole;
  };
  const transitions = {
    curve: {
      async cover(o) {
        const peak = (10 + o.x * 80).toFixed(1);
        curvePath.setAttribute('d', CURVE.hiddenBottom);
        await run(curvePath, {
          d: [
            { to: CURVE.rising(peak), duration: t(380), ease: 'inQuad' },
            { to: CURVE.coverFromBottom, duration: t(380), ease: 'outQuad' },
          ],
        });
      },
      async reveal(o) {
        const peak = (10 + o.x * 80).toFixed(1);
        curvePath.setAttribute('d', CURVE.coverFromTop);
        await run(curvePath, {
          d: [
            { to: CURVE.leaving(peak), duration: t(380), ease: 'inQuad' },
            { to: CURVE.hiddenTop, duration: t(380), ease: 'outQuad' },
          ],
        });
      },
    },
    stripes: {
      async cover(o) {
        utils.set(stripes, { transformOrigin: '50% 100%' });
        await run(stripes, { scaleY: [0, 1], duration: t(520), ease: 'inOutQuart', delay: stagger(t(70), { from: stripeFrom(o) }) });
      },
      async reveal(o) {
        utils.set(stripes, { transformOrigin: '50% 0%' });
        await run(stripes, { scaleY: 0, duration: t(520), ease: 'inOutQuart', delay: stagger(t(70), { from: stripeFrom(o) }) });
      },
    },
    circle: {
      async cover(o) {
        disc.style.maskImage = '';
        disc.style.webkitMaskImage = '';
        await run(discState, {
          radius: [0, 150],
          duration: t(760),
          ease: 'inOutQuart',
          onUpdate: () => {
            disc.style.clipPath = `circle(${discState.radius}cqmax at ${o.x * 100}% ${o.y * 100}%)`;
          },
        });
      },
      // 覆ったときと同じ点から、穴が開いて次のページが見える。
      async reveal(o) {
        discState.hole = 0;
        await run(discState, { hole: [0, 150], duration: t(760), ease: 'inOutQuart', onUpdate: () => setHole(o) });
        disc.style.clipPath = 'circle(0% at 50% 50%)';
        disc.style.maskImage = '';
        disc.style.webkitMaskImage = '';
      },
    },
  };

  let index = 0;
  let played = 0;
  let busy = false;
  let destroyed = false;
  let titleSplit = null;

  function render() {
    const current = PAGES[index];
    title.textContent = current.title;
    note.textContent = `${current.note}（${index + 1} / ${PAGES.length}）`;
    page.style.setProperty('--bg', current.bg);
    page.style.setProperty('--fg', current.fg);
    root.style.setProperty('--curtain', current.curtain);
  }
  function intro() {
    if (reduced) return;
    titleSplit = splitText(title, { chars: { wrap: 'clip' } });
    animate(titleSplit.chars, { y: ['105%', '0%'], duration: t(800), ease: 'outExpo', delay: stagger(t(45)) });
    animate(note, { opacity: [0, 1], y: [12, 0], duration: t(600), ease: 'outQuart', delay: t(250) });
  }

  // 準備: 題名の文字が、起点に近い側から順に抜け落ちる。
  function outro(o) {
    const chars = titleSplit?.chars ?? [];
    if (!chars.length) return;
    const from = Math.min(chars.length - 1, Math.max(0, Math.round(o.x * (chars.length - 1))));
    utils.remove([...chars, note]);
    animate(chars, { y: '110%', rotate: (_, i) => (i - from) * 6, duration: t(360), ease: 'inBack(2)', delay: stagger(t(35), { from }) });
    animate(note, { opacity: 0, y: 12, duration: t(260), ease: 'inQuad' });
  }

  // 題名が抜ける → 幕で覆う → 中身を差し替える → 幕を外す、の順に進める。origin は起点（0〜1）。
  async function go(variant, origin) {
    if (busy || destroyed) return;
    busy = true;
    const o = { x: utils.clamp(origin?.x ?? 0.5, 0, 1), y: utils.clamp(origin?.y ?? 0.5, 0, 1) };
    const name = VARIANTS.includes(variant) ? variant : p.variant === 'cycle' ? VARIANTS[played % VARIANTS.length] : p.variant;
    played += 1;
    const transition = transitions[name];
    if (!reduced) {
      outro(o);
      await transition.cover(o);
    }
    if (destroyed) return;
    index = (index + 1) % PAGES.length;
    utils.remove([...title.querySelectorAll('*'), note]);
    // 前の題名の分割を解いてから書き換える。解かないと、分割ごとの監視が積み上がる。
    titleSplit?.revert();
    titleSplit = null;
    render();
    intro();
    if (!reduced) await transition.reveal(o);
    busy = false;
  }

  render();
  intro();
  // ボタンを含め、画面のどこを押しても切り替える。押した位置を起点として渡す。
  disposer.listen(root, 'click', (event) => {
    const { x, y } = localPointer(event, root);
    go(undefined, { x, y });
  });
  const interval = p.preview ? 2600 : p.interval * 1000;
  if (interval > 0) disposer.interval(() => go(), interval);

  return {
    go,
    destroy() {
      destroyed = true;
      disposer.run();
      titleSplit?.revert();
      utils.remove(discState);
      removeRoot(root);
    },
  };
}
