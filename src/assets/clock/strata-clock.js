import { animate, createAnimatable, createTimer, spring, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'strata-clock',
  title: '地層のように重なる時計',
  category: 'clock',
  libs: ['animejs'],
  description:
    '文字盤を 6 枚の透明な板に分け、CSS の立体変形で斜めに重ねた時計です。土台、分の目盛り、時の弧、秒の輪、針、数字の表示が、それぞれ別の高さに浮かびます。ポインターを乗せると板の間隔が開き、動かすと見る角度が変わります。WebGL を使いません。',
  params: {
    line: { type: 'color', label: '線の色', default: '#7df9ff' },
    accent: { type: 'color', label: '強調の色', default: '#ff2e88' },
    hand: { type: 'color', label: '針の色', default: '#ffd166' },
    background: { type: 'color', label: '背景色', default: '#07090f' },
    gap: { type: 'range', label: '板の間隔', min: 0.01, max: 0.12, step: 0.005, default: 0.035 },
    tilt: { type: 'range', label: '傾き（度）', min: 0, max: 70, step: 1, default: 52 },
  },
};

const CSS = `
.ua-sc{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;container-type:size;background:var(--ua-bg)}
.ua-sc__scene{width:min(80cqw,92cqh);aspect-ratio:1;perspective:2400px}
.ua-sc__stack{position:relative;width:100%;height:100%;transform-style:preserve-3d}
.ua-sc__layer{position:absolute;inset:0;width:100%;height:100%;overflow:visible;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
.ua-sc__plate{fill:color-mix(in srgb,var(--ua-bg) 82%,var(--ua-line));fill-opacity:.9;stroke:var(--ua-line);stroke-width:1.2}
.ua-sc__thin{fill:none;stroke:var(--ua-line);stroke-width:.8;opacity:.5}
.ua-sc__tick{stroke:var(--ua-line);stroke-linecap:round}
.ua-sc__num{fill:var(--ua-line);font-size:10px;text-anchor:middle;dominant-baseline:central;opacity:.8}
.ua-sc__hour{fill:none;stroke:var(--ua-line);stroke-width:11;opacity:.18}
.ua-sc__hour.is-lit{stroke:var(--ua-accent);opacity:.95}
.ua-sc__track{fill:none;stroke:var(--ua-line);stroke-width:1;opacity:.3}
.ua-sc__sweep{fill:none;stroke:var(--ua-accent);stroke-width:4;stroke-linecap:round}
.ua-sc__dot{fill:var(--ua-accent);transform-box:fill-box;transform-origin:center}
.ua-sc__hand{stroke:var(--ua-hand);stroke-linecap:round}
.ua-sc__hub{fill:var(--ua-bg);stroke:var(--ua-hand);stroke-width:2}
.ua-sc__time{fill:var(--ua-line);font-size:30px;font-weight:700;text-anchor:middle;letter-spacing:.06em}
.ua-sc__date{fill:var(--ua-hand);font-size:11px;text-anchor:middle;letter-spacing:.14em}
`;

const C = 200;
const pad = (n) => String(n).padStart(2, '0');
const polar = (radius, turn) => [C + Math.cos(turn * Math.PI * 2 - Math.PI / 2) * radius, C + Math.sin(turn * Math.PI * 2 - Math.PI / 2) * radius];
const arc = (radius, from, to) => {
  const [x1, y1] = polar(radius, from);
  const [x2, y2] = polar(radius, to);
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${radius} ${radius} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
};
const layer = (...children) => s('svg', { class: 'ua-sc__layer', viewBox: '0 0 400 400', 'aria-hidden': 'true' }, ...children);

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-sc', { '--ua-bg': p.background, '--ua-line': p.line, '--ua-accent': p.accent, '--ua-hand': p.hand });
  root.setAttribute('role', 'img');
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();

  // 1 枚目: 土台。
  const plate = layer(
    s('circle', { class: 'ua-sc__plate', cx: C, cy: C, r: 192 }),
    s('circle', { class: 'ua-sc__thin', cx: C, cy: C, r: 184, 'stroke-dasharray': '2 7' }),
    s('line', { class: 'ua-sc__thin', x1: C, y1: 16, x2: C, y2: 384 }),
    s('line', { class: 'ua-sc__thin', x1: 16, y1: C, x2: 384, y2: C }),
  );
  // 2 枚目: 分の目盛りと数字。
  const ticks = layer(
    Array.from({ length: 60 }, (_, i) => {
      const major = i % 5 === 0;
      const [x1, y1] = polar(major ? 164 : 171, i / 60);
      const [x2, y2] = polar(180, i / 60);
      return s('line', { class: 'ua-sc__tick', 'stroke-width': major ? 2.4 : 1, x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1) });
    }),
    Array.from({ length: 12 }, (_, i) => {
      const [x, y] = polar(150, i / 12);
      return s('text', { class: 'ua-sc__num', x: x.toFixed(1), y: y.toFixed(1) }, pad(i * 5));
    }),
  );
  // 3 枚目: 時の弧。過ぎた時間ぶんだけ点灯する。
  const hourArcs = Array.from({ length: 12 }, (_, i) => s('path', { class: 'ua-sc__hour', d: arc(126, (i + 0.06) / 12, (i + 0.94) / 12) }));
  const hours = layer(hourArcs);
  // 4 枚目: 秒の輪。
  const sweepLength = 2 * Math.PI * 102;
  const sweep = s('circle', { class: 'ua-sc__sweep', cx: C, cy: C, r: 102, transform: `rotate(-90 ${C} ${C})`, 'stroke-dasharray': sweepLength.toFixed(1), 'stroke-dashoffset': sweepLength.toFixed(1) });
  const dot = s('circle', { class: 'ua-sc__dot', cx: C, cy: C - 102, r: 6 });
  const dotArm = s('g', {}, dot);
  const secondsLayer = layer(s('circle', { class: 'ua-sc__track', cx: C, cy: C, r: 102 }), sweep, dotArm);
  // 5 枚目: 針。
  const hourHand = s('line', { class: 'ua-sc__hand', x1: C, y1: C + 10, x2: C, y2: C - 58, 'stroke-width': 6 });
  const minuteHand = s('line', { class: 'ua-sc__hand', x1: C, y1: C + 14, x2: C, y2: C - 90, 'stroke-width': 3.5 });
  const hands = layer(hourHand, minuteHand, s('circle', { class: 'ua-sc__hub', cx: C, cy: C, r: 6 }));
  // 6 枚目: 数字の表示と、回る飾りの輪。
  const timeText = s('text', { class: 'ua-sc__time', x: C, y: 276 }, '00:00');
  const dateText = s('text', { class: 'ua-sc__date', x: C, y: 296 }, '');
  const spinner = s('circle', { class: 'ua-sc__thin', cx: C, cy: C, r: 40, 'stroke-dasharray': '14 9' });
  const glass = layer(spinner, timeText, dateText);

  const layers = [plate, ticks, hours, secondsLayer, hands, glass];
  const stack = h('div', { class: 'ua-sc__stack' }, layers);
  const scene = h('div', { class: 'ua-sc__scene' }, stack);
  root.appendChild(scene);

  const state = { gap: p.gap, spin: 0 };
  const drops = layers.map(() => ({ z: reduced ? 0 : 520, o: reduced ? 1 : 0 }));
  let size = 400;
  let lastSecond = -1;

  function render() {
    const now = new Date();
    const second = now.getSeconds() + now.getMilliseconds() / 1000;
    const minute = now.getMinutes() + second / 60;
    const hour = (now.getHours() % 12) + minute / 60;
    sweep.setAttribute('stroke-dashoffset', (sweepLength * (1 - second / 60)).toFixed(1));
    dotArm.setAttribute('transform', `rotate(${(second * 6).toFixed(2)} ${C} ${C})`);
    minuteHand.setAttribute('transform', `rotate(${(minute * 6).toFixed(2)} ${C} ${C})`);
    hourHand.setAttribute('transform', `rotate(${(hour * 30).toFixed(2)} ${C} ${C})`);
    spinner.setAttribute('transform', `rotate(${state.spin.toFixed(1)} ${C} ${C})`);
    if (now.getSeconds() !== lastSecond) {
      lastSecond = now.getSeconds();
      timeText.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      dateText.textContent = `${pad(now.getMonth() + 1)}.${pad(now.getDate())} :${pad(now.getSeconds())}`;
      root.setAttribute('aria-label', `${now.getHours()}時${now.getMinutes()}分`);
      hourArcs.forEach((el, i) => el.classList.toggle('is-lit', i <= now.getHours() % 12));
      if (!reduced) animate(dot, { scale: [2, 1], duration: 600, ease: 'outExpo' });
    }
    // 板を下から順に、間隔ぶんずつ持ち上げる。
    layers.forEach((el, i) => {
      // 重なりの中心が枠の中央に来るように、全体を半分だけ下げる。
      const lift = (i - (layers.length - 1) / 2) * state.gap * size;
      el.style.transform = `translateZ(${(lift + drops[i].z).toFixed(1)}px)`;
      el.style.opacity = String(drops[i].o);
    });
  }

  const measure = () => {
    size = scene.getBoundingClientRect().width || 400;
  };
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(root);
  disposer.add(() => observer.disconnect());

  if (reduced) {
    stack.style.transform = `rotateX(${p.tilt}deg) rotateZ(-18deg)`;
    render();
    disposer.interval(render, 1000);
    return {
      destroy() {
        disposer.run();
        removeRoot(root);
      },
    };
  }

  const view = createAnimatable(stack, { rotateX: 700, rotateZ: 700, ease: 'out(3)' });
  disposer.add(() => view.revert());
  let hovering = false;
  const started = performance.now();
  const loop = createTimer({
    onUpdate() {
      const t = (performance.now() - started) / 1000;
      state.spin = t * 24;
      // 触っていない間は、ゆっくり向きを変えて板の重なりを見せる。
      if (!hovering) {
        view.rotateX(p.tilt + Math.sin(t * 0.4) * 5);
        view.rotateZ(-18 + Math.sin(t * 0.27) * 16);
      }
      render();
    },
  });
  disposer.add(() => loop.pause());

  const widen = spring({ stiffness: 80, damping: 10 });
  disposer.listen(root, 'pointerenter', () => {
    hovering = true;
    animate(state, { gap: p.gap * 1.8, ease: widen });
  });
  disposer.listen(root, 'pointerleave', () => {
    hovering = false;
    animate(state, { gap: p.gap, ease: widen });
  });
  disposer.listen(root, 'pointermove', (event) => {
    const { x, y } = localPointer(event, root);
    view.rotateX(p.tilt + (0.5 - y) * 18);
    view.rotateZ((x - 0.5) * 70);
  });

  // 起動。板が上から 1 枚ずつ降りてきて重なる。
  animate(drops, { z: 0, o: 1, duration: 1300, ease: 'outExpo', delay: stagger(130) });
  if (p.preview) {
    disposer.interval(() => {
      if (hovering) return;
      animate(state, {
        gap: [
          { to: p.gap * 1.8, duration: 900, ease: 'outExpo' },
          { to: p.gap, duration: 1100, ease: 'inOutQuart', delay: 700 },
        ],
      });
    }, 5200);
  }

  return {
    destroy() {
      disposer.run();
      utils.remove([state, ...drops]);
      removeRoot(root);
    },
  };
}
