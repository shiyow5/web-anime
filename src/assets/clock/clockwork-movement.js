import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { animate, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { canvasTexture } from '../../lib/holo.js';

export const meta = {
  id: 'clockwork-movement',
  title: '機械式時計の中身',
  category: 'clock',
  libs: ['three', 'animejs'],
  description:
    '真鍮の歯車列が層をなして並ぶ、機械式時計の中身です。香箱から 2 番・3 番・4 番車へ歯数の比どおりに力が伝わり、4 番車の上向きの歯が、横倒しの軸のがんぎ車を回します。てんぷが 1 秒に 5 回刻み、秒・分・時の針は実際の時刻を指します。全体はゆっくり向きを変え、ポインターで傾き、クリックするとりゅうずが回ってぜんまいを巻きます。',
  params: {
    brass: { type: 'color', label: '真鍮の色', default: '#c8922f' },
    steel: { type: 'color', label: '鋼の色', default: '#cfd5dd' },
    jewel: { type: 'color', label: '石の色', default: '#e0214f' },
    background: { type: 'color', label: '背景色', default: '#0d0f15' },
    tilt: { type: 'range', label: '見下ろす角度（度）', min: 20, max: 70, step: 1, default: 46 },
    turn: { type: 'range', label: '向きを変える速さ', min: 0, max: 3, step: 0.1, default: 1 },
  },
};

const TAU = Math.PI * 2;
const BEATS = 5; // 1 秒あたりの刻みの数（毎時 18000 振動）

// かみ合う相手の角度。driver が角度 angle のとき、方向 phi にある相手の歯車の角度。
export function meshAngle(angle, driverTeeth, drivenTeeth, phi) {
  return phi + Math.PI + Math.PI / drivenTeeth - ((angle - phi) * driverTeeth) / drivenTeeth;
}

// 0 時からの秒数を受け取り、刻みを反映した針の角度（時計回りが負）と、てんぷ・アンクルの振れを返す。
export function movementState(seconds) {
  const beat = seconds * BEATS;
  const count = Math.floor(beat);
  const part = Math.min(1, (beat - count) / 0.3);
  const eased = 1 - (1 - part) ** 3;
  const ticked = (count + eased) / BEATS;
  return {
    ticked,
    second: (-ticked / 60) * TAU,
    minute: (-ticked / 3600) * TAU,
    hour: (-ticked / 43200) * TAU,
    balance: Math.sin(seconds * BEATS * Math.PI),
    pallet: (count % 2 ? 1 : -1) * (eased * 2 - 1),
  };
}

function gearShape(teeth, module, windows = 0) {
  const radius = (teeth * module) / 2;
  const pitch = TAU / teeth;
  const root = radius - module * 1.2;
  const tip = radius + module;
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth; i += 1) {
    const a = i * pitch;
    [[-0.3, root], [-0.16, tip], [0.16, tip], [0.3, root]].forEach(([offset, r], j) => {
      const x = Math.cos(a + offset * pitch) * r;
      const y = Math.sin(a + offset * pitch) * r;
      if (i === 0 && j === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
  }
  shape.closePath();
  if (windows > 0) {
    const outer = root - Math.max(0.03, radius * 0.1);
    const inner = Math.max(0.05, radius * 0.24);
    for (let i = 0; i < windows; i += 1) {
      const a0 = (i / windows) * TAU + 0.13;
      const a1 = ((i + 1) / windows) * TAU - 0.13;
      const hole = new THREE.Path();
      hole.absarc(0, 0, outer, a0, a1, false);
      hole.absarc(0, 0, inner, a1, a0, true);
      hole.closePath();
      shape.holes.push(hole);
    }
  }
  return shape;
}

// がんぎ車。片側に傾いた、のこぎりのような歯。
function escapeShape(teeth, radius) {
  const pitch = TAU / teeth;
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth; i += 1) {
    const a = i * pitch;
    [[0, radius * 0.78], [0.72, radius], [0.8, radius * 0.78]].forEach(([offset, r], j) => {
      const x = Math.cos(a + offset * pitch) * r;
      const y = Math.sin(a + offset * pitch) * r;
      if (i === 0 && j === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
  }
  shape.closePath();
  for (let i = 0; i < 4; i += 1) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, radius * 0.66, (i / 4) * TAU + 0.2, ((i + 1) / 4) * TAU - 0.2, false);
    hole.absarc(0, 0, radius * 0.26, ((i + 1) / 4) * TAU - 0.2, (i / 4) * TAU + 0.2, true);
    hole.closePath();
    shape.holes.push(hole);
  }
  return shape;
}

function slab(shape, depth) {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

// 軸を +Z に向けた円柱。
const rod = (radius, height, segments = 20) => new THREE.CylinderGeometry(radius, radius, height, segments).rotateX(Math.PI / 2);

function handShape(length, width) {
  const shape = new THREE.Shape();
  shape.moveTo(-width, -length * 0.18);
  shape.lineTo(width, -length * 0.18);
  shape.lineTo(width * 1.6, length * 0.55);
  shape.lineTo(0, length);
  shape.lineTo(-width * 1.6, length * 0.55);
  shape.closePath();
  return shape;
}

const polar = (angle, distance) => [Math.cos(angle) * distance, Math.sin(angle) * distance];
const DEG = Math.PI / 180;

// 歯数とモジュール。かみ合う組は同じモジュールにする。
const T = { barrel: 72, centerPinion: 12, center: 64, thirdPinion: 8, third: 60, fourthPinion: 8, contrate: 48, escapePinion: 8, escape: 25, ratchet: 24, winder: 10 };
const M = { barrel: 0.026, center: 0.022, third: 0.02, ratchet: 0.03 };
const CONTRATE_RADIUS = 0.5;
const CONTRATE_MODULE = (CONTRATE_RADIUS * 2) / T.contrate;
const ESCAPE_PINION_RADIUS = (T.escapePinion * CONTRATE_MODULE) / 2;
const RATCHET_RADIUS = (T.ratchet * M.ratchet) / 2;
const WINDER_RADIUS = (T.winder * M.ratchet) / 2;

// 軸の位置。2 番車（分の車）を原点に置く。
const PHI = { barrel: 235 * DEG, third: 60 * DEG, fourth: -40 * DEG, escape: -70 * DEG };
const POS = { center: [0, 0] };
POS.barrel = polar(PHI.barrel, ((T.barrel + T.centerPinion) * M.barrel) / 2);
POS.third = polar(PHI.third, ((T.center + T.thirdPinion) * M.center) / 2);
POS.fourth = polar(PHI.fourth, ((T.third + T.fourthPinion) * M.third) / 2).map((v, i) => v + POS.third[i]);
POS.escape = polar(PHI.escape, 0.84).map((v, i) => v + POS.fourth[i]);
const SHIFT = [0, 0.25];

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 35, cameraZ: 8, background: p.background, preview: p.preview, maxDpr: p.preview ? 1.25 : 2 });
  stage.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  stage.renderer.toneMappingExposure = 0.95;
  const pmrem = new THREE.PMREMGenerator(stage.renderer);
  const room = new RoomEnvironment();
  stage.scene.environment = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  room.dispose?.();
  stage.scene.environmentIntensity = 0.7;
  const key = new THREE.DirectionalLight(0xfff1d6, 1.7);
  key.position.set(3, 5, 6);
  const fill = new THREE.PointLight(0xffb060, 14, 12);
  fill.position.set(-3, -2, 3);
  stage.scene.add(key, fill);

  const metal = (color, roughness = 0.3) => new THREE.MeshStandardMaterial({ color, metalness: 1, roughness });
  const brass = metal(p.brass, 0.32);
  const darkBrass = metal(new THREE.Color(p.brass).multiplyScalar(0.62), 0.45);
  const steel = metal(p.steel, 0.22);
  const blued = metal('#2f55b8', 0.25);
  const jewel = new THREE.MeshStandardMaterial({ color: p.jewel, emissive: new THREE.Color(p.jewel).multiplyScalar(0.35), metalness: 0.1, roughness: 0.08 });

  const rig = new THREE.Group();
  const movement = new THREE.Group();
  const train = new THREE.Group();
  train.position.set(SHIFT[0], SHIFT[1], 0);
  movement.add(train);
  rig.add(movement);
  stage.scene.add(rig);

  // 地板。円を重ねた磨き模様を描く。
  const plateTexture = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#2c2f38';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < 14; y += 1) {
      for (let x = 0; x < 14; x += 1) {
        const cx = x * 40 + (y % 2) * 20;
        const cy = y * 38;
        const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 30);
        g.addColorStop(0, 'rgba(150,156,170,0.5)');
        g.addColorStop(0.7, 'rgba(80,85,98,0.25)');
        g.addColorStop(1, 'rgba(20,22,28,0.55)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, 30, 0, TAU);
        ctx.fill();
      }
    }
  });
  const plate = new THREE.Group();
  const plateTop = new THREE.Mesh(new THREE.CircleGeometry(1.86, 96), new THREE.MeshStandardMaterial({ map: plateTexture, metalness: 0.9, roughness: 0.42 }));
  plateTop.position.z = -0.001;
  const plateBody = new THREE.Mesh(rod(1.86, 0.12, 96), metal('#3a3d46', 0.5));
  plateBody.position.z = -0.062;
  const plateRim = new THREE.Mesh(new THREE.TorusGeometry(1.88, 0.045, 12, 120), brass);
  plateRim.position.z = -0.03;
  plate.add(plateTop, plateBody, plateRim);
  for (let i = 0; i < 6; i += 1) {
    const screw = new THREE.Mesh(rod(0.055, 0.03, 6), blued);
    screw.position.set(...polar((i / 6) * TAU + 0.35, 1.7), 0.014);
    plate.add(screw);
  }
  movement.add(plate);

  const parts = [{ group: plate, x: 0, y: 0 }];
  function part(position) {
    const group = new THREE.Group();
    group.position.set(position[0], position[1], 0);
    train.add(group);
    parts.push({ group, x: position[0], y: position[1] });
    return group;
  }
  const gear = (teeth, module, depth, material, windows = 0) => new THREE.Mesh(slab(gearShape(teeth, module, windows), depth), material);
  // 軸と、その上端の受け石。
  function arbor(group, top) {
    const shaft = new THREE.Mesh(rod(0.024, top), steel);
    shaft.position.z = top / 2;
    const stone = new THREE.Mesh(rod(0.045, 0.03), jewel);
    stone.position.z = top + 0.012;
    const setting = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.016, 8, 24), brass);
    setting.position.z = top + 0.012;
    group.add(shaft, stone, setting);
  }
  const spinner = (group, z, ...meshes) => {
    const spin = new THREE.Group();
    spin.position.z = z;
    spin.add(...meshes);
    group.add(spin);
    return spin;
  };

  // 香箱。ぜんまいを収めた太鼓の下に歯がある。上には、巻き上げ用の角穴車が載る。
  const barrelPart = part(POS.barrel);
  const drum = new THREE.Mesh(rod(0.8, 0.1, 64), darkBrass);
  drum.position.z = 0.07;
  const barrel = spinner(barrelPart, 0.1, gear(T.barrel, M.barrel, 0.06, brass), drum);
  const ratchet = spinner(barrelPart, 0.4, gear(T.ratchet, M.ratchet, 0.05, steel, 5));
  arbor(barrelPart, 0.5);

  // 2 番車。1 時間で 1 回転し、分針を運ぶ。
  const centerPart = part(POS.center);
  const centerPinion = gear(T.centerPinion, M.barrel, 0.09, steel);
  centerPinion.position.z = -0.16;
  const center = spinner(centerPart, 0.26, gear(T.center, M.center, 0.035, brass, 5), centerPinion);
  arbor(centerPart, 0.84);
  const minuteHand = new THREE.Mesh(slab(handShape(0.6, 0.022), 0.012), blued);
  minuteHand.position.z = 0.82;
  const hourHand = new THREE.Mesh(slab(handShape(0.4, 0.03), 0.012), blued);
  hourHand.position.z = 0.78;
  // 針の先を読むための、骨組みだけの文字盤。
  const chapter = new THREE.Group();
  chapter.position.z = 0.75;
  chapter.add(new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.008, 6, 96), brass));
  for (let i = 0; i < 12; i += 1) {
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.014, i % 3 === 0 ? 0.09 : 0.05, 0.012), brass);
    mark.position.set(...polar((i / 12) * TAU + Math.PI / 2, 0.66), 0);
    mark.rotation.z = (i / 12) * TAU;
    chapter.add(mark);
  }
  centerPart.add(minuteHand, hourHand, chapter);

  // 3 番車。
  const thirdPart = part(POS.third);
  const thirdPinion = gear(T.thirdPinion, M.center, 0.08, steel);
  thirdPinion.position.z = -0.16;
  const third = spinner(thirdPart, 0.42, gear(T.third, M.third, 0.035, brass, 4), thirdPinion);
  arbor(thirdPart, 0.56);

  // 4 番車。1 分で 1 回転し、秒針を運ぶ。歯は上向きで、横倒しの軸のかなを回す。
  const fourthPart = part(POS.fourth);
  const fourthPinion = gear(T.fourthPinion, M.third, 0.08, steel);
  fourthPinion.position.z = -0.16;
  const crownBase = new THREE.Mesh(slab(gearShape(24, 0.0405, 4), 0.035), brass);
  const pitchZ = 0.0175 + CONTRATE_MODULE * 1.2;
  const crownTeeth = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, (Math.PI * CONTRATE_MODULE) * 0.44, CONTRATE_MODULE * 2.2), brass, T.contrate);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < T.contrate; i += 1) {
    const a = (i / T.contrate) * TAU;
    matrix.makeRotationZ(a).setPosition(Math.cos(a) * CONTRATE_RADIUS, Math.sin(a) * CONTRATE_RADIUS, pitchZ - CONTRATE_MODULE * 0.1);
    crownTeeth.setMatrixAt(i, matrix);
  }
  const fourth = spinner(fourthPart, 0.58, crownBase, crownTeeth, fourthPinion);
  arbor(fourthPart, 0.94);
  const secondHand = new THREE.Mesh(slab(handShape(0.36, 0.012), 0.01), blued);
  secondHand.position.z = 0.9;
  fourthPart.add(secondHand);

  // がんぎ車。軸は 4 番車の半径方向に寝ていて、車は立っている。ここで回転の軸が直角に変わる。
  const escapePart = part(POS.fourth);
  escapePart.rotation.z = PHI.escape;
  const axisZ = 0.58 + pitchZ + ESCAPE_PINION_RADIUS;
  const lying = new THREE.Group();
  lying.position.set(CONTRATE_RADIUS, 0, axisZ);
  lying.rotation.y = Math.PI / 2;
  const escapeSpin = new THREE.Group();
  const escapePinion = gear(T.escapePinion, CONTRATE_MODULE, 0.07, steel);
  const escapeWheel = new THREE.Mesh(slab(escapeShape(T.escape, 0.3), 0.025), steel);
  escapeWheel.position.z = 0.34;
  const escapeShaft = new THREE.Mesh(rod(0.02, 0.62, 12), steel);
  escapeShaft.position.z = 0.2;
  escapeSpin.add(escapePinion, escapeWheel, escapeShaft);
  // アンクル。がんぎ車の歯を 1 枚ずつ逃がす。寝かせた向きでは、上が -X になる。
  const palletShape = new THREE.Shape();
  [[-0.22, -0.17], [-0.2, -0.08], [-0.05, 0.03], [0.05, 0.03], [0.2, -0.08], [0.22, -0.17], [0.15, -0.11], [0.04, -0.03], [-0.04, -0.03], [-0.15, -0.11]].forEach(([x, y], i) => {
    if (i === 0) palletShape.moveTo(x, y);
    else palletShape.lineTo(x, y);
  });
  palletShape.closePath();
  const pallet = new THREE.Mesh(slab(palletShape, 0.03).rotateZ(Math.PI / 2), brass);
  pallet.position.set(-0.41, 0, 0.34);
  for (const side of [-1, 1]) {
    const stone = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.04), jewel);
    stone.position.set(0.15, side * 0.21, 0);
    pallet.add(stone);
  }
  lying.add(escapeSpin, pallet);
  // 寝た軸の外側の端を支える柱。
  const post = new THREE.Mesh(new THREE.BoxGeometry(axisZ + 0.03, 0.05, 0.03), darkBrass);
  post.position.set(axisZ / 2 - 0.015, 0, 0.5);
  lying.add(post);
  escapePart.add(lying);

  // てんぷ。がんぎ車の真上で、水平に左右へ振れる。
  const balancePart = part(POS.escape);
  const balanceZ = axisZ + 0.56;
  const balance = new THREE.Group();
  balance.position.z = balanceZ;
  balance.add(new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.032, 12, 72), brass));
  for (let i = 0; i < 2; i += 1) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.045, 0.03), brass);
    spoke.rotation.z = (i * Math.PI) / 2;
    balance.add(spoke);
  }
  for (let i = 0; i < 12; i += 1) {
    const weight = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 8).rotateZ(Math.PI / 2), steel);
    weight.position.set(...polar((i / 12) * TAU + 0.26, 0.445), 0);
    weight.rotation.z = (i / 12) * TAU + 0.26;
    balance.add(weight);
  }
  const spiral = Array.from({ length: 140 }, (_, i) => new THREE.Vector3(...polar((i / 140) * TAU * 5.5, 0.04 + (i / 140) * 0.22), 0));
  const hairspring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(spiral), 220, 0.006, 5), blued);
  hairspring.position.z = balanceZ + 0.06;
  const staff = new THREE.Mesh(rod(0.02, 0.36, 10), steel);
  staff.position.z = balanceZ - 0.06;
  const capStone = new THREE.Mesh(rod(0.05, 0.03), jewel);
  capStone.position.z = balanceZ + 0.13;
  // てんぷ受け。外側の柱から腕を伸ばして、てんぷの軸の上端を支える。
  const outward = polar(PHI.escape, 0.6);
  const pillar = new THREE.Mesh(rod(0.035, balanceZ + 0.12, 12), brass);
  pillar.position.set(outward[0], outward[1], (balanceZ + 0.12) / 2);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.08, 0.03), brass);
  arm.position.set(outward[0] / 2, outward[1] / 2, balanceZ + 0.13);
  arm.rotation.z = PHI.escape;
  balancePart.add(balance, hairspring, staff, pillar, arm, capStone);

  // 巻き真とりゅうず。軸は香箱の半径方向で、立った小歯車が角穴車に直角にかみ合う。
  const stemPart = part(POS.barrel);
  stemPart.rotation.z = PHI.barrel;
  const stem = new THREE.Group();
  stem.position.set(RATCHET_RADIUS, 0, 0.4 + WINDER_RADIUS);
  stem.rotation.y = Math.PI / 2;
  const stemSpin = new THREE.Group();
  const stemShaft = new THREE.Mesh(rod(0.03, 0.78, 12), steel);
  stemShaft.position.z = 0.39;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.16, 20).rotateX(Math.PI / 2), brass);
  crown.position.z = 0.82;
  const knurl = new THREE.Mesh(slab(gearShape(20, 0.0155), 0.12), darkBrass);
  knurl.position.z = 0.82;
  stemSpin.add(gear(T.winder, M.ratchet, 0.05, brass), stemShaft, crown, knurl);
  stem.add(stemSpin);
  stemPart.add(stem);

  // かみ合いの方向。どれも、回す側から見た相手の向き。
  const dirFourthToThird = PHI.fourth + Math.PI;
  const dirThirdToCenter = PHI.third + Math.PI;
  const state = { wind: 0 };
  const intros = parts.map(() => ({ v: stage.reduced ? 1 : 0 }));

  function secondsOfDay() {
    const now = new Date();
    return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
  }

  function place() {
    const now = movementState(secondsOfDay());
    // 4 番車から順に、歯数の比と歯の位相で相手の角度を決めていく。
    fourth.rotation.z = now.second;
    third.rotation.z = meshAngle(now.second, T.fourthPinion, T.third, dirFourthToThird);
    center.rotation.z = meshAngle(third.rotation.z, T.thirdPinion, T.center, dirThirdToCenter);
    barrel.rotation.z = meshAngle(center.rotation.z, T.centerPinion, T.barrel, PHI.barrel);
    escapeSpin.rotation.z = ((now.second - PHI.escape) * T.contrate) / T.escapePinion + Math.PI / T.escapePinion;
    secondHand.rotation.z = now.second;
    minuteHand.rotation.z = now.minute;
    hourHand.rotation.z = now.hour;
    balance.rotation.z = now.balance * 1.5;
    hairspring.rotation.z = now.balance * 0.75;
    hairspring.scale.setScalar(1 - now.balance * 0.06);
    pallet.rotation.z = now.pallet * 0.1;
    ratchet.rotation.z = state.wind;
    stemSpin.rotation.z = ((state.wind - PHI.barrel) * T.ratchet) / T.winder + Math.PI / T.winder;
    parts.forEach(({ group }, i) => {
      const v = intros[i].v;
      group.position.z = (1 - v) * 2.2;
      group.scale.setScalar(Math.max(0.001, v));
    });
  }

  stage.onResize(() => {
    const view = stage.viewport();
    rig.scale.setScalar(Math.min(1.25, view.width / 4.9, view.height / 4.1));
  });
  const tilt = -p.tilt * DEG;
  stage.onFrame((time) => {
    if (!stage.reduced) place();
    // 全体も 2 つの軸でゆっくり向きを変える。止めていても立体だと分かる。
    rig.rotation.x = tilt + Math.sin(time * 0.23 * p.turn) * 0.12 - stage.pointer.sy * 0.3;
    rig.rotation.y = Math.sin(time * 0.17 * p.turn) * 0.22 + stage.pointer.sx * 0.35;
    movement.rotation.z = 0.25 + Math.sin(time * 0.11 * p.turn) * 0.6;
  });
  place();

  // ぜんまいを巻く。りゅうずが回り、角穴車が歯数の比だけ進む。
  function wind() {
    if (stage.reduced) return;
    utils.remove(state);
    animate(state, { wind: state.wind + TAU / 3, duration: 1400, ease: 'outElastic(1, .6)' });
  }
  container.addEventListener('pointerdown', wind);

  let timer = 0;
  if (!stage.reduced) {
    // 登場。部品が上から順に下りてきて、組み上がる。
    animate(intros, { v: 1, duration: 900, ease: 'outBack(1.15)', delay: stagger(90) });
    if (p.preview) timer = setInterval(wind, 4200);
  }

  return {
    wind,
    destroy() {
      clearInterval(timer);
      container.removeEventListener('pointerdown', wind);
      utils.remove([state, ...intros]);
      stage.destroy();
    },
  };
}
