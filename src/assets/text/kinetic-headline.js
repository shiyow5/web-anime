import { animate, createTimeline, splitText, stagger, utils } from 'animejs';
import { createRoot, injectStyle, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams, splitList } from '../../lib/params.js';

export const meta = {
  id: 'kinetic-headline',
  title: '動く見出し',
  category: 'text',
  libs: ['animejs'],
  description:
    '見出しを 1 文字ずつに分けて、登場と退場を付けます。せり上がる、めくれる、ぼかしから現れる、弾む、の 4 種類から選べます。複数の文を「/」で区切ると順番に入れ替わります。タップすると、文字がその場所へ一瞬引き寄せられてから外へ吹き飛び、次の文がタップした位置の文字から順に組み上がります。',
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
.ua-kh{cursor:pointer;position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;container-type:size;
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

  let current = 0;
  let scattering = false;

  // origin は、登場を始める文字の番号。タップで送ったときは、タップした位置の文字から順に現れる。
  function show(index, origin = -1) {
    current = index;
    line.textContent = phrases[index];
    if (prefersReducedMotion()) return;
    split = splitText(line, preset.split);
    const enter = origin < 0 ? preset.enter : { ...preset.enter, delay: stagger(42, { from: Math.min(origin, split.chars.length - 1) }) };
    timeline = createTimeline({
      onComplete() {
        split?.revert();
        if (!destroyed) show((index + 1) % phrases.length);
      },
    })
      .add(split.chars, enter)
      .add(split.chars, preset.leave, `+=${p.hold * 1000}`);
  }
  show(0);

  // 準備: 文字がタップした場所へ少し引き寄せられて縮む。山場: 近い文字から順に、回りながら外へ吹き飛ぶ。
  // 余韻: 次の文が、タップした位置の文字から外側へ順に組み上がる。
  function scatter(event) {
    if (destroyed || scattering) return;
    const next = (current + 1) % phrases.length;
    if (prefersReducedMotion() || !split) {
      show(next);
      return;
    }
    scattering = true;
    timeline?.pause();
    const chars = split.chars;
    utils.remove(chars);
    const rect = line.getBoundingClientRect();
    const hasPoint = typeof event?.clientX === 'number' && rect.width > 0;
    const px = hasPoint ? event.clientX : rect.left + rect.width / 2;
    const py = hasPoint ? event.clientY : rect.top + rect.height / 2;
    const reach = Math.max(120, rect.width * 0.6);
    let nearest = 0;
    let best = Infinity;
    const plans = chars.map((char, index) => {
      // せり上がる動きでは文字が枠で切り取られているので、吹き飛ぶあいだだけ切り取りを外す。
      if (char.parentNode !== line && char.parentNode?.style) char.parentNode.style.overflow = 'visible';
      const box = char.getBoundingClientRect();
      const dx = box.left + box.width / 2 - px;
      const dy = box.top + box.height / 2 - py;
      const distance = Math.hypot(dx, dy) || 1;
      if (distance < best) {
        best = distance;
        nearest = index;
      }
      const power = reach * (0.7 + Math.random() * 0.7);
      return { dx: dx / distance, dy: dy / distance, distance, power };
    });
    const plan = (el) => plans[chars.indexOf(el)];
    // onComplete は、全部の文字が動き終えたときに 1 回だけ呼ばれる。
    const finish = () => {
      if (destroyed) return;
      split?.revert();
      scattering = false;
      const ratio = chars.length > 1 ? nearest / (chars.length - 1) : 0.5;
      show(next, Math.round(ratio * (Array.from(phrases[next]).length - 1)));
    };
    if (chars.length === 0) {
      finish();
      return;
    }
    animate(chars, {
      x: [
        { to: (el) => -plan(el).dx * 10, duration: 150, ease: 'outQuad' },
        { to: (el) => plan(el).dx * plan(el).power, duration: 620, ease: 'outExpo' },
      ],
      y: [
        { to: (el) => -plan(el).dy * 10, duration: 150, ease: 'outQuad' },
        { to: (el) => plan(el).dy * plan(el).power * 0.8 + 40, duration: 620, ease: 'outExpo' },
      ],
      scale: [
        { to: 0.82, duration: 150, ease: 'outQuad' },
        { to: 1.25, duration: 620, ease: 'outQuad' },
      ],
      rotate: [
        { to: 0, duration: 150 },
        { to: () => utils.random(-220, 220), duration: 620, ease: 'outQuad' },
      ],
      opacity: [
        { to: 1, duration: 330 },
        { to: 0, duration: 440, ease: 'inQuad' },
      ],
      delay: (el) => Math.min(260, (plan(el).distance / reach) * 190),
      onComplete: finish,
    });
  }
  root.addEventListener('pointerdown', scatter);

  return {
    scatter,
    destroy() {
      destroyed = true;
      root.removeEventListener('pointerdown', scatter);
      if (split) utils.remove(split.chars);
      timeline?.pause();
      split?.revert();
      removeRoot(root);
    },
  };
}
