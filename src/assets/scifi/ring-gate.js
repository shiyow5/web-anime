import * as THREE from 'three';
import { animate, spring, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { TAU, canvasTexture, circuitRing, flatBand, glow, glyphStrip, gridDisc, polygonOutline, ringBand, seeded, segmentRing, tickRing } from '../../lib/holo.js';
import { createNoisePass } from '../../lib/postfx.js';

export const meta = {
  id: 'ring-gate',
  title: '輪の門',
  category: 'scifi',
  libs: ['three', 'animejs'],
  description:
    '大きさの違う輪が奥へ連なり、輪ごとに違う軸で傾いています。手前から順に、ねじれるように 1 回転して正面を向き、すべてが一直線にそろうと中央に光の道が開きます。しばらくすると閉じて崩れ、また繰り返します。クリックすると最初からやり直します。転送や場面の切り替えに使えます。',
  params: {
    color: { type: 'color', label: '線の色', default: '#d6f2ff' },
    accent: { type: 'color', label: '差し色', default: '#8a8bff' },
    core: { type: 'color', label: '中央の光の色', default: '#ff9ad8' },
    background: { type: 'color', label: '背景色', default: '#05050e' },
    rings: { type: 'range', label: '輪の本数', min: 4, max: 9, step: 1, default: 7 },
    speed: { type: 'range', label: '回る速さ', min: 0.3, max: 3, step: 0.1, default: 1 },
    hold: { type: 'range', label: '開いている時間（秒）', min: 0.5, max: 8, step: 0.1, default: 2.6 },
  },
};

const SPACING = 1.1;
const SNAP = Math.PI / 3;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 42, cameraZ: 9.5, background: p.background, preview: p.preview, bloom: { strength: 0.38, radius: 0.3, threshold: 0.3 } });
  const noise = createNoisePass({ scan: 0.18, grain: 0.06, shift: 0.001, auto: stage.reduced ? 0 : 7 });
  stage.addPass(noise.pass);
  const random = seeded(19);

  const line = (geometry, opacity = 1, extra) => new THREE.Mesh(geometry, glow(p.color, opacity, extra));
  const accent = (geometry, opacity = 1, extra) => new THREE.Mesh(geometry, glow(p.accent, opacity, extra));
  const core = (geometry, opacity = 1, extra) => new THREE.Mesh(geometry, glow(p.core, opacity, extra));

  const rig = new THREE.Group();
  const row = new THREE.Group();
  rig.add(row);
  rig.position.z = -1.5;
  stage.scene.add(rig);
  const count = p.rings;
  const span = (count - 1) * SPACING;

  const miniSpinners = [];
  const rings = Array.from({ length: count }, (_, i) => {
    const R = 1.9 - i * 0.13 - (i % 2) * 0.16;
    const holder = new THREE.Group();
    holder.position.z = span / 2 - i * SPACING;
    const intro = new THREE.Group();
    const tilt = new THREE.Group();
    const spinner = new THREE.Group();
    spinner.add(line(ringBand(R - 0.03, R), 0.75));
    if (i % 3 === 0) spinner.add(accent(circuitRing(R + 0.03, R + 0.16, 28 + i * 4, 3 + i * 5), 0.75), line(tickRing(R - 0.06, 48, 0.05, 0.012, { major: { every: 4 } }), 0.5));
    else if (i % 3 === 1) spinner.add(accent(segmentRing(R + 0.04, R + 0.1, 6 + i, { fill: 0.62 }), 0.8), line(ringBand(R - 0.13, R - 0.118), 0.5));
    else {
      const map = glyphStrip({ count: 24, seed: 8 + i });
      map.repeat.x = Math.max(1, Math.round((TAU * R) / 1.76));
      spinner.add(line(flatBand(R + 0.04, R + 0.15), 0.7, { map }), accent(tickRing(R - 0.06, 36, 0.06, 0.014), 0.7));
    }
    // 輪の上に載る小さな輪。輪の面から立ち上がって、自分の軸で回る。
    for (let j = 0; j < 2 + (i % 2); j += 1) {
      const angle = (j / (2 + (i % 2))) * TAU + i * 1.1;
      const mini = new THREE.Group();
      mini.position.set(Math.cos(angle) * R, Math.sin(angle) * R, 0);
      mini.rotation.set(Math.PI / 2, 0, angle, 'ZXY');
      const miniSpin = new THREE.Group();
      miniSpin.add(line(ringBand(0.1, 0.125), 0.85), accent(polygonOutline(0.06, 6, 0.012), 0.9));
      mini.add(miniSpin);
      spinner.add(mini);
      miniSpinners.push(miniSpin);
    }
    // そろったときに光る、内側の絞り。
    const iris = core(ringBand(R * 0.46, R * 0.46 + 0.03), 0);
    tilt.add(spinner, iris);
    intro.add(tilt);
    holder.add(intro);
    row.add(holder);
    const axisAngle = i * 2.4;
    return {
      index: i,
      intro,
      tilt,
      spinner,
      iris,
      axis: new THREE.Vector3(Math.cos(axisAngle), Math.sin(axisAngle), 0),
      rate: (0.5 + random() * 0.5) * (i % 2 ? -1 : 1),
      phase: random() * TAU,
      dir: i % 2 ? -1 : 1,
      angle: stage.reduced ? 0 : (0.55 + random() * 0.55) * (i % 2 ? -1 : 1),
      t: stage.reduced ? 1 : 0,
      fx: { kick: 0 },
    };
  });

  // 中央の光の道。細い筒を重ねて芯を明るくし、奥に光の源を置く。
  const beams = [0.06, 0.13, 0.22].map((radius) => {
    const geometry = new THREE.CylinderGeometry(radius, radius * 0.7, span + 1.2, 24, 1, true);
    geometry.rotateX(Math.PI / 2);
    const beam = core(geometry, 0);
    row.add(beam);
    return beam;
  });
  const flareMap = canvasTexture(128, 128, (ctx) => {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  });
  const flare = core(new THREE.PlaneGeometry(1, 1), 0, { map: flareMap });
  flare.position.z = -span / 2 - 0.7;
  row.add(flare);
  const pulses = [0, 1, 2].map((k) => {
    const pulse = core(ringBand(0.5, 0.53), 0);
    row.add(pulse);
    return { pulse, offset: k / 3 };
  });

  // 奥の壁の方眼と、輪をつなぐ細い桟。
  const wall = new THREE.Group();
  wall.position.z = -span / 2 - 1.0;
  wall.add(line(gridDisc(2.0, 8, 0.01), 0.09), accent(circuitRing(2.02, 2.16, 52, 41, { density: 0.65 }), 0.4), line(ringBand(1.98, 2.0), 0.4));
  row.add(wall);
  for (let k = 0; k < 3; k += 1) {
    const angle = (k / 3) * TAU - Math.PI / 2;
    const rail = new THREE.CylinderGeometry(0.008, 0.008, span + 0.5, 5);
    rail.rotateX(Math.PI / 2);
    const mesh = line(rail, 0.28);
    mesh.position.set(Math.cos(angle) * 2.1, Math.sin(angle) * 2.1, 0);
    row.add(mesh);
  }

  const gate = { open: stage.reduced ? 1 : 0, turn: 0 };
  let timer = 0;
  stage.onResize(() => {
    const view = stage.viewport();
    rig.scale.setScalar(Math.min(1, view.width / 9.4, view.height / 5.8));
  });

  function stopAll() {
    clearTimeout(timer);
    utils.remove(rings);
    utils.remove(gate);
    for (const ring of rings) utils.remove(ring.fx);
  }
  // 閉じる。光が消え、輪は別々の軸でばらばらに傾く。
  function close() {
    animate(gate, { open: 0, duration: 700, ease: 'inQuad' });
    animate(rings, {
      angle: (ring) => (0.55 + Math.random() * 0.55) * ring.dir,
      duration: 1500,
      delay: stagger(90),
      ease: 'inOutSine',
      onComplete: () => { timer = setTimeout(align, 900); },
    });
  }
  // 開く。輪がばねで弾み、中央に光の道が通る。
  function open() {
    animate(gate, { open: 1, duration: 900, ease: 'outExpo' });
    rings.forEach((ring, i) => {
      ring.fx.kick = 0.14;
      animate(ring.fx, { kick: 0, delay: i * 70, ease: spring({ stiffness: 160, damping: 8 }) });
    });
    noise.burst(0.9);
    timer = setTimeout(close, p.hold * 1000);
  }
  // そろえる。手前から順に、自分の軸で 1 回転しながら正面を向く。
  function align() {
    // 1 回転ぶん足しても見た目は同じなので、ここから 0 まで戻すと 1 回転して収まる。
    for (const ring of rings) ring.angle += TAU * ring.dir;
    animate(rings, { angle: 0, duration: 2000 / p.speed, delay: stagger(240 / p.speed), ease: 'inOutQuart', onComplete: open });
  }
  function activate() {
    if (stage.reduced) return;
    stopAll();
    if (gate.open > 0.02) animate(gate, { open: 0, duration: 250, ease: 'outQuad' });
    for (const ring of rings) {
      ring.t = 1;
      ring.fx.kick = 0;
      ring.angle %= TAU;
    }
    align();
  }

  const rotation = new THREE.Quaternion();
  stage.onFrame((time, dt) => {
    noise.update(time, dt);
    const openAmount = Math.min(1, Math.max(0, gate.open));
    gate.turn += dt * 0.5 * openAmount * p.speed;
    for (const ring of rings) {
      const off = Math.min(1, Math.abs(ring.angle) / 0.6);
      ring.phase += dt * ring.rate * p.speed * off;
      const snapped = Math.round(ring.phase / SNAP) * SNAP;
      ring.spinner.rotation.z = ring.phase + (snapped - ring.phase) * (1 - off) + gate.turn;
      const sway = Math.sin(time * 0.8 + ring.index * 1.3) * 0.1 * off;
      ring.tilt.quaternion.copy(rotation.setFromAxisAngle(ring.axis, ring.angle + sway));
      const rest = 1 - ring.t;
      ring.intro.visible = ring.t > 0.001;
      ring.intro.rotation.set(rest * 1.6 * ring.dir, rest * 1.2, rest * 2 * ring.dir);
      ring.intro.scale.setScalar(Math.max(0.001, ring.t) * (1 + ring.fx.kick));
      ring.iris.material.opacity = openAmount * 0.55;
      ring.iris.scale.setScalar(1 + (1 - openAmount) * 0.5 + Math.sin(time * 3 - ring.index * 0.7) * 0.04);
    }
    miniSpinners.forEach((mini, i) => { mini.rotation.z = time * (1.3 + (i % 4) * 0.5) * p.speed; });
    beams.forEach((beam, i) => { beam.material.opacity = openAmount * (0.16 - i * 0.045) * (0.85 + 0.15 * Math.sin(time * 9 + i)); });
    flare.material.opacity = openAmount * 0.6;
    flare.scale.setScalar(0.4 + openAmount * 2.0 + Math.sin(time * 5) * 0.1);
    for (const { pulse, offset } of pulses) {
      const travel = (time * 0.7 + offset) % 1;
      pulse.position.z = span / 2 + 0.4 - travel * (span + 1);
      pulse.scale.setScalar(1.5 - travel * 0.9);
      pulse.material.opacity = openAmount * Math.sin(travel * Math.PI) * 0.8;
    }
    wall.rotation.z = time * 0.05;
    // 斜めから見る。止めていても奥行きが分かるように、ゆっくり向きを変える。
    rig.rotation.set(0.1 + Math.sin(time * 0.27) * 0.05 - stage.pointer.sy * 0.18, 0.38 + Math.sin(time * 0.19) * 0.12 + stage.pointer.sx * 0.2, 0);
  });

  container.addEventListener('pointerdown', activate);
  if (!stage.reduced) {
    // 登場。輪が 1 本ずつ、別々の向きから回り込んで列に収まる。
    animate(rings, { t: 1, duration: 1200, delay: stagger(110), ease: 'outExpo' });
    timer = setTimeout(align, 1200 + count * 110);
  }

  return {
    activate,
    destroy() {
      stopAll();
      container.removeEventListener('pointerdown', activate);
      stage.destroy();
    },
  };
}
