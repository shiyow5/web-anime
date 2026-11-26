import * as THREE from 'three';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { snoise3 } from '../../lib/glsl.js';

export const meta = {
  id: 'wave-terrain',
  title: '点の波',
  category: 'background',
  libs: ['three'],
  description:
    '格子状に並べた点が、波のように上下します。ポインターを置いた場所から波紋が広がります。タップすると、石を落としたようにその場所が沈み、高い波の輪が広がって、あとから小さな輪が 2 つ追いかけます。静かな印象なので、文字の多いページの背景に使えます。',
  params: {
    density: { type: 'range', label: '点の細かさ', min: 60, max: 240, step: 10, default: 150 },
    amplitude: { type: 'range', label: '波の高さ', min: 0.1, max: 1.5, step: 0.05, default: 0.6 },
    speed: { type: 'range', label: '速さ', min: 0, max: 2, step: 0.05, default: 0.8 },
    colorLow: { type: 'color', label: '谷の色', default: '#5468ff' },
    colorHigh: { type: 'color', label: '山の色', default: '#ffe3a8' },
    background: { type: 'color', label: '背景色', default: '#0a0d2b' },
  },
};

const FIELD = 16;
const DROP_LIFE = 6; // 石を落としてから波が消えるまでの秒数

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uSize;
uniform float uHover;
uniform vec2 uHit;
uniform vec4 uDrops[4];
varying float vHeight;
varying float vFade;
varying float vCrest;
${snoise3}
void main(){
  vec3 p = position;
  float h = snoise(vec3(p.xz * 0.22, uTime * 0.2)) * uAmp;
  h += sin(p.x * 0.7 + uTime * 0.9) * cos(p.z * 0.5 - uTime * 0.6) * uAmp * 0.3;
  float d = distance(p.xz, uHit);
  h += sin(d * 3.2 - uTime * 5.0) * exp(-d * 0.55) * 0.3 * uHover;
  // 落とした石。xy が場所、z が落としてからの秒数、w が強さ。
  float crest = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 drop = uDrops[i];
    if (drop.w <= 0.0) continue;
    float dd = distance(p.xz, drop.xy);
    float age = drop.z;
    // 準備: 落ちた場所が沈む。
    float sink = -exp(-dd * dd * 1.6) * 0.75 * smoothstep(0.0, 0.14, age) * exp(-age * 3.2);
    // 山場: 高い輪が広がる。余韻: 小さな輪が 2 つ、遅れて追いかける。
    float rings = 0.0;
    for (int k = 0; k < 3; k++) {
      float lag = float(k) * 0.42;
      float t = age - 0.12 - lag;
      if (t <= 0.0) continue;
      float front = dd - t * 3.4;
      float amp = (k == 0 ? 0.85 : 0.36 - float(k) * 0.08) * exp(-t * 0.75) / (1.0 + dd * 0.12);
      rings += exp(-front * front * 3.5) * amp;
    }
    h += (sink + rings) * drop.w;
    crest += rings * drop.w;
  }
  p.y = h;
  vCrest = crest;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (1.0 + h * 0.6 + crest * 0.9) / -mv.z;
  vHeight = clamp(h / max(uAmp, 0.001) * 0.5 + 0.5, 0.0, 1.0);
  vFade = smoothstep(15.0, 5.0, -mv.z);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uLow;
uniform vec3 uHigh;
varying float vHeight;
varying float vFade;
varying float vCrest;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.25, d) * vFade;
  if (a < 0.01) discard;
  vec3 col = mix(uLow, uHigh, vHeight);
  col = mix(col, vec3(1.0), clamp(vCrest * 1.1, 0.0, 0.8));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

function buildGrid(n) {
  const positions = new Float32Array(n * n * 3);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const k = (i * n + j) * 3;
      positions[k] = (i / (n - 1) - 0.5) * FIELD;
      positions[k + 2] = (j / (n - 1) - 0.5) * FIELD;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 50, background: p.background, preview: p.preview, antialias: false });
  stage.camera.position.set(0, 2.1, 6.2);
  stage.camera.lookAt(0, -0.2, 0);

  const density = Math.round(p.preview ? Math.min(p.density, 110) : p.density);
  const uniforms = {
    uTime: { value: 0 },
    uAmp: { value: p.amplitude },
    uSize: { value: 1 },
    uHover: { value: 0 },
    uHit: { value: new THREE.Vector2(0, 0) },
    uDrops: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uLow: { value: new THREE.Color(p.colorLow) },
    uHigh: { value: new THREE.Color(p.colorHigh) },
  };
  const points = new THREE.Points(
    buildGrid(density),
    new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false }),
  );
  points.frustumCulled = false;
  stage.scene.add(points);

  const raycaster = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const ndc = new THREE.Vector2();

  stage.onResize(({ height, dpr }) => {
    uniforms.uSize.value = height * dpr * (0.024 * (150 / density));
  });
  stage.onFrame((time, dt) => {
    uniforms.uTime.value = time * p.speed;
    const target = stage.pointer.inside ? 1 : 0;
    uniforms.uHover.value += (target - uniforms.uHover.value) * Math.min(1, dt * 4 + 0.02);
    if (stage.pointer.inside) {
      ndc.set(stage.pointer.x, stage.pointer.y);
      raycaster.setFromCamera(ndc, stage.camera);
      if (raycaster.ray.intersectPlane(ground, hit)) uniforms.uHit.value.set(hit.x, hit.z);
    }
    points.rotation.y = stage.pointer.sx * 0.12;
    for (const slot of uniforms.uDrops.value) {
      if (slot.w <= 0) continue;
      slot.z += dt * Math.max(0.6, p.speed);
      if (slot.z > DROP_LIFE) slot.w = 0;
    }
  });

  // 続けてタップしても重ねられるように、石は 4 つまで同時に持つ。いちばん古いものから使い回す。
  function drop(event) {
    if (stage.reduced) return;
    const rect = container.getBoundingClientRect();
    const hasPoint = typeof event?.clientX === 'number' && rect.width > 0 && rect.height > 0;
    ndc.set(
      hasPoint ? ((event.clientX - rect.left) / rect.width) * 2 - 1 : Math.random() * 1.2 - 0.6,
      hasPoint ? 1 - ((event.clientY - rect.top) / rect.height) * 2 : Math.random() * 0.8 - 0.6,
    );
    raycaster.setFromCamera(ndc, stage.camera);
    if (!raycaster.ray.intersectPlane(ground, hit)) return;
    const slots = uniforms.uDrops.value;
    const slot = slots.find((item) => item.w <= 0) ?? slots.reduce((oldest, item) => (item.z > oldest.z ? item : oldest));
    slot.set(THREE.MathUtils.clamp(hit.x, -FIELD / 2, FIELD / 2), THREE.MathUtils.clamp(hit.z, -FIELD / 2, FIELD / 2), 0, 1);
  }
  container.addEventListener('pointerdown', drop);
  const auto = p.preview && !stage.reduced ? setInterval(drop, 3800) : 0;

  return {
    drop,
    destroy() {
      clearInterval(auto);
      container.removeEventListener('pointerdown', drop);
      stage.destroy();
    },
  };
}
