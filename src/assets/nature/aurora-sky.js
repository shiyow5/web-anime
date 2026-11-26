import * as THREE from 'three';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { fullscreenVertex } from '../../lib/glsl.js';

export const meta = {
  id: 'aurora-sky',
  title: 'オーロラの空',
  category: 'nature',
  libs: ['three'],
  description:
    '山並みの影の上で、オーロラの光の帯がゆっくり揺れます。星がまたたき、手前の湖には空がそのまま映り込みます。ポインターを左右に動かすと帯が流れます。空をクリックすると、その高さから帯が裂け、光の波が左右へ走って色が変わり、ゆっくり元の色へ戻ります。湖をクリックすると波紋が立ち、映った空がゆがみます。夜の静かな場面の背景に向いています。',
  params: {
    colorA: { type: 'color', label: '帯の下の色', default: '#4dffb4' },
    colorB: { type: 'color', label: '帯の上の色', default: '#a56bff' },
    sky: { type: 'color', label: '夜空の色', default: '#0a1436' },
    intensity: { type: 'range', label: '光の強さ', min: 0.2, max: 2, step: 0.05, default: 1 },
    speed: { type: 'range', label: 'ゆらめく速さ', min: 0, max: 3, step: 0.1, default: 1 },
    stars: { type: 'range', label: '星の多さ', min: 0, max: 1, step: 0.05, default: 0.6 },
  },
};

const HORIZON = 0.3;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uStars;
uniform float uShift;
uniform float uFlare;
uniform float uReveal;
uniform vec2 uTap;
uniform float uTapAge;
uniform vec3 uLake;
uniform vec2 uRes;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uSky;
varying vec2 vUv;
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float ridge(float x, float seed){
  return vnoise(vec2(x * 1.3 + seed, seed)) * 0.6 + vnoise(vec2(x * 3.9 + seed * 2.0, seed)) * 0.28 + vnoise(vec2(x * 11.0 + seed, 1.0)) * 0.12;
}
// 地平線から上の景色。q.y は地平線が 0。水面への映り込みでも同じ関数を使う。
vec3 scene(vec2 q){
  vec3 col = mix(uSky * 1.5 + uA * 0.05, uSky * 0.32, smoothstep(0.0, 0.7, q.y));

  // 星。升目ごとに 1 つ、明るさと瞬きの速さを変える。
  vec2 g = q * 46.0;
  vec2 id = floor(g);
  float r = hash21(id);
  vec2 c = 0.2 + 0.6 * vec2(hash21(id + 3.1), hash21(id + 7.7));
  float tw = 0.55 + 0.45 * sin(uTime * (0.8 + r * 3.0) + r * 50.0);
  float star = smoothstep(0.05 + r * 0.07, 0.0, length(fract(g) - c)) * step(1.0 - uStars * 0.42, r);
  col += star * tw * smoothstep(0.02, 0.3, q.y) * vec3(0.85, 0.92, 1.0);

  // オーロラ。3 枚の幕を奥行きを変えて重ねる。下の縁がはっきりしていて、上へ向かって薄れる。
  vec3 aurora = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x = q.x * (0.85 + fi * 0.3) + fi * 3.7 + uShift * (0.25 + fi * 0.2);
    // クリックの反応。幕ごとに少し遅らせて、裂け目・光の波・色の変化を順に起こす。
    float age = max(uTapAge - fi * 0.16, 0.0);
    float td = abs(q.x - uTap.x);
    float front = age * 0.8;
    float wave = exp(-pow((td - front) * 6.0, 2.0)) * exp(-age * 0.6) * step(0.001, age);
    float base = 0.17 + fi * 0.085 + 0.07 * sin(x * 1.7 + uTime * 0.25 + fi * 2.0) + 0.035 * sin(x * 4.3 - uTime * 0.4 + fi);
    base += wave * 0.05;
    float h = q.y - base;
    float len = 0.2 + 0.2 * vnoise(vec2(x * 2.0 + uTime * 0.2, fi * 4.0));
    float rays = 0.4 + 0.6 * vnoise(vec2(x * 15.0 + sin(uTime * 0.3 + fi) * 1.5, uTime * 0.35 + fi * 9.0));
    float curtain = smoothstep(-0.014, 0.004, h) * exp(-max(h, 0.0) / (len * 0.42));
    float gaps = smoothstep(0.2, 0.68, vnoise(vec2(x * 0.8 - uTime * 0.12, fi * 5.0 + uTime * 0.05)));
    vec3 tint = mix(uA, uB, clamp(h / len * 1.25, 0.0, 1.0));
    // 波が通ったあとは色相が回る。数秒かけて元の色へ戻る。
    float turned = smoothstep(front, front - 0.3, td) * smoothstep(7.0, 3.2, age) * step(0.001, age);
    tint = mix(tint, tint.gbr * vec3(1.15, 0.9, 1.1), turned * 0.85);
    // 裂け目。押した高さから上下へ開き、縁が白く光ってから閉じる。
    float reach = smoothstep(0.06 + age * 0.9, 0.0, abs(q.y - uTap.y));
    float tearW = 0.13 * smoothstep(0.0, 0.3, age) * exp(-age * 0.75) * reach;
    float tear = smoothstep(tearW * 0.45, tearW, td);
    float rim = exp(-pow((td - tearW) * 70.0, 2.0)) * smoothstep(0.004, 0.03, tearW);
    aurora += tint * curtain * (rays * gaps * tear * (1.0 + wave * 1.4) + wave * 0.25) * (1.0 - fi * 0.18);
    aurora += mix(tint, vec3(0.9, 1.0, 0.95), 0.5) * rim * curtain * 0.55;
  }
  float power = uIntensity * uReveal * (1.0 + uFlare * 1.3);
  col += aurora * power * 1.15;
  // 帯の光が低い空をうっすら染める。
  col += uA * 0.1 * power * exp(-q.y * 5.0);

  // 山並み。奥は空気に溶けて青く、手前は黒い。
  float far = 0.035 + ridge(q.x * 1.2, 3.0) * 0.15;
  col = mix(col, uSky * 0.75 + uA * 0.035 * power, smoothstep(far + 0.004, far, q.y));
  float near = 0.008 + ridge(q.x * 2.1 + 5.0, 8.0) * 0.1;
  col = mix(col, uSky * 0.16, smoothstep(near + 0.003, near, q.y));
  return col;
}
void main(){
  float aspect = uRes.x / uRes.y;
  float x = (vUv.x - 0.5) * aspect;
  float y = vUv.y - ${HORIZON.toFixed(2)};
  vec3 col;
  if (y >= 0.0) {
    col = scene(vec2(x, y));
  } else {
    // 湖面。上下を返して空を映し、さざ波で横にずらす。
    float depth = -y;
    float wobble = (vnoise(vec2(x * 7.0, depth * 150.0 - uTime * 1.1)) - 0.5) * (0.012 + depth * 0.09);
    wobble += sin(depth * 110.0 + uTime * 1.3) * 0.0025;
    // 湖を押したときの波紋。奥行きに合わせて縦につぶした輪が広がる。
    float la = uTime - uLake.z;
    float ld = length(vec2(x - uLake.x, (depth - uLake.y) * 3.2));
    float lring = sin((ld - la * 0.3) * 70.0) * exp(-abs(ld - la * 0.3) * 9.0) * exp(-la * 0.7) * step(0.0, la);
    wobble += lring * 0.03;
    col = scene(vec2(x + wobble, depth * 1.9 + 0.004)) * (0.62 - depth * 0.7);
    col += uSky * 0.12;
    // 水面に細い光の筋を散らす。
    float glint = smoothstep(0.86, 1.0, vnoise(vec2(x * 22.0 + uTime * 0.25, depth * 320.0)));
    col += glint * (uA * 0.1 + 0.02) * uIntensity * uReveal * smoothstep(0.0, 0.05, depth);
    col += lring * lring * (uA * 0.35 + 0.08);
    col = mix(col, uSky * 0.5, smoothstep(0.004, 0.0, depth) * 0.6);
  }
  col *= 1.0 - 0.3 * pow(length(vUv - vec2(0.5, 0.55)) * 1.25, 2.0);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { preview: p.preview, antialias: false, maxDpr: p.preview ? 1 : 1.5, startTime: 12 });
  const uniforms = {
    uTime: { value: 0 },
    uIntensity: { value: p.intensity },
    uStars: { value: p.stars },
    uShift: { value: 0 },
    uFlare: { value: 0 },
    uReveal: { value: stage.reduced ? 1 : 0 },
    uTap: { value: new THREE.Vector2(0, 0.3) },
    uTapAge: { value: 0 },
    uLake: { value: new THREE.Vector3(0, 0, -100) },
    uRes: { value: new THREE.Vector2(1, 1) },
    uA: { value: new THREE.Color(p.colorA) },
    uB: { value: new THREE.Color(p.colorB) },
    uSky: { value: new THREE.Color(p.sky) },
  };
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: fullscreenVertex, fragmentShader, depthTest: false }),
  );
  quad.frustumCulled = false;
  stage.scene.add(quad);

  stage.onResize(({ width, height }) => uniforms.uRes.value.set(width, height));
  stage.onFrame((time, dt) => {
    uniforms.uTime.value = 12 + (time - 12) * p.speed;
    // 登場: 帯が 2 秒ほどかけて灯る。
    uniforms.uReveal.value = Math.min(1, uniforms.uReveal.value + dt * 0.55);
    uniforms.uFlare.value *= Math.exp(-dt * 1.6);
    if (tapped) {
      uniforms.uTapAge.value += dt;
      // 裂け目が開ききる頃に、全体が一度だけ強く輝く。
      if (!flashed && uniforms.uTapAge.value > 0.28) {
        flashed = true;
        uniforms.uFlare.value = 0.4;
      }
      if (uniforms.uTapAge.value > 9) {
        tapped = false;
        uniforms.uTapAge.value = 0;
      }
    }
    uniforms.uShift.value = stage.pointer.sx;
  });

  let tapped = false;
  let flashed = false;
  // 押した位置を景色の座標に直す。空なら帯を裂き、湖なら波紋を立てて、映った位置の帯を裂く。
  function tear(nx, ny) {
    if (stage.reduced) return;
    const res = uniforms.uRes.value;
    const x = (nx - 0.5) * (res.x / Math.max(1, res.y));
    const y = 1 - ny - HORIZON;
    if (y < 0) uniforms.uLake.value.set(x, -y, uniforms.uTime.value);
    uniforms.uTap.value.set(x, y < 0 ? -y * 1.9 : y);
    uniforms.uTapAge.value = 0.0001;
    tapped = true;
    flashed = false;
  }
  function flare(event) {
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    tear((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  }
  container.addEventListener('pointerdown', flare);
  // 一覧では、数秒おきに場所を変えて裂け目を見せる。
  const auto = p.preview && !stage.reduced ? setInterval(() => tear(0.2 + Math.random() * 0.6, 0.2 + Math.random() * 0.3), 6500) : 0;

  return {
    destroy() {
      clearInterval(auto);
      container.removeEventListener('pointerdown', flare);
      stage.destroy();
    },
  };
}
