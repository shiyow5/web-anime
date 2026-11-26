import * as THREE from 'three';
import { animate, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { circuitRing, glow, polygonOutline, ringBand, segmentRing, strokes, tickRing, wallBand } from '../../lib/holo.js';

export const meta = {
  id: 'gyro-stabilizer',
  title: 'ジャイロスコープ',
  category: 'scifi',
  libs: ['three', 'animejs'],
  description:
    '外・中・内の 3 重の輪が、たがいに直交する軸で支え合い、その中でこまが高速で回ります。ポインターを動かすと八角形の外枠だけが傾き、輪が逆向きに回って、こまは元の向きを保ちます。クリックで衝撃を与えると、輪が大きく振れてから揺れ戻ります。姿勢の制御や安定を伝える場面に使えます。',
  params: {
    frame: { type: 'color', label: '外枠の色', default: '#6fa8ff' },
    ring: { type: 'color', label: '輪の色', default: '#58f0d2' },
    rotor: { type: 'color', label: 'こまの色', default: '#ffb14a' },
    background: { type: 'color', label: '背景色', default: '#04070e' },
    spin: { type: 'range', label: 'こまの回転（毎秒の回転数）', min: 0.5, max: 8, step: 0.1, default: 2.6 },
    precession: { type: 'range', label: '首振りの速さ', min: 0, max: 2, step: 0.05, default: 0.55 },
    lean: { type: 'range', label: 'こまの傾き', min: 0, max: 0.6, step: 0.02, default: 0.3 },
  },
};

const TAU = Math.PI * 2;
const HALF = Math.PI / 2;

// 外枠の向きと、こまに保たせたい向きから、3 重の輪の角度を求める。
// frame と rotor は THREE.Quaternion。外の輪は Y 軸、中の輪は X 軸、内の輪は Z 軸で回る。
export function gimbalAngles(frame, rotor) {
  const local = frame.clone().invert().multiply(rotor);
  const euler = new THREE.Euler().setFromQuaternion(local, 'YXZ');
  return { outer: euler.y, middle: euler.x, inner: euler.z };
}

// 厚みのある輪。XY 平面に作る。
function buildRing(radius, width, color, pale, ticks) {
  const group = new THREE.Group();
  const inner = radius - width / 2;
  const outer = radius + width / 2;
  group.add(new THREE.Mesh(ringBand(inner, outer), glow(color, 0.07)));
  group.add(new THREE.Mesh(ringBand(outer - 0.014, outer), glow(color, 0.95)));
  group.add(new THREE.Mesh(ringBand(inner, inner + 0.012), glow(color, 0.85)));
  group.add(new THREE.Mesh(segmentRing(inner + 0.035, outer - 0.035, ticks / 2, { fill: 0.6 }), glow(color, 0.3)));
  group.add(new THREE.Mesh(tickRing(inner + 0.014, ticks, width * 0.2, 0.007, { inward: false, major: { every: 4, length: width * 0.42, width: 0.012 } }), glow(pale, 0.8)));
  for (const [r, opacity] of [
    [outer, 0.32],
    [inner, 0.2],
  ]) {
    const wall = new THREE.Mesh(wallBand(r, 0.09, 96), glow(color, opacity));
    wall.rotation.x = HALF;
    group.add(wall);
  }
  return group;
}

// 輪どうしをつなぐ軸受け。細い棒と、両端の玉。
function pivots(direction, from, to, color) {
  const up = new THREE.Vector3(0, 1, 0);
  return [1, -1].flatMap((sign) => {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, to - from, 8), glow(color, 0.9));
    rod.position.copy(direction).multiplyScalar(((from + to) / 2) * sign);
    rod.quaternion.setFromUnitVectors(up, direction);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color }));
    knob.position.copy(direction).multiplyScalar(to * sign);
    return [rod, knob];
  });
}

// こま。XZ 平面の円盤を 2 枚重ね、縁に壁を立てる。Y 軸で回す。
function buildRotor(color, pale) {
  const group = new THREE.Group();
  for (const y of [-0.07, 0.07]) {
    const disc = new THREE.Group();
    disc.rotation.x = -HALF;
    disc.position.y = y;
    // 区切りの幅をそろえないでおくと、速く回っても回っていることが分かる。
    disc.add(new THREE.Mesh(segmentRing(0.5, 0.86, 9, { shape: (i) => ({ fill: i % 3 === 0 ? 0.86 : 0.42 }) }), glow(color, 0.26)));
    disc.add(new THREE.Mesh(ringBand(0.9, 0.94), glow(color, 0.8)));
    disc.add(new THREE.Mesh(ringBand(0.2, 0.235), glow(pale, 0.9)));
    disc.add(new THREE.Mesh(tickRing(0.86, 36, 0.07, 0.01, { major: { every: 3 } }), glow(pale, 0.7)));
    const spokes = [0, 1, 2].map((i) => {
      const a = (i / 3) * Math.PI;
      return [Math.cos(a) * 0.5, Math.sin(a) * 0.5, -Math.cos(a) * 0.5, -Math.sin(a) * 0.5];
    });
    disc.add(new THREE.Mesh(strokes(spokes, 0.03), glow(color, 0.7)));
    group.add(disc);
  }
  group.add(new THREE.Mesh(wallBand(0.94, 0.14, 96), glow(color, 0.22)));
  group.add(new THREE.Mesh(wallBand(0.22, 0.3, 24), glow(pale, 0.4)));
  return group;
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 40, cameraZ: 8, background: p.background, preview: p.preview, bloom: { strength: p.preview ? 0.25 : 0.38, radius: 0.3, threshold: 0.25 } });
  const pale = new THREE.Color(p.ring).lerp(new THREE.Color('#ffffff'), 0.6);
  const framePale = new THREE.Color(p.frame).lerp(new THREE.Color('#ffffff'), 0.5);

  // 動かない目安の線。外枠がどれだけ傾いたかが、これとの差で分かる。
  const reference = new THREE.Group();
  reference.position.z = -0.6;
  reference.add(
    new THREE.Mesh(
      strokes(
        [
          [-3.5, 0, -2.75, 0],
          [2.75, 0, 3.5, 0],
          [0, 2.75, 0, 3.1],
          [0, -2.75, 0, -3.1],
        ],
        0.012,
      ),
      glow(p.frame, 0.5),
    ),
  );
  reference.add(new THREE.Mesh(tickRing(2.95, 48, 0.06, 0.008, { start: -0.5, sweep: 1, inward: false, major: { every: 4 } }), glow(p.frame, 0.4)));
  reference.add(new THREE.Mesh(tickRing(2.95, 48, 0.06, 0.008, { start: Math.PI - 0.5, sweep: 1, inward: false, major: { every: 4 } }), glow(p.frame, 0.4)));

  const system = new THREE.Group();
  system.add(reference);
  stage.scene.add(system);

  // 八角形の外枠。前後 2 枚の板を柱でつなぐ。
  const frame = new THREE.Group();
  for (const z of [-0.11, 0.11]) {
    const plate = new THREE.Group();
    plate.position.z = z;
    plate.add(new THREE.Mesh(polygonOutline(2.62, 8, 0.022, Math.PI / 8), glow(p.frame, 0.9)));
    plate.add(new THREE.Mesh(ringBand(2.34, 2.356), glow(p.frame, 0.8)));
    plate.add(new THREE.Mesh(circuitRing(2.4, 2.5, 44, 5), glow(p.frame, 0.28)));
    frame.add(plate);
  }
  frame.add(new THREE.Mesh(tickRing(2.34, 72, 0.05, 0.008, { major: { every: 6, length: 0.1, width: 0.014 } }), glow(framePale, 0.7)));
  for (let i = 0; i < 8; i += 1) {
    const a = Math.PI / 8 + (i / 8) * TAU;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), glow(framePale, 0.9));
    post.rotation.x = HALF;
    post.position.set(Math.cos(a) * 2.62, Math.sin(a) * 2.62, 0);
    frame.add(post);
  }
  const frameWall = new THREE.Mesh(wallBand(2.34, 0.22, 96), glow(p.frame, 0.14));
  frameWall.rotation.x = HALF;
  frame.add(frameWall);

  // 3 重の輪。外は XY 平面で Y 軸、中は XZ 平面で X 軸、内は YZ 平面で Z 軸が支点になる。
  const axisX = new THREE.Vector3(1, 0, 0);
  const axisY = new THREE.Vector3(0, 1, 0);
  const axisZ = new THREE.Vector3(0, 0, 1);
  const outer = new THREE.Group();
  const middle = new THREE.Group();
  const inner = new THREE.Group();
  const rotor = buildRotor(p.rotor, new THREE.Color(p.rotor).lerp(new THREE.Color('#ffffff'), 0.6));
  outer.add(buildRing(2.0, 0.15, p.ring, pale, 48));
  const middleRing = buildRing(1.65, 0.14, p.ring, pale, 40);
  middleRing.rotation.x = HALF;
  middle.add(middleRing);
  const innerRing = buildRing(1.3, 0.13, p.ring, pale, 32);
  innerRing.rotation.y = HALF;
  inner.add(innerRing);
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.46, 10), glow(pale, 0.65));
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), new THREE.MeshBasicMaterial({ color: p.rotor }));
  inner.add(axle, core, rotor);
  middle.add(inner, ...pivots(axisZ, 1.365, 1.58, framePale));
  outer.add(middle, ...pivots(axisX, 1.72, 1.925, framePale));
  frame.add(outer, ...pivots(axisY, 2.075, 2.34, framePale));
  system.add(frame);

  // 衝撃のときに広がる輪。
  const shock = new THREE.Mesh(ringBand(0.96, 1), glow(p.rotor, 0));
  system.add(shock);

  const enter = [0, 1, 2, 3, 4].map(() => ({ e: stage.reduced ? 1 : 0 }));
  const kick = { a: 0, b: 0, c: 0, flash: 0, wave: 1 };
  const baseBloom = stage.bloomPass?.strength ?? 0;
  let idle = 1;
  let wander = 0;
  let precess = 0.6;

  stage.onResize(() => {
    const view = stage.viewport();
    system.scale.setScalar(Math.min(1, view.width / 6.5, view.height / 6.5));
  });

  const frameEuler = new THREE.Euler();
  const frameQuat = new THREE.Quaternion();
  const rotorQuat = new THREE.Quaternion();
  const leanQuat = new THREE.Quaternion();
  stage.onFrame((time, dt) => {
    // ポインターが枠の外にあるときは、外枠を自動でゆっくり揺らす。
    idle += ((stage.pointer.inside ? 0.15 : 1) - idle) * (1 - Math.exp(-dt * 3));
    wander += dt;
    precess += dt * p.precession;
    frameEuler.set(
      -stage.pointer.sy * 0.75 + Math.sin(wander * 0.53) * 0.42 * idle,
      Math.sin(wander * 0.31) * 0.5 * idle,
      -stage.pointer.sx * 0.75 + Math.cos(wander * 0.41) * 0.36 * idle,
    );
    frameQuat.setFromEuler(frameEuler);
    frame.quaternion.copy(frameQuat);

    // こまは外枠に関係なく、首を振りながら自分の向きを保つ。
    rotorQuat.setFromAxisAngle(axisY, precess).multiply(leanQuat.setFromAxisAngle(axisZ, p.lean));
    const angles = gimbalAngles(frameQuat, rotorQuat);
    const [e0, e1, e2, e3, e4] = enter.map((state) => state.e);
    outer.rotation.y = angles.outer + kick.a + (1 - e1) * 2.4;
    middle.rotation.x = angles.middle + kick.b - (1 - e2) * 2.4;
    inner.rotation.z = angles.inner + kick.c + (1 - e3) * 2.4;
    rotor.rotation.y -= dt * p.spin * TAU * e4;

    frame.scale.setScalar(Math.max(0.001, e0));
    outer.scale.setScalar(Math.max(0.001, e1));
    middle.scale.setScalar(Math.max(0.001, e2));
    inner.scale.setScalar(Math.max(0.001, e3));
    rotor.scale.setScalar(Math.max(0.001, e4));
    core.scale.setScalar(1 + Math.sin(time * 5) * 0.08 + kick.flash * 0.8);

    shock.scale.setScalar(1 + kick.wave * 1.9);
    shock.material.opacity = (1 - kick.wave) * 0.9;
    if (stage.bloomPass) stage.bloomPass.strength = baseBloom + kick.flash * 0.5;
  });

  // 衝撃。3 本の輪を別々の向きへ弾き、ばねのように揺れ戻す。
  function impact(strength = 1) {
    if (stage.reduced) return;
    const s = Math.min(2, Math.max(0.1, Number(strength) || 1));
    const push = () => (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.4) * s;
    utils.remove(kick);
    animate(kick, { a: [push(), 0], b: [push() * 0.8, 0], c: [push(), 0], duration: 2400, ease: 'outElastic(1, .26)' });
    animate(kick, { flash: [1, 0], duration: 900, ease: 'outQuad' });
    animate(kick, { wave: [0, 1], duration: 900, ease: 'outExpo' });
  }
  const onPointerDown = () => impact(1);
  container.addEventListener('pointerdown', onPointerDown);

  let timer = 0;
  if (!stage.reduced) {
    animate(enter, { e: 1, duration: 1700, delay: stagger(200), ease: 'outExpo' });
    // 一覧の小さな枠では、触らなくても衝撃の動きが見えるようにする。
    if (p.preview) timer = setInterval(() => impact(0.8), 4200);
  }

  return {
    impact,
    destroy() {
      clearInterval(timer);
      container.removeEventListener('pointerdown', onPointerDown);
      utils.remove([kick, ...enter]);
      stage.destroy();
    },
  };
}
