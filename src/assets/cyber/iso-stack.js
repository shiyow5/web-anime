import { animate, createTimer, spring, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'iso-stack',
  title: '等角に重なる画面',
  category: 'cyber',
  libs: ['animejs'],
  description:
    '透明な 5 枚の画面を、斜め上から見下ろす角度で重ねました。土台の方眼、地図の点、棒グラフ、コードの行、見出しの板が、それぞれの高さで別々に動きます。全体は開いたり閉じたりをくり返し、ポインターを乗せた板は浮き上がります。板をタップすると、重なりが開いたまま止まり、その板だけが横へ引き出されて走査の線が通り、層の名前が出てから元の位置へ戻ります。サービスの仕組みを層で説明する場面に使えます。',
  params: {
    lineA: { type: 'color', label: '線の色 A', default: '#5ef2ff' },
    lineB: { type: 'color', label: '線の色 B', default: '#b46bff' },
    accent: { type: 'color', label: '差し色', default: '#ffcf5c' },
    background: { type: 'color', label: '背景色', default: '#0b1020' },
    gap: { type: 'range', label: '開いたときの間隔', min: 0.05, max: 0.3, step: 0.01, default: 0.17 },
    angle: { type: 'range', label: '見下ろす角度（度）', min: 30, max: 70, step: 1, default: 57 },
  },
};

const CSS = `
.ua-is{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;container-type:size;background:var(--ua-bg)}
.ua-is__scene{width:min(62cqw,78cqh);aspect-ratio:1;perspective:2600px}
.ua-is__stack{position:relative;width:100%;height:100%;transform-style:preserve-3d}
.ua-is__panel{position:absolute;inset:0;box-sizing:border-box;padding:7%;border:1.5px solid var(--c);border-radius:5%;
  background:color-mix(in srgb,var(--c) 9%,color-mix(in srgb,var(--ua-bg) 72%,transparent));
  box-shadow:0 0 0 1px color-mix(in srgb,var(--c) 25%,transparent) inset;color:var(--c);
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:3.4cqmin;overflow:hidden}
.ua-is__grid{background-image:linear-gradient(color-mix(in srgb,var(--c) 30%,transparent) 1px,transparent 1px),
  linear-gradient(90deg,color-mix(in srgb,var(--c) 30%,transparent) 1px,transparent 1px);background-size:10% 10%}
.ua-is__dots{display:grid;grid-template-columns:repeat(8,1fr);gap:6%;height:100%;align-content:space-between}
.ua-is__dots i{aspect-ratio:1;border-radius:50%;background:currentColor;opacity:.25}
.ua-is__bars{display:flex;align-items:flex-end;gap:5%;height:100%}
.ua-is__bars i{flex:1;height:100%;background:currentColor;transform-origin:50% 100%;border-radius:6% 6% 0 0}
.ua-is__lines{display:grid;gap:7%;align-content:start}
.ua-is__lines i{height:.5em;border-radius:.3em;background:currentColor;transform-origin:0 50%}
.ua-is__head{display:grid;align-content:space-between;height:100%}
.ua-is__chrome{display:flex;gap:4%}
.ua-is__chrome i{width:7%;aspect-ratio:1;border-radius:50%;background:currentColor}
.ua-is__chrome i:first-child{background:var(--ua-accent)}
.ua-is__value{margin:0;font-family:var(--ua-display,system-ui,sans-serif);font-size:4.4em;font-weight:800;line-height:1;color:var(--ua-accent)}
.ua-is__label{margin:0;opacity:.8}
.ua-is__sweep{position:absolute;top:0;bottom:0;left:0;width:18%;pointer-events:none;opacity:0;
  background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--ua-accent) 55%,transparent),transparent)}
.ua-is__tag{position:absolute;right:5%;bottom:4%;margin:0;padding:.2em .6em;font-size:.82em;letter-spacing:.1em;opacity:0;pointer-events:none;
  color:var(--ua-bg);background:var(--ua-accent);border-radius:.3em}
`;

const LAYERS = ['GRID', 'NODES', 'METRICS', 'SOURCE', 'STATUS'];
const items = (n) => Array.from({ length: n }, () => h('i'));

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-is', { '--ua-bg': p.background, '--ua-accent': p.accent });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();

  const dots = items(40);
  const bars = items(8);
  const lines = items(7);
  const value = h('p', { class: 'ua-is__value', text: '0' });
  const contents = [
    h('div', { class: 'ua-is__grid', style: { height: '100%' } }),
    h('div', { class: 'ua-is__dots' }, dots),
    h('div', { class: 'ua-is__bars' }, bars),
    h('div', { class: 'ua-is__lines' }, lines),
    h('div', { class: 'ua-is__head' }, h('div', { class: 'ua-is__chrome' }, items(3)), h('div', {}, value, h('p', { class: 'ua-is__label', text: '稼働中の接続' }))),
  ];
  const sweeps = contents.map(() => h('div', { class: 'ua-is__sweep' }));
  const tags = LAYERS.map((name, i) => h('p', { class: 'ua-is__tag', text: `L${i + 1} / ${name}` }));
  const panels = contents.map((content, i) => h('div', { class: 'ua-is__panel', style: { '--c': i % 2 ? p.lineB : p.lineA } }, content, sweeps[i], tags[i]));
  const stack = h('div', { class: 'ua-is__stack', style: { transform: `rotateX(${p.angle}deg) rotateZ(-38deg)` } }, panels);
  const scene = h('div', { class: 'ua-is__scene' }, stack);
  root.appendChild(scene);

  const state = { gap: reduced ? p.gap : 0.02 };
  const lifts = panels.map(() => ({ v: 0 }));
  // タップで引き出すときの値。pick は引き出した量、dim は板の濃さ、hold は重なりを開いたまま保つ量。
  const picks = panels.map(() => ({ v: 0 }));
  const dims = panels.map(() => ({ v: 1 }));
  const hold = { v: 0 };
  const counter = { v: 0 };
  let size = 300;
  const measure = () => {
    size = scene.getBoundingClientRect().width || 300;
  };
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(root);
  disposer.add(() => observer.disconnect());

  // 板を下から順に持ち上げる。重なりの中心が枠の中央に来るように、半分だけ下げる。
  function place() {
    panels.forEach((panel, i) => {
      const gap = state.gap + (p.gap - state.gap) * hold.v;
      const z = ((i - (panels.length - 1) / 2) * gap + lifts[i].v * 0.07 + picks[i].v * 0.05) * size;
      const slide = picks[i].v * 0.42 * size;
      panel.style.transform = `translateZ(${z.toFixed(1)}px) translateX(${slide.toFixed(1)}px)`;
      panel.style.opacity = dims[i].v.toFixed(3);
    });
  }
  place();
  lines.forEach((line, i) => {
    line.style.width = `${40 + ((i * 37) % 55)}%`;
  });
  if (reduced) {
    value.textContent = '1,284';
    return {
      destroy() {
        disposer.run();
        removeRoot(root);
      },
    };
  }

  const loop = createTimer({ onUpdate: place });
  disposer.add(() => loop.pause());

  // 全体の開閉。開いて、しばらく止まり、閉じる。
  animate(state, {
    gap: [
      { to: p.gap, duration: 1400, ease: 'outExpo' },
      { to: p.gap, duration: 2600 },
      { to: 0.02, duration: 1100, ease: 'inOutQuart' },
      { to: 0.02, duration: 500 },
    ],
    loop: true,
  });
  // 板ごとの中身の動き。
  animate(dots, { opacity: [0.25, 1], scale: [1, 1.5], duration: 700, ease: 'inOutSine', delay: stagger(60, { grid: [8, 5], from: 'center' }), alternate: true, loop: true });
  animate(bars, { scaleY: () => utils.random(0.15, 1, 2), duration: 900, ease: 'inOutQuart', delay: stagger(70), loop: true, alternate: true, onLoop: (self) => self.refresh() });
  animate(lines, { scaleX: [0, 1], duration: 600, ease: 'outExpo', delay: stagger(110), loop: true, loopDelay: 1600 });
  animate(counter, {
    v: [0, 1284],
    duration: 2400,
    ease: 'outExpo',
    loop: true,
    loopDelay: 2200,
    onUpdate() {
      value.textContent = Math.round(counter.v).toLocaleString('en-US');
    },
  });

  const lift = spring({ stiffness: 160, damping: 12 });
  panels.forEach((panel, i) => {
    disposer.listen(panel, 'pointerenter', () => animate(lifts[i], { v: 1, ease: lift }));
    disposer.listen(panel, 'pointerleave', () => animate(lifts[i], { v: 0, ease: lift }));
  });

  // 層の引き出し。開いて止まる（準備）→ タップした板が横へ出て、走査の線と名前が出る（山場）→ 近い板から順に濃さが戻り、板が収まる（余韻）。
  let cursor = 2;
  function pullOut(index = cursor) {
    const chosen = ((index % panels.length) + panels.length) % panels.length;
    cursor = chosen + 1;
    utils.remove([hold, ...picks, ...dims, ...sweeps, ...tags]);
    animate(hold, {
      v: [
        { to: 1, duration: 320, ease: 'outQuart' },
        { to: 0, duration: 700, delay: 2300, ease: 'inOutQuart' },
      ],
    });
    panels.forEach((_, i) => {
      const far = Math.abs(i - chosen);
      if (i === chosen) {
        animate(dims[i], { v: 1, duration: 200 });
        animate(picks[i], {
          v: [
            { to: 1, delay: 220, ease: spring({ stiffness: 140, damping: 13 }) },
            { to: 0, delay: 1200, ease: spring({ stiffness: 110, damping: 14 }) },
          ],
        });
        return;
      }
      animate(picks[i], { v: 0, duration: 300, ease: 'outQuart' });
      animate(dims[i], {
        v: [
          { to: 0.22, duration: 300, delay: far * 60, ease: 'outQuad' },
          { to: 1, duration: 500, delay: 1900 + far * 110, ease: 'outQuad' },
        ],
      });
    });
    for (const [i, sweep] of sweeps.entries()) if (i !== chosen) sweep.style.opacity = '0';
    for (const [i, tag] of tags.entries()) if (i !== chosen) tag.style.opacity = '0';
    animate(sweeps[chosen], {
      left: ['-18%', '100%'],
      opacity: [
        { to: 1, duration: 60 },
        { to: 1, duration: 560 },
        { to: 0, duration: 80 },
      ],
      duration: 700,
      delay: 520,
      ease: 'inOutQuad',
    });
    animate(tags[chosen], {
      opacity: [
        { to: 1, duration: 200, delay: 620 },
        { to: 0, duration: 300, delay: 1300 },
      ],
      translateY: [{ from: '60%', to: '0%', duration: 380, delay: 620, ease: 'outBack(2)' }],
    });
  }
  panels.forEach((panel, i) => {
    disposer.listen(panel, 'click', (event) => {
      event.stopPropagation();
      pullOut(i);
    });
  });
  disposer.listen(root, 'click', () => pullOut());
  if (p.preview) disposer.interval(() => pullOut(), 4400);

  return {
    pullOut,
    destroy() {
      disposer.run();
      utils.remove([state, counter, hold, ...lifts, ...picks, ...dims, ...sweeps, ...tags]);
      removeRoot(root);
    },
  };
}
