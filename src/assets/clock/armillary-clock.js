import * as THREE from 'three';
import { animate, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { TAU, canvasTexture, flatBand, glow, ringBand, seeded, segmentRing, strokes, tickRing, wallBand } from '../../lib/holo.js';

export const meta = {
  id: 'armillary-clock',
  title: '渾天儀の時計',
  category: 'clock',
  libs: ['three', 'animejs'],
  description:
    '時・分・秒の輪が入れ子になり、それぞれ別の軸で回る渾天儀の時計です。輪には目盛りと数字が刻まれ、輪の上を進む白い玉がいまの時刻を指し、中央には数字でも時刻が出ます。ポインターで全体が傾き、クリックすると 3 本の輪が 1 回転して元の向きに戻ります。',
  params: {
    gold: { type: 'color', label: '金の色', default: '#e9b44c' },
    white: { type: 'color', label: '白の色', default: '#fff4dc' },
    background: { type: 'color', label: '背景色', default: '#050403' },
    format: {
      type: 'select',
      label: '中央の数字',
      options: [
        { value: '24', label: '24 時間' },
        { value: '12', label: '12 時間' },
      ],
      default: '24',
    },
    speed: { type: 'range', label: '輪が回る速さ', min: 0, max: 3, step: 0.1, default: 1 },
    glow: { type: 'range', label: '光のにじみ', min: 0, max: 1.5, step: 0.05, default: 0.45 },
  },
};

const FONT = '"Bricolage Grotesque Variable", "Helvetica Neue", Arial, system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const pad = (n) => String(n).padStart(2, '0');
// 12 時の位置を 0 として、時計回りに進んだ割合から角度を求める。
const angleAt = (frac) => Math.PI / 2 - frac * TAU;

// 時・分・秒の印が、それぞれの輪を何割まで進んだかを返す（12 時の位置が 0、時計回り）。
export function ringFractions(date) {
  const second = date.getSeconds();
  const minute = date.getMinutes() + second / 60;
  const hour = (date.getHours() % 12) + minute / 60;
  return { hour: hour / 12, minute: minute / 60, second: second / 60 };
}

// 数字を円周に沿って並べた帯。flatBand は反時計回りに貼るので、1 文字ずつ左右を返して描く。
function numeralBand(labels, inner, outer, color, font) {
  const width = 2048;
  const height = 64;
  const stretch = width / (TAU * ((inner + outer) / 2)) / (height / (outer - inner));
  const texture = canvasTexture(width, height, (ctx) => {
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(height * 0.78)}px ${font}`;
    labels.forEach((label, i) => {
      const u = (((angleAt(i / labels.length) / TAU) % 1) + 1) % 1;
      // 継ぎ目にかかる文字は、両端に半分ずつ描く。
      for (const x of [u - 1, u, u + 1]) {
        ctx.save();
        ctx.translate(x * width, height / 2 + 3);
        ctx.scale(-stretch, 1);
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    });
  });
  return new THREE.Mesh(flatBand(inner, outer), glow('#ffffff', 1, { map: texture }));
}

// 厚みのある輪。平らな帯と、縁に立てた薄い壁を組み合わせ、真横から見ても消えないようにする。
function buildRing({ radius, width, color, pale, ticks, every, labels = null, font = FONT, blocks = 0 }) {
  const group = new THREE.Group();
  const inner = radius - width / 2;
  const outer = radius + width / 2;
  group.add(new THREE.Mesh(ringBand(inner, outer), glow(color, 0.08)));
  group.add(new THREE.Mesh(ringBand(outer - 0.016, outer), glow(color, 0.95)));
  group.add(new THREE.Mesh(ringBand(inner, inner + 0.011), glow(color, 0.8)));
  group.add(new THREE.Mesh(tickRing(inner + 0.012, ticks, width * 0.16, 0.007, { inward: false, start: Math.PI / 2, major: { every, length: width * 0.3, width: 0.013 } }), glow(pale, 0.85)));
  if (labels) group.add(numeralBand(labels, inner + width * 0.34, outer - 0.03, color, font));
  if (blocks) group.add(new THREE.Mesh(segmentRing(inner + width * 0.45, outer - 0.035, blocks, { fill: 0.72, start: Math.PI / 2 }), glow(color, 0.3)));
  for (const [r, opacity] of [
    [outer, 0.3],
    [inner, 0.18],
  ]) {
    const wall = new THREE.Mesh(wallBand(r, 0.07, 96), glow(color, opacity));
    wall.rotation.x = Math.PI / 2;
    group.add(wall);
  }
  return group;
}

// 輪の上を進む印。白い玉と、それを囲む小さな輪、内側へ向く矢。角度 0（+X）の位置に作り、Group ごと回す。
function buildMarker(radius, width, white, gold) {
  const group = new THREE.Group();
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.062, 16, 12), new THREE.MeshBasicMaterial({ color: white }));
  bead.position.x = radius;
  const halo = new THREE.Mesh(ringBand(0.1, 0.116), glow(gold, 0.95));
  halo.position.x = radius;
  const upright = new THREE.Mesh(ringBand(0.1, 0.116), glow(gold, 0.7));
  upright.position.x = radius;
  upright.rotation.x = Math.PI / 2;
  const tip = radius - width / 2 - 0.12;
  const arrow = new THREE.Mesh(
    strokes(
      [
        [radius - width / 2 - 0.01, 0.05, tip, 0],
        [radius - width / 2 - 0.01, -0.05, tip, 0],
        [radius + width / 2 + 0.02, 0, radius + width / 2 + 0.13, 0],
      ],
      0.016,
    ),
    glow(white, 0.95),
  );
  group.add(bead, halo, upright, arrow);
  return { group, bead };
}

// 輪どうしをつなぐ軸の棒。
function pin(from, to, color) {
  const direction = to.clone().sub(from);
  const length = direction.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, length, 8), glow(color, 0.9));
  mesh.position.copy(from).addScaledVector(direction, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}
const pinPair = (direction, from, to, color) => [1, -1].map((sign) => pin(direction.clone().multiplyScalar(from * sign), direction.clone().multiplyScalar(to * sign), color));

function drawFace(ctx, width, height, date, hours24, white, gold) {
  ctx.clearRect(0, 0, width, height);
  const hour = hours24 ? date.getHours() : date.getHours() % 12 || 12;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = white;
  ctx.font = `700 ${Math.round(height * 0.5)}px ${FONT}`;
  ctx.fillText(`${pad(hour)}:${pad(date.getMinutes())}`, width / 2, height * 0.4);
  ctx.fillStyle = gold;
  ctx.font = `600 ${Math.round(height * 0.17)}px ${MONO}`;
  const tail = hours24 ? '' : date.getHours() < 12 ? '  AM' : '  PM';
  ctx.fillText(`· ${pad(date.getSeconds())} ·${tail}`, width / 2, height * 0.82);
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 40, cameraZ: 8, background: p.background, preview: p.preview, bloom: { strength: p.glow * (p.preview ? 0.6 : 1), radius: 0.3, threshold: 0.25 } });
  const hours24 = p.format === '24';

  const system = new THREE.Group();
  const face = new THREE.Group();
  stage.scene.add(system, face);

  // 動かない外枠。子午線の輪（縦）と地平の輪（横）。
  const frame = new THREE.Group();
  const meridian = new THREE.Group();
  meridian.add(new THREE.Mesh(ringBand(2.4, 2.416), glow(p.gold, 0.7)));
  meridian.add(new THREE.Mesh(ringBand(2.47, 2.48), glow(p.gold, 0.4)));
  meridian.add(new THREE.Mesh(tickRing(2.4, 72, 0.05, 0.007, { inward: false, major: { every: 6, length: 0.07, width: 0.012 } }), glow(p.white, 0.5)));
  const horizon = new THREE.Group();
  horizon.rotation.x = -Math.PI / 2;
  horizon.add(new THREE.Mesh(ringBand(2.4, 2.416), glow(p.gold, 0.6)));
  horizon.add(new THREE.Mesh(segmentRing(2.43, 2.5, 24, { fill: 0.86 }), glow(p.gold, 0.16)));
  horizon.add(new THREE.Mesh(tickRing(2.5, 120, 0.035, 0.006, { major: { every: 5 } }), glow(p.white, 0.4)));
  const horizonWall = new THREE.Mesh(wallBand(2.5, 0.05, 96), glow(p.gold, 0.22));
  horizonWall.rotation.x = Math.PI / 2;
  horizon.add(horizonWall);
  frame.add(meridian, horizon);

  // 入れ子の輪。時（縦軸）の中に分（横軸）、その中に秒（斜めの軸）。
  const axisY = new THREE.Vector3(0, 1, 0);
  const axisX = new THREE.Vector3(1, 0, 0);
  const axisD = new THREE.Vector3(1, 1, 0).normalize();
  const hourGimbal = new THREE.Group();
  const minuteGimbal = new THREE.Group();
  const secondGimbal = new THREE.Group();
  const hourLabels = ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
  const minuteLabels = Array.from({ length: 12 }, (_, i) => pad(i * 5));
  hourGimbal.add(buildRing({ radius: 2.0, width: 0.3, color: p.gold, pale: p.white, ticks: 60, every: 5, labels: hourLabels }));
  minuteGimbal.add(buildRing({ radius: 1.56, width: 0.24, color: p.gold, pale: p.white, ticks: 60, every: 5, labels: minuteLabels, font: MONO }));
  secondGimbal.add(buildRing({ radius: 1.2, width: 0.14, color: p.gold, pale: p.white, ticks: 60, every: 5, blocks: 60 }));
  const markers = {
    hour: buildMarker(2.0, 0.3, p.white, p.gold),
    minute: buildMarker(1.56, 0.24, p.white, p.gold),
    second: buildMarker(1.2, 0.14, p.white, p.gold),
  };
  hourGimbal.add(markers.hour.group, minuteGimbal, ...pinPair(axisX, 1.68, 1.85, p.white));
  minuteGimbal.add(markers.minute.group, secondGimbal, ...pinPair(axisD, 1.27, 1.44, p.white));
  secondGimbal.add(markers.second.group);
  system.add(frame, hourGimbal, ...pinPair(axisY, 2.15, 2.4, p.white));

  // 背景の細かな星。
  const random = seeded(7);
  const starCount = p.preview ? 60 : 160;
  const starPositions = [];
  for (let i = 0; i < starCount; i += 1) starPositions.push((random() - 0.5) * 12, (random() - 0.5) * 8, -2 - random() * 4);
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: p.gold, size: 0.035, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  stage.scene.add(stars);

  // 中央の数字。輪と一緒には回さず、いつも正面を向かせる。
  const faceTexture = canvasTexture(512, 256, () => {});
  const faceCtx = faceTexture.image.getContext('2d');
  const facePlane = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.85), glow('#ffffff', 1, { map: faceTexture }));
  face.add(facePlane);

  const enter = [0, 1, 2, 3].map(() => ({ e: stage.reduced ? 1 : 0 }));
  const hand = { second: 0, pulse: 0 };
  const flourish = { v: 0 };
  let target = 0;
  let lastSecond = -1;
  let phase = 0;

  function syncClock(first) {
    const now = new Date();
    const second = now.getSeconds();
    if (second === lastSecond) return now;
    lastSecond = second;
    if (faceCtx) drawFace(faceCtx, 512, 256, now, hours24, p.white, p.gold);
    faceTexture.needsUpdate = true;
    // 秒の印は 1 秒ごとに、少し行き過ぎてから戻る動きで進める。
    target += first ? second : (second - (target % 60) + 60) % 60;
    if (first || stage.reduced) {
      hand.second = target;
    } else {
      animate(hand, { second: target, duration: 420, ease: 'outBack(2.4)' });
      animate(hand, { pulse: [1, 0], duration: 700, ease: 'outQuad' });
    }
    return now;
  }
  syncClock(true);

  stage.onResize(() => {
    const view = stage.viewport();
    const scale = Math.min(1, view.width / 5.5, view.height / 5.5);
    system.scale.setScalar(scale);
    face.scale.setScalar(scale);
  });

  const spinQuat = new THREE.Quaternion();
  stage.onFrame((time, dt) => {
    phase += dt * p.speed;
    const now = syncClock(false);
    const fractions = ringFractions(now);
    markers.hour.group.rotation.z = angleAt(fractions.hour);
    markers.minute.group.rotation.z = angleAt(fractions.minute);
    markers.second.group.rotation.z = angleAt(hand.second / 60);
    markers.second.bead.scale.setScalar(1 + hand.pulse * 0.9);

    // 登場のときは、輪ごとに別の向きから回り込んで定位置に収まる。
    const turn = flourish.v * TAU;
    const [e0, e1, e2, e3] = enter.map((state) => state.e);
    frame.scale.setScalar(Math.max(0.001, e0));
    frame.rotation.z = (1 - e0) * -1.2;
    hourGimbal.scale.setScalar(Math.max(0.001, e1));
    hourGimbal.rotation.y = 0.55 + phase * 0.13 + (1 - e1) * 2.6 + turn;
    minuteGimbal.scale.setScalar(Math.max(0.001, e2));
    minuteGimbal.rotation.x = 0.95 + phase * 0.21 - (1 - e2) * 2.6 - turn;
    secondGimbal.scale.setScalar(Math.max(0.001, e3));
    secondGimbal.quaternion.copy(spinQuat.setFromAxisAngle(axisD, 2.1 + phase * 0.34 + (1 - e3) * 2.6 + turn));
    facePlane.scale.setScalar(Math.max(0.001, e3));

    system.rotation.x = 0.3 + Math.sin(phase * 0.21) * 0.1 - stage.pointer.sy * 0.35;
    system.rotation.y = Math.sin(phase * 0.17) * 0.4 + stage.pointer.sx * 0.5;
    stars.rotation.z = time * 0.01;
  });

  function spin() {
    if (stage.reduced) return;
    utils.remove(flourish);
    flourish.v = 0;
    animate(flourish, { v: 1, duration: 2600, ease: 'inOutQuart', onComplete: () => (flourish.v = 0) });
  }
  container.addEventListener('pointerdown', spin);

  if (!stage.reduced) animate(enter, { e: 1, duration: 1900, delay: stagger(240), ease: 'outExpo' });

  return {
    spin,
    destroy() {
      container.removeEventListener('pointerdown', spin);
      utils.remove([hand, flourish, ...enter]);
      stage.destroy();
    },
  };
}
