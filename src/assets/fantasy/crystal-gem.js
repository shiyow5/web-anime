import * as THREE from 'three';
import { animate, spring, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'crystal-gem',
  title: '魔力の結晶',
  category: 'fantasy',
  libs: ['three', 'animejs'],
  description:
    '六角柱の結晶の群れが、面ごとに色を変えながら浮かびます。読み込み時に地面から生えるように伸び、まわりで光の粒がまたたきます。クリックすると結晶が順に震えて、粒が外へ弾けます。',
  params: {
    colorA: { type: 'color', label: '色 A', default: '#6a3dff' },
    colorB: { type: 'color', label: '色 B', default: '#35e6ff' },
    colorC: { type: 'color', label: 'ふちの色', default: '#ffd6ff' },
    background: { type: 'color', label: '背景色', default: '#0d0820' },
    spin: { type: 'range', label: '回る速さ', min: 0, max: 2, step: 0.05, default: 0.35 },
    sparkles: { type: 'range', label: '光の粒の数', min: 0, max: 400, step: 10, default: 160 },
  },
};

// [x, y, z, 大きさ, 傾き x, 傾き z]
const LAYOUT = [
  [0, 0.1, 0, 1, 0, 0],
  [-1.05, -0.75, 0.3, 0.52, 0.2, 0.55],
  [1.0, -0.8, 0.2, 0.48, 0.15, -0.6],
  [0.45, -0.95, 0.9, 0.36, 0.7, -0.2],
  [-0.5, -0.95, -0.8, 0.4, -0.6, 0.3],
  [0.75, -0.9, -0.75, 0.3, -0.5, -0.45],
  [-0.2, -1.0, 1.0, 0.26, 0.8, 0.25],
];

const crystalVertex = /* glsl */ `
varying vec3 vView;
varying vec3 vLocal;
void main(){
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const crystalFragment = /* glsl */ `
uniform float uTime;
uniform float uGlow;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
varying vec3 vView;
varying vec3 vLocal;
void main(){
  // 画面上の変化量から面の向きを求める。頂点の法線を使わないので、面がくっきり分かれる。
  vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
  vec3 v = normalize(-vView);
  float facing = max(dot(n, v), 0.0);
  float fresnel = pow(1.0 - facing, 2.0);
  float band = 0.5 + 0.5 * cos(6.2832 * (facing * 1.4 + vLocal.y * 0.22 + uTime * 0.06));
  vec3 col = mix(uA, uB, band) * (0.3 + 0.75 * facing);
  col = mix(col, uC, fresnel * 0.8);
  vec3 l1 = normalize(vec3(0.5, 0.8, 0.6));
  vec3 l2 = normalize(vec3(-0.7, 0.25, 0.5));
  float spec = pow(max(dot(reflect(-l1, n), v), 0.0), 60.0) + pow(max(dot(reflect(-l2, n), v), 0.0), 28.0) * 0.6;
  col += spec * 1.2 + uC * uGlow * 0.6;
  gl_FragColor = vec4(col, 0.94);
  #include <colorspace_fragment>
}
`;

const sparkleVertex = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uBurst;
attribute vec3 aSeed;
varying float vAlpha;
void main(){
  vec3 p = position * (1.0 + uBurst * (0.4 + aSeed.x));
  p.y += sin(uTime * (0.4 + aSeed.y) + aSeed.z * 30.0) * 0.15;
  float twinkle = pow(sin(uTime * (1.5 + aSeed.x * 3.0) + aSeed.y * 40.0) * 0.5 + 0.5, 4.0);
  vAlpha = 0.15 + twinkle + uBurst;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.4 + aSeed.z) * (0.5 + twinkle) / -mv.z;
}
`;

const sparkleFragment = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main(){
  vec2 c = abs(gl_PointCoord - 0.5);
  // 十字に伸びる光の形。
  float star = smoothstep(0.5, 0.0, c.x + c.y * 6.0) + smoothstep(0.5, 0.0, c.y + c.x * 6.0);
  float a = min(star, 1.0) * vAlpha;
  gl_FragColor = vec4(uColor * a, a);
  #include <colorspace_fragment>
}
`;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 40, cameraZ: 7, background: p.background, preview: p.preview });
  const state = { glow: 0, burst: 0 };
  const crystalUniforms = {
    uTime: { value: 0 },
    uGlow: { value: 0 },
    uA: { value: new THREE.Color(p.colorA) },
    uB: { value: new THREE.Color(p.colorB) },
    uC: { value: new THREE.Color(p.colorC) },
  };
  const material = new THREE.ShaderMaterial({ uniforms: crystalUniforms, vertexShader: crystalVertex, fragmentShader: crystalFragment, transparent: true });
  // 六角柱の上下をとがらせた形。断面の輪郭を 6 分割で回して作る。
  const profile = [new THREE.Vector2(0, -1.25), new THREE.Vector2(0.6, -0.5), new THREE.Vector2(0.55, 0.85), new THREE.Vector2(0, 1.5)];
  const geometry = new THREE.LatheGeometry(profile, 6);

  const cluster = new THREE.Group();
  const crystals = LAYOUT.map(([x, y, z, size, tiltX, tiltZ]) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    pivot.rotation.set(tiltX, 0, tiltZ);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(stage.reduced ? size : 0.0001);
    pivot.add(mesh);
    cluster.add(pivot);
    return { mesh, size, kick: { v: 0 } };
  });

  const sparkleCount = Math.round(p.preview ? Math.min(p.sparkles, 80) : p.sparkles);
  const sparklePositions = new Float32Array(sparkleCount * 3);
  for (let i = 0; i < sparkleCount; i += 1) {
    const radius = 1.4 + Math.random() * 1.6;
    const a = Math.random() * Math.PI * 2;
    sparklePositions.set([Math.cos(a) * radius, (Math.random() - 0.5) * 3.2, Math.sin(a) * radius], i * 3);
  }
  const sparkleGeometry = new THREE.BufferGeometry();
  sparkleGeometry.setAttribute('position', new THREE.BufferAttribute(sparklePositions, 3));
  sparkleGeometry.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(sparkleCount * 3).map(() => Math.random()), 3));
  const sparkleUniforms = { uTime: { value: 0 }, uSize: { value: 1 }, uBurst: { value: 0 }, uColor: { value: new THREE.Color(p.colorC) } };
  const sparkles = new THREE.Points(
    sparkleGeometry,
    new THREE.ShaderMaterial({ uniforms: sparkleUniforms, vertexShader: sparkleVertex, fragmentShader: sparkleFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  sparkles.frustumCulled = false;
  cluster.add(sparkles);
  stage.scene.add(cluster);

  stage.onResize(({ height, dpr }) => {
    sparkleUniforms.uSize.value = height * dpr * 0.09;
    const view = stage.viewport();
    cluster.scale.setScalar(Math.min(1, view.width / 4.6, view.height / 4.2));
  });
  stage.onFrame((time, dt) => {
    crystalUniforms.uTime.value = time;
    crystalUniforms.uGlow.value = state.glow;
    sparkleUniforms.uTime.value = time;
    sparkleUniforms.uBurst.value = state.burst;
    cluster.rotation.y += dt * p.spin;
    cluster.rotation.x = 0.12 - stage.pointer.sy * 0.25;
    cluster.position.y = Math.sin(time * 0.7) * 0.08;
    for (const crystal of crystals) crystal.mesh.rotation.y = crystal.kick.v * 0.6;
  });

  const scales = crystals.map((c) => c.mesh.scale);
  const kicks = crystals.map((c) => c.kick);
  if (!stage.reduced) {
    const size = (_, index) => crystals[index].size;
    animate(scales, { x: size, y: size, z: size, delay: stagger(110, { start: 150 }), ease: spring({ stiffness: 90, damping: 8 }) });
  }

  function chime() {
    if (stage.reduced) return;
    animate(kicks, {
      v: [
        { to: 1, duration: 120, ease: 'outQuad' },
        { to: 0, duration: 1400, ease: 'outElastic(1, .3)' },
      ],
      delay: stagger(60),
    });
    animate(state, {
      glow: [{ to: 1, duration: 150, ease: 'outQuad' }, { to: 0, duration: 1300, ease: 'outExpo' }],
      burst: [{ to: 1, duration: 500, ease: 'outExpo' }, { to: 0, duration: 1600, ease: 'inOutQuad' }],
    });
  }
  container.addEventListener('click', chime);
  const autoChime = p.preview && !stage.reduced ? setInterval(chime, 4600) : 0;

  return {
    chime,
    destroy() {
      clearInterval(autoChime);
      container.removeEventListener('click', chime);
      utils.remove([state, ...scales, ...kicks]);
      stage.destroy();
    },
  };
}
