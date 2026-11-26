import * as THREE from 'three';
import { animate, spring, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { TAU, circuitRing, flatBand, glow, glyphStrip, gridDisc, polygonOutline, ringBand, segmentRing, tickRing } from '../../lib/holo.js';
import { createNoisePass } from '../../lib/postfx.js';

export const meta = {
  id: 'holo-reactor',
  title: 'ホログラムの炉心',
  category: 'cyber',
  libs: ['three', 'animejs'],
  description:
    '脈打つ核のまわりを、軸がすべて違う輪が歳差しながら回り、上下には小さな輪の柱が積まれます。輪の上では、さらに小さな輪が自分の軸で回ります。タップすると封じ込めと再点火が起きます。輪が 1 本ずつ足場と同じ面へ倒れ込んで重なり、上下の柱が核へ引き寄せられ、映像が乱れます。続いて核が光って衝撃の輪が走り、柱が外へ弾かれ、輪が元の軸へ揺れながら戻ります。再点火のたびに、差し色が通常の色と高温の色で入れ替わります。動力や処理中の表示に使えます。',
  params: {
    color: { type: 'color', label: '線の色', default: '#c4f0ff' },
    accent: { type: 'color', label: '差し色', default: '#a784ff' },
    hot: { type: 'color', label: '過負荷の色', default: '#ff5fa8' },
    background: { type: 'color', label: '背景色', default: '#05070f' },
    rings: { type: 'range', label: '輪の本数', min: 3, max: 5, step: 1, default: 5 },
    speed: { type: 'range', label: '回る速さ', min: 0, max: 3, step: 0.1, default: 1 },
    noise: { type: 'range', label: 'ノイズの強さ', min: 0, max: 1, step: 0.05, default: 0.5 },
  },
};

// 輪ごとの、寝かせ方（傾き）と、歳差の軸と、速さ。どの輪も軸が重ならないようにしてある。
const RING_SPECS = [
  { radius: 1.0, tilt: [Math.PI / 2, 0, 0], axis: [0, 1, 0], rate: 0.5, spin: -0.9, from: [1.6, 0] },
  { radius: 1.3, tilt: [0.35, 0.9, 0], axis: [1, 0, 0], rate: -0.38, spin: 0.6, from: [0, -1.8] },
  { radius: 1.6, tilt: [-0.8, -0.4, 0.3], axis: [0.7071, 0.7071, 0], rate: 0.3, spin: -0.45, from: [-1.7, 0.6] },
  { radius: 1.9, tilt: [1.1, 0.5, 0], axis: [0, 0, 1], rate: -0.24, spin: 0.35, from: [0.8, 1.6] },
  { radius: 2.2, tilt: [0.2, -1.2, 0.4], axis: [0, 0.7071, 0.7071], rate: 0.18, spin: -0.25, from: [-1.2, -1.4] },
];
const STACK_COUNT = 5;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 40, cameraZ: 10, background: p.background, preview: p.preview, bloom: { strength: 0.5, radius: 0.25, threshold: 0.3 } });
  const useNoise = p.noise > 0;
  const noise = createNoisePass({ scan: 0.4 * p.noise, grain: 0.14 * p.noise, shift: 0.0024 * p.noise, auto: useNoise && !stage.reduced ? 5 : 0 });
  stage.addPass(noise.pass);

  const accentColor = new THREE.Color(p.accent);
  const hotColor = new THREE.Color(p.hot);
  const accentMats = [];
  const line = (geometry, opacity = 1, extra) => new THREE.Mesh(geometry, glow(p.color, opacity, extra));
  const accent = (geometry, opacity = 1) => {
    const mesh = new THREE.Mesh(geometry, glow(p.accent, opacity));
    accentMats.push(mesh.material);
    return mesh;
  };

  const root = new THREE.Group();
  stage.scene.add(root);
  // 登場のときに 1 本ずつ動かす部品。t が 0 から 1 になる間に、別々の向きから回り込む。
  const intros = [];
  function withIntro(child, from) {
    const group = new THREE.Group();
    group.add(child);
    root.add(group);
    intros.push({ group, from, t: stage.reduced ? 1 : 0 });
    return group;
  }

  // 輪の上に載る小さな輪。standing が真なら、大きな輪の面から立ち上がる。
  function miniRing(radius, standing) {
    const holder = new THREE.Group();
    if (standing) holder.rotation.x = Math.PI / 2;
    const spinner = new THREE.Group();
    spinner.add(line(ringBand(radius * 0.8, radius), 0.9), accent(tickRing(radius * 0.74, 12, radius * 0.2, 0.012), 0.8), line(polygonOutline(radius * 0.4, 6, 0.012), 0.7));
    holder.add(spinner);
    return { holder, spinner };
  }

  const rings = RING_SPECS.slice(0, p.rings).map((spec, index) => {
    const r = spec.radius;
    const precess = new THREE.Group();
    const pivot = new THREE.Group();
    pivot.rotation.set(...spec.tilt);
    const spinner = new THREE.Group();
    spinner.add(line(ringBand(r - 0.04, r), 0.95), line(tickRing(r - 0.07, 60 + index * 12, 0.05, 0.012, { major: { every: 6 } }), 0.55));
    spinner.add(accent(circuitRing(r + 0.035, r + 0.15, 30 + index * 8, 11 + index * 7), 0.7));
    if (index % 2 === 0) spinner.add(line(segmentRing(r - 0.2, r - 0.15, 6 + index * 2, { fill: 0.55 }), 0.5));
    else {
      const count = 24;
      const width = 0.11;
      const map = glyphStrip({ count, seed: 5 + index * 3 });
      map.repeat.x = Math.max(1, Math.round((TAU * r) / ((width * count) / 1.5)));
      spinner.add(line(flatBand(r - 0.24, r - 0.24 + width), 0.75, { map }));
    }
    const minis = [0, 1, 2].map((j) => {
      const mini = miniRing(0.13 + (j % 2) * 0.04, (index + j) % 2 === 0);
      const angle = (j / 3) * TAU + index * 0.9;
      mini.holder.position.set(Math.cos(angle) * r, Math.sin(angle) * r, 0);
      mini.holder.rotation.z = angle;
      spinner.add(mini.holder);
      return mini.spinner;
    });
    pivot.add(spinner);
    precess.add(pivot);
    withIntro(precess, spec.from);
    return { precess, pivot, spinner, minis, fold: { v: 0 }, baseTilt: pivot.quaternion.clone(), axis: new THREE.Vector3(...spec.axis).normalize(), rate: spec.rate, spin: spec.spin };
  });

  // 上下の柱。小さな輪を、外へ行くほど細く積む。
  const stacks = [];
  for (const sign of [1, -1]) {
    for (let k = 0; k < STACK_COUNT; k += 1) {
      const radius = 0.72 - k * 0.11;
      const flat = new THREE.Group();
      flat.rotation.x = -Math.PI / 2;
      const spinner = new THREE.Group();
      spinner.add(line(ringBand(radius - 0.03, radius), 0.9));
      spinner.add(k % 2 === 0 ? accent(segmentRing(radius - 0.12, radius - 0.07, 5 + k, { fill: 0.6 }), 0.75) : line(tickRing(radius - 0.05, 24, 0.05, 0.012), 0.6));
      flat.add(spinner);
      const baseY = sign * (2.1 + k * 0.25);
      flat.position.y = baseY;
      withIntro(flat, [0, sign * (1.2 + k * 0.5)]);
      stacks.push({ flat, spinner, baseY, sign, k, off: { v: 0 }, dir: (k % 2 === 0 ? 1 : -1) * sign });
    }
  }
  const axisLine = line(new THREE.CylinderGeometry(0.008, 0.008, 6.6, 6), 0.3);
  root.add(axisLine);

  // 足場になる方眼と、いちばん外の回路の縁。
  const deck = new THREE.Group();
  deck.rotation.x = -Math.PI / 2;
  const deckSpin = new THREE.Group();
  deckSpin.add(line(gridDisc(2.45, 8, 0.008), 0.1), accent(circuitRing(2.5, 2.64, 64, 3, { density: 0.7 }), 0.55), line(ringBand(2.47, 2.485), 0.5));
  deck.add(deckSpin);
  root.add(deck);
  const waves = [0, 0.5].map((offset) => {
    const wave = line(ringBand(0.97, 1), 0);
    deck.add(wave);
    return { wave, offset };
  });
  // 再点火のときに 1 回だけ走る、衝撃の輪。
  const blast = line(ringBand(0.94, 1), 0);
  deck.add(blast);

  // 核。線の多面体の中で、光る立体が脈打つ。
  const cage = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.46, 1)), new THREE.LineBasicMaterial({ color: p.color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  const heart = accent(new THREE.OctahedronGeometry(0.2, 0), 0.6);
  const halo = accent(new THREE.SphereGeometry(0.26, 24, 16), 0.1);
  root.add(cage, heart, halo);

  const state = { over: 0, kick: 0, blast: 1, flash: 0, tone: 0, tiltX: 0, tiltY: 0 };
  const baseBloom = stage.bloomPass?.strength ?? 0;
  const flatQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const foldQuat = new THREE.Quaternion();
  let fit = 1;
  stage.onResize(() => {
    const view = stage.viewport();
    fit = Math.min(1, view.width / 6, view.height / 7.2);
  });

  stage.onFrame((time, dt) => {
    noise.update(time, dt);
    if (useNoise && state.over > 0.25) noise.burst(state.over * 0.7);
    const step = dt * p.speed * (1 + state.over * 6);
    const pulse = 0.5 + 0.5 * Math.sin(time * (2.4 + state.over * 9));
    for (const ring of rings) {
      ring.precess.rotateOnAxis(ring.axis, step * ring.rate);
      ring.spinner.rotation.z += step * ring.spin;
      ring.minis.forEach((mini, j) => { mini.rotation.z += step * (1.4 + j * 0.7); });
      // 封じ込めのあいだは、歳差の向きを打ち消して、足場と同じ面へ倒す。
      foldQuat.copy(ring.precess.quaternion).invert().multiply(flatQuat);
      ring.pivot.quaternion.copy(ring.baseTilt).slerp(foldQuat, Math.min(1, Math.max(0, ring.fold.v)));
    }
    for (const item of stacks) {
      item.spinner.rotation.z += step * item.dir * (0.6 + item.k * 0.25);
      item.flat.position.y = item.baseY + item.sign * (pulse * 0.035 * item.k + item.off.v * (item.off.v < 0 ? 0.85 : 0.32));
    }
    deckSpin.rotation.z -= step * 0.06;
    for (const { wave, offset } of waves) {
      const phase = (time * 0.4 * (1 + state.over * 2) + offset) % 1;
      wave.scale.setScalar(0.45 + phase * 2.1);
      wave.material.opacity = (1 - phase) * 0.55;
    }
    for (const item of intros) {
      const rest = 1 - item.t;
      item.group.visible = item.t > 0.001;
      item.group.rotation.set(rest * item.from[0], rest * item.from[1], 0);
      item.group.scale.setScalar(Math.max(0.001, item.t));
    }
    cage.rotation.set(time * 0.3, time * 0.42, 0);
    heart.rotation.set(time * 1.1, time * 0.8, 0);
    heart.scale.setScalar(1 + pulse * 0.35 + state.over * 0.5 + state.flash * 0.8);
    blast.scale.setScalar(0.4 + state.blast * 2.4);
    blast.material.opacity = state.blast < 1 ? (1 - state.blast) * 0.95 : 0;
    if (stage.bloomPass) stage.bloomPass.strength = baseBloom + state.flash * 0.12;
    halo.scale.setScalar(1 + pulse * 0.25 + state.over * 0.4);
    for (const material of accentMats) material.color.copy(accentColor).lerp(hotColor, Math.max(state.over, state.tone * 0.7));
    root.rotation.set(0.3 + Math.sin(time * 0.23) * 0.1 - stage.pointer.sy * 0.3 + state.tiltX, time * 0.1 + stage.pointer.sx * 0.5 + state.tiltY, Math.sin(time * 0.17) * 0.06);
    root.scale.setScalar(fit * (1 + state.kick));
  });

  // 封じ込めと再点火。輪が順に足場の面へ倒れ、柱が核へ寄り、映像が乱れる（準備）→ 核が光って衝撃の輪が走り、
  // 柱が外へ弾かれる（山場）→ 輪が元の軸へ揺れながら戻り、差し色が入れ替わって落ち着く（余韻）。
  let tone = 0;
  function overload(event) {
    if (stage.reduced) return;
    const rect = container.getBoundingClientRect();
    const nx = event?.clientX === undefined ? 0 : ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = event?.clientY === undefined ? 0 : ((event.clientY - rect.top) / rect.height) * 2 - 1;
    const folds = rings.map((ring) => ring.fold);
    const offs = stacks.map((item) => item.off);
    utils.remove([state, ...folds, ...offs]);
    tone = 1 - tone;
    state.blast = 1;
    animate(state, {
      over: [
        { to: 1, duration: 520, ease: 'inQuad' },
        { to: 1, duration: 180 },
        { to: 0, duration: 2200, ease: 'inOutSine' },
      ],
    });
    animate(state, {
      kick: [
        { to: -0.07, duration: 560, ease: 'inOutQuad' },
        { to: 0.13, duration: 130, ease: 'outQuad' },
        { to: 0, duration: 1300, ease: 'outElastic(1, .4)' },
      ],
    });
    animate(state, {
      flash: [
        { to: 1, duration: 110, delay: 600, ease: 'outQuad' },
        { to: 0, duration: 800, ease: 'outQuad' },
      ],
    });
    animate(state, { blast: [0, 1], duration: 1100, delay: 620, ease: 'outExpo' });
    animate(state, { tone, duration: 500, delay: 640, ease: 'outQuad' });
    animate(state, {
      tiltX: [{ to: ny * 0.3, duration: 320, ease: 'outQuad' }, { to: 0, duration: 1700, ease: 'outElastic(1, .55)' }],
      tiltY: [{ to: nx * 0.4, duration: 320, ease: 'outQuad' }, { to: 0, duration: 1700, ease: 'outElastic(1, .55)' }],
    });
    animate(folds, {
      v: [
        { to: 1, duration: 460, ease: 'inOutQuart' },
        { to: 1, duration: 140 },
        { to: 0, duration: 1300, ease: 'outElastic(1, .5)' },
      ],
      delay: stagger(70),
    });
    animate(offs, {
      v: [
        { to: -1, duration: 480, ease: 'inQuad' },
        { to: 1, duration: 200, ease: 'outExpo' },
        { to: 0, duration: 1200, ease: 'outElastic(1, .45)' },
      ],
      delay: (_, i) => 60 + (i % STACK_COUNT) * 35,
    });
    if (useNoise) noise.burst(1.4);
  }
  container.addEventListener('pointerdown', overload);

  let timer = 0;
  if (!stage.reduced) {
    animate(intros, { t: 1, duration: 1500, delay: stagger(110), ease: 'outExpo' });
    if (p.preview) timer = setInterval(overload, 5200);
  }

  return {
    overload,
    destroy() {
      clearInterval(timer);
      container.removeEventListener('pointerdown', overload);
      utils.remove([state, ...rings.map((ring) => ring.fold), ...stacks.map((item) => item.off)]);
      utils.remove(intros);
      stage.destroy();
    },
  };
}
