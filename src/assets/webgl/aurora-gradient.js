import * as THREE from 'three';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { fullscreenVertex, snoise3 } from '../../lib/glsl.js';

export const meta = {
  id: 'aurora-gradient',
  title: 'ゆらぐグラデーション',
  category: 'background',
  libs: ['three'],
  description:
    '4 色がゆっくり混ざり合う背景です。フラグメントシェーダー 1 枚で描くので軽く、ポインターの位置で流れが少し変わります。文字を上に重ねる使い方に向いています。',
  params: {
    color1: { type: 'color', label: '色 1', default: '#1b1464' },
    color2: { type: 'color', label: '色 2', default: '#ff5e8a' },
    color3: { type: 'color', label: '色 3', default: '#ffc46b' },
    color4: { type: 'color', label: '色 4', default: '#3ee0d0' },
    speed: { type: 'range', label: '速さ', min: 0, max: 3, step: 0.05, default: 1 },
    scale: { type: 'range', label: '模様の大きさ', min: 0.4, max: 3, step: 0.1, default: 1.2 },
    grain: { type: 'range', label: '粒状感', min: 0, max: 0.2, step: 0.01, default: 0.06 },
  },
};

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uScale;
uniform float uGrain;
uniform vec2 uRes;
uniform vec2 uPointer;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uC4;
varying vec2 vUv;
${snoise3}
void main(){
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * uScale;
  float t = uTime * 0.12;
  // ノイズで座標をずらしてからもう一度ノイズを引くと、流れるような模様になる。
  vec2 q = vec2(snoise(vec3(p * 0.9, t)), snoise(vec3(p * 0.9 + 5.2, t * 1.1)));
  vec2 r = p + q * 0.55 + uPointer * 0.3;
  float n1 = snoise(vec3(r * 0.8, t * 1.3)) * 0.5 + 0.5;
  float n2 = snoise(vec3(r * 1.3 + 3.1, t * 0.9)) * 0.5 + 0.5;
  float n3 = snoise(vec3(r * 0.5 - 7.7, t * 0.7)) * 0.5 + 0.5;
  vec3 col = mix(uC1, uC2, smoothstep(0.2, 0.85, n1));
  col = mix(col, uC3, smoothstep(0.45, 0.95, n2) * 0.85);
  col = mix(col, uC4, smoothstep(0.55, 1.0, n3) * 0.75);
  float g = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 100.0, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * uGrain;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { preview: p.preview, antialias: false, maxDpr: 1.5, startTime: 30 });
  const uniforms = {
    uTime: { value: 0 },
    uScale: { value: p.scale },
    uGrain: { value: p.grain },
    uRes: { value: new THREE.Vector2(1, 1) },
    uPointer: { value: new THREE.Vector2() },
    uC1: { value: new THREE.Color(p.color1) },
    uC2: { value: new THREE.Color(p.color2) },
    uC3: { value: new THREE.Color(p.color3) },
    uC4: { value: new THREE.Color(p.color4) },
  };
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: fullscreenVertex, fragmentShader, depthTest: false }),
  );
  quad.frustumCulled = false;
  stage.scene.add(quad);

  stage.onResize(({ width, height }) => uniforms.uRes.value.set(width, height));
  stage.onFrame((time) => {
    uniforms.uTime.value = time * p.speed;
    uniforms.uPointer.value.set(stage.pointer.sx, stage.pointer.sy);
  });

  return { destroy: () => stage.destroy() };
}
