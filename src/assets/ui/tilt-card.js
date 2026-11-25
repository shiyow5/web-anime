import { animate, createAnimatable, spring } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'tilt-card',
  title: '傾くカード',
  category: 'ui',
  libs: ['animejs'],
  description:
    'ポインターの位置に合わせてカードが立体的に傾き、表面を光が動きます。中の絵と文字は高さを変えてあるので、傾けると奥行きが見えます。作品一覧や商品カードに使えます。',
  params: {
    maxTilt: { type: 'range', label: '傾きの大きさ（度）', min: 2, max: 30, step: 1, default: 14 },
    glare: { type: 'range', label: '光の強さ', min: 0, max: 1, step: 0.05, default: 0.5 },
    background: { type: 'color', label: '背景色', default: '#e6e8f2' },
  },
};

const CSS = `
.ua-tc{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:4%;overflow:hidden;
  container-type:size;perspective:1100px;background:var(--ua-bg);font-family:var(--ua-display,system-ui,sans-serif)}
.ua-tc__card{position:relative;width:min(25cqw,58cqh,280px);aspect-ratio:3/4;border-radius:7% / 5.25%;
  transform-style:preserve-3d;will-change:transform;color:#fff;
  box-shadow:0 30px 60px -28px rgba(20,22,60,.55)}
.ua-tc__art{position:absolute;inset:0;border-radius:inherit;overflow:hidden;background:var(--art)}
.ua-tc__art::after{content:"";position:absolute;inset:0;
  background:radial-gradient(circle at var(--gx,50%) var(--gy,0%),rgba(255,255,255,var(--glare)),transparent 55%);
  opacity:var(--on,0);transition:opacity .3s}
.ua-tc__orb{position:absolute;left:50%;top:38%;width:54%;aspect-ratio:1;border-radius:50%;background:var(--orb);
  transform:translate(-50%,-50%) translateZ(50px);box-shadow:0 18px 30px -12px rgba(0,0,0,.45)}
.ua-tc__text{position:absolute;left:9%;right:9%;bottom:8%;transform:translateZ(34px)}
.ua-tc__name{margin:0;font-size:clamp(14px,3.1cqw,30px);font-weight:800;letter-spacing:-0.02em;line-height:1.1}
.ua-tc__note{margin:.35em 0 0;font-size:clamp(10px,1.35cqw,14px);opacity:.82}
@container (max-width:560px){
  .ua-tc__card{width:min(54cqw,62cqh)}
  .ua-tc__card:nth-child(n+2){display:none}
  .ua-tc__name{font-size:clamp(14px,6cqw,30px)}
  .ua-tc__note{font-size:clamp(10px,3cqw,14px)}
}
`;

const CARDS = [
  { name: 'Coral reef', note: '珊瑚と夕焼け', art: 'linear-gradient(160deg,#ff8f6b,#c2255c 70%,#5f0f40)', orb: 'radial-gradient(circle at 32% 28%,#fff1c9,#ffb347 55%,#ff6a3d)' },
  { name: 'Deep field', note: '夜の海と月', art: 'linear-gradient(160deg,#2b3cff,#1b1464 65%,#0b0a2a)', orb: 'radial-gradient(circle at 32% 28%,#ffffff,#b9c6ff 50%,#6f7dff)' },
  { name: 'Moss garden', note: '苔と朝露', art: 'linear-gradient(160deg,#b7e36b,#2f9e6a 60%,#0d4a45)', orb: 'radial-gradient(circle at 32% 28%,#fbffe0,#e3f56b 55%,#8fce3c)' },
];

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-tc', { '--ua-bg': p.background, '--glare': String(p.glare) });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const back = spring({ stiffness: 150, damping: 10 });

  CARDS.forEach(({ name, note, art, orb }, index) => {
    const card = h(
      'article',
      { class: 'ua-tc__card', style: { '--art': art, '--orb': orb } },
      h('div', { class: 'ua-tc__art' }),
      h('div', { class: 'ua-tc__orb' }),
      h('div', { class: 'ua-tc__text' }, h('h3', { class: 'ua-tc__name', text: name }), h('p', { class: 'ua-tc__note', text: note })),
    );
    root.appendChild(card);
    if (reduced) return;

    const tilt = createAnimatable(card, { rotateX: 450, rotateY: 450, ease: 'out(3)' });
    disposer.add(() => tilt.revert());
    // 一覧の小さな枠では、触る前からゆっくり揺らして立体だと分かるようにする。
    const idle = p.preview
      ? animate(card, {
          rotateY: [-p.maxTilt, p.maxTilt],
          rotateX: [p.maxTilt * 0.4, -p.maxTilt * 0.4],
          duration: 2800 + index * 500,
          ease: 'inOutSine',
          alternate: true,
          loop: true,
        })
      : null;

    disposer.listen(card, 'pointerenter', () => {
      idle?.pause();
      card.style.setProperty('--on', '1');
    });
    disposer.listen(card, 'pointermove', (event) => {
      const { x, y } = localPointer(event, card);
      tilt.rotateY((x - 0.5) * 2 * p.maxTilt);
      tilt.rotateX(-(y - 0.5) * 2 * p.maxTilt);
      card.style.setProperty('--gx', `${x * 100}%`);
      card.style.setProperty('--gy', `${y * 100}%`);
    });
    disposer.listen(card, 'pointerleave', () => {
      card.style.setProperty('--on', '0');
      animate(card, { rotateX: 0, rotateY: 0, ease: back });
    });
  });

  return {
    destroy() {
      disposer.run();
      removeRoot(root);
    },
  };
}
