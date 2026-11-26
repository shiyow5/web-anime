import * as THREE from 'three';
import { animate, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { canvasTexture } from '../../lib/holo.js';

export const meta = {
  id: 'carousel-music-box',
  title: 'オルゴールの回転木馬',
  category: 'fancy',
  libs: ['three', 'animejs'],
  description:
    'パステル色のオルゴールの上で、回転木馬が回ります。台は水平に回り、屋根は逆向きに回り、馬と星は上下しながら自分の軸でも回り、てっぺんの飾りは傾いた軸で回ります。クリックすると、木馬が止まりかけるあいだに鍵がかちかちと 3 回巻かれ、放すと音符を飛ばしながら勢いよく回り出します。ぜんまいがほどけるにつれてゆっくりになり、止まりかけてからまた元の速さに戻ります。お祝いや子ども向けの画面に使えます。',
  params: {
    color: { type: 'color', label: '台と屋根の色', default: '#ffc2d9' },
    accent: { type: 'color', label: '差し色', default: '#a9dcf5' },
    gold: { type: 'color', label: '金具の色', default: '#ffe0a0' },
    background: { type: 'color', label: '背景色', default: '#fff3f8' },
    riders: { type: 'range', label: '飾りの数', min: 4, max: 8, step: 1, default: 6 },
    speed: { type: 'range', label: '回る速さ', min: 0, max: 3, step: 0.1, default: 1 },
  },
};

const TAU = Math.PI * 2;
const PASTELS = ['#ffd1e3', '#c9f0e2', '#fff0b8', '#d9ccff', '#bfe6ff', '#ffd9bf'];

const soft = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.02, ...extra });

// 縦じまの絵。屋根と台の側面に巻く。
function stripes(a, b, count) {
  const texture = canvasTexture(count * 32, 32, (ctx, w, hgt) => {
    for (let i = 0; i < count; i += 1) {
      ctx.fillStyle = i % 2 ? a : b;
      ctx.fillRect(i * 32, 0, 32, hgt);
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

// 斜めのしま。柱に巻くと、ねじり棒になる。
function twist(a, b) {
  const texture = canvasTexture(64, 64, (ctx, w) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, w, w);
    ctx.strokeStyle = b;
    ctx.lineWidth = 16;
    for (let i = -2; i < 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * 32, 0);
      ctx.lineTo(i * 32 + 64, 64);
      ctx.stroke();
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// 厚みのある星形。
function starGeometry(outer, inner, depth) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 ? inner : outer;
    const a = (i / 10) * TAU + Math.PI / 2;
    shape[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: depth * 0.35, bevelThickness: depth * 0.35, bevelSegments: 2 });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

// 丸い部品を組み合わせた木馬。+X が進む向き。
function createHorse(bodyColor, maneColor, saddleColor) {
  const horse = new THREE.Group();
  const body = soft(bodyColor);
  const mane = soft(maneColor);
  const add = (geometry, material, x, y, z, rz = 0, rx = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, 0, rz);
    horse.add(mesh);
    return mesh;
  };
  add(new THREE.CapsuleGeometry(0.15, 0.3, 6, 14), body, 0, 0, 0, Math.PI / 2);
  add(new THREE.CapsuleGeometry(0.085, 0.2, 5, 12), body, 0.24, 0.2, 0, -0.55);
  add(new THREE.CapsuleGeometry(0.075, 0.13, 5, 12), body, 0.38, 0.3, 0, -1.9);
  for (const side of [-1, 1]) {
    add(new THREE.ConeGeometry(0.03, 0.08, 8), body, 0.3, 0.41, side * 0.05);
    add(new THREE.CapsuleGeometry(0.04, 0.2, 4, 8), body, 0.2, -0.23, side * 0.08, 0.45);
    add(new THREE.CapsuleGeometry(0.04, 0.2, 4, 8), body, -0.2, -0.23, side * 0.08, -0.4);
    add(new THREE.SphereGeometry(0.018, 8, 8), soft('#5a4a5e'), 0.43, 0.33, side * 0.062);
  }
  add(new THREE.CapsuleGeometry(0.04, 0.2, 4, 8), mane, 0.18, 0.27, 0, -0.55);
  add(new THREE.SphereGeometry(0.08, 10, 10), mane, -0.34, 0.06, 0).scale.set(1, 1.5, 0.8);
  add(new THREE.CylinderGeometry(0.16, 0.16, 0.16, 16, 1, false, 0, Math.PI), soft(saddleColor), -0.02, 0.02, 0, 0, Math.PI / 2).rotation.set(Math.PI / 2, Math.PI / 2, 0);
  return horse;
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const preview = Boolean(p.preview);
  const stage = createStage(container, { fov: 34, cameraZ: 10, background: p.background, preview });
  const { scene } = stage;
  const state = { wind: 0, crank: 0, click: 0 };

  // やわらかい照明。空と地面の色で全体を包み、斜め上から 1 灯だけ当てる。
  scene.add(new THREE.HemisphereLight('#ffffff', '#ffd9e8', 1.9));
  const sun = new THREE.DirectionalLight('#fff6e6', 1.5);
  sun.position.set(-3, 6, 5);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(p.accent, 0.5);
  fill.position.set(4, 1, -2);
  scene.add(fill);

  const white = '#fffaf4';
  const goldMat = new THREE.MeshStandardMaterial({ color: p.gold, roughness: 0.35, metalness: 0.25 });
  const system = new THREE.Group();
  scene.add(system);

  // 机に落ちる影。丸いぼかしを 1 枚敷く。
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 48),
    new THREE.MeshBasicMaterial({
      map: canvasTexture(128, 128, (ctx, w) => {
        const g = ctx.createRadialGradient(w / 2, w / 2, w * 0.2, w / 2, w / 2, w / 2);
        g.addColorStop(0, 'rgba(150,90,120,0.42)');
        g.addColorStop(1, 'rgba(150,90,120,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, w);
      }),
      transparent: true,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -2.11;
  system.add(shadow);

  // オルゴールの箱。動かない土台。
  const box = new THREE.Group();
  const boxSide = stripes(p.color, white, 24);
  box.add(new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.15, 0.7, 64), [soft('#ffffff', { map: boxSide }), soft(white), soft(white)]));
  const trimTop = new THREE.Mesh(new THREE.TorusGeometry(2.06, 0.06, 10, 64), goldMat);
  trimTop.rotation.x = Math.PI / 2;
  trimTop.position.y = 0.35;
  const trimBottom = trimTop.clone();
  trimBottom.scale.setScalar(1.045);
  trimBottom.position.y = -0.35;
  box.add(trimTop, trimBottom);
  for (let i = 0; i < 4; i += 1) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), goldMat);
    const a = (i / 4) * TAU + Math.PI / 4;
    foot.position.set(Math.cos(a) * 1.85, -0.42, Math.sin(a) * 1.85);
    box.add(foot);
  }
  box.position.y = -1.7;
  system.add(box);

  // ぜんまいの鍵。箱の横に付き、水平な軸で回る。
  const keyPivot = new THREE.Group();
  keyPivot.rotation.y = -0.55;
  keyPivot.position.y = -1.7;
  const key = new THREE.Group();
  key.position.x = 2.1;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 12), goldMat);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = 0.22;
  key.add(shaft);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.045, 8, 24), goldMat);
    wing.rotation.y = Math.PI / 2;
    wing.position.set(0.5, side * 0.19, 0);
    key.add(wing);
  }
  keyPivot.add(key);
  system.add(keyPivot);

  // 回る台。
  const platform = new THREE.Group();
  platform.position.y = -1.2;
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.9, 0.22, 64), [soft(p.accent), soft(white, { map: stripes(white, p.color, 16) }), soft(white)]);
  floor.material[1].map.center.set(0.5, 0.5);
  platform.add(floor);
  const floorTrim = new THREE.Mesh(new THREE.TorusGeometry(1.81, 0.045, 8, 64), goldMat);
  floorTrim.rotation.x = Math.PI / 2;
  floorTrim.position.y = 0.11;
  platform.add(floorTrim);
  const twistMap = twist(white, p.color);
  twistMap.repeat.set(2, 5);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 2.7, 24), soft('#ffffff', { map: twistMap }));
  mast.position.y = 1.4;
  platform.add(mast);
  system.add(platform);

  // 飾り。柱ごとに、馬と星を交互に付ける。
  const riders = [];
  const poleMap = twist(white, p.gold);
  poleMap.repeat.set(1, 8);
  const starGeo = starGeometry(0.3, 0.14, 0.09);
  for (let i = 0; i < p.riders; i += 1) {
    const angle = (i / p.riders) * TAU;
    const post = new THREE.Group();
    post.position.set(Math.cos(angle) * 1.32, 0, Math.sin(angle) * 1.32);
    // 柱ごとの向き。馬が進む向き（円の接線）を向くようにする。
    post.rotation.y = -angle - Math.PI / 2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.6, 10), soft('#ffffff', { map: poleMap }));
    pole.position.y = 1.4;
    post.add(pole);
    const rider = new THREE.Group();
    const isHorse = i % 2 === 0;
    const tint = PASTELS[i % PASTELS.length];
    if (isHorse) rider.add(createHorse(white, tint, i % 4 === 0 ? p.color : p.accent));
    else {
      const star = new THREE.Mesh(starGeo, soft(i % 4 === 1 ? p.gold : tint, { roughness: 0.45 }));
      rider.add(star);
    }
    post.add(rider);
    platform.add(post);
    riders.push({ post, rider, isHorse, phase: (i / p.riders) * TAU * 2, grow: 1 });
  }

  // 屋根。台とは逆向きに回る。
  const canopy = new THREE.Group();
  canopy.position.y = 1.55;
  const roofMap = stripes(p.color, white, 16);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.05, 0.95, 64, 1, true), soft('#ffffff', { map: roofMap, side: THREE.DoubleSide }));
  roof.position.y = 0.47;
  canopy.add(roof);
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.05, 0.2, 64, 1, true), soft('#ffffff', { map: stripes(p.accent, white, 32), side: THREE.DoubleSide }));
  skirt.position.y = -0.1;
  canopy.add(skirt);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.05, 8, 64), goldMat);
  rim.rotation.x = Math.PI / 2;
  canopy.add(rim);
  // 屋根の縁に下がる玉と、小さな星。星はそれぞれ自分の軸でも回る。
  const dangles = [];
  const beadCount = 16;
  const tinyStar = starGeometry(0.11, 0.05, 0.035);
  for (let i = 0; i < beadCount; i += 1) {
    const a = (i / beadCount) * TAU;
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), soft(PASTELS[i % PASTELS.length], { roughness: 0.4 }));
    bead.position.set(Math.cos(a) * 2.05, -0.24, Math.sin(a) * 2.05);
    canopy.add(bead);
    if (i % 2 === 0) {
      const hang = new THREE.Mesh(tinyStar, goldMat);
      hang.position.set(Math.cos(a) * 1.72, -0.42, Math.sin(a) * 1.72);
      canopy.add(hang);
      dangles.push(hang);
    }
  }
  system.add(canopy);

  // てっぺんの飾り。傾いた軸がゆっくり首を振り、その軸のまわりで星と輪が回る。
  const topper = new THREE.Group();
  topper.position.y = 2.52;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), goldMat);
  topper.add(knob);
  const lean = new THREE.Group();
  lean.rotation.z = 0.42;
  const topStar = new THREE.Mesh(starGeometry(0.34, 0.16, 0.1), soft(p.gold, { roughness: 0.4, emissive: p.gold, emissiveIntensity: 0.12 }));
  topStar.position.y = 0.5;
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.028, 8, 48), soft(p.accent));
  halo.position.y = 0.5;
  const halo2 = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.02, 8, 48), soft(p.color));
  halo2.position.y = 0.5;
  lean.add(topStar, halo, halo2);
  topper.add(lean);
  system.add(topper);

  // まわりに漂う、色とりどりの丸い粒。
  const flakeCount = preview ? 24 : 60;
  const flakePos = new Float32Array(flakeCount * 3);
  const flakeCol = new Float32Array(flakeCount * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < flakeCount; i += 1) {
    const a = Math.random() * TAU;
    const r = 2.6 + Math.random() * 1.6;
    flakePos.set([Math.cos(a) * r, (Math.random() - 0.5) * 5, Math.sin(a) * r], i * 3);
    tmp.set(PASTELS[i % PASTELS.length]).lerp(new THREE.Color(p.color), 0.3);
    flakeCol.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  const flakeGeo = new THREE.BufferGeometry();
  flakeGeo.setAttribute('position', new THREE.BufferAttribute(flakePos, 3));
  flakeGeo.setAttribute('color', new THREE.BufferAttribute(flakeCol, 3));
  const flakes = new THREE.Points(
    flakeGeo,
    new THREE.PointsMaterial({
      size: 0.13,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      map: canvasTexture(32, 32, (ctx, w) => {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(w / 2, w / 2, w * 0.42, 0, TAU);
        ctx.fill();
      }),
    }),
  );
  system.add(flakes);

  // 音符。ぜんまいを放したときに、屋根の縁から 1 つずつ舞い上がる。
  const noteMap = (pair) =>
    canvasTexture(64, 64, (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      const heads = pair ? [[18, 48], [44, 42]] : [[26, 46]];
      for (const [x, y] of heads) {
        ctx.beginPath();
        ctx.ellipse(x, y, 9, 6.5, -0.4, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + 8, y - 2);
        ctx.lineTo(x + 8, y - 32);
        ctx.stroke();
      }
      ctx.beginPath();
      if (pair) {
        ctx.lineWidth = 8;
        ctx.moveTo(26, 16);
        ctx.lineTo(52, 10);
      } else {
        ctx.moveTo(34, 14);
        ctx.quadraticCurveTo(50, 20, 46, 34);
      }
      ctx.stroke();
    });
  const noteMaps = [noteMap(false), noteMap(true)];
  const NOTE_COLORS = ['#ff7fa8', '#5fb0e6', '#f0a93a', '#9a86e8', '#4fc49a'];
  const notes = Array.from({ length: preview ? 6 : 9 }, (_, i) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: noteMaps[i % 2], color: NOTE_COLORS[i % NOTE_COLORS.length], transparent: true, depthWrite: false, opacity: 0 }));
    sprite.visible = false;
    system.add(sprite);
    return { sprite, t: 0, angle: 0, lean: 0 };
  });
  function placeNotes() {
    for (const note of notes) {
      const { sprite, t } = note;
      sprite.visible = t > 0 && t < 1;
      if (!sprite.visible) continue;
      const radius = 2.15 + t * 0.75;
      const a = note.angle + t * 1.4;
      sprite.position.set(Math.cos(a) * radius + note.lean * t * 0.9, 1.25 + t * 1.75 + Math.sin(t * 9 + note.angle) * 0.08, Math.sin(a) * radius);
      sprite.scale.setScalar(0.5 * Math.min(1, t * 6) * (1 - t * 0.25));
      sprite.material.opacity = Math.min(1, (1 - t) * 2.2);
      sprite.material.rotation = Math.sin(t * 7 + note.angle) * 0.35;
    }
  }

  // 登場。箱、台、飾り、屋根、てっぺんの順に現れる。
  const parts = [box, platform, canopy, topper].map((object) => ({ object, v: 1 }));
  const applyScale = () => {
    for (const part of parts) part.object.scale.setScalar(Math.max(0.001, part.v));
    keyPivot.scale.setScalar(Math.max(0.001, parts[0].v));
  };

  let turn = 0.4;
  let bobTime = 0;
  let keyTurn = 0;
  function place(dt, time) {
    // wind が負のあいだは止まりかけ、正のあいだは速く回る。
    const rate = p.speed * Math.max(0.04, 1 + state.wind * 3.2);
    const lift = Math.max(0, state.wind);
    turn += dt * 0.5 * rate;
    bobTime += dt * rate;
    // 鍵は、回っているあいだはほどける向きに回り、巻くときは逆向きに段をつけて回る。
    keyTurn += dt * 0.5 * rate;
    platform.rotation.y = turn;
    canopy.rotation.y = -turn * 0.6;
    canopy.position.y = 1.55 + lift * 0.07;
    key.rotation.x = -keyTurn + state.crank;
    key.position.x = 2.1 - state.click * 0.09;
    placeNotes();
    for (const item of riders) {
      const wave = Math.sin(bobTime * 1.7 + item.phase);
      item.rider.position.y = 1.15 + wave * (0.34 + lift * 0.1);
      item.rider.scale.setScalar(Math.max(0.001, item.grow));
      // 馬は前後に揺れながら柱のまわりで少し首を振り、星は柱を軸にして回り続ける。
      if (item.isHorse) item.rider.rotation.set(0, Math.sin(bobTime * 0.85 + item.phase) * 0.3, Math.cos(bobTime * 1.7 + item.phase) * 0.22);
      else item.rider.rotation.set(Math.sin(bobTime * 1.1 + item.phase) * 0.25, bobTime * 1.5 + item.phase, 0);
    }
    dangles.forEach((hang, i) => {
      hang.rotation.y = bobTime * 2.2 + i;
      hang.position.y = -0.42 + Math.sin(bobTime * 2 + i * 1.3) * 0.03;
    });
    // 歳差。傾いた軸そのものが Y 軸のまわりを回り、星と輪は別々の軸で回る。
    topper.rotation.y = bobTime * 0.7;
    topStar.rotation.y = bobTime * 2.1;
    halo.rotation.set(Math.PI / 2 + Math.sin(bobTime * 0.9) * 0.5, bobTime * 1.3, 0);
    halo2.rotation.set(bobTime * 1.1, 0, Math.PI / 2);
    flakes.rotation.y = time * 0.04;
    applyScale();
    box.scale.y *= 1 - state.click * 0.035;
  }

  stage.onResize(() => {
    const view = stage.viewport();
    system.scale.setScalar(Math.min(1, view.width / 5.8, view.height / 7.7));
  });
  stage.onFrame((time, dt) => {
    place(dt, time);
    system.rotation.x = 0.3 - stage.pointer.sy * 0.14;
    system.rotation.y = stage.pointer.sx * 0.35;
    system.position.y = -0.38 * system.scale.y;
  });

  // ぜんまいを巻く。準備: 止まりかけて鍵を 3 回巻く。山場: 放して音符が飛び、速く回る。余韻: ほどけて止まりかけ、また動く。
  function wind() {
    if (stage.reduced) return;
    utils.remove(state);
    utils.remove(notes);
    const from = state.crank;
    const clicks = [1, 2, 3].flatMap((n) => [
      { to: from + n * 1.35, duration: 150, ease: 'outBack(2.5)' },
      { to: from + n * 1.35, duration: 90 },
    ]);
    animate(state, {
      crank: clicks,
      click: [1, 2, 3].flatMap(() => [
        { to: 1, duration: 70, ease: 'outQuad' },
        { to: 0, duration: 170, ease: 'outQuad' },
      ]),
      wind: [
        { to: -0.3, duration: 620, ease: 'outQuad' },
        { to: -0.3, duration: 100 },
        { to: 1.15, duration: 520, ease: 'outBack(2)' },
        { to: -0.26, duration: 2700, ease: 'inOutSine' },
        { to: -0.26, duration: 380 },
        { to: 0, duration: 1000, ease: 'inOutQuad' },
      ],
    });
    // 音符は、触った側へ流れる。
    const lean = stage.pointer.inside ? stage.pointer.x : 0;
    notes.forEach((note, i) => {
      note.t = 0;
      note.angle = (i / notes.length) * TAU * 1.6 + turn;
      note.lean = lean;
    });
    animate(notes, { t: [0, 1], duration: 1900, delay: stagger(150, { start: 760 }), ease: 'outSine' });
  }

  let timer = 0;
  let first = 0;
  if (!stage.reduced) {
    for (const part of parts) part.v = 0;
    for (const item of riders) item.grow = 0;
    animate(parts, { v: 1, duration: 1000, delay: stagger(220), ease: 'outBack(1.5)' });
    animate(riders, { grow: 1, duration: 800, delay: stagger(90, { start: 600 }), ease: 'outElastic(1, .6)' });
    if (preview) {
      first = setTimeout(wind, 2300);
      timer = setInterval(wind, 7000);
    }
  }
  container.addEventListener('pointerdown', wind);
  place(0, 0);

  return {
    wind,
    destroy() {
      clearInterval(timer);
      clearTimeout(first);
      container.removeEventListener('pointerdown', wind);
      utils.remove(state);
      utils.remove(notes);
      utils.remove(parts);
      utils.remove(riders);
      stage.destroy();
    },
  };
}
