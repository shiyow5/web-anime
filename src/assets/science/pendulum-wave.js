import * as THREE from 'three';
import { animate, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { h, injectStyle } from '../../lib/dom.js';

export const meta = {
  id: 'pendulum-wave',
  title: '振り子の波',
  category: 'science',
  libs: ['three', 'animejs'],
  description:
    '長さの違う振り子が 1 列に並んで揺れます。隣どうしで、決まった時間に揺れる回数が 1 回ずつ違うように長さを決めてあるので、進む波、交互の列、ばらばらの並びが順に現れ、1 巡するとまた全部がそろいます。クリックすると、触った側へ、手前の振り子から順に 1 本ずつ持ち上げられていきます。全部が同じ高さにそろって一瞬止まり、いっせいに放されて、そろった状態から波が始まり直します。',
  params: {
    count: { type: 'range', label: '振り子の数', min: 7, max: 24, step: 1, default: 15 },
    cycle: { type: 'range', label: 'そろうまでの秒数', min: 15, max: 90, step: 1, default: 36 },
    amplitude: { type: 'range', label: '振れ幅（度）', min: 6, max: 28, step: 1, default: 19 },
    colorA: { type: 'color', label: '手前の玉の色', default: '#f26b4e' },
    colorB: { type: 'color', label: '奥の玉の色', default: '#f5cf6b' },
    frame: { type: 'color', label: '枠の色', default: '#b08d57' },
    background: { type: 'color', label: '背景色', default: '#14110f' },
  },
};

const PIVOT_Y = 1.55;
const LONGEST = 2.75;
const SPACING = 0.34;
const GRAVITY = 9.80665;

// i 番目の振り子は、1 巡のあいだに (base + i) 回揺れる。
// 周期は長さの平方根に比例するので、長さは回数の 2 乗に反比例する。
export function pendulumLength(index, base, cycleSeconds) {
  const period = cycleSeconds / (base + index);
  return GRAVITY * (period / (2 * Math.PI)) ** 2;
}

const CSS = `
.ua-pw{position:absolute;inset:0;pointer-events:none;container-type:size;overflow:hidden;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:var(--ua-ink)}
.ua-pw__info{position:absolute;left:3.2cqw;top:3.2cqw;font-size:clamp(8px,1.45cqw,13px);line-height:1.55;letter-spacing:.08em}
.ua-pw__info b{display:block;font-weight:500;font-size:1.25em}
.ua-pw__info span{display:block;opacity:.65}
.ua-pw__bar{position:absolute;left:3.2cqw;right:3.2cqw;bottom:3.4cqw;height:1px;background:color-mix(in srgb,currentColor 30%,transparent)}
.ua-pw__bar i{position:absolute;left:0;top:-1px;height:3px;width:100%;background:currentColor;transform-origin:0 50%}
.ua-pw__bar em{position:absolute;top:-4px;width:1px;height:9px;background:currentColor;opacity:.6}
`;

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 38, cameraZ: 9.5, background: p.background, preview: p.preview });
  const count = Math.round(p.count);
  // 揺れが 0.6〜1 Hz あたりに収まるように、いちばん長い振り子の回数を決める。
  const base = Math.max(8, Math.round(p.cycle * 0.62));
  const realLengths = Array.from({ length: count }, (_, i) => pendulumLength(i, base, p.cycle));
  const lengths = realLengths.map((length) => (length / realLengths[0]) * LONGEST);
  const depth = (count - 1) * SPACING;
  const amplitude = THREE.MathUtils.degToRad(p.amplitude);
  const state = { amp: stage.reduced ? 1 : 0 };
  // 持ち上げ具合（振り子ごと）と、放す向き。side が -1 なら左へ持ち上げる。
  const lifts = Array.from({ length: count }, () => ({ v: 0 }));
  let side = 1;
  let releaseTimer = 0;
  let clock = p.cycle * 0.07;

  stage.scene.add(new THREE.HemisphereLight(0xfff4e0, new THREE.Color(p.background), 1.3));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(3, 5, 4);
  stage.scene.add(key);

  const root = new THREE.Group();
  const rig = new THREE.Group();
  root.add(rig);
  stage.scene.add(root);

  // 枠。梁と、両端の柱。
  const frameMaterial = new THREE.MeshStandardMaterial({ color: p.frame, roughness: 0.5, metalness: 0.2 });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, depth + 0.7), frameMaterial);
  beam.position.y = PIVOT_Y;
  rig.add(beam);
  const floorY = PIVOT_Y - LONGEST - 0.42;
  for (const end of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, PIVOT_Y - floorY, 0.07), frameMaterial);
    post.position.set(0, (PIVOT_Y + floorY) / 2, end * (depth / 2 + 0.35));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.12), frameMaterial);
    foot.position.set(0, floorY, end * (depth / 2 + 0.35));
    rig.add(post, foot);
  }

  // 床の目盛り。振れ幅を読むための線を、振り子の列と平行に引く。
  const gridPoints = [];
  const half = depth / 2 + 0.35;
  for (let i = -4; i <= 4; i += 1) gridPoints.push(i * 0.25, floorY, -half, i * 0.25, floorY, half);
  for (let i = 0; i < count; i += 1) gridPoints.push(-1, floorY, i * SPACING - depth / 2, 1, floorY, i * SPACING - depth / 2);
  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3));
  rig.add(new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: p.frame, transparent: true, opacity: 0.22 })));

  const balls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.125, 24, 16), new THREE.MeshStandardMaterial({ roughness: 0.28, metalness: 0.1 }), count);
  const shadows = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.11, 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false }),
    count,
  );
  const colorA = new THREE.Color(p.colorA);
  const colorB = new THREE.Color(p.colorB);
  const tint = new THREE.Color();
  for (let i = 0; i < count; i += 1) {
    // 0 番（いちばん長い）を奥に置く。
    tint.lerpColors(colorB, colorA, count > 1 ? i / (count - 1) : 0);
    balls.setColorAt(i, tint);
    shadows.setColorAt(i, tint.clone().multiplyScalar(0.45));
  }
  balls.frustumCulled = false;
  shadows.frustumCulled = false;

  const stringGeometry = new THREE.BufferGeometry();
  stringGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3));
  const strings = new THREE.LineSegments(stringGeometry, new THREE.LineBasicMaterial({ color: '#e8e0d0', transparent: true, opacity: 0.55 }));
  strings.frustumCulled = false;
  // 玉をつなぐ線。上から見た波の形になる。
  const waveGeometry = new THREE.BufferGeometry();
  waveGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const wave = new THREE.Line(waveGeometry, new THREE.LineBasicMaterial({ color: p.colorB, transparent: true, opacity: 0.8 }));
  wave.frustumCulled = false;
  rig.add(balls, shadows, strings, wave);
  rig.rotation.y = 0.95;
  rig.position.y = 0.2;

  const hud = h('div', { class: 'ua-pw', style: { '--ua-ink': p.colorB } });
  const timeText = h('b');
  const fill = h('i');
  const bar = h('div', { class: 'ua-pw__bar' }, fill, [0.25, 0.5, 0.75, 1].map((at) => h('em', { style: { left: `${at * 100}%` } })));
  hud.append(
    h(
      'div',
      { class: 'ua-pw__info' },
      timeText,
      h('span', { text: `N = ${count} · ${base}–${base + count - 1} swings / cycle` }),
      p.preview ? null : h('span', { text: `L = ${realLengths.at(-1).toFixed(2)}–${realLengths[0].toFixed(2)} m` }),
    ),
    bar,
  );
  container.appendChild(hud);

  const matrix = new THREE.Matrix4();
  function place() {
    const stringArray = stringGeometry.attributes.position.array;
    const waveArray = waveGeometry.attributes.position.array;
    for (let i = 0; i < count; i += 1) {
      // 振れ幅が小さいときの近似（単振動）で角度を求める。
      const swing = side * amplitude * state.amp * Math.cos((2 * Math.PI * (base + i) * clock) / p.cycle);
      // 持ち上げているあいだは、揺れの角度から、放す高さの角度へ寄せる。
      const theta = swing + (side * amplitude - swing) * lifts[i].v;
      const z = depth / 2 - (count - 1 - i) * SPACING - (depth - (count - 1) * SPACING);
      const x = Math.sin(theta) * lengths[i];
      const y = PIVOT_Y - Math.cos(theta) * lengths[i];
      matrix.makeTranslation(x, y, z);
      balls.setMatrixAt(i, matrix);
      matrix.makeTranslation(x, floorY + 0.005, z);
      shadows.setMatrixAt(i, matrix);
      stringArray.set([0, PIVOT_Y, z, x, y, z], i * 6);
      waveArray.set([x, floorY + 0.01, z], i * 3);
    }
    balls.instanceMatrix.needsUpdate = true;
    shadows.instanceMatrix.needsUpdate = true;
    stringGeometry.attributes.position.needsUpdate = true;
    waveGeometry.attributes.position.needsUpdate = true;
  }

  stage.onResize(() => {
    const view = stage.viewport();
    root.scale.setScalar(Math.min(1.25, view.width / (depth * 0.85 + 3.4), view.height / 5.4));
  });

  let shown = '';
  stage.onFrame((time, dt) => {
    clock = (clock + dt) % p.cycle;
    place();
    root.rotation.x = 0.3 - stage.pointer.sy * 0.25;
    root.rotation.y = stage.pointer.sx * 0.5 + Math.sin(time * 0.15) * 0.06;
    const text = clock.toFixed(1);
    if (text !== shown) {
      shown = text;
      timeText.textContent = `t = ${text.padStart(4, '0')} s / ${p.cycle} s`;
      fill.style.transform = `scaleX(${(clock / p.cycle).toFixed(4)})`;
    }
  });

  function realign() {
    if (stage.reduced) return;
    clearTimeout(releaseTimer);
    utils.remove(lifts);
    utils.remove(state);
    state.amp = 1;
    // 途中まで持ち上がっているときは、向きを変えずに続きから持ち上げる。
    if (lifts.every((lift) => lift.v < 0.02) && Math.abs(stage.pointer.x) > 0.05) side = Math.sign(stage.pointer.x);
    const STEP = Math.min(60, 900 / count);
    animate(lifts, { v: 1, duration: 520, ease: 'outBack(1.8)', delay: stagger(STEP, { from: 'last' }) });
    // 全部がそろったら少し止めて、いっせいに放す。時刻 0 では全部が同じ高さにいるので、つながって動き出す。
    releaseTimer = setTimeout(() => {
      utils.remove(lifts);
      clock = 0;
      for (const lift of lifts) lift.v = 0;
    }, 520 + STEP * (count - 1) + 320);
  }
  const auto = p.preview && !stage.reduced ? setInterval(realign, 7000) : 0;
  container.addEventListener('click', realign);
  if (!stage.reduced) animate(state, { amp: [0, 1], duration: 1400, ease: 'outQuad' });

  return {
    realign,
    destroy() {
      clearInterval(auto);
      clearTimeout(releaseTimer);
      container.removeEventListener('click', realign);
      utils.remove(state);
      utils.remove(lifts);
      hud.remove();
      stage.destroy();
    },
  };
}
