import * as THREE from 'three';
import { animate, stagger, utils } from 'animejs';
import { h, injectStyle } from '../../lib/dom.js';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'satellite-orbit',
  title: '衛星の軌道',
  category: 'scifi',
  libs: ['three', 'animejs'],
  description:
    '緯線と経線だけで描いた惑星のまわりを、傾きの違う軌道に乗った衛星が、光の尾を引いて回ります。衛星には名前と高度の札が付き、惑星の裏に回ると隠れます。ポインターで視点が動き、クリックするとすべての衛星が一時的に加速します。',
  params: {
    planet: { type: 'color', label: '惑星の線の色', default: '#e8935a' },
    trail: { type: 'color', label: '衛星の色', default: '#6fe3ff' },
    background: { type: 'color', label: '背景色', default: '#050912' },
    satellites: { type: 'range', label: '衛星の数', min: 2, max: 8, step: 1, default: 5 },
    speed: { type: 'range', label: '回る速さ', min: 0, max: 3, step: 0.1, default: 1 },
    tail: { type: 'range', label: '尾の長さ', min: 0.3, max: 4, step: 0.1, default: 1.7 },
    labels: { type: 'boolean', label: '名前と高度を出す', default: true },
  },
};

const CSS = `
.ua-so{position:absolute;inset:0;overflow:hidden;pointer-events:none;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
.ua-so__tag{position:absolute;left:0;top:0;padding-left:.7em;border-left:1px solid currentColor;font-size:clamp(8px,1.5vmin,11px);line-height:1.35;
  letter-spacing:.1em;white-space:pre;transition:opacity .25s}
.ua-so__hud{position:absolute;left:4%;bottom:5%;font-size:clamp(8px,1.5vmin,11px);line-height:1.6;letter-spacing:.14em;white-space:pre;opacity:.75}
`;

const PLANET = 1.5;
const SEGMENTS = 128;
const INCLINATIONS = [0.18, 1.05, -0.72, 1.48, 0.52, -1.22, 0.86, -0.3];

// 軌道 index の半径、傾き、昇交点の向き、角速度を決める。外側の軌道ほどゆっくり回る。
export function orbitOf(index) {
  const radius = 2.15 + index * 0.42;
  return {
    radius,
    inclination: INCLINATIONS[index % INCLINATIONS.length],
    node: index * 1.31,
    rate: 1.5 * (2.15 / radius) ** 1.5,
    altitude: Math.round((radius - PLANET) * 1000),
  };
}

const trailVertex = /* glsl */ `
attribute float aT;
varying float vT;
void main(){
  vT = aT;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const trailFragment = /* glsl */ `
uniform vec3 uColor;
varying float vT;
void main(){
  float a = pow(1.0 - vT, 1.8);
  gl_FragColor = vec4(uColor * a * 1.6, a);
  #include <colorspace_fragment>
}
`;
const rimVertex = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const rimFragment = /* glsl */ `
uniform vec3 uColor;
varying vec3 vNormal;
varying vec3 vView;
void main(){
  float f = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.6);
  gl_FragColor = vec4(uColor * f * 1.3, f);
  #include <colorspace_fragment>
}
`;

function circlePoints(radius, from = 0, to = Math.PI * 2, segments = SEGMENTS) {
  return Array.from({ length: segments + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / segments;
    return new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius);
  });
}

// 緯線と経線を 15 度おきに引いた、線だけの球。
function gridSphere(radius) {
  const points = [];
  const push = (a, b) => points.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const at = (lat, lon) => new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)).multiplyScalar(radius);
  const steps = 72;
  for (let lat = -75; lat <= 75; lat += 15) {
    for (let i = 0; i < steps; i += 1) push(at((lat * Math.PI) / 180, (i / steps) * Math.PI * 2), at((lat * Math.PI) / 180, ((i + 1) / steps) * Math.PI * 2));
  }
  for (let lon = 0; lon < 360; lon += 15) {
    for (let i = 0; i < steps / 2; i += 1) {
      const a = (i / (steps / 2)) * Math.PI - Math.PI / 2;
      const b = ((i + 1) / (steps / 2)) * Math.PI - Math.PI / 2;
      push(at(a, (lon * Math.PI) / 180), at(b, (lon * Math.PI) / 180));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return geometry;
}

function tickRing(radius, ticks) {
  const points = [];
  for (let i = 0; i < ticks; i += 1) {
    const a = (i / ticks) * Math.PI * 2;
    const long = i % 9 === 0 ? 0.12 : i % 3 === 0 ? 0.07 : 0.035;
    points.push(Math.cos(a) * radius, 0, Math.sin(a) * radius, Math.cos(a) * (radius + long), 0, Math.sin(a) * (radius + long));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return geometry;
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { cameraZ: 11, background: p.background, preview: p.preview });
  const planetColor = new THREE.Color(p.planet);
  const trailColor = new THREE.Color(p.trail);
  const count = Math.round(p.satellites);
  const state = { boost: 0, planet: stage.reduced ? 1 : 0 };
  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

  // 惑星。背景色の球で裏側の線と衛星を隠し、線の球と縁の光を重ねる。
  const globe = new THREE.Group();
  const lines = new THREE.LineSegments(gridSphere(PLANET), new THREE.LineBasicMaterial({ color: planetColor, opacity: 0.6, ...additive }));
  const stationPoints = Array.from({ length: 9 }, (_, i) => new THREE.Vector3().setFromSphericalCoords(PLANET * 1.005, 0.5 + ((i * 2.4) % 2.2), i * 1.9));
  const stations = new THREE.Points(new THREE.BufferGeometry().setFromPoints(stationPoints), new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, ...additive }));
  globe.add(new THREE.Mesh(new THREE.SphereGeometry(PLANET * 0.985, 40, 28), new THREE.MeshBasicMaterial({ color: p.background })), lines, stations);
  globe.rotation.z = 0.41;
  const rim = new THREE.Mesh(
    new THREE.SphereGeometry(PLANET * 1.06, 40, 28),
    new THREE.ShaderMaterial({ uniforms: { uColor: { value: planetColor } }, vertexShader: rimVertex, fragmentShader: rimFragment, ...additive }),
  );
  const scale = new THREE.LineSegments(tickRing(PLANET * 1.16, 108), new THREE.LineBasicMaterial({ color: planetColor, opacity: 0.5, ...additive }));

  const tags = h('div', { class: 'ua-so', 'aria-hidden': 'true' });
  const hud = h('div', { class: 'ua-so__hud', style: { color: p.planet } });
  tags.appendChild(hud);
  container.appendChild(tags);

  const orbits = Array.from({ length: count }, (_, index) => {
    const spec = orbitOf(index);
    const color = trailColor.clone().offsetHSL(index * 0.11, 0, 0);
    const group = new THREE.Group();
    group.rotation.order = 'YXZ';
    group.rotation.set(spec.inclination, spec.node, 0);

    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePoints(spec.radius)), new THREE.LineBasicMaterial({ color, opacity: 0.22, ...additive }));
    const trailPoints = circlePoints(spec.radius, 0, -p.tail, 72);
    const trailGeometry = new THREE.BufferGeometry().setFromPoints(trailPoints);
    trailGeometry.setAttribute('aT', new THREE.BufferAttribute(Float32Array.from(trailPoints, (_, i) => i / (trailPoints.length - 1)), 1));
    const trail = new THREE.Line(trailGeometry, new THREE.ShaderMaterial({ uniforms: { uColor: { value: color } }, vertexShader: trailVertex, fragmentShader: trailFragment, ...additive }));

    const craft = new THREE.Mesh(new THREE.OctahedronGeometry(0.075), new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.7) }));
    craft.position.set(spec.radius, 0, 0);
    const panels = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(spec.radius, -0.2, 0), new THREE.Vector3(spec.radius, 0.2, 0)]),
      new THREE.LineBasicMaterial({ color, ...additive }),
    );
    // 衛星の真下の地点まで下ろした線と、地表の点。
    const nadir = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(spec.radius, 0, 0), new THREE.Vector3(PLANET * 1.01, 0, 0)]),
      new THREE.LineBasicMaterial({ color, opacity: 0.2, ...additive }),
    );
    const foot = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(PLANET * 1.01, 0, 0)]), new THREE.PointsMaterial({ color, size: 0.09, ...additive }));

    const rotor = new THREE.Group();
    rotor.add(trail, craft, panels, nadir, foot);
    group.add(ring, rotor);

    let tag = null;
    if (p.labels && !(p.preview && index >= 3)) {
      const name = `SAT-${String(index + 1).padStart(2, '0')}`;
      tag = h('div', { class: 'ua-so__tag', style: { color: `#${color.getHexString()}` }, text: p.preview ? name : `${name}\n${spec.altitude.toLocaleString('en-US')} km` });
      tags.appendChild(tag);
    }
    return { spec, group, ring, rotor, craft, tag, angle: index * 2.1 + 0.6, draw: stage.reduced ? 1 : 0 };
  });

  const starCount = p.preview ? 260 : 700;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i += 1) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(24 + Math.random() * 30);
    starPositions.set([v.x, v.y, -Math.abs(v.z) - 6], i * 3);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 0.13, opacity: 0.7, ...additive }));

  const root = new THREE.Group();
  root.add(globe, rim, scale, ...orbits.map((o) => o.group));
  stage.scene.add(stars, root);

  const reach = orbitOf(count - 1).radius;
  let fit = 1;
  stage.onResize(() => {
    const view = stage.viewport();
    fit = Math.min(view.width, view.height) / (reach * 2.12);
  });

  const world = new THREE.Vector3();
  const center = new THREE.Vector3();
  let shown = -1;
  stage.onFrame((time, dt) => {
    const { pointer, camera, size } = stage;
    root.scale.setScalar(fit);
    root.rotation.set(0.38 - pointer.sy * 0.5, pointer.sx * 0.8 + time * 0.04, 0);
    globe.rotation.y += dt * 0.12;
    globe.scale.setScalar(0.6 + state.planet * 0.4);
    lines.material.opacity = 0.6 * state.planet;
    scale.rotation.y -= dt * 0.05;
    stars.rotation.y = pointer.sx * 0.04;

    for (const orbit of orbits) {
      orbit.angle += dt * orbit.spec.rate * 0.5 * p.speed * (1 + state.boost);
      orbit.rotor.rotation.y = -orbit.angle;
      orbit.rotor.visible = orbit.draw > 0.97;
      orbit.ring.geometry.setDrawRange(0, Math.ceil(orbit.draw * (SEGMENTS + 1)));
    }
    root.updateMatrixWorld(true);
    center.setFromMatrixPosition(root.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
    for (const orbit of orbits) {
      if (!orbit.tag) continue;
      orbit.craft.getWorldPosition(world);
      const eye = world.clone().applyMatrix4(camera.matrixWorldInverse);
      const hidden = !orbit.rotor.visible || (eye.z < center.z && Math.hypot(eye.x - center.x, eye.y - center.y) < PLANET * fit);
      world.project(camera);
      const x = (world.x * 0.5 + 0.5) * size.width;
      const y = (-world.y * 0.5 + 0.5) * size.height;
      orbit.tag.style.transform = `translate(${(x + 9).toFixed(1)}px,${(y - 16).toFixed(1)}px)`;
      orbit.tag.style.opacity = hidden ? '0' : '0.95';
    }
    const slot = Math.floor(time * 5);
    if (slot !== shown) {
      shown = slot;
      const first = orbits[0];
      const turns = first.angle / (Math.PI * 2);
      hud.textContent = `TRACKING ${String(count).padStart(2, '0')} OBJ\nREV ${turns.toFixed(2).padStart(6, '0')}  T+${time.toFixed(1).padStart(6, '0')}s`;
    }
  });

  function boost() {
    if (stage.reduced) return;
    animate(state, { boost: [5, 0], duration: 2200, ease: 'outExpo' });
  }
  if (!stage.reduced) {
    animate(state, { planet: [0, 1], duration: 1400, ease: 'outExpo' });
    animate(orbits, { draw: [0, 1], duration: 1300, ease: 'inOutQuart', delay: stagger(170, { start: 300 }) });
  }
  container.addEventListener('click', boost);

  return {
    boost,
    destroy() {
      container.removeEventListener('click', boost);
      utils.remove([state, ...orbits]);
      tags.remove();
      stage.destroy();
    },
  };
}
