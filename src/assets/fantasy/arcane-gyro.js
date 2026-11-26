import * as THREE from 'three';
import { animate, createSeededRandom, spring, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'arcane-gyro',
  title: '立体の魔法陣',
  category: 'fantasy',
  libs: ['three', 'animejs'],
  description:
    '地面の魔法陣の上に、文字の刻まれた輪が何段も浮かび、中心では 3 本の輪が別々の軸で回ります。光の柱が立ちのぼり、粒がらせんを描いて上がっていきます。タップすると詠唱が始まります。浮かぶ輪が上の段から順に地面へ畳まれ、中心の 3 本の輪が同じ面にそろって沈みます。続いて光の柱が噴き上がり、輪が下の段から順に跳ね上がり、3 本の輪は互いに直交する軸へ組み替わって独楽のように回ります。最後に輪が揺れながら元の高さへ戻ります。',
  params: {
    color: { type: 'color', label: '陣の色', default: '#ffd98a' },
    accent: { type: 'color', label: '柱と粒の色', default: '#9d6bff' },
    background: { type: 'color', label: '背景色', default: '#0b0618' },
    rings: { type: 'range', label: '浮かぶ輪の段数', min: 1, max: 5, step: 1, default: 3 },
    speed: { type: 'range', label: '回る速さ', min: 0, max: 3, step: 0.1, default: 1 },
    seed: { type: 'range', label: '文字の種', min: 1, max: 99, step: 1, default: 12 },
  },
};

const TAU = Math.PI * 2;

// 乱数で選んだ格子点をつないで、架空の文字を 1 つ描く。
function drawRune(ctx, random, size) {
  const node = () => [(Math.floor(random() * 3) - 1) * size * 0.32, (Math.floor(random() * 4) - 1.5) * size * 0.26];
  ctx.beginPath();
  for (let stroke = 0; stroke < 2 + Math.floor(random() * 2); stroke += 1) {
    ctx.moveTo(...node());
    ctx.lineTo(...node());
    ctx.lineTo(...node());
  }
  ctx.stroke();
}

// 地面に敷く魔法陣の絵。同心円、星、文字の輪をキャンバスに描く。
function circleTexture(random) {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.translate(size / 2, size / 2);
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const ring = (r, width) => {
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.stroke();
    };
    ring(496, 6);
    ring(470, 2);
    ring(398, 3);
    ring(230, 3);
    ring(120, 2);
    const star = (r, points, step, width) => {
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let i = 0; i <= points; i += 1) {
        const a = (((i * step) % points) / points) * TAU - Math.PI / 2;
        ctx[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.stroke();
    };
    star(398, 7, 3, 3);
    star(398, 7, 1, 2);
    star(230, 8, 3, 2);
    ctx.lineWidth = 4;
    for (let i = 0; i < 28; i += 1) {
      ctx.save();
      ctx.rotate((i / 28) * TAU);
      ctx.translate(0, -434);
      drawRune(ctx, random, 44);
      ctx.restore();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// 輪の側面に巻く、文字の帯の絵。
function bandTexture(random) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 6, 2048, 3);
    ctx.fillRect(0, 119, 2048, 3);
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.lineWidth = 5;
    for (let i = 0; i < 32; i += 1) {
      ctx.save();
      ctx.translate(32 + i * 64, 64);
      drawRune(ctx, random, 70);
      ctx.restore();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

const pillarVertex = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const pillarFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uPower;
varying vec2 vUv;
void main(){
  // 下が明るく、上へ行くほど消える。縦の筋が上へ流れる。
  float fade = pow(1.0 - vUv.y, 1.6);
  float streak = 0.6 + 0.4 * sin(vUv.x * 60.0 + sin(vUv.y * 9.0 - uTime * 3.0) * 2.0);
  float a = fade * streak * (0.22 + uPower * 0.7);
  gl_FragColor = vec4(uColor * a, a);
  #include <colorspace_fragment>
}
`;
const moteVertex = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uPower;
attribute vec4 aSeed;
varying float vAlpha;
void main(){
  // らせんを描いて上がり、上まで行ったら下へ戻る。
  float h = fract(aSeed.x + uTime * (0.06 + aSeed.y * 0.08) * (1.0 + uPower * 2.0));
  float a = aSeed.z * 6.2832 + h * 5.0 + uTime * 0.4;
  float r = (0.35 + aSeed.w * 1.5) * (1.0 - h * 0.45);
  vec3 p = vec3(cos(a) * r, h * 4.2, sin(a) * r);
  vAlpha = sin(h * 3.14159) * (0.5 + uPower);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.4 + aSeed.y) / -mv.z;
}
`;
const moteFragment = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main(){
  float a = pow(smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)), 2.0) * vAlpha;
  gl_FragColor = vec4(uColor * a, a);
  #include <colorspace_fragment>
}
`;

// 中心の 3 本の輪の向き。そろうときは水平な 1 つの面、組み替わるときは互いに直交する 3 つの面。
const HOOP_FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
const HOOP_ORTHO = [new THREE.Euler(0, 0, 0), new THREE.Euler(Math.PI / 2, 0, 0), new THREE.Euler(0, Math.PI / 2, 0)].map((euler) => new THREE.Quaternion().setFromEuler(euler));

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, {
    fov: 42,
    background: p.background,
    preview: p.preview,
    maxDpr: p.preview ? 1 : 1.5,
    bloom: { strength: 0.45, radius: 0.25, threshold: 0.25 },
  });
  const random = createSeededRandom(Math.round(p.seed), 0, 1, 4);
  const rand = () => random();
  const color = new THREE.Color(p.color);
  const accent = new THREE.Color(p.accent);
  const additive = { transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending };
  const textures = [circleTexture(rand), bandTexture(rand)];
  const state = { power: 0, spread: 0, align: 0, ortho: 0, whirl: 0, lean: 0, reveal: stage.reduced ? 1 : 0 };

  const world = new THREE.Group();
  stage.scene.add(world);

  // 地面の魔法陣。2 枚を重ねて逆向きに回す。
  const ground = [3.4, 2.1].map((size, index) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size * 2, size * 2), new THREE.MeshBasicMaterial({ ...additive, map: textures[0], color: index ? accent : color, opacity: index ? 0.55 : 0.95 }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = index * 0.04;
    world.add(mesh);
    return mesh;
  });

  // 浮かぶ輪。上の段ほど小さく、文字の帯が側面を回る。
  const ringCount = Math.round(p.rings);
  const bands = Array.from({ length: ringCount }, (_, i) => {
    const radius = 2.3 - i * (1.5 / Math.max(1, ringCount));
    const material = new THREE.MeshBasicMaterial({ ...additive, map: textures[1], color: i % 2 ? accent : color, opacity: 0.9 });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.3, 96, 1, true), material);
    world.add(mesh);
    return { mesh, base: 0.55 + i * 0.62, direction: i % 2 ? -1 : 1, fold: { v: 0 }, drop: { v: stage.reduced ? 1 : 0 } };
  });

  // 中心で回る 3 本の輪と、光る核。
  const gyro = new THREE.Group();
  const hoops = [0.62, 0.5, 0.38].map((radius, i) => {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.012, 8, 96), new THREE.MeshBasicMaterial({ ...additive, color: i === 1 ? accent : color }));
    gyro.add(hoop);
    return hoop;
  });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  gyro.add(core);
  world.add(gyro);

  const pillarUniforms = { uColor: { value: accent }, uTime: { value: 0 }, uPower: { value: 0 } };
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 1.0, 5, 48, 1, true),
    new THREE.ShaderMaterial({ ...additive, uniforms: pillarUniforms, vertexShader: pillarVertex, fragmentShader: pillarFragment }),
  );
  pillar.position.y = 2.5;
  world.add(pillar);

  const moteCount = p.preview ? 160 : 420;
  const moteGeometry = new THREE.BufferGeometry();
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(moteCount * 3), 3));
  moteGeometry.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(moteCount * 4).map(() => Math.random()), 4));
  const moteUniforms = { uColor: { value: color }, uTime: { value: 0 }, uSize: { value: 1 }, uPower: { value: 0 } };
  const motes = new THREE.Points(moteGeometry, new THREE.ShaderMaterial({ ...additive, uniforms: moteUniforms, vertexShader: moteVertex, fragmentShader: moteFragment }));
  motes.frustumCulled = false;
  world.add(motes);

  stage.onResize(({ height, dpr }) => {
    moteUniforms.uSize.value = height * dpr * 0.07;
    const narrow = Math.min(1, stage.camera.aspect / 1.15);
    world.scale.setScalar(0.72 + 0.28 * narrow);
  });
  stage.onFrame((time, dt) => {
    const t = time * p.speed;
    pillarUniforms.uTime.value = time;
    pillarUniforms.uPower.value = state.power;
    moteUniforms.uTime.value = time;
    moteUniforms.uPower.value = state.power;
    ground[0].rotation.z = t * 0.12;
    ground[1].rotation.z = -t * 0.2;
    for (const mesh of ground) mesh.scale.setScalar(Math.max(0.001, state.reveal) * (1 + state.power * 0.06));
    bands.forEach((band, i) => {
      band.mesh.rotation.y += dt * p.speed * 0.35 * band.direction * (1 + state.power * 3 + Math.abs(Math.min(0, band.fold.v)) * 6);
      // fold が正のときは地面へ畳まれ、負のときは元の高さより上へ跳ね上がる。
      const fold = band.fold.v;
      const rest = band.base + Math.sin(time * 0.8 + i) * 0.05;
      const height = fold >= 0 ? rest + (0.2 + i * 0.07 - rest) * fold : rest - fold * (0.35 + i * 0.32);
      band.mesh.position.y = height * band.drop.v + (1 - band.drop.v) * 6;
      band.mesh.material.opacity = 0.9 * Math.min(1, Math.max(0, band.drop.v));
    });
    gyro.position.y = 1.9 + state.spread * 0.6 + Math.sin(time * 0.9) * 0.06;
    hoops[0].rotation.set(t * 0.9, t * 0.3, 0);
    hoops[1].rotation.set(t * 0.2, t * 1.1, t * 0.4);
    hoops[2].rotation.set(t * 0.5, 0, t * 1.3);
    // 詠唱のあいだ、3 本の輪は同じ面にそろい、そのあと互いに直交する軸へ組み替わる。
    hoops.forEach((hoop, i) => {
      if (state.align > 0.001) hoop.quaternion.slerp(HOOP_FLAT, Math.min(1, state.align));
      if (state.ortho > 0.001) hoop.quaternion.slerp(HOOP_ORTHO[i], Math.min(1, Math.max(0, state.ortho)));
    });
    gyro.rotation.y += dt * state.whirl * 11;
    world.rotation.z = state.lean;
    core.scale.setScalar(1 + state.power * 0.8 + Math.sin(time * 3) * 0.06);
    // カメラは少し上から見下ろし、ポインターでまわりを回る。
    const orbit = stage.pointer.sx * 0.6 + Math.sin(time * 0.15) * 0.25;
    stage.camera.position.set(Math.sin(orbit) * 7.2, 3.3 + stage.pointer.sy * 1.2, Math.cos(orbit) * 7.2);
    stage.camera.lookAt(0, 1.5, 0);
  });

  const drops = bands.map((band) => band.drop);
  if (!stage.reduced) {
    // 起動。地面の陣が広がり、輪が上から順に降りてくる。
    animate(state, { reveal: 1, duration: 1600, ease: 'outExpo' });
    animate(drops, { v: 1, delay: stagger(160, { start: 500 }), ease: spring({ stiffness: 60, damping: 10 }) });
  }

  // 詠唱。輪が上の段から地面へ畳まれ、中心の輪が同じ面にそろって沈む（準備）→ 柱が噴き上がり、輪が下の段から
  // 跳ね上がり、中心の輪が直交する軸へ組み替わって回る（山場）→ 輪が揺れながら元の高さへ戻る（余韻）。
  const folds = bands.map((band) => band.fold);
  function cast(event) {
    if (stage.reduced) return;
    const rect = container.getBoundingClientRect();
    const nx = event?.clientX === undefined ? 0 : ((event.clientX - rect.left) / rect.width) * 2 - 1;
    utils.remove([state, ...folds]);
    state.reveal = 1;
    const last = bands.length - 1;
    const launch = 620;
    bands.forEach((band, i) => {
      const down = (last - i) * 55;
      const up = launch + i * 75;
      animate(band.fold, {
        v: [
          { to: 1, duration: 360, delay: down, ease: 'inQuad' },
          { to: 1, duration: Math.max(1, up - down - 360) },
          { to: -1, duration: 300, ease: 'outBack(1.8)' },
          { to: 0, duration: 1700, ease: 'outElastic(1, .5)' },
        ],
      });
    });
    animate(state, {
      power: [
        { to: 0, duration: launch },
        { to: 1, duration: 180, ease: 'outQuad' },
        { to: 0, duration: 2400, ease: 'outExpo' },
      ],
      spread: [
        { to: -0.7, duration: 480, ease: 'inOutQuad' },
        { to: 1, duration: 340, delay: 140, ease: 'outBack(2)' },
        { to: 0, duration: 1900, ease: 'outElastic(1, .5)' },
      ],
      align: [
        { to: 1, duration: 460, ease: 'inOutQuart' },
        { to: 1, duration: 500 },
        { to: 0, duration: 10 },
      ],
      ortho: [
        { to: 0, duration: launch },
        { to: 1, duration: 260, ease: 'outBack(2.5)' },
        { to: 1, duration: 700 },
        { to: 0, duration: 1300, ease: 'inOutQuad' },
      ],
      whirl: [
        { to: 0, duration: launch },
        { to: 1, duration: 200, ease: 'outQuad' },
        { to: 0, duration: 2000, ease: 'outQuad' },
      ],
      lean: [
        { to: -nx * 0.1, duration: 400, ease: 'outQuad' },
        { to: 0, duration: 1800, ease: 'outElastic(1, .5)' },
      ],
    });
  }
  container.addEventListener('click', cast);
  const autoCast = !stage.reduced && p.preview ? setInterval(cast, 4600) : 0;
  const firstCast = stage.reduced ? 0 : setTimeout(cast, 2400);

  return {
    cast,
    destroy() {
      clearInterval(autoCast);
      clearTimeout(firstCast);
      container.removeEventListener('click', cast);
      utils.remove([state, ...drops, ...folds]);
      for (const texture of textures) texture.dispose();
      stage.destroy();
    },
  };
}
