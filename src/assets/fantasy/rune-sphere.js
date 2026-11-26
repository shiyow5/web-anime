import * as THREE from 'three';
import { animate, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { canvasTexture, glow, glyphStrip, ringBand, seeded, wallBand } from '../../lib/holo.js';

export const meta = {
  id: 'rune-sphere',
  title: '召喚の球',
  category: 'fantasy',
  libs: ['three', 'animejs'],
  description:
    '作りものの文字を巻いた帯の輪が、1 本ずつ違う軸で転がり、全体で球の形を作ります。中心には光の核があり、輪どうしが交わる点で火花が散ります。クリックすると輪が 1 枚の平面にそろい、弾けて元の軸へ戻ります。召喚や起動の場面、見出しの背景に使えます。',
  params: {
    color: { type: 'color', label: '輪の色', default: '#ffd28a' },
    accent: { type: 'color', label: '2 色目の輪と火花の色', default: '#c59bff' },
    core: { type: 'color', label: '核の色', default: '#fff3d6' },
    background: { type: 'color', label: '背景色', default: '#0a0616' },
    rings: { type: 'range', label: '輪の本数', min: 3, max: 8, step: 1, default: 6 },
    speed: { type: 'range', label: '回る速さ', min: 0, max: 3, step: 0.1, default: 1 },
    seed: { type: 'range', label: '文字の種', min: 1, max: 99, step: 1, default: 7 },
  },
};

const TAU = Math.PI * 2;
const GLYPHS = 56;
const UP = new THREE.Vector3(0, 1, 0);

// 輪を 1 本作る。外側の Group が向きを持ち、内側の帯が自分の軸で回って文字を送る。
function createRing(index, total, random, colors, seed, preview) {
  const radius = 1.9 - (index / Math.max(1, total - 1)) * 0.42;
  const height = (TAU * radius * 1.5) / GLYPHS;
  const color = colors[index % 2];
  const holder = new THREE.Group();
  const band = new THREE.Mesh(
    wallBand(radius, height, preview ? 72 : 128),
    glow(color, 0.95, { map: glyphStrip({ count: GLYPHS, seed: seed * 13 + index, cell: preview ? 28 : 44 }) }),
  );
  // 帯の上下に、細い目盛りの輪を浮かせる。帯と一緒に向きを変える。
  const rails = new THREE.Group();
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(ringBand(radius - 0.012, radius + 0.012), glow(color, 0.5));
    rail.rotation.x = Math.PI / 2;
    rail.position.y = side * (height / 2 + 0.035);
    rails.add(rail);
  }
  holder.add(band, rails);
  // 輪ごとに違う向きの土台と、輪の面の中を通る転がりの軸を決める。
  const base = new THREE.Quaternion().setFromEuler(new THREE.Euler((index / total) * Math.PI + random() * 0.4, random() * TAU, (index * 2.4) % Math.PI));
  const tumbleAxis = new THREE.Vector3(Math.cos(index * 1.7), 0, Math.sin(index * 1.7)).normalize();
  return {
    holder,
    band,
    radius,
    base,
    tumbleAxis,
    tumble: random() * TAU,
    tumbleSpeed: (0.22 + random() * 0.25) * (index % 2 ? -1 : 1),
    scrollSpeed: (0.25 + random() * 0.3) * (index % 2 ? 1 : -1),
    normal: new THREE.Vector3(0, 1, 0),
    intro: 1,
  };
}

function softDot() {
  return canvasTexture(64, 64, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.4)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const preview = Boolean(p.preview);
  const stage = createStage(container, { fov: 40, cameraZ: 7.4, background: p.background, preview, bloom: { strength: 0.6, radius: 0.35, threshold: 0.3 } });
  const random = seeded(p.seed);
  const colors = [new THREE.Color(p.color), new THREE.Color(p.accent)];
  const state = { align: 0, burst: 0, core: stage.reduced ? 1 : 0 };

  const system = new THREE.Group();
  const spin = new THREE.Group();
  system.add(spin);
  stage.scene.add(system);

  const rings = Array.from({ length: p.rings }, (_, i) => createRing(i, p.rings, random, colors, p.seed, preview));
  for (const ring of rings) spin.add(ring.holder);

  // そろうときの平面。少し手前に倒して、帯の文字が見える角度にする。
  const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0, 0.12));

  // 核。芯、にじみ、2 軸で回るかご。
  const dot = softDot();
  const coreColor = new THREE.Color(p.core);
  const heart = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 2), new THREE.MeshBasicMaterial({ color: coreColor }));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: coreColor, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(1.5);
  const cage = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.46, 0)), new THREE.LineBasicMaterial({ color: colors[1], transparent: true, opacity: 0.8 }));
  const cage2 = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.66, 0)), new THREE.LineBasicMaterial({ color: colors[0], transparent: true, opacity: 0.35 }));
  const core = new THREE.Group();
  core.add(heart, halo, cage, cage2);
  spin.add(core);

  // 輪どうしの交点に置く火花。2 本の輪の面が交わる直線の、両端に出る。
  const pairs = [];
  for (let i = 0; i < rings.length; i += 1) for (let j = i + 1; j < rings.length; j += 1) pairs.push([rings[i], rings[j], random() * TAU]);
  const sparkPos = new Float32Array(pairs.length * 6);
  const sparkCol = new Float32Array(pairs.length * 6);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ map: dot.clone(), size: 0.34, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  sparks.frustumCulled = false;
  spin.add(sparks);
  const sparkColor = new THREE.Color(p.accent).lerp(new THREE.Color('#ffffff'), 0.45);

  // 弾けるときの粒。そろった平面の近くから外へ飛ぶ。
  const burstCount = preview ? 70 : 160;
  const burstPos = new Float32Array(burstCount * 3);
  for (let i = 0; i < burstCount; i += 1) {
    const a = random() * TAU;
    const lift = (random() - 0.5) * 0.5;
    const r = 0.7 + random() * 0.5;
    burstPos.set([Math.cos(a) * r, lift, Math.sin(a) * r], i * 3);
  }
  const burstGeo = new THREE.BufferGeometry();
  burstGeo.setAttribute('position', new THREE.BufferAttribute(burstPos, 3));
  const burst = new THREE.Points(burstGeo, new THREE.PointsMaterial({ map: dot.clone(), size: 0.16, color: sparkColor, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  burst.quaternion.copy(flat);
  burst.frustumCulled = false;
  spin.add(burst);

  // 奥に漂う細かい粒。
  const dustCount = preview ? 90 : 260;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i += 1) {
    const v = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize().multiplyScalar(2.3 + random() * 2.2);
    dustPos.set([v.x, v.y, v.z], i * 3);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: dot.clone(), size: 0.07, color: colors[0], transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  system.add(dust);

  const qTumble = new THREE.Quaternion();
  const qNow = new THREE.Quaternion();
  const cross = new THREE.Vector3();
  let scroll = 0;

  function place(dt, time) {
    scroll += dt * p.speed;
    const align = state.align;
    for (const ring of rings) {
      ring.tumble += dt * p.speed * ring.tumbleSpeed * (1 - Math.min(1, Math.max(0, align)));
      // 登場のあいだは、余分に回り込みながら定位置へ収まる。
      qTumble.setFromAxisAngle(ring.tumbleAxis, ring.tumble + (1 - ring.intro) * 2.6);
      qNow.copy(ring.base).multiply(qTumble);
      ring.holder.quaternion.slerpQuaternions(qNow, flat, align);
      ring.holder.scale.setScalar(Math.max(0.001, ring.intro));
      ring.band.rotation.y = scroll * ring.scrollSpeed * (1 + align * 3);
      ring.band.material.opacity = 0.95 * Math.min(1, ring.intro * 1.4);
      ring.normal.copy(UP).applyQuaternion(ring.holder.quaternion);
    }
    pairs.forEach(([a, b, phase], i) => {
      cross.crossVectors(a.normal, b.normal);
      const strength = cross.length();
      const flicker = 0.55 + 0.45 * Math.sin(time * 9 + phase) * Math.sin(time * 5.3 + phase * 2);
      const level = strength < 0.12 ? 0 : Math.min(1, strength * 1.5) * flicker * Math.min(a.intro, b.intro);
      const radius = (a.radius + b.radius) / 2;
      if (strength > 1e-4) cross.multiplyScalar(radius / strength);
      sparkPos.set([cross.x, cross.y, cross.z, -cross.x, -cross.y, -cross.z], i * 6);
      for (let k = 0; k < 2; k += 1) sparkCol.set([sparkColor.r * level, sparkColor.g * level, sparkColor.b * level], i * 6 + k * 3);
    });
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate = true;

    const e = state.burst;
    burst.scale.setScalar(0.5 + e * 2.6);
    burst.material.opacity = e > 0 && e < 1 ? (1 - e) * 0.95 : 0;
    const pulse = 1 + Math.sin(time * 2.4) * 0.07 + align * 0.5;
    heart.scale.setScalar(state.core * pulse);
    halo.scale.setScalar(1.5 * state.core * (pulse + align * 0.5));
    cage.rotation.set(time * 0.7, time * 0.5, 0);
    cage2.rotation.set(-time * 0.3, 0, time * 0.45);
    cage.scale.setScalar(state.core);
    cage2.scale.setScalar(state.core);
  }

  stage.onResize(() => {
    const view = stage.viewport();
    system.scale.setScalar(Math.min(1, view.width / 4.5, view.height / 4.35));
  });
  stage.onFrame((time, dt) => {
    place(dt, time);
    spin.rotation.y += dt * 0.12 * p.speed;
    dust.rotation.y -= dt * 0.03;
    dust.rotation.x += dt * 0.012;
    system.rotation.x = 0.12 - stage.pointer.sy * 0.3;
    system.rotation.y = stage.pointer.sx * 0.4;
  });

  // 輪を 1 枚の平面にそろえ、少し溜めてから弾けて元の軸へ戻す。
  function align() {
    if (stage.reduced) return;
    animate(state, {
      align: [
        { to: 1, duration: 650, ease: 'inOutCubic' },
        { to: 1, duration: 280 },
        { to: 0, duration: 1100, ease: 'outBack(2.4)' },
      ],
    });
    state.burst = 0;
    animate(state, { burst: 1, duration: 950, delay: 930, ease: 'outExpo' });
  }

  let timer = 0;
  if (!stage.reduced) {
    for (const ring of rings) ring.intro = 0;
    animate(rings, { intro: 1, duration: 1500, delay: stagger(170, { start: 200 }), ease: 'outBack(1.4)' });
    animate(state, { core: 1, duration: 900, ease: 'outElastic(1, .6)' });
    if (preview) timer = setInterval(align, 5200);
  }
  container.addEventListener('pointerdown', align);

  return {
    align,
    destroy() {
      clearInterval(timer);
      container.removeEventListener('pointerdown', align);
      utils.remove(state);
      utils.remove(rings);
      stage.destroy();
    },
  };
}
