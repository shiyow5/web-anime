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
    '星が奥から手前へ流れます。押している間は加速して、星が線に伸び、視野が広がります。離すとゆっくり元の速さに戻ります。ページ遷移や読み込み中の演出に使えます。',
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
  const state = { speed: p.speed, fov: BASE_FOV };

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
    shared.uStretch.value = 0.25 + Math.max(0, state.speed - p.speed) * 0.09;
    if (stage.camera.fov !== state.fov) {
      stage.camera.fov = state.fov;
      stage.camera.updateProjectionMatrix();
    }
    stage.camera.rotation.set(stage.pointer.sy * 0.08, -stage.pointer.sx * 0.08, time * 0.02);
  });

  function setBoost(on) {
    if (stage.reduced) return;
    animate(state, {
      speed: on ? p.boost : p.speed,
      fov: on ? BOOST_FOV : BASE_FOV,
      duration: on ? 900 : 1800,
      ease: on ? 'inQuad' : 'outExpo',
    });
  }
  const boostOn = () => setBoost(true);
  const boostOff = () => setBoost(false);
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
      container.removeEventListener('pointerdown', boostOn);
      window.removeEventListener('pointerup', boostOff);
      container.removeEventListener('pointerleave', boostOff);
      utils.remove(state);
      stage.destroy();
    },
  };
}
