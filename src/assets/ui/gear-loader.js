import { animate, createTimer, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'gear-loader',
  title: '歯車のローダー',
  category: 'ui',
  libs: ['animejs'],
  description:
    '向きの違う 5 枚の歯車が立体的にかみ合って回る、読み込み中の表示です。CSS の 3D 変形と SVG だけで作ってあり、歯数の比で速さが決まります。進み具合が増えると歯車が進み、輪と数字が伸びて、100 で全体が弾みます。戻り値の setProgress(n) に 0〜100 を渡して使います。ポインターで傾きます。押すと、全体が逆回転して止まり、歯車が軸に沿って浮いてかみ合いが外れ、1 枚ずつ空回りしてから順にはまり直します。',
  params: {
    color: { type: 'color', label: '歯車の色', default: '#e9a23b' },
    accent: { type: 'color', label: '差し色', default: '#4fd1c5' },
    background: { type: 'color', label: '背景色', default: '#15171f' },
    label: { type: 'text', label: '添える言葉', default: '読み込み中', maxLength: 24 },
    speed: { type: 'range', label: '待機中の回る速さ', min: 0, max: 3, step: 0.1, default: 1 },
    progress: { type: 'range', label: '進み具合（自動が切のとき）', min: 0, max: 100, step: 1, default: 0 },
    auto: { type: 'boolean', label: '自動で 0 から 100 まで進める', default: true },
  },
};

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;
// 歯 1 枚ぶんの大きさ（モジュール）。入れ物の短い辺に対する割合（cqmin）で決める。
const MODULE = 2.2;
const THICK = 1.3;
const LAYERS = 5;

// かみ合う相手の角度。同じ平面に並ぶ歯車どうしで使う。phi は自分から見た相手の方向。
export function meshAngle(angle, driverTeeth, drivenTeeth, phi) {
  return phi + Math.PI + Math.PI / drivenTeeth - ((angle - phi) * driverTeeth) / drivenTeeth;
}

// 5 枚の歯車の配置。A と B は同じ平面、C と E は A・B の縁に直角に立ち、D は C にさらに直角にかみ合う。
const BETA = (210 / 180) * Math.PI;
const GAMMA = (20 / 180) * Math.PI;
const DELTA = (-40 / 180) * Math.PI;
const TEETH = { a: 20, b: 12, c: 12, d: 10, e: 10 };

// 主歯車 A の角度から、5 枚すべての角度（ラジアン）を返す。
export function trainAngles(a) {
  const b = meshAngle(a, TEETH.a, TEETH.b, GAMMA);
  const c = ((a - BETA) * TEETH.a) / TEETH.c + Math.PI / TEETH.c;
  const d = Math.PI + Math.PI / TEETH.d + ((c + Math.PI / 2) * TEETH.c) / TEETH.d;
  const e = Math.PI + Math.PI / TEETH.e - ((b - DELTA) * TEETH.b) / TEETH.e;
  return { a, b, c, d, e };
}

// 歯車の輪郭と、軽くするための窓を 1 本のパスにする。単位はモジュール。角度 0 に歯の中心が来る。
export function gearPath(teeth, windows = 5) {
  const radius = teeth / 2;
  const pitch = TAU / teeth;
  const f = (n) => n.toFixed(3);
  const at = (angle, r) => `${f(Math.cos(angle) * r)} ${f(Math.sin(angle) * r)}`;
  const outline = [];
  for (let i = 0; i < teeth; i += 1) {
    const a = i * pitch;
    outline.push(at(a - 0.3 * pitch, radius - 1.2), at(a - 0.16 * pitch, radius + 1), at(a + 0.16 * pitch, radius + 1), at(a + 0.3 * pitch, radius - 1.2));
  }
  let d = `M${outline.join('L')}Z`;
  const outer = radius - 2.6;
  const inner = Math.max(1.5, radius * 0.3);
  if (outer - inner > 0.8) {
    for (let i = 0; i < windows; i += 1) {
      const a0 = (i / windows) * TAU + 0.16;
      const a1 = ((i + 1) / windows) * TAU - 0.16;
      d += `M${at(a0, outer)}A${f(outer)} ${f(outer)} 0 0 1 ${at(a1, outer)}L${at(a1, inner)}A${f(inner)} ${f(inner)} 0 0 0 ${at(a0, inner)}Z`;
    }
  }
  d += `M0.7 0A0.7 0.7 0 1 0 -0.7 0A0.7 0.7 0 1 0 0.7 0Z`;
  return d;
}

const CSS = `
.ua-gl{position:absolute;inset:0;overflow:hidden;cursor:pointer;container-type:size;background:radial-gradient(circle at 50% 42%,color-mix(in srgb,var(--ua-c) 14%,var(--ua-bg)),var(--ua-bg) 62%)}
.ua-gl__scene{position:absolute;inset:0;perspective:150cqmin;perspective-origin:50% 44%}
.ua-gl__rig,.ua-gl__gear,.ua-gl__pop,.ua-gl__spin{position:absolute;left:0;top:0;width:0;height:0;transform-style:preserve-3d}
.ua-gl__rig{left:50%;top:43%}
.ua-gl__layer{position:absolute;overflow:visible;fill-rule:evenodd;stroke-linejoin:round}
.ua-gl__layer{fill:color-mix(in srgb,var(--c) 46%,#000)}
.ua-gl__layer--face{fill:color-mix(in srgb,var(--c) 90%,#000);stroke:color-mix(in srgb,var(--c) 60%,#fff);stroke-width:.16}
.ua-gl__meter{position:absolute;overflow:visible;fill:none}
.ua-gl__meter circle{stroke-width:.5;stroke-linecap:round}
.ua-gl__track{stroke:color-mix(in srgb,var(--ua-accent) 22%,transparent)}
.ua-gl__bar{stroke:var(--ua-accent)}
.ua-gl__text{position:absolute;left:0;right:0;bottom:6cqh;display:flex;justify-content:center;align-items:baseline;gap:2.4cqmin;
  font-family:var(--ua-display,system-ui,sans-serif);color:color-mix(in srgb,var(--ua-c) 55%,#fff)}
.ua-gl__value{font-size:8cqmin;font-weight:800;font-variant-numeric:tabular-nums;line-height:1;color:var(--ua-accent)}
.ua-gl__label{font-size:3.6cqmin;letter-spacing:.12em;opacity:.8}
`;

const unit = (n) => `calc(${n.toFixed(3)} * 1cqmin)`;

function buildGear(teeth, color, transform) {
  const size = (teeth / 2 + 1.6) * 2;
  const d = gearPath(teeth, teeth > 14 ? 5 : 4);
  const layers = Array.from({ length: LAYERS }, (_, i) =>
    s(
      'svg',
      {
        class: i === 0 || i === LAYERS - 1 ? 'ua-gl__layer ua-gl__layer--face' : 'ua-gl__layer',
        viewBox: `${-size / 2} ${-size / 2} ${size} ${size}`,
        'aria-hidden': 'true',
        style: {
          width: unit(size * MODULE),
          height: unit(size * MODULE),
          left: unit((-size * MODULE) / 2),
          top: unit((-size * MODULE) / 2),
          transform: `translateZ(${unit((i / (LAYERS - 1) - 0.5) * THICK * 2)})`,
        },
      },
      s('path', { d }),
    ),
  );
  const spin = h('div', { class: 'ua-gl__spin' }, layers);
  const pop = h('div', { class: 'ua-gl__pop' }, spin);
  const gear = h('div', { class: 'ua-gl__gear', style: { '--c': color, transform } }, pop);
  return { gear, pop, spin };
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-gl', { '--ua-bg': p.background, '--ua-c': p.color, '--ua-accent': p.accent });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();

  const m = MODULE;
  const rA = (TEETH.a / 2) * m;
  const rB = (TEETH.b / 2) * m;
  const rC = (TEETH.c / 2) * m;
  const rD = (TEETH.d / 2) * m;
  const rE = (TEETH.e / 2) * m;
  const n = [Math.cos(BETA), Math.sin(BETA)];
  const t = [-Math.sin(BETA), Math.cos(BETA)];
  const pb = [Math.cos(GAMMA) * (rA + rB), Math.sin(GAMMA) * (rA + rB)];
  const pe = [pb[0] + Math.cos(DELTA) * rB, pb[1] + Math.sin(DELTA) * rB];
  const move = (x, y, z) => `translate3d(${unit(x)},${unit(y)},${unit(z)})`;
  const mixed = `color-mix(in srgb, ${p.color} 55%, ${p.accent})`;

  const gears = {
    a: buildGear(TEETH.a, p.color, move(0, 0, 0)),
    b: buildGear(TEETH.b, p.accent, move(pb[0], pb[1], 0)),
    // C は A の縁に立つ。軸は A の半径方向。
    c: buildGear(TEETH.c, mixed, `${move(n[0] * rA, n[1] * rA, rC)} rotateZ(${BETA * DEG}deg) rotateY(90deg)`),
    // D は C の縁に、さらに直角にかみ合う。3 枚の軸がたがいに直交する。
    d: buildGear(TEETH.d, p.accent, `${move(n[0] * (rA + rD) - t[0] * rC, n[1] * (rA + rD) - t[1] * rC, rC)} rotateZ(${BETA * DEG}deg) rotateX(90deg)`),
    // E は B の縁の奥側に立つ。
    e: buildGear(TEETH.e, p.color, `${move(pe[0], pe[1], -rE)} rotateZ(${DELTA * DEG}deg) rotateY(90deg)`),
  };

  // 進み具合の輪。主歯車の手前に重ね、歯車と一緒には回さない。
  const meterRadius = TEETH.a / 2 - 1.9;
  const meterSize = (meterRadius + 1) * 2;
  const bar = s('circle', { class: 'ua-gl__bar', r: meterRadius, pathLength: 100, 'stroke-dasharray': '0 100', transform: 'rotate(-90)' });
  const meter = s(
    'svg',
    {
      class: 'ua-gl__meter',
      viewBox: `${-meterSize / 2} ${-meterSize / 2} ${meterSize} ${meterSize}`,
      'aria-hidden': 'true',
      style: {
        width: unit(meterSize * m),
        height: unit(meterSize * m),
        left: unit((-meterSize * m) / 2),
        top: unit((-meterSize * m) / 2),
        transform: `translateZ(${unit(THICK * 2.4)})`,
      },
    },
    s('circle', { class: 'ua-gl__track', r: meterRadius }),
    bar,
  );
  gears.a.gear.appendChild(meter);

  const rig = h('div', { class: 'ua-gl__rig' }, Object.values(gears).map((g) => g.gear));
  const value = h('span', { class: 'ua-gl__value', text: '0%' });
  const text = h('div', { class: 'ua-gl__text', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, value, h('span', { class: 'ua-gl__label', text: p.label }));
  root.append(h('div', { class: 'ua-gl__scene' }, rig), text);

  const state = { progress: p.auto ? (reduced ? 100 : 0) : p.progress };
  const pulse = { pop: 1 };
  // かみ合いから外れた歯車が、それぞれ勝手に回ったぶんの角度。歯 1 枚ぶんの整数倍で止めれば、またかみ合う。
  const free = Object.fromEntries(Object.keys(gears).map((key) => [key, { turn: 0 }]));
  const kick = { back: 0 };
  let slipping = false;
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  let angle = 0;
  let shown = state.progress;
  let seconds = 0;

  function render() {
    const angles = trainAngles(angle + kick.back);
    for (const key of Object.keys(gears)) gears[key].spin.style.transform = `rotate(${((angles[key] + free[key].turn) * DEG).toFixed(2)}deg)`;
    // 全体も 2 つの軸でゆっくり向きを変える。
    const rx = -30 + Math.sin(seconds * 0.5) * 11 - pointer.sy * 16;
    const ry = 30 + Math.sin(seconds * 0.33) * 22 + pointer.sx * 22;
    rig.style.transform = `scale(${pulse.pop.toFixed(3)}) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    const rounded = Math.round(state.progress);
    bar.setAttribute('stroke-dasharray', `${state.progress.toFixed(1)} 100`);
    value.textContent = `${rounded}%`;
    text.setAttribute('aria-valuenow', String(rounded));
  }
  render();

  function celebrate() {
    if (reduced) return;
    animate(pulse, { pop: [{ to: 1.12, duration: 160, ease: 'outQuad' }, { to: 1, duration: 900, ease: 'outElastic(1, .45)' }] });
  }

  // 押すと、逆回転して歯がきしみ、歯車が軸に沿って浮いてかみ合いが外れ、1 枚ずつ空回りしてから、順にはまり直す。
  function slip() {
    if (reduced) return;
    const keys = Object.keys(gears);
    const lift = Math.min(root.clientWidth, root.clientHeight) * 0.075;
    utils.remove([kick, pulse, ...keys.map((key) => free[key]), ...keys.map((key) => gears[key].pop)]);
    slipping = true;
    // 準備。全体がかみ合ったまま逆に回り、止まる。
    animate(kick, { back: [{ to: -0.55, duration: 260, ease: 'outQuad' }, { to: -0.5, duration: 120, ease: 'inOutQuad' }, { to: 0, duration: 1500, delay: 500, ease: 'inOutQuad' }] });
    keys.forEach((key, i) => {
      const pitch = TAU / TEETH[key];
      const dir = i % 2 ? -1 : 1;
      // いまの位置から、歯の枚数の整数倍だけ進んだ位置で止める。
      const now = Math.round(free[key].turn / pitch);
      const target = (now + dir * (TEETH[key] * 2 + 3 + i)) * pitch;
      const start = 300 + i * 90;
      // 山場。軸の方向へ浮いて外れ、勢いよく空回りする。小さい歯車ほど長く回る。
      animate(gears[key].pop, {
        translateZ: [
          { to: (i % 2 ? -1 : 1) * lift, duration: 260, ease: 'outBack(2.5)' },
          { to: (i % 2 ? -1 : 1) * lift, duration: 620 + i * 110 },
          // 余韻。1 枚ずつ落ちて、かちりとはまる。
          { to: 0, duration: 420, ease: 'outBounce' },
        ],
        scale: [{ to: 1.06, duration: 260 }, { to: 1.06, duration: 620 + i * 110 }, { to: 1, duration: 420, ease: 'outBounce' }],
        delay: start,
      });
      animate(free[key], { turn: target, duration: 1150 + i * 110, delay: start + 80, ease: 'outCubic' });
    });
    animate(pulse, {
      pop: [{ to: 0.95, duration: 260, ease: 'outQuad' }, { to: 1, duration: 300 }, { to: 1.07, duration: 140, delay: 1250, ease: 'outQuad' }, { to: 1, duration: 800, ease: 'outElastic(1, .45)' }],
      onComplete() {
        slipping = false;
      },
    });
  }

  let autoRun = null;
  function setProgress(next) {
    const number = Number(next);
    if (!Number.isFinite(number)) return;
    const target = Math.min(100, Math.max(0, number));
    autoRun?.pause();
    autoRun = null;
    utils.remove(state);
    if (reduced) {
      state.progress = target;
      shown = target;
      render();
      return;
    }
    animate(state, { progress: target, duration: 700, ease: 'outExpo' });
  }

  if (!reduced) {
    const loop = createTimer({
      onUpdate(self) {
        const dt = Math.min(0.05, self.deltaTime / 1000);
        seconds += dt;
        const k = 1 - Math.exp(-dt * 6);
        pointer.sx += (pointer.x - pointer.sx) * k;
        pointer.sy += (pointer.y - pointer.sy) * k;
        // 進み具合が増えたぶんだけ歯車を進める。戻ったときは逆回しにしない。
        const gained = Math.max(0, state.progress - shown);
        if (shown < 100 && state.progress >= 100) celebrate();
        shown = state.progress;
        // 外れている間は、待機中の回転を止める。
        angle += (slipping ? 0 : dt * p.speed * 0.7) + gained * 0.09;
        render();
      },
    });
    disposer.add(() => loop.pause());
    disposer.listen(root, 'pointermove', (event) => {
      const rect = root.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    });
    disposer.listen(root, 'pointerleave', () => {
      pointer.x = 0;
      pointer.y = 0;
    });
    disposer.listen(root, 'pointerdown', slip);
    if (p.preview) disposer.interval(slip, 4600);
    // 登場。歯車が 1 枚ずつ弾んで現れる。
    animate(Object.values(gears).map((g) => g.pop), { scale: [0, 1], duration: 900, ease: 'outBack(1.6)', delay: stagger(110) });
    if (p.auto) {
      autoRun = animate(state, {
        progress: [0, 100],
        duration: 5200,
        delay: 500,
        ease: 'inOutSine',
        loop: true,
        loopDelay: 1400,
      });
    }
  }

  return {
    setProgress,
    destroy() {
      disposer.run();
      autoRun?.pause();
      utils.remove([state, pulse, kick, ...Object.values(free)]);
      removeRoot(root);
    },
  };
}
