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
    '自転軸の傾いた惑星が、細かい縞の環をまとって静かに回ります。月は環とは別の傾きの軌道を回り、全体はゆっくり歳差で向きを変えます。環には惑星の影が落ち、惑星には環の影が落ちます。クリックすると、押した方向から小さな天体が流れ込んで環に当たります。当たった場所が光って環に穴があき、波紋が環を伝わりながら、内側ほど速い公転に引かれて渦の形に伸びていきます。破片は環に沿って散り、しばらく時間が早送りになります。宇宙や天文の話題の背景に使えます。',
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
uniform vec4 uHit;
varying vec3 vPos;
${ringDensity}
void main(){
  float r = length(vPos.xz);
  float t = (r - uRingIn) / (uRingOut - uRingIn);
  float d = ringDensity(r, fwidth(t)) * smoothstep(uReveal, uReveal - 0.08, t);
  // 衝突の波紋。当たった点からの距離を、内側ほど速く回る分だけずらして測る。輪は時間とともに渦の形に伸びる。
  float da = atan(vPos.z, vPos.x) - uHit.y - uHit.z * 0.45 * (pow(uHit.x / max(r, 0.01), 1.5) - 1.0);
  da = atan(sin(da), cos(da));
  float hd = length(vec2(r - uHit.x, r * da));
  float front = uHit.z * 0.5;
  float rip = sin((hd - front) * 30.0) * exp(-abs(hd - front) * 3.2) * exp(-uHit.z * 0.4) * uHit.w;
  float hole = smoothstep(0.16, 0.03, hd) * exp(-uHit.z * 0.35) * uHit.w;
  d = clamp(d * (1.0 + rip * 0.9) * (1.0 - hole * 0.95), 0.0, 1.0);
  // 惑星の影。環の点から太陽へ向かう線が、半径 1 の球に当たるかを調べる。
  float along = dot(vPos, uSun);
  float away = length(vPos - uSun * along);
  float shadow = along < 0.0 ? smoothstep(1.03, 0.95, away) : 0.0;
  vec3 col = uColor * (0.62 + 0.38 * d) * mix(vec3(1.0, 0.94, 0.86), vec3(1.0), t);
  col *= (0.5 + 0.5 * abs(uSun.y) + 0.25) * (1.0 - 0.9 * shadow);
  col *= 1.0 + max(rip, 0.0) * 1.6;
  col += vec3(1.0, 0.85, 0.6) * smoothstep(0.3, 0.0, hd) * exp(-uHit.z * 3.0) * uHit.w;
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

  const ringUniforms = { ...shared, uColor: { value: new THREE.Color(p.ring) }, uReveal: { value: state.reveal }, uFade: { value: 1 }, uHit: { value: new THREE.Vector4(1.8, 0, 0, 0) } };
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

  // 流れ込む小天体と、当たったときに散る破片。
  const shot = { t: 0, glow: 0 };
  const meteor = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshBasicMaterial({ color: '#fff1d0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  meteor.visible = false;
  stage.scene.add(meteor);
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const heading = new THREE.Vector3();
  const along = new THREE.Vector3(0, 0, 1);
  const SHARDS = preview ? 24 : 48;
  const shardPos = new Float32Array(SHARDS * 3);
  const shardGeometry = new THREE.BufferGeometry();
  shardGeometry.setAttribute('position', new THREE.BufferAttribute(shardPos, 3));
  const shardPoints = new THREE.Points(shardGeometry, new THREE.PointsMaterial({ color: '#ffe9c4', size: preview ? 1.6 : 2.4, sizeAttenuation: false, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  shardPoints.frustumCulled = false;
  shardPoints.visible = false;
  axis.add(shardPoints);
  const shards = Array.from({ length: SHARDS }, () => ({ r: 0, a: 0, vr: 0, va: 0, y: 0, vy: 0 }));
  let hitLive = false;

  function stepImpact(dt) {
    const hit = ringUniforms.uHit.value;
    if (hitLive) {
      hit.z += dt * (1 + state.surge * 2);
      if (hit.z > 14) {
        hitLive = false;
        hit.w = 0;
      }
    }
    meteor.visible = shot.glow > 0.01;
    if (meteor.visible) {
      meteor.position.lerpVectors(from, to, shot.t);
      meteor.material.opacity = Math.min(1, shot.glow);
      // 進む向きに長く伸ばして、尾を引いているように見せる。当たったあとは丸く広がって消える。
      const stretch = shot.t < 1 ? 9 : 1;
      meteor.scale.set(1, 1, stretch).multiplyScalar(shot.t < 1 ? 1 : 1 + (1 - shot.glow) * 7);
    }
    shardPoints.visible = shardPoints.material.opacity > 0.01;
    if (!shardPoints.visible) return;
    for (let i = 0; i < SHARDS; i += 1) {
      const sh = shards[i];
      sh.r += sh.vr * dt;
      sh.a += sh.va * dt;
      sh.y += sh.vy * dt;
      sh.vr *= Math.exp(-dt * 1.2);
      sh.vy *= Math.exp(-dt * 1.6);
      shardPos[i * 3] = Math.cos(sh.a) * sh.r;
      shardPos[i * 3 + 1] = sh.y;
      shardPos[i * 3 + 2] = Math.sin(sh.a) * sh.r;
    }
    shardGeometry.attributes.position.needsUpdate = true;
  }
  stage.onFrame((time, dt) => stepImpact(dt));

  // 環の上の 1 点（半径 r、角度 a）に小天体を当てる。準備: 光の粒が飛んでくる。山場: 光って穴があき、破片が散る。余韻: 波紋が渦に伸びる。
  function impact(r, a, side = 1) {
    if (stage.reduced) return;
    utils.remove(shot);
    utils.remove(shardPoints.material);
    system.updateMatrixWorld();
    to.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    axis.localToWorld(to);
    from.set(to.x + side * 4.5, to.y + 3.2, to.z + 3.5);
    heading.subVectors(to, from).normalize();
    meteor.quaternion.setFromUnitVectors(along, heading);
    shot.t = 0;
    shot.glow = 0;
    animate(shot, { t: 1, glow: [{ to: 1, duration: 120 }, { to: 1, duration: 300 }], duration: 420, ease: 'inQuad', onComplete: land });
    function land() {
      const hit = ringUniforms.uHit.value;
      hit.set(r, a, 0, 1);
      hitLive = true;
      for (const sh of shards) {
        sh.r = r;
        sh.a = a;
        sh.y = 0;
        sh.vr = (Math.random() - 0.5) * 0.9;
        sh.va = (Math.random() - 0.3) * 0.9;
        sh.vy = (Math.random() - 0.5) * 0.5;
      }
      shardPoints.material.opacity = 1;
      animate(shardPoints.material, { opacity: 0, duration: 2600, ease: 'inQuad' });
      animate(shot, { glow: 0, duration: 520, ease: 'outQuad' });
      // 当たった衝撃のあと、しばらく時間が早送りになり、波紋が渦に巻かれていく。
      animate(state, {
        surge: [
          { to: 0.7, duration: 700, ease: 'outQuad' },
          { to: 0, duration: 3200, ease: 'inOutSine' },
        ],
      });
    }
  }

  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane();
  const normal = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const point = new THREE.Vector3();
  function onDown(event) {
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    system.updateMatrixWorld();
    raycaster.setFromCamera({ x: nx, y: ny }, stage.camera);
    axis.getWorldPosition(origin);
    normal.set(0, 1, 0).transformDirection(axis.matrixWorld);
    plane.setFromNormalAndCoplanarPoint(normal, origin);
    // 押した先が環の面に当たる場所を求める。環から外れていたら、同じ方角の環の上に寄せる。
    if (raycaster.ray.intersectPlane(plane, point)) {
      axis.worldToLocal(point);
      impact(THREE.MathUtils.clamp(Math.hypot(point.x, point.z), RING_IN + 0.12, RING_OUT - 0.12), Math.atan2(point.z, point.x), nx >= 0 ? 1 : -1);
    } else {
      surge();
    }
  }

  // 外から呼ぶとき。環のどこかに 1 つ当てる。
  function surge() {
    impact(RING_IN + 0.2 + Math.random() * (RING_OUT - RING_IN - 0.4), Math.random() * Math.PI * 2, Math.random() < 0.5 ? 1 : -1);
  }

  let timer = 0;
  if (!stage.reduced) {
    animate(state, { fade: 1, duration: 1400, ease: 'outQuad' });
    animate(state, { reveal: 1.1, duration: 2200, delay: 300, ease: 'inOutCubic' });
    animate(moons, { grow: 1, duration: 900, delay: stagger(250, { start: 900 }), ease: 'outBack(1.6)' });
    if (preview) timer = setInterval(surge, 6000);
  }
  container.addEventListener('pointerdown', onDown);

  return {
    surge,
    destroy() {
      clearInterval(timer);
      container.removeEventListener('pointerdown', onDown);
      utils.remove(state);
      utils.remove(shot);
      utils.remove(shardPoints.material);
      utils.remove(moons);
      stage.destroy();
    },
  };
}
