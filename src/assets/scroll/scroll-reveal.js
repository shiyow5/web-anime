import { animate, onScroll, splitText, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'scroll-reveal',
  title: 'スクロールで進む物語',
  category: 'scroll',
  libs: ['animejs'],
  description:
    'スクロールの位置に連動する演出を 1 ページにまとめた見本です。上端の進捗バー、絵の視差、見出しのせり上がり、タイルの順番表示、文字間が広がる結びの言葉が入っています。スクロールとの連動は anime.js の onScroll で作っています。押したときの反応も部品ごとに違います。見出しは、押した文字から順に上へ抜けて下から巻き上がり、最初の画面ではページが少しだけ下へのぞいて戻ります。絵は押した点から輪が広がって枠が傾き、タイルは押した 1 枚から波のように回って色が入れ替わります。',
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
.ua-sr__art>i{position:absolute;inset:-18% 0;background:var(--art)}
.ua-sr__hero h2,.ua-sr__copy h3,.ua-sr__art,.ua-sr__tiles i{cursor:pointer}
.ua-sr__ping{position:absolute;width:12%;aspect-ratio:1;translate:-50% -50%;border-radius:50%;border:2px solid #fff;pointer-events:none;opacity:0}
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
    const pings = [h('b', { class: 'ua-sr__ping' }), h('b', { class: 'ua-sr__ping' })];
    const artEl = h('div', { class: 'ua-sr__art' }, layer, pings);
    const heading = h('h3', { text: title });
    const section = h('section', { class: 'ua-sr__chapter' }, artEl, h('div', { class: 'ua-sr__copy' }, heading, h('p', { text: body })));
    return { section, layer, artEl, heading, pings, words: [] };
  });
  const tiles = Array.from({ length: 6 }, () => h('i'));
  const tilesEl = h('div', { class: 'ua-sr__tiles' }, tiles);
  const endWord = h('p', { text: 'おしまい' });
  const end = h('footer', { class: 'ua-sr__end' }, endWord);
  const heroTitle = h('h2', { text: 'スクロールで語る' });
  const hint = h('p', { class: 'ua-sr__hint', text: '下へスクロールしてください' });
  const hero = h('header', { class: 'ua-sr__hero' }, heroTitle, hint);
  const content = h(
    'div',
    {},
    hero,
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

  const heroSplit = splitText(heroTitle, { chars: { wrap: 'clip' } });
  splits.push(heroSplit);
  for (const chapter of chapters) {
    const { section, layer, artEl, heading } = chapter;
    // 絵の視差。枠が画面を通り過ぎる間に、中の絵を逆向きにずらす。
    add(layer, { y: ['-10%', '10%'], ease: 'linear', autoplay: watch(section, { sync }) });
    add(artEl, { scale: [0.86, 1], opacity: [0, 1], duration: 1100, ease: 'outExpo', autoplay: watch(artEl) });
    const split = splitText(heading, { words: { wrap: 'clip' } });
    splits.push(split);
    chapter.words = split.words;
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

  // 押した横位置に近い要素の番号を返す。
  const nearest = (event, el, count) => Math.round(utils.clamp(localPointer(event, el).x, 0, 1) * Math.max(0, count - 1));
  // 見出しの巻き上げ。from 番目から順に、上へ抜けて下から入り直す。スクロールで文字が流れるのと同じ動き。
  function roll(pieces, from = 0) {
    if (!pieces.length) return;
    utils.remove(pieces);
    animate(pieces, {
      y: [
        { to: '-110%', duration: 260, ease: 'inQuad' },
        { to: '110%', duration: 0 },
        { to: '0%', duration: 680, ease: 'outExpo' },
      ],
      delay: stagger(55, { from: Math.min(from, pieces.length - 1) }),
    });
  }
  // 最初の画面では、見出しのあとにページが少しだけ下へのぞいて戻る。
  const peek = { top: 0 };
  function rollHero(from) {
    roll(heroSplit.chars, from);
    utils.remove(hint);
    animate(hint, { y: [{ to: 14, duration: 260, ease: 'outQuad' }, { to: 0, duration: 420, ease: 'outBounce' }], delay: 520, loop: 2 });
    if (p.preview || root.scrollTop > 4) return;
    utils.remove(peek);
    peek.top = 0;
    animate(peek, {
      top: [
        { to: root.clientHeight * 0.2, duration: 520, ease: 'outQuart' },
        { to: root.clientHeight * 0.2, duration: 620 },
        { to: 0, duration: 700, ease: 'inOutQuart' },
      ],
      delay: 480,
      onUpdate: () => {
        root.scrollTop = peek.top;
      },
    });
  }
  // 絵。押した点から輪が 2 本広がり、枠が押した側へ傾いて戻る。
  function pressArt(chapter, event) {
    const { x, y } = localPointer(event, chapter.artEl);
    for (const ping of chapter.pings) {
      ping.style.left = `${x * 100}%`;
      ping.style.top = `${y * 100}%`;
    }
    utils.remove(chapter.pings);
    animate(chapter.pings, { scale: [0.2, (_, i) => 5 + i * 5], opacity: [{ from: 0, to: 0.9, duration: 90 }, { to: 0, duration: 800, ease: 'outQuad' }], duration: 900, delay: stagger(140), ease: 'outExpo' });
    animate(chapter.artEl, {
      rotate: [{ to: (x - 0.5) * 9, duration: 160, ease: 'outQuad' }, { to: 0, duration: 1000, ease: 'outElastic(1, .4)' }],
      y: [{ to: 10, duration: 160, ease: 'outQuad' }, { to: 0, duration: 800, ease: 'outElastic(1, .5)' }],
    });
  }
  // タイル。押した 1 枚から波のように回り、通り過ぎたタイルは色が入れ替わる。
  const tileColors = tiles.map((_, i) => (i % 3 === 1 ? 1 : 0));
  function flipTiles(from = 0) {
    utils.remove(tiles);
    tiles.forEach((_, i) => {
      tileColors[i] = 1 - tileColors[i];
    });
    animate(tiles, {
      scale: [{ to: 0.55, duration: 150, ease: 'outQuad' }, { to: 1, duration: 760, ease: 'outElastic(1, .5)' }],
      rotate: [{ to: 0, duration: 0 }, { to: 180, duration: 820, ease: 'outExpo' }],
      opacity: 1,
      backgroundColor: { to: (_, i) => (tileColors[i] ? p.accent : p.ink), duration: 420, ease: 'outQuad' },
      delay: stagger(95, { grid: [3, 2], from }),
    });
  }
  disposer.listen(root, 'click', (event) => {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    const tile = target.closest('.ua-sr__tiles i');
    if (tile) return flipTiles(tiles.indexOf(tile));
    const chapter = chapters.find((c) => c.artEl.contains(target) || c.heading.contains(target));
    if (chapter && chapter.artEl.contains(target)) return pressArt(chapter, event);
    if (chapter) return roll(chapter.words, nearest(event, chapter.heading, chapter.words.length));
    if (hero.contains(target)) return rollHero(nearest(event, heroTitle, heroSplit.chars.length));
    return undefined;
  });
  // 手で動かし始めたら、のぞく動きはやめる。
  for (const type of ['wheel', 'touchstart']) disposer.listen(root, type, () => utils.remove(peek), { passive: true });
  disposer.add(() => utils.remove(peek));
  if (p.preview) {
    disposer.interval(() => {
      rollHero(Math.floor(Math.random() * heroSplit.chars.length));
      flipTiles(Math.floor(Math.random() * tiles.length));
    }, 4600);
  }

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
