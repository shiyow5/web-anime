import * as THREE from 'three';
import { animate, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { snoise3 } from '../../lib/glsl.js';

export const meta = {
  id: 'liquid-orb',
  title: '液体の球',
  category: 'webgl',
  libs: ['three', 'animejs'],
  description:
    'ノイズで表面がうねる球です。見る角度で色が変わり、ポインターを速く動かすと波が大きくなります。指で突くと、その場所がへこんで波が球を一周し、ふちからしずくが 3 つちぎれて飛び出し、また吸い込まれて戻ります。',
  params: {
    distortion: { type: 'range', label: 'うねりの大きさ', min: 0.05, max: 0.7, step: 0.01, default: 0.3 },
    frequency: { type: 'range', label: 'うねりの細かさ', min: 0.4, max: 3, step: 0.1, default: 1.2 },
    speed: { type: 'range', label: '速さ', min: 0, max: 2, step: 0.05, default: 0.7 },
    colorA: { type: 'color', label: '谷の色', default: '#2b1bd1' },
    colorB: { type: 'color', label: '山の色', default: '#ff4fa3' },
    colorC: { type: 'color', label: 'ふちの色', default: '#8ef6ff' },
    background: { type: 'color', label: '背景色', default: '#0b0a1f' },
  },
};

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uFreq;
uniform vec3 uPoke;
uniform float uDent;
uniform float uWave;
uniform float uWaveAmp;
varying vec3 vNormal;
varying vec3 vView;
varying float vBand;
${snoise3}
float disp(vec3 dir){
  float a = snoise(dir * uFreq + vec3(0.0, uTime * 0.35, 0.0));
  float b = snoise(dir * uFreq * 2.4 - vec3(uTime * 0.25, 0.0, 0.0));
  // 突いた場所からの角度。へこみと、球を一周する波に使う。
  float ang = acos(clamp(dot(dir, uPoke), -1.0, 1.0));
  float dent = -uDent * exp(-ang * ang * 6.5);
  float w = ang - uWave;
  float wave = uWaveAmp * sin(w * 9.0) * exp(-w * w * 5.0);
  return (a + b * 0.35) * uAmp + dent + wave;
}
vec3 orthogonal(vec3 v){
  return normalize(abs(v.x) > abs(v.z) ? vec3(-v.y, v.x, 0.0) : vec3(0.0, -v.z, v.y));
}
void main(){
  float radius = length(position);
  vec3 n = normalize(position);
  // 近くの 2 点も同じ式で動かして、変形後の法線を求める。
  vec3 t = orthogonal(n);
  vec3 b = normalize(cross(n, t));
  float e = 0.012;
  vec3 n1 = normalize(n + t * e);
  vec3 n2 = normalize(n + b * e);
  float d = disp(n);
  vec3 p = n * (radius + d);
  vec3 p1 = n1 * (radius + disp(n1));
  vec3 p2 = n2 * (radius + disp(n2));
  vec3 normal2 = normalize(cross(p1 - p, p2 - p));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormal = normalMatrix * normal2;
  vView = -mv.xyz;
  vBand = d / max(uAmp, 0.0001) * 0.5 + 0.5;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
varying vec3 vNormal;
varying vec3 vView;
varying float vBand;
void main(){
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vView);
  float fresnel = pow(1.0 - max(dot(n, v), 0.0), 2.4);
  vec3 col = mix(uA, uB, smoothstep(0.15, 0.9, vBand));
  vec3 l = normalize(vec3(0.5, 0.8, 0.6));
  float diffuse = max(dot(n, l), 0.0);
  float spec = pow(max(dot(reflect(-l, n), v), 0.0), 48.0);
  col *= 0.5 + 0.7 * diffuse;
  col = mix(col, uC, fresnel * 0.85);
  col += spec * 0.55;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const ORB_RADIUS = 1.5;
const DROPS = 3;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { cameraZ: 6, background: p.background, preview: p.preview });
  const state = { kick: 0, dent: 0, wave: 0, waveAmp: 0 };
  const uniforms = {
    uTime: { value: 0 },
    uAmp: { value: p.distortion },
    uFreq: { value: p.frequency },
    uPoke: { value: new THREE.Vector3(0, 0, 1) },
    uDent: { value: 0 },
    uWave: { value: 0 },
    uWaveAmp: { value: 0 },
    uA: { value: new THREE.Color(p.colorA) },
    uB: { value: new THREE.Color(p.colorB) },
    uC: { value: new THREE.Color(p.colorC) },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(ORB_RADIUS, p.preview ? 28 : 56), material);
  stage.scene.add(orb);

  // ちぎれて飛び出すしずく。球と同じ見た目で、うねりだけ小さくする。
  const dropGeometry = new THREE.IcosahedronGeometry(1, 10);
  const dropMaterial = material.clone();
  dropMaterial.uniforms.uAmp.value = 0.12;
  dropMaterial.uniforms.uFreq.value = 1.6;
  const drops = Array.from({ length: DROPS }, () => {
    const mesh = new THREE.Mesh(dropGeometry, dropMaterial);
    mesh.visible = false;
    stage.scene.add(mesh);
    return { mesh, dir: new THREE.Vector3(1, 0, 0), out: 0, size: 0 };
  });

  const pokeWorld = new THREE.Vector3(0, 0, 1);
  const inverse = new THREE.Quaternion();
  const raycaster = new THREE.Raycaster();
  const sphere = new THREE.Sphere();
  const hit = new THREE.Vector3();
  const ndc = new THREE.Vector2();

  stage.onResize(() => {
    const { width, height } = stage.viewport();
    orb.scale.setScalar(Math.min(1, width / 4.6, height / 4.2));
  });
  stage.onFrame((time, dt) => {
    uniforms.uTime.value = time * p.speed + 4;
    dropMaterial.uniforms.uTime.value = uniforms.uTime.value * 1.6;
    uniforms.uAmp.value = p.distortion * (1 + stage.pointer.speed * 1.2 + state.kick);
    orb.rotation.y += dt * 0.12;
    orb.rotation.x = -stage.pointer.sy * 0.4;
    orb.position.x = stage.pointer.sx * 0.25;
    orb.position.y = stage.pointer.sy * 0.2;
    // 球が回っても、突いた場所が画面の同じ位置に残るようにする。
    inverse.copy(orb.quaternion).invert();
    uniforms.uPoke.value.copy(pokeWorld).applyQuaternion(inverse);
    uniforms.uDent.value = state.dent;
    uniforms.uWave.value = state.wave;
    uniforms.uWaveAmp.value = state.waveAmp;
    const scale = orb.scale.x;
    for (const drop of drops) {
      drop.mesh.visible = drop.size > 0.004;
      if (!drop.mesh.visible) continue;
      drop.mesh.position.copy(orb.position).addScaledVector(drop.dir, ORB_RADIUS * scale * (0.86 + drop.out));
      drop.mesh.scale.setScalar(drop.size * scale);
    }
  });

  function kick(event) {
    if (stage.reduced) return;
    // 突いた場所を求める。球を外したときは、いちばん近い向きを使う。
    const rect = container.getBoundingClientRect();
    const hasPoint = typeof event?.clientX === 'number' && rect.width > 0 && rect.height > 0;
    ndc.set(
      hasPoint ? ((event.clientX - rect.left) / rect.width) * 2 - 1 : Math.random() * 0.4 - 0.2,
      hasPoint ? 1 - ((event.clientY - rect.top) / rect.height) * 2 : Math.random() * 0.4 - 0.2,
    );
    raycaster.setFromCamera(ndc, stage.camera);
    sphere.set(orb.position, ORB_RADIUS * orb.scale.x);
    if (!raycaster.ray.intersectSphere(sphere, hit)) raycaster.ray.closestPointToPoint(orb.position, hit);
    pokeWorld.copy(hit).sub(orb.position);
    if (pokeWorld.lengthSq() < 0.0001) pokeWorld.set(0, 0, 1);
    pokeWorld.normalize();

    utils.remove(state);
    utils.remove(drops);
    state.wave = 0;
    // 準備: 突いた場所がへこむ。
    animate(state, {
      dent: [
        { to: 0.6, duration: 150, ease: 'outQuad' },
        { to: 0, duration: 1100, ease: 'outElastic(1, .4)' },
      ],
    });
    // 山場: へこみから出た波が、球の裏側まで一周する。
    animate(state, { wave: Math.PI, duration: 1250, delay: 90, ease: 'outSine' });
    animate(state, {
      waveAmp: [
        { to: 0.3, duration: 200, ease: 'outQuad' },
        { to: 0, duration: 1100, ease: 'inQuad' },
      ],
      delay: 90,
    });
    // 波が球のふちに届くころ、しずくが時間差でちぎれて飛び出し、また吸い込まれる。
    const side = new THREE.Vector3(0, 1, 0).cross(pokeWorld);
    if (side.lengthSq() < 0.01) side.set(1, 0, 0);
    side.normalize();
    const up = new THREE.Vector3().crossVectors(pokeWorld, side).normalize();
    const turn = Math.random() * Math.PI * 2;
    drops.forEach((drop, index) => {
      const angle = turn + (index / DROPS) * Math.PI * 2 + Math.random() * 0.5;
      drop.dir.copy(side).multiplyScalar(Math.cos(angle)).addScaledVector(up, Math.sin(angle)).addScaledVector(pokeWorld, 0.25).normalize();
      drop.out = 0;
      drop.size = 0;
      const far = 0.42 + Math.random() * 0.25;
      const big = 0.2 + Math.random() * 0.12;
      const delay = 420 + index * 110;
      animate(drop, {
        out: [
          { to: far, duration: 520, ease: 'outQuart' },
          { to: far * 1.04, duration: 160, ease: 'linear' },
          { to: 0, duration: 430, ease: 'inQuad' },
        ],
        size: [
          { to: big, duration: 300, ease: 'outBack(2)' },
          { to: big * 0.9, duration: 380, ease: 'inOutSine' },
          { to: 0, duration: 430, ease: 'inQuad' },
        ],
        delay,
      });
    });
    // 余韻: しずくが戻ったところで、表面がもう一度ゆれる。
    animate(state, {
      kick: [
        { to: 0.9, duration: 180, ease: 'outQuad' },
        { to: 0, duration: 1300, ease: 'outElastic(1, .35)' },
      ],
      delay: 1450,
    });
  }
  container.addEventListener('pointerdown', kick);
  const autoKick = p.preview ? setInterval(kick, 4200) : 0;

  return {
    destroy() {
      clearInterval(autoKick);
      container.removeEventListener('pointerdown', kick);
      utils.remove(state);
      utils.remove(drops);
      dropGeometry.dispose();
      dropMaterial.dispose();
      stage.destroy();
    },
  };
}
