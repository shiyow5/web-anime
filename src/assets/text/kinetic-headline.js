import { createTimeline, splitText, stagger, utils } from 'animejs';
import { createRoot, injectStyle, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams, splitList } from '../../lib/params.js';

export const meta = {
  id: 'kinetic-headline',
  title: '動く見出し',
  category: 'text',
  libs: ['animejs'],
  description:
    '見出しを 1 文字ずつに分けて、登場と退場を付けます。せり上がる、めくれる、ぼかしから現れる、弾む、の 4 種類から選べます。複数の文を「/」で区切ると順番に入れ替わります。',
  params: {
    text: { type: 'text', label: '文（/ で区切る）', default: 'Make it move / 動きで伝える / Hello, motion', maxLength: 160 },
    preset: {
      type: 'select',
      label: '動き方',
      options: [
        { value: 'rise', label: 'せり上がる' },
        { value: 'flip', label: 'めくれる' },
        { value: 'blur', label: 'ぼかしから現れる' },
        { value: 'bounce', label: '弾む' },
      ],
      default: 'rise',
    },
    hold: { type: 'range', label: '止まる時間（秒）', min: 0.5, max: 6, step: 0.5, default: 1.5 },
    color: { type: 'color', label: '文字色', default: '#fdf6e3' },
    background: { type: 'color', label: '背景色', default: '#2f27ce' },
  },
};

const CSS = `
.ua-kh{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;container-type:size;
  background:var(--ua-bg);color:var(--ua-fg);font-family:var(--ua-display,system-ui,sans-serif)}
.ua-kh__line{margin:0;padding:0 5cqw;font-size:clamp(20px,10.5cqw,150px);font-weight:800;line-height:1.15;
  letter-spacing:-0.03em;text-align:center;perspective:900px}
`;

const PRESETS = {
  rise: {
    split: { chars: { wrap: 'clip' } },
    enter: { y: ['110%', '0%'], duration: 900, ease: 'outExpo', delay: stagger(35) },
    leave: { y: '-110%', duration: 600, ease: 'inExpo', delay: stagger(18) },
  },
  flip: {
    split: { chars: true },
    enter: { rotateX: [-90, 0], opacity: [0, 1], duration: 1000, ease: 'outBack(1.6)', delay: stagger(45, { from: 'center' }) },
    leave: { rotateX: 90, opacity: 0, duration: 450, ease: 'inQuad', delay: stagger(22, { from: 'center' }) },
  },
  blur: {
    split: { chars: true },
    enter: {
      opacity: [0, 1],
      filter: ['blur(14px)', 'blur(0px)'],
      scale: [1.5, 1],
      duration: 1100,
      ease: 'outQuart',
      delay: stagger(55, { from: 'random' }),
    },
    leave: { opacity: 0, filter: 'blur(14px)', duration: 550, ease: 'inQuad', delay: stagger(25, { from: 'random' }) },
  },
  bounce: {
    split: { chars: true },
    enter: {
      y: [-90, 0],
      rotate: { from: () => utils.random(-40, 40), to: 0 },
      opacity: [0, 1],
      duration: 1200,
      ease: 'outElastic(1, .5)',
      delay: stagger(50),
    },
    leave: { y: 90, opacity: 0, duration: 420, ease: 'inBack(2)', delay: stagger(22) },
  },
};

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-kh', { '--ua-bg': p.background, '--ua-fg': p.color });
  const line = document.createElement('p');
  line.className = 'ua-kh__line';
  root.appendChild(line);

  const parsed = splitList(p.text, { separator: '/', maxItems: 8, maxLength: 40 });
  const phrases = parsed.length ? parsed : ['Make it move'];
  const preset = PRESETS[p.preset];
  let timeline = null;
  let split = null;
  let destroyed = false;

  function show(index) {
    line.textContent = phrases[index];
    if (prefersReducedMotion()) return;
    split = splitText(line, preset.split);
    timeline = createTimeline({
      onComplete() {
        split?.revert();
        if (!destroyed) show((index + 1) % phrases.length);
      },
    })
      .add(split.chars, preset.enter)
      .add(split.chars, preset.leave, `+=${p.hold * 1000}`);
  }
  show(0);

  return {
    destroy() {
      destroyed = true;
      timeline?.pause();
      split?.revert();
      removeRoot(root);
    },
  };
}
