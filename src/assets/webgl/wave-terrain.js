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
    '格子状に並べた点が、波のように上下します。ポインターを置いた場所から波紋が広がります。静かな印象なので、文字の多いページの背景に使えます。',
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

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uSize;
uniform float uHover;
uniform vec2 uHit;
varying float vHeight;
varying float vFade;
${snoise3}
void main(){
  vec3 p = position;
  float h = snoise(vec3(p.xz * 0.22, uTime * 0.2)) * uAmp;
  h += sin(p.x * 0.7 + uTime * 0.9) * cos(p.z * 0.5 - uTime * 0.6) * uAmp * 0.3;
  float d = distance(p.xz, uHit);
  h += sin(d * 3.2 - uTime * 5.0) * exp(-d * 0.55) * 0.3 * uHover;
  p.y = h;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (1.0 + h * 0.6) / -mv.z;
  vHeight = clamp(h / max(uAmp, 0.001) * 0.5 + 0.5, 0.0, 1.0);
  vFade = smoothstep(15.0, 5.0, -mv.z);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uLow;
uniform vec3 uHigh;
varying float vHeight;
varying float vFade;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.25, d) * vFade;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(uLow, uHigh, vHeight), a);
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
  });

  return { destroy: () => stage.destroy() };
}
