import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { animate, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { canvasTexture, flatBand, glow, glyphStrip, seeded, wallBand } from '../../lib/holo.js';

export const meta = {
  id: 'gear-orrery',
  title: '歯車じかけの天球儀',
  category: 'fantasy',
  libs: ['three', 'animejs'],
  description:
    '古い真鍮の歯車で動く天球儀です。台座の歯車列が回ると、外周に歯を刻んだ 3 本の輪が、それぞれ別の傾きの軸で回り、輪を支える枠も縦の軸で向きを変えます。輪には小さな天体が載り、中心の魔法の光が内側から真鍮を照らします。ポインターで傾き、クリックで光が強まって一気に進みます。',
  params: {
    brass: { type: 'color', label: '真鍮の色', default: '#c79a4b' },
    magic: { type: 'color', label: '魔法の光の色', default: '#9c8bff' },
    planet: { type: 'color', label: '天体の色', default: '#5fffd0' },
    background: { type: 'color', label: '背景色', default: '#0c0916' },
    speed: { type: 'range', label: '回る速さ', min: 0, max: 3, step: 0.1, default: 1 },
    motes: { type: 'range', label: '光の粒の数', min: 0, max: 400, step: 10, default: 220 },
  },
};

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// かみ合う相手の角度。driver が角度 angle のとき、方向 phi にある相手の歯車の角度。
export function meshAngle(angle, driverTeeth, drivenTeeth, phi) {
  return phi + Math.PI + Math.PI / drivenTeeth - ((angle - phi) * driverTeeth) / drivenTeeth;
}

// 3 本の輪の決まりごと。radius は歯のかみ合う円の半径、tilt は輪の軸の傾き。
// spin は輪が自分の軸で回る速さ、swing は輪を支える枠が縦の軸で回る速さ（どちらも台座の主歯車に対する比）。
export const RINGS = Object.freeze([
  { teeth: 72, radius: 1.5, pinion: 12, tilt: 23 * DEG, spin: 1.2, swing: 1 },
  { teeth: 56, radius: 0.98, pinion: 9, tilt: -38 * DEG, spin: -1.7, swing: -0.6 },
  { teeth: 40, radius: 0.58, pinion: 8, tilt: 52 * DEG, spin: 2.6, swing: 1.4 },
]);

function gearShape(teeth, module, { windows = 0, bore = 0 } = {}) {
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
  if (bore > 0) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, bore, 0, TAU, false);
    shape.holes.push(hole);
  }
  if (windows > 0) {
    const outer = root - Math.max(0.035, radius * 0.12);
    const inner = Math.max(0.06, radius * 0.26);
    for (let i = 0; i < windows; i += 1) {
      const a0 = (i / windows) * TAU + 0.15;
      const a1 = ((i + 1) / windows) * TAU - 0.15;
      const hole = new THREE.Path();
      hole.absarc(0, 0, outer, a0, a1, false);
      hole.absarc(0, 0, inner, a1, a0, true);
      hole.closePath();
      shape.holes.push(hole);
    }
  }
  return shape;
}

function slab(shape, depth) {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

const rod = (radius, height, segments = 20) => new THREE.CylinderGeometry(radius, radius, height, segments).rotateX(Math.PI / 2);
const polar = (angle, distance) => [Math.cos(angle) * distance, Math.sin(angle) * distance];

// 台座の歯車列。主歯車を中心に、まわりの歯車と、直角に立つ手回しの歯車がかみ合う。
const BASE = { teeth: 36, module: 0.045 };
const SIDE = [
  { teeth: 16, phi: 35 * DEG, from: 'main' },
  { teeth: 20, phi: 160 * DEG, from: 'main' },
  { teeth: 12, phi: 255 * DEG, from: 1 },
];
const CRANK = { teeth: 14, psi: -90 * DEG };
const CENTER_Z = 0.3;
const BASE_Z = -1.72;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, {
    fov: 36,
    cameraZ: 9,
    background: p.background,
    preview: p.preview,
    maxDpr: p.preview ? 1 : 1.5,
    bloom: { strength: 0.65, radius: 0.4, threshold: 0.72 },
  });
  const pmrem = new THREE.PMREMGenerator(stage.renderer);
  const room = new RoomEnvironment();
  stage.scene.environment = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  room.dispose?.();
  stage.scene.environmentIntensity = 0.55;
  const key = new THREE.DirectionalLight(0xffe2b0, 1.8);
  key.position.set(4, 6, 6);
  stage.scene.add(key);

  const brass = new THREE.MeshStandardMaterial({ color: p.brass, metalness: 1, roughness: 0.38 });
  const oldBrass = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.brass).multiplyScalar(0.55), metalness: 1, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2a1f1a', metalness: 0.4, roughness: 0.7 });
  const magicColor = new THREE.Color(p.magic);
  const planetColors = [new THREE.Color(p.planet), new THREE.Color(p.magic).lerp(new THREE.Color('#ff8ad1'), 0.7), new THREE.Color('#ffd36b')];

  const rig = new THREE.Group();
  // この中では Z が上。歯車は XY 平面に作るので、そのまま水平に並ぶ。
  const world = new THREE.Group();
  world.rotation.x = -Math.PI / 2;
  rig.add(world);
  stage.scene.add(rig);

  const haloTexture = canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  const halo = (color, size, opacity = 0.9) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    sprite.scale.setScalar(size);
    return sprite;
  };

  // 台座。側面に、作りものの文字の帯が光る。
  const pedestal = new THREE.Group();
  pedestal.position.z = BASE_Z;
  const foot = new THREE.Mesh(rod(1.9, 0.16, 64), dark);
  foot.position.z = -0.2;
  const footRim = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.04, 10, 96), oldBrass);
  footRim.position.z = -0.12;
  const runes = new THREE.Mesh(wallBand(1.905, 0.11).rotateX(Math.PI / 2), glow(p.magic, 0.9, { map: glyphStrip({ count: 40, seed: 11 }) }));
  runes.position.z = -0.2;
  const column = new THREE.Mesh(rod(0.05, CENTER_Z - 1.75 - BASE_Z + 0.2, 16), brass);
  column.position.z = (CENTER_Z - 1.75 - BASE_Z + 0.2) / 2 - 0.1;
  pedestal.add(foot, footRim, runes, column);
  world.add(pedestal);

  const baseRadius = (BASE.teeth * BASE.module) / 2;
  const mainGear = new THREE.Mesh(slab(gearShape(BASE.teeth, BASE.module, { windows: 6 }), 0.07), brass);
  pedestal.add(mainGear);
  const sides = SIDE.map((spec) => ({ ...spec, radius: (spec.teeth * BASE.module) / 2 }));
  sides.forEach((side) => {
    const parent = side.from === 'main' ? { x: 0, y: 0, radius: baseRadius } : sides[side.from];
    const [dx, dy] = polar(side.phi, parent.radius + side.radius);
    Object.assign(side, { x: parent.x + dx, y: parent.y + dy });
    side.mesh = new THREE.Mesh(slab(gearShape(side.teeth, BASE.module, { windows: side.teeth > 14 ? 4 : 3 }), 0.06), side.teeth === 20 ? oldBrass : brass);
    side.mesh.position.set(side.x, side.y, 0);
    const pin = new THREE.Mesh(rod(0.04, 0.22, 12), oldBrass);
    pin.position.set(side.x, side.y, -0.04);
    pedestal.add(side.mesh, pin);
  });
  // 手回しの歯車。軸は主歯車の半径方向で、主歯車の縁に直角に立つ。
  const crankRadius = (CRANK.teeth * BASE.module) / 2;
  const crankMount = new THREE.Group();
  crankMount.rotation.z = CRANK.psi;
  const crankStand = new THREE.Group();
  crankStand.position.set(baseRadius, 0, crankRadius);
  crankStand.rotation.y = Math.PI / 2;
  const crank = new THREE.Group();
  crank.add(new THREE.Mesh(slab(gearShape(CRANK.teeth, BASE.module, { windows: 4 }), 0.05), brass));
  const crankShaft = new THREE.Mesh(rod(0.03, 0.75, 12), oldBrass);
  crankShaft.position.z = 0.35;
  const crankArm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.04), brass);
  crankArm.position.set(0.12, 0, 0.72);
  const crankKnob = new THREE.Mesh(rod(0.045, 0.2, 12), dark);
  crankKnob.position.set(0.25, 0, 0.82);
  crank.add(crankShaft, crankArm, crankKnob);
  crankStand.add(crank);
  const crankPost = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, crankRadius + 0.12), oldBrass);
  crankPost.position.set(baseRadius + 0.5, 0, (crankRadius + 0.12) / 2 - 0.12);
  crankMount.add(crankStand, crankPost);
  pedestal.add(crankMount);

  // 台座の上に浮かぶ魔法陣。
  const circle = new THREE.Group();
  circle.position.z = BASE_Z + 0.42;
  circle.add(new THREE.Mesh(flatBand(1.28, 1.42), glow(p.magic, 0.55, { map: glyphStrip({ count: 36, seed: 4 }) })));
  world.add(circle);

  // 天球。輪ごとに、縦の軸で回る枠 → 傾き → 輪の回転、の順に入れ子にする。
  const sphere = new THREE.Group();
  sphere.position.z = CENTER_Z;
  world.add(sphere);
  const rings = RINGS.map((spec, i) => {
    const module = (spec.radius * 2) / spec.teeth;
    const pinionRadius = (spec.pinion * module) / 2;
    const swing = new THREE.Group();
    const tilt = new THREE.Group();
    const spin = new THREE.Group();
    const material = i === 1 ? oldBrass : brass;
    spin.add(new THREE.Mesh(slab(gearShape(spec.teeth, module, { bore: spec.radius - module * 1.2 - 0.075 }), 0.045), material));
    // 輪に載った天体。
    const body = new THREE.Group();
    body.position.set(...polar(i * 2.1, spec.radius - module * 1.2 - 0.04), 0.085);
    body.add(new THREE.Mesh(new THREE.SphereGeometry(0.05 + (2 - i) * 0.012, 20, 14), new THREE.MeshBasicMaterial({ color: planetColors[i] })), halo(planetColors[i], 0.42, 0.7));
    spin.add(body);
    // 輪を回す小歯車。輪のいちばん高い所で、同じ平面の中でかみ合う。
    const pinion = new THREE.Mesh(slab(gearShape(spec.pinion, module), 0.06), i === 1 ? brass : oldBrass);
    pinion.position.set(0, spec.radius + pinionRadius, 0);
    const axle = new THREE.Mesh(rod(0.016, 0.2, 8), oldBrass);
    axle.position.copy(pinion.position);
    tilt.add(spin, pinion, axle);
    // 枠。小歯車の軸を支える、縦の輪。
    const cradle = new THREE.Mesh(new THREE.TorusGeometry(spec.radius + pinionRadius, 0.014, 8, 120).rotateY(Math.PI / 2), oldBrass);
    swing.add(tilt, cradle);
    sphere.add(swing);
    return { spec, swing, tilt, spin, pinion };
  });

  // 中心の魔法の光。内側から輪を照らす。
  const sun = new THREE.Group();
  sun.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), new THREE.MeshBasicMaterial({ color: magicColor.clone().lerp(new THREE.Color('#ffffff'), 0.55) })));
  const cage = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.3, 0)), new THREE.LineBasicMaterial({ color: p.magic, transparent: true, opacity: 0.8 }));
  const sunHalo = halo(p.magic, 1.5, 0.75);
  const sunLight = new THREE.PointLight(p.magic, 10, 7, 1.6);
  sun.add(cage, sunHalo, sunLight);
  sphere.add(sun);

  // 光の粒。
  const count = Math.round(p.preview ? p.motes * 0.5 : p.motes);
  const random = seeded(23);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const r = 0.5 + random() * 1.7;
    const a = random() * TAU;
    const z = random() * 2 - 1;
    const s = Math.sqrt(1 - z * z);
    positions.set([Math.cos(a) * s * r, Math.sin(a) * s * r, z * r], i * 3);
  }
  const moteGeometry = new THREE.BufferGeometry();
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const motes = new THREE.Points(moteGeometry, new THREE.PointsMaterial({ map: haloTexture, color: p.magic, size: 0.07, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  sphere.add(motes);

  const state = { turn: 0 };
  const kick = { v: 0 };
  const intros = rings.map(() => ({ v: stage.reduced ? 1 : 0 }));
  const glowIn = { v: stage.reduced ? 1 : 0 };

  function place(time) {
    const base = state.turn;
    mainGear.rotation.z = base;
    sides.forEach((side) => {
      const driver = side.from === 'main' ? { angle: base, teeth: BASE.teeth } : { angle: sides[side.from].mesh.rotation.z, teeth: sides[side.from].teeth };
      side.mesh.rotation.z = meshAngle(driver.angle, driver.teeth, side.teeth, side.phi);
    });
    crank.rotation.z = ((base - CRANK.psi) * BASE.teeth) / CRANK.teeth + Math.PI / CRANK.teeth;
    rings.forEach(({ spec, swing, tilt, spin, pinion }, i) => {
      const v = intros[i].v;
      swing.rotation.z = base * spec.swing + i * 1.1 + (1 - v) * 3;
      // 登場では、輪が水平から起き上がって、それぞれの傾きに収まる。
      tilt.rotation.x = spec.tilt * v + (1 - v) * (i % 2 ? -1.6 : 1.6);
      swing.scale.setScalar(Math.max(0.001, v));
      spin.rotation.z = base * spec.spin;
      pinion.rotation.z = meshAngle(spin.rotation.z, spec.teeth, spec.pinion, Math.PI / 2);
    });
    circle.rotation.z = -base * 0.4;
    cage.rotation.set(time * 0.7, time * 0.5, 0);
    const pulse = 1 + Math.sin(time * 2.4) * 0.06 + kick.v * 0.8;
    sun.scale.setScalar(glowIn.v * pulse);
    sunLight.intensity = 10 * glowIn.v * (1 + kick.v * 2);
    motes.rotation.set(time * 0.05, time * 0.03, time * 0.08);
    motes.material.opacity = 0.8 * glowIn.v;
  }

  stage.onResize(() => {
    const view = stage.viewport();
    const scale = Math.min(1, view.width / 5, view.height / 5);
    rig.scale.setScalar(scale);
    rig.position.y = 0.22 * scale;
  });
  stage.onFrame((time, dt) => {
    state.turn += dt * p.speed * 0.32 * (1 + kick.v * 5);
    place(time);
    // 全体も向きを変える。見下ろす角度がゆっくり揺れ、台座ごと回る。
    rig.rotation.x = 0.34 + Math.sin(time * 0.19) * 0.1 - stage.pointer.sy * 0.25;
    rig.rotation.y = time * 0.07 + stage.pointer.sx * 0.5;
  });
  if (stage.reduced) {
    rig.rotation.set(0.34, 0.4, 0);
    state.turn = 0.8;
  }
  place(0);

  function flare() {
    if (stage.reduced) return;
    utils.remove(kick);
    animate(kick, { v: [1, 0], duration: 1800, ease: 'outExpo' });
  }
  container.addEventListener('pointerdown', flare);

  if (!stage.reduced) {
    animate(intros, { v: 1, duration: 1900, ease: 'outExpo', delay: stagger(260, { start: 200 }) });
    animate(glowIn, { v: 1, duration: 1600, delay: 700, ease: 'outBack(2)' });
  }

  return {
    flare,
    destroy() {
      container.removeEventListener('pointerdown', flare);
      utils.remove([state, kick, glowIn, ...intros]);
      stage.destroy();
    },
  };
}
