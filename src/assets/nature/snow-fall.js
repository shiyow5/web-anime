import * as THREE from 'three';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { fullscreenVertex } from '../../lib/glsl.js';

export const meta = {
  id: 'snow-fall',
  title: '降る雪',
  category: 'nature',
  libs: ['three'],
  description:
    '夕暮れの雪原に雪が降ります。近い雪は大きく速く、遠い雪は小さくゆっくり落ちるので、奥行きが感じられます。ポインターを左右に動かすと風向きが変わり、クリックすると突風が吹きます。手前には雪をかぶった木と小屋の影を置いています。',
  params: {
    count: { type: 'range', label: '雪の量', min: 100, max: 3000, step: 50, default: 1300 },
    speed: { type: 'range', label: '落ちる速さ', min: 0.2, max: 3, step: 0.1, default: 1 },
    wind: { type: 'range', label: '風の強さ', min: -2, max: 2, step: 0.1, default: 0.4 },
    size: { type: 'range', label: '雪の大きさ', min: 0.5, max: 2.5, step: 0.1, default: 1 },
    skyTop: { type: 'color', label: '空の上の色', default: '#182654' },
    skyBottom: { type: 'color', label: '空の下の色', default: '#d3a8c6' },
  },
};

const BOX = { width: 22, height: 12 };

const sceneFragment = /* glsl */ `
uniform vec2 uRes;
uniform float uShift;
uniform vec3 uTop;
uniform vec3 uBottom;
varying vec2 vUv;
const vec3 SNOW = vec3(0.93, 0.96, 1.0);
float hash(float n){ return fract(sin(n * 127.1) * 43758.5453); }
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float ridge(float x, float seed){
  return vnoise(vec2(x * 1.3 + seed, seed)) * 0.65 + vnoise(vec2(x * 4.1 + seed * 2.0, seed)) * 0.35;
}
float midHill(float x){ return 0.25 + ridge(x * 1.6 + 4.0, 9.0) * 0.1; }
float groundLine(float x){ return 0.15 + 0.035 * sin(x * 2.3 + 1.0) + 0.012 * sin(x * 7.1); }
// 針葉樹を 1 列ぶん描く。x に形の内側か、y に枝先の雪の量を返す。
vec2 trees(vec2 uv, float freq, float seed, float onGround, float sizeMin, float sizeMax){
  float gx = uv.x * freq + seed * 13.0;
  float id = floor(gx);
  float present = step(0.3, hash(id * 1.7 + seed));
  float size = mix(sizeMin, sizeMax, hash(id + seed));
  float cx = (id + 0.5 + (hash(id * 2.3 + seed) - 0.5) * 0.3 - seed * 13.0) / freq;
  float base = mix(midHill(cx) - 0.012, groundLine(cx) - 0.03, onGround);
  vec2 q = vec2(uv.x - cx, uv.y - base) / size;
  if (q.y < 0.0 || q.y > 1.0) return vec2(0.0);
  float trunk = step(abs(q.x), 0.022) * step(q.y, 0.16);
  float t = (q.y - 0.12) / 0.88;
  float tier = fract(t * 4.0);
  float w = (1.0 - t) * 0.26 * (0.5 + 0.5 * (1.0 - tier)) + 0.01 * (1.0 - t);
  float body = step(0.12, q.y) * smoothstep(w, w - 0.012, abs(q.x));
  float snow = body * smoothstep(0.4, 0.85, abs(q.x) / max(w, 0.001));
  return vec2(max(trunk, body) * present, snow);
}
void main(){
  float aspect = uRes.x / uRes.y;
  float x = (vUv.x - 0.5) * aspect;
  float y = vUv.y;
  vec3 col = mix(uBottom, uTop, smoothstep(0.2, 0.95, y));

  // 月と、そのまわりの明かり。
  float md = length(vec2(x, y) - vec2(aspect * 0.24, 0.77));
  col += vec3(1.0, 0.96, 0.9) * (smoothstep(0.052, 0.047, md) * 0.85 + 0.22 * exp(-md * 6.0));

  // 遠い山並み。
  float xs = x + uShift * 0.01;
  float far = 0.34 + ridge(xs * 1.1, 2.0) * 0.17;
  vec3 farCol = mix(uTop, uBottom, 0.55);
  col = mix(col, mix(farCol, SNOW, 0.18 * smoothstep(far - 0.08, far, y)), smoothstep(far + 0.003, far, y));

  // 中ほどの丘と、小さな木立。
  xs = x + uShift * 0.025;
  float mid = midHill(xs);
  vec3 midCol = mix(uTop, SNOW, 0.5);
  col = mix(col, mix(midCol * 0.82, midCol, smoothstep(mid - 0.1, mid, y)), smoothstep(mid + 0.003, mid, y));
  vec2 small = trees(vec2(xs, y), 5.0, 2.0, 0.0, 0.07, 0.13);
  col = mix(col, mix(uTop * 0.75, SNOW, small.y * 0.55), small.x);

  // 手前の雪原。くぼみに淡い影を落とす。
  xs = x + uShift * 0.05;
  float ground = groundLine(xs);
  vec3 groundCol = mix(mix(uTop, SNOW, 0.62), SNOW, smoothstep(ground - 0.17, ground, y));
  groundCol *= 0.94 + 0.06 * sin(xs * 9.0 + y * 40.0);
  col = mix(col, groundCol, smoothstep(ground + 0.003, ground, y));

  // 小屋。窓に灯りがともる。
  float cx = 0.05;
  float cb = groundLine(cx) - 0.008;
  vec2 c = vec2(xs - cx, y - cb);
  float wall = step(abs(c.x), 0.045) * step(0.0, c.y) * step(c.y, 0.05);
  float roofT = (c.y - 0.05) / 0.042;
  float roof = step(0.0, roofT) * step(roofT, 1.0) * step(abs(c.x), 0.062 * (1.0 - roofT));
  col = mix(col, uTop * 0.3, wall);
  col = mix(col, mix(SNOW, uTop, 0.12), roof);
  float window = step(abs(c.x - 0.014), 0.01) * step(abs(c.y - 0.026), 0.011);
  vec3 lamp = vec3(1.0, 0.78, 0.36);
  col = mix(col, lamp, window);
  col += lamp * 0.28 * exp(-length(c - vec2(0.014, 0.026)) * 26.0);

  // いちばん手前の木。暗い影に、枝先だけ雪が白く乗る。
  xs = x + uShift * 0.08;
  vec2 big = trees(vec2(xs, y), 2.2, 5.0, 1.0, 0.36, 0.6);
  col = mix(col, mix(uTop * 0.3, SNOW * 0.95, big.y * 0.8), big.x);

  col *= 1.0 - 0.28 * pow(length(vUv - 0.5) * 1.3, 2.0);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const snowVertex = /* glsl */ `
uniform float uTime;
uniform float uFall;
uniform float uDrift;
uniform float uSize;
attribute vec4 aSeed;
varying float vAlpha;
void main(){
  vec3 c = position;
  // 下まで落ちたら上へ戻す。雪片ごとに速さと揺れ方を変える。
  c.y = mod(position.y - uFall * (0.7 + aSeed.x * 0.6) + ${(BOX.height / 2).toFixed(1)}, ${BOX.height.toFixed(1)}) - ${(BOX.height / 2).toFixed(1)};
  c.x += uDrift * (0.6 + aSeed.y * 0.8) + sin(uTime * (0.5 + aSeed.z) + aSeed.w * 30.0) * 0.22;
  c.x = mod(c.x + ${(BOX.width / 2).toFixed(1)}, ${BOX.width.toFixed(1)}) - ${(BOX.width / 2).toFixed(1)};
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  gl_Position = projectionMatrix * mv;
  // 奥行きは透視投影に任せる。近い雪ほど大きく、画面の上では速く動く。
  gl_PointSize = max(1.2, uSize * (0.55 + aSeed.w) / -mv.z);
  vAlpha = mix(1.0, 0.5, smoothstep(3.0, 12.0, -mv.z));
}
`;

const snowFragment = /* glsl */ `
uniform float uOpacity;
varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.12, d) * vAlpha * uOpacity;
  gl_FragColor = vec4(vec3(1.0), a);
  #include <colorspace_fragment>
}
`;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 45, cameraZ: 6, preview: p.preview, antialias: false, maxDpr: p.preview ? 1 : 1.5 });
  const count = Math.round(p.preview ? Math.min(p.count, 600) : p.count);

  const sceneUniforms = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uShift: { value: 0 },
    uTop: { value: new THREE.Color(p.skyTop) },
    uBottom: { value: new THREE.Color(p.skyBottom) },
  };
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms: sceneUniforms, vertexShader: fullscreenVertex, fragmentShader: sceneFragment, depthTest: false, depthWrite: false }),
  );
  backdrop.frustumCulled = false;
  backdrop.renderOrder = -1;

  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions.set([(Math.random() - 0.5) * BOX.width, (Math.random() - 0.5) * BOX.height, Math.random() * 9 - 6], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(count * 4).map(() => Math.random()), 4));
  const snowUniforms = {
    uTime: { value: 0 },
    uFall: { value: 0 },
    uDrift: { value: 0 },
    uSize: { value: 1 },
    uOpacity: { value: stage.reduced ? 1 : 0 },
  };
  const snow = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({ uniforms: snowUniforms, vertexShader: snowVertex, fragmentShader: snowFragment, transparent: true, depthTest: false, depthWrite: false }),
  );
  snow.frustumCulled = false;
  stage.scene.add(backdrop, snow);

  let gust = 0;
  stage.onResize(({ width, height, dpr }) => {
    sceneUniforms.uRes.value.set(width, height);
    snowUniforms.uSize.value = height * dpr * 0.05 * p.size;
  });
  stage.onFrame((time, dt) => {
    snowUniforms.uTime.value = time;
    snowUniforms.uFall.value += dt * 0.95 * p.speed;
    // 風は積み上げて位置に足す。向きを変えても雪が飛び移らない。
    const wind = p.wind + (stage.pointer.inside ? stage.pointer.sx * 2.2 : 0) + gust;
    snowUniforms.uDrift.value += dt * wind * 0.6;
    gust *= Math.exp(-dt * 1.4);
    snowUniforms.uOpacity.value = Math.min(1, snowUniforms.uOpacity.value + dt * 0.8);
    sceneUniforms.uShift.value = stage.pointer.sx;
  });

  function blow(event) {
    if (stage.reduced) return;
    const rect = container.getBoundingClientRect();
    const side = rect.width ? (event.clientX - rect.left) / rect.width - 0.5 : 0;
    // 押した側から反対側へ向かって吹く。
    gust = side >= 0 ? -6 : 6;
  }
  container.addEventListener('pointerdown', blow);

  return {
    destroy() {
      container.removeEventListener('pointerdown', blow);
      stage.destroy();
    },
  };
}
