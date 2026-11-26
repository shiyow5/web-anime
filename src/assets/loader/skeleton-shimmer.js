import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'skeleton-shimmer',
  title: '骨組みの読み込み表示',
  category: 'loader',
  libs: ['animejs'],
  description:
    '内容が届くまで、灰色の骨組みの上を 1 本の光が流れます。読み込みが終わると、骨組みが上の行から時間差で本物の内容に置き換わります。一覧や記事など、形が決まっている画面の待ち時間に使います。読み込み中に行を押すと、進捗の線が一気に走り、押した行から上下へ順に内容が現れます。内容が出ているときに行を押すと、その行から骨組みに戻って読み込み直します。「読み込み直す」を押すと最初からくり返します。',
  params: {
    load: { type: 'range', label: '読み込みにかかる時間（秒）', min: 0.8, max: 6, step: 0.2, default: 2.2 },
    hold: { type: 'range', label: '内容を見せる時間（秒）', min: 1, max: 10, step: 0.5, default: 3.5 },
    accent: { type: 'color', label: '差し色', default: '#0f8b8d' },
    bone: { type: 'color', label: '骨組みの色', default: '#d3dce2' },
    background: { type: 'color', label: '背景色', default: '#e6edf1' },
  },
};

const CSS = `
.ua-sk{position:absolute;inset:0;overflow:hidden;container-type:size;background:var(--ua-bg);color:#1c2a33;
  font-family:var(--ua-display,system-ui,sans-serif)}
.ua-sk__in{position:absolute;inset:0;display:grid;align-content:center;justify-items:center;font-size:clamp(8px,min(2.25cqw,3.9cqh),17px)}
.ua-sk__card{position:relative;width:min(34em,90cqw);border-radius:1.1em;background:#fff;overflow:hidden;
  box-shadow:0 1.4em 2.6em -1.6em #1c2a3355,0 0 0 1px #1c2a3310}
.ua-sk__bar{position:absolute;left:0;right:0;top:0;height:.2em;background:var(--ua-accent);transform-origin:left;transform:scaleX(0)}
.ua-sk__head{display:flex;align-items:center;gap:.8em;padding:1em 1.3em .9em;border-bottom:1px solid #1c2a3312}
.ua-sk__head h2{margin:0;font-size:1.1em;font-weight:800}
.ua-sk__state{margin-right:auto;padding:.25em .8em;border-radius:999px;background:color-mix(in srgb,var(--ua-accent) 14%,#fff);
  color:var(--ua-accent);font-size:.72em;font-weight:700}
.ua-sk__reload{display:inline-flex;align-items:center;gap:.4em;padding:.45em .9em;border:1px solid #1c2a3330;border-radius:999px;background:none;
  color:inherit;font:inherit;font-size:.75em;font-weight:700;cursor:pointer}
.ua-sk__reload svg{width:1.1em;height:1.1em;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.ua-sk__reload:focus-visible{outline:3px solid var(--ua-accent);outline-offset:2px}
.ua-sk__row{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:1em;padding:.95em 1.3em}
.ua-sk__row+.ua-sk__row{border-top:1px solid #1c2a330d}
.ua-sk__slot{position:relative;display:block;min-width:0}
.ua-sk__row{cursor:pointer}
.ua-sk__bone{position:absolute;inset:0;border-radius:.4em;transform-origin:left;background-color:var(--ua-bone);
  background-image:linear-gradient(100deg,transparent 35%,#ffffffd9 50%,transparent 65%);background-repeat:no-repeat;background-size:60cqw 100%;
  background-position:calc(var(--ua-shine,-80) * 1cqw - var(--ox,0px)) 0}
.ua-sk__slot--round .ua-sk__bone{border-radius:50%}
.ua-sk__slot--text{width:fit-content;max-width:100%}
.ua-sk__slot--text .ua-sk__bone{top:22%;bottom:22%}
.ua-sk__avatar{display:grid;place-items:center;width:2.9em;height:2.9em;border-radius:50%;background:var(--c);color:#fff;font-weight:800}
.ua-sk__body{display:grid;gap:.2em;min-width:0}
.ua-sk__meta{display:block;width:max-content;max-width:100%;font-size:.72em;opacity:.6}
.ua-sk__title{display:block;width:max-content;max-width:100%;font-size:.98em;font-weight:800;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ua-sk__text{display:block;font-size:.78em;line-height:1.5;opacity:.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ua-sk__thumb{position:relative;display:block;width:5.4em;height:3.8em;border-radius:.6em;overflow:hidden;background:var(--a)}
.ua-sk__thumb i{position:absolute;display:block}
.ua-sk__thumb i:nth-child(1){left:-10%;bottom:-40%;width:80%;aspect-ratio:1;border-radius:50%;background:var(--b)}
.ua-sk__thumb i:nth-child(2){right:10%;top:16%;width:26%;aspect-ratio:1;border-radius:50%;background:#ffffffcc}
.ua-sk__thumb i:nth-child(3){right:-12%;bottom:-30%;width:60%;aspect-ratio:1;background:var(--d);transform:rotate(30deg)}
`;

const ITEMS = [
  { initial: '佐', color: '#0f8b8d', meta: '佐藤 美咲 ・ 10 分前', title: '来週の定例は木曜 15 時に変わります', text: '会議室 B を押さえました。議題は金曜までに共有の表へ。', a: '#bfe3dc', b: '#0f8b8d', d: '#f4a259' },
  { initial: '田', color: '#e76f51', meta: '田中 悠人 ・ 1 時間前', title: '新しいロゴ案を 3 つ置きました', text: '色ちがいも入れています。気になる点はコメントで。', a: '#fde2d0', b: '#e76f51', d: '#2a9d8f' },
  { initial: '林', color: '#5b5f97', meta: '林 千夏 ・ きのう', title: '10 月の経費の締め切りは 5 日です', text: '領収書の写真は、明細ごとに 1 枚ずつ添えてください。', a: '#dcdcf2', b: '#5b5f97', d: '#ffc857' },
];

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-sk', { '--ua-bg': p.background, '--ua-accent': p.accent, '--ua-bone': p.bone });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();

  // 本物の内容の上に、同じ大きさの骨組みを重ねた 1 つの枠を作る。
  const slots = [];
  const slot = (real, kind, row) => {
    const bone = h('i', { class: 'ua-sk__bone', 'aria-hidden': 'true' });
    const el = h('span', { class: `ua-sk__slot ua-sk__slot--${kind}` }, real, bone);
    slots.push({ el, real, bone, row, kind });
    return el;
  };
  const rows = ITEMS.map((item, row) =>
    h(
      'div',
      { class: 'ua-sk__row' },
      slot(h('span', { class: 'ua-sk__avatar', style: { '--c': item.color }, text: item.initial, 'aria-hidden': 'true' }), 'round', row),
      h(
        'div',
        { class: 'ua-sk__body' },
        slot(h('span', { class: 'ua-sk__meta', text: item.meta }), 'text', row),
        slot(h('span', { class: 'ua-sk__title', text: item.title }), 'text', row),
        slot(h('span', { class: 'ua-sk__text', text: item.text }), 'text', row),
      ),
      slot(h('span', { class: 'ua-sk__thumb', style: { '--a': item.a, '--b': item.b, '--d': item.d }, 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), 'block', row),
    ),
  );
  const bar = h('i', { class: 'ua-sk__bar', 'aria-hidden': 'true' });
  const status = h('span', { class: 'ua-sk__state', role: 'status' });
  const reload = h(
    'button',
    { class: 'ua-sk__reload', type: 'button' },
    s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, s('path', { d: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5' })),
    '読み込み直す',
  );
  const card = h('div', { class: 'ua-sk__card' }, bar, h('div', { class: 'ua-sk__head' }, h('h2', { text: 'お知らせ' }), status, !p.preview && !reduced && reload), rows);
  root.appendChild(h('div', { class: 'ua-sk__in' }, card));

  if (reduced) {
    for (const { bone } of slots) bone.style.display = 'none';
    status.textContent = `${ITEMS.length} 件の新着`;
    return { destroy: () => removeRoot(root) };
  }

  // 光が骨組みをまたいで 1 本につながって見えるように、枠ごとの左端の位置を渡す。
  const measure = () => {
    const origin = root.getBoundingClientRect().left;
    for (const { bone } of slots) bone.style.setProperty('--ox', `${(bone.getBoundingClientRect().left - origin).toFixed(1)}px`);
  };
  measure();
  const resize = new ResizeObserver(measure);
  resize.observe(root);
  disposer.add(() => resize.disconnect());

  const shine = { at: -80 };
  const sweep = animate(shine, {
    at: [-60, 75],
    duration: 1500,
    ease: 'inOutSine',
    loop: true,
    loopDelay: 250,
    onUpdate: () => root.style.setProperty('--ua-shine', shine.at.toFixed(1)),
  });
  let waiting = null;
  let destroyed = false;
  const reals = slots.map((item) => item.real);
  const bones = slots.map((item) => item.bone);

  let loading = true;
  // from は起点にする行。そこから離れた行ほど遅れて動く。
  const lag = (row, from, i) => Math.abs(row - from) * 150 + (i % 5) * 55;

  function showSkeleton(instant, from = 0) {
    waiting?.pause();
    utils.remove([...reals, ...bones, bar, status, reload.firstChild]);
    loading = true;
    card.setAttribute('aria-busy', 'true');
    status.textContent = '読み込み中';
    sweep.play();
    if (instant) {
      utils.set(reals, { opacity: 0 });
      utils.set(bones, { opacity: 1 });
    } else {
      // 起点の行から順に、内容が薄れ、骨組みが左から伸びて覆う。
      slots.forEach(({ real, bone, row }, i) => {
        const delay = lag(row, from, i);
        animate(real, { opacity: 0, duration: 200, delay, ease: 'outQuad' });
        animate(bone, { opacity: [0, 1], scaleX: [0.25, 1], duration: 460, delay: delay + 80, ease: 'outExpo' });
      });
    }
    animate(bar, { scaleX: [0, 1], opacity: [1, 1], duration: p.load * 1000, ease: 'inOutQuad', onComplete: () => showContent() });
  }

  // 起点の行から順に、骨組みを消して本物の内容を出す。
  function showContent(from = 0) {
    if (destroyed) return;
    loading = false;
    card.setAttribute('aria-busy', 'false');
    status.textContent = `${ITEMS.length} 件の新着`;
    animate(status, { scale: [{ to: 1.22, duration: 140, ease: 'outQuad' }, { to: 1, duration: 600, ease: 'outElastic(1, .5)' }], delay: 380 });
    animate(bar, { opacity: 0, duration: 400, ease: 'outQuad' });
    slots.forEach(({ real, bone, row, kind }, i) => {
      const delay = lag(row, from, i);
      animate(bone, { opacity: 0, scaleX: kind === 'text' ? 0.96 : 1, duration: 320, delay, ease: 'outQuad' });
      if (kind === 'text') animate(real, { opacity: [0, 1], y: ['.5em', '0em'], duration: 650, delay: delay + 90, ease: 'outExpo' });
      else animate(real, { opacity: [0, 1], scale: [0.7, 1], duration: 800, delay: delay + 90, ease: 'outBack(1.8)' });
    });
    waiting = createTimer({
      duration: p.hold * 1000 + 900,
      onComplete: () => {
        sweep.pause();
        if (!destroyed) showSkeleton(false);
      },
    });
  }

  // 行を押したとき。読み込み中なら、進捗の線を一気に走らせて、その行から内容を出す。
  // 内容が出ているなら、その行から骨組みに戻して読み込み直す。
  function press(index) {
    const rowEl = rows[index];
    utils.remove(rowEl);
    animate(rowEl, {
      scale: [{ to: 0.975, duration: 110, ease: 'outQuad' }, { to: 1, duration: 620, ease: 'outElastic(1, .5)' }],
      x: [{ to: '.5em', duration: 110, ease: 'outQuad' }, { to: '0em', duration: 620, ease: 'outElastic(1, .5)' }],
    });
    if (!loading) {
      showSkeleton(false, index);
      return;
    }
    utils.remove(bar);
    animate(bar, { scaleX: 1, duration: 220, ease: 'outExpo', onComplete: () => showContent(index) });
  }

  showSkeleton(true);
  disposer.listen(reload, 'click', () => {
    showSkeleton(false);
    animate(reload.firstChild, { rotate: [0, 360], duration: 700, ease: 'outQuart' });
  });
  rows.forEach((rowEl, index) => disposer.listen(rowEl, 'click', () => press(index)));
  disposer.add(() => {
    waiting?.pause();
    sweep.pause();
    utils.remove(shine);
  });

  return {
    reload: () => showSkeleton(false),
    destroy() {
      destroyed = true;
      disposer.run();
      removeRoot(root);
    },
  };
}
