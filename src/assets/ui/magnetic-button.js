import { animate, createAnimatable, spring } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'magnetic-button',
  title: '吸いつくボタン',
  category: 'ui',
  libs: ['animejs'],
  description:
    'ポインターが近づくと、ボタンが磁石のように寄ってきます。乗った位置から色が広がり、離れるとばねの動きで元に戻ります。申し込みや問い合わせなど、押してほしいボタンに使います。',
  params: {
    strength: { type: 'range', label: '引き寄せる強さ', min: 0, max: 1, step: 0.05, default: 0.4 },
    accent: { type: 'color', label: 'ボタンの色', default: '#ff4f2e' },
    ink: { type: 'color', label: '文字と枠の色', default: '#191a23' },
    background: { type: 'color', label: '背景色', default: '#f3f1ea' },
  },
};

const CSS = `
.ua-mb{position:absolute;inset:0;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:1%;
  overflow:hidden;container-type:size;background:var(--ua-bg);font-family:var(--ua-display,system-ui,sans-serif)}
.ua-mb__zone{padding:1.6em;font-size:clamp(13px,2.6cqw,20px)}
.ua-mb__btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:.6em;overflow:hidden;
  padding:1.1em 2.2em;border:2px solid var(--ua-ink);border-radius:999px;background:transparent;color:var(--ua-ink);
  font:inherit;font-weight:700;cursor:pointer;will-change:transform}
.ua-mb__btn:focus-visible{outline:3px solid var(--ua-accent);outline-offset:4px}
.ua-mb__btn--solid{background:var(--ua-accent);border-color:var(--ua-accent);color:#fff}
.ua-mb__btn--round{padding:0;width:4.4em;height:4.4em}
.ua-mb__fill{position:absolute;border-radius:50%;background:var(--ua-accent);transform:scale(0);pointer-events:none}
.ua-mb__btn--solid .ua-mb__fill{background:var(--ua-ink)}
.ua-mb__label{position:relative;display:inline-flex;align-items:center;gap:.6em;transition:color .25s}
.ua-mb__btn.is-on .ua-mb__label{color:#fff}
.ua-mb__label svg{width:1.3em;height:1.3em}
`;

const arrow = () =>
  s(
    'svg',
    { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    s('path', { d: 'M5 12h14M13 6l6 6-6 6' }),
  );

const BUTTONS = [
  { variant: 'solid', label: '無料ではじめる' },
  { variant: 'outline', label: '資料を見る', icon: true },
  { variant: 'round', ariaLabel: '次へ進む', icon: true },
];

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-mb', { '--ua-bg': p.background, '--ua-accent': p.accent, '--ua-ink': p.ink });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const back = spring({ stiffness: 220, damping: 9 });

  const buttons = BUTTONS.map(({ variant, label, ariaLabel, icon }) => {
    const fill = h('span', { class: 'ua-mb__fill' });
    const labelEl = h('span', { class: 'ua-mb__label' }, label, icon && arrow());
    const btn = h('button', { class: `ua-mb__btn ua-mb__btn--${variant}`, type: 'button', 'aria-label': ariaLabel }, fill, labelEl);
    const zone = h('div', { class: 'ua-mb__zone' }, btn);
    root.appendChild(zone);
    if (reduced) return btn;

    const moveBtn = createAnimatable(btn, { x: 350, y: 350, ease: 'out(3)' });
    const moveLabel = createAnimatable(labelEl, { x: 500, y: 500, ease: 'out(3)' });
    disposer.add(() => {
      moveBtn.revert();
      moveLabel.revert();
    });

    disposer.listen(zone, 'pointerenter', (event) => {
      const { px, py, rect } = localPointer(event, btn);
      const size = Math.hypot(rect.width, rect.height) * 2.2;
      Object.assign(fill.style, { width: `${size}px`, height: `${size}px`, left: `${px - size / 2}px`, top: `${py - size / 2}px` });
      btn.classList.add('is-on');
      animate(fill, { scale: [0, 1], duration: 550, ease: 'outQuart' });
    });
    disposer.listen(zone, 'pointermove', (event) => {
      const { px, py, rect } = localPointer(event, zone);
      const dx = px - rect.width / 2;
      const dy = py - rect.height / 2;
      moveBtn.x(dx * p.strength);
      moveBtn.y(dy * p.strength);
      moveLabel.x(dx * p.strength * 0.35);
      moveLabel.y(dy * p.strength * 0.35);
    });
    disposer.listen(zone, 'pointerleave', () => {
      btn.classList.remove('is-on');
      animate(fill, { scale: 0, duration: 400, ease: 'outQuart' });
      animate([btn, labelEl], { x: 0, y: 0, ease: back });
    });
    disposer.listen(btn, 'click', () => {
      animate(btn, {
        scale: [
          { to: 0.9, duration: 90, ease: 'outQuad' },
          { to: 1, duration: 700, ease: 'outElastic(1, .4)' },
        ],
      });
    });
    return btn;
  });

  // 一覧の小さな枠では、触らなくても動きが分かるように順番に揺らす。
  if (p.preview && !reduced) {
    let turn = 0;
    disposer.interval(() => {
      const btn = buttons[turn % buttons.length];
      turn += 1;
      if (root.matches(':hover')) return;
      animate(btn, {
        x: [{ to: 14, duration: 260, ease: 'outQuad' }, { to: 0, ease: back }],
        y: [{ to: -8, duration: 260, ease: 'outQuad' }, { to: 0, ease: back }],
      });
    }, 1500);
  }

  return {
    destroy() {
      disposer.run();
      removeRoot(root);
    },
  };
}
