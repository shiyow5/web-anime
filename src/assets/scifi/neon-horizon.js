import * as THREE from 'three';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { fullscreenVertex, snoise3 } from '../../lib/glsl.js';

export const meta = {
  id: 'neon-horizon',
  title: 'ネオンの地平線',
  category: 'scifi',
  libs: ['three'],
  description:
    '光る格子の大地が手前へ流れ、地平線に縞の入った太陽が沈みます。両脇は山のように盛り上がり、中央は谷になっています。80 年代の未来像を思わせる配色で、音楽やゲームのサイトに合います。',
  params: {
    grid: { type: 'color', label: '格子の色', default: '#ff3fd4' },
    sunTop: { type: 'color', label: '太陽の上の色', default: '#ffe14d' },
    sunBottom: { type: 'color', label: '太陽の下の色', default: '#ff2e7e' },
    skyTop: { type: 'color', label: '空の上の色', default: '#0b0524' },
    skyBottom: { type: 'color', label: '空の下の色', default: '#4a1470' },
    speed: { type: 'range', label: '進む速さ', min: 0, max: 6, step: 0.1, default: 1.6 },
    height: { type: 'range', label: '山の高さ', min: 0, max: 3, step: 0.1, default: 1.4 },
  },
};

const skyFragment = /* glsl */ `
uniform float uTime;
uniform vec2 uRes;
uniform vec3 uSkyTop;
uniform vec3 uSkyBottom;
uniform vec3 uSunTop;
uniform vec3 uSunBottom;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  float aspect = uRes.x / uRes.y;
  vec3 col = mix(uSkyBottom, uSkyTop, smoothstep(0.42, 1.0, vUv.y));
  // 星。空の上のほうにだけ散らす。
  vec2 grid = vUv * vec2(aspect, 1.0) * 60.0;
  vec2 cell = floor(grid);
  float dot = smoothstep(0.16, 0.04, length(fract(grid) - 0.5));
  float star = step(0.94, hash(cell)) * dot * smoothstep(0.5, 0.85, vUv.y);
  col += star * (0.5 + 0.5 * sin(uTime * 2.0 + hash(cell + 1.0) * 30.0));
  // 太陽。下へ行くほど太くなる横縞で切り欠く。
  vec2 p = (vUv - vec2(0.5, 0.56)) * vec2(aspect, 1.0);
  float d = length(p);
  float radius = 0.2;
  float sun = smoothstep(radius, radius - 0.004, d);
  float level = (p.y + radius) / (2.0 * radius);
  float bands = step(0.5 - (1.0 - level) * 0.45, fract(p.y * 26.0 - uTime * 0.25));
  sun *= mix(bands, 1.0, step(0.52, level));
  col = mix(col, mix(uSunBottom, uSunTop, level), sun);
  col += uSunBottom * smoothstep(0.55, 0.0, d) * 0.35 * (1.0 - sun);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const groundVertex = /* glsl */ `
uniform float uScroll;
uniform float uHeight;
varying vec2 vWorld;
varying float vDepth;
varying float vLift;
${snoise3}
void main(){
  vec3 p = position;
  float z = p.z - uScroll;
  // 中央は平らな谷にして、両脇だけを盛り上げる。
  float side = smoothstep(1.6, 7.0, abs(p.x));
  float lift = (snoise(vec3(p.x * 0.22, z * 0.22, 0.0)) * 0.5 + 0.5) * side * uHeight * 2.2;
  p.y += lift;
  vWorld = vec2(p.x, z);
  vLift = lift;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const groundFragment = /* glsl */ `
uniform vec3 uGrid;
uniform vec3 uGround;
varying vec2 vWorld;
varying float vDepth;
varying float vLift;
void main(){
  // 画面上の 1 画素ぶんの幅を使って、遠くの線が潰れないように太さをそろえる。
  vec2 g = abs(fract(vWorld - 0.5) - 0.5) / fwidth(vWorld);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  float fade = smoothstep(34.0, 6.0, vDepth);
  vec3 col = uGround + uGrid * line * (0.9 + vLift * 0.25);
  col += uGrid * 0.12 * fade;
  gl_FragColor = vec4(col * fade, 1.0);
  #include <colorspace_fragment>
}
`;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 62, far: 80, preview: p.preview });
  stage.camera.position.set(0, 1.25, 6);
  stage.camera.lookAt(0, 1.15, 0);

  const skyUniforms = {
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uSkyTop: { value: new THREE.Color(p.skyTop) },
    uSkyBottom: { value: new THREE.Color(p.skyBottom) },
    uSunTop: { value: new THREE.Color(p.sunTop) },
    uSunBottom: { value: new THREE.Color(p.sunBottom) },
  };
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms: skyUniforms, vertexShader: fullscreenVertex, fragmentShader: skyFragment, depthTest: false, depthWrite: false }),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -1;

  const groundUniforms = {
    uScroll: { value: 0 },
    uHeight: { value: p.height },
    uGrid: { value: new THREE.Color(p.grid) },
    uGround: { value: new THREE.Color(p.skyTop).multiplyScalar(0.6) },
  };
  const segments = p.preview ? 70 : 110;
  const groundGeometry = new THREE.PlaneGeometry(40, 44, segments, segments);
  groundGeometry.rotateX(-Math.PI / 2);
  groundGeometry.translate(0, 0, -14);
  const ground = new THREE.Mesh(groundGeometry, new THREE.ShaderMaterial({ uniforms: groundUniforms, vertexShader: groundVertex, fragmentShader: groundFragment }));
  ground.frustumCulled = false;
  stage.scene.add(sky, ground);

  stage.onResize(({ width, height }) => skyUniforms.uRes.value.set(width, height));
  stage.onFrame((time, dt) => {
    skyUniforms.uTime.value = time;
    groundUniforms.uScroll.value += dt * p.speed * 2;
    stage.camera.position.x = stage.pointer.sx * 0.6;
    stage.camera.position.y = 1.25 + stage.pointer.sy * 0.25;
    stage.camera.lookAt(0, 1.15, 0);
  });

  return { destroy: () => stage.destroy() };
}
