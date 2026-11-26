import { animate, utils } from 'animejs';
import { createRoot, h, injectStyle, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams, splitList } from '../../lib/params.js';

export const meta = {
  id: 'scramble-text',
  title: '解読される文字',
  category: 'text',
  libs: ['animejs'],
  description:
    '文字が記号の乱れを経て、左から順に次の文へ置き換わります。暗号を解くような見た目で、技術系のサイトや数値の見出しに合います。クリックすると、行全体がいったん記号の乱れに飲まれてゆれ、クリックした文字の位置から左右へ解読が広がって次の文になり、確定した文字の色がすっと落ち着きます。',
  params: {
    text: { type: 'text', label: '文（/ で区切る）', default: 'SIGNAL ACQUIRED / 信号を受信しました / DECODING MOTION', maxLength: 160 },
    glyphs: {
      type: 'select',
      label: '乱れに使う文字',
      options: [
        { value: 'symbols', label: '記号' },
        { value: 'katakana', label: 'カタカナ' },
        { value: 'binary', label: '0 と 1' },
        { value: 'blocks', label: 'ブロック' },
      ],
      default: 'symbols',
    },
    duration: { type: 'range', label: '置き換えの時間（秒）', min: 0.4, max: 4, step: 0.1, default: 1.6 },
    hold: { type: 'range', label: '止まる時間（秒）', min: 0.5, max: 6, step: 0.5, default: 1.5 },
    color: { type: 'color', label: '文字色', default: '#e8ecff' },
    accent: { type: 'color', label: '乱れの色', default: '#ff7a45' },
    background: { type: 'color', label: '背景色', default: '#101425' },
  },
};

const GLYPHS = {
  symbols: '!<>-_\\/[]{}=+*^?#%&',
  katakana: 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ',
  binary: '01',
  blocks: '░▒▓█▚▞',
};
const NOISE_WINDOW = 0.28;

const CSS = `
.ua-st{cursor:pointer;position:absolute;inset:0;display:grid;place-content:center;justify-items:start;gap:3%;overflow:hidden;
  container-type:size;padding:0 8%;background:var(--ua-bg);color:var(--ua-fg);
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,"Noto Sans Mono CJK JP",monospace}
.ua-st__line{margin:0;font-size:clamp(14px,5.6cqw,72px);font-weight:600;line-height:1.3;min-height:1.3em;
  white-space:pre-wrap;word-break:break-all}
.ua-st__noise{color:var(--ua-accent)}
.ua-st__rest{opacity:.35}
.ua-st__bar{width:min(40cqw,360px);height:max(2px,.4cqw);background:color-mix(in srgb,var(--ua-fg) 18%,transparent);overflow:hidden}
.ua-st__bar i{display:block;height:100%;background:var(--ua-accent);transform-origin:left;transform:scaleX(0)}
`;

// 進み具合 progress（0〜1）に応じて、確定した部分・乱れている部分・まだ前の文のままの部分を返す。
export function scrambleFrame(from, to, progress, randomGlyph) {
  const a = Array.from(from);
  const b = Array.from(to);
  const length = Math.max(a.length, b.length, 1);
  const head = progress * (1 + NOISE_WINDOW);
  let done = '';
  let noise = '';
  let rest = '';
  for (let i = 0; i < length; i += 1) {
    const at = i / length;
    if (head >= at + NOISE_WINDOW) done += b[i] ?? '';
    else if (head >= at) noise += (b[i] ?? a[i]) === ' ' ? ' ' : randomGlyph();
    else rest += a[i] ?? '';
  }
  return { done, noise, rest };
}

// クリックした文字（origin 番目）から左右へ解読が広がるときの、各部分の文字列を返す。
function spreadFrame(from, to, progress, origin, randomGlyph) {
  const a = Array.from(from);
  const b = Array.from(to);
  const length = Math.max(a.length, b.length, 1);
  const center = Math.min(length - 1, Math.max(0, origin));
  const reach = Math.max(center, length - 1 - center, 1);
  const head = progress * (1 + NOISE_WINDOW);
  const out = { restL: '', noiseL: '', done: '', noiseR: '', restR: '' };
  for (let i = 0; i < length; i += 1) {
    const at = (Math.abs(i - center) / reach) * (1 - 1 / (length + 1));
    const left = i < center;
    if (head >= at + NOISE_WINDOW) out.done += b[i] ?? '';
    else if (head >= at) out[left ? 'noiseL' : 'noiseR'] += (b[i] ?? a[i]) === ' ' ? ' ' : randomGlyph();
    else out[left ? 'restL' : 'restR'] += a[i] ?? '';
  }
  return out;
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-st', { '--ua-bg': p.background, '--ua-fg': p.color, '--ua-accent': p.accent });
  const restL = h('span', { class: 'ua-st__rest' });
  const noiseL = h('span', { class: 'ua-st__noise' });
  const done = h('span');
  const noise = h('span', { class: 'ua-st__noise' });
  const rest = h('span', { class: 'ua-st__rest' });
  const fill = h('i');
  const line = h('p', { class: 'ua-st__line' }, restL, noiseL, done, noise, rest);
  root.append(line, h('div', { class: 'ua-st__bar' }, fill));

  const parsed = splitList(p.text, { separator: '/', maxItems: 8, maxLength: 48 });
  const phrases = parsed.length ? parsed : ['SIGNAL ACQUIRED'];
  const glyphs = Array.from(GLYPHS[p.glyphs]);
  const randomGlyph = () => glyphs[Math.floor(Math.random() * glyphs.length)];
  const state = { progress: 0, jam: 0 };
  let index = -1;
  let current = '';
  let timer = 0;
  let busy = false;
  let destroyed = false;

  function paint(frame, progress) {
    restL.textContent = frame.restL ?? '';
    noiseL.textContent = frame.noiseL ?? '';
    done.textContent = frame.done;
    noise.textContent = frame.noiseR ?? frame.noise ?? '';
    rest.textContent = frame.restR ?? frame.rest ?? '';
    fill.style.transform = `scaleX(${progress})`;
  }
  const render = (from, to, progress) => paint(scrambleFrame(from, to, progress, randomGlyph), progress);
  const shown = () => restL.textContent + noiseL.textContent + done.textContent + noise.textContent + rest.textContent;
  const settle = (to) => {
    current = to;
    busy = false;
    if (!destroyed && phrases.length > 1) timer = setTimeout(next, p.hold * 1000);
  };

  // 自動で進むとき。左から順に置き換える。
  function next() {
    if (busy || destroyed) return;
    clearTimeout(timer);
    index = (index + 1) % phrases.length;
    const from = current;
    const to = phrases[index];
    if (prefersReducedMotion()) {
      current = to;
      render(from, to, 1);
      return;
    }
    busy = true;
    let tick = 0;
    animate(state, {
      progress: [0, 1],
      duration: p.duration * 1000,
      ease: 'linear',
      // 毎フレーム書き換えると読みにくいので、3 フレームに 1 回だけ乱れを更新する。
      onUpdate() {
        tick += 1;
        if (tick % 3 === 0) render(from, to, state.progress);
      },
      onComplete() {
        render(from, to, 1);
        settle(to);
      },
    });
  }

  // クリックしたとき。準備: 行全体が乱れに飲まれてゆれ、進み具合の棒が空になる。
  // 山場: クリックした文字から左右へ解読が広がる。余韻: 確定した文字の色が、乱れの色から落ち着く。
  function decode(event) {
    if (destroyed) return;
    clearTimeout(timer);
    if (prefersReducedMotion()) {
      busy = false;
      next();
      return;
    }
    // 途中でクリックされたら、いま見えている文字列から続ける。
    utils.remove(state);
    utils.remove([line, done]);
    const from = busy ? shown() : current;
    index = (index + 1) % phrases.length;
    const to = phrases[index];
    busy = true;
    const rect = line.getBoundingClientRect();
    const hasPoint = typeof event?.clientX === 'number' && rect.width > 0;
    const ratio = hasPoint ? utils.clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0.5;
    const length = Math.max(Array.from(from).length, Array.from(to).length, 1);
    const origin = Math.round(ratio * (length - 1));
    const jammed = () => Array.from(from, (char) => (char === ' ' ? ' ' : randomGlyph())).join('');
    let tick = 0;
    state.jam = 0;
    animate(line, {
      translateX: [-7, 6, -4, 3, 0].map((to) => ({ to, duration: 56, ease: 'outQuad' })),
    });
    animate(state, {
      jam: [0, 1],
      duration: 280,
      ease: 'linear',
      onUpdate() {
        tick += 1;
        if (tick % 2 === 0) paint({ done: '', noise: jammed(), rest: '' }, (1 - state.jam) * state.progress);
      },
      onComplete() {
        animate(state, {
          progress: [0, 1],
          duration: p.duration * 720,
          ease: 'outQuad',
          onUpdate() {
            tick += 1;
            if (tick % 3 === 0) paint(spreadFrame(from, to, state.progress, origin, randomGlyph), state.progress);
          },
          onComplete() {
            render(from, to, 1);
            animate(done, { color: [p.accent, p.color], duration: 700, ease: 'outQuad' });
            settle(to);
          },
        });
      },
    });
  }
  root.addEventListener('click', decode);
  next();

  return {
    next,
    decode,
    destroy() {
      destroyed = true;
      clearTimeout(timer);
      root.removeEventListener('click', decode);
      utils.remove(state);
      utils.remove([line, done]);
      removeRoot(root);
    },
  };
}
