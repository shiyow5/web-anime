import { createTimeline, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'glitch-text',
  title: '乱れる文字',
  category: 'scifi',
  libs: ['animejs'],
  description:
    '見出しが、電波の乱れた映像のように一瞬ずれて、色が分かれます。乱れは決まった間隔で起き、ポインターを乗せたときにも起きます。クリックすると信号が途切れ、全部の文字が記号に化けて激しく乱れたあと、触った文字から外へ向かって 1 文字ずつ読み取り直されます。ゲームや音楽、SF 系のサイトの見出しに合います。',
  params: {
    text: { type: 'text', label: '文字', default: 'SYSTEM ERROR', maxLength: 40 },
    intensity: { type: 'range', label: 'ずれの大きさ', min: 0.2, max: 3, step: 0.1, default: 1 },
    interval: { type: 'range', label: '乱れる間隔（秒）', min: 0.5, max: 8, step: 0.5, default: 2.5 },
    color: { type: 'color', label: '文字色', default: '#f4f6ff' },
    colorA: { type: 'color', label: 'ずれの色 A', default: '#00f0ff' },
    colorB: { type: 'color', label: 'ずれの色 B', default: '#ff2a6d' },
    background: { type: 'color', label: '背景色', default: '#0a0a14' },
  },
};

const CSS = `
.ua-gt{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;container-type:size;background:var(--ua-bg);
  font-family:var(--ua-display,system-ui,sans-serif)}
.ua-gt::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:repeating-linear-gradient(0deg,rgba(255,255,255,.045) 0 1px,transparent 1px 3px)}
.ua-gt__stack{position:relative;padding:0 5cqw;font-size:clamp(20px,11cqw,150px);font-weight:800;letter-spacing:-0.02em;
  line-height:1.1;text-align:center;white-space:nowrap}
.ua-gt__layer{margin:0;color:var(--ua-fg)}
.ua-gt__ghost{position:absolute;inset:0;margin:0;padding:inherit;opacity:0;mix-blend-mode:screen;pointer-events:none}
.ua-gt__ghost--a{color:var(--ua-a)}
.ua-gt__ghost--b{color:var(--ua-b)}
`;

const STEPS = 7;
const STEP_MS = 65;

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-gt', { '--ua-bg': p.background, '--ua-fg': p.color, '--ua-a': p.colorA, '--ua-b': p.colorB });
  const disposer = createDisposer();
  const base = h('p', { class: 'ua-gt__layer', text: p.text });
  const ghostA = h('p', { class: 'ua-gt__ghost ua-gt__ghost--a', 'aria-hidden': 'true', text: p.text });
  const ghostB = h('p', { class: 'ua-gt__ghost ua-gt__ghost--b', 'aria-hidden': 'true', text: p.text });
  const stack = h('div', { class: 'ua-gt__stack' }, base, ghostA, ghostB);
  root.appendChild(stack);
  if (prefersReducedMotion()) return { destroy: () => removeRoot(root) };

  let timeline = null;
  const slice = () => {
    const top = utils.random(0, 80);
    return `inset(${top}% 0 ${Math.max(0, 100 - top - utils.random(8, 40))}% 0)`;
  };
  // 1 コマぶんの乱れ。色の層を横にずらし、細い帯だけが見えるように切り抜く。
  function jolt() {
    const shift = 14 * p.intensity;
    for (const [ghost, direction] of [[ghostA, -1], [ghostB, 1]]) {
      utils.set(ghost, { opacity: 0.9, x: direction * utils.random(2, shift), clipPath: slice() });
    }
    utils.set(base, { x: utils.random(-shift * 0.3, shift * 0.3), skewX: utils.random(-6, 6) * p.intensity, clipPath: Math.random() < 0.35 ? slice() : 'inset(0% 0 0% 0)' });
  }
  function settle() {
    utils.set([ghostA, ghostB], { opacity: 0, x: 0, clipPath: 'inset(0% 0 0% 0)' });
    utils.set(base, { x: 0, skewX: 0, clipPath: 'inset(0% 0 0% 0)' });
  }
  function burst() {
    timeline?.pause();
    timeline = createTimeline();
    for (let i = 0; i < STEPS; i += 1) timeline.call(jolt, i * STEP_MS);
    timeline.call(settle, STEPS * STEP_MS);
  }

  // クリック。全部の文字を記号に化けさせて強く乱し、触った文字から外へ順に元の文字へ戻す。
  const GLYPHS = '#%&/<>[]{}=+*?01';
  const layersAll = [base, ghostA, ghostB];
  const chars = [...p.text];
  let decoding = null;
  const writeText = (solved) => {
    const text = chars.map((char, i) => (solved(i) || char === ' ' ? char : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join('');
    for (const layer of layersAll) layer.textContent = text;
  };
  function scramble(event) {
    const rect = base.getBoundingClientRect();
    const ratio = event && rect.width ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0.5;
    const origin = ratio * (chars.length - 1);
    const reach = Math.max(origin, chars.length - 1 - origin) + 1;
    decoding?.pause();
    timeline?.pause();
    const HOLD = 6;
    const total = HOLD + Math.ceil(reach) + 1;
    decoding = createTimeline();
    for (let step = 0; step <= total; step += 1) {
      decoding.call(() => {
        writeText((i) => Math.abs(i - origin) < step - HOLD);
        // はじめは全体を強く乱し、読み取りが進むにつれて弱める。
        if (step < total - 1 && (step < HOLD || step % 2 === 0)) jolt();
        else settle();
      }, step * 55);
    }
    decoding.call(() => {
      for (const layer of layersAll) layer.textContent = p.text;
      settle();
    }, (total + 1) * 55);
  }
  disposer.add(() => decoding?.pause());

  disposer.listen(root, 'pointerenter', burst);
  disposer.listen(root, 'click', scramble);
  if (options.preview) disposer.interval(() => scramble(), 5200);
  disposer.interval(burst, p.interval * 1000);
  disposer.timeout(burst, 400);
  disposer.add(() => timeline?.pause());

  return {
    burst,
    scramble: () => scramble(),
    destroy() {
      disposer.run();
      removeRoot(root);
    },
  };
}
