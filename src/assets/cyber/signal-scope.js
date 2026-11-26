import { animate, createTimer, stagger, steps, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'signal-scope',
  title: '波形の計器',
  category: 'cyber',
  libs: ['animejs'],
  description:
    'オシロスコープの画面を、光の点が左から右へ走って 2 本の波形を描き、通ったあとに残像が残ります。ポインターを左右に動かすと周波数が、上下に動かすと振れ幅が変わり、画面の数値も追従します。タップすると単発の取り込みが始まります。光の点が一瞬止まり、タップした位置に測定の線が立って衝撃の波が走り、掃引が速まるあいだに波形が次の種類へ少しずつ形を変え、線の読み値が出てから通常の掃引に戻ります。',
  params: {
    trace: { type: 'color', label: '波形 1 の色', default: '#ffd23f' },
    trace2: { type: 'color', label: '波形 2 の色', default: '#ff5f7e' },
    background: { type: 'color', label: '画面の色', default: '#0d0a14' },
    shape: {
      type: 'select',
      label: '波形の種類',
      options: [
        { value: 'sine', label: '正弦波' },
        { value: 'square', label: '矩形波' },
        { value: 'saw', label: 'のこぎり波' },
        { value: 'pulse', label: '脈の波' },
      ],
      default: 'sine',
    },
    cycles: { type: 'range', label: '画面に入る波の数', min: 1, max: 12, step: 0.5, default: 4 },
    persistence: { type: 'range', label: '残像の長さ', min: 0.2, max: 3, step: 0.1, default: 1.3 },
  },
};

const CSS = `
.ua-ss{position:absolute;inset:0;overflow:hidden;container-type:size;cursor:crosshair;
  background:linear-gradient(160deg,color-mix(in srgb,var(--ua-bg) 70%,#3a3350),color-mix(in srgb,var(--ua-bg) 80%,#000));
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:var(--ua-trace)}
.ua-ss__screen{position:absolute;inset:4.5cqh 3cqw 13cqh;border-radius:1.6cqw;overflow:hidden;background:var(--ua-bg);
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ua-trace) 30%,transparent),inset 0 0 9cqw rgba(0,0,0,.75),0 0 4cqw color-mix(in srgb,var(--ua-trace) 10%,transparent)}
.ua-ss canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.ua-ss__read{position:absolute;font-size:max(8px,1.45cqw);line-height:1.5;letter-spacing:.08em;white-space:nowrap;
  text-shadow:0 0 .7em color-mix(in srgb,var(--ua-trace) 60%,transparent)}
.ua-ss__read--tl{left:2cqw;top:1.6cqh}
.ua-ss__read--tr{right:2cqw;top:1.6cqh;text-align:right}
.ua-ss__read--bl{left:2cqw;bottom:1.6cqh}
.ua-ss__read--br{right:2cqw;bottom:1.6cqh;text-align:right}
.ua-ss__read b{font-size:1.7em;font-weight:700;line-height:1.1}
.ua-ss__ch2{color:var(--ua-trace2);text-shadow:0 0 .7em color-mix(in srgb,var(--ua-trace2) 60%,transparent)}
.ua-ss__dot{position:absolute;left:0;top:0;width:1.1cqw;height:1.1cqw;min-width:6px;min-height:6px;margin:-.55cqw 0 0 -.55cqw;border-radius:50%;
  background:#fff;box-shadow:0 0 1.4cqw .3cqw var(--ua-trace);pointer-events:none}
.ua-ss__dot--2{box-shadow:0 0 1.4cqw .3cqw var(--ua-trace2)}
.ua-ss__panel{position:absolute;left:3cqw;right:3cqw;bottom:3cqh;height:7cqh;display:flex;align-items:center;gap:2.4cqw;
  font-size:max(7px,1.2cqw);letter-spacing:.16em;color:color-mix(in srgb,var(--ua-trace) 55%,#8a84a0);white-space:nowrap}
.ua-ss__leds{display:flex;gap:.8cqw}
.ua-ss__leds i{width:1cqw;height:1cqw;min-width:5px;min-height:5px;border-radius:50%;background:var(--ua-trace2)}
.ua-ss__leds i:first-child{background:var(--ua-trace)}
.ua-ss__track{position:relative;flex:1;height:2px;background:color-mix(in srgb,var(--ua-trace) 25%,transparent)}
.ua-ss__track::before{content:"";position:absolute;inset:-.9cqh 0;background:repeating-linear-gradient(90deg,color-mix(in srgb,var(--ua-trace) 45%,transparent) 0 1px,transparent 1px 5%)}
.ua-ss__cursor{position:absolute;top:0;bottom:0;left:0;width:0;border-left:1px dashed #fff;opacity:0;pointer-events:none}
.ua-ss__cursor span{position:absolute;top:44%;left:.8cqw;padding:.15em .5em;font-size:max(8px,1.3cqw);letter-spacing:.06em;white-space:nowrap;color:var(--ua-bg);background:var(--ua-trace)}
.ua-ss__cursor--flip span{left:auto;right:.8cqw}
.ua-ss__knob{position:absolute;top:50%;left:0;width:.5cqw;min-width:3px;height:3.4cqh;margin-top:-1.7cqh;background:var(--ua-trace);box-shadow:0 0 1cqw var(--ua-trace)}
`;

const SHAPES = ['sine', 'square', 'saw', 'pulse'];
const TAU = Math.PI * 2;
const TRIG_AUTO = 'TRIG AUTO ▲ DC';
const TRIG_SINGLE = 'TRIG SINGLE ▲ DC';

// 位相（ラジアン）から、-1〜1 の波の高さを返す。
export function waveAt(shape, phase) {
  const turn = phase / TAU - Math.floor(phase / TAU);
  if (shape === 'square') return Math.tanh(Math.sin(phase) * 6);
  if (shape === 'saw') return turn * 2 - 1;
  if (shape === 'pulse') {
    // 小さな山、鋭い山、ゆるい山の順に並ぶ、脈のような波。
    const bump = (center, width, height) => height * Math.exp(-(((turn - center) / width) ** 2));
    return bump(0.2, 0.035, 0.22) - bump(0.33, 0.012, 0.3) + bump(0.36, 0.016, 1) - bump(0.4, 0.014, 0.42) + bump(0.62, 0.06, 0.3) - 0.12;
  }
  return Math.sin(phase);
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-ss', { '--ua-bg': p.background, '--ua-trace': p.trace, '--ua-trace2': p.trace2 });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();

  const gridCanvas = h('canvas', { 'aria-hidden': 'true' });
  const traceCanvas = h('canvas', { 'aria-hidden': 'true' });
  const dots = [h('i', { class: 'ua-ss__dot' }), h('i', { class: 'ua-ss__dot ua-ss__dot--2' })];
  const freqText = h('b', { text: '200.0' });
  const periodText = h('span', { text: 'T 5.00 ms' });
  const vppText = h('span', { text: 'Vpp 2.40 V' });
  const shapeText = h('span', { text: '' });
  const trigText = h('div', { text: TRIG_AUTO });
  const reads = [
    h('div', { class: 'ua-ss__read ua-ss__read--tl' }, h('div', { text: 'CH1  500mV/div' }), h('div', { class: 'ua-ss__ch2', text: 'CH2  200mV/div' })),
    h('div', { class: 'ua-ss__read ua-ss__read--tr' }, h('div', {}, freqText, h('span', { text: ' Hz' })), h('div', {}, periodText)),
    h('div', { class: 'ua-ss__read ua-ss__read--bl' }, h('div', { text: 'TIME 2.00ms/div' }), h('div', {}, shapeText)),
    h('div', { class: 'ua-ss__read ua-ss__read--br' }, h('div', {}, vppText), trigText),
  ];
  const cursorText = h('span', { text: '' });
  const cursor = h('div', { class: 'ua-ss__cursor' }, cursorText);
  const screen = h('div', { class: 'ua-ss__screen' }, gridCanvas, traceCanvas, dots, cursor, reads);
  const knob = h('i', { class: 'ua-ss__knob' });
  const leds = [h('i'), h('i'), h('i')];
  const panel = h('div', { class: 'ua-ss__panel' }, h('div', { class: 'ua-ss__leds' }, leds), h('span', { text: 'S-2 · 2CH' }), h('span', { text: 'FREQ' }), h('div', { class: 'ua-ss__track' }, knob), h('span', { text: 'RUN' }));
  root.append(screen, panel);

  const grid = gridCanvas.getContext('2d');
  const ctx = traceCanvas.getContext('2d');
  let width = 1;
  let height = 1;
  let dpr = 1;
  let shape = p.shape;
  const view = { mult: 1, amp: 0.7, targetMult: 1, targetAmp: 0.7 };
  const beam = { u: 0, phase: 0, time: 0, y1: null, y2: null };

  // 単発の取り込みで使う値。blend は前の波形から今の波形への混ざり具合、rush は掃引の速さの倍率、
  // shock はタップした位置に立つ衝撃の波の強さ。
  let fromShape = shape;
  const capture = { blend: 1, rush: 1, shock: 0, at: 0.5 };
  const levels = (phase, time) => {
    const wave = capture.blend >= 1 ? waveAt(shape, phase) : waveAt(fromShape, phase) * (1 - capture.blend) + waveAt(shape, phase) * capture.blend;
    const near = beam.u - capture.at;
    const ring = capture.shock * Math.exp(-(near * near) / 0.006) * Math.sin(near * 90 - time * 30);
    const y1 = wave * view.amp + 0.05 * Math.sin(phase * 3 + time * 2) + ring * 0.9;
    const y2 = Math.sin(phase * 0.5 + 1) * Math.cos(phase * 3.5 - time) * 0.75;
    return [height * (0.43 - y1 * 0.27), height * (0.8 - y2 * 0.1)];
  };

  function drawGrid() {
    grid.setTransform(dpr, 0, 0, dpr, 0, 0);
    grid.clearRect(0, 0, width, height);
    grid.strokeStyle = p.trace;
    grid.lineWidth = 1;
    for (let i = 1; i < 10; i += 1) {
      grid.globalAlpha = i === 5 ? 0.34 : 0.13;
      grid.beginPath();
      grid.moveTo(Math.round((width * i) / 10) + 0.5, 0);
      grid.lineTo(Math.round((width * i) / 10) + 0.5, height);
      grid.stroke();
    }
    for (let i = 1; i < 8; i += 1) {
      grid.globalAlpha = i === 4 ? 0.34 : 0.13;
      grid.beginPath();
      grid.moveTo(0, Math.round((height * i) / 8) + 0.5);
      grid.lineTo(width, Math.round((height * i) / 8) + 0.5);
      grid.stroke();
    }
    // 中央の軸に、1 目盛りを 5 等分する細かい刻みを入れる。
    grid.globalAlpha = 0.5;
    grid.beginPath();
    const tick = Math.max(2, height * 0.008);
    for (let i = 1; i < 50; i += 1) {
      const x = Math.round((width * i) / 50) + 0.5;
      grid.moveTo(x, height / 2 - tick);
      grid.lineTo(x, height / 2 + tick);
    }
    for (let i = 1; i < 40; i += 1) {
      const y = Math.round((height * i) / 40) + 0.5;
      grid.moveTo(width / 2 - tick, y);
      grid.lineTo(width / 2 + tick, y);
    }
    grid.stroke();
    // 左端に、2 本の波形の基準位置を示す印を付ける。
    const mark = Math.max(5, height * 0.018);
    [
      [0.43, p.trace],
      [0.8, p.trace2],
    ].forEach(([level, color]) => {
      grid.globalAlpha = 0.95;
      grid.fillStyle = color;
      grid.beginPath();
      grid.moveTo(0, height * level - mark);
      grid.lineTo(mark * 1.5, height * level);
      grid.lineTo(0, height * level + mark);
      grid.fill();
    });
    grid.globalAlpha = 1;
  }

  function resize() {
    // 登場のときに画面を縦に伸ばすので、変形の影響を受けない clientWidth と clientHeight で測る。
    width = Math.max(1, screen.clientWidth);
    height = Math.max(1, screen.clientHeight);
    dpr = Math.min(window.devicePixelRatio || 1, p.preview ? 1.5 : 2);
    for (const canvas of [gridCanvas, traceCanvas]) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    beam.y1 = null;
    drawGrid();
    if (reduced) drawStill();
  }

  function stroke(color, x0, y0, x1, y1) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = Math.max(5, height * 0.02);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(1.4, height * 0.0045);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  // 光の点を du だけ右へ進め、その間の波形を線で足す。
  function advance(du) {
    const pieces = Math.max(1, Math.ceil((du * width) / 2));
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < pieces; i += 1) {
      const from = beam.u;
      beam.u += du / pieces;
      beam.phase += (TAU * p.cycles * view.mult * du) / pieces;
      const [y1, y2] = levels(beam.phase, beam.time);
      if (beam.y1 !== null && beam.u <= 1) {
        stroke(p.trace, from * width, beam.y1, beam.u * width, y1);
        stroke(p.trace2, from * width, beam.y2, beam.u * width, y2);
      }
      beam.y1 = y1;
      beam.y2 = y2;
      if (beam.u >= 1) {
        beam.u = 0;
        beam.y1 = null;
      }
    }
  }

  function drawStill() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    beam.u = 0;
    beam.phase = 0;
    beam.y1 = null;
    advance(0.999);
    for (const dot of dots) dot.style.opacity = '0';
  }

  function showNumbers() {
    const hz = p.cycles * view.mult * 50;
    freqText.textContent = hz.toFixed(1);
    periodText.textContent = `T ${(1000 / hz).toFixed(2)} ms`;
    vppText.textContent = `Vpp ${(view.amp * 4).toFixed(2)} V`;
    knob.style.left = `${(((Math.log2(view.mult) / 2.6 + 0.5) * 100)).toFixed(1)}%`;
  }
  const showShape = () => {
    shapeText.textContent = `WAVE ${shape.toUpperCase()}`;
  };

  // 単発の取り込み。光の点が止まり、測定の線が立つ（準備）→ 衝撃の波が走り、速い掃引のなかで波形が次の種類へ変わる（山場）
  // → 読み値が出て、線が消え、通常の掃引へ戻る（余韻）。
  function nextShape(event) {
    fromShape = shape;
    shape = SHAPES[(SHAPES.indexOf(shape) + 1) % SHAPES.length];
    showShape();
    if (reduced) return drawStill();
    const at = event?.clientX === undefined ? 0.3 + Math.random() * 0.4 : Math.min(0.96, Math.max(0.04, localPointer(event, screen).x));
    utils.remove([capture, cursor, trigText, shapeText]);
    Object.assign(capture, { blend: 0, at });
    cursor.style.left = `${(at * 100).toFixed(1)}%`;
    cursor.classList.toggle('ua-ss__cursor--flip', at > 0.7);
    cursorText.textContent = `t ${(at * 20).toFixed(2)} ms`;
    trigText.textContent = TRIG_SINGLE;
    animate(capture, {
      rush: [
        { to: 0.04, duration: 180, ease: 'outQuad' },
        { to: 3.2, duration: 380, ease: 'inQuad' },
        { to: 1, duration: 1100, ease: 'outExpo' },
      ],
    });
    animate(capture, {
      shock: [
        { to: 1, duration: 140, ease: 'outQuad' },
        { to: 0, duration: 1500, ease: 'outQuad' },
      ],
    });
    animate(capture, { blend: 1, duration: 1100, delay: 240, ease: 'inOutQuad' });
    animate(cursor, {
      opacity: [
        { to: 0.9, duration: 120 },
        { to: 0.9, duration: 1500 },
        { to: 0, duration: 400 },
      ],
      scaleY: [{ from: 0, to: 1, duration: 260, ease: 'outExpo' }],
      onComplete() {
        trigText.textContent = TRIG_AUTO;
      },
    });
    animate(trigText, { opacity: [0.2, 1], duration: 240, ease: steps(2), loop: 3 });
    animate(shapeText, { opacity: [0, 1], duration: 360, delay: 700, ease: steps(3) });
    disposer.timeout(() => {
      const volts = waveAt(shape, TAU * p.cycles * view.mult * at) * view.amp * 2;
      cursorText.textContent = `t ${(at * 20).toFixed(2)} ms  ${volts >= 0 ? '+' : ''}${volts.toFixed(2)} V`;
    }, 900);
  }

  showShape();
  showNumbers();
  const observer = new ResizeObserver(resize);
  observer.observe(screen);
  disposer.add(() => observer.disconnect());
  resize();
  disposer.listen(root, 'click', nextShape);

  if (reduced) {
    return { nextShape, destroy: () => (disposer.run(), removeRoot(root)) };
  }

  animate(screen, { scaleY: [0.01, 1], opacity: [0.4, 1], duration: 600, ease: 'outExpo' });
  animate(reads, { opacity: [0, 1], duration: 300, ease: steps(3), delay: stagger(110, { start: 350 }) });
  animate(leds, { opacity: [1, 0.25], duration: 700, ease: steps(1), loop: true, alternate: true, delay: stagger(260) });

  let hovering = false;
  disposer.listen(root, 'pointermove', (event) => {
    const { x, y } = localPointer(event, root);
    hovering = true;
    view.targetMult = 2 ** ((Math.min(1, Math.max(0, x)) - 0.5) * 2.6);
    view.targetAmp = 0.2 + (1 - Math.min(1, Math.max(0, y))) * 0.8;
  });
  disposer.listen(root, 'pointerleave', () => {
    hovering = false;
  });

  let last = performance.now();
  const timer = createTimer({
    onUpdate() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      beam.time += dt;
      if (!hovering) {
        // 触っていないときは、周波数と振れ幅をゆっくり揺らして見せる。
        view.targetMult = 2 ** (Math.sin(beam.time * 0.45) * 0.9);
        view.targetAmp = 0.68 + Math.sin(beam.time * 0.7) * 0.22;
      }
      const k = Math.min(1, dt * 5);
      view.mult += (view.targetMult - view.mult) * k;
      view.amp += (view.targetAmp - view.amp) * k;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1 - Math.exp(-dt / p.persistence);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      advance(dt * 0.62 * capture.rush);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      if (beam.y1 !== null) {
        dots[0].style.transform = `translate(${(beam.u * width).toFixed(1)}px,${beam.y1.toFixed(1)}px)`;
        dots[1].style.transform = `translate(${(beam.u * width).toFixed(1)}px,${beam.y2.toFixed(1)}px)`;
      }
      showNumbers();
    },
  });
  disposer.add(() => timer.pause());

  if (p.preview) disposer.interval(() => nextShape(), 4600);

  return {
    nextShape,
    destroy() {
      disposer.run();
      utils.remove([capture, cursor, trigText, shapeText]);
      removeRoot(root);
    },
  };
}
