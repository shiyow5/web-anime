import * as THREE from 'three';
import { animate, spring, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { TAU, canvasTexture, flatBand, glow, glyphStrip, polygonOutline, ringBand, seeded, starOutline, tickRing, wallBand } from '../../lib/holo.js';

export const meta = {
  id: 'sigil-dome',
  title: '天蓋の魔法陣',
  category: 'fantasy',
  libs: ['three', 'animejs'],
  description:
    '文字を刻んだ輪が、高さを変えて天蓋のように積み上がります。段ごとに逆向きに回り、縁には小さな魔法陣が外を向いて立ち、それぞれ自分の軸で回ります。骨組みの弧と、傾いた大きな輪が全体を包み、頂から光の柱が立ち、光の筋が斜めに貫きます。クリックすると発動して、段が大きく開きます。',
  params: {
    color: { type: 'color', label: '線の色', default: '#a9d4ff' },
    light: { type: 'color', label: '光の色', default: '#f2fbff' },
    background: { type: 'color', label: '空の色', default: '#070c2a' },
    circles: { type: 'range', label: '縁に立つ魔法陣の数', min: 3, max: 10, step: 1, default: 6 },
    speed: { type: 'range', label: '回る速さ', min: 0, max: 3, step: 0.1, default: 1 },
    glow: { type: 'range', label: '光のにじみ', min: 0, max: 1.2, step: 0.05, default: 0.5 },
  },
};

// 段の配置。y は高さ、r は半径、star は中に描く星の頂点の数（0 なら描かない）。
export const TIERS = [
  { y: -1.15, r: 2.05, star: 0, spin: 0.05 },
  { y: -0.25, r: 2.6, star: 6, spin: -0.09 },
  { y: 0.45, r: 1.95, star: 0, spin: 0.14 },
  { y: 0.98, r: 1.15, star: 5, spin: -0.22 },
  { y: 1.36, r: 0.46, star: 0, spin: 0.5 },
];
const MAIN = TIERS[1];
const APEX = TIERS[TIERS.length - 1];

// 縁に立つ魔法陣の位置と向き。count 個を等間隔に置き、面が外を向くように回す。
export function rimPlacement(index, count, radius) {
  const angle = (index / count) * TAU;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, facing: Math.PI / 2 - angle };
}

function pillarTexture() {
  return canvasTexture(256, 256, (ctx, width, height) => {
    const random = seeded(7);
    for (let i = 0; i < 90; i += 1) {
      const x = random() * width;
      const w = 1 + random() * 5;
      const fade = ctx.createLinearGradient(0, height, 0, 0);
      fade.addColorStop(0, `rgba(255,255,255,${0.25 + random() * 0.5})`);
      fade.addColorStop(0.4 + random() * 0.5, 'rgba(255,255,255,0)');
      ctx.fillStyle = fade;
      ctx.fillRect(x, 0, w, height);
    }
  });
}

function haloTexture() {
  return canvasTexture(128, 128, (ctx) => {
    const fade = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    fade.addColorStop(0, 'rgba(255,255,255,0.9)');
    fade.addColorStop(0.35, 'rgba(255,255,255,0.22)');
    fade.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, 128, 128);
  });
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, {
    fov: 40,
    cameraZ: 8.6,
    background: p.background,
    preview: p.preview,
    maxDpr: p.preview ? 1 : 1.5,
    bloom: { strength: 0.05 + p.glow * 0.6, radius: 0.3, threshold: 0.32 },
  });
  const still = stage.reduced;
  stage.camera.position.y = -0.5;
  stage.camera.lookAt(0, 0.35, 0);

  const stripA = glyphStrip({ count: 72, seed: 5 });
  const stripB = glyphStrip({ count: 40, seed: 19 });
  const mat = {
    line: glow(p.color, 0.95),
    dim: glow(p.color, 0.4),
    light: glow(p.light, 1),
    runesA: glow(p.color, 0.95, { map: stripA }),
    runesB: glow(p.light, 0.8, { map: stripB }),
  };
  const mesh = (geometry, material) => new THREE.Mesh(geometry, material);

  const root = new THREE.Group();
  stage.scene.add(root);

  // 1 段ぶんの円盤。XY 平面に描いて、あとで水平に寝かせる。
  function plate(tier, index) {
    const r = tier.r;
    const flat = new THREE.Group();
    flat.rotation.x = -Math.PI / 2;
    flat.add(mesh(ringBand(r, r + 0.035), mat.light));
    flat.add(mesh(ringBand(r * 0.86, r * 0.86 + 0.012), mat.line));
    flat.add(mesh(flatBand(r * 0.875, r * 0.985), index % 2 ? mat.runesA : mat.runesB));
    flat.add(mesh(tickRing(r * 0.845, 72, r * 0.03, 0.007, { major: { every: 6 } }), mat.dim));
    flat.add(mesh(ringBand(r * 0.52, r * 0.52 + 0.01), mat.line));
    if (tier.star) {
      flat.add(mesh(starOutline(r * 0.84, tier.star, 2, 0.014), mat.line));
      flat.add(mesh(polygonOutline(r * 0.84, tier.star, 0.008, Math.PI / tier.star), mat.dim));
      // 星の頂点ごとに、小さな円を置く。
      for (let i = 0; i < tier.star; i += 1) {
        const angle = (i / tier.star) * TAU;
        const dot = mesh(ringBand(r * 0.05, r * 0.05 + 0.012), mat.light);
        dot.position.set(Math.cos(angle) * r * 0.84, Math.sin(angle) * r * 0.84, 0);
        flat.add(dot);
      }
    }
    const group = new THREE.Group();
    group.add(flat);
    // 縁に立つ、文字の帯。
    if (index > 0 && index < TIERS.length - 1) {
      const wall = mesh(wallBand(r + 0.02, 0.2), index % 2 ? mat.runesB : mat.runesA);
      wall.position.y = 0.1;
      group.add(wall);
    }
    root.add(group);
    return { tier, group, rise: still ? 1 : 0 };
  }
  const tiers = TIERS.map(plate);

  // 縁に立つ小さな魔法陣。外を向いて立ち、自分の軸で回る。
  function standing(radius, points) {
    const face = new THREE.Group();
    face.add(mesh(ringBand(radius, radius + 0.022), mat.light));
    face.add(mesh(ringBand(radius * 0.72, radius * 0.72 + 0.01), mat.line));
    face.add(mesh(tickRing(radius * 0.96, 24, radius * 0.1, 0.006), mat.dim));
    face.add(mesh(starOutline(radius * 0.7, points, points === 6 ? 2 : Math.floor(points / 2), 0.01), mat.line));
    face.add(mesh(ringBand(radius * 0.16, radius * 0.16 + 0.01), mat.light));
    return face;
  }
  const count = Math.round(p.preview ? Math.min(p.circles, 6) : p.circles);
  const stands = Array.from({ length: count }, (_, i) => {
    const place = rimPlacement(i, count, MAIN.r + 0.06);
    const hinge = new THREE.Group();
    hinge.position.set(place.x, 0, place.z);
    hinge.rotation.y = place.facing;
    const lean = new THREE.Group();
    const face = standing(0.44, i % 2 ? 5 : 6);
    face.position.y = 0.5;
    lean.add(face);
    hinge.add(lean);
    tiers[1].group.add(hinge);
    return { lean, face, up: still ? 1 : 0, phase: i * 0.9 };
  });
  // 上の段には、斜めに傾いた小さな輪を 3 つ。
  const uppers = Array.from({ length: 3 }, (_, i) => {
    const place = rimPlacement(i + 0.5, 3, TIERS[2].r + 0.05);
    const hinge = new THREE.Group();
    hinge.position.set(place.x, 0, place.z);
    hinge.rotation.y = place.facing;
    const face = standing(0.27, 5);
    face.position.y = 0.3;
    hinge.add(face);
    tiers[2].group.add(hinge);
    return { hinge, face, phase: i * 2.2 };
  });

  // 骨組みの弧。主の段の縁から頂まで伸び、全体で籠の形になる。
  const cage = new THREE.Group();
  cage.position.y = MAIN.y;
  const arcHeight = (APEX.y - MAIN.y) / MAIN.r;
  for (let i = 0; i < 8; i += 1) {
    const rib = new THREE.Group();
    rib.rotation.y = (i / 8) * TAU;
    const arc = mesh(ringBand(MAIN.r, MAIN.r + 0.014, { sweep: Math.PI / 2 }), i % 2 ? mat.dim : mat.line);
    arc.scale.y = arcHeight;
    rib.add(arc);
    cage.add(rib);
  }
  root.add(cage);

  // 全体を包む、傾いた大きな輪。それぞれ別の軸で回る。
  const gyros = [
    { radius: 3.15, tilt: [1.05, 0, 0.35], speed: 0.21 },
    { radius: 3.4, tilt: [1.9, 0.6, -0.4], speed: -0.15 },
    { radius: 2.95, tilt: [0.5, 0, -1.2], speed: 0.3 },
  ].map((def, index) => {
    const axis = new THREE.Group();
    axis.rotation.set(...def.tilt);
    axis.position.y = 0.1;
    const ring = new THREE.Group();
    ring.add(mesh(ringBand(def.radius, def.radius + 0.018), mat.line));
    ring.add(mesh(flatBand(def.radius + 0.03, def.radius + 0.17), index % 2 ? mat.runesA : mat.runesB));
    axis.add(ring);
    root.add(axis);
    return { ...def, axis, ring, open: still ? 1 : 0 };
  });

  // 頂から立つ光の柱と、足元の光。
  const pillarMap = pillarTexture();
  const pillar = mesh(new THREE.CylinderGeometry(0.34, 0.6, 5.2, 40, 1, true), glow(p.light, 0.5, { map: pillarMap }));
  pillar.position.y = APEX.y + 2.6;
  const pillarWide = mesh(new THREE.CylinderGeometry(1.0, 1.5, 4.4, 40, 1, true), glow(p.color, 0.16, { map: pillarMap }));
  pillarWide.position.y = TIERS[3].y + 2.2;
  const halo = mesh(new THREE.PlaneGeometry(7, 7), glow(p.color, 0.3, { map: haloTexture() }));
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = TIERS[0].y - 0.02;
  root.add(pillar, pillarWide, halo);

  // 斜めに貫く光の筋。
  const random = seeded(23);
  const rays = Array.from({ length: p.preview ? 6 : 10 }, (_, i) => {
    const direction = new THREE.Vector3(random() * 2 - 1, random() * 1.2 - 0.3, random() * 2 - 1).normalize().multiplyScalar(7);
    const through = new THREE.Vector3((random() - 0.5) * 1.6, random() * 1.6 - 0.3, (random() - 0.5) * 1.6);
    const geometry = new THREE.BufferGeometry().setFromPoints([through.clone().sub(direction), through.clone().add(direction)]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: p.light, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    root.add(line);
    return { line, phase: i * 1.37 };
  });

  // 立ちのぼる光の粒。
  const MOTES = p.preview ? 90 : 220;
  const motePositions = new Float32Array(MOTES * 3);
  const moteSeeds = Array.from({ length: MOTES }, () => ({ angle: random() * TAU, radius: 0.3 + random() * 2.4, offset: random(), speed: 0.05 + random() * 0.12 }));
  const moteGeometry = new THREE.BufferGeometry();
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
  root.add(new THREE.Points(moteGeometry, new THREE.PointsMaterial({ color: p.light, size: 0.045, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })));

  const state = { spread: 1, flash: 0 };
  stage.onResize(() => {
    const view = stage.viewport();
    root.scale.setScalar(Math.min(1.05, view.width / 8.6, view.height / 6.3));
  });

  stage.onFrame((time) => {
    const t = still ? 0 : time * p.speed;
    root.rotation.x = 0.36 + stage.pointer.sy * 0.25 + Math.sin(t * 0.13) * 0.03;
    root.rotation.y = stage.pointer.sx * 0.5 + t * 0.04;

    for (const item of tiers) {
      const { tier } = item;
      const base = TIERS[0].y;
      item.group.position.y = base + (tier.y - base) * item.rise * state.spread;
      item.group.scale.setScalar(Math.max(0.001, item.rise));
      item.group.rotation.y = t * tier.spin * 2.2;
    }
    cage.rotation.y = -t * 0.06;
    cage.scale.set(tiers[1].rise, tiers[TIERS.length - 1].rise * state.spread, tiers[1].rise);
    cage.position.y = tiers[1].group.position.y;

    for (const stand of stands) {
      // 寝た状態から起き上がり、起きたあとは前後に小さく揺れる。
      stand.lean.rotation.x = (1 - stand.up) * (Math.PI / 2) + Math.sin(t * 0.8 + stand.phase) * 0.12 * stand.up;
      stand.face.rotation.z = t * 0.7 * (stand.phase % 2 > 1 ? -1 : 1);
    }
    for (const upper of uppers) {
      upper.hinge.rotation.x = 0.55 + Math.sin(t * 0.6 + upper.phase) * 0.2;
      upper.face.rotation.z = -t * 1.1;
    }
    for (const gyro of gyros) {
      gyro.ring.rotation.z = t * gyro.speed * 2;
      gyro.axis.rotation.x = gyro.tilt[0] + Math.sin(t * 0.21 + gyro.radius) * 0.14;
      gyro.ring.scale.setScalar(Math.max(0.001, gyro.open));
    }

    const breath = 0.75 + 0.25 * Math.sin(t * 1.7);
    pillar.material.opacity = (0.38 * breath + state.flash * 0.6) * tiers[TIERS.length - 1].rise;
    pillarWide.material.opacity = (0.12 * breath + state.flash * 0.3) * tiers[3].rise;
    pillar.rotation.y = t * 0.3;
    pillarWide.rotation.y = -t * 0.12;
    halo.material.opacity = 0.22 + state.flash * 0.5;
    for (const ray of rays) {
      const flicker = Math.max(0, Math.sin(t * 0.9 + ray.phase) * Math.sin(t * 2.3 + ray.phase * 2));
      ray.line.material.opacity = (0.08 + flicker * 0.5 + state.flash * 0.6) * tiers[2].rise;
    }

    for (let i = 0; i < MOTES; i += 1) {
      const seed = moteSeeds[i];
      const lift = (seed.offset + t * seed.speed) % 1;
      const swirl = seed.angle + t * 0.2 + lift * 2;
      const radius = seed.radius * (1 - lift * 0.6);
      motePositions[i * 3] = Math.cos(swirl) * radius;
      motePositions[i * 3 + 1] = TIERS[0].y + lift * 4.2;
      motePositions[i * 3 + 2] = Math.sin(swirl) * radius;
    }
    moteGeometry.attributes.position.needsUpdate = true;
  });

  const bounce = spring({ stiffness: 90, damping: 8 });
  function cast() {
    if (still) return;
    animate(state, {
      spread: [{ to: 1.32, duration: 420, ease: 'outExpo' }, { to: 1, ease: bounce }],
      flash: [{ to: 1, duration: 160, ease: 'outQuad' }, { to: 0, duration: 1400, ease: 'outExpo' }],
    });
  }
  container.addEventListener('pointerdown', cast);

  let previewTimer = 0;
  if (!still) {
    // 登場。足元の輪から順に段が立ち上がり、縁の魔法陣が起き、最後に大きな輪が広がる。
    animate(tiers, { rise: 1, duration: 1500, ease: 'outExpo', delay: stagger(220) });
    animate(stands, { up: 1, ease: bounce, delay: stagger(90, { start: 900 }) });
    animate(gyros, { open: 1, duration: 1700, ease: 'outBack(1.4)', delay: stagger(240, { start: 1300 }) });
    animate(state, { flash: [{ to: 0.8, duration: 300, delay: 1500 }, { to: 0, duration: 1600, ease: 'outExpo' }] });
    if (p.preview) previewTimer = setInterval(cast, 5600);
  }

  return {
    cast,
    destroy() {
      clearInterval(previewTimer);
      container.removeEventListener('pointerdown', cast);
      utils.remove([state, ...tiers, ...stands, ...gyros]);
      stage.destroy();
    },
  };
}
