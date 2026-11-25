import * as THREE from 'three';
import { animate, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'particle-galaxy',
  title: '渦巻き銀河',
  category: 'webgl',
  libs: ['three', 'animejs'],
  description:
    '数万個の粒を渦状に並べ、中心ほど速く回します。読み込み時に中心から広がり、ポインターの位置で傾きが変わります。トップページの背景に向いています。',
  params: {
    count: { type: 'range', label: '粒の数', min: 10000, max: 150000, step: 5000, default: 70000 },
    arms: { type: 'range', label: '腕の本数', min: 2, max: 8, step: 1, default: 4 },
    spin: { type: 'range', label: '回る速さ', min: 0, max: 1, step: 0.05, default: 0.3 },
    colorInner: { type: 'color', label: '中心の色', default: '#ffb37a' },
    colorOuter: { type: 'color', label: '外側の色', default: '#4a5bff' },
    background: { type: 'color', label: '背景色', default: '#05060f' },
  },
};

const RADIUS = 4;

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uSpin;
uniform float uProgress;
attribute float aScale;
attribute vec3 aColor;
varying vec3 vColor;
void main(){
  vec3 p = position;
  float d = length(p.xz);
  float angle = atan(p.z, p.x) + uTime * uSpin / (d + 0.5) + (1.0 - uProgress) * 3.0;
  p.xz = vec2(cos(angle), sin(angle)) * d;
  p *= mix(0.02, 1.0, uProgress);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * aScale / -mv.z;
  vColor = aColor;
}
`;

const fragmentShader = /* glsl */ `
varying vec3 vColor;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = pow(smoothstep(0.5, 0.0, d), 2.5);
  gl_FragColor = vec4(vColor * a, a);
  #include <colorspace_fragment>
}
`;

function buildGeometry(count, arms, inner, outer) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const color = new THREE.Color();
  const scatter = () => Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? -1 : 1);
  for (let i = 0; i < count; i += 1) {
    const r = Math.pow(Math.random(), 1.7) * RADIUS;
    const angle = ((i % arms) / arms) * Math.PI * 2 + r * 1.15;
    const spread = 0.12 + r * 0.16;
    positions[i * 3] = Math.cos(angle) * r + scatter() * spread;
    positions[i * 3 + 1] = scatter() * spread * 0.55;
    positions[i * 3 + 2] = Math.sin(angle) * r + scatter() * spread;
    color.copy(inner).lerp(outer, Math.min(1, r / RADIUS + (Math.random() - 0.5) * 0.25));
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    scales[i] = 0.4 + Math.random() * 1.2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
  return geometry;
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { cameraZ: 6.2, background: p.background, preview: p.preview, antialias: false });
  const count = p.preview ? Math.min(p.count, 35000) : p.count;

  const uniforms = {
    uTime: { value: 0 },
    uSize: { value: 1 },
    uSpin: { value: p.spin },
    uProgress: { value: stage.reduced ? 1 : 0 },
  };
  const points = new THREE.Points(
    buildGeometry(count, Math.round(p.arms), new THREE.Color(p.colorInner), new THREE.Color(p.colorOuter)),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  points.frustumCulled = false;
  const group = new THREE.Group();
  group.add(points);
  stage.scene.add(group);

  stage.onResize(({ width, height, dpr }) => {
    uniforms.uSize.value = height * dpr * 0.022;
    // 縦長の画面でも銀河全体が入るように縮める。
    group.scale.setScalar(Math.min(1, (width / height) * 0.85 + 0.1));
  });
  stage.onFrame((time) => {
    uniforms.uTime.value = time + 20;
    group.rotation.x = 0.95 + stage.pointer.sy * 0.25;
    group.rotation.z = -0.25 + stage.pointer.sx * 0.2;
  });

  if (!stage.reduced) animate(uniforms.uProgress, { value: 1, duration: 3200, ease: 'outExpo' });

  return {
    destroy() {
      utils.remove(uniforms.uProgress);
      stage.destroy();
    },
  };
}
