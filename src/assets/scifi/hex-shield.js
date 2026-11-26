import * as THREE from 'three';
import { animate, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'hex-shield',
  title: '六角形の防壁',
  category: 'scifi',
  libs: ['three', 'animejs'],
  description:
    '中心の核を、六角形の升目でできた球形の防壁が包みます。起動時に下から上へ張られ、何かが当たった場所から波紋が球の表面を伝わって、升目が順に光ります。クリックした場所にも衝撃が走ります。守る・安全といった意味を伝える場面に使えます。',
  params: {
    color: { type: 'color', label: '防壁の色', default: '#4fd8ff' },
    hit: { type: 'color', label: '衝撃の色', default: '#ffd27a' },
    core: { type: 'color', label: '核の色', default: '#ff5c9d' },
    background: { type: 'color', label: '背景色', default: '#04070f' },
    cells: { type: 'range', label: '升目の細かさ', min: 6, max: 30, step: 1, default: 14 },
    interval: { type: 'range', label: '自動の衝撃の間隔（秒、0 で止める）', min: 0, max: 6, step: 0.2, default: 1.6 },
  },
};

const MAX_HITS = 6;
const RADIUS = 1.9;

const vertexShader = /* glsl */ `
varying vec3 vDir;
varying vec3 vNormalView;
varying vec3 vView;
void main(){
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalView = normalMatrix * normal;
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uCells;
uniform float uReveal;
uniform vec3 uColor;
uniform vec3 uHitColor;
uniform vec4 uHits[${MAX_HITS}];
varying vec3 vDir;
varying vec3 vNormalView;
varying vec3 vView;
float hexDist(vec2 p){
  p = abs(p);
  return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
}
// 六角形の升目。升目の縁までの距離を返す。
float hexEdge(vec2 uv){
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(uv, r) - h;
  vec2 b = mod(uv - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  return 0.5 - hexDist(g);
}
void main(){
  vec3 n = normalize(vDir);
  vec2 uv = vec2(atan(n.z, n.x) / 6.2831853 + 0.5, asin(clamp(n.y, -1.0, 1.0)) / 3.1415927 + 0.5);
  float edge = hexEdge(uv * vec2(uCells * 2.0, uCells * 1.1547));
  float line = smoothstep(0.07, 0.0, edge);
  float fill = smoothstep(0.0, 0.5, edge);

  // 当たった場所から、球の表面を伝わる波紋。
  float ripple = 0.0;
  for (int i = 0; i < ${MAX_HITS}; i++) {
    float age = uTime - uHits[i].w;
    if (age > 0.0 && age < 4.0) {
      float angle = acos(clamp(dot(n, uHits[i].xyz), -1.0, 1.0));
      ripple += smoothstep(0.16, 0.0, abs(angle - age * 1.3)) * exp(-age * 1.5);
      ripple += smoothstep(0.35, 0.0, angle) * exp(-age * 6.0) * 0.6;
    }
  }
  float fresnel = pow(1.0 - abs(dot(normalize(vNormalView), normalize(vView))), 2.2);
  float poles = smoothstep(1.0, 0.8, abs(n.y));
  float shown = smoothstep(uReveal, uReveal - 0.25, n.y);
  float scan = smoothstep(0.08, 0.0, abs(n.y - uReveal)) * step(-0.99, uReveal) * step(uReveal, 1.2);

  vec3 col = uColor * (line * 0.5 * poles + fresnel * 0.55 + 0.03);
  col += uHitColor * ripple * (line * 1.3 + (1.0 - fill) * 0.22 + 0.04) * poles;
  col += uColor * scan * 1.5;
  float a = clamp((line * 0.5 * poles + fresnel * 0.5 + ripple * 0.4 + scan) * shown, 0.0, 1.0);
  gl_FragColor = vec4(col * shown, a);
  #include <colorspace_fragment>
}
`;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 40, cameraZ: 7, background: p.background, preview: p.preview, maxDpr: p.preview ? 1 : 1.5, bloom: { strength: 0.45, radius: 0.25, threshold: 0.3 } });
  const state = { reveal: stage.reduced ? 1.4 : -1.3 };
  const hits = Array.from({ length: MAX_HITS }, () => new THREE.Vector4(0, 1, 0, -100));
  const uniforms = {
    uTime: { value: 0 },
    uCells: { value: p.cells },
    uReveal: { value: state.reveal },
    uColor: { value: new THREE.Color(p.color) },
    uHitColor: { value: new THREE.Color(p.hit) },
    uHits: { value: hits },
  };
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS, 64, 48),
    new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  );

  // 守られている核。線の多面体の中で、小さな立体が回る。
  const coreColor = new THREE.Color(p.core);
  const cage = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.62, 1)), new THREE.LineBasicMaterial({ color: coreColor, transparent: true, opacity: 0.7 }));
  const heart = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), new THREE.MeshBasicMaterial({ color: coreColor }));
  const system = new THREE.Group();
  system.add(shield, cage, heart);
  stage.scene.add(system);

  let next = 0;
  function impact(direction) {
    hits[next].set(direction.x, direction.y, direction.z, uniforms.uTime.value);
    next = (next + 1) % MAX_HITS;
  }
  const randomDirection = () => new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 1.2 - 0.6, Math.random() * 0.6 + 0.4).normalize();

  stage.onResize(() => {
    const view = stage.viewport();
    system.scale.setScalar(Math.min(1, view.width / 4.6, view.height / 4.4));
  });
  stage.onFrame((time, dt) => {
    uniforms.uTime.value = time;
    uniforms.uReveal.value = state.reveal;
    shield.rotation.y += dt * 0.08;
    cage.rotation.set(time * 0.3, time * 0.4, 0);
    heart.rotation.set(time * 0.9, time * 0.7, 0);
    heart.scale.setScalar(1 + Math.sin(time * 3) * 0.08);
    system.rotation.x = -stage.pointer.sy * 0.25;
    system.rotation.y = stage.pointer.sx * 0.35;
  });

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function onPointerDown(event) {
    if (stage.reduced) return;
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
    raycaster.setFromCamera(ndc, stage.camera);
    const [found] = raycaster.intersectObject(shield);
    // 当たった位置を、回っている球から見た向きに直す。
    if (found) impact(shield.worldToLocal(found.point.clone()).normalize());
  }
  container.addEventListener('pointerdown', onPointerDown);

  let timer = 0;
  if (!stage.reduced) {
    // 起動。下から上へ、防壁が張られていく。
    animate(state, { reveal: 1.4, duration: 2200, ease: 'inOutQuart' });
    if (p.interval > 0) timer = setInterval(() => impact(randomDirection()), p.interval * 1000);
  }

  return {
    impact: (x = 0, y = 0, z = 1) => impact(new THREE.Vector3(Number(x) || 0, Number(y) || 0, Number(z) || 0).normalize()),
    destroy() {
      clearInterval(timer);
      container.removeEventListener('pointerdown', onPointerDown);
      utils.remove(state);
      stage.destroy();
    },
  };
}
