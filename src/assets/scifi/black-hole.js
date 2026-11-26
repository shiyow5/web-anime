import * as THREE from 'three';
import { animate, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { fullscreenVertex, snoise3 } from '../../lib/glsl.js';

export const meta = {
  id: 'black-hole',
  title: 'ブラックホール',
  category: 'scifi',
  libs: ['three', 'animejs'],
  description:
    '光を飲み込む黒い球のまわりを、熱いガスの円盤が回ります。奥側の円盤は重力で曲がって、球の上下に輪として見えます。背景の星も球の近くでゆがみます。クリックすると、触った場所に現れたガスの塊が渦を巻いて球へ落ちていきます。飲み込まれた瞬間に球がひと回り膨らみ、円盤が燃え上がって回転を速め、衝撃の輪が内側から外へ円盤を伝わっていきます。',
  params: {
    colorHot: { type: 'color', label: '内側の色', default: '#fff1c4' },
    colorCool: { type: 'color', label: '外側の色', default: '#ff5a1f' },
    background: { type: 'color', label: '宇宙の色', default: '#02030a' },
    speed: { type: 'range', label: '回る速さ', min: 0, max: 3, step: 0.1, default: 1 },
    tilt: { type: 'range', label: '円盤の傾き', min: 2, max: 8, step: 0.1, default: 3.6 },
    stars: { type: 'range', label: '星の量', min: 0, max: 1, step: 0.05, default: 0.6 },
  },
};

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uTilt;
uniform float uStars;
uniform float uFlare;
uniform float uGulp;
uniform float uSurge;
uniform float uShock;
uniform float uShockAmp;
uniform vec3 uBlob;
uniform vec2 uRes;
uniform vec2 uPointer;
uniform vec3 uHot;
uniform vec3 uCool;
uniform vec3 uBg;
varying vec2 vUv;
${snoise3}
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float starField(vec2 p){
  vec2 cell = floor(p);
  vec2 f = fract(p) - 0.5;
  float h = hash(cell);
  vec2 offset = vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5;
  float d = length(f - offset * 0.7);
  return smoothstep(0.06, 0.0, d) * step(1.0 - uStars * 0.35, h) * (0.5 + 0.5 * sin(uTime * 2.0 + h * 40.0));
}
// 円盤の明るさ。角度をそのままノイズに入れると継ぎ目が出るので、cos と sin に直してから渡す。
float gas(float angle, float radius, float spin){
  float a = angle + spin;
  float n = snoise(vec3(cos(a) * 2.2, sin(a) * 2.2, radius * 5.0 - uTime * 0.2));
  float streak = snoise(vec3(cos(a) * 6.0, sin(a) * 6.0, radius * 14.0));
  return 0.55 + 0.3 * n + 0.2 * streak;
}
void main(){
  float HOLE = 0.42 * (1.0 + uGulp);
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 2.6;
  p -= uPointer * 0.08;
  float r = length(p);

  // 背景の星。中心に近いほど、光が外へ押し曲げられたように位置をずらす。
  vec2 lensed = p * (1.0 + 0.22 / (r * r + 0.08));
  vec3 col = uBg + vec3(starField(lensed * 9.0) + starField(lensed * 17.0 + 4.0) * 0.6);

  // 奥側の円盤が曲がって見える輪。
  float halo = smoothstep(HOLE - 0.01, HOLE + 0.05, r) * smoothstep(HOLE + 0.42, HOLE + 0.04, r);
  float haloAngle = atan(p.y, p.x);
  float haloGas = gas(haloAngle, r * 1.4, uTime * 0.5);
  vec3 haloCol = mix(uCool, uHot, smoothstep(HOLE + 0.3, HOLE, r)) * halo * haloGas * (0.75 + 0.6 * abs(sin(haloAngle)));
  col += haloCol * (1.0 + uFlare);

  // 光子の輪。球のふちに沿う細い線。
  col += uHot * smoothstep(0.02, 0.0, abs(r - HOLE - 0.012)) * 0.9;

  // 事象の地平面。ここより内側は何も見えない。
  float hole = smoothstep(HOLE + 0.004, HOLE - 0.004, r);
  col *= 1.0 - hole;

  // 手前を横切る円盤。縦につぶした座標で輪を作る。
  vec2 q = vec2(p.x, p.y * uTilt + p.x * 0.12);
  float rd = length(q);
  float angle = atan(q.y, q.x);
  float disk = smoothstep(HOLE + 0.1, HOLE + 0.32, rd) * smoothstep(2.3, 1.1, rd);
  float spin = (uTime * 1.4 + uSurge) / (rd * rd + 0.3);
  // 飲み込んだあとに、内側から外へ伝わる衝撃の輪。
  float shock = smoothstep(0.16, 0.0, abs(rd - uShock)) * uShockAmp;
  float diskGas = gas(angle, rd, spin);
  // 近づいてくる側（左）を明るく、遠ざかる側を暗くする。
  float doppler = 1.0 + 0.55 * cos(angle - 3.14159);
  vec3 diskCol = mix(uHot, uCool, smoothstep(HOLE + 0.2, 1.7, rd)) * disk * diskGas * doppler * (1.0 + uFlare * 1.5 + shock * 2.6);
  // 奥側の半分は球に隠れる。手前側は球の上に重なる。
  float behind = step(0.0, q.y);
  col += diskCol * mix(1.0, 1.0 - hole, behind);

  // 落ちていくガスの塊。進む向き（中心のまわり）に引き伸ばして描く。
  vec2 toBlob = p - uBlob.xy;
  vec2 radial = normalize(uBlob.xy + 0.0001);
  vec2 along = vec2(-radial.y, radial.x);
  float blob = exp(-(pow(dot(toBlob, along) * 5.0, 2.0) + pow(dot(toBlob, radial) * 14.0, 2.0)));
  col += mix(uCool, uHot, 0.6) * blob * uBlob.z * 2.2 * (1.0 - hole);
  col += uHot * shock * 0.12 * (1.0 - hole);

  col = col / (1.0 + col * 0.35);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { preview: p.preview, antialias: false, maxDpr: p.preview ? 1 : 1.5, startTime: 12 });
  const state = { flare: 0, gulp: 0, rush: 0, shock: 0, shockAmp: 0, fall: 0, blob: 0 };
  const blobFrom = { radius: 1.4, angle: 0 };
  let surge = 0;
  const uniforms = {
    uTime: { value: 0 },
    uTilt: { value: p.tilt },
    uStars: { value: p.stars },
    uFlare: { value: 0 },
    uGulp: { value: 0 },
    uSurge: { value: 0 },
    uShock: { value: 0 },
    uShockAmp: { value: 0 },
    uBlob: { value: new THREE.Vector3() },
    uRes: { value: new THREE.Vector2(1, 1) },
    uPointer: { value: new THREE.Vector2() },
    uHot: { value: new THREE.Color(p.colorHot) },
    uCool: { value: new THREE.Color(p.colorCool) },
    uBg: { value: new THREE.Color(p.background) },
  };
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: fullscreenVertex, fragmentShader, depthTest: false }),
  );
  quad.frustumCulled = false;
  stage.scene.add(quad);

  stage.onResize(({ width, height }) => uniforms.uRes.value.set(width, height));
  stage.onFrame((time, dt) => {
    uniforms.uTime.value = time * p.speed;
    uniforms.uFlare.value = state.flare;
    surge += dt * state.rush * 9;
    uniforms.uSurge.value = surge;
    uniforms.uGulp.value = state.gulp;
    uniforms.uShock.value = state.shock;
    uniforms.uShockAmp.value = state.shockAmp;
    // 塊は、回りながら半径を縮めて落ちる。
    const radius = blobFrom.radius * (1 - state.fall) + 0.3 * state.fall;
    const angle = blobFrom.angle + state.fall * state.fall * 4.2;
    uniforms.uBlob.value.set(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.8, state.blob);
    uniforms.uTilt.value = p.tilt + stage.pointer.sy * 1.2;
    uniforms.uPointer.value.set(stage.pointer.sx, stage.pointer.sy);
  });

  // ガスの塊を落とす。落下 → 飲み込んで膨らみ、燃え上がる → 衝撃の輪が外へ抜ける、の順に進む。
  function flare(x, y) {
    if (stage.reduced) return;
    const aspect = uniforms.uRes.value.x / uniforms.uRes.value.y;
    const px = Number.isFinite(x) ? x * aspect * 1.3 : 1.2;
    const py = Number.isFinite(y) ? y * 1.3 : 0.5;
    blobFrom.radius = Math.min(2.2, Math.max(0.75, Math.hypot(px, py)));
    blobFrom.angle = Math.atan2(py, px);
    const FALL = 620;
    utils.remove(state);
    state.fall = 0;
    state.shock = 0.4;
    state.shockAmp = 0;
    animate(state, {
      fall: { to: 1, duration: FALL, ease: 'inQuad' },
      blob: [{ to: 1, duration: 140, ease: 'outQuad' }, { to: 1, duration: FALL - 240 }, { to: 0, duration: 100 }],
      rush: [{ to: 1, duration: FALL, ease: 'inQuad' }, { to: 0, duration: 2200, ease: 'outQuad' }],
      gulp: [{ to: -0.05, duration: FALL, ease: 'inQuad' }, { to: 0.16, duration: 130, ease: 'outQuad' }, { to: 0, duration: 1300, ease: 'outElastic(1, .45)' }],
      flare: [{ to: 0.15, duration: FALL }, { to: 1.5, duration: 150, ease: 'outQuad' }, { to: 0, duration: 1900, ease: 'outExpo' }],
      shockAmp: [{ to: 0, duration: FALL }, { to: 1, duration: 120 }, { to: 0, duration: 1500, ease: 'inQuad' }],
      shock: [{ to: 0.4, duration: FALL }, { to: 2.4, duration: 1620, ease: 'outQuad' }],
    });
  }
  const onClick = () => flare(stage.pointer.x, stage.pointer.y);
  container.addEventListener('click', onClick);
  const autoFlare = p.preview && !stage.reduced ? setInterval(() => flare(Math.random() * 1.6 - 0.8, Math.random() * 1.2 - 0.6), 4600) : 0;

  return {
    flare,
    destroy() {
      clearInterval(autoFlare);
      container.removeEventListener('click', onClick);
      utils.remove(state);
      stage.destroy();
    },
  };
}
