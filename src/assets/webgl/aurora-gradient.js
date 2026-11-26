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
    '4 色がゆっくり混ざり合う背景です。フラグメントシェーダー 1 枚で描くので軽く、ポインターの位置で流れが少し変わります。タップすると、その場所に色のしずくが落ち、波の輪が広がりながら 4 色の並びが入れ替わります。文字を上に重ねる使い方に向いています。',
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
uniform vec3 uN1;
uniform vec3 uN2;
uniform vec3 uN3;
uniform vec3 uN4;
uniform vec2 uTap;
uniform float uWave;
uniform float uPunch;
uniform float uDrop;
uniform float uSwap;
varying vec2 vUv;
${snoise3}
void main(){
  vec2 a = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  // タップした場所からの距離。しずくのくぼみと、広がる波の輪に使う。
  vec2 fromTap = a - uTap;
  float dist = length(fromTap);
  vec2 dir = fromTap / (dist + 0.0001);
  float front = dist - uWave;
  float ring = exp(-front * front * 55.0) * uPunch;
  float drop = exp(-dist * dist * 22.0) * uDrop;
  vec2 p = (a - dir * ring * 0.11 - fromTap * drop * 0.85) * uScale;
  float t = uTime * 0.12;
  // ノイズで座標をずらしてからもう一度ノイズを引くと、流れるような模様になる。
  vec2 q = vec2(snoise(vec3(p * 0.9, t)), snoise(vec3(p * 0.9 + 5.2, t * 1.1)));
  vec2 r = p + q * 0.55 + uPointer * 0.3;
  float n1 = snoise(vec3(r * 0.8, t * 1.3)) * 0.5 + 0.5;
  float n2 = snoise(vec3(r * 1.3 + 3.1, t * 0.9)) * 0.5 + 0.5;
  float n3 = snoise(vec3(r * 0.5 - 7.7, t * 0.7)) * 0.5 + 0.5;
  // 波の輪が通り過ぎた内側は、次の色の並びに替わる。境目はノイズでゆらす。
  float inside = smoothstep(0.07, -0.07, front + (n2 - 0.5) * 0.16) * uSwap;
  vec3 c1 = mix(uC1, uN1, inside);
  vec3 c2 = mix(uC2, uN2, inside);
  vec3 c3 = mix(uC3, uN3, inside);
  vec3 c4 = mix(uC4, uN4, inside);
  vec3 col = mix(c1, c2, smoothstep(0.2, 0.85, n1));
  col = mix(col, c3, smoothstep(0.45, 0.95, n2) * 0.85);
  col = mix(col, c4, smoothstep(0.55, 1.0, n3) * 0.75);
  col += ring * 0.22 + exp(-dist * dist * 120.0) * uDrop * 0.4;
  float g = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 100.0, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * uGrain;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const DROP_TIME = 0.24; // しずくが落ちてくぼむまで
const WAVE_TIME = 1.7; // 波の輪が枠の端まで届くまで

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { preview: p.preview, antialias: false, maxDpr: 1.5, startTime: 30 });
  const palette = [p.color1, p.color2, p.color3, p.color4].map((color) => new THREE.Color(color));
  const uniforms = {
    uTime: { value: 0 },
    uScale: { value: p.scale },
    uGrain: { value: p.grain },
    uRes: { value: new THREE.Vector2(1, 1) },
    uPointer: { value: new THREE.Vector2() },
    uC1: { value: palette[0].clone() },
    uC2: { value: palette[1].clone() },
    uC3: { value: palette[2].clone() },
    uC4: { value: palette[3].clone() },
    uN1: { value: palette[1].clone() },
    uN2: { value: palette[2].clone() },
    uN3: { value: palette[3].clone() },
    uN4: { value: palette[0].clone() },
    uTap: { value: new THREE.Vector2() },
    uWave: { value: 0 },
    uPunch: { value: 0 },
    uDrop: { value: 0 },
    uSwap: { value: 0 },
  };
  const current = [uniforms.uC1, uniforms.uC2, uniforms.uC3, uniforms.uC4];
  const upcoming = [uniforms.uN1, uniforms.uN2, uniforms.uN3, uniforms.uN4];
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: fullscreenVertex, fragmentShader, depthTest: false }),
  );
  quad.frustumCulled = false;
  stage.scene.add(quad);

  let offset = 0; // 色の並びを何回ずらしたか
  let age = -1; // タップからの秒数。-1 は何も起きていない
  let reach = 1; // 波の輪が届かせる半径
  let flow = null;
  let rush = 0; // 余韻のあいだ、流れを速める量

  // 次の並びを今の並びとして確定し、その次の並びを用意する。
  function commit() {
    offset = (offset + 1) % 4;
    current.forEach((uniform, i) => uniform.value.copy(palette[(i + offset) % 4]));
    upcoming.forEach((uniform, i) => uniform.value.copy(palette[(i + offset + 1) % 4]));
    uniforms.uSwap.value = 0;
    uniforms.uWave.value = 0;
    uniforms.uPunch.value = 0;
    uniforms.uDrop.value = 0;
    age = -1;
  }

  function drop(event) {
    // 続けてタップされたら、途中の入れ替えを確定してから次を始める。
    if (age >= 0) commit();
    if (stage.reduced) {
      commit();
      return;
    }
    const rect = container.getBoundingClientRect();
    const aspect = stage.size.width / Math.max(1, stage.size.height);
    const hasPoint = typeof event?.clientX === 'number' && rect.width > 0 && rect.height > 0;
    const x = hasPoint ? (event.clientX - rect.left) / rect.width - 0.5 : Math.random() * 0.6 - 0.3;
    const y = hasPoint ? 0.5 - (event.clientY - rect.top) / rect.height : Math.random() * 0.5 - 0.25;
    uniforms.uTap.value.set(x * aspect, y);
    reach = Math.hypot(Math.abs(x) * aspect + aspect / 2, Math.abs(y) + 0.5) + 0.25;
    uniforms.uSwap.value = 1;
    age = 0;
  }

  stage.onResize(({ width, height }) => uniforms.uRes.value.set(width, height));
  stage.onFrame((time, dt) => {
    if (flow === null) flow = time * p.speed;
    rush *= Math.exp(-dt * 1.6);
    flow += dt * p.speed * (1 + rush);
    uniforms.uTime.value = flow;
    uniforms.uPointer.value.set(stage.pointer.sx, stage.pointer.sy);
    if (age < 0) return;
    age += dt;
    // 準備: しずくが落ちて、その場所がくぼむ。
    const fall = Math.min(1, age / DROP_TIME);
    const wave = Math.max(0, (age - DROP_TIME * 0.7) / WAVE_TIME);
    uniforms.uDrop.value = Math.sin(fall * Math.PI * 0.5) * Math.max(0, 1 - wave * 3.2);
    // 山場: 波の輪が広がり、内側の色が入れ替わる。
    const eased = 1 - Math.pow(1 - Math.min(1, wave), 2.4);
    uniforms.uWave.value = eased * reach;
    uniforms.uPunch.value = wave > 0 ? Math.pow(1 - Math.min(1, wave), 0.8) : 0;
    // 余韻: 輪が通ったあと、しばらく流れが速くなる。
    if (wave > 0.1) rush = Math.max(rush, 2.6 * (1 - Math.min(1, wave)));
    if (wave >= 1) commit();
  });

  container.addEventListener('pointerdown', drop);
  const auto = p.preview && !stage.reduced ? setInterval(drop, 4200) : 0;

  return {
    drop,
    destroy() {
      clearInterval(auto);
      container.removeEventListener('pointerdown', drop);
      stage.destroy();
    },
  };
}
