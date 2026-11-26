import * as THREE from 'three';
import { animate, spring, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { createNoisePass } from '../../lib/postfx.js';
import { TAU, canvasTexture, circuitRing, glow, gridDisc, polygonOutline, ringBand, segmentRing, strokes, tickRing } from '../../lib/holo.js';

export const meta = {
  id: 'holo-chronograph',
  title: '副文字盤が浮かぶホログラム時計',
  category: 'clock',
  libs: ['three', 'animejs'],
  description:
    '低い視点から見上げる大きな文字盤の上に、大小 6 つの副文字盤が高さを変えて浮かびます。副文字盤はそれぞれ自分の軸で傾いて揺れ、外周では回路のような縁取りが逆向きに回り、軸の違う大きな輪が文字盤を横切ります。紫の針がいまの時刻を指し、ときどき映像が乱れます。クリックすると層が大きく開いて戻ります。',
  params: {
    line: { type: 'color', label: '線の色', default: '#e8f9ff' },
    accent: { type: 'color', label: '目盛りの色', default: '#2fe6ff' },
    hand: { type: 'color', label: '針の色', default: '#e23bff' },
    rim: { type: 'color', label: '外周の色', default: '#ff8fe0' },
    background: { type: 'color', label: '背景色', default: '#02030d' },
    noise: { type: 'range', label: '映像の乱れ', min: 0, max: 1, step: 0.05, default: 0.5 },
    glow: { type: 'range', label: '光のにじみ', min: 0, max: 1.2, step: 0.05, default: 0.55 },
  },
};

// 時刻を、針の角度に使う 0〜1 の割合へ直す。秒はミリ秒まで見て、なめらかに進める。
export function clockFractions(date) {
  const second = (date.getSeconds() + date.getMilliseconds() / 1000) / 60;
  const minute = (date.getMinutes() + second) / 60;
  const hour = ((date.getHours() % 12) + minute) / 12;
  const day = (date.getHours() + minute) / 24;
  return { second, minute, hour, day };
}

// 文字盤の上の角度。12 時の向きが +Y で、時計回りに進む。
const dialAngle = (fraction) => Math.PI / 2 - fraction * TAU;
const pad = (n) => String(n).padStart(2, '0');

// 副文字盤の配置。x, y は文字盤の上の位置、r は半径、z は浮かぶ高さ。
const SUBDIALS = [
  { key: 'hub', x: 0, y: 0, r: 0.74, z: 0.2, tilt: 0 },
  { key: 'second', x: -1.08, y: 1.12, r: 0.7, z: 0.42, tilt: 0.16 },
  { key: 'spin', x: 0.1, y: 1.3, r: 0.33, z: 0.62, tilt: 0.3 },
  { key: 'day', x: 1.12, y: 0.92, r: 0.5, z: 0.34, tilt: 0.2 },
  { key: 'gauge', x: -1.32, y: -1.2, r: 0.58, z: 0.52, tilt: 0.24 },
  { key: 'edge', x: 1.86, y: -0.7, r: 0.78, z: 0.7, tilt: 0.34 },
];

function timeTexture() {
  // 小さく描いてから拡大し、角ばった表示にする。
  const small = document.createElement('canvas');
  small.width = 34;
  small.height = 13;
  const texture = canvasTexture(272, 104, () => {});
  texture.magFilter = THREE.NearestFilter;
  function draw(text) {
    const sctx = small.getContext('2d');
    const ctx = texture.image.getContext('2d');
    if (!sctx || !ctx) return;
    sctx.clearRect(0, 0, small.width, small.height);
    sctx.fillStyle = '#fff';
    sctx.font = 'bold 12px ui-monospace, Menlo, Consolas, monospace';
    sctx.textAlign = 'center';
    sctx.textBaseline = 'middle';
    sctx.fillText(text, small.width / 2, small.height / 2 + 1);
    ctx.clearRect(0, 0, 272, 104);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, 272, 104);
    texture.needsUpdate = true;
  }
  return { texture, draw };
}

function labelTexture(lines) {
  return canvasTexture(256, 64, (ctx) => {
    ctx.fillStyle = '#fff';
    ctx.font = '600 17px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => ctx.fillText(line, 2, 6 + i * 24));
    ctx.fillRect(2, 54, 180, 2);
    ctx.fillRect(190, 54, 40, 2);
  });
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, {
    fov: 38,
    cameraZ: 7,
    background: p.background,
    preview: p.preview,
    maxDpr: p.preview ? 1 : 1.5,
    bloom: { strength: 0.04 + p.glow * 0.55, radius: 0.2, threshold: 0.4 },
  });
  const still = stage.reduced;
  const noise = createNoisePass({ scan: 0.1 + p.noise * 0.25, grain: p.noise * 0.11, shift: p.noise * 0.0018, auto: still || p.noise === 0 ? 0 : 3.2 });
  stage.addPass(noise.pass);

  const mat = {
    line: glow(p.line, 0.95),
    lineDim: glow(p.line, 0.4),
    accent: glow(p.accent, 0.85),
    accentDim: glow(p.accent, 0.28),
    rim: glow(p.rim, 0.7),
    hand: glow(p.hand, 0.96, { blending: THREE.NormalBlending }),
  };
  const mesh = (geometry, material, z = 0) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.z = z;
    return m;
  };

  const rig = new THREE.Group();
  const dial = new THREE.Group();
  rig.add(dial);
  stage.scene.add(rig);

  // 文字盤の床。方眼と、何重もの輪と目盛り。
  dial.add(mesh(new THREE.CircleGeometry(2.32, 96), glow(p.accent, 0.045)));
  dial.add(mesh(gridDisc(2.3, 15, 0.005), mat.accentDim, 0.005));
  dial.add(mesh(ringBand(2.3, 2.335), mat.line, 0.02));
  dial.add(mesh(ringBand(2.12, 2.128), mat.lineDim, 0.02));
  dial.add(mesh(tickRing(2.27, 120, 0.05, 0.007, { major: { every: 10, length: 0.15, width: 0.016 } }), mat.accent, 0.03));
  dial.add(mesh(segmentRing(1.86, 2.0, 12, { fill: 0.22 }), mat.accent, 0.03));
  dial.add(mesh(ringBand(1.52, 1.526), mat.accentDim, 0.02));
  dial.add(mesh(tickRing(1.5, 48, 0.04, 0.005), mat.accentDim, 0.02));

  // 外周の回路。2 本が逆向きに回る。
  const rimA = mesh(circuitRing(2.4, 2.66, 96, 11), mat.rim, 0.1);
  const rimB = mesh(circuitRing(2.7, 2.8, 64, 29, { density: 0.6 }), mat.line, 0.16);
  const rimC = mesh(segmentRing(2.84, 2.86, 5, { fill: 0.72 }), mat.lineDim, 0.04);
  dial.add(rimA, rimB, rimC);

  // 副文字盤。それぞれ支点を持ち、自分の軸で傾いて揺れる。
  const clock = timeTexture();
  const subs = SUBDIALS.map((def, index) => {
    const group = new THREE.Group();
    group.position.set(def.x, def.y, 0);
    const r = def.r;
    group.add(mesh(new THREE.CircleGeometry(r, 64), glow(p.background, 0.55, { blending: THREE.NormalBlending })));
    group.add(mesh(ringBand(r, r + 0.03), mat.line, 0.002));
    group.add(mesh(ringBand(r * 0.9, r * 0.9 + 0.012), mat.line, 0.002));
    const spinner = new THREE.Group();
    const hand = new THREE.Group();
    group.add(spinner, hand);
    if (def.key === 'hub') {
      spinner.add(mesh(segmentRing(r * 0.64, r * 0.72, 30, { fill: 0.45 }), mat.lineDim, 0.01));
      spinner.add(mesh(segmentRing(r * 0.76, r * 0.84, 8, { fill: 0.5 }), mat.accent, 0.01));
      // 時刻の数字は、針の軸に隠れないよう、中心より手前に置く。
      const digits = mesh(new THREE.PlaneGeometry(r * 0.78, r * 0.3), glow(p.line, 1, { map: clock.texture }), 0.03);
      digits.position.y = -r * 0.33;
      group.add(digits);
    } else {
      const count = def.key === 'second' ? 60 : def.key === 'day' ? 24 : 36;
      group.add(mesh(tickRing(r * 0.86, count, r * 0.1, 0.006, { major: { every: count / 12, length: r * 0.2, width: 0.012 } }), mat.accent, 0.004));
      group.add(mesh(gridDisc(r * 0.62, 5, 0.004), mat.accentDim, 0.001));
      spinner.add(mesh(segmentRing(r * 0.66, r * 0.72, def.key === 'gauge' ? 3 : 7, { fill: 0.6 }), mat.lineDim, 0.006));
      hand.add(mesh(strokes([[-r * 0.14, 0, r * 0.8, 0]], 0.02), def.key === 'edge' ? mat.rim : mat.accent, 0.012));
      hand.add(mesh(ringBand(0, r * 0.06), mat.line, 0.014));
    }
    dial.add(group);
    return { def, group, spinner, hand, lift: still ? 1 : 0, phase: index * 1.7 };
  });

  // 飾り。波形、六角形の印、小さな文字。
  const BARS = p.preview ? 24 : 40;
  const barGeometry = new THREE.PlaneGeometry(0.02, 1);
  const bars = Array.from({ length: BARS }, (_, i) => {
    const bar = mesh(barGeometry, i % 5 === 0 ? mat.line : mat.accent, 0.06);
    bar.position.set(0.5 + (i / (BARS - 1)) * 1.3, -1.42 + i * 0.012, 0.06);
    dial.add(bar);
    return bar;
  });
  const badge = new THREE.Group();
  badge.position.set(0.98, -0.34, 0.12);
  badge.add(mesh(polygonOutline(0.3, 6, 0.022), mat.line), mesh(polygonOutline(0.23, 6, 0.01), mat.line));
  badge.add(mesh(strokes([[0, 0, 0, 0.13], [0, 0, 0.1, -0.05]], 0.02), mat.accent, 0.01));
  dial.add(badge);
  const label = mesh(new THREE.PlaneGeometry(1.0, 0.25), glow(p.line, 0.85, { map: labelTexture(['CHRONO_SYNC', ':: LAYER 06 / OK']) }), 0.09);
  label.position.set(1.08, -0.9, 0.09);
  dial.add(label);

  // 針。文字盤の中心の軸から伸びる。根元の近くがいちばん太い、剣のような立体にする。
  function bladeGeometry(length, width) {
    const w = width;
    const x = length * 0.14;
    const base = [0, 0, 0];
    const tip = [length, 0, 0];
    const ring = [[x, w, 0], [x, 0, w], [x, -w, 0], [x, 0, -w]];
    const positions = [];
    for (let i = 0; i < 4; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % 4];
      positions.push(...base, ...b, ...a, ...tip, ...a, ...b);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geometry;
  }
  const hands = new THREE.Group();
  function makeHand(length, width, height) {
    const pivot = new THREE.Group();
    pivot.position.z = height;
    const body = new THREE.Mesh(bladeGeometry(length, width), mat.hand);
    body.renderOrder = 5;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: p.line, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    edges.renderOrder = 6;
    body.add(edges);
    pivot.add(body);
    hands.add(pivot);
    return { pivot, body };
  }
  const hourHand = makeHand(1.2, 0.13, 0.05);
  const minuteHand = makeHand(2.05, 0.1, 0.12);
  // 中心の軸。針の根元を留める。
  const cap = mesh(ringBand(0, 0.07), mat.line, 0.2);
  cap.renderOrder = 7;
  hands.add(mesh(ringBand(0.09, 0.14), mat.hand, 0.19), cap);
  dial.add(hands);

  // 文字盤を横切る大きな輪。文字盤とは別の軸で回る。
  const orbits = [
    { radius: 3.05, tilt: [1.0, 0.45], speed: 0.16, material: mat.line },
    { radius: 3.4, tilt: [-0.55, -0.95], speed: -0.11, material: mat.rim },
  ].map((def, index) => {
    const axis = new THREE.Group();
    axis.rotation.set(def.tilt[0], def.tilt[1], 0);
    const ring = new THREE.Group();
    ring.add(mesh(ringBand(def.radius, def.radius + 0.022), def.material));
    ring.add(mesh(segmentRing(def.radius + 0.06, def.radius + 0.1, 40, { fill: 0.5, shape: (i) => (i % 8 < 3 ? {} : null) }), mat.accent));
    // 輪に乗って回る小さな文字盤。
    const rider = new THREE.Group();
    rider.position.x = def.radius;
    rider.add(mesh(ringBand(0.2, 0.22), mat.line), mesh(tickRing(0.18, 12, 0.04, 0.008), mat.accent), mesh(strokes([[0, 0, 0.15, 0]], 0.014), mat.hand));
    ring.add(rider);
    axis.add(ring);
    rig.add(axis);
    return { ...def, axis, ring, rider, phase: index * 2.1, open: still ? 1 : 0 };
  });

  const state = { open: still ? 1 : 0, spread: 1 };
  stage.onResize(() => {
    const view = stage.viewport();
    rig.scale.setScalar(Math.min(1.4, view.width / 5.5, view.height / 3.7));
  });

  let shownMinute = -1;
  stage.onFrame((time, dt) => {
    const t = still ? 0 : time;
    const now = new Date();
    const f = clockFractions(now);
    if (now.getMinutes() !== shownMinute) {
      shownMinute = now.getMinutes();
      clock.draw(`${pad(now.getHours())}:${pad(shownMinute)}`);
    }
    noise.update(time, dt);

    // 全体の向き。低い視点から見上げ、ゆっくり首を振る。
    rig.rotation.x = -1.02 + stage.pointer.sy * 0.22 + Math.sin(t * 0.21) * 0.04;
    rig.rotation.y = stage.pointer.sx * 0.3 + Math.sin(t * 0.13) * 0.1;
    rig.rotation.z = -0.3 + Math.sin(t * 0.09) * 0.05;
    dial.scale.setScalar(0.7 + 0.3 * state.open);
    dial.rotation.z = (1 - state.open) * -1.2;

    rimA.rotation.z = t * 0.07;
    rimB.rotation.z = -t * 0.12;
    rimC.rotation.z = t * 0.03;

    for (const sub of subs) {
      const { def } = sub;
      sub.group.position.z = def.z * sub.lift * state.spread;
      sub.group.scale.setScalar(0.4 + 0.6 * Math.min(1, sub.lift));
      // 支点を中心に、2 本の軸で別々の周期で揺らす。
      sub.group.rotation.x = Math.sin(t * 0.6 + sub.phase) * def.tilt * sub.lift;
      sub.group.rotation.y = Math.cos(t * 0.47 + sub.phase * 1.3) * def.tilt * sub.lift;
      sub.spinner.rotation.z = t * (0.25 + (sub.phase % 1) * 0.4) * (sub.phase % 2 > 1 ? -1 : 1);
    }
    subs[1].hand.rotation.z = dialAngle(f.second);
    subs[2].hand.rotation.z = -t * 2.4;
    subs[3].hand.rotation.z = dialAngle(f.day);
    subs[4].hand.rotation.z = Math.PI * 0.75 + Math.sin(t * 0.8) * 0.9 + Math.sin(t * 5.1) * 0.05;
    subs[5].hand.rotation.z = t * 0.5;

    // 針は中央の副文字盤のすぐ上に置き、一緒に上下させる。
    hands.position.z = subs[0].group.position.z + 0.05;
    hands.scale.setScalar(0.4 + 0.6 * Math.min(1, subs[0].lift));
    minuteHand.pivot.rotation.z = dialAngle(f.minute);
    hourHand.pivot.rotation.z = dialAngle(f.hour);

    bars.forEach((bar, i) => {
      const wave = Math.sin(i * 0.55 + t * 3.1) * Math.sin(i * 0.17 + t * 1.3);
      bar.scale.y = 0.03 + Math.abs(wave) * 0.34 * (0.4 + 0.6 * Math.sin((i / (BARS - 1)) * Math.PI));
    });
    badge.rotation.z = Math.sin(t * 0.7) * 0.25;
    badge.position.z = 0.12 * state.spread + Math.sin(t * 0.9) * 0.02;

    for (const orbit of orbits) {
      orbit.axis.rotation.x = orbit.tilt[0] + Math.sin(t * 0.17 + orbit.phase) * 0.12;
      orbit.ring.rotation.z = t * orbit.speed + orbit.phase;
      orbit.ring.scale.setScalar(0.3 + 0.7 * orbit.open);
      orbit.rider.rotation.z = -t * 1.3;
      orbit.rider.rotation.y = t * 0.9;
    }
  });

  const bounce = spring({ stiffness: 110, damping: 9 });
  function pulse() {
    if (still) return;
    noise.burst(1.1);
    animate(state, { spread: [{ to: 2.1, duration: 320, ease: 'outExpo' }, { to: 1, ease: bounce }] });
  }
  container.addEventListener('pointerdown', pulse);

  let previewTimer = 0;
  if (!still) {
    // 登場。文字盤が回り込みながら広がり、副文字盤が順に浮き上がり、大きな輪が最後に収まる。
    noise.burst(1.3);
    animate(state, { open: 1, duration: 1800, ease: 'outExpo' });
    animate(subs, { lift: 1, ease: bounce, delay: stagger(130, { start: 350 }) });
    animate(orbits, { open: 1, duration: 1600, ease: 'outBack(1.6)', delay: stagger(260, { start: 900 }) });
    if (p.preview) previewTimer = setInterval(pulse, 5200);
  }

  return {
    pulse,
    destroy() {
      clearInterval(previewTimer);
      container.removeEventListener('pointerdown', pulse);
      utils.remove([state, ...subs, ...orbits]);
      stage.destroy();
    },
  };
}
