import * as THREE from 'three';
import { animate, stagger, steps, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'holo-globe',
  title: 'ホログラムの惑星',
  category: 'scifi',
  libs: ['three', 'animejs'],
  description:
    '点の集まりでできた惑星を、ホログラムのように映します。起動時に下から上へ走査して現れ、地表の 2 点を結ぶ光の弧が飛び交います。クリックすると映像が乱れて、もう一度走査し直します。',
  params: {
    color: { type: 'color', label: '映像の色', default: '#4de8ff' },
    accent: { type: 'color', label: '弧の色', default: '#ffb347' },
    background: { type: 'color', label: '背景色', default: '#030b16' },
    spin: { type: 'range', label: '回る速さ', min: 0, max: 1, step: 0.05, default: 0.2 },
    arcs: { type: 'range', label: '弧の本数', min: 0, max: 16, step: 1, default: 9 },
    stripes: { type: 'range', label: '縞の細かさ', min: 4, max: 60, step: 1, default: 26 },
  },
};

const RADIUS = 1.6;

const sharedVertex = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uReveal;
uniform float uGlitch;
uniform float uStripes;
attribute float aLand;
varying float vAlpha;
void main(){
  vec3 p = position;
  // 乱れ。高さごとの帯を、ときどき横へずらす。
  float band = step(0.94, sin(p.y * 17.0 + uTime * 9.0));
  p.x += band * uGlitch * 0.16;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vec4 mv = viewMatrix * world;
  vec3 n = normalize(normalMatrix * normalize(position));
  float fresnel = pow(1.0 - abs(dot(n, normalize(-mv.xyz))), 1.4);
  float stripe = sin(world.y * uStripes - uTime * 3.0) * 0.5 + 0.5;
  float visible = smoothstep(uReveal, uReveal - 0.12, world.y);
  float scanEdge = smoothstep(0.14, 0.0, abs(world.y - uReveal));
  vAlpha = (0.25 + 0.75 * stripe) * (0.5 + fresnel) * mix(0.22, 1.0, aLand) * visible + scanEdge * 0.9;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * mix(0.55, 1.0, aLand) * (0.7 + fresnel) / -mv.z;
}
`;

const sharedFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uIsPoint;
varying float vAlpha;
void main(){
  float a = vAlpha;
  if (uIsPoint > 0.5) a *= smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5));
  gl_FragColor = vec4(uColor * a * 1.5, a);
  #include <colorspace_fragment>
}
`;

const arcVertex = /* glsl */ `
attribute float aT;
varying float vT;
void main(){
  vT = aT;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const arcFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uHead;
varying float vT;
void main(){
  // 光の頭が弧の上を進み、後ろに尾を引く。
  float d = uHead * 1.5 - vT;
  float a = smoothstep(0.0, 0.04, d) * smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(uColor * a * 1.6, a);
  #include <colorspace_fragment>
}
`;

// 大陸らしいむらを作るための、軽い擬似ノイズ。
const isLand = (x, y, z) => Math.sin(x * 3 + 1) * Math.cos(y * 2.5) + Math.sin(z * 3.3 + x * 1.7) * 0.7 + Math.sin(y * 5 + z * 2) * 0.4 > 0.12;

function buildSurface(count) {
  const positions = new Float32Array(count * 3);
  const land = new Float32Array(count);
  const landPoints = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const x = Math.cos(golden * i) * r;
    const z = Math.sin(golden * i) * r;
    positions.set([x * RADIUS, y * RADIUS, z * RADIUS], i * 3);
    if (isLand(x, y, z)) {
      land[i] = 1;
      landPoints.push(new THREE.Vector3(x, y, z));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aLand', new THREE.BufferAttribute(land, 1));
  return { geometry, landPoints };
}

function buildArc(from, to) {
  const segments = 48;
  const positions = new Float32Array((segments + 1) * 3);
  const ts = new Float32Array(segments + 1);
  const angle = from.angleTo(to);
  const point = new THREE.Vector3();
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    // 球面上をなめらかに結び、中ほどを持ち上げる。
    const a = Math.sin((1 - t) * angle) / Math.sin(angle);
    const b = Math.sin(t * angle) / Math.sin(angle);
    point.set(from.x * a + to.x * b, from.y * a + to.y * b, from.z * a + to.z * b);
    point.multiplyScalar(RADIUS * (1 + Math.sin(Math.PI * t) * 0.35 * angle));
    positions.set([point.x, point.y, point.z], i * 3);
    ts[i] = t;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aT', new THREE.BufferAttribute(ts, 1));
  return geometry;
}

function pickPair(points) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const a = points[Math.floor(Math.random() * points.length)];
    const b = points[Math.floor(Math.random() * points.length)];
    const angle = a.angleTo(b);
    if (angle > 0.6 && angle < 2.2) return [a, b];
  }
  return [points[0], points[Math.floor(points.length / 2)]];
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { cameraZ: 6, background: p.background, preview: p.preview });
  const color = new THREE.Color(p.color);
  const state = { reveal: stage.reduced ? RADIUS * 1.3 : -RADIUS * 1.3, glitch: 0 };

  const shared = {
    uTime: { value: 0 },
    uSize: { value: 1 },
    uReveal: { value: state.reveal },
    uGlitch: { value: 0 },
    uStripes: { value: p.stripes },
    uColor: { value: color },
  };
  const makeMaterial = (isPoint) =>
    new THREE.ShaderMaterial({
      uniforms: { ...shared, uIsPoint: { value: isPoint ? 1 : 0 } },
      vertexShader: sharedVertex,
      fragmentShader: sharedFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

  const globe = new THREE.Group();
  const { geometry, landPoints } = buildSurface(p.preview ? 7000 : 15000);
  const surface = new THREE.Points(geometry, makeMaterial(true));
  surface.frustumCulled = false;
  globe.add(surface);

  // 緯線と経線。aLand を 0.5 にして、点より控えめに光らせる。
  const wireGeometry = new THREE.WireframeGeometry(new THREE.SphereGeometry(RADIUS * 0.995, 18, 12));
  wireGeometry.setAttribute('aLand', new THREE.BufferAttribute(new Float32Array(wireGeometry.attributes.position.count).fill(0.35), 1));
  globe.add(new THREE.LineSegments(wireGeometry, makeMaterial(false)));

  const arcUniforms = [];
  const accent = new THREE.Color(p.accent);
  for (let i = 0; i < Math.round(p.arcs) && landPoints.length > 2; i += 1) {
    const uniforms = { uColor: { value: accent }, uHead: { value: 0 } };
    arcUniforms.push(uniforms.uHead);
    const arc = new THREE.Line(
      buildArc(...pickPair(landPoints)),
      new THREE.ShaderMaterial({ uniforms, vertexShader: arcVertex, fragmentShader: arcFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    globe.add(arc);
  }

  // 惑星を囲む 2 本の輪。
  const ringPoints = Array.from({ length: 129 }, (_, i) => {
    const a = (i / 128) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  });
  const rings = [1.28, 1.42].map((scale, index) => {
    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ringPoints),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 - index * 0.12, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    ring.scale.setScalar(RADIUS * scale);
    ring.rotation.set(0.5 + index * 0.5, 0, 0.3 - index * 0.7);
    return ring;
  });

  const root = new THREE.Group();
  root.add(globe, ...rings);
  root.rotation.z = 0.32;
  stage.scene.add(root);

  stage.onResize(({ height, dpr }) => {
    shared.uSize.value = height * dpr * 0.028;
    const view = stage.viewport();
    root.scale.setScalar(Math.min(1, view.width / 5.4, view.height / 4.8));
  });
  stage.onFrame((time, dt) => {
    shared.uTime.value = time;
    shared.uReveal.value = state.reveal;
    shared.uGlitch.value = state.glitch;
    globe.rotation.y += dt * p.spin;
    rings[0].rotation.y += dt * 0.3;
    rings[1].rotation.y -= dt * 0.2;
    root.rotation.x = -stage.pointer.sy * 0.3;
    root.rotation.y = stage.pointer.sx * 0.4;
  });

  function scan() {
    if (stage.reduced) return;
    animate(state, { reveal: [-RADIUS * 1.3, RADIUS * 1.3], duration: 2400, ease: 'inOutQuad' });
  }
  function glitch() {
    if (stage.reduced) return;
    animate(state, {
      glitch: [
        { to: 1, duration: 60, ease: steps(1) },
        { to: 0.2, duration: 90, ease: steps(1) },
        { to: 0.8, duration: 70, ease: steps(1) },
        { to: 0, duration: 120, ease: steps(1) },
      ],
    });
  }
  function reboot() {
    glitch();
    scan();
  }

  if (!stage.reduced) {
    scan();
    animate(arcUniforms, { value: [0, 1], duration: 2600, ease: 'inOutSine', delay: stagger(520), loop: true, loopDelay: 900 });
  }
  container.addEventListener('click', reboot);
  const glitchTimer = stage.reduced ? 0 : setInterval(glitch, 3700);

  return {
    reboot,
    destroy() {
      clearInterval(glitchTimer);
      container.removeEventListener('click', reboot);
      utils.remove([state, ...arcUniforms]);
      stage.destroy();
    },
  };
}
