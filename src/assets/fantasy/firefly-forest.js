import * as THREE from 'three';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { fullscreenVertex } from '../../lib/glsl.js';

export const meta = {
  id: 'firefly-forest',
  title: '蛍の森',
  category: 'fantasy',
  libs: ['three'],
  description:
    '霧のかかった夜の森に、蛍がゆっくり明滅しながら漂います。木の幹は奥行きごとに重ねてあり、ポインターを動かすと手前と奥がずれて見えます。蛍はポインターのほうへ少し集まってきます。',
  params: {
    count: { type: 'range', label: '蛍の数', min: 20, max: 600, step: 10, default: 220 },
    color: { type: 'color', label: '蛍の色', default: '#d8ff7a' },
    mist: { type: 'color', label: '霧の色', default: '#2f6f6a' },
    skyTop: { type: 'color', label: '空の上の色', default: '#04101a' },
    skyBottom: { type: 'color', label: '空の下の色', default: '#123a3f' },
    speed: { type: 'range', label: '動く速さ', min: 0, max: 3, step: 0.1, default: 1 },
  },
};

const forestFragment = /* glsl */ `
uniform float uTime;
uniform vec2 uRes;
uniform vec2 uPointer;
uniform vec3 uSkyTop;
uniform vec3 uSkyBottom;
uniform vec3 uMist;
varying vec2 vUv;
float hash(float n){ return fract(sin(n * 127.1) * 43758.5453); }
// 1 層ぶんの幹。横方向を区切り、区切りごとに太さ・位置・傾きを変える。
float trunks(vec2 uv, float freq, float seed, float shift){
  float x = (uv.x + shift) * freq + seed * 17.0;
  float id = floor(x);
  float f = fract(x);
  float width = 0.05 + hash(id + seed) * 0.1;
  float center = 0.5 + (hash(id * 1.7 + seed) - 0.5) * 0.5;
  float lean = (hash(id * 2.3 + seed) - 0.5) * 0.3 * uv.y;
  float present = step(0.3, hash(id * 3.1 + seed));
  return smoothstep(width, width - 0.02, abs(f - center + lean)) * present;
}
void main(){
  float aspect = uRes.x / uRes.y;
  vec2 uv = vec2((vUv.x - 0.5) * aspect, vUv.y);
  vec3 col = mix(uSkyBottom, uSkyTop, smoothstep(0.0, 1.0, vUv.y));
  // 木々の向こうの月明かり。
  col += uMist * 0.9 * smoothstep(0.7, 0.0, length(uv - vec2(0.25, 0.72)));
  vec3 dark = uSkyTop * 0.25;
  for (int i = 0; i < 4; i++) {
    float depth = float(i) / 3.0;
    float freq = mix(5.5, 1.6, depth);
    float shift = uPointer.x * mix(0.01, 0.09, depth);
    float mask = trunks(uv, freq, float(i) + 1.0, shift);
    // 奥の幹は霧に溶けて明るく、手前の幹ほど黒い。
    col = mix(col, mix(uMist * 0.55, dark, depth), mask);
    col = mix(col, uMist, 0.16 * (1.0 - depth) * smoothstep(0.9, 0.0, vUv.y));
  }
  float ground = smoothstep(0.17 + sin(uv.x * 7.0) * 0.02 + sin(uv.x * 23.0) * 0.008, 0.11, vUv.y);
  col = mix(col, dark, ground);
  col *= mix(1.0, 0.5, smoothstep(0.65, 1.0, vUv.y));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const fireflyVertex = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uHover;
uniform vec2 uPointer;
attribute vec4 aSeed;
varying float vGlow;
void main(){
  vec3 p = position;
  float t = uTime;
  p.x += sin(t * (0.3 + aSeed.x * 0.4) + aSeed.y * 30.0) * 0.6;
  p.y += sin(t * (0.25 + aSeed.z * 0.35) + aSeed.w * 30.0) * 0.4 + sin(t * 1.7 + aSeed.x * 20.0) * 0.05;
  p.z += cos(t * (0.2 + aSeed.w * 0.3) + aSeed.x * 30.0) * 0.5;
  p.xy += (uPointer - p.xy) * 0.18 * uHover * aSeed.z;
  // 明滅。ゆっくり光って、すっと消える。
  float blink = pow(sin(t * (0.6 + aSeed.y * 0.9) + aSeed.z * 40.0) * 0.5 + 0.5, 3.0);
  vGlow = 0.12 + blink;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.5 + aSeed.w) * (0.6 + blink * 0.7) / -mv.z;
}
`;

const fireflyFragment = /* glsl */ `
uniform vec3 uColor;
varying float vGlow;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float core = smoothstep(0.12, 0.0, d);
  float halo = pow(smoothstep(0.5, 0.0, d), 2.2);
  float a = (core + halo * 0.6) * vGlow;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.6) * a, a);
  #include <colorspace_fragment>
}
`;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { cameraZ: 6, preview: p.preview, antialias: false, startTime: 20 });
  const count = Math.round(p.preview ? Math.min(p.count, 140) : p.count);

  const forestUniforms = {
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uPointer: { value: new THREE.Vector2() },
    uSkyTop: { value: new THREE.Color(p.skyTop) },
    uSkyBottom: { value: new THREE.Color(p.skyBottom) },
    uMist: { value: new THREE.Color(p.mist) },
  };
  const forest = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms: forestUniforms, vertexShader: fullscreenVertex, fragmentShader: forestFragment, depthTest: false, depthWrite: false }),
  );
  forest.frustumCulled = false;
  forest.renderOrder = -1;

  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 4).map(() => Math.random());
  for (let i = 0; i < count; i += 1) {
    positions.set([(Math.random() - 0.5) * 11, (Math.random() - 0.55) * 4.2, (Math.random() - 0.6) * 5], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const fireflyUniforms = {
    uTime: { value: 0 },
    uSize: { value: 1 },
    uHover: { value: 0 },
    uPointer: { value: new THREE.Vector2() },
    uColor: { value: new THREE.Color(p.color) },
  };
  const fireflies = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({ uniforms: fireflyUniforms, vertexShader: fireflyVertex, fragmentShader: fireflyFragment, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }),
  );
  fireflies.frustumCulled = false;
  stage.scene.add(forest, fireflies);

  stage.onResize(({ width, height, dpr }) => {
    forestUniforms.uRes.value.set(width, height);
    fireflyUniforms.uSize.value = height * dpr * 0.2;
  });
  stage.onFrame((time, dt) => {
    const view = stage.viewport();
    forestUniforms.uTime.value = time;
    forestUniforms.uPointer.value.set(stage.pointer.sx, stage.pointer.sy);
    fireflyUniforms.uTime.value = time * p.speed;
    fireflyUniforms.uPointer.value.set((stage.pointer.sx * view.width) / 2, (stage.pointer.sy * view.height) / 2);
    const target = stage.pointer.inside ? 1 : 0;
    fireflyUniforms.uHover.value += (target - fireflyUniforms.uHover.value) * Math.min(1, dt * 2 + 0.01);
    stage.camera.position.x = stage.pointer.sx * 0.25;
  });

  return { destroy: () => stage.destroy() };
}
