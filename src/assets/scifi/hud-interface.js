import { animate, createDrawable, createTimeline, stagger, steps, utils } from 'animejs';
import { createDisposer, createRoot, injectStyle, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'hud-interface',
  title: '宇宙船の計器盤',
  category: 'scifi',
  libs: ['animejs'],
  description:
    'SF 映画の操縦席にあるような計器の画面です。枠と目盛りが線で描かれて起動し、回る照準、伸び縮みする計器、波形、数値が動き続けます。タップすると、その場所へ 4 つの鉤が回りながら狭まって目標を捉えます。捉えた瞬間に輪が広がり、中心の照準から目標へ線が伸び、計器と距離の数値が跳ねて「TARGET LOCK」が点滅し、しばらくして解除されます。SVG だけで描くので、どの大きさでもくっきり表示されます。',
  params: {
    color: { type: 'color', label: '線の色', default: '#5cf2ff' },
    accent: { type: 'color', label: '強調の色', default: '#ff8a3d' },
    background: { type: 'color', label: '背景色', default: '#041019' },
    interval: { type: 'range', label: '数値が変わる間隔（秒）', min: 0.5, max: 5, step: 0.1, default: 1.6 },
  },
};

const CSS = `
.ua-hud{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;background:var(--ua-bg);color:var(--ua-color)}
.ua-hud svg{width:96%;height:94%;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
.ua-hud__line{fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round}
.ua-hud__thin{fill:none;stroke:currentColor;stroke-width:.8;opacity:.55}
.ua-hud__spin{transform-origin:400px 250px}
.ua-hud__accent{stroke:var(--ua-accent);fill:none;stroke-width:3;stroke-linecap:round}
.ua-hud__fill{fill:currentColor}
.ua-hud__bar{fill:currentColor;transform-box:fill-box;transform-origin:left center}
.ua-hud__text{fill:currentColor;font-size:11px;letter-spacing:.12em}
.ua-hud__big{fill:var(--ua-accent);font-size:26px;font-weight:700;letter-spacing:.04em}
.ua-hud__fade{opacity:0}
`;

const CX = 400;
const CY = 250;
const BARS = ['PWR', 'SIG', 'OXY', 'TMP', 'VEL'];
const WAVE_POINTS = 40;

const polar = (radius, degrees) => {
  const a = ((degrees - 90) * Math.PI) / 180;
  return [CX + Math.cos(a) * radius, CY + Math.sin(a) * radius];
};
const arcPath = (radius, from, to) => {
  const [x1, y1] = polar(radius, from);
  const [x2, y2] = polar(radius, to);
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${radius} ${radius} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
};

function buildReticle() {
  const ticks = Array.from({ length: 72 }, (_, i) => {
    const [x1, y1] = polar(150, i * 5);
    const [x2, y2] = polar(i % 6 === 0 ? 136 : 143, i * 5);
    return s('line', { class: 'ua-hud__thin', x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1) });
  });
  const outer = s('g', { class: 'ua-hud__spin' }, s('circle', { class: 'ua-hud__thin', cx: CX, cy: CY, r: 172, 'stroke-dasharray': '2 10' }), s('path', { class: 'ua-hud__line', d: arcPath(172, 20, 80) }), s('path', { class: 'ua-hud__line', d: arcPath(172, 200, 260) }));
  const middle = s('g', { class: 'ua-hud__spin' }, ticks);
  const inner = s('g', { class: 'ua-hud__spin' }, s('path', { class: 'ua-hud__line', d: arcPath(84, 300, 420) }), s('path', { class: 'ua-hud__line', d: arcPath(84, 120, 240) }));
  const gauges = [112, 122, 132].map((radius) => s('path', { class: 'ua-hud__accent', d: arcPath(radius, 210, 330) }));
  const cross = [
    s('line', { class: 'ua-hud__line', x1: CX - 60, y1: CY, x2: CX - 18, y2: CY }),
    s('line', { class: 'ua-hud__line', x1: CX + 18, y1: CY, x2: CX + 60, y2: CY }),
    s('line', { class: 'ua-hud__line', x1: CX, y1: CY - 60, x2: CX, y2: CY - 18 }),
    s('line', { class: 'ua-hud__line', x1: CX, y1: CY + 18, x2: CX, y2: CY + 60 }),
    s('circle', { class: 'ua-hud__line', cx: CX, cy: CY, r: 6 }),
  ];
  return { outer, middle, inner, gauges, cross, strokes: [outer.children[1], outer.children[2], ...inner.children, ...cross] };
}

function buildFrame() {
  const corner = (x, y, dx, dy) => s('path', { class: 'ua-hud__line', d: `M${x} ${y + dy * 46} V${y} H${x + dx * 46}` });
  return [corner(16, 16, 1, 1), corner(784, 16, -1, 1), corner(16, 484, 1, -1), corner(784, 484, -1, -1)];
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-hud', { '--ua-bg': p.background, '--ua-color': p.color, '--ua-accent': p.accent });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();

  const reticle = buildReticle();
  const frame = buildFrame();
  const bars = BARS.map((label, i) => {
    const y = 150 + i * 44;
    const bar = s('rect', { class: 'ua-hud__bar', x: 40, y: y + 8, width: 130, height: 5 });
    const value = s('text', { class: 'ua-hud__text', x: 170, y, 'text-anchor': 'end' }, '00');
    const group = s('g', { class: 'ua-hud__fade' }, s('text', { class: 'ua-hud__text', x: 40, y }, label), value, s('rect', { class: 'ua-hud__thin', x: 40, y: y + 8, width: 130, height: 5 }), bar);
    return { group, bar, value, state: { v: 0 } };
  });
  const wave = s('polyline', { class: 'ua-hud__line', points: '' });
  const readout = s('text', { class: 'ua-hud__big', x: 760, y: 190, 'text-anchor': 'end' }, '000.0');
  const status = s('text', { class: 'ua-hud__text', x: 760, y: 150, 'text-anchor': 'end' }, 'RANGE KM');
  const right = s('g', { class: 'ua-hud__fade' }, status, readout, s('line', { class: 'ua-hud__thin', x1: 630, y1: 210, x2: 760, y2: 210 }), wave, s('text', { class: 'ua-hud__text', x: 760, y: 360, 'text-anchor': 'end' }, 'LINK STABLE'));
  const headline = s('text', { class: 'ua-hud__text ua-hud__fade', x: CX, y: 40, 'text-anchor': 'middle' }, 'NAV SYSTEM ONLINE');

  root.appendChild(
    s(
      'svg',
      { viewBox: '0 0 800 500', role: 'img', 'aria-label': '計器盤の画面' },
      frame,
      headline,
      reticle.outer,
      reticle.middle,
      reticle.inner,
      reticle.gauges,
      reticle.cross,
      bars.map((b) => b.group),
      right,
    ),
  );

  // タップした場所を捉える印。4 つの鉤、広がる輪、中心からの線、短い札でできている。
  const svg = root.firstChild;
  const bracket = (dx, dy) => s('path', { class: 'ua-hud__accent', 'stroke-width': 2, d: `M${dx * 22} ${dy * 10} V${dy * 22} H${dx * 10}` });
  const brackets = s('g', {}, bracket(-1, -1), bracket(1, -1), bracket(1, 1), bracket(-1, 1));
  const lockRing = s('circle', { class: 'ua-hud__accent', 'stroke-width': 1.2, cx: 0, cy: 0, r: 4 });
  const lockDot = s('circle', { cx: 0, cy: 0, r: 2.5, style: { fill: 'var(--ua-accent)' } });
  const lockTag = s('text', { class: 'ua-hud__text', x: 30, y: -22, style: { fill: 'var(--ua-accent)' } }, '');
  const lockMark = s('g', { opacity: 0 }, brackets, lockRing, lockDot, lockTag);
  const lockLine = s('line', { class: 'ua-hud__thin', x1: CX, y1: CY, x2: CX, y2: CY, 'stroke-dasharray': '3 5', opacity: 0 });
  svg.append(lockLine, lockMark);
  const lock = { spread: 1, turn: 0, mark: 0, ring: 0, line: 0, x: CX, y: CY };
  let lockCount = 0;
  let lockTimeline = null;
  function drawLock() {
    lockMark.setAttribute('opacity', lock.mark.toFixed(3));
    brackets.setAttribute('transform', `rotate(${lock.turn.toFixed(1)}) scale(${lock.spread.toFixed(3)})`);
    lockRing.setAttribute('r', (4 + lock.ring * 70).toFixed(1));
    lockRing.setAttribute('opacity', (1 - lock.ring).toFixed(3));
    lockLine.setAttribute('opacity', (lock.line * 0.8).toFixed(3));
    lockLine.setAttribute('x2', (CX + (lock.x - CX) * lock.line).toFixed(1));
    lockLine.setAttribute('y2', (CY + (lock.y - CY) * lock.line).toFixed(1));
  }

  const waveState = { phase: 0, amp: 18 };
  function drawWave() {
    const points = Array.from({ length: WAVE_POINTS }, (_, i) => {
      const x = 630 + (i / (WAVE_POINTS - 1)) * 130;
      const y = 270 + Math.sin(i * 0.55 + waveState.phase) * waveState.amp * Math.sin(i * 0.17 + waveState.phase * 0.3);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    wave.setAttribute('points', points.join(' '));
  }
  drawWave();

  const fades = [headline, right, ...bars.map((b) => b.group)];
  const gaugeDrawables = createDrawable(reticle.gauges);
  const range = { v: 0 };
  const tracked = [waveState, range, lock, ...bars.map((b) => b.state), ...gaugeDrawables];

  function update() {
    for (const { bar, value, state } of bars) {
      animate(state, {
        v: utils.random(12, 99),
        duration: 700,
        ease: 'outExpo',
        onUpdate() {
          bar.style.transform = `scaleX(${state.v / 100})`;
          value.textContent = String(Math.round(state.v)).padStart(2, '0');
        },
      });
    }
    animate(gaugeDrawables, { draw: () => `0 ${utils.random(0.2, 1, 2)}`, duration: 800, ease: 'outExpo', delay: stagger(80) });
    animate(range, {
      v: utils.random(100, 999, 1),
      duration: 900,
      ease: 'outExpo',
      onUpdate() {
        readout.textContent = range.v.toFixed(1).padStart(5, '0');
      },
    });
    animate(waveState, { amp: utils.random(6, 26), duration: 900, ease: 'inOutSine' });
  }

  if (reduced) {
    for (const el of fades) el.style.opacity = '1';
    for (const { bar } of bars) bar.style.transform = 'scaleX(0.6)';
    return { destroy: () => removeRoot(root) };
  }

  // 起動。枠と照準を線で描き、目盛りを順に点灯してから、計器を動かし始める。
  const boot = createTimeline()
    .add(createDrawable([...frame, ...reticle.strokes]), { draw: ['0 0', '0 1'], duration: 900, ease: 'inOutQuart', delay: stagger(60) })
    .add([...reticle.middle.children], { opacity: [0, 0.55], duration: 300, delay: stagger(8) }, 200)
    .add(gaugeDrawables, { draw: ['0 0', '0 0.6'], duration: 700, ease: 'outExpo', delay: stagger(90) }, 500)
    .add(fades, { opacity: [0, 1], duration: 120, ease: steps(3), delay: stagger(90) }, 700)
    .call(update, 1100);
  disposer.add(() => boot.pause());

  // タップ。鉤が狭まる → 捉えた瞬間に輪が広がり、線が伸びて計器が跳ねる → 点滅してから解除する。
  function acquire(event) {
    let x = utils.random(250, 560);
    let y = utils.random(130, 370);
    const matrix = event ? svg.getScreenCTM() : null;
    if (matrix) {
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      x = Math.min(770, Math.max(30, point.x));
      y = Math.min(470, Math.max(30, point.y));
    }
    lockTimeline?.pause();
    utils.remove(lock);
    utils.remove([status, headline]);
    lock.x = x;
    lock.y = y;
    lockCount += 1;
    lockMark.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    lockTag.textContent = `TGT-${String(lockCount).padStart(2, '0')}  ${Math.round(x)}:${Math.round(y)}`;
    lockTag.setAttribute('opacity', '0');
    Object.assign(lock, { spread: 4.2, turn: -135, mark: 0, ring: 0, line: 0 });
    lockTimeline = createTimeline({ onUpdate: drawLock })
      .add(lock, { mark: 1, duration: 120, ease: 'linear' }, 0)
      .add(lock, { spread: [{ to: 0.82, duration: 420, ease: 'inOutQuart' }, { to: 1, duration: 380, ease: 'outElastic(1, .4)' }], turn: { to: 0, duration: 470, ease: 'outQuart' } }, 0)
      .call(() => {
        status.textContent = 'TARGET LOCK';
        headline.textContent = 'TARGET ACQUIRED';
        lockTag.setAttribute('opacity', '1');
        animate([status, headline], { opacity: [1, 0.15], duration: 110, ease: steps(1), alternate: true, loop: 9 });
        update();
      }, 430)
      .add(lock, { ring: [0, 1], duration: 900, ease: 'outExpo' }, 430)
      .add(lock, { line: 1, duration: 420, ease: 'outExpo' }, 430)
      .add(lock, { mark: 0, line: 0, duration: 500, ease: 'inQuad' }, 2400)
      .call(() => {
        status.textContent = 'RANGE KM';
        headline.textContent = 'NAV SYSTEM ONLINE';
        utils.set([status], { opacity: 1 });
        utils.set(headline, { opacity: 1 });
      }, 2900);
  }
  disposer.listen(root, 'pointerdown', acquire);
  disposer.add(() => lockTimeline?.pause());
  if (options.preview) disposer.interval(() => acquire(), 4600);

  animate(reticle.outer, { rotate: 360, duration: 40000, ease: 'linear', loop: true });
  animate(reticle.middle, { rotate: -360, duration: 70000, ease: 'linear', loop: true });
  animate(reticle.inner, { rotate: [0, 120, -60, 0], duration: 9000, ease: 'inOutQuart', loop: true });
  animate(waveState, { phase: Math.PI * 2, duration: 2400, ease: 'linear', loop: true, onUpdate: drawWave });
  disposer.interval(update, p.interval * 1000);

  return {
    destroy() {
      disposer.run();
      utils.remove(tracked);
      removeRoot(root);
    },
  };
}
