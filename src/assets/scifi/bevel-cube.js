import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { animate, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { glow, ringBand, segmentRing } from '../../lib/holo.js';

export const meta = {
  id: 'bevel-cube',
  title: 'かさ歯車の立方体',
  category: 'scifi',
  libs: ['three', 'animejs'],
  description:
    '立方体の 6 つの面に大きなかさ歯車があり、面と面の境目にある 12 個の小さなかさ歯車を介して、18 個すべてが連動して回ります。歯数は 20 と 10 で、小さいほうが 2 倍の速さで逆向きに回ります。立方体そのものも 2 つの軸でゆっくり回り、クリックすると、歯車が面の大歯車から順に軸に沿って外へ抜けてかみ合いが外れ、回転が止まります。そこから逆向きに勢いよく回り出し、歯車が 1 個ずつ弾みながら差し込まれて、行き過ぎた速さが元へ落ち着きます。機構や連携を表す場面に使えます。',
  params: {
    metal: { type: 'color', label: '面の歯車の色', default: '#9fb2cc' },
    idler: { type: 'color', label: '境目の歯車の色', default: '#e0863a' },
    light: { type: 'color', label: '光る線の色（正転）', default: '#52e6ff' },
    reverse: { type: 'color', label: '光る線の色（逆転）', default: '#ff5c8a' },
    background: { type: 'color', label: '背景色', default: '#070a12' },
    speed: { type: 'range', label: '歯車の速さ', min: 0, max: 3, step: 0.1, default: 1 },
    interval: { type: 'range', label: '自動で反転する間隔（秒、0 で止める）', min: 0, max: 12, step: 0.5, default: 6 },
  },
};

const FACE_TEETH = 20;
const IDLER_TEETH = 10;

// 面の歯車と境目の歯車の、円すいの半頂角を返す。
// 軸どうしは 45 度で交わるので、2 つの角の和は 45 度。歯数の比は sin の比に等しい。
export function coneAngles(faceTeeth = FACE_TEETH, idlerTeeth = IDLER_TEETH) {
  const ratio = faceTeeth / idlerTeeth;
  const face = Math.atan((ratio * Math.SQRT1_2) / (1 + ratio * Math.SQRT1_2));
  return { face, idler: Math.PI / 4 - face };
}

// かさ歯車どうしのかみ合い。どちらの軸も外向きに取ると、相手は歯数の比で逆向きに回る。
// phiDriver と phiDriven は、それぞれの歯車から見た接点の方位。
export function bevelMeshAngle(angle, driverTeeth, drivenTeeth, phiDriver, phiDriven) {
  return phiDriven + Math.PI / drivenTeeth - ((angle - phiDriver) * driverTeeth) / drivenTeeth;
}

const ANGLES = coneAngles();
const FACE_RADIUS = 0.8;
const CONE = FACE_RADIUS / Math.sin(ANGLES.face);
const MODULE = (FACE_RADIUS * 2) / FACE_TEETH;
const ADD = MODULE * 0.9;
const DED = MODULE * 1.1;
const INNER = 0.68;

// かさ歯車の歯。軸は +Z、円すいの頂点は原点。歯は頂点へ向かって細くなる。
function bevelTeeth(teeth, delta) {
  const pitch = (Math.PI * 2) / teeth;
  const sin = Math.sin(delta);
  const cos = Math.cos(delta);
  const point = (theta, u, scale) => {
    const r = (CONE * sin + u * cos) * scale;
    return [Math.cos(theta) * r, Math.sin(theta) * r, (CONE * cos - u * sin) * scale];
  };
  const profile = [];
  for (let i = 0; i < teeth; i += 1) {
    for (const [offset, u] of [[-0.3, -DED], [-0.16, ADD], [0.16, ADD], [0.3, -DED]]) profile.push([i * pitch + offset * pitch, u]);
  }
  const out = [];
  const quad = (a, b, c, d) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
  profile.forEach(([t0, u0], j) => {
    const [t1, u1] = profile[(j + 1) % profile.length];
    quad(point(t0, u0, 1), point(t1, u1, 1), point(t1, u1, INNER), point(t0, u0, INNER));
    if (u0 === -DED && u1 === -DED) return;
    for (const scale of [1, INNER]) quad(point(t0, u0, scale), point(t1, u1, scale), point(t1, -DED, scale), point(t0, -DED, scale));
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// 歯の下の胴と、外側の面と、軸受けのふた。
function bevelBody(delta) {
  const sin = Math.sin(delta);
  const cos = Math.cos(delta);
  const u = -DED - 0.004;
  const rOut = CONE * sin + u * cos;
  const zOut = CONE * cos - u * sin;
  const hub = Math.min(0.2, rOut * 0.42);
  const points = [
    [0.001, zOut * INNER],
    [rOut * INNER, zOut * INNER],
    [rOut, zOut],
    [rOut * 0.9, zOut + 0.06],
    [hub + 0.03, zOut + 0.06],
    [hub, zOut + 0.15],
    [0.001, zOut + 0.15],
  ].map(([r, z]) => new THREE.Vector2(r, z));
  return { geometry: new THREE.LatheGeometry(points, 48).rotateX(Math.PI / 2), rOut, back: zOut + 0.062 };
}

// 面を残して辺を落とした立方体。面に大きな歯車、落とした辺に小さな歯車が載る。
function coreGeometry(face, chamfer) {
  const edge = Math.SQRT2 * chamfer - face;
  const corner = chamfer / Math.SQRT2;
  const points = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        points.push(new THREE.Vector3(sx * corner, sy * corner, sz * corner));
        points.push(new THREE.Vector3(sx * face, sy * edge, sz * edge), new THREE.Vector3(sx * edge, sy * face, sz * edge), new THREE.Vector3(sx * edge, sy * edge, sz * face));
      }
    }
  }
  return new ConvexGeometry(points);
}

const Z = new THREE.Vector3(0, 0, 1);

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, {
    fov: 38,
    cameraZ: 9,
    background: p.background,
    preview: p.preview,
    maxDpr: p.preview ? 1 : 1.5,
    bloom: { strength: 0.45, radius: 0.3, threshold: 1.0 },
  });
  const pmrem = new THREE.PMREMGenerator(stage.renderer);
  const room = new RoomEnvironment();
  stage.scene.environment = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  room.dispose?.();
  stage.scene.environmentIntensity = 0.6;
  stage.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(4, 6, 7);
  const rim = new THREE.DirectionalLight(p.light, 0.7);
  rim.position.set(-6, -3, -4);
  stage.scene.add(key, rim);

  const rig = new THREE.Group();
  const cube = new THREE.Group();
  rig.add(cube);
  stage.scene.add(rig);

  const faceMaterial = new THREE.MeshStandardMaterial({ color: p.metal, metalness: 0.9, roughness: 0.46, side: THREE.DoubleSide });
  const idlerMaterial = new THREE.MeshStandardMaterial({ color: p.idler, metalness: 0.9, roughness: 0.44, side: THREE.DoubleSide });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: '#1a2030', metalness: 0.7, roughness: 0.5, flatShading: true });
  const lightColor = new THREE.Color(p.light);
  const reverseColor = new THREE.Color(p.reverse);
  const glowMaterial = glow(p.light, 0.95);
  const lineMaterial = new THREE.LineBasicMaterial({ color: p.light, transparent: true, opacity: 0.55 });

  // 芯になる立体と、全体を囲む立方体の枠。
  const core = new THREE.Mesh(coreGeometry(0.86, 0.98), darkMaterial);
  cube.add(core, new THREE.LineSegments(new THREE.EdgesGeometry(core.geometry), lineMaterial));
  const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(3.3, 3.3, 3.3)), lineMaterial);
  cube.add(frame);

  const shared = {
    face: { teeth: bevelTeeth(FACE_TEETH, ANGLES.face), body: bevelBody(ANGLES.face) },
    idler: { teeth: bevelTeeth(IDLER_TEETH, ANGLES.idler), body: bevelBody(ANGLES.idler) },
  };

  function buildGear(kind, axis) {
    const { teeth, body } = shared[kind];
    const material = kind === 'face' ? faceMaterial : idlerMaterial;
    const holder = new THREE.Group();
    holder.quaternion.setFromUnitVectors(Z, axis);
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(teeth, material), new THREE.Mesh(body.geometry, material));
    // 外側の面の光る線。回っていることが、これで分かる。
    const mark = new THREE.Group();
    mark.position.z = body.back;
    const r = body.rOut * 0.9;
    mark.add(new THREE.Mesh(segmentRing(r * 0.66, r * 0.78, kind === 'face' ? 5 : 3, { fill: 0.62 }), glowMaterial));
    mark.add(new THREE.Mesh(ringBand(r * 0.9, r * 0.93), glowMaterial));
    spin.add(mark);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 16).rotateX(Math.PI / 2), darkMaterial);
    shaft.position.z = CONE * Math.cos(kind === 'face' ? ANGLES.face : ANGLES.idler) * INNER - 0.2;
    spin.add(shaft);
    holder.add(spin);
    cube.add(holder);
    const lx = new THREE.Vector3(1, 0, 0).applyQuaternion(holder.quaternion);
    const ly = new THREE.Vector3(0, 1, 0).applyQuaternion(holder.quaternion);
    // この歯車から見た、相手の歯車との接点の方位。
    const azimuth = (other) => {
      const d = other.clone().addScaledVector(axis, -other.dot(axis));
      return Math.atan2(d.dot(ly), d.dot(lx));
    };
    return { kind, axis, holder, spin, azimuth, offset: 0, phiFace: 0 };
  }

  const faceAxes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((v) => new THREE.Vector3(...v));
  const faces = faceAxes.map((axis) => buildGear('face', axis));
  const idlers = [];
  for (let i = 0; i < faceAxes.length; i += 1) {
    for (let j = i + 1; j < faceAxes.length; j += 1) {
      if (faceAxes[i].dot(faceAxes[j]) !== 0) continue;
      const gear = buildGear('idler', faceAxes[i].clone().add(faceAxes[j]).normalize());
      // 境目の歯車は、隣り合う 2 つの面の歯車に同時にかみ合う。片方の面を基準に歯の位置を決める。
      gear.phiFace = gear.azimuth(faceAxes[i]);
      faces[i].offset = faces[i].azimuth(gear.axis);
      idlers.push(gear);
    }
  }
  const gears = [...faces, ...idlers];

  const state = { angle: 0, dir: 1 };
  const intros = gears.map(() => ({ v: stage.reduced ? 1 : 0 }));
  // クリックで歯車を軸に沿って引き抜く量。
  const pulls = gears.map(() => ({ v: 0 }));

  function place() {
    faces.forEach((gear) => {
      gear.spin.rotation.z = state.angle + gear.offset;
    });
    idlers.forEach((gear) => {
      gear.spin.rotation.z = bevelMeshAngle(state.angle, FACE_TEETH, IDLER_TEETH, 0, gear.phiFace);
    });
    gears.forEach((gear, i) => {
      const v = intros[i].v;
      gear.holder.position.copy(gear.axis).multiplyScalar((1 - v) * 2.4 + pulls[i].v * 0.34);
      gear.holder.scale.setScalar(Math.max(0.001, v));
    });
    const mix = Math.min(1, Math.max(0, (state.dir + 1) / 2));
    lineMaterial.color.copy(reverseColor).lerp(lightColor, mix);
    rim.color.copy(lineMaterial.color);
    // 光る線だけがにじむように、明るさを 1 より上へ持ち上げる。
    glowMaterial.color.copy(lineMaterial.color).multiplyScalar(1.8);
  }

  stage.onResize(() => {
    const view = stage.viewport();
    rig.scale.setScalar(Math.min(1, view.width / 6, view.height / 6));
  });
  cube.rotation.set(0.5, 0.65, 0);
  stage.onFrame((time, dt) => {
    state.angle += dt * p.speed * 0.8 * state.dir;
    // 立方体そのものも、2 つの軸でゆっくり回る。
    cube.rotation.x += dt * 0.19;
    cube.rotation.y += dt * 0.27;
    rig.rotation.x = -stage.pointer.sy * 0.35;
    rig.rotation.y = stage.pointer.sx * 0.45;
    place();
  });
  place();

  let target = 1;
  function reverse() {
    target = -target;
    if (stage.reduced) {
      state.dir = target;
      place();
      return;
    }
    // 引き抜いて止める → 逆向きに勢いよく回す → 1 個ずつ差し込み直して落ち着かせる。
    utils.remove(state);
    animate(state, {
      dir: [
        { to: 0, duration: 380, ease: 'outQuad' },
        { to: target * 3.2, duration: 420, ease: 'outQuad' },
        { to: target, duration: 1500, ease: 'outElastic(1, .5)' },
      ],
    });
    utils.remove(pulls);
    animate(pulls, {
      v: [{ to: 1, duration: 340, ease: 'outBack(2.5)' }, { to: 0, duration: 620, ease: 'outBounce', delay: 420 }],
      delay: stagger(28),
    });
  }
  container.addEventListener('pointerdown', reverse);

  let timer = 0;
  if (!stage.reduced) {
    // 登場。18 個の歯車が、それぞれの軸に沿って外から差し込まれる。
    animate(intros, { v: 1, duration: 1400, ease: 'outExpo', delay: stagger(55) });
    if (p.interval > 0) timer = setInterval(reverse, p.interval * 1000);
  }

  return {
    reverse,
    destroy() {
      clearInterval(timer);
      container.removeEventListener('pointerdown', reverse);
      utils.remove([state, ...intros, ...pulls]);
      stage.destroy();
    },
  };
}
