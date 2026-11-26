import { animate, createAnimatable, onScroll, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'parallax-hero',
  title: '奥行きのある扉絵',
  category: 'scroll',
  libs: ['animejs'],
  description:
    '遠くの山、手前の山、木立の層が、スクロールで違う速さで動いて奥行きを作ります。進むにつれて日が沈み、星が出て、見出しが山の向こうへ隠れます。ポインターを動かすと層が左右にもずれます。旅や催しのページの最初の画面に使います。',
  params: {
    title: { type: 'text', label: '見出し', default: '雲の上の稜線へ', maxLength: 16 },
    depth: { type: 'range', label: '奥行きの強さ', min: 0.3, max: 1.6, step: 0.05, default: 1 },
    smooth: { type: 'range', label: '追従のなめらかさ', min: 0, max: 0.9, step: 0.05, default: 0.4 },
    sun: { type: 'color', label: '太陽の色', default: '#fff0c2' },
    glow: { type: 'color', label: '夕焼けの色', default: '#ff8f6b' },
  },
};

const CSS = `
.ua-ph{position:absolute;inset:0;overflow-x:hidden;overflow-y:auto;container-type:size;background:#14112b;color:#fff7ea;
  font-family:var(--ua-display,system-ui,sans-serif)}
.ua-ph.is-preview{overflow:hidden}
.ua-ph:focus-visible{outline:3px solid var(--ua-sun);outline-offset:-3px}
.ua-ph__pin{height:230cqh}
.ua-ph__scene{position:sticky;top:0;height:100cqh;overflow:hidden;
  background:linear-gradient(#2b2d6e 0%,#7a4f9e 34%,var(--ua-glow) 62%,#ffcf8a 80%)}
.ua-ph__full{position:absolute;inset:0}
.ua-ph__night{background:#0d0b26;opacity:0}
.ua-ph__stars i{position:absolute;width:2px;height:2px;border-radius:50%;background:#fff}
.ua-ph__stars{opacity:0}
.ua-ph__sun{position:absolute;left:62%;top:34%;width:min(15cqw,24cqh);aspect-ratio:1;border-radius:50%;background:var(--ua-sun);
  box-shadow:0 0 0 min(2.6cqw,4cqh) color-mix(in srgb,var(--ua-sun) 22%,transparent),0 0 0 min(6cqw,9cqh) color-mix(in srgb,var(--ua-sun) 10%,transparent)}
.ua-ph__layer{position:absolute;left:0;right:0;height:150cqh;will-change:transform}
.ua-ph__layer svg{position:absolute;left:-6%;top:0;width:112%;height:100%;display:block}
.ua-ph__haze{position:absolute;left:0;right:0;top:44cqh;height:26cqh;background:linear-gradient(transparent,color-mix(in srgb,var(--ua-glow) 55%,#fff) 70%,transparent);opacity:.4}
.ua-ph__title{display:grid;align-content:start;justify-items:center;gap:1.6cqh;padding-top:17cqh;text-align:center}
.ua-ph__title p{margin:0;font-size:clamp(9px,1.9cqw,16px);letter-spacing:.3em}
.ua-ph__title h2{margin:0;font-size:clamp(22px,min(9.5cqw,17cqh),120px);font-weight:800;letter-spacing:.02em;line-height:1.1;
  text-shadow:0 .04em .3em #2b2d6e55}
.ua-ph__hud{position:absolute;left:4cqw;bottom:4cqh;display:grid;gap:.3em;font-size:clamp(9px,1.6cqw,13px);
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.08em}
.ua-ph__hud b{font-size:1.7em;font-variant-numeric:tabular-nums}
.ua-ph__scale{position:absolute;right:4cqw;top:22cqh;bottom:22cqh;width:9px;
  background:repeating-linear-gradient(#fff7ea99 0 1px,transparent 1px 10%) right/100% 100% no-repeat}
.ua-ph__scale i{position:absolute;left:-3px;top:0;width:15px;height:2px;background:var(--ua-sun)}
.ua-ph__hint{position:absolute;left:0;right:0;bottom:5cqh;display:grid;justify-items:center;gap:.4em;font-size:clamp(9px,1.6cqw,13px);letter-spacing:.2em}
.ua-ph__hint i{width:1px;height:2.2em;background:currentColor;transform-origin:top}
.ua-ph__info{position:relative;display:grid;align-content:center;gap:2.4cqh;min-height:86cqh;padding:6cqh 8cqw;background:#14112b}
.ua-ph__info h3{margin:0;font-size:clamp(15px,min(4.4cqw,8cqh),44px);font-weight:800}
.ua-ph__day{display:grid;grid-template-columns:5.5em 1fr auto;align-items:baseline;gap:1em;padding:.9em 0;border-top:1px solid #fff7ea2e;
  font-size:clamp(10px,min(2.1cqw,4cqh),18px)}
.ua-ph__day b{color:var(--ua-glow);font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-weight:700}
.ua-ph__day span:last-child{opacity:.6;font-size:.85em}
.ua-ph__btn{justify-self:start;padding:.8em 1.7em;border:0;border-radius:999px;background:var(--ua-sun);color:#14112b;font:inherit;
  font-size:clamp(10px,min(2.1cqw,4cqh),17px);font-weight:800;cursor:pointer}
.ua-ph__btn:focus-visible{outline:3px solid #fff;outline-offset:4px}
`;

// 木立の影。決まった並びになるように、乱数を使わずに高さをずらす。
function pinePath() {
  let d = 'M0 100 V16';
  for (let x = 1.5; x < 100; x += 3.1) {
    const height = 7 + 5 * Math.abs(Math.sin(x * 1.7)) + 3 * Math.abs(Math.sin(x * 0.53));
    const ground = 16 + 2.4 * Math.sin(x * 0.11);
    d += ` L${(x - 1.3).toFixed(2)} ${ground.toFixed(2)} L${x.toFixed(2)} ${(ground - height).toFixed(2)} L${(x + 1.3).toFixed(2)} ${ground.toFixed(2)}`;
  }
  return `${d} L100 16 V100 Z`;
}

// 遠い層ほど上に置き、少ししか動かさない。move は自分の高さに対する割合（%）。
const LAYERS = [
  { top: 40, fill: '#8a66ad', move: -4, shift: 5, d: 'M0 14 L8 9 L15 12 L24 3 L33 11 L41 6 L52 13 L61 4 L70 10 L80 5 L90 12 L100 7 V100 H0Z' },
  { top: 52, fill: '#55407f', move: -10, shift: 10, d: 'M0 12 L10 5 L18 10 L30 1 L40 9 L50 4 L63 12 L74 3 L85 10 L100 2 V100 H0Z' },
  { top: 65, fill: '#2e2659', move: -18, shift: 18, d: 'M0 10 C15 0 25 12 40 6 S65 0 80 8 S95 4 100 6 V100 H0Z' },
  { top: 78, fill: '#14112b', move: -30, shift: 30, d: pinePath() },
];
const DAYS = [
  ['1 日目', '上高地から涸沢へ', '歩く時間 6 時間'],
  ['2 日目', '涸沢から稜線の小屋へ', '歩く時間 5 時間'],
  ['3 日目', '稜線を歩いて南の峰へ', '歩く時間 7 時間'],
];
const ALTITUDE = [1500, 3180];

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, `ua-ph${p.preview ? ' is-preview' : ''}`, { '--ua-sun': p.sun, '--ua-glow': p.glow });
  const disposer = createDisposer();
  if (!p.preview) {
    root.tabIndex = 0;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', `${p.title}（スクロールできます）`);
  }

  const stars = h('div', { class: 'ua-ph__full ua-ph__stars', 'aria-hidden': 'true' }, Array.from({ length: p.preview ? 24 : 46 }, (_, i) => {
    const size = 1 + (i % 3);
    return h('i', { style: { left: `${(i * 37.7) % 100}%`, top: `${(i * 23.3) % 46}%`, width: `${size}px`, height: `${size}px`, opacity: 0.4 + (i % 5) * 0.15 } });
  }));
  const sun = h('div', { class: 'ua-ph__sun' });
  const sunWrap = h('div', { class: 'ua-ph__full', 'aria-hidden': 'true' }, sun);
  const night = h('div', { class: 'ua-ph__full ua-ph__night' });
  const layers = LAYERS.map(({ top, fill, d, move, shift }) => {
    const svg = s('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' }, s('path', { d, fill }));
    return { el: h('div', { class: 'ua-ph__layer', style: { top: `${top}cqh` } }, svg), svg, move, shift };
  });
  const heading = h('h2', { text: p.title });
  const title = h('div', { class: 'ua-ph__full ua-ph__title' }, h('p', { text: '北アルプス 3 泊 4 日' }), heading);
  const altitude = h('b', { text: `${ALTITUDE[0].toLocaleString('en-US')} m` });
  const hud = h('div', { class: 'ua-ph__hud', 'aria-hidden': 'true' }, h('span', { text: '標高' }), altitude);
  const marker = h('i');
  const scale = h('div', { class: 'ua-ph__scale', 'aria-hidden': 'true' }, marker);
  const hintLine = h('i');
  const hint = h('div', { class: 'ua-ph__hint' }, h('span', { text: '下へスクロール' }), hintLine);
  const scene = h(
    'div',
    { class: 'ua-ph__scene' },
    sunWrap,
    layers[0].el,
    night,
    stars,
    h('div', { class: 'ua-ph__haze' }),
    layers[1].el,
    title,
    layers[2].el,
    layers[3].el,
    hud,
    scale,
    !p.preview && hint,
  );
  const pin = h('div', { class: 'ua-ph__pin' }, scene);
  const days = DAYS.map(([day, route, time]) => h('div', { class: 'ua-ph__day' }, h('b', { text: day }), h('span', { text: route }), h('span', { text: time })));
  const button = h('button', { class: 'ua-ph__btn', type: 'button', text: '行程表を見る' });
  const infoTitle = h('h3', { text: '歩く道のり' });
  const info = h('section', { class: 'ua-ph__info' }, infoTitle, days, button);
  root.append(pin, info);

  if (prefersReducedMotion()) {
    return { destroy: () => removeRoot(root) };
  }

  const animations = [];
  const sync = p.smooth > 0 ? p.smooth : true;
  // 扉絵が貼り付いている間（pin の上端から下端まで）の進み具合に合わせる。
  const pinned = () => onScroll({ container: root, target: pin, enter: 'top top', leave: 'bottom bottom', sync });
  const add = (targets, params) => animations.push(animate(targets, { ease: 'linear', ...params }));

  for (const { el, move } of layers) add(el, { y: ['0%', `${move * p.depth}%`], autoplay: pinned() });
  add(sunWrap, { y: ['0%', `${34 * p.depth}%`], autoplay: pinned() });
  add(sun, { scale: [1, 1.25], autoplay: pinned() });
  add(night, { opacity: [0, 0.72], autoplay: pinned() });
  add(stars, { opacity: [0, 1], y: ['0%', '-3%'], ease: 'inQuad', autoplay: pinned() });
  add(title, { y: ['0%', `${26 * p.depth}%`], autoplay: pinned() });
  add(heading, { letterSpacing: ['0.02em', '0.2em'], opacity: [1, 0.25], ease: 'inQuad', autoplay: pinned() });
  add(marker, { top: ['0%', '100%'], autoplay: pinned() });
  add(hint, { opacity: [1, 0], duration: 300, autoplay: onScroll({ container: root, target: pin, enter: 'top top', leave: 'top+=15% top', sync: true }) });
  const state = { altitude: ALTITUDE[0] };
  add(state, {
    altitude: ALTITUDE,
    autoplay: pinned(),
    onUpdate: () => {
      altitude.textContent = `${Math.round(state.altitude).toLocaleString('en-US')} m`;
    },
  });
  add([infoTitle, ...days, button], {
    opacity: [0, 1],
    y: [28, 0],
    duration: 850,
    ease: 'outExpo',
    delay: stagger(110),
    autoplay: onScroll({ container: root, target: info, enter: 'bottom-=10% top' }),
  });
  const pulse = animate(hintLine, { scaleY: [0, 1], duration: 1100, ease: 'inOutQuart', alternate: true, loop: true });

  // ポインターの左右の位置で、層を奥行きに応じてずらす。
  const sliders = layers.map(({ svg }) => createAnimatable(svg, { x: 700, ease: 'out(3)' }));
  disposer.listen(root, 'pointermove', (event) => {
    const { x } = localPointer(event, root);
    layers.forEach(({ shift }, i) => sliders[i].x((0.5 - x) * shift * p.depth));
  });
  disposer.listen(root, 'pointerleave', () => sliders.forEach((slider) => slider.x(0)));

  // 一覧の小さな枠では、自動で上下にスクロールして見せる。
  const scrollState = { top: 0 };
  if (p.preview) {
    disposer.timeout(() => {
      const max = root.scrollHeight - root.clientHeight;
      if (max <= 0) return;
      animate(scrollState, {
        top: [0, max],
        duration: 9000,
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
      pulse.pause();
      for (const slider of sliders) slider.revert();
      for (const animation of animations) animation.revert();
      removeRoot(root);
    },
  };
}
