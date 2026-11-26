import * as THREE from 'three';
import { animate, spring, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { TAU, circuitRing, flatBand, glow, glyphStrip, gridDisc, polygonOutline, ringBand, segmentRing, strokes, tickRing } from '../../lib/holo.js';
import { createNoisePass } from '../../lib/postfx.js';

export const meta = {
  id: 'target-reticle',
  title: '立体の照準',
  category: 'scifi',
  libs: ['three', 'animejs'],
  description:
    '奥行き方向に並んだ輪と括弧が、手前から奥へ別々の向きに回りながら、漂う対象を追います。ポインターを動かすと、手前の輪ほど速く、奥の輪ほど遅れてついてくるので、重なりがずれて立体に見えます。対象に重なると輪が締まって固定され、クリックでも捕捉と解除を切り替えられます。',
  params: {
    color: { type: 'color', label: '線の色', default: '#d2f3ff' },
    accent: { type: 'color', label: '差し色', default: '#8f7dff' },
    lock: { type: 'color', label: '捕捉したときの色', default: '#ff6fb1' },
    background: { type: 'color', label: '背景色', default: '#04060d' },
    speed: { type: 'range', label: '回る速さ', min: 0, max: 3, step: 0.1, default: 1 },
    hold: { type: 'range', label: '固定している時間（秒）', min: 0.5, max: 6, step: 0.1, default: 2.4 },
    noise: { type: 'range', label: 'ノイズの強さ', min: 0, max: 1, step: 0.05, default: 0.4 },
  },
};

const QUARTER = Math.PI / 2;
const TARGET_Z = -3.4;
// 層ごとの奥行き、回る向きと速さ、揺れる軸の向き。
const LAYERS = [
  { z: 1.6, spin: 1.1, wobble: [0.3, 0.0] },
  { z: 0.9, spin: -0.7, wobble: [0.0, 0.34] },
  { z: 0.2, spin: 0.45, wobble: [0.26, 0.2] },
  { z: -0.6, spin: -0.3, wobble: [-0.2, 0.3] },
  { z: -1.5, spin: 0.22, wobble: [0.3, -0.22] },
  { z: -2.5, spin: -0.15, wobble: [-0.26, -0.26] },
];

// 四隅の角括弧。half は中心から角までの距離、arm は腕の長さ。
function cornerBrackets(half, arm, width) {
  const segments = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      segments.push([sx * half, sy * half, sx * (half - arm), sy * half], [sx * half, sy * half, sx * half, sy * (half - arm)]);
    }
  }
  return strokes(segments, width);
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 42, cameraZ: 9, background: p.background, preview: p.preview, bloom: { strength: 0.4, radius: 0.25, threshold: 0.3 } });
  const useNoise = p.noise > 0;
  const noise = createNoisePass({ scan: 0.4 * p.noise, grain: 0.14 * p.noise, shift: 0.0022 * p.noise, auto: useNoise && !stage.reduced ? 6 : 0 });
  stage.addPass(noise.pass);

  const accentColor = new THREE.Color(p.accent);
  const lockColor = new THREE.Color(p.lock);
  const accentMats = [];
  const line = (geometry, opacity = 1, extra) => new THREE.Mesh(geometry, glow(p.color, opacity, extra));
  const accent = (geometry, opacity = 1) => {
    const mesh = new THREE.Mesh(geometry, glow(p.accent, opacity));
    accentMats.push(mesh.material);
    return mesh;
  };
  const label = (seed, width) => {
    const mesh = line(new THREE.PlaneGeometry(width, width * 0.19), 0.7, { map: glyphStrip({ count: 8, seed, rails: false }) });
    return mesh;
  };

  // 奥行きの真ん中を軸にして全体を回すために、中身を手前へずらして入れる。
  const pivot = new THREE.Group();
  pivot.position.z = -1.6;
  const rig = new THREE.Group();
  rig.position.z = 1.6;
  pivot.add(rig);
  stage.scene.add(pivot);

  // 層ごとの絵柄。手前は小さな十字、奥へ行くほど大きな輪になる。
  const builders = [
    (g) => g.add(line(ringBand(0.5, 0.52), 0.85), line(strokes([[-0.75, 0, -0.2, 0], [0.2, 0, 0.75, 0], [0, -0.75, 0, -0.2], [0, 0.2, 0, 0.75]], 0.016), 0.8), accent(polygonOutline(0.12, 6, 0.016), 0.9)),
    (g) => {
      for (let i = 0; i < 4; i += 1) g.add(line(ringBand(0.92, 0.955, { start: i * QUARTER + 0.25, sweep: QUARTER - 0.5 }), 0.85));
      g.add(accent(tickRing(0.86, 48, 0.06, 0.014, { major: { every: 4 } }), 0.75));
    },
    (g) => {
      g.add(line(cornerBrackets(1.02, 0.36, 0.024), 0.85), accent(segmentRing(1.28, 1.34, 12, { fill: 0.5 }), 0.8));
      const text = label(21, 0.8);
      text.position.set(0.62, -1.2, 0);
      g.add(text);
    },
    (g) => {
      g.add(line(ringBand(1.63, 1.655), 0.8), accent(circuitRing(1.7, 1.86, 44, 9), 0.75));
      for (let i = 0; i < 3; i += 1) {
        const angle = (i / 3) * TAU + 0.5;
        const mark = new THREE.Group();
        mark.position.set(Math.cos(angle) * 1.64, Math.sin(angle) * 1.64, 0);
        mark.add(line(ringBand(0.1, 0.13), 0.9), line(polygonOutline(0.06, 6, 0.012), 0.8));
        g.add(mark);
      }
    },
    (g) => {
      g.add(line(tickRing(2.0, 90, 0.07, 0.014, { major: { every: 5 } }), 0.6));
      for (const start of [-0.85, Math.PI - 0.85]) g.add(accent(ringBand(2.07, 2.12, { start, sweep: 1.7 }), 0.85));
      const text = label(37, 0.9);
      text.position.set(-1.5, 1.75, 0);
      g.add(text);
    },
    (g) => {
      const map = glyphStrip({ count: 32, seed: 14 });
      map.repeat.x = 4;
      g.add(line(flatBand(2.2, 2.36), 0.6, { map }), line(ringBand(2.4, 2.42), 0.6), line(ringBand(2.14, 2.155), 0.4));
    },
  ];
  const layers = LAYERS.map((spec, index) => {
    const holder = new THREE.Group();
    const tilt = new THREE.Group();
    const spinner = new THREE.Group();
    builders[index](spinner);
    tilt.add(spinner);
    holder.add(tilt);
    rig.add(holder);
    return { ...spec, index, holder, tilt, spinner, x: 0, y: 0, phase: index * 0.7, t: stage.reduced ? 1 : 0 };
  });

  // 対象。線の立体を、軸の違う 2 本の輪が囲んで回る。
  const target = new THREE.Group();
  const body = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.3, 0)), new THREE.LineBasicMaterial({ color: p.color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  const gimbalA = new THREE.Group();
  gimbalA.add(accent(ringBand(0.5, 0.54), 0.9), line(tickRing(0.48, 16, 0.06, 0.014), 0.6));
  const gimbalB = new THREE.Group();
  gimbalB.add(line(ringBand(0.66, 0.69), 0.8), accent(segmentRing(0.72, 0.77, 6, { fill: 0.5 }), 0.7));
  const seal = accent(polygonOutline(1.0, 6, 0.03, Math.PI / 6), 0);
  target.add(body, gimbalA, gimbalB, seal);
  target.position.z = TARGET_Z;
  rig.add(target);

  const backdrop = line(gridDisc(3.8, 10, 0.012), 0.07);
  backdrop.position.z = -4.8;
  rig.add(backdrop, (() => { const ring = line(circuitRing(3.82, 3.92, 72, 5, { density: 0.6 }), 0.2); ring.position.z = -4.8; return ring; })());

  const state = { lock: stage.reduced ? 1 : 0 };
  const spot = { x: 0.9, y: 0.35 };
  let locked = stage.reduced;
  let forced = false;
  let near = 0;
  let seekFrom = 0;
  let releaseTimer = 0;
  let fit = 1;
  stage.onResize(() => {
    const view = stage.viewport();
    fit = Math.min(1, view.width / 8.4, view.height / 6.4);
    pivot.scale.setScalar(fit);
  });

  function release() {
    if (!locked || stage.reduced) return;
    locked = false;
    forced = false;
    near = 0;
    clearTimeout(releaseTimer);
    utils.remove(state);
    animate(state, { lock: 0, duration: 500, ease: 'outQuad' });
    // 対象は別の場所へ逃げる。
    utils.remove(spot);
    animate(spot, { x: utils.random(-1.4, 1.4, 2), y: utils.random(-0.7, 0.7, 2), duration: 1100, ease: 'inOutQuad' });
  }
  function lock() {
    if (locked || stage.reduced) return;
    locked = true;
    utils.remove(state);
    animate(state, { lock: 1, ease: spring({ stiffness: 170, damping: 10 }) });
    if (useNoise) noise.burst(0.7);
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(release, p.hold * 1000);
  }

  stage.onFrame((time, dt) => {
    noise.update(time, dt);
    const lockAmount = state.lock;
    const loose = Math.max(0, 1 - lockAmount);
    const tx = spot.x + Math.sin(time * 0.6) * 0.22;
    const ty = spot.y + Math.cos(time * 0.47) * 0.16;
    target.position.set(tx, ty, TARGET_Z);
    body.rotation.set(time * 0.7, time * 0.9, 0);
    gimbalA.rotation.x = time * 1.3 * p.speed;
    gimbalB.rotation.y = -time * 0.9 * p.speed;
    seal.material.opacity = Math.min(1, Math.max(0, lockAmount)) * 0.9;
    seal.scale.setScalar(1.5 - 0.5 * lockAmount);
    seal.rotation.z = time * 0.4;

    // 狙う場所。固定中は対象、ポインターが枠にあればその位置、無ければ自動で対象へ寄っていく。
    let aimX = tx;
    let aimY = ty;
    if (!locked && !forced) {
      if (stage.pointer.inside && !p.preview) {
        const view = stage.viewport();
        aimX = (stage.pointer.x * view.width * 0.42) / fit;
        aimY = (stage.pointer.y * view.height * 0.42) / fit;
      } else {
        const gap = Math.max(0, 1.7 - (time - seekFrom) * 0.6);
        aimX += Math.cos(time * 1.9) * gap;
        aimY += Math.sin(time * 1.9) * gap * 0.7;
      }
    }
    const lead = layers[0];
    if (!locked) {
      near = Math.hypot(lead.x - tx, lead.y - ty) < 0.3 ? near + dt : 0;
      if (near > 0.45 || (forced && near > 0.05)) lock();
      if (!locked && near === 0 && time - seekFrom > 6) seekFrom = time;
    } else seekFrom = time;

    for (const layer of layers) {
      // 手前の層ほど速く追う。奥の層は遅れてついてくるので、重なりがずれる。
      const follow = locked || forced ? 12 : 8.5 - layer.index * 1.25;
      const k = 1 - Math.exp(-dt * follow);
      layer.x += (aimX - layer.x) * k;
      layer.y += (aimY - layer.y) * k;
      layer.phase += dt * layer.spin * p.speed * loose;
      const rest = 1 - layer.t;
      const snapped = Math.round(layer.phase / QUARTER) * QUARTER;
      layer.spinner.rotation.z = layer.phase + (snapped - layer.phase) * Math.min(1, lockAmount) + rest * (layer.index % 2 ? 2.4 : -2.4);
      const sway = Math.sin(time * (0.7 + layer.index * 0.13) + layer.index) * loose;
      layer.tilt.rotation.set(layer.wobble[0] * sway + rest * layer.wobble[1] * 5, layer.wobble[1] * sway + rest * layer.wobble[0] * 5, 0);
      layer.holder.position.set(layer.x, layer.y, layer.z * (1 - 0.45 * lockAmount) + (TARGET_Z + 1.4) * 0.3 * lockAmount + rest * 7);
      layer.holder.scale.setScalar(Math.max(0.001, layer.t) * (1 - 0.3 * lockAmount));
      layer.holder.visible = layer.t > 0.001;
    }
    for (const material of accentMats) material.color.copy(accentColor).lerp(lockColor, Math.min(1, Math.max(0, lockAmount)));
    // 全体を斜めから見る。止めていても奥行きが分かるように、ゆっくり向きを変える。
    pivot.rotation.set(0.14 + Math.sin(time * 0.31) * 0.08 - stage.pointer.sy * 0.12, -0.42 + Math.sin(time * 0.22) * 0.2 + stage.pointer.sx * 0.16, 0);
  });

  function onPointerDown() {
    if (stage.reduced) return;
    if (locked) release();
    else forced = true;
  }
  container.addEventListener('pointerdown', onPointerDown);

  if (!stage.reduced) animate(layers, { t: 1, duration: 1300, delay: stagger(150, { start: 100 }), ease: 'outExpo' });
  else for (const layer of layers) Object.assign(layer, { x: spot.x, y: spot.y });

  return {
    lock() {
      if (!locked && !stage.reduced) forced = true;
    },
    release,
    destroy() {
      clearTimeout(releaseTimer);
      container.removeEventListener('pointerdown', onPointerDown);
      utils.remove(state);
      utils.remove(spot);
      utils.remove(layers);
      stage.destroy();
    },
  };
}
