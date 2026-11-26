import { animate, createTimeline, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'flip-clock',
  title: 'めくれる時計',
  category: 'clock',
  libs: ['animejs'],
  description:
    '駅や空港の案内板のように、数字の板がぱたんとめくれて時刻が変わります。上半分が手前に倒れ、下半分が弾んで収まります。タップすると、触った板から順に全部の札がばらばらと数字を送り、遠い札ほど長く回ってから今の時刻でぱたんと止まります。時・分・秒を 24 時間制か 12 時間制で表示できます。',
  params: {
    format: {
      type: 'select',
      label: '時刻の表し方',
      options: [
        { value: '24', label: '24 時間制' },
        { value: '12', label: '12 時間制' },
      ],
      default: '24',
    },
    seconds: { type: 'boolean', label: '秒を表示する', default: true },
    card: { type: 'color', label: '板の色', default: '#1d1f2b' },
    digit: { type: 'color', label: '数字の色', default: '#f7f3e8' },
    background: { type: 'color', label: '背景色', default: '#d9412b' },
  },
};

const CSS = `
.ua-fc{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;container-type:size;
  background:var(--ua-bg);color:var(--ua-digit);font-family:var(--ua-display,system-ui,sans-serif)}
.ua-fc__row{display:flex;align-items:center;justify-content:center;gap:.14em;font-size:min(var(--ua-w),56cqh);font-variant-numeric:tabular-nums}
.ua-fc__pair{display:flex;gap:.06em}
.ua-fc__colon{display:grid;gap:.22em;padding:0 .04em}
.ua-fc__colon i{width:.1em;height:.1em;border-radius:50%;background:var(--ua-card)}
.ua-fc__card{position:relative;width:.64em;height:1em;perspective:4em}
.ua-fc__half{position:absolute;left:0;right:0;height:50%;overflow:hidden;background:var(--ua-card);backface-visibility:hidden}
.ua-fc__half--top{top:0;border-radius:.07em .07em 0 0;box-shadow:inset 0 -.012em 0 rgba(0,0,0,.45);transform-origin:50% 100%}
.ua-fc__half--bottom{bottom:0;border-radius:0 0 .07em .07em;transform-origin:50% 0%}
.ua-fc__half span{position:absolute;left:0;right:0;height:200%;display:grid;place-items:center;font-size:.8em;font-weight:800;line-height:1}
.ua-fc__half--top span{top:0}
.ua-fc__half--bottom span{bottom:0}
.ua-fc__flap{z-index:2;opacity:0}
`;

const pad = (n) => String(n).padStart(2, '0');

// 時・分・秒を 2 桁ずつの文字列にして返す。12 時間制では 0 時を 12 時と表す。
export function timeParts(date, hour12 = false) {
  const hours = hour12 ? date.getHours() % 12 || 12 : date.getHours();
  return [pad(hours), pad(date.getMinutes()), pad(date.getSeconds())];
}

function buildCard() {
  const face = (extra) => {
    const span = h('span');
    return { el: h('div', { class: `ua-fc__half ${extra}` }, span), span };
  };
  const top = face('ua-fc__half--top');
  const bottom = face('ua-fc__half--bottom');
  const flapTop = face('ua-fc__half--top ua-fc__flap');
  const flapBottom = face('ua-fc__half--bottom ua-fc__flap');
  const el = h('div', { class: 'ua-fc__card' }, top.el, bottom.el, flapTop.el, flapBottom.el);
  return { el, top, bottom, flapTop, flapBottom, value: null, timeline: null, wait: 0, left: 0 };
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const groups = p.seconds ? 3 : 2;
  const root = createRoot(container, 'ua-fc', { '--ua-bg': p.background, '--ua-card': p.card, '--ua-digit': p.digit, '--ua-w': groups === 3 ? '17cqw' : '26cqw' });
  const row = h('div', { class: 'ua-fc__row' });
  root.appendChild(row);
  root.setAttribute('role', 'timer');
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();

  const cards = [];
  const colons = [];
  for (let g = 0; g < groups; g += 1) {
    if (g > 0) {
      const colon = h('div', { class: 'ua-fc__colon', 'aria-hidden': 'true' }, h('i'), h('i'));
      colons.push(colon);
      row.appendChild(colon);
    }
    const pair = [buildCard(), buildCard()];
    cards.push(...pair);
    row.appendChild(h('div', { class: 'ua-fc__pair' }, pair.map((card) => card.el)));
  }

  function show(card, next) {
    card.value = next;
    card.top.span.textContent = next;
    card.bottom.span.textContent = next;
  }
  // めくる。古い数字の上半分を手前へ倒し、続けて新しい数字の下半分を下ろす。
  function flip(card, next, fast = false) {
    const previous = card.value;
    if (previous === next) return;
    if (previous === null || reduced) {
      show(card, next);
      return;
    }
    card.timeline?.complete();
    card.value = next;
    card.top.span.textContent = next;
    card.flapTop.span.textContent = previous;
    card.flapBottom.span.textContent = next;
    utils.set(card.flapTop.el, { rotateX: 0, opacity: 1 });
    utils.set(card.flapBottom.el, { rotateX: 90, opacity: 1 });
    card.timeline = createTimeline({
      onComplete() {
        card.bottom.span.textContent = next;
        utils.set([card.flapTop.el, card.flapBottom.el], { opacity: 0 });
      },
    })
      .add(card.flapTop.el, { rotateX: -90, duration: fast ? 45 : 240, ease: 'inQuad' })
      .add(card.flapBottom.el, { rotateX: 0, duration: fast ? 40 : 460, ease: fast ? 'outQuad' : 'outBounce' });
  }

  function tick() {
    const text = timeParts(new Date(), p.format === '12').slice(0, groups).join('');
    root.setAttribute('aria-label', `${text.slice(0, 2)}時${text.slice(2, 4)}分`);
    cards.forEach((card, index) => {
      if (card.left > 0 || card.wait > 0) return;
      flip(card, text[index]);
    });
  }
  tick();

  // タップ。案内板の表示替えのように、触った札から順に数字を送る。遠い札ほど長く回り、最後に今の時刻で止まる。
  function shuffle(event) {
    if (reduced) return;
    let origin = 0;
    if (event) {
      const distances = cards.map((card) => {
        const rect = card.el.getBoundingClientRect();
        return Math.abs(event.clientX - (rect.left + rect.width / 2));
      });
      origin = distances.indexOf(Math.min(...distances));
    }
    cards.forEach((card, index) => {
      const far = Math.abs(index - origin);
      card.wait = far;
      card.left = 7 + far * 3;
    });
    const els = cards.map((card) => card.el);
    utils.remove(els);
    animate(els, {
      translateY: [{ to: '.05em', duration: 110, ease: 'outQuad' }, { to: 0, duration: 520, ease: 'outElastic(1, .45)' }],
      delay: (_, index) => Math.abs(index - origin) * 55,
    });
  }
  disposer.interval(() => {
    for (const card of cards) {
      if (card.wait > 0) card.wait -= 1;
      else if (card.left > 0) {
        card.left -= 1;
        if (card.left > 0) flip(card, String((Number(card.value) + 1 + Math.floor(Math.random() * 3)) % 10), true);
      }
    }
  }, 95);
  disposer.listen(root, 'pointerdown', shuffle);
  if (options.preview) disposer.interval(() => shuffle(), 5200);

  disposer.interval(tick, 200);
  disposer.add(() => cards.forEach((card) => card.timeline?.pause()));
  if (!reduced) animate(colons, { opacity: [1, 0.25], duration: 500, ease: 'inOutSine', alternate: true, loop: true });

  return {
    destroy() {
      disposer.run();
      removeRoot(root);
    },
  };
}
