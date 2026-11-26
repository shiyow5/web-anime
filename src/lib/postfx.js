import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// 映像の乱れを足す後処理。走査線、粒のざらつき、色のずれ、横方向の裂けを重ねる。
// 使い方:
//   const stage = createStage(container, { bloom: { strength: 0.5 } });
//   const noise = createNoisePass({ scan: 0.2, grain: 0.1 });
//   stage.addPass(noise.pass);
//   stage.onFrame((time, dt) => noise.update(time, dt));
//   noise.burst();   // 一瞬だけ強く乱す
const fragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform float uTime;
uniform float uBurst;
uniform float uScan;
uniform float uGrain;
uniform float uShift;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec2 uv = vUv;
  float tick = floor(uTime * 24.0);
  // 裂け。横長の帯を、帯ごとに違う量だけ左右へずらす。
  float bands = mix(10.0, 46.0, hash(vec2(floor(uTime * 9.0), 3.1)));
  float band = floor(uv.y * bands);
  float pick = step(1.0 - uBurst * 0.6, hash(vec2(band, tick)));
  uv.x += pick * (hash(vec2(band, tick + 7.7)) - 0.5) * 0.07 * uBurst;
  // ふだんも、ごく細い帯がときどき 1 本だけずれる。
  float line = step(0.997, hash(vec2(floor(uv.y * uRes.y * 0.5), tick)));
  uv.x += line * 0.012 * (0.4 + uBurst);

  float shift = uShift * (1.0 + uBurst * 4.0);
  vec3 col = vec3(
    texture2D(tDiffuse, uv + vec2(shift, 0.0)).r,
    texture2D(tDiffuse, uv).g,
    texture2D(tDiffuse, uv - vec2(shift, 0.0)).b
  );
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  // 走査線と、ゆっくり下りてくる明るい帯。
  col *= 1.0 - uScan * (0.5 + 0.5 * sin(vUv.y * uRes.y * 1.4));
  float roll = fract(vUv.y + uTime * 0.11);
  col *= 1.0 + 0.22 * uScan * smoothstep(0.0, 0.03, roll) * smoothstep(0.12, 0.03, roll);
  // 粒。暗い背景を持ち上げないように、明るいところほど強くかける。
  col += (hash(vUv * uRes + tick * 1.7) - 0.5) * uGrain * (0.25 + luma * 1.6);
  // 乱れている間は、全体が少しまたたく。
  col *= 1.0 + uBurst * (hash(vec2(tick, 1.3)) - 0.4) * 0.5;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// scan: 走査線の濃さ（0〜1）。grain: 粒の強さ。shift: 色のずれ（画面の幅に対する割合）。
// auto: 自動で乱れる間隔（秒）。0 にすると、burst() を呼んだときだけ乱れる。
export function createNoisePass({ scan = 0.2, grain = 0.1, shift = 0.0012, auto = 4 } = {}) {
  const uniforms = {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uBurst: { value: 0 },
    uScan: { value: scan },
    uGrain: { value: grain },
    uShift: { value: shift },
  };
  const pass = new ShaderPass(new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader }));
  pass.setSize = (width, height) => uniforms.uRes.value.set(width, height);

  let level = 0;
  let nextAuto = auto > 0 ? auto * (0.4 + Math.random() * 0.6) : Infinity;
  function burst(strength = 1) {
    level = Math.max(level, Math.min(1.5, strength));
  }
  function update(time, dt) {
    if (time > nextAuto) {
      burst(0.5 + Math.random() * 0.5);
      nextAuto = time + auto * (0.5 + Math.random());
    }
    level *= Math.exp(-dt * 5);
    uniforms.uTime.value = time;
    uniforms.uBurst.value = level < 0.01 ? 0 : level;
  }
  return { pass, uniforms, burst, update };
}
