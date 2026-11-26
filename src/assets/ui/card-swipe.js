import { animate, createDraggable, spring, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'card-swipe',
  title: 'めくるカードの束',
  category: 'ui',
  libs: ['animejs'],
  description:
    '重なったカードを左右に引いて飛ばすと、下のカードがばねの動きでせり上がります。引く量が足りなければ元の位置に戻り、触らないときは自動で 1 枚ずつめくれます。おすすめの紹介や、好みを選んでもらう画面に使います。',
  params: {
    interval: { type: 'range', label: '自動でめくる間隔（秒、0 で止める）', min: 0, max: 8, step: 0.5, default: 3 },
    tilt: { type: 'range', label: '引いたときの傾き', min: 0, max: 30, step: 1, default: 14 },
    accent: { type: 'color', label: '差し色', default: '#e4572e' },
    ink: { type: 'color', label: '文字色', default: '#2a2320' },
    background: { type: 'color', label: '背景色', default: '#efe5d5' },
  },
};

const CSS = `
.ua-cs{position:absolute;inset:0;overflow:hidden;container-type:size;background:var(--ua-bg);color:var(--ua-ink);
  font-family:var(--ua-display,system-ui,sans-serif)}
.ua-cs__in{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:1.5em;padding-top:1.5em;font-size:clamp(7px,min(2.4cqw,3.3cqh),22px)}
.ua-cs__deck{position:relative;width:15em;height:19em}
.ua-cs__slot,.ua-cs__drag,.ua-cs__face{position:absolute;inset:0}
.ua-cs__slot{pointer-events:none;transform-origin:50% 100%}
.ua-cs__slot.is-top{pointer-events:auto}
.ua-cs__drag{cursor:grab;touch-action:none}
.ua-cs__face{display:grid;grid-template-rows:1fr auto;border-radius:1.2em;overflow:hidden;background:#fffaf2;
  box-shadow:0 1.2em 2.2em -1.2em #2a232066,0 0 0 1px #2a232014;user-select:none}
.ua-cs__art{position:relative;overflow:hidden;background:var(--sky)}
.ua-cs__art i{position:absolute;display:block}
.ua-cs__sun{right:18%;top:16%;width:3.4em;height:3.4em;border-radius:50%;background:var(--sun)}
.ua-cs__far{left:-10%;right:-10%;bottom:18%;height:46%;background:var(--far);clip-path:polygon(0 100%,0 55%,18% 20%,34% 52%,52% 8%,70% 48%,86% 26%,100% 60%,100% 100%)}
.ua-cs__near{left:-10%;right:-10%;bottom:0;height:38%;background:var(--near);border-radius:50% 60% 0 0/70% 90% 0 0}
.ua-cs__line{left:0;right:0;bottom:30%;height:1px;background:#ffffff66}
.ua-cs__no{position:absolute;left:1em;top:.9em;font-size:.72em;letter-spacing:.14em;color:#fff;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
.ua-cs__text{padding:1em 1.1em 1.15em}
.ua-cs__text h3{margin:0;font-size:1.25em;font-weight:800;letter-spacing:-.01em}
.ua-cs__text p{margin:.35em 0 .7em;font-size:.8em;line-height:1.55;opacity:.7}
.ua-cs__tags{display:flex;gap:.4em;font-size:.68em;font-weight:700}
.ua-cs__tags span{padding:.3em .7em;border-radius:999px;background:#2a23200f}
.ua-cs__stamp{position:absolute;top:1.1em;padding:.3em .7em;border:.16em solid currentColor;border-radius:.5em;font-size:1em;font-weight:800;
  background:#fffaf2;opacity:0}
.ua-cs__stamp--yes{left:1em;color:var(--ua-accent);transform:rotate(-10deg)}
.ua-cs__stamp--no{right:1em;color:#5b6470;transform:rotate(10deg)}
.ua-cs__bar{display:flex;align-items:center;gap:1em}
.ua-cs__btn{padding:.7em 1.4em;border:.14em solid var(--ua-ink);border-radius:999px;background:none;color:inherit;font:inherit;
  font-size:.9em;font-weight:700;cursor:pointer}
.ua-cs__btn--yes{background:var(--ua-accent);border-color:var(--ua-accent);color:#fff}
.ua-cs__btn:focus-visible{outline:3px solid var(--ua-accent);outline-offset:3px}
.ua-cs__count{min-width:3.2em;text-align:center;font-size:.8em;font-variant-numeric:tabular-nums;opacity:.6}
`;

const CARDS = [
  { title: '尾道', body: '坂と路地の町を歩いて、海を見下ろす喫茶店へ。', tags: ['1 泊', '電車で 2 時間'], sky: '#f6b26b', sun: '#fff1c9', far: '#c8553d', near: '#5a2a27' },
  { title: '上高地', body: '川沿いの平らな道を、朝の空気の中で歩く。', tags: ['日帰り', 'バスで 3 時間'], sky: '#9ad1d4', sun: '#ffffff', far: '#3f7d6b', near: '#1f4037' },
  { title: '直島', body: '島をめぐる自転車と、屋外に置かれた作品。', tags: ['1 泊', '船で 20 分'], sky: '#f2d0a9', sun: '#e4572e', far: '#4b6c8c', near: '#253b56' },
  { title: '弘前', body: '堀を埋める花びらと、古い洋館の並ぶ通り。', tags: ['2 泊', '新幹線で 4 時間'], sky: '#f7c6d0', sun: '#fff6f0', far: '#b8627d', near: '#5c2a45' },
  { title: '阿蘇', body: '草原のまん中を抜ける、見通しのよい道。', tags: ['2 泊', '車で 90 分'], sky: '#c9e4a6', sun: '#fffbe0', far: '#6a994e', near: '#31572c' },
];
const VISIBLE = 3;
// 束の中での深さごとの見た目。0 が一番上で、VISIBLE 以降は隠す。
const depthStyle = (depth) =>
  depth >= VISIBLE ? { y: '-22%', scale: 0.82, opacity: 0 } : { y: `${-depth * 9.5}%`, scale: 1 - depth * 0.06, opacity: 1 };

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-cs', { '--ua-bg': p.background, '--ua-ink': p.ink, '--ua-accent': p.accent });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const rise = spring({ stiffness: 210, damping: 13 });

  const deck = h('div', { class: 'ua-cs__deck' });
  const cards = CARDS.map((card, index) => {
    const yes = h('span', { class: 'ua-cs__stamp ua-cs__stamp--yes', text: '行きたい', 'aria-hidden': 'true' });
    const no = h('span', { class: 'ua-cs__stamp ua-cs__stamp--no', text: 'また今度', 'aria-hidden': 'true' });
    const art = h(
      'div',
      { class: 'ua-cs__art', style: { '--sky': card.sky, '--sun': card.sun, '--far': card.far, '--near': card.near } },
      h('i', { class: 'ua-cs__sun' }),
      h('i', { class: 'ua-cs__far' }),
      h('i', { class: 'ua-cs__line' }),
      h('i', { class: 'ua-cs__near' }),
      h('span', { class: 'ua-cs__no', text: `No. 0${index + 1}` }),
    );
    const text = h('div', { class: 'ua-cs__text' }, h('h3', { text: card.title }), h('p', { text: card.body }), h('div', { class: 'ua-cs__tags' }, card.tags.map((tag) => h('span', { text: tag }))));
    const face = h('article', { class: 'ua-cs__face' }, art, text, yes, no);
    const drag = h('div', { class: 'ua-cs__drag' }, face);
    const slot = h('div', { class: 'ua-cs__slot' }, drag);
    return { slot, drag, face, yes, no, title: card.title, draggable: null };
  });
  // 先頭のカードが一番手前に来るように、後ろのカードから順に入れる。
  deck.append(...[...cards].reverse().map((card) => card.slot));

  const count = h('span', { class: 'ua-cs__count', 'aria-live': 'polite' });
  const noButton = h('button', { class: 'ua-cs__btn', type: 'button', text: 'また今度' });
  const yesButton = h('button', { class: 'ua-cs__btn ua-cs__btn--yes', type: 'button', text: '行きたい' });
  root.appendChild(h('div', { class: 'ua-cs__in' }, deck, h('div', { class: 'ua-cs__bar' }, noButton, count, yesButton)));

  let order = cards.map((_, i) => i);
  let busy = false;
  let destroyed = false;
  let touchedAt = 0;
  let autoTurn = 0;
  let seen = 0;

  function arrange(animated) {
    order.forEach((cardIndex, depth) => {
      const { slot } = cards[cardIndex];
      slot.style.zIndex = String(cards.length - depth);
      slot.classList.toggle('is-top', depth === 0);
      if (animated) animate(slot, { ...depthStyle(depth), ease: rise, delay: depth * 55 });
      else utils.set(slot, depthStyle(depth));
    });
    count.textContent = `${(seen % cards.length) + 1} / ${cards.length}`;
  }

  // 引いた量に合わせて、カードを傾け、左右の印を出す。
  function lean(card, x) {
    const width = deck.offsetWidth || 1;
    const ratio = utils.clamp(x / (width * 0.5), -1, 1);
    utils.set(card.face, { rotate: ratio * p.tilt });
    card.yes.style.opacity = String(utils.clamp(ratio * 1.6, 0, 1));
    card.no.style.opacity = String(utils.clamp(-ratio * 1.6, 0, 1));
  }

  // 一番上のカードを dir（1 で右、-1 で左）へ飛ばし、束の一番下に戻す。
  function fling(dir, fromX = 0) {
    if (busy || destroyed) return;
    busy = true;
    const card = cards[order[0]];
    const width = deck.offsetWidth;
    card.draggable?.stop();
    card.yes.style.opacity = dir > 0 ? '1' : '0';
    card.no.style.opacity = dir < 0 ? '1' : '0';
    const wind = fromX === 0 ? [{ to: -dir * width * 0.08, duration: 170, ease: 'outQuad' }] : [];
    animate(card.face, { rotate: dir * (p.tilt + 10), duration: 520, ease: 'outQuad' });
    animate(card.drag, {
      x: [...wind, { to: dir * width * 1.7, duration: 430, ease: 'inQuad' }],
      y: { to: width * 0.12, duration: 600, ease: 'inQuad' },
      opacity: { to: 0, duration: 330, delay: wind.length ? 270 : 100, ease: 'linear' },
      onComplete() {
        if (destroyed) return;
        // 見えない一番下の位置へ移してから、引いた量と傾きを元に戻す。
        utils.set(card.slot, depthStyle(cards.length - 1));
        card.slot.style.zIndex = '1';
        card.draggable?.reset();
        utils.set(card.drag, { x: 0, y: 0, opacity: 1 });
        utils.set(card.face, { rotate: 0 });
        card.yes.style.opacity = '0';
        card.no.style.opacity = '0';
        busy = false;
      },
    });
    // 飛ばすのと同時に、下のカードをせり上げる。
    order = [...order.slice(1), order[0]];
    seen += 1;
    utils.set(card.slot, { opacity: 1 });
    card.slot.style.zIndex = String(cards.length + 1);
    order.slice(0, -1).forEach((cardIndex, depth) => {
      const { slot } = cards[cardIndex];
      slot.classList.toggle('is-top', depth === 0);
      animate(slot, { ...depthStyle(depth), ease: rise, delay: 110 + depth * 60 });
    });
    card.slot.classList.remove('is-top');
    disposer.timeout(() => {
      if (!destroyed) arrange(false);
    }, 640);
    count.textContent = `${(seen % cards.length) + 1} / ${cards.length}`;
  }

  arrange(false);

  if (!reduced) {
    for (const card of cards) {
      card.draggable = createDraggable(card.drag, {
        container: [0, 0, 0, 0],
        containerFriction: 0.12,
        releaseStiffness: 190,
        releaseDamping: 13,
        onGrab: () => {
          touchedAt = performance.now();
        },
        onUpdate: (self) => lean(card, self.x),
        onRelease: (self) => {
          touchedAt = performance.now();
          const far = Math.abs(self.x) > deck.offsetWidth * 0.3;
          const fast = self.velocity > 1 && Math.abs(self.x) > deck.offsetWidth * 0.1;
          if (far || fast) fling(Math.sign(self.x) || 1, self.x);
        },
      });
      disposer.add(() => card.draggable.revert());
    }
    // 登場。束が下から順に重なる。
    animate(cards.map((card) => card.slot), {
      y: { from: '60%' },
      opacity: { from: 0 },
      rotate: { from: (_, i) => (i % 2 ? 9 : -9), to: 0 },
      duration: 900,
      delay: (_, i) => (cards.length - i) * 70,
      ease: 'outBack(1.4)',
    });
    const every = p.preview ? 2200 : p.interval * 1000;
    if (every > 0) {
      disposer.interval(() => {
        const idle = performance.now() - touchedAt > every;
        if (!idle || (!p.preview && root.matches(':hover'))) return;
        fling(autoTurn % 3 === 2 ? -1 : 1);
        autoTurn += 1;
      }, every);
    }
  }

  const press = (dir) => {
    touchedAt = performance.now();
    if (!reduced) return fling(dir);
    order = [...order.slice(1), order[0]];
    seen += 1;
    return arrange(false);
  };
  disposer.listen(yesButton, 'click', () => press(1));
  disposer.listen(noButton, 'click', () => press(-1));

  return {
    next: (dir = 1) => press(dir < 0 ? -1 : 1),
    destroy() {
      destroyed = true;
      disposer.run();
      removeRoot(root);
    },
  };
}
