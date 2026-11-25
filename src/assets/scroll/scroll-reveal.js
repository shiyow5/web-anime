import { animate, onScroll, splitText, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'scroll-reveal',
  title: 'スクロールで進む物語',
  category: 'scroll',
  libs: ['animejs'],
  description:
    'スクロールの位置に連動する演出を 1 ページにまとめた見本です。上端の進捗バー、絵の視差、見出しのせり上がり、タイルの順番表示、文字間が広がる結びの言葉が入っています。anime.js の onScroll だけで作っています。',
  params: {
    accent: { type: 'color', label: '差し色', default: '#ff5a36' },
    ink: { type: 'color', label: '文字色', default: '#16182b' },
    background: { type: 'color', label: '背景色', default: '#f6f3ec' },
    smooth: { type: 'range', label: '追従のなめらかさ', min: 0, max: 0.9, step: 0.05, default: 0.5 },
  },
};

const CSS = `
.ua-sr{position:absolute;inset:0;overflow-x:hidden;overflow-y:auto;container-type:size;background:var(--ua-bg);
  color:var(--ua-ink);font-family:var(--ua-display,system-ui,sans-serif)}
.ua-sr.is-preview{overflow:hidden}
.ua-sr__bar{position:sticky;top:0;z-index:5;height:max(3px,.6cqw);background:var(--ua-accent);transform-origin:left;transform:scaleX(0)}
.ua-sr__hero{display:grid;place-content:center;justify-items:center;gap:3cqw;min-height:100cqh;padding:0 6cqw;text-align:center}
.ua-sr__hero h2{margin:0;font-size:clamp(22px,9cqw,120px);font-weight:800;letter-spacing:-0.03em;line-height:1.05}
.ua-sr__hint{margin:0;font-size:clamp(11px,2cqw,16px);opacity:.7}
.ua-sr__chapter{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:6cqw;min-height:90cqh;padding:8cqw 7cqw}
.ua-sr__chapter:nth-of-type(even) .ua-sr__art{order:2}
.ua-sr__art{position:relative;aspect-ratio:4/5;border-radius:2cqw;overflow:hidden}
.ua-sr__art i{position:absolute;inset:-18% 0;background:var(--art)}
.ua-sr__copy h3{margin:0 0 .4em;font-size:clamp(18px,5.4cqw,64px);font-weight:800;letter-spacing:-0.02em;line-height:1.15}
.ua-sr__copy p{margin:0;font-size:clamp(11px,2cqw,18px);line-height:1.8;max-width:30em}
.ua-sr__tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:2cqw;padding:6cqw 7cqw 10cqw}
.ua-sr__tiles i{aspect-ratio:1;border-radius:1.6cqw;background:var(--ua-ink)}
.ua-sr__tiles i:nth-child(3n+2){background:var(--ua-accent)}
.ua-sr__end{display:grid;place-items:center;min-height:80cqh;overflow:hidden}
.ua-sr__end p{margin:0;font-size:clamp(20px,8cqw,110px);font-weight:800;white-space:nowrap}
`;

const CHAPTERS = [
  { title: '絵は少し遅れて動く', body: '枠の中の絵を、スクロールより遅く動かしています。平らな画面でも、奥行きがあるように見えます。', art: 'linear-gradient(170deg,#ffb86b,#ff5a36 55%,#7a1f3d)' },
  { title: '見出しは下からせり上がる', body: '見出しを単語ごとに分け、画面に入ったときに順番に出しています。読む位置に視線を誘導できます。', art: 'linear-gradient(170deg,#7dd3fc,#2b3cff 55%,#1b1464)' },
  { title: '進み具合は上の線で分かる', body: '上端の線は、ページのどこまで読んだかを表します。長い記事で、残りの量が一目で分かります。', art: 'linear-gradient(170deg,#d9f99d,#2f9e6a 55%,#0d4a45)' },
];

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, `ua-sr${p.preview ? ' is-preview' : ''}`, { '--ua-bg': p.background, '--ua-ink': p.ink, '--ua-accent': p.accent });
  const disposer = createDisposer();

  const bar = h('div', { class: 'ua-sr__bar' });
  const chapters = CHAPTERS.map(({ title, body, art }) => {
    const layer = h('i', { style: { '--art': art } });
    const artEl = h('div', { class: 'ua-sr__art' }, layer);
    const heading = h('h3', { text: title });
    const section = h('section', { class: 'ua-sr__chapter' }, artEl, h('div', { class: 'ua-sr__copy' }, heading, h('p', { text: body })));
    return { section, layer, artEl, heading };
  });
  const tiles = Array.from({ length: 6 }, () => h('i'));
  const tilesEl = h('div', { class: 'ua-sr__tiles' }, tiles);
  const endWord = h('p', { text: 'おしまい' });
  const end = h('footer', { class: 'ua-sr__end' }, endWord);
  const content = h(
    'div',
    {},
    h('header', { class: 'ua-sr__hero' }, h('h2', { text: 'スクロールで語る' }), h('p', { class: 'ua-sr__hint', text: '下へスクロールしてください' })),
    chapters.map((c) => c.section),
    tilesEl,
    end,
  );
  root.append(bar, content);

  if (prefersReducedMotion()) {
    bar.style.display = 'none';
    return { destroy: () => removeRoot(root) };
  }

  const animations = [];
  const splits = [];
  const sync = p.smooth > 0 ? p.smooth : true;
  const watch = (target, extra = {}) => onScroll({ container: root, target, ...extra });
  const add = (targets, params) => animations.push(animate(targets, params));

  // 上端の進捗バー。ページ全体の進み具合に合わせて伸びる。
  add(bar, { scaleX: [0, 1], ease: 'linear', autoplay: watch(content, { enter: 'top top', leave: 'bottom bottom', sync: true }) });

  for (const { section, layer, artEl, heading } of chapters) {
    // 絵の視差。枠が画面を通り過ぎる間に、中の絵を逆向きにずらす。
    add(layer, { y: ['-10%', '10%'], ease: 'linear', autoplay: watch(section, { sync }) });
    add(artEl, { scale: [0.86, 1], opacity: [0, 1], duration: 1100, ease: 'outExpo', autoplay: watch(artEl) });
    const split = splitText(heading, { words: { wrap: 'clip' } });
    splits.push(split);
    add(split.words, { y: ['105%', '0%'], duration: 900, ease: 'outExpo', delay: stagger(70), autoplay: watch(heading) });
  }
  add(tiles, {
    scale: [0.4, 1],
    opacity: [0, 1],
    duration: 900,
    ease: 'outBack(1.8)',
    delay: stagger(90, { grid: [3, 2], from: 'first' }),
    autoplay: watch(tilesEl),
  });
  add(endWord, { letterSpacing: ['-0.08em', '0.35em'], opacity: [0.15, 1], ease: 'linear', autoplay: watch(end, { enter: 'bottom top', leave: 'bottom bottom', sync }) });

  // 一覧の小さな枠では、自動で上下にスクロールして見せる。
  const scrollState = { top: 0 };
  if (p.preview) {
    disposer.timeout(() => {
      const max = root.scrollHeight - root.clientHeight;
      if (max <= 0) return;
      animate(scrollState, {
        top: [0, max],
        duration: 14000,
        ease: 'inOutSine',
        alternate: true,
        loop: true,
        onUpdate: () => {
          root.scrollTop = scrollState.top;
        },
      });
    }, 400);
  }

  return {
    destroy() {
      disposer.run();
      utils.remove(scrollState);
      for (const animation of animations) animation.revert();
      for (const split of splits) split.revert();
      removeRoot(root);
    },
  };
}
