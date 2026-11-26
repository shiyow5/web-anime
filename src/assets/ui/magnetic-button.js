import { animate, createAnimatable, spring } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'magnetic-button',
  title: '吸いつくボタン',
  category: 'ui',
  libs: ['animejs'],
  description:
    'ポインターが近づくと、ボタンが磁石のように寄ってきます。乗った位置から色が広がり、離れるとばねの動きで元に戻ります。押すと、まわりに散った砂鉄がボタンへ吸い寄せられ、届いた勢いでボタンがふくらんで輪を放ち、矢印が右へ抜けて左から戻ります。申し込みや問い合わせなど、押してほしいボタンに使います。',
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
.ua-mb__zone{position:relative;padding:1.6em;font-size:clamp(13px,2.6cqw,20px)}
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
.ua-mb__filing{position:absolute;width:9px;height:2px;margin:-1px -4.5px;border-radius:1px;background:var(--ua-ink);opacity:0;pointer-events:none}
.ua-mb__ring{position:absolute;box-sizing:border-box;border:2px solid var(--ua-accent);border-radius:999px;opacity:0;pointer-events:none}
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

  const entries = [];
  const FILINGS = 14;
  // 押すと、まわりに散った砂鉄がボタンへ吸い寄せられ、ボタンがふくらんで輪を放つ。矢印は右へ抜けて左から戻る。
  function attract(zone, btn, labelEl, px, py) {
    const zoneRect = zone.getBoundingClientRect();
    const rect = btn.getBoundingClientRect();
    const cx = rect.left - zoneRect.left + px;
    const cy = rect.top - zoneRect.top + py;
    const far = Math.max(rect.width, rect.height) * 0.5 + 34;
    const turn = Math.random() * Math.PI * 2;
    const filings = Array.from({ length: FILINGS }, (_, i) => {
      const angle = turn + (i / FILINGS) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const reach = far + Math.random() * 46;
      const el = h('i', { class: 'ua-mb__filing', style: { left: `${cx}px`, top: `${cy}px` } });
      return { el, x: Math.cos(angle) * reach, y: Math.sin(angle) * reach * 0.7, deg: (angle * 180) / Math.PI };
    });
    const ring = h('i', { class: 'ua-mb__ring', style: { left: `${rect.left - zoneRect.left}px`, top: `${rect.top - zoneRect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` } });
    zone.append(ring, ...filings.map((filing) => filing.el));
    // 準備。砂鉄が磁力線の向きで現れ、ボタンは押し込まれる。
    animate(filings.map((filing) => filing.el), {
      x: [{ from: (_, i) => filings[i].x, to: (_, i) => filings[i].x * 1.08, duration: 150 }, { to: 0, duration: 330, ease: 'inQuart' }],
      y: [{ from: (_, i) => filings[i].y, to: (_, i) => filings[i].y * 1.08, duration: 150 }, { to: 0, duration: 330, ease: 'inQuart' }],
      rotate: { from: (_, i) => filings[i].deg, to: (_, i) => filings[i].deg, duration: 10 },
      scaleX: [{ from: 0.2, to: 1, duration: 150, ease: 'outQuad' }, { to: 2.4, duration: 250, ease: 'inQuad' }, { to: 0.3, duration: 80 }],
      opacity: [{ from: 0, to: 1, duration: 120 }, { to: 1, duration: 280 }, { to: 0, duration: 80 }],
      delay: (_, i) => i * 16,
      onComplete: () => filings.forEach((filing) => filing.el.remove()),
    });
    // 山場。砂鉄が届くとボタンがふくらみ、輪が外へ広がる。
    animate(btn, {
      scale: [
        { to: 0.88, duration: 130, ease: 'outQuad' },
        { to: 0.88, duration: 330 },
        { to: 1.12, duration: 140, ease: 'outQuart' },
        { to: 1, duration: 800, ease: 'outElastic(1, .38)' },
      ],
    });
    animate(ring, {
      scale: [1, 1.7],
      opacity: [{ to: 0.9, duration: 40 }, { to: 0, duration: 620, ease: 'outQuad' }],
      duration: 660,
      delay: 470,
      ease: 'outQuart',
      onComplete: () => ring.remove(),
    });
    // 余韻。矢印が右へ抜けて、左から戻ってくる。矢印の無いボタンは、文字が小さくうなずく。
    const icon = labelEl.querySelector('svg');
    if (icon) {
      animate(icon, {
        translateX: [{ to: '2.4em', duration: 240, ease: 'inQuad' }, { from: '-2.4em', to: '0em', duration: 520, ease: 'outBack(2.2)' }],
        opacity: [{ to: 0, duration: 240 }, { from: 0, to: 1, duration: 300 }],
        delay: 480,
      });
    } else {
      animate(labelEl, { scale: [{ to: 0.92, duration: 130 }, { to: 0.92, duration: 330 }, { to: 1.08, duration: 140 }, { to: 1, duration: 600, ease: 'outElastic(1, .45)' }] });
    }
  }

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
    disposer.listen(btn, 'click', (event) => {
      // キーボードで押したときは位置が取れないので、ボタンの中央を使う。
      const at = localPointer(event, btn);
      const keyboard = event.detail === 0;
      attract(zone, btn, labelEl, keyboard ? at.rect.width / 2 : at.px, keyboard ? at.rect.height / 2 : at.py);
    });
    entries.push({ zone, btn, labelEl });
    return btn;
  });

  // 一覧の小さな枠では、触らなくても動きが分かるように順番に揺らす。
  if (p.preview && !reduced) {
    let turn = 0;
    disposer.interval(() => {
      const btn = buttons[turn % buttons.length];
      turn += 1;
      if (root.matches(':hover')) return;
      const entry = entries[(turn - 1) % entries.length];
      const rect = entry.btn.getBoundingClientRect();
      animate(btn, {
        x: [{ to: 14, duration: 260, ease: 'outQuad' }, { to: 0, ease: back }],
        y: [{ to: -8, duration: 260, ease: 'outQuad' }, { to: 0, ease: back }],
      });
      attract(entry.zone, entry.btn, entry.labelEl, rect.width / 2, rect.height / 2);
    }, 1900);
  }

  return {
    destroy() {
      disposer.run();
      removeRoot(root);
    },
  };
}
