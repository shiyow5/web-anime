import * as THREE from 'three';
import { animate, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { TAU, canvasTexture, flatBand, glow, ringBand, seeded, segmentRing, strokes, tickRing, wallBand } from '../../lib/holo.js';

export const meta = {
  id: 'astrolabe',
  title: 'アストロラーベ',
  category: 'science',
  libs: ['three', 'animejs'],
  description:
    '天体の高さを測る円盤の道具を、真鍮色の細い線で描きました。目盛りの母盤、透かし彫りの星図の輪、表の定規、裏の照準の棒が同じ軸の上で別々の速さで回り、上の吊り輪は立ったまま自分の軸で回ります。全体はゆっくり裏返りながら傾き、クリックすると星図の輪が勢いよく回ります。緯度を変えると、高度の線の形が変わります。',
  params: {
    brass: { type: 'color', label: '真鍮の色', default: '#d9a441' },
    pale: { type: 'color', label: '明るい線の色', default: '#ffe9b0' },
    background: { type: 'color', label: '背景色', default: '#0a0705' },
    latitude: { type: 'range', label: '緯度（度）', min: 20, max: 65, step: 1, default: 36 },
    stars: { type: 'range', label: '星の指針の数', min: 6, max: 24, step: 1, default: 15 },
    speed: { type: 'range', label: '輪が回る速さ', min: 0, max: 3, step: 0.1, default: 1 },
    flip: { type: 'range', label: '裏返る速さ', min: 0, max: 2, step: 0.05, default: 1 },
  },
};

const HALF = Math.PI / 2;
const RAD = Math.PI / 180;
const OBLIQUITY = 23.44;
const PLATE = 1.72; // 盤面の半径。南回帰線の円にあたる。
const SERIF = 'Georgia, "Times New Roman", serif';
const ROMAN = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

// 等高度線（同じ高さの星を結ぶ円）を、平射図法の盤面に描くときの中心の高さと半径を返す。
// altitude は高度、latitude は緯度（どちらも度）、equator は盤面での赤道の半径。
export function almucantar(altitude, latitude, equator = 1) {
  const denominator = Math.sin(latitude * RAD) + Math.sin(altitude * RAD);
  if (Math.abs(denominator) < 1e-6) return { cy: Infinity, radius: Infinity };
  return { cy: (equator * Math.cos(latitude * RAD)) / denominator, radius: Math.abs((equator * Math.cos(altitude * RAD)) / denominator) };
}

// 円のうち、keep(x, y) が真の部分だけを線分の列にする。
function circleSegments(cx, cy, radius, keep, steps = 180) {
  const out = [];
  let prev = null;
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * TAU;
    const point = { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius };
    point.ok = keep(point.x, point.y);
    if (prev?.ok && point.ok) out.push([prev.x, prev.y, point.x, point.y]);
    prev = point;
  }
  return out;
}

// 数字を円周に沿って並べた帯。flatBand は反時計回りに貼るので、1 文字ずつ左右を返して描く。
function numeralBand(labels, inner, outer, color) {
  const width = 2048;
  const height = 64;
  const stretch = width / (TAU * ((inner + outer) / 2)) / (height / (outer - inner));
  const texture = canvasTexture(width, height, (ctx) => {
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(height * 0.8)}px ${SERIF}`;
    labels.forEach((label, i) => {
      const u = (((0.25 - i / labels.length) % 1) + 1) % 1;
      for (const x of [u - 1, u, u + 1]) {
        ctx.save();
        ctx.translate(x * width, height / 2 + 3);
        ctx.scale(-stretch, 1);
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    });
  });
  return new THREE.Mesh(flatBand(inner, outer), glow('#ffffff', 0.9, { map: texture }));
}

// 母盤。外周の目盛りと時刻の数字、その内側に緯度ごとの盤面（回帰線、等高度線、方位の線）。
function buildMater(p) {
  const group = new THREE.Group();
  const equator = PLATE / Math.tan((45 + OBLIQUITY / 2) * RAD);
  const cancer = equator * Math.tan((45 - OBLIQUITY / 2) * RAD);

  group.add(new THREE.Mesh(ringBand(1.76, 1.775), glow(p.brass, 0.9)));
  group.add(new THREE.Mesh(ringBand(2.1, 2.12), glow(p.brass, 0.95)));
  group.add(new THREE.Mesh(ringBand(1.76, 2.12), glow(p.brass, 0.05)));
  group.add(new THREE.Mesh(tickRing(2.1, 360, 0.03, 0.004, { major: { every: 5, length: 0.06, width: 0.007 } }), glow(p.pale, 0.75)));
  group.add(new THREE.Mesh(tickRing(2.1, 36, 0.1, 0.011), glow(p.pale, 0.85)));
  group.add(new THREE.Mesh(ringBand(1.985, 1.992), glow(p.brass, 0.6)));
  group.add(numeralBand([...ROMAN, ...ROMAN], 1.8, 1.975, p.brass));

  const inPlate = (x, y) => x * x + y * y < PLATE * PLATE;
  const lines = [];
  const horizon = almucantar(0, p.latitude, equator);
  const aboveHorizon = (x, y) => inPlate(x, y) && x * x + (y - horizon.cy) ** 2 < horizon.radius ** 2;
  const bold = circleSegments(0, horizon.cy, horizon.radius, inPlate, 240);
  for (let altitude = 10; altitude < 90; altitude += 10) {
    const circle = almucantar(altitude, p.latitude, equator);
    lines.push(...circleSegments(0, circle.cy, circle.radius, inPlate, 120));
  }
  // 方位の線。天頂と天底を通る円の、地平線より上の部分。
  const zenith = almucantar(90, p.latitude, equator).cy;
  const nadir = (-equator * Math.cos(p.latitude * RAD)) / (1 - Math.sin(p.latitude * RAD));
  const middle = (zenith + nadir) / 2;
  const half = (zenith - nadir) / 2;
  for (const azimuth of [-60, -30, 0, 30, 60]) {
    const cx = half * Math.tan(azimuth * RAD);
    lines.push(...circleSegments(cx, middle, Math.hypot(cx, half), aboveHorizon, 360));
  }
  lines.push([0, -PLATE, 0, PLATE], [-PLATE, 0, PLATE, 0]);
  group.add(new THREE.Mesh(strokes(lines, 0.006), glow(p.brass, 0.6)));
  group.add(new THREE.Mesh(strokes(bold, 0.013), glow(p.pale, 0.8)));
  for (const radius of [cancer, equator, PLATE]) group.add(new THREE.Mesh(ringBand(radius - 0.006, radius + 0.006), glow(p.brass, 0.8)));
  const zenithDot = new THREE.Mesh(ringBand(0.02, 0.035), glow(p.pale, 0.9));
  zenithDot.position.y = zenith;
  group.add(zenithDot);

  // 裏面の彫り。暦の目盛り、12 の区切り、影の物差しの四角。
  const back = new THREE.Group();
  back.position.z = -0.1;
  back.add(new THREE.Mesh(tickRing(1.7, 365, 0.035, 0.004, { major: { every: 30, length: 0.09, width: 0.008 } }), glow(p.brass, 0.4)));
  back.add(new THREE.Mesh(segmentRing(1.36, 1.52, 12, { fill: 0.94 }), glow(p.brass, 0.1)));
  back.add(new THREE.Mesh(ringBand(1.52, 1.53), glow(p.brass, 0.5)));
  back.add(new THREE.Mesh(ringBand(1.35, 1.36), glow(p.brass, 0.5)));
  const square = [];
  for (const side of [0.62, 0.78]) square.push([-side, 0, -side, -side], [-side, -side, side, -side], [side, -side, side, 0]);
  for (let i = -6; i <= 6; i += 1) square.push([(i / 6) * 0.62, -0.62, (i / 6) * 0.78, -0.78]);
  back.add(new THREE.Mesh(strokes(square, 0.006), glow(p.brass, 0.45)));
  group.add(back);
  return group;
}

// 星図の輪。黄道の輪（中心がずれた輪）、外周の弧、桟、星を指す小さな剣の形。
function buildRete(p) {
  const group = new THREE.Group();
  const equator = PLATE / Math.tan((45 + OBLIQUITY / 2) * RAD);
  const cancer = equator * Math.tan((45 - OBLIQUITY / 2) * RAD);
  const center = (PLATE - cancer) / 2;
  const radius = (PLATE + cancer) / 2;
  const ecliptic = [
    [ringBand(radius - 0.1, radius), 0.12, p.pale],
    [ringBand(radius - 0.012, radius), 1, p.pale],
    [ringBand(radius - 0.1, radius - 0.09), 0.9, p.pale],
    [tickRing(radius - 0.012, 72, 0.035, 0.006, { major: { every: 6, length: 0.078, width: 0.011 } }), 0.9, p.pale],
  ];
  for (const [geometry, opacity, color] of ecliptic) {
    geometry.translate(0, center, 0);
    group.add(new THREE.Mesh(geometry, glow(color, opacity)));
  }
  group.add(new THREE.Mesh(segmentRing(PLATE - 0.06, PLATE, 4, { fill: 0.8, start: Math.PI / 4 }), glow(p.pale, 0.22)));
  group.add(new THREE.Mesh(segmentRing(PLATE - 0.008, PLATE + 0.006, 4, { fill: 0.8, start: Math.PI / 4 }), glow(p.pale, 0.95)));
  group.add(new THREE.Mesh(segmentRing(PLATE - 0.066, PLATE - 0.054, 4, { fill: 0.8, start: Math.PI / 4 }), glow(p.pale, 0.9)));

  const inPlate = (x, y) => x * x + y * y < (PLATE - 0.06) ** 2;
  const bars = [
    [-PLATE + 0.06, 0.03, PLATE - 0.06, 0.03],
    [-PLATE + 0.06, -0.03, PLATE - 0.06, -0.03],
    [-0.03, -PLATE + 0.06, -0.03, center - radius],
    [0.03, -PLATE + 0.06, 0.03, center - radius],
  ];
  // 飾りの桟。左右対称の弧。
  for (const sign of [-1, 1]) {
    bars.push(...circleSegments(sign * 0.95, -0.72, 0.62, (x, y) => inPlate(x, y) && y < -0.03 && Math.abs(x) > 0.03, 90));
    bars.push(...circleSegments(sign * 0.95, -0.72, 0.56, (x, y) => inPlate(x, y) && y < -0.03 && Math.abs(x) > 0.03, 90));
  }
  group.add(new THREE.Mesh(strokes(bars, 0.01), glow(p.pale, 0.85)));

  const random = seeded(p.latitude * 7 + 3);
  const blades = [];
  const tips = [];
  const count = Math.round(p.stars);
  for (let i = 0; i < count; i += 1) {
    const angle = ((i + random() * 0.7) / count) * TAU;
    const reach = 0.4 + random() * 1.1;
    const tx = Math.cos(angle) * reach;
    const ty = Math.sin(angle) * reach;
    const lean = angle + Math.PI + (random() - 0.5) * 1.6;
    const dx = Math.cos(lean);
    const dy = Math.sin(lean);
    const length = 0.2 + random() * 0.14;
    const bx = tx + dx * length;
    const by = ty + dy * length;
    const nx = -dy * 0.045;
    const ny = dx * 0.045;
    blades.push([bx + nx, by + ny, tx, ty], [bx - nx, by - ny, tx, ty], [bx + nx, by + ny, bx - nx, by - ny], [bx, by, bx + dx * 0.12, by + dy * 0.12]);
    tips.push([tx - 0.016, ty, tx + 0.016, ty]);
  }
  group.add(new THREE.Mesh(strokes(blades, 0.009), glow(p.pale, 0.9)));
  group.add(new THREE.Mesh(strokes(tips, 0.032), new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide })));
  return group;
}

// 定規と、照準の棒。棒は直径いっぱいに渡り、両端がとがる。vanes が真なら、のぞき穴の板を立てる。
function buildBar(reach, color, pale, vanes) {
  const group = new THREE.Group();
  const lines = [];
  for (const sign of [-1, 1]) {
    lines.push([sign * 0.1, 0.04, sign * (reach - 0.14), 0.04], [sign * 0.1, -0.04, sign * (reach - 0.14), -0.04]);
    lines.push([sign * (reach - 0.14), 0.04, sign * reach, 0], [sign * (reach - 0.14), -0.04, sign * reach, 0]);
    for (let i = 1; i <= 12; i += 1) {
      const x = sign * (0.14 + (i / 13) * (reach - 0.32));
      lines.push([x, 0.04, x, i % 3 === 0 ? -0.04 : 0]);
    }
  }
  group.add(new THREE.Mesh(strokes(lines, 0.009), glow(color, 0.95)));
  group.add(new THREE.Mesh(ringBand(0.07, 0.105), glow(pale, 0.95)));
  group.add(new THREE.Mesh(ringBand(0, 0.035), glow(pale, 0.95)));
  if (vanes) {
    for (const sign of [-1, 1]) {
      // 盤面に垂直に立つ板。棒の向きに対して直角になる。
      const vane = new THREE.Group();
      vane.position.x = sign * (reach - 0.42);
      vane.rotation.y = HALF;
      const outline = [
        [0, -0.1, 0.3, -0.1],
        [0.3, -0.1, 0.3, 0.1],
        [0.3, 0.1, 0, 0.1],
        [0, 0.1, 0, -0.1],
      ];
      vane.add(new THREE.Mesh(strokes(outline, 0.012), glow(pale, 0.95)));
      vane.add(new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2).translate(0.15, 0, 0), glow(color, 0.14)));
      const hole = new THREE.Mesh(ringBand(0.022, 0.036), glow(pale, 1));
      hole.position.x = 0.19;
      vane.add(hole);
      group.add(vane);
    }
  }
  return group;
}

function hoop(radius, color, pale) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(ringBand(radius - 0.028, radius), glow(color, 0.9)));
  group.add(new THREE.Mesh(tickRing(radius - 0.028, 24, 0.02, 0.006, { inward: true }), glow(pale, 0.7)));
  const wall = new THREE.Mesh(wallBand(radius, 0.05, 48), glow(color, 0.4));
  wall.rotation.x = HALF;
  group.add(wall);
  return group;
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 40, cameraZ: 8, background: p.background, preview: p.preview, bloom: { strength: p.preview ? 0.22 : 0.34, radius: 0.3, threshold: 0.3 } });

  const system = new THREE.Group();
  const body = new THREE.Group();
  const lift = new THREE.Group();
  lift.position.y = -0.62;
  body.add(lift);
  system.add(body);
  stage.scene.add(system);

  const mater = buildMater(p);
  const rete = buildRete(p);
  const rule = buildBar(PLATE, p.pale, p.pale, false);
  const alidade = buildBar(2.08, p.brass, p.pale, true);
  alidade.scale.z = -1;

  // 動かない部分。縁の壁、上の飾り板、吊り輪。
  const rim = new THREE.Group();
  for (const [radius, opacity] of [
    [2.12, 0.26],
    [1.76, 0.12],
  ]) {
    const wall = new THREE.Mesh(wallBand(radius, 0.2, 128), glow(p.brass, opacity));
    wall.rotation.x = HALF;
    rim.add(wall);
  }
  for (const z of [-0.1, 0.1]) {
    const edge = new THREE.Mesh(ringBand(2.105, 2.12), glow(p.brass, 0.7));
    edge.position.z = z;
    rim.add(edge);
  }
  const throne = new THREE.Group();
  const bracket = [
    [-0.46, 2.07, -0.2, 2.5],
    [-0.2, 2.5, 0.2, 2.5],
    [0.2, 2.5, 0.46, 2.07],
    [-0.3, 2.1, -0.12, 2.38],
    [0.3, 2.1, 0.12, 2.38],
    [-0.12, 2.38, 0.12, 2.38],
  ];
  for (const z of [-0.06, 0.06]) {
    const plate = new THREE.Mesh(strokes(bracket, 0.014), glow(p.brass, 0.95));
    plate.position.z = z;
    throne.add(plate);
  }
  const eye = new THREE.Mesh(ringBand(0.05, 0.07), glow(p.pale, 0.9));
  eye.position.y = 2.44;
  throne.add(eye);
  // 吊り輪は 2 つ。小さな輪が立ったまま縦の軸で回り、それに通した大きな輪が別の向きに回りながら揺れる。
  const shackle = hoop(0.2, p.brass, p.pale);
  shackle.position.y = 2.62;
  const hanger = new THREE.Group();
  hanger.position.y = 2.79;
  const hangerRing = hoop(0.3, p.pale, p.pale);
  hangerRing.position.y = 0.29;
  hanger.add(hangerRing);
  throne.add(shackle, hanger);
  rim.add(throne);
  lift.add(rim, mater, rete, rule, alidade);

  const layers = [
    { object: rim, z: 0, from: 0 },
    { object: mater, z: 0, from: -1.6 },
    { object: rete, z: 0.07, from: 1.4 },
    { object: rule, z: 0.14, from: 2.6 },
    { object: alidade, z: -0.17, from: -2.8 },
  ];
  const enter = layers.map(() => ({ e: stage.reduced ? 1 : 0 }));
  const push = { rete: 0, rule: 0 };
  let reteTarget = 0;
  let phase = 0;
  let flip = 0.9;

  stage.onResize(() => {
    const view = stage.viewport();
    system.scale.setScalar(Math.min(1, view.width / 5.4, view.height / 6.5));
  });

  stage.onFrame((time, dt) => {
    phase += dt * p.speed;
    flip += dt * p.flip * 0.24;
    // 登場のときは、層ごとに前後の離れた場所から、回りながら重なる。
    layers.forEach((layer, i) => {
      const e = enter[i].e;
      layer.object.position.z = layer.z + (1 - e) * layer.from;
      layer.object.scale.set(Math.max(0.001, e), Math.max(0.001, e), layer.object === alidade ? -1 : 1);
    });
    mater.rotation.z = phase * 0.05 + (1 - enter[1].e) * 1.5;
    rete.rotation.z = -phase * 0.21 + push.rete - (1 - enter[2].e) * 2.5;
    rule.rotation.z = 0.5 + phase * 0.37 + push.rule + (1 - enter[3].e) * 3;
    alidade.rotation.z = -0.4 - phase * 0.29 - (1 - enter[4].e) * 3;
    shackle.rotation.y = HALF + phase * 0.9;
    hanger.rotation.y = -phase * 0.6;
    hanger.rotation.z = Math.sin(phase * 1.3) * 0.22;

    // 表と裏が正面を向く前後では遅く、真横を向く前後では速く回す。
    body.rotation.y = flip - 0.38 * Math.sin(2 * flip) + stage.pointer.sx * 0.5;
    body.rotation.x = Math.sin(time * 0.31) * 0.3 - stage.pointer.sy * 0.4;
    body.rotation.z = Math.sin(time * 0.19) * 0.08;
  });

  // 星図の輪を勢いよく回し、定規を弾く。
  function turn() {
    if (stage.reduced) return;
    reteTarget -= TAU * 0.75;
    utils.remove(push);
    animate(push, { rete: reteTarget, duration: 2600, ease: 'outExpo' });
    animate(push, { rule: [push.rule + 0.9, push.rule], duration: 1800, ease: 'outElastic(1, .32)' });
  }
  container.addEventListener('pointerdown', turn);

  if (!stage.reduced) animate(enter, { e: 1, duration: 2000, delay: stagger(220), ease: 'outExpo' });

  return {
    turn,
    destroy() {
      container.removeEventListener('pointerdown', turn);
      utils.remove([push, ...enter]);
      stage.destroy();
    },
  };
}
