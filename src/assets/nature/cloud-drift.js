import * as THREE from 'three';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { fullscreenVertex } from '../../lib/glsl.js';

export const meta = {
  id: 'cloud-drift',
  title: '流れる雲',
  category: 'nature',
  libs: ['three'],
  description:
    'やわらかい雲が、奥行きの違う 3 つの層になって流れます。雲の縁は太陽の側だけ明るくなり、すき間から光の筋が差し込みます。時刻を変えると空と雲の色が朝焼けから夜まで移り変わります。クリックすると、押した場所の雲が手前の層から順に割れて晴れ間ができ、時刻が 3 時間進む間は雲が早回しで流れます。晴れ間は数秒かけてふさがります。ポインターを左右に動かすと層がずれて見えます。',
  params: {
    hour: { type: 'range', label: '時刻', min: 0, max: 24, step: 0.5, default: 17 },
    cycle: { type: 'boolean', label: '時刻を自動で進める', default: false },
    cover: { type: 'range', label: '雲の量', min: 0, max: 1, step: 0.05, default: 0.5 },
    speed: { type: 'range', label: '流れる速さ', min: 0, max: 3, step: 0.1, default: 1 },
    rays: { type: 'range', label: '差し込む光の強さ', min: 0, max: 1.5, step: 0.05, default: 0.8 },
  },
};

// 時刻ごとの色。間の時刻は前後を混ぜて作る。
const KEYS = [
  { hour: 0, top: '#050a24', bottom: '#16264f', light: '#4a5c8c', shade: '#101a3a', sun: '#cfdcff' },
  { hour: 4.5, top: '#0c1338', bottom: '#2b3468', light: '#59649a', shade: '#161d44', sun: '#cfdcff' },
  { hour: 6, top: '#33407f', bottom: '#ffb08a', light: '#ffd0c0', shade: '#6b5a8c', sun: '#ffd9a8' },
  { hour: 9, top: '#3f8fe0', bottom: '#cfeaff', light: '#ffffff', shade: '#9db9da', sun: '#fff6da' },
  { hour: 13, top: '#2278d8', bottom: '#bfe3ff', light: '#ffffff', shade: '#a8c2e0', sun: '#ffffff' },
  { hour: 17, top: '#3f4f9f', bottom: '#ffb36b', light: '#ffe2b8', shade: '#8a6a9a', sun: '#ffd27a' },
  { hour: 19, top: '#1c1f58', bottom: '#e0627a', light: '#ff9d8a', shade: '#3a2f6a', sun: '#ff8a5c' },
  { hour: 21, top: '#080d2c', bottom: '#1d2c5c', light: '#50629a', shade: '#111b3d', sun: '#cfdcff' },
  { hour: 24, top: '#050a24', bottom: '#16264f', light: '#4a5c8c', shade: '#101a3a', sun: '#cfdcff' },
].map((key) => ({
  hour: key.hour,
  top: new THREE.Color(key.top),
  bottom: new THREE.Color(key.bottom),
  light: new THREE.Color(key.light),
  shade: new THREE.Color(key.shade),
  sun: new THREE.Color(key.sun),
}));
const SUNRISE = 6;
const SUNSET = 19;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uCover;
uniform float uRays;
uniform float uShift;
uniform float uNight;
uniform float uDisc;
uniform float uReveal;
uniform vec3 uHole;
uniform vec2 uRes;
uniform vec2 uSun;
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uLight;
uniform vec3 uShade;
uniform vec3 uSunCol;
varying vec2 vUv;
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
// 3 回だけ重ねる。GPU の無い環境でも重くならない回数にしている。
float fbm(vec2 p){
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    sum += amp * vnoise(p);
    p = p * 2.03 + vec2(17.0, 9.0);
    amp *= 0.5;
  }
  return sum / 0.875;
}
void main(){
  float aspect = uRes.x / uRes.y;
  vec2 q = vec2((vUv.x - 0.5) * aspect, vUv.y);
  vec3 sky = mix(uBottom, uTop, pow(clamp(q.y, 0.0, 1.0), 0.8));
  vec3 col = sky;

  // 夜は星を出す。
  vec2 g = q * 40.0;
  vec2 id = floor(g);
  float r = hash21(id);
  float star = smoothstep(0.05 + r * 0.06, 0.0, length(fract(g) - 0.2 - 0.6 * vec2(hash21(id + 3.1), hash21(id + 7.7)))) * step(0.8, r);
  col += star * uNight * (0.55 + 0.45 * sin(uTime * (1.0 + r * 3.0) + r * 40.0)) * smoothstep(0.1, 0.4, q.y);

  // 太陽または月と、まわりのにじみ。
  vec2 toSun = uSun - q;
  float sd = length(toSun);
  col += uSunCol * (smoothstep(uDisc, uDisc - 0.006, sd) * 0.9 + 0.34 * exp(-sd * 4.5) + 0.12 * exp(-sd * 1.4));

  // 放射状に差し込む光。角度ごとの明暗を、ゆっくり入れ替える。
  float ang = atan(toSun.y, toSun.x);
  float ray = vnoise(vec2(ang * 3.5, uTime * 0.08)) * vnoise(vec2(ang * 9.0 + 3.0, uTime * 0.05 + 4.0));
  col += uSunCol * pow(ray, 1.2) * exp(-sd * 1.7) * uRays * 0.9 * uReveal;

  vec2 sunDir = toSun / max(sd, 0.001);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float depth = fi * 0.5;
    float scale = mix(3.6, 1.35, depth);
    float drift = uTime * mix(0.012, 0.05, depth) + uShift * depth * 0.06;
    vec2 p = vec2((q.x + drift) * scale + fi * 31.0, q.y * scale * 1.9 + fi * 7.0);
    // 層ごとに高さの帯を変える。奥は地平線の近く、手前は上の空。
    float lo = mix(0.12, 0.46, depth);
    float hi = mix(0.62, 1.25, depth);
    float band = smoothstep(lo, lo + 0.16, q.y) * (1.0 - smoothstep(hi - 0.2, hi, q.y));
    float n = fbm(p);
    float edge = 0.68 - uCover * 0.34;
    float density = smoothstep(edge, edge + 0.11, n) * band * uReveal;
    // 晴れ間。手前の層ほど早く大きく開き、縁は雲の模様に沿ってちぎれる。
    float open = clamp(uHole.z * 1.5 - (1.0 - depth) * 0.5, 0.0, 1.0);
    float hd = length((q - uHole.xy) * vec2(1.0, 1.5)) + (n - 0.5) * 0.22;
    density *= 1.0 - open * smoothstep(0.34 + depth * 0.12, 0.1, hd);
    // 太陽の側へ少しずらした場所と比べて、縁が光に向いているかを見る。
    float n2 = fbm(p + sunDir * vec2(1.0, 2.3) * 0.16);
    float lit = clamp(0.55 + (n - n2) * 6.0, 0.0, 1.0);
    vec3 cloud = mix(uShade, uLight, lit);
    cloud += uSunCol * 0.4 * exp(-sd * 3.0) * (1.0 - density * 0.6);
    cloud = mix(cloud, sky, (1.0 - depth) * 0.3);
    col = mix(col, cloud, density * (0.86 + 0.12 * depth));
  }

  // 遠い丘の影。2 枚重ねて地面を作る。
  float far = 0.075 + (vnoise(vec2(q.x * 1.7 + 3.0, 1.0)) * 0.7 + vnoise(vec2(q.x * 5.3, 2.0)) * 0.3) * 0.085;
  col = mix(col, mix(uShade * 0.6, uBottom, 0.3), smoothstep(far + 0.004, far, q.y));
  float near = 0.03 + (vnoise(vec2(q.x * 2.6 + 9.0, 5.0)) * 0.7 + vnoise(vec2(q.x * 8.0, 6.0)) * 0.3) * 0.075;
  col = mix(col, uShade * 0.28, smoothstep(near + 0.004, near, q.y));

  col *= 1.0 - 0.22 * pow(length(vUv - 0.5) * 1.3, 2.0);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const wrapHour = (hour) => ((hour % 24) + 24) % 24;
const smooth = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { preview: p.preview, antialias: false, maxDpr: p.preview ? 1 : 1.5, startTime: 30 });
  const uniforms = {
    uTime: { value: 0 },
    uCover: { value: p.cover },
    uRays: { value: p.rays },
    uShift: { value: 0 },
    uNight: { value: 0 },
    uDisc: { value: 0.05 },
    uReveal: { value: stage.reduced ? 1 : 0 },
    uHole: { value: new THREE.Vector3(0, 0.6, 0) },
    uRes: { value: new THREE.Vector2(1, 1) },
    uSun: { value: new THREE.Vector2(0, 0.5) },
    uTop: { value: new THREE.Color() },
    uBottom: { value: new THREE.Color() },
    uLight: { value: new THREE.Color() },
    uShade: { value: new THREE.Color() },
    uSunCol: { value: new THREE.Color() },
  };
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: fullscreenVertex, fragmentShader, depthTest: false }),
  );
  quad.frustumCulled = false;
  stage.scene.add(quad);

  let aspect = 1;
  // hour は表示している時刻、target は向かう先。24 を超えても足し続け、使うときに丸める。
  let hour = p.hour;
  let target = p.hour;

  function applyHour() {
    const now = wrapHour(hour);
    const index = Math.max(0, KEYS.findIndex((key) => key.hour > now) - 1);
    const from = KEYS[index];
    const to = KEYS[Math.min(KEYS.length - 1, index + 1)];
    const t = to.hour === from.hour ? 0 : (now - from.hour) / (to.hour - from.hour);
    uniforms.uTop.value.lerpColors(from.top, to.top, t);
    uniforms.uBottom.value.lerpColors(from.bottom, to.bottom, t);
    uniforms.uLight.value.lerpColors(from.light, to.light, t);
    uniforms.uShade.value.lerpColors(from.shade, to.shade, t);
    uniforms.uSunCol.value.lerpColors(from.sun, to.sun, t);

    // 昼は太陽、夜は月が、左から右へ弧を描いて渡る。
    const day = now >= SUNRISE && now < SUNSET;
    const along = day ? (now - SUNRISE) / (SUNSET - SUNRISE) : wrapHour(now - SUNSET) / (24 - SUNSET + SUNRISE);
    uniforms.uSun.value.set((along - 0.5) * 0.95 * aspect, 0.06 + Math.sin(Math.PI * along) * 0.7);
    uniforms.uDisc.value = day ? 0.05 : 0.034;
    uniforms.uNight.value = 1 - smooth(4.5, 6.5, now) + smooth(18.5, 20.5, now);
  }

  stage.onResize(({ width, height }) => {
    uniforms.uRes.value.set(width, height);
    aspect = width / height;
    applyHour();
  });
  stage.onFrame((time, dt) => {
    // 時刻を進めている間は、雲も早回しで流れる。
    lapse += dt * Math.min(40, Math.abs(target - hour) * 16);
    uniforms.uTime.value = 30 + (time - 30) * p.speed + (stage.reduced ? 0 : lapse);
    if (holeAge >= 0) {
      holeAge += dt;
      uniforms.uHole.value.z = smooth(0, 0.7, holeAge) * (1 - smooth(2.6, 7.5, holeAge));
      uniforms.uRays.value = p.rays * (1 + uniforms.uHole.value.z * 0.8);
      if (holeAge > 7.5) holeAge = -1;
    }
    uniforms.uShift.value = stage.pointer.sx;
    uniforms.uReveal.value = Math.min(1, uniforms.uReveal.value + dt * 0.7);
    if (p.cycle || p.preview) target += dt * (p.preview ? 0.35 : 0.5);
    hour += (target - hour) * Math.min(1, dt * 2.2);
    applyHour();
  });

  let lapse = 0;
  let holeAge = -1;
  function advance(event) {
    const rect = container.getBoundingClientRect();
    if (!stage.reduced && rect.width && rect.height && event && Number.isFinite(event.clientX)) {
      uniforms.uHole.value.set(((event.clientX - rect.left) / rect.width - 0.5) * aspect, 1 - (event.clientY - rect.top) / rect.height, uniforms.uHole.value.z);
      // 開いている途中で押し直したら、開いた状態から続ける。
      holeAge = holeAge >= 0 && holeAge < 2.6 ? Math.min(holeAge, 0.7) : 0;
    }
    target += 3;
    if (stage.reduced) {
      hour = target;
      applyHour();
    }
  }
  container.addEventListener('pointerdown', advance);

  return {
    destroy() {
      container.removeEventListener('pointerdown', advance);
      stage.destroy();
    },
  };
}
