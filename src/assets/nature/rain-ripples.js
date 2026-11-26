import * as THREE from 'three';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { fullscreenVertex } from '../../lib/glsl.js';

export const meta = {
  id: 'rain-ripples',
  title: '雨の波紋',
  category: 'nature',
  libs: ['three'],
  description:
    '静かな水面に雨粒が落ちて、波紋が広がっては消えます。ポインターを動かすと、通った跡にも波紋が立ちます。クリックすると大粒のしずくが落ちます。大きな波紋のまわりに、跳ね上がった小さなしずくが時間差で輪になって落ち、真ん中にも跳ね返りの一滴が落ちます。波紋は画面の端で折り返して戻ってきます。落ち着いた雰囲気のページの背景に向いています。',
  params: {
    rain: { type: 'range', label: '雨の量', min: 0, max: 1, step: 0.05, default: 0.5 },
    speed: { type: 'range', label: '速さ', min: 0.2, max: 3, step: 0.1, default: 1 },
    deep: { type: 'color', label: '水の暗い色', default: '#07242e' },
    light: { type: 'color', label: '水面に映る色', default: '#9fd8d0' },
  },
};

const MAX_DROPS = 20;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uRain;
uniform vec2 uRes;
uniform vec3 uDeep;
uniform vec3 uLight;
uniform vec4 uDrops[${MAX_DROPS}];
varying vec2 vUv;
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// 1 つの波紋。輪が広がりながら弱まっていく。
float ripple(vec2 p, vec2 center, float age, float strength){
  float d = length(p - center);
  float front = age * 0.5;
  return sin((d - front) * 40.0) * exp(-abs(d - front) * 9.0) * exp(-age * 1.5) * smoothstep(0.0, 0.06, age) * strength;
}
float height(vec2 p){
  float h = 0.0;
  // 雨粒。画面を升目に区切り、升目ごとに落ちる時刻と位置を乱数で決める。
  for (int layer = 0; layer < 2; layer++) {
    float scale = 2.4 + float(layer) * 1.9;
    vec2 g = p * scale + float(layer) * 13.7;
    vec2 id = floor(g);
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 cell = id + vec2(float(x), float(y));
        float rnd = hash21(cell + float(layer) * 7.0);
        float period = 2.2 + rnd * 2.2;
        float t = uTime / period + rnd * 10.0;
        float cycle = floor(t);
        float falls = step(1.0 - uRain, hash21(cell + cycle * 1.7));
        vec2 center = cell + vec2(hash21(cell + cycle), hash21(cell + cycle + 5.3));
        h += ripple(g, center, fract(t) * period, falls) / scale;
      }
    }
  }
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    float age = uTime - uDrops[i].z;
    if (age > 0.0 && age < 5.0) h += ripple(p, uDrops[i].xy, age, uDrops[i].w);
  }
  return h;
}
void main(){
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  // 傾きは隣の画素との差から求める。高さを 1 回計算するだけで済む。
  float h = height(p);
  float hx = -dFdx(h) * uRes.y * 0.0022;
  float hy = -dFdy(h) * uRes.y * 0.0022;
  vec3 n = normalize(vec3(hx, hy, 0.05));
  // 水面は空を映す。傾いた面ほど明るい空を映すので、波の輪が光って見える。
  float sky = clamp(0.22 + vUv.y * 0.35 + n.y * 1.6 + n.x * 0.6, 0.0, 1.0);
  vec3 col = mix(uDeep, uLight, sky * sky);
  float spec = pow(max(dot(n, normalize(vec3(0.25, 0.55, 0.8))), 0.0), 60.0);
  col += spec * 0.5;
  col *= 1.0 - 0.35 * length(vUv - 0.5);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { preview: p.preview, antialias: false, maxDpr: p.preview ? 1 : 1.5, startTime: 10 });
  const drops = Array.from({ length: MAX_DROPS }, () => new THREE.Vector4(0, 0, -100, 0));
  const uniforms = {
    uTime: { value: 0 },
    uRain: { value: p.rain },
    uRes: { value: new THREE.Vector2(1, 1) },
    uDeep: { value: new THREE.Color(p.deep) },
    uLight: { value: new THREE.Color(p.light) },
    uDrops: { value: drops },
  };
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: fullscreenVertex, fragmentShader, depthTest: false }),
  );
  quad.frustumCulled = false;
  stage.scene.add(quad);

  let next = 0;
  let last = { x: 0, y: 0 };
  let aspect = 1;
  const toSurface = () => ({ x: (stage.pointer.x * aspect) / 2, y: stage.pointer.y / 2 });
  function addDrop(strength, at = toSurface(), when = uniforms.uTime.value) {
    drops[next].set(at.x, at.y, when, strength);
    next = (next + 1) % MAX_DROPS;
    last = at;
  }

  stage.onResize(({ width, height }) => {
    uniforms.uRes.value.set(width, height);
    aspect = width / height;
  });
  stage.onFrame((time) => {
    uniforms.uTime.value = time * p.speed;
    if (!stage.pointer.inside || stage.reduced) return;
    const at = toSurface();
    // ポインターが一定の距離を動くたびに、小さな波紋を 1 つ足す。
    if (Math.hypot(at.x - last.x, at.y - last.y) > 0.09) addDrop(0.6);
  });

  // タッチでは、押す前にポインターの移動が届かないことがある。押した位置はイベントから求める。
  function splash(event) {
    if (stage.reduced) return;
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    crown({ x: (nx * aspect) / 2, y: ny / 2 });
  }
  // 大粒のしずく。山場は大きな波紋、続いて王冠のように跳ねた小さなしずくが順に落ち、余韻として端からの折り返しが戻る。
  function crown(at) {
    const now = uniforms.uTime.value;
    addDrop(1.7, at);
    const turn = Math.random() * Math.PI * 2;
    const beads = 6;
    for (let i = 0; i < beads; i += 1) {
      const angle = turn + (i / beads) * Math.PI * 2;
      const reach = 0.1 + Math.random() * 0.07;
      addDrop(0.55 + Math.random() * 0.25, { x: at.x + Math.cos(angle) * reach, y: at.y + Math.sin(angle) * reach }, now + 0.22 + i * 0.07 + Math.random() * 0.05);
    }
    // 真ん中に、跳ね返った一滴が遅れて落ちる。
    addDrop(1.0, at, now + 0.75);
    // 折り返し。端の向こうに鏡写しの波源を置くと、波が端に届いた頃に内側へ戻ってくる。
    const half = aspect / 2;
    addDrop(2.6, { x: (at.x >= 0 ? 2 * half : -2 * half) - at.x, y: at.y });
    addDrop(2.6, { x: at.x, y: (at.y >= 0 ? 1 : -1) - at.y });
    last = at;
  }
  container.addEventListener('pointerdown', splash);
  // 一覧では、数秒おきに大粒のしずくを落として見せる。
  const auto = p.preview && !stage.reduced ? setInterval(() => crown({ x: (Math.random() - 0.5) * aspect * 0.6, y: (Math.random() - 0.5) * 0.5 }), 4800) : 0;

  return {
    destroy() {
      clearInterval(auto);
      container.removeEventListener('pointerdown', splash);
      stage.destroy();
    },
  };
}
