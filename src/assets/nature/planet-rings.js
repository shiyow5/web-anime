import * as THREE from 'three';
import { animate, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { snoise3 } from '../../lib/glsl.js';
import { seeded } from '../../lib/holo.js';

export const meta = {
  id: 'planet-rings',
  title: '環を持つ惑星',
  category: 'nature',
  libs: ['three', 'animejs'],
  description:
    '自転軸の傾いた惑星が、細かい縞の環をまとって静かに回ります。月は環とは別の傾きの軌道を回り、全体はゆっくり歳差で向きを変えます。環には惑星の影が落ち、惑星には環の影が落ちます。クリックすると、しばらく時間が早送りになります。宇宙や天文の話題の背景に使えます。',
  params: {
    color: { type: 'color', label: '惑星の明るい帯の色', default: '#e2c79a' },
    band: { type: 'color', label: '惑星の暗い帯の色', default: '#9a6a48' },
    ring: { type: 'color', label: '環の色', default: '#e6dcc6' },
    background: { type: 'color', label: '背景色', default: '#04050a' },
    tilt: { type: 'range', label: '自転軸の傾き（度）', min: 0, max: 26, step: 1, default: 18 },
    moons: { type: 'range', label: '月の数', min: 0, max: 3, step: 1, default: 3 },
    speed: { type: 'range', label: '時間の速さ', min: 0, max: 3, step: 0.1, default: 1 },
  },
};

const RING_IN = 1.32;
const RING_OUT = 2.42;
const MOONS = [
  { radius: 2.85, size: 0.085, tiltX: 0.42, tiltZ: 0.1, rate: 0.5, color: '#c9c4bc' },
  { radius: 3.2, size: 0.12, tiltX: -0.3, tiltZ: -0.32, rate: -0.33, color: '#b9a48e' },
  { radius: 3.55, size: 0.065, tiltX: 0.2, tiltZ: 0.62, rate: 0.24, color: '#a9b4c2' },
];

// 環の濃さ。中心からの距離だけで決まる。惑星に落ちる影にも同じ式を使う。
const ringDensity = /* glsl */ `
uniform float uRingIn;
uniform float uRingOut;
// fw は 1 画素あたりの t の変化量。縞が画素より細かくなる所では、その縞を弱めてちらつきを防ぐ。
float ringFine(float f, float fw){ return clamp(1.5 - fw * f * 0.6, 0.0, 1.0); }
float ringDensity(float r, float fw){
  float t = (r - uRingIn) / (uRingOut - uRingIn);
  if (t < 0.0 || t > 1.0) return 0.0;
  float d = 0.6 + 0.16 * sin(t * 41.0) * ringFine(41.0, fw) + 0.11 * sin(t * 113.0 + 1.0) * ringFine(113.0, fw) + 0.07 * sin(t * 277.0 + 2.0) * ringFine(277.0, fw);
  d *= smoothstep(0.0, 0.02, t) * smoothstep(1.0, 0.97, t);
  d *= mix(0.3, 1.0, smoothstep(0.02, 0.24, t));
  // すき間。太いものが 1 本、細いものが 2 本ある。
  d *= 1.0 - 0.94 * smoothstep(0.014, 0.004, abs(t - 0.63));
  d *= 1.0 - 0.7 * smoothstep(0.006, 0.001, abs(t - 0.27));
  d *= 1.0 - 0.6 * smoothstep(0.005, 0.001, abs(t - 0.86));
  return clamp(d, 0.0, 1.0);
}
`;

const planetVertex = /* glsl */ `
varying vec3 vPos;
varying vec3 vNormalView;
varying vec3 vView;
void main(){
  vPos = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalView = normalMatrix * normal;
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const planetFragment = /* glsl */ `
uniform vec3 uSun;
uniform float uSpin;
uniform float uFade;
uniform vec3 uLight;
uniform vec3 uDark;
varying vec3 vPos;
varying vec3 vNormalView;
varying vec3 vView;
${snoise3}
${ringDensity}
void main(){
  vec3 n = normalize(vPos);
  // 自転。模様を読む位置だけを Y 軸のまわりに回す。光と影は回さない。
  float c = cos(uSpin);
  float s = sin(uSpin);
  vec3 q = vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);
  float warp = snoise(q * vec3(1.5, 5.0, 1.5)) * 0.055 + snoise(q * vec3(3.2, 13.0, 3.2) + 7.0) * 0.022;
  float lat = q.y + warp;
  float wide = sin(lat * 17.0) * 0.5 + 0.5;
  float fine = sin(lat * 53.0 + snoise(q * 4.0) * 0.8) * 0.5 + 0.5;
  vec3 col = mix(uDark, uLight, smoothstep(0.15, 0.85, wide));
  col = mix(col, uLight * 1.08, fine * 0.22);
  col = mix(col, uDark * 0.8, smoothstep(0.62, 1.0, abs(q.y)) * 0.6);
  // 渦。帯の境目に 1 つだけ置く。
  vec2 spot = vec2(atan(q.z, q.x) - 0.6, (q.y + 0.33) * 3.2);
  col = mix(col, uDark * 0.9 + vec3(0.12, 0.02, 0.0), smoothstep(0.34, 0.1, length(spot)) * 0.7);

  float diffuse = dot(n, uSun);
  float light = smoothstep(-0.06, 0.3, diffuse) * (0.3 + 0.7 * max(diffuse, 0.0));
  // 環の影。表面から太陽へ向かう線が環の面を横切るなら、そこの濃さだけ暗くする。
  float t = -n.y / (abs(uSun.y) < 1e-4 ? 1e-4 : uSun.y);
  if (t > 0.0) {
    vec3 hit = n + uSun * t;
    light *= 1.0 - 0.8 * ringDensity(length(hit.xz), 0.004);
  }
  float mu = max(dot(normalize(vNormalView), normalize(vView)), 0.0);
  col *= 0.5 + 0.5 * pow(mu, 0.45);
  vec3 lit = col * (light * 1.15 + 0.012);
  lit += mix(uLight, vec3(0.75, 0.85, 1.0), 0.5) * pow(1.0 - mu, 3.2) * 0.3 * smoothstep(-0.1, 0.4, diffuse);
  gl_FragColor = vec4(lit * uFade, 1.0);
  #include <colorspace_fragment>
}
`;

const ringVertex = /* glsl */ `
varying vec3 vPos;
void main(){
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ringFragment = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uColor;
uniform float uReveal;
uniform float uFade;
varying vec3 vPos;
${ringDensity}
void main(){
  float r = length(vPos.xz);
  float t = (r - uRingIn) / (uRingOut - uRingIn);
  float d = ringDensity(r, fwidth(t)) * smoothstep(uReveal, uReveal - 0.08, t);
  // 惑星の影。環の点から太陽へ向かう線が、半径 1 の球に当たるかを調べる。
  float along = dot(vPos, uSun);
  float away = length(vPos - uSun * along);
  float shadow = along < 0.0 ? smoothstep(1.03, 0.95, away) : 0.0;
  vec3 col = uColor * (0.62 + 0.38 * d) * mix(vec3(1.0, 0.94, 0.86), vec3(1.0), t);
  col *= (0.5 + 0.5 * abs(uSun.y) + 0.25) * (1.0 - 0.9 * shadow);
  gl_FragColor = vec4(col, d * 0.92 * uFade);
  #include <colorspace_fragment>
}
`;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const preview = Boolean(p.preview);
  const stage = createStage(container, { fov: 35, cameraZ: 11, background: p.background, preview });
  const random = seeded(31);
  const state = { reveal: stage.reduced ? 1.1 : 0, fade: stage.reduced ? 1 : 0, surge: 0 };
  const sunWorld = new THREE.Vector3(-0.9, 0.2, 0.34).normalize();
  const sunLocal = sunWorld.clone();

  // 入れ子の構造。system（見る角度）＞ precession（歳差）＞ axis（自転軸の傾き）＞ 惑星と環。
  // 月の軌道は precession の下に、それぞれ別の傾きで付ける。
  const system = new THREE.Group();
  const precession = new THREE.Group();
  const axis = new THREE.Group();
  axis.rotation.z = THREE.MathUtils.degToRad(p.tilt);
  precession.add(axis);
  system.add(precession);
  stage.scene.add(system);

  const shared = { uSun: { value: sunLocal }, uRingIn: { value: RING_IN }, uRingOut: { value: RING_OUT } };
  const planetUniforms = {
    ...shared,
    uSpin: { value: 0 },
    uFade: { value: state.fade },
    uLight: { value: new THREE.Color(p.color) },
    uDark: { value: new THREE.Color(p.band) },
  };
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(1, preview ? 48 : 96, preview ? 32 : 64),
    new THREE.ShaderMaterial({ uniforms: planetUniforms, vertexShader: planetVertex, fragmentShader: planetFragment }),
  );
  // 惑星はわずかに扁平にする。
  planet.scale.set(1, 0.94, 1);
  axis.add(planet);

  const ringUniforms = { ...shared, uColor: { value: new THREE.Color(p.ring) }, uReveal: { value: state.reveal }, uFade: { value: 1 } };
  const ringGeometry = new THREE.RingGeometry(RING_IN, RING_OUT, preview ? 96 : 192, 1);
  ringGeometry.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(
    ringGeometry,
    new THREE.ShaderMaterial({ uniforms: ringUniforms, vertexShader: ringVertex, fragmentShader: ringFragment, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  );
  axis.add(ring);

  // 太陽の光。月はこの 1 灯で照らす。向きは惑星と環のシェーダーに渡すものと同じ。
  const sun = new THREE.DirectionalLight('#fff4e2', 2.6);
  sun.position.copy(sunWorld).multiplyScalar(20);
  stage.scene.add(sun, new THREE.AmbientLight('#8090b0', 0.05));

  const moons = MOONS.slice(0, p.moons).map((spec, i) => {
    const orbit = new THREE.Group();
    orbit.rotation.set(spec.tiltX, 0, spec.tiltZ);
    const arm = new THREE.Group();
    arm.rotation.y = random() * Math.PI * 2;
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(spec.size, 3), new THREE.MeshStandardMaterial({ color: spec.color, roughness: 1, metalness: 0, flatShading: i === 2 }));
    body.position.x = spec.radius;
    arm.add(body);
    orbit.add(arm);
    precession.add(orbit);
    return { arm, body, rate: spec.rate, grow: stage.reduced ? 1 : 0 };
  });

  // 星。遠くの殻に散らす。歳差には乗せないので、惑星の向きが変わるのが分かる。
  const starCount = preview ? 220 : 620;
  const starPos = new Float32Array(starCount * 3);
  const starCol = new Float32Array(starCount * 3);
  const tint = new THREE.Color();
  for (let i = 0; i < starCount; i += 1) {
    const v = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize().multiplyScalar(60);
    starPos.set([v.x, v.y, v.z], i * 3);
    const level = 0.25 + random() ** 3 * 0.75;
    tint.setHSL(random() < 0.5 ? 0.6 : 0.09, 0.35, 0.72).multiplyScalar(level);
    starCol.set([tint.r, tint.g, tint.b], i * 3);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeometry.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ size: preview ? 1.2 : 1.7, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
  stage.scene.add(stars);

  const inverse = new THREE.Quaternion();
  let spin = 0.8;
  let wobble = 0;
  precession.rotation.y = 0.5;

  function place(dt) {
    const rate = dt * p.speed * (1 + state.surge * 9);
    spin += rate * 0.35;
    wobble += rate * 0.05;
    // 歳差。傾いた自転軸が、縦の軸のまわりをゆっくり回る。
    precession.rotation.y += rate * 0.06;
    precession.rotation.x = Math.sin(wobble * 2.1) * 0.05;
    for (const moon of moons) {
      moon.arm.rotation.y += rate * moon.rate;
      moon.body.rotation.y += rate * 0.8;
      moon.body.scale.setScalar(Math.max(0.001, moon.grow));
    }
    planetUniforms.uSpin.value = spin;
    planetUniforms.uFade.value = state.fade;
    ringUniforms.uReveal.value = state.reveal;
    // 太陽の向きを、惑星と環の座標（axis の中）に直す。
    system.updateMatrixWorld();
    axis.getWorldQuaternion(inverse).invert();
    sunLocal.copy(sunWorld).applyQuaternion(inverse);
    stars.rotation.y = -stage.pointer.sx * 0.02;
    stars.rotation.x = stage.pointer.sy * 0.02;
  }

  stage.onResize(() => {
    const view = stage.viewport();
    system.scale.setScalar(Math.min(1, view.width / 7.5, view.height / 5.6));
  });
  stage.onFrame((time, dt) => {
    system.rotation.x = 0.5 - stage.pointer.sy * 0.12;
    system.rotation.y = stage.pointer.sx * 0.25;
    system.rotation.z = -0.08;
    place(dt);
  });

  // 早送り。自転も、月も、歳差も、しばらく速くなる。
  function surge() {
    if (stage.reduced) return;
    animate(state, {
      surge: [
        { to: 1, duration: 500, ease: 'outQuad' },
        { to: 0, duration: 2600, ease: 'inOutSine' },
      ],
    });
  }

  let timer = 0;
  if (!stage.reduced) {
    animate(state, { fade: 1, duration: 1400, ease: 'outQuad' });
    animate(state, { reveal: 1.1, duration: 2200, delay: 300, ease: 'inOutCubic' });
    animate(moons, { grow: 1, duration: 900, delay: stagger(250, { start: 900 }), ease: 'outBack(1.6)' });
    if (preview) timer = setInterval(surge, 6000);
  }
  container.addEventListener('pointerdown', surge);

  return {
    surge,
    destroy() {
      clearInterval(timer);
      container.removeEventListener('pointerdown', surge);
      utils.remove(state);
      utils.remove(moons);
      stage.destroy();
    },
  };
}
