import * as THREE from 'three';
import { animate, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'warp-tunnel',
  title: 'ワープ航法',
  category: 'webgl',
  libs: ['three', 'animejs'],
  description:
    '星が奥から手前へ流れます。押すと、いったん星が引き戻されて力をため、押した方向へ舵を切って機体を傾けながら一気に加速します。押している間は星が線に伸びて視野が広がり、離すと行き過ぎるほど減速してから元の速さに戻ります。ページ遷移や読み込み中の演出に使えます。',
  params: {
    count: { type: 'range', label: '星の数', min: 500, max: 12000, step: 500, default: 5000 },
    speed: { type: 'range', label: 'ふだんの速さ', min: 0.5, max: 12, step: 0.5, default: 3 },
    boost: { type: 'range', label: '加速したときの速さ', min: 10, max: 120, step: 5, default: 60 },
    colorA: { type: 'color', label: '色 A', default: '#9db4ff' },
    colorB: { type: 'color', label: '色 B', default: '#ffd9a0' },
    background: { type: 'color', label: '背景色', default: '#03040c' },
  },
};

const DEPTH = 60;
const BASE_FOV = 60;
const BOOST_FOV = 95;

const vertexShader = /* glsl */ `
uniform float uTravel;
uniform float uStretch;
uniform float uSize;
attribute float aEnd;
attribute float aSeed;
varying float vAlpha;
varying float vSeed;
void main(){
  vec3 p = position;
  float z = mod(p.z + uTravel, ${DEPTH.toFixed(1)}) - ${DEPTH.toFixed(1)};
  float fade = smoothstep(-${DEPTH.toFixed(1)}, -${(DEPTH * 0.65).toFixed(1)}, z);
  p.z = z - aEnd * uStretch;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * (0.5 + aSeed) / -mv.z, 1.5, 14.0);
  vAlpha = (1.0 - aEnd) * fade;
  vSeed = aSeed;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uIsPoint;
varying float vAlpha;
varying float vSeed;
void main(){
  float a = vAlpha;
  if (uIsPoint > 0.5) a *= smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
  vec3 col = mix(uColorA, uColorB, vSeed) * 1.4;
  gl_FragColor = vec4(col * a, a);
  #include <colorspace_fragment>
}
`;

// 1 つの星を「頭」と「尾」の 2 頂点で持つ。線として描けば流れ星に、点として描けば頭だけが見える。
function buildGeometry(count) {
  const positions = new Float32Array(count * 6);
  const ends = new Float32Array(count * 2);
  const seeds = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    const radius = 0.8 + Math.pow(Math.random(), 0.7) * 9;
    const angle = Math.random() * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const z = Math.random() * DEPTH;
    const seed = Math.random();
    positions.set([x, y, z, x, y, z], i * 6);
    ends.set([0, 1], i * 2);
    seeds.set([seed, seed], i * 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  return geometry;
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: BASE_FOV, cameraZ: 0, background: p.background, preview: p.preview });
  const count = Math.round(p.preview ? Math.min(p.count, 2500) : p.count);
  const state = { speed: p.speed, fov: BASE_FOV, yaw: 0, pitch: 0, roll: 0 };

  const shared = {
    uTravel: { value: 0 },
    uStretch: { value: 0 },
    uSize: { value: 1 },
    uColorA: { value: new THREE.Color(p.colorA) },
    uColorB: { value: new THREE.Color(p.colorB) },
  };
  const makeMaterial = (isPoint) =>
    new THREE.ShaderMaterial({
      uniforms: { ...shared, uIsPoint: { value: isPoint ? 1 : 0 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  const geometry = buildGeometry(count);
  const lines = new THREE.LineSegments(geometry, makeMaterial(false));
  const dots = new THREE.Points(geometry, makeMaterial(true));
  lines.frustumCulled = false;
  dots.frustumCulled = false;
  stage.scene.add(lines, dots);

  stage.onResize(({ height, dpr }) => {
    shared.uSize.value = height * dpr * 0.07;
  });
  stage.onFrame((time, dt) => {
    shared.uTravel.value = (shared.uTravel.value + state.speed * dt) % DEPTH;
    shared.uStretch.value = 0.25 + Math.max(0, Math.abs(state.speed) - p.speed) * 0.09;
    if (stage.camera.fov !== state.fov) {
      stage.camera.fov = state.fov;
      stage.camera.updateProjectionMatrix();
    }
    stage.camera.rotation.set(stage.pointer.sy * 0.08 + state.pitch, -stage.pointer.sx * 0.08 + state.yaw, time * 0.02 + state.roll);
  });

  const CHARGE_MS = 220; // 星を引き戻して力をためる時間
  const MIN_BOOST_MS = 950; // 軽くタップしただけでも、ここまでは加速を続ける
  let boosting = false;
  let startedAt = 0;
  let releaseTimer = 0;

  // 準備: 星が引き戻され、視野がせばまる。山場: 押した方向へ舵を切り、機体を傾けて加速する。
  function engage(event) {
    if (stage.reduced) return;
    clearTimeout(releaseTimer);
    const rect = container.getBoundingClientRect();
    const hasPoint = typeof event?.clientX === 'number' && rect.width > 0 && rect.height > 0;
    const nx = hasPoint ? ((event.clientX - rect.left) / rect.width) * 2 - 1 : Math.random() * 1.2 - 0.6;
    const ny = hasPoint ? 1 - ((event.clientY - rect.top) / rect.height) * 2 : Math.random() * 0.8 - 0.4;
    boosting = true;
    startedAt = performance.now();
    utils.remove(state);
    animate(state, {
      speed: [
        { to: -p.speed * 2.2, duration: CHARGE_MS, ease: 'outQuad' },
        { to: p.boost, duration: 780, ease: 'inQuad' },
      ],
      fov: [
        { to: BASE_FOV - 12, duration: CHARGE_MS, ease: 'outQuad' },
        { to: BOOST_FOV, duration: 780, ease: 'inQuad' },
      ],
    });
    animate(state, { yaw: -nx * 0.3, pitch: ny * 0.22, duration: 900, delay: CHARGE_MS * 0.5, ease: 'outCubic' });
    animate(state, {
      roll: [
        { to: -nx * 0.42, duration: 520, ease: 'outCubic' },
        { to: -nx * 0.16, duration: 700, ease: 'inOutSine' },
      ],
      delay: CHARGE_MS,
    });
  }
  // 余韻: 行き過ぎるほど減速してから、ゆれながら元の進路と速さに戻る。
  function settle() {
    if (!boosting) return;
    boosting = false;
    utils.remove(state);
    animate(state, {
      speed: [
        { to: p.speed * 0.2, duration: 900, ease: 'outExpo' },
        { to: p.speed, duration: 1100, ease: 'inOutSine' },
      ],
      fov: [
        { to: BASE_FOV - 5, duration: 900, ease: 'outExpo' },
        { to: BASE_FOV, duration: 1100, ease: 'inOutSine' },
      ],
    });
    animate(state, { yaw: 0, pitch: 0, duration: 1900, ease: 'outElastic(1, .6)' });
    animate(state, { roll: 0, duration: 2300, delay: 120, ease: 'outElastic(1, .45)' });
  }
  function release() {
    if (!boosting) return;
    clearTimeout(releaseTimer);
    const wait = MIN_BOOST_MS - (performance.now() - startedAt);
    if (wait > 0) releaseTimer = setTimeout(settle, wait);
    else settle();
  }
  function setBoost(on) {
    if (on) engage();
    else release();
  }
  const boostOn = (event) => engage(event);
  const boostOff = () => release();
  container.addEventListener('pointerdown', boostOn);
  window.addEventListener('pointerup', boostOff);
  container.addEventListener('pointerleave', boostOff);

  // 一覧の小さな枠では、自動で加速と減速をくり返して動きを見せる。
  let pulse = 0;
  let pulseOff = 0;
  if (p.preview && !stage.reduced) {
    pulse = setInterval(() => {
      setBoost(true);
      pulseOff = setTimeout(boostOff, 1400);
    }, 4200);
  }

  return {
    boost: setBoost,
    destroy() {
      clearInterval(pulse);
      clearTimeout(pulseOff);
      clearTimeout(releaseTimer);
      container.removeEventListener('pointerdown', boostOn);
      window.removeEventListener('pointerup', boostOff);
      container.removeEventListener('pointerleave', boostOff);
      utils.remove(state);
      stage.destroy();
    },
  };
}
