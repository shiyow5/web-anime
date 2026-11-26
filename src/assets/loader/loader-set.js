import { animate, createDrawable, createTimeline, createTimer, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

const VARIANTS = [
  { value: 'dots', label: '跳ねる点' },
  { value: 'bars', label: '伸び縮みする棒' },
  { value: 'ring', label: '描かれる輪' },
  { value: 'morph', label: '形を変える四角' },
  { value: 'grid', label: '脈打つ格子' },
  { value: 'counter', label: '数字と進捗の線' },
];

export const meta = {
  id: 'loader-set',
  title: 'ローダー 6 種',
  category: 'loader',
  libs: ['animejs'],
  description:
    '読み込み中に出す小さなアニメーションを 6 種類まとめました。跳ねる点、伸び縮みする棒、描かれる輪、形を変える四角、脈打つ格子、数字と進捗の線です。押すと、押した場所に近いものから順に「完了」の形へ進みます。点は 1 つにまとまり、棒は階段にそろい、輪は閉じてチェックが描かれ、四角は丸い印になり、格子はチェックの形に光り、数字は 100% まで駆け上がります。少し見せてから、また読み込み中に戻ります。1 種類だけを大きく出すこともできます。',
  params: {
    variant: { type: 'select', label: '表示する種類', options: [{ value: 'all', label: '6 種類すべて' }, ...VARIANTS], default: 'all' },
    color: { type: 'color', label: '色', default: '#2438f5' },
    background: { type: 'color', label: '背景色', default: '#f4f5f9' },
    speed: { type: 'range', label: '速さ', min: 0.3, max: 3, step: 0.1, default: 1 },
  },
};

const CSS = `
.ua-ls{position:absolute;inset:0;display:grid;grid-template-columns:repeat(3,1fr);place-items:center;overflow:hidden;
  container-type:size;padding:4%;background:var(--ua-bg);color:var(--ua-color);cursor:pointer;
  font-family:var(--ua-display,system-ui,sans-serif)}
.ua-ls--single{grid-template-columns:1fr}
.ua-ls__cell{display:grid;justify-items:center;gap:1.4em;font-size:clamp(8px,2.2cqw,18px)}
.ua-ls--single .ua-ls__cell{font-size:clamp(14px,5cqw,40px)}
.ua-ls__stage{display:flex;align-items:center;justify-content:center;width:5em;height:5em}
.ua-ls__name{margin:0;font-size:clamp(10px,.8em,14px);color:color-mix(in srgb,var(--ua-color) 30%,#444)}
.ua-ls__name.is-done{color:var(--ua-color);font-weight:800}
.ua-ls--single .ua-ls__name{display:none}
.ua-ls__dots{display:flex;gap:.6em}
.ua-ls__dots i{width:.9em;height:.9em;border-radius:50%;background:currentColor}
.ua-ls__bars{display:flex;align-items:center;gap:.4em;height:3.4em}
.ua-ls__bars i{width:.5em;height:100%;border-radius:.3em;background:currentColor}
.ua-ls__ringbox{position:relative;width:4em;height:4em}
.ua-ls__ring{position:absolute;inset:0;width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:5;stroke-linecap:round;stroke-linejoin:round}
.ua-ls__check{opacity:0}
.ua-ls__morph{display:grid;place-items:center;width:2.8em;height:2.8em;border-radius:18%;background:currentColor}
.ua-ls__ok{display:block;opacity:0}
.ua-ls__ok i{display:block;width:1.1em;height:.55em;border:solid var(--ua-bg);border-width:0 0 .26em .26em;transform:translateY(-.14em) rotate(-45deg)}
.ua-ls__grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.35em;width:3.4em}
.ua-ls__grid i{aspect-ratio:1;border-radius:20%;background:currentColor}
.ua-ls__counter{display:grid;gap:.5em;width:5em;text-align:center}
.ua-ls__counter b{font-size:1.5em;font-weight:800;font-variant-numeric:tabular-nums;line-height:1}
.ua-ls__counter span{display:block;height:.3em;border-radius:.2em;background:color-mix(in srgb,currentColor 18%,transparent);overflow:hidden}
.ua-ls__counter span i{display:block;height:100%;background:currentColor;transform-origin:left;transform:scaleX(0)}
`;

const spans = (n) => Array.from({ length: n }, () => h('i'));
// 完了の形を見せ終えて、読み込み中へ戻り始める時刻（ミリ秒）。
const HOLD = 1900;
// 3 × 3 の格子で、チェックの形になるマス。
const CHECK_CELLS = [3, 7, 5, 2];

// 種類ごとに、要素 el、止めるときに使う対象 targets、くり返しの動き play、完了の演出 done を持つ。
// done は渡されたタイムラインに、準備 → 完了の形 → 元へ戻る、の順で動きを足す。
const LOADERS = {
  dots(t) {
    const el = h('div', { class: 'ua-ls__dots' }, spans(3));
    const dots = [...el.children];
    return {
      el,
      targets: dots,
      play() {
        animate(dots, {
          y: [
            { to: '-1.1em', duration: t(320), ease: 'outQuad' },
            { to: '0em', duration: t(320), ease: 'inQuad' },
          ],
          delay: stagger(t(130)),
          loop: true,
          loopDelay: t(260),
        });
      },
      // 沈んでから跳び、空中で中央に集まって、1 つの大きな点になって着地する。
      done(tl) {
        tl.add(dots, { y: '.35em', scaleY: 0.7, duration: 180, ease: 'outQuad', delay: stagger(40) }, 0)
          .add(dots, { y: '-1.2em', scaleY: 1, x: (_, i) => `${(1 - i) * 1.5}em`, duration: 300, ease: 'outQuad', delay: stagger(50) }, 240)
          .add(dots, { y: '0em', scale: (_, i) => (i === 1 ? 2.3 : 0.3), duration: 420, ease: 'outBounce' }, 640)
          .add(dots, { x: '0em', scale: 1, duration: 520, ease: 'outElastic(1, .6)', delay: stagger(70, { from: 'center' }) }, HOLD);
      },
    };
  },
  bars(t) {
    const el = h('div', { class: 'ua-ls__bars' }, spans(5));
    const bars = [...el.children];
    return {
      el,
      targets: bars,
      play() {
        animate(bars, { scaleY: [0.25, 1], duration: t(480), ease: 'inOutSine', delay: stagger(t(90)), alternate: true, loop: true });
      },
      // いったん全部つぶれ、左から順に伸びて、電波の表示のような階段にそろう。
      done(tl) {
        tl.add(bars, { scaleY: 0.12, duration: 200, ease: 'inQuad', delay: stagger(30, { from: 'center' }) }, 0)
          .add(bars, { scaleY: (_, i) => 0.3 + i * 0.175, duration: 480, ease: 'outBack(2.5)', delay: stagger(80) }, 300)
          .add(bars, { opacity: [{ to: 0.35, duration: 120 }, { to: 1, duration: 260 }], delay: stagger(70) }, 1000)
          .add(bars, { scaleY: 0.25, duration: 360, ease: 'inOutQuad', delay: stagger(40, { from: 'last' }) }, HOLD);
      },
    };
  },
  ring(t) {
    const circle = s('circle', { cx: 24, cy: 24, r: 19 });
    const check = s('path', { class: 'ua-ls__check', d: 'M15 25l6.5 6.5L34 18' });
    const svg = s('svg', { class: 'ua-ls__ring', viewBox: '0 0 48 48' }, circle);
    const el = h('div', { class: 'ua-ls__ringbox' }, svg, s('svg', { class: 'ua-ls__ring', viewBox: '0 0 48 48' }, check));
    let drawn = null;
    // 線を描く仕組みは、動かすときに初めて用意する（動きを減らす設定では使わない）。
    const drawables = () => {
      drawn ??= { circle: createDrawable(circle), check: createDrawable(check) };
      return drawn;
    };
    return {
      el,
      get targets() {
        return [svg, el, ...(drawn ? [...drawn.circle, ...drawn.check] : [])];
      },
      play() {
        animate(drawables().circle, { draw: ['0 0', '0 1', '1 1'], duration: t(1700), ease: 'inOutQuad', loop: true });
        animate(svg, { rotate: [0, 360], duration: t(2300), ease: 'linear', loop: true });
      },
      // 輪が最後まで閉じ、その中にチェックが描かれる。戻るときは、チェックも輪も描いた順に消える。
      done(tl) {
        const d = drawables();
        tl.add(d.circle, { draw: '0 1', duration: 320, ease: 'outQuad' }, 0)
          .add(svg, { rotate: 360, duration: 320, ease: 'outQuad' }, 0)
          .add(el, { scale: [{ to: 0.85, duration: 200, ease: 'outQuad' }, { to: 1.15, duration: 260, ease: 'outBack(3)' }, { to: 1, duration: 300, ease: 'outQuad' }] }, 0)
          .call(() => {
            check.style.opacity = '1';
          }, 330)
          .add(d.check, { draw: ['0 0', '0 1'], duration: 420, ease: 'outQuart' }, 340)
          .add(d.check, { draw: '1 1', duration: 300, ease: 'inQuad' }, HOLD)
          .add(d.circle, { draw: '1 1', duration: 400, ease: 'inQuad' }, HOLD + 100)
          .call(() => {
            check.style.opacity = '0';
          }, HOLD + 310);
      },
    };
  },
  morph(t) {
    const ok = h('span', { class: 'ua-ls__ok' }, h('i'));
    const el = h('div', { class: 'ua-ls__morph' }, ok);
    return {
      el,
      targets: [el, ok],
      play() {
        animate(el, {
          rotate: [0, 180],
          borderRadius: [{ to: '50%' }, { to: '18%' }],
          scale: [{ to: 0.6 }, { to: 1 }],
          duration: t(1500),
          ease: 'inOutQuart',
          loop: true,
        });
      },
      // 小さな丸に縮んでから大きくふくらみ、チェックの入った丸い印になる。
      done(tl) {
        tl.add(el, { scale: 0.4, borderRadius: '50%', rotate: 360, duration: 300, ease: 'inQuad' }, 0)
          .add(el, { scale: [{ to: 1.3, duration: 300, ease: 'outBack(3)' }, { to: 1.1, duration: 300, ease: 'outQuad' }] }, 320)
          .add(ok, { opacity: [0, 1], scale: [0, 1], duration: 420, ease: 'outBack(3)' }, 520)
          .add(ok, { opacity: 0, scale: 0, duration: 220, ease: 'inQuad' }, HOLD)
          .add(el, { scale: 1, borderRadius: '18%', duration: 420, ease: 'inOutQuart' }, HOLD + 120);
      },
    };
  },
  grid(t) {
    const el = h('div', { class: 'ua-ls__grid' }, spans(9));
    const cells = [...el.children];
    const inCheck = (i) => CHECK_CELLS.includes(i);
    return {
      el,
      targets: cells,
      play() {
        animate(cells, {
          scale: [1, 0.2],
          opacity: [1, 0.35],
          duration: t(600),
          ease: 'inOutQuad',
          delay: stagger(t(120), { grid: [3, 3], from: 'center' }),
          alternate: true,
          loop: true,
        });
      },
      // 中央から消え、左上から 1 マスずつ埋まり、最後にチェックの形のマスだけが残って光る。
      done(tl) {
        tl.add(cells, { scale: 0, duration: 220, ease: 'inQuad', delay: stagger(35, { grid: [3, 3], from: 'center' }) }, 0)
          .add(cells, { scale: 1, opacity: 1, duration: 380, ease: 'outBack(2.5)', delay: stagger(60) }, 380)
          .add(cells, { opacity: (_, i) => (inCheck(i) ? 1 : 0.16), scale: (_, i) => (inCheck(i) ? 1.12 : 0.8), duration: 360, ease: 'outQuad' }, 1120)
          .add(cells, { opacity: 1, scale: 1, duration: 320, ease: 'outQuad', delay: stagger(30) }, HOLD);
      },
    };
  },
  counter(t) {
    const number = h('b', { text: '0%' });
    const fill = h('i');
    const el = h('div', { class: 'ua-ls__counter' }, number, h('span', {}, fill));
    const state = { value: 0 };
    const render = () => {
      number.textContent = `${Math.round(state.value)}%`;
      fill.style.transform = `scaleX(${state.value / 100})`;
    };
    return {
      el,
      targets: [state, number, fill],
      play() {
        animate(state, { value: [0, 100], duration: t(2600), ease: 'inOutQuart', loop: true, loopDelay: t(600), onUpdate: render });
      },
      // 今の値から 100% まで一気に駆け上がり、数字が OK に変わる。戻るときは、線が右へ抜けていく。
      done(tl) {
        tl.add(state, { value: 100, duration: 420, ease: 'outExpo', onUpdate: render }, 0)
          .call(() => {
            number.textContent = 'OK';
          }, 460)
          .add(number, { scale: [{ to: 1.5, duration: 160, ease: 'outQuad' }, { to: 1, duration: 500, ease: 'outElastic(1, .5)' }] }, 460)
          .add(fill, { opacity: [{ to: 0.4, duration: 120 }, { to: 1, duration: 300 }] }, 460)
          .call(() => {
            fill.style.transformOrigin = 'right';
          }, HOLD)
          .add(state, { value: 0, duration: 380, ease: 'inQuad', onUpdate: render }, HOLD + 10)
          .call(() => {
            fill.style.transformOrigin = '';
          }, HOLD + 400);
      },
    };
  },
};

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const single = p.variant !== 'all';
  const root = createRoot(container, `ua-ls${single ? ' ua-ls--single' : ''}`, { '--ua-bg': p.background, '--ua-color': p.color });
  root.setAttribute('role', 'status');
  root.setAttribute('aria-label', '読み込み中');
  const reduced = prefersReducedMotion();
  const disposer = createDisposer();
  const t = (ms) => ms / p.speed;
  const timers = new Set();

  const cells = VARIANTS.filter((v) => !single || v.value === p.variant).map(({ value, label }) => {
    const loader = LOADERS[value](t);
    const name = h('p', { class: 'ua-ls__name', text: label });
    const box = h('div', { class: 'ua-ls__cell' }, h('div', { class: 'ua-ls__stage' }, loader.el), name);
    root.appendChild(box);
    if (!reduced) loader.play();
    return { loader, name, label, box, busy: false, timeline: null };
  });

  // 1 つのローダーを完了の形へ進め、見せ終わったら読み込み中へ戻す。
  function finish(cell) {
    utils.remove(cell.loader.targets);
    const timeline = createTimeline({
      onComplete: () => {
        cell.busy = false;
        cell.timeline = null;
        cell.loader.play();
      },
    });
    cell.loader.done(timeline);
    timeline
      .call(() => {
        cell.name.textContent = '完了';
        cell.name.classList.add('is-done');
      }, 700)
      .call(() => {
        cell.name.textContent = cell.label;
        cell.name.classList.remove('is-done');
      }, HOLD);
    cell.timeline = timeline;
  }

  // 押した場所（画面上の座標）に近いローダーから順に完了させる。完了の演出の途中のものは、そのまま続ける。
  function complete(clientX, clientY) {
    if (reduced) return;
    const frame = root.getBoundingClientRect();
    const reach = Math.hypot(frame.width, frame.height) || 1;
    const x = clientX ?? frame.left + frame.width / 2;
    const y = clientY ?? frame.top + frame.height / 2;
    for (const cell of cells) {
      if (cell.busy) continue;
      cell.busy = true;
      const rect = cell.box.getBoundingClientRect();
      const distance = Math.hypot(rect.left + rect.width / 2 - x, rect.top + rect.height / 2 - y);
      const timer = createTimer({
        duration: 1 + (distance / reach) * 700,
        onComplete: () => {
          timers.delete(timer);
          finish(cell);
        },
      });
      timers.add(timer);
    }
  }

  if (!reduced) {
    disposer.listen(root, 'pointerdown', (event) => complete(event.clientX, event.clientY));
    // 一覧の小さな枠では、数秒おきに完了の形を見せる。
    if (p.preview) disposer.interval(() => complete(), 5200);
  }

  return {
    complete: () => complete(),
    destroy() {
      disposer.run();
      for (const timer of timers) timer.pause();
      timers.clear();
      for (const cell of cells) {
        cell.timeline?.pause();
        utils.remove(cell.loader.targets);
      }
      removeRoot(root);
    },
  };
}
