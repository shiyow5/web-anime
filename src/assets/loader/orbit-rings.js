import { animate, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'orbit-rings',
  title: '多軸の輪のローダー',
  category: 'loader',
  libs: ['animejs'],
  description:
    '目盛りの付いた輪が入れ子になり、外の輪に支えられた内の輪が、それぞれ別の軸で回り続けます。輪の上を光の粒が尾を引いて走り、小さな輪が立ったまま自分の軸で回ります。CSS の 3D 変形だけで作ってあり、ポインターで全体が傾き、クリックすると一瞬だけ速く回ります。読み込み中や処理中の表示に使えます。',
  params: {
    colorA: { type: 'color', label: '外側の輪の色', default: '#7cf3ff' },
    colorB: { type: 'color', label: '内側の輪の色', default: '#ff7ad9' },
    background: { type: 'color', label: '背景色', default: '#070913' },
    count: { type: 'range', label: '輪の本数', min: 4, max: 6, step: 1, default: 5 },
    size: { type: 'range', label: '大きさ', min: 0.5, max: 1.15, step: 0.05, default: 1 },
    speed: { type: 'range', label: '速さ', min: 0.2, max: 3, step: 0.1, default: 1 },
    label: { type: 'text', label: '下に出す文字', default: 'LOADING', maxLength: 24 },
  },
};

const CSS = `
.ua-or{position:absolute;inset:0;overflow:hidden;container-type:size;background:var(--ua-bg)}
.ua-or__view{position:absolute;inset:0;display:grid;place-items:center;perspective:190cqmin;
  background:radial-gradient(circle at 50% 46%,color-mix(in srgb,var(--ua-a) 13%,transparent),transparent 62%)}
.ua-or__tilt,.ua-or__scene,.ua-or__axis,.ua-or__spin,.ua-or__orbit,.ua-or__sat,.ua-or__coin{transform-style:preserve-3d}
.ua-or__tilt{grid-area:1/1;width:calc(var(--ua-size)*66cqmin);aspect-ratio:1;margin-bottom:5cqmin;transition:transform .35s ease-out}
.ua-or__scene{position:relative;width:100%;height:100%}
.ua-or__axis{position:absolute;inset:var(--inset,0)}
.ua-or__spin,.ua-or__orbit{position:absolute;inset:0}
.ua-or__band{position:absolute;inset:0;border-radius:50%;border:max(1.5px,.6cqmin) solid var(--c);
  outline:1px dashed color-mix(in srgb,var(--c) 55%,transparent);outline-offset:-2.4cqmin;
  box-shadow:0 0 2.4cqmin color-mix(in srgb,var(--c) 60%,transparent),inset 0 0 2.4cqmin color-mix(in srgb,var(--c) 38%,transparent)}
.ua-or__band::before,.ua-or__band::after{content:"";position:absolute;inset:0;border-radius:50%}
.ua-or__band::before{background:repeating-conic-gradient(var(--c) 0 .7deg,transparent .7deg var(--step));opacity:.75;
  -webkit-mask:radial-gradient(closest-side,transparent calc(100% - 1.3cqmin),#000 calc(100% - 1.2cqmin));
  mask:radial-gradient(closest-side,transparent calc(100% - 1.3cqmin),#000 calc(100% - 1.2cqmin))}
.ua-or__band::after{background:repeating-conic-gradient(from -1deg,#fff 0 2deg,transparent 2deg 30deg);opacity:.85;
  -webkit-mask:radial-gradient(closest-side,transparent calc(100% - 2.2cqmin),#000 calc(100% - 2.1cqmin));
  mask:radial-gradient(closest-side,transparent calc(100% - 2.2cqmin),#000 calc(100% - 2.1cqmin))}
.ua-or__tail{position:absolute;inset:-.5cqmin;border-radius:50%;background:conic-gradient(transparent 0 58%,var(--c) 86%,#fff 100%);
  -webkit-mask:radial-gradient(closest-side,transparent calc(100% - 1.2cqmin),#000 calc(100% - 1.1cqmin));
  mask:radial-gradient(closest-side,transparent calc(100% - 1.2cqmin),#000 calc(100% - 1.1cqmin))}
.ua-or__bead{position:absolute;left:50%;top:0;--b:max(1.5cqmin,5.5%);width:var(--b);aspect-ratio:1;margin:calc(var(--b)/-2) 0 0 calc(var(--b)/-2);
  transform-style:preserve-3d}
.ua-or__bead,.ua-or__bead::before,.ua-or__bead::after{border-radius:50%;background:radial-gradient(circle,#fff 0 34%,var(--c) 62%,transparent 74%);
  box-shadow:0 0 1.6cqmin var(--c),0 0 3.6cqmin color-mix(in srgb,var(--c) 70%,transparent)}
.ua-or__bead::before,.ua-or__bead::after{content:"";position:absolute;inset:0}
.ua-or__bead::before{transform:rotateX(90deg)}
.ua-or__bead::after{transform:rotateY(90deg)}
.ua-or__sat{position:absolute;left:50%;top:100%;--s:max(4cqmin,17%);width:var(--s);aspect-ratio:1;margin:calc(var(--s)/-2) 0 0 calc(var(--s)/-2);
  transform:rotateY(90deg)}
.ua-or__coin{position:absolute;inset:0}
.ua-or__coin i{position:absolute;inset:0;border-radius:50%;border:max(1px,.35cqmin) solid #fff;
  background:repeating-conic-gradient(var(--c) 0 3deg,transparent 3deg 22.5deg);
  -webkit-mask:radial-gradient(closest-side,transparent 62%,#000 64%);mask:radial-gradient(closest-side,transparent 62%,#000 64%);
  box-shadow:0 0 1.6cqmin var(--c)}
.ua-or__core{grid-area:1/1;width:calc(var(--ua-size)*7cqmin);aspect-ratio:1;margin-bottom:5cqmin;border-radius:50%;
  background:radial-gradient(circle,#fff 0 18%,var(--ua-b) 46%,transparent 70%);box-shadow:0 0 6cqmin var(--ua-b)}
.ua-or__label{position:absolute;left:0;right:0;bottom:5cqh;margin:0;text-align:center;color:var(--ua-a);
  font:600 max(9px,2.7cqmin)/1 ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.5em;text-indent:.5em;
  text-shadow:0 0 1.5cqmin color-mix(in srgb,var(--ua-a) 70%,transparent)}
`;

// 輪ごとの軸。tilt は親の輪の面の中での軸の向き、prop は回す軸、start は回り始めの角度、period は 1 回転の秒数。
const RINGS = [
  { tilt: 0, prop: 'rotateY', start: 24, period: 11, dir: 1, step: '6deg' },
  { tilt: 62, prop: 'rotateX', start: 58, period: 8.2, dir: -1, step: '7.5deg' },
  { tilt: -48, prop: 'rotateY', start: 110, period: 6.4, dir: 1, step: '9deg' },
  { tilt: 90, prop: 'rotateX', start: 40, period: 5.2, dir: -1, step: '10deg' },
  { tilt: 35, prop: 'rotateY', start: 75, period: 4.3, dir: 1, step: '12deg' },
  { tilt: -70, prop: 'rotateX', start: 130, period: 3.6, dir: -1, step: '15deg' },
];

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-or', { '--ua-bg': p.background, '--ua-a': p.colorA, '--ua-b': p.colorB, '--ua-size': String(p.size) });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const count = Math.round(p.count);

  // 輪は入れ子にする。外の輪の回る部分（spin）の中に、次の輪の軸（axis）が入る。
  const parts = RINGS.slice(0, count).map((ring, i) => {
    const mix = count > 1 ? Math.round((i / (count - 1)) * 100) : 0;
    const color = `color-mix(in srgb, ${p.colorB} ${mix}%, ${p.colorA})`;
    const bead = h('div', { class: 'ua-or__bead' });
    const orbit = h('div', { class: 'ua-or__orbit' }, h('div', { class: 'ua-or__tail' }), bead);
    const coin = i % 2 === 0 ? h('div', { class: 'ua-or__coin' }, h('i')) : null;
    if (coin) orbit.appendChild(h('div', { class: 'ua-or__sat' }, coin));
    const spin = h('div', { class: 'ua-or__spin' }, h('div', { class: 'ua-or__band' }), orbit);
    const axis = h('div', { class: 'ua-or__axis', style: { '--c': color, '--step': ring.step, '--inset': i === 0 ? '0' : '7.5%' } }, spin);
    return { ring, axis, spin, orbit, coin };
  });
  parts.forEach((part, i) => {
    if (i > 0) parts[i - 1].spin.appendChild(part.axis);
  });
  const scene = h('div', { class: 'ua-or__scene' }, parts[0].axis);
  const tilt = h('div', { class: 'ua-or__tilt' }, scene);
  const core = h('div', { class: 'ua-or__core' });
  const label = h('p', { class: 'ua-or__label', text: p.label });
  root.append(h('div', { class: 'ua-or__view' }, core, tilt), label);

  if (reduced) {
    // 動きを止めた完成形。輪がそれぞれ別の向きに開いた状態で見せる。
    scene.style.transform = 'rotateX(-22deg) rotateY(32deg)';
    parts.forEach((part, i) => {
      part.axis.style.transform = `rotateZ(${part.ring.tilt}deg)`;
      part.spin.style.transform = `${part.ring.prop}(${part.ring.start}deg)`;
      part.orbit.style.transform = `rotateZ(${i * 67}deg)`;
    });
    return {
      pulse() {},
      destroy() {
        disposer.run();
        removeRoot(root);
      },
    };
  }

  const second = 1000 / p.speed;
  const loops = [];
  // 全体も 2 つの軸でゆっくり向きを変える。
  animate(scene, { rotateY: [0, 360], duration: 30 * second, ease: 'linear', loop: true });
  animate(scene, { rotateX: [-30, 30], duration: 8 * second, ease: 'inOutSine', alternate: true, loop: true });
  parts.forEach((part, i) => {
    const { ring } = part;
    loops.push(animate(part.spin, { [ring.prop]: [ring.start, ring.start + 360 * ring.dir], duration: ring.period * second, ease: 'linear', loop: true }));
    loops.push(animate(part.orbit, { rotateZ: [i * 67, i * 67 - 360 * ring.dir], duration: (2.6 - i * 0.22) * second, ease: 'linear', loop: true }));
    if (part.coin) loops.push(animate(part.coin, { rotateY: [0, 360], duration: 1.7 * second, ease: 'linear', loop: true }));
  });
  // 登場。外の輪から順に、別の向きから回り込んで軸の位置に収まる。
  animate(
    parts.map((part) => part.axis),
    { rotateZ: (_, i) => [parts[i].ring.tilt - 150, parts[i].ring.tilt], scale: [0, 1], duration: 1500, delay: stagger(170), ease: 'outExpo' },
  );
  animate(core, { scale: [0.82, 1.12], duration: 900, ease: 'inOutSine', alternate: true, loop: true });
  animate(label, { opacity: [0.35, 1], duration: 1100, ease: 'inOutSine', alternate: true, loop: true });

  disposer.listen(root, 'pointermove', (event) => {
    const { x, y } = localPointer(event, root);
    tilt.style.transform = `rotateX(${((0.5 - y) * 36).toFixed(1)}deg) rotateY(${((x - 0.5) * 36).toFixed(1)}deg)`;
  });
  disposer.listen(root, 'pointerleave', () => {
    tilt.style.transform = '';
  });

  // 一瞬だけ速く回し、全体をふくらませて戻す。
  const boost = { v: 1 };
  function pulse() {
    utils.remove(boost);
    animate(boost, {
      v: [4, 1],
      duration: 1600,
      ease: 'outQuad',
      onUpdate() {
        for (const loop of loops) loop.speed = boost.v;
      },
    });
    animate(scene, {
      scale: [
        { to: 1.14, duration: 150, ease: 'outQuad' },
        { to: 1, duration: 1000, ease: 'outElastic(1, .4)' },
      ],
    });
  }
  disposer.listen(root, 'pointerdown', pulse);

  return {
    pulse,
    destroy() {
      disposer.run();
      utils.remove(boost);
      removeRoot(root);
    },
  };
}
