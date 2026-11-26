import { animate, createAnimatable, createTimer, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'depth-type',
  title: '厚みのある文字',
  category: 'text',
  libs: ['animejs'],
  description:
    '文字を何枚も奥へ重ねて、押し出したような厚みを付けた見出しです。ポインターを動かすと全体が傾き、厚みの側面が見えます。読み込み時に 1 文字ずつ回って現れ、クリックすると、厚みがいったん薄くつぶれ、触った文字から順に 1 文字ずつ別々の軸で回転しながら重なりが奥へ伸び、弾んでそろいます。CSS の立体変形だけで作っています。',
  params: {
    text: { type: 'text', label: '文字', default: 'DEPTH', maxLength: 14 },
    layers: { type: 'range', label: '重ねる枚数', min: 4, max: 24, step: 1, default: 14 },
    depth: { type: 'range', label: '厚み', min: 0.05, max: 0.8, step: 0.01, default: 0.3 },
    front: { type: 'color', label: '手前の色', default: '#fff3d6' },
    back: { type: 'color', label: '奥の色', default: '#ff3d5a' },
    background: { type: 'color', label: '背景色', default: '#1b1030' },
  },
};

const CSS = `
.ua-dt{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;container-type:size;background:var(--ua-bg);cursor:pointer}
.ua-dt__scene{perspective:1400px}
.ua-dt__word{display:flex;margin:0;transform-style:preserve-3d;font-family:var(--ua-display,system-ui,sans-serif);
  font-size:min(var(--ua-size),38cqh);font-weight:800;line-height:1;letter-spacing:-0.01em}
.ua-dt__char{position:relative;transform-style:preserve-3d}
.ua-dt__sizer{visibility:hidden}
.ua-dt__layer{position:absolute;inset:0;backface-visibility:hidden}
`;

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// 2 色の間を t（0〜1）で混ぜた色を返す。
export function mixColor(from, to, t) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(', ')})`;
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const chars = Array.from(p.text.trim() || 'DEPTH').slice(0, 14);
  const count = Math.round(p.preview ? Math.min(p.layers, 10) : p.layers);
  const root = createRoot(container, 'ua-dt', { '--ua-bg': p.background, '--ua-size': `${Math.min(26, 92 / Math.max(2, chars.length))}cqw` });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();

  const layerEls = [];
  const charEls = chars.map((char) => {
    const text = char === ' ' ? ' ' : char;
    const layers = Array.from({ length: count }, (_, i) => {
      const el = h('span', { class: 'ua-dt__layer', 'aria-hidden': 'true', text, style: { color: mixColor(p.front, p.back, count > 1 ? Math.pow(i / (count - 1), 0.7) : 0) } });
      el.dataset.index = String(i);
      layerEls.push(el);
      return el;
    });
    // 奥の層を先に置き、手前の層が上に描かれるようにする。
    return h('span', { class: 'ua-dt__char' }, h('span', { class: 'ua-dt__sizer', text }), layers.reverse());
  });
  const word = h('p', { class: 'ua-dt__word', 'aria-label': p.text }, charEls);
  root.appendChild(h('div', { class: 'ua-dt__scene' }, word));

  let step = 4;
  const depthOf = (el, factor = 1) => -Number(el.dataset.index) * step * factor;
  function measure() {
    const fontSize = parseFloat(getComputedStyle(word).fontSize) || 100;
    step = (fontSize * p.depth) / count;
    utils.set(layerEls, { translateZ: (el) => depthOf(el) });
  }
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(root);
  disposer.add(() => observer.disconnect());

  if (reduced) {
    utils.set(word, { rotateX: 14, rotateY: -24 });
    return {
      destroy() {
        disposer.run();
        removeRoot(root);
      },
    };
  }

  const view = createAnimatable(word, { rotateX: 600, rotateY: 600, ease: 'out(3)' });
  disposer.add(() => view.revert());
  let hovering = false;
  const started = performance.now();
  const idle = createTimer({
    onUpdate() {
      if (hovering) return;
      const t = (performance.now() - started) / 1000;
      view.rotateX(12 + Math.sin(t * 0.7) * 8);
      view.rotateY(Math.sin(t * 0.45) * 32);
    },
  });
  disposer.add(() => idle.pause());
  disposer.listen(root, 'pointerenter', () => {
    hovering = true;
  });
  disposer.listen(root, 'pointerleave', () => {
    hovering = false;
  });
  disposer.listen(root, 'pointermove', (event) => {
    const { x, y } = localPointer(event, root);
    view.rotateY((x - 0.5) * 80);
    view.rotateX((0.5 - y) * 50);
  });

  // 登場。1 文字ずつ、横向きから正面へ回って現れる。
  animate(charEls, { rotateY: [-100, 0], opacity: [0, 1], duration: 1300, ease: 'outBack(1.4)', delay: stagger(90) });

  // 準備: 厚みが薄くつぶれて文字が沈む。山場: 触った文字から順に、1 文字ずつ別の軸で回り、重なりが奥へ伸びる。
  // 余韻: 回り終えた文字から、厚みが弾みながら元にそろう。
  const AXES = ['rotateX', 'rotateY', 'rotateZ'];
  let turns = 0;
  function unravel(event) {
    const hitChar = event?.target?.closest?.('.ua-dt__char');
    const origin = hitChar ? charEls.indexOf(hitChar) : Math.floor(Math.random() * charEls.length);
    const from = Math.max(0, origin);
    turns += 1;
    const em = (step * count) / p.depth; // 文字の大きさ（px）
    utils.remove(charEls);
    utils.remove(layerEls);
    utils.set(charEls, { rotateX: 0, rotateY: 0, rotateZ: 0, translateY: 0, opacity: 1 });
    charEls.forEach((el, index) => {
      const wait = Math.abs(index - from) * 95;
      const axis = AXES[(index + turns) % AXES.length];
      const way = (index + turns) % 2 ? 1 : -1;
      animate(el, {
        translateY: [
          { to: em * 0.07, duration: 200, ease: 'outQuad' },
          { to: -em * 0.16, duration: 380, ease: 'outCubic' },
          { to: 0, duration: 900, ease: 'outBounce' },
        ],
        [axis]: [
          { to: -18 * way, duration: 200, ease: 'outQuad' },
          { to: 360 * way, duration: 1150, ease: 'inOutBack(1.6)' },
        ],
        delay: wait,
        onComplete: () => utils.set(el, { [axis]: 0 }),
      });
      const layers = layerEls.filter((layer) => layer.parentNode === el);
      animate(layers, {
        translateZ: [
          { to: (layer) => depthOf(layer, 0.15), duration: 200, ease: 'outQuad' },
          { to: (layer) => depthOf(layer, 3.2), duration: 520, ease: 'outExpo' },
          { to: (layer) => depthOf(layer), duration: 1200, ease: 'outElastic(1, .45)' },
        ],
        delay: (layer) => wait + Number(layer.dataset.index) * 12,
      });
    });
  }
  disposer.listen(root, 'click', unravel);
  if (p.preview) disposer.interval(unravel, 4200);

  return {
    unravel,
    destroy() {
      disposer.run();
      removeRoot(root);
    },
  };
}
