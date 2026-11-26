import * as THREE from 'three';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'sakura-fall',
  title: '桜吹雪',
  category: 'nature',
  libs: ['three'],
  description:
    '桜の花びらが、くるくる回りながら舞い落ちます。1 枚ずつ大きさ、色、回り方が違い、風の向きはポインターの左右の位置で変わります。クリックするとつむじ風が起き、花びらがその場所へ吸い寄せられてから、渦を巻いて外へ吹き飛び、風が揺り戻して静まります。和風のサイトや、春の催しの告知に合います。',
  params: {
    count: { type: 'range', label: '花びらの数', min: 30, max: 900, step: 10, default: 320 },
    colorA: { type: 'color', label: '花びらの色 A', default: '#ffb7c9' },
    colorB: { type: 'color', label: '花びらの色 B', default: '#fff3f6' },
    background: { type: 'color', label: '背景色', default: '#fbe4ea' },
    speed: { type: 'range', label: '落ちる速さ', min: 0.2, max: 3, step: 0.1, default: 1 },
    wind: { type: 'range', label: '風の強さ', min: -2, max: 2, step: 0.1, default: 0.5 },
  },
};

const WIDTH = 14;
const HEIGHT = 9;

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uWind;
uniform vec3 uGust;
attribute vec3 aOffset;
attribute vec4 aSeed;
varying float vShade;
varying float vMix;
mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a){ float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
void main(){
  float fall = uTime * (0.35 + aSeed.x * 0.5) * uSpeed;
  float tt = uTime * (0.6 + aSeed.y) + aSeed.z * 30.0;
  vec3 c = aOffset;
  // 下まで落ちたら上へ戻す。落ちるほど風に流される。
  c.y = mod(aOffset.y - fall + ${(HEIGHT / 2).toFixed(1)}, ${HEIGHT.toFixed(1)}) - ${(HEIGHT / 2).toFixed(1)};
  c.x += sin(tt) * 0.5 + uWind * (${(HEIGHT / 2).toFixed(1)} - c.y) * 0.3;
  c.x = mod(c.x + ${(WIDTH / 2).toFixed(1)}, ${WIDTH.toFixed(1)}) - ${(WIDTH / 2).toFixed(1)};
  c.z += cos(tt * 0.7) * 0.3;

  // つむじ風。押した場所へ吸い寄せ（準備）、輪になって渦を巻きながら外へ飛ばす（山場）。
  // 位置は毎回もとの軌道から計算するので、輪が通り過ぎると花びらは自然に元の流れへ戻る。
  float ga = uTime - uGust.z - aSeed.y * 0.18;
  float whirl = 0.0;
  if (ga > 0.0 && ga < 7.0) {
    float persp = 7.0 / (7.0 - c.z);
    vec2 gd = c.xy * persp - uGust.xy;
    float dist = length(gd) + 0.001;
    vec2 dir = gd / dist;
    float pull = smoothstep(0.0, 0.16, ga) * smoothstep(0.5, 0.26, ga) * exp(-dist * 0.45);
    float blow = max(ga - 0.32, 0.0);
    float ring = exp(-pow((dist - blow * 3.0) * 0.7, 2.0)) * exp(-blow * 0.75) * step(0.32, ga);
    vec2 push = -dir * pull * min(dist, 2.2) * 0.85 + dir * ring * 1.5 + vec2(-dir.y, dir.x) * ring * 2.4;
    c.xy += push / persp;
    c.y += ring * 0.5;
    whirl = ring * 9.0 + pull * 5.0;
  }

  // 花びらを少し反らせてから、3 つの軸で回す。
  vec3 q = position * (0.16 + aSeed.w * 0.2);
  q.z += q.x * q.x * 2.2;
  mat3 turn = rotY(tt * 0.5 + whirl * 0.6) * rotZ(tt * 0.9 + aSeed.x * 6.0 + whirl) * rotX(tt * 1.3 + whirl * 0.8);
  vec3 n = turn * vec3(0.0, 0.0, 1.0);
  vShade = 0.72 + 0.28 * abs(dot(n, normalize(vec3(0.3, 0.8, 0.5))));
  vMix = aSeed.z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(c + turn * q, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uA;
uniform vec3 uB;
varying float vShade;
varying float vMix;
void main(){
  gl_FragColor = vec4(mix(uA, uB, vMix) * vShade, 1.0);
  #include <colorspace_fragment>
}
`;

// 先に切れ込みのある、桜の花びらの形。
function petalShape() {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.5);
  shape.bezierCurveTo(0.45, -0.3, 0.5, 0.3, 0.13, 0.5);
  shape.lineTo(0, 0.38);
  shape.lineTo(-0.13, 0.5);
  shape.bezierCurveTo(-0.5, 0.3, -0.45, -0.3, 0, -0.5);
  return shape;
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 45, cameraZ: 7, background: p.background, preview: p.preview });
  const count = Math.round(p.preview ? Math.min(p.count, 180) : p.count);

  const base = new THREE.ShapeGeometry(petalShape(), 5);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute('position', base.attributes.position);
  geometry.instanceCount = count;
  const offsets = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    offsets.set([(Math.random() - 0.5) * WIDTH, (Math.random() - 0.5) * HEIGHT, (Math.random() - 0.5) * 6 - 0.5], i * 3);
  }
  geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(count * 4).map(() => Math.random()), 4));

  const uniforms = {
    uTime: { value: 0 },
    uSpeed: { value: p.speed },
    uWind: { value: p.wind },
    uGust: { value: new THREE.Vector3(0, 0, -100) },
    uA: { value: new THREE.Color(p.colorA) },
    uB: { value: new THREE.Color(p.colorB) },
  };
  const petals = new THREE.Mesh(geometry, new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, side: THREE.DoubleSide }));
  petals.frustumCulled = false;
  stage.scene.add(petals);
  stage.onDispose(() => base.dispose());

  let now = 0;
  let sway = 0;
  stage.onFrame((time) => {
    now = time;
    uniforms.uTime.value = time;
    // 余韻: つむじ風のあと、風が左右に揺り戻しながら静まる。
    const after = time - uniforms.uGust.value.z - 0.5;
    const rebound = after > 0 && after < 8 ? sway * Math.exp(-after * 0.7) * Math.sin(after * 2.4) : 0;
    uniforms.uWind.value = p.wind + stage.pointer.sx * 1.2 + rebound;
  });

  function gustAt(nx, ny) {
    if (stage.reduced) return;
    const view = stage.viewport();
    uniforms.uGust.value.set((nx - 0.5) * view.width, (0.5 - ny) * view.height, now);
    // 押した側から反対側へ向かって揺り戻す。
    sway = nx >= 0.5 ? -0.5 : 0.5;
  }
  function gust(event) {
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    gustAt((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  }
  container.addEventListener('pointerdown', gust);
  // 一覧では、数秒おきに場所を変えてつむじ風を見せる。
  const auto = p.preview && !stage.reduced ? setInterval(() => gustAt(0.25 + Math.random() * 0.5, 0.3 + Math.random() * 0.4), 5200) : 0;

  return {
    gust: gustAt,
    destroy() {
      clearInterval(auto);
      container.removeEventListener('pointerdown', gust);
      stage.destroy();
    },
  };
}
