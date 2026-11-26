import { animate, createAnimatable, createTimer, spring, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'tilt-card',
  title: '傾くカード',
  category: 'ui',
  libs: ['animejs'],
  description:
    'ポインターの位置に合わせてカードが立体的に傾き、表面を光が動きます。中の絵と文字は高さを変えてあるので、傾けると奥行きが見えます。押すと、押した側へ一度沈んでから、絵と文字の層を浮かせて裏返り、裏面の項目が順に現れます。もう一度押すと表に戻ります。作品一覧や商品カードに使えます。',
  params: {
    maxTilt: { type: 'range', label: '傾きの大きさ（度）', min: 2, max: 30, step: 1, default: 14 },
    glare: { type: 'range', label: '光の強さ', min: 0, max: 1, step: 0.05, default: 0.5 },
    background: { type: 'color', label: '背景色', default: '#e6e8f2' },
  },
};

const CSS = `
.ua-tc{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:4%;overflow:hidden;
  container-type:size;perspective:1100px;background:var(--ua-bg);font-family:var(--ua-display,system-ui,sans-serif)}
.ua-tc__card{position:relative;width:min(25cqw,58cqh,280px);aspect-ratio:3/4;border-radius:7% / 5.25%;
  transform-style:preserve-3d;will-change:transform;color:#fff;
  box-shadow:0 30px 60px -28px rgba(20,22,60,.55)}
.ua-tc__art{position:absolute;inset:0;border-radius:inherit;overflow:hidden;background:var(--art)}
.ua-tc__art::after{content:"";position:absolute;inset:0;
  background:radial-gradient(circle at var(--gx,50%) var(--gy,0%),rgba(255,255,255,var(--glare)),transparent 55%);
  opacity:var(--on,0);transition:opacity .3s}
.ua-tc__orb{position:absolute;left:50%;top:38%;width:54%;aspect-ratio:1;border-radius:50%;background:var(--orb);
  translate:-50% -50%;transform:translateZ(50px);box-shadow:0 18px 30px -12px rgba(0,0,0,.45)}
.ua-tc__text{position:absolute;left:9%;right:9%;bottom:8%;transform:translateZ(34px)}
.ua-tc__name{margin:0;font-size:clamp(14px,3.1cqw,30px);font-weight:800;letter-spacing:-0.02em;line-height:1.1}
.ua-tc__note{margin:.35em 0 0;font-size:clamp(10px,1.35cqw,14px);opacity:.82}
.ua-tc__back{position:absolute;inset:0;border-radius:inherit;overflow:hidden;box-sizing:border-box;padding:11% 10%;
  display:flex;flex-direction:column;backface-visibility:hidden;-webkit-backface-visibility:hidden;transform:rotateY(180deg) translateZ(1px);
  background:linear-gradient(200deg,#1b1d2e,#0e0f1a);box-shadow:0 0 0 1px rgba(255,255,255,.14) inset}
.ua-tc__back::before{content:"";position:absolute;inset:0;background:var(--art);opacity:.28}
.ua-tc__seal{position:relative;display:block;width:30%;aspect-ratio:1;border-radius:50%;background:var(--orb);
  box-shadow:0 0 0 .35em rgba(255,255,255,.1),0 0 0 .8em rgba(255,255,255,.05)}
.ua-tc__no{position:relative;margin:auto 0 .5em;font-size:clamp(9px,1.2cqw,13px);letter-spacing:.16em;opacity:.7;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
.ua-tc__facts{position:relative;margin:0;padding:0;list-style:none;font-size:clamp(9px,1.3cqw,14px)}
.ua-tc__facts li{display:flex;justify-content:space-between;gap:.6em;padding:.5em 0;border-top:1px solid rgba(255,255,255,.2)}
.ua-tc__facts span{opacity:.65}
.ua-tc__card{cursor:pointer}
@container (max-width:560px){
  .ua-tc__facts,.ua-tc__no{font-size:clamp(9px,3cqw,14px)}
  .ua-tc__card{width:min(54cqw,62cqh)}
  .ua-tc__card:nth-child(n+2){display:none}
  .ua-tc__name{font-size:clamp(14px,6cqw,30px)}
  .ua-tc__note{font-size:clamp(10px,3cqw,14px)}
}
`;

const CARDS = [
  { name: 'Coral reef', note: '珊瑚と夕焼け', art: 'linear-gradient(160deg,#ff8f6b,#c2255c 70%,#5f0f40)', orb: 'radial-gradient(circle at 32% 28%,#fff1c9,#ffb347 55%,#ff6a3d)', facts: [['水深', '12 m'], ['水温', '27 ℃'], ['見ごろ', '夕方']] },
  { name: 'Deep field', note: '夜の海と月', art: 'linear-gradient(160deg,#2b3cff,#1b1464 65%,#0b0a2a)', orb: 'radial-gradient(circle at 32% 28%,#ffffff,#b9c6ff 50%,#6f7dff)', facts: [['月齢', '14.2'], ['波の高さ', '0.5 m'], ['見ごろ', '深夜']] },
  { name: 'Moss garden', note: '苔と朝露', art: 'linear-gradient(160deg,#b7e36b,#2f9e6a 60%,#0d4a45)', orb: 'radial-gradient(circle at 32% 28%,#fbffe0,#e3f56b 55%,#8fce3c)', facts: [['湿度', '86 %'], ['気温', '14 ℃'], ['見ごろ', '早朝']] },
];

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-tc', { '--ua-bg': p.background, '--glare': String(p.glare) });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const back = spring({ stiffness: 150, damping: 10 });

  CARDS.forEach(({ name, note, art, orb, facts }, index) => {
    const orbEl = h('div', { class: 'ua-tc__orb' });
    const textEl = h('div', { class: 'ua-tc__text' }, h('h3', { class: 'ua-tc__name', text: name }), h('p', { class: 'ua-tc__note', text: note }));
    const rows = facts.map(([key, value]) => h('li', {}, h('span', { text: key }), h('b', { text: value })));
    const backEl = h('div', { class: 'ua-tc__back', 'aria-hidden': 'true' }, h('i', { class: 'ua-tc__seal' }), h('p', { class: 'ua-tc__no', text: `No. 0${index + 1}` }), h('ul', { class: 'ua-tc__facts' }, rows));
    const card = h('article', { class: 'ua-tc__card', style: { '--art': art, '--orb': orb } }, h('div', { class: 'ua-tc__art' }), orbEl, textEl, backEl);
    root.appendChild(card);
    let flipped = false;
    if (reduced) {
      // 動きを減らす設定では、回さずに表と裏を切り替えるだけにする。
      disposer.listen(card, 'click', () => {
        flipped = !flipped;
        card.style.transform = flipped ? 'rotateY(180deg)' : '';
      });
      return;
    }

    const tilt = createAnimatable(card, { rotateX: 450, rotateY: 450, ease: 'out(3)' });
    disposer.add(() => tilt.revert());
    const state = { base: 0, flipping: false, hover: false, x: 0.5, y: 0.5 };
    const aim = () => {
      if (state.flipping) return;
      tilt.rotateY(state.base + (state.x - 0.5) * 2 * p.maxTilt);
      tilt.rotateX(-(state.y - 0.5) * 2 * p.maxTilt);
    };

    // 押すと裏返る。押した側へ沈んで力をため、絵と文字の層を浮かせながら半回転し、裏の項目が順に現れる。
    function flip(side = 1) {
      if (state.flipping) return;
      state.flipping = true;
      flipped = !flipped;
      const from = state.base;
      const to = from + side * 180;
      state.base = to;
      animate(card, {
        rotateY: [
          { to: from - side * 16, duration: 170, ease: 'outQuad' },
          { to, duration: 760, ease: 'outBack(1.5)' },
        ],
        rotateX: [{ to: 0, duration: 170 }, { to: 9, duration: 300, ease: 'outQuad' }, { to: 0, duration: 460, ease: 'outQuad' }],
        scale: [{ to: 0.93, duration: 170, ease: 'outQuad' }, { to: 1.08, duration: 330, ease: 'outQuad' }, { to: 1, duration: 600, ease: 'outElastic(1, .5)' }],
        onComplete() {
          // 回りすぎて数字が増え続けないように、同じ向きのまま 0 か 180 に戻す。
          state.base = ((Math.round(to / 180) % 2) + 2) % 2 === 1 ? 180 : 0;
          utils.set(card, { rotateY: state.base });
          state.flipping = false;
          if (state.hover) aim();
        },
      });
      // 層がいったん大きく離れてから、元の高さに戻る。
      animate(orbEl, { translateZ: [{ to: 120, duration: 330, delay: 150, ease: 'outQuad' }, { to: 50, duration: 700, ease: 'outElastic(1, .5)' }] });
      animate(textEl, { translateZ: [{ to: 78, duration: 330, delay: 210, ease: 'outQuad' }, { to: 34, duration: 700, ease: 'outElastic(1, .5)' }] });
      if (flipped) {
        animate(rows, { opacity: [0, 1], translateX: [side * -14, 0], duration: 520, delay: stagger(80, { start: 520 }), ease: 'outQuart' });
        animate(backEl.querySelector('.ua-tc__seal'), { scale: [0, 1], rotate: [-120, 0], duration: 800, delay: 480, ease: 'outBack(2)' });
      }
    }

    disposer.listen(card, 'pointerenter', () => {
      state.hover = true;
      card.style.setProperty('--on', '1');
    });
    disposer.listen(card, 'pointermove', (event) => {
      const { x, y } = localPointer(event, card);
      state.x = x;
      state.y = y;
      aim();
      card.style.setProperty('--gx', `${x * 100}%`);
      card.style.setProperty('--gy', `${y * 100}%`);
    });
    disposer.listen(card, 'pointerleave', () => {
      state.hover = false;
      card.style.setProperty('--on', '0');
      if (!state.flipping) animate(card, { rotateX: 0, rotateY: state.base, ease: back });
    });
    disposer.listen(card, 'click', (event) => {
      const { x } = localPointer(event, card);
      flip(event.detail === 0 || x >= 0.5 ? 1 : -1);
    });

    // 一覧の小さな枠では、触る前からゆっくり揺らして立体だと分かるようにし、数秒おきに裏返す。
    if (p.preview) {
      const born = performance.now() - index * 900;
      const idle = createTimer({
        onUpdate() {
          if (state.hover || state.flipping) return;
          const t = (performance.now() - born) / 1000;
          tilt.rotateY(state.base + Math.sin(t * 1.1) * p.maxTilt);
          tilt.rotateX(Math.cos(t * 0.8) * p.maxTilt * 0.4);
        },
      });
      disposer.add(() => idle.pause());
      disposer.interval(() => {
        if (!state.hover) flip(1);
      }, 3200 + index * 400);
    }
  });

  return {
    destroy() {
      disposer.run();
      removeRoot(root);
    },
  };
}
