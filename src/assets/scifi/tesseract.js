import * as THREE from 'three';
import { animate, stagger, utils } from 'animejs';
import { h } from '../../lib/dom.js';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'tesseract',
  title: '四次元立方体',
  category: 'scifi',
  libs: ['three', 'animejs'],
  description:
    '4 次元の立方体を 4 次元の中で回し、3 次元に投影した線画です。内と外の立方体が裏返るように入れ替わり、頂点が光ります。ポインターを動かすと回転の軸が変わり、クリックすると、4 次元の奥行きがつぶれて内と外の立方体が 1 つに重なり、全体が小さく縮みます。そこから触った方向の軸へ勢いよく回り出しながら弾けるように開き直り、まわりの 3 本の輪が時間差で宙返りして収まります。左下に、いまの回転角が出ます。',
  params: {
    inner: { type: 'color', label: '奥側の色', default: '#8f6bff' },
    outer: { type: 'color', label: '手前側の色', default: '#ffcf6b' },
    background: { type: 'color', label: '背景色', default: '#07050f' },
    speed: { type: 'range', label: '回る速さ', min: 0, max: 3, step: 0.1, default: 1 },
    distance: { type: 'range', label: '投影の距離', min: 2.6, max: 6, step: 0.1, default: 3 },
    glow: { type: 'range', label: '光のにじみ', min: 0, max: 1.6, step: 0.1, default: 0.5 },
    faces: { type: 'boolean', label: '面をうっすら塗る', default: true },
  },
};

const VERTICES = Array.from({ length: 16 }, (_, i) => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
const BITS = [1, 2, 4, 8];

// 1 つの軸だけが違う頂点どうしを結ぶと、32 本の辺になる。
export const EDGES = VERTICES.flatMap((_, i) => BITS.filter((bit) => !(i & bit)).map((bit) => [i, i | bit]));

// 2 つの軸を選び、残りの 2 軸を固定すると、24 枚の面になる。
export const FACES = VERTICES.flatMap((_, i) =>
  BITS.flatMap((a, ai) => BITS.slice(ai + 1).filter((b) => !(i & a) && !(i & b)).map((b) => [i, i | a, i | a | b, i | b])),
);

function rotatePlane(v, a, b, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const va = v[a];
  v[a] = va * c - v[b] * s;
  v[b] = va * s + v[b] * c;
}

// 4 次元の点を回してから、w 方向の遠近をつけて 3 次元へ写す。戻り値の 4 番目は w（奥行き）。
export function project(vertex, angles, distance, unfold = 1) {
  const v = [...vertex];
  rotatePlane(v, 0, 3, angles.xw);
  rotatePlane(v, 1, 3, angles.yw);
  rotatePlane(v, 2, 3, angles.zw);
  rotatePlane(v, 0, 1, angles.xy);
  const w = v[3] * unfold;
  const scale = distance / (distance - w);
  return [v[0] * scale, v[1] * scale, v[2] * scale, w];
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.18, 'rgba(255,255,255,.85)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,.2)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function tickRing(radius, ticks) {
  const points = [];
  for (let i = 0; i < ticks; i += 1) {
    const a = (i / ticks) * Math.PI * 2;
    const b = ((i + 1) / ticks) * Math.PI * 2;
    const long = i % 6 === 0 ? 0.16 : 0.06;
    points.push(Math.cos(a) * radius, 0, Math.sin(a) * radius, Math.cos(b) * radius, 0, Math.sin(b) * radius);
    points.push(Math.cos(a) * radius, 0, Math.sin(a) * radius, Math.cos(a) * (radius + long), 0, Math.sin(a) * (radius + long));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return geometry;
}

const degrees = (rad) => ((((rad * 180) / Math.PI) % 360) + 360) % 360;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, {
    cameraZ: 9.5,
    background: p.background,
    preview: p.preview,
    bloom: p.glow > 0 ? { strength: p.glow, radius: 0.2, threshold: 0.3 } : null,
  });
  const inner = new THREE.Color(p.inner);
  const outer = new THREE.Color(p.outer);
  const state = { grow: stage.reduced ? 1 : 0, unfold: stage.reduced ? 1 : 0, kick: 0, squeeze: 0, pushX: 0, pushY: 0 };
  const flips = [{ v: 0 }, { v: 0 }, { v: 0 }];
  const angles = { xw: 0.6, yw: 0.4, zw: 0.9, xy: 0.3 };

  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
  const dynamic = (count) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    return geometry;
  };

  const edgeGeometry = dynamic(EDGES.length * 2);
  const edges = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ vertexColors: true, ...additive }));
  const pointGeometry = dynamic(16);
  const pointMaterial = new THREE.PointsMaterial({ size: 0.42, map: glowTexture(), vertexColors: true, sizeAttenuation: true, ...additive });
  const points = new THREE.Points(pointGeometry, pointMaterial);
  const faceGeometry = dynamic(FACES.length * 4);
  faceGeometry.setIndex(FACES.flatMap((_, i) => [i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3]));
  const faces = new THREE.Mesh(faceGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, opacity: 0.014, side: THREE.DoubleSide, ...additive }));
  faces.visible = p.faces;
  for (const object of [edges, points, faces]) object.frustumCulled = false;

  const body = new THREE.Group();
  body.add(faces, edges, points);

  // まわりを囲む目盛りの輪と、遠くの塵。
  const ringColor = inner.clone().lerp(outer, 0.3);
  const rings = [
    [3.5, 72, [0.3, 0, 0.2]],
    [3.8, 96, [1.25, 0.4, 0]],
    [4.1, 120, [0.7, 0, 1.3]],
  ].map(([radius, ticks, rotation], index) => {
    const ring = new THREE.LineSegments(tickRing(radius, ticks), new THREE.LineBasicMaterial({ color: ringColor, opacity: 0.3 - index * 0.07, ...additive }));
    ring.rotation.set(...rotation);
    return ring;
  });
  const dustCount = p.preview ? 160 : 420;
  const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i += 1) {
    const direction = new THREE.Vector3().randomDirection().multiplyScalar(5 + Math.random() * 9);
    dustPositions.set([direction.x, direction.y, direction.z - 3], i * 3);
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ size: 0.05, color: ringColor, opacity: 0.45, ...additive }));

  const root = new THREE.Group();
  root.add(body, ...rings);
  const ringRest = rings.map((ring) => ring.rotation.clone());
  stage.scene.add(root, dust);

  const readout = h('div', {
    'aria-hidden': 'true',
    style: {
      position: 'absolute',
      left: '4%',
      bottom: '5%',
      font: '600 clamp(8px, 1.5vmin, 12px)/1.6 ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      letterSpacing: '.12em',
      whiteSpace: 'pre',
      color: p.outer,
      opacity: '.8',
      pointerEvents: 'none',
    },
  });
  container.appendChild(readout);

  const projected = VERTICES.map(() => [0, 0, 0, 0]);
  const colors = VERTICES.map(() => new THREE.Color());
  function update() {
    VERTICES.forEach((vertex, i) => {
      projected[i] = project(vertex, angles, p.distance, state.unfold);
      // w が大きい（手前の）頂点ほど、手前側の色で明るくする。
      const t = Math.min(1, Math.max(0, projected[i][3] / 4 + 0.5));
      colors[i].copy(inner).lerp(outer, t).multiplyScalar(0.55 + t * 0.75 + state.kick * 0.8);
    });
    const write = (geometry, indices) => {
      const position = geometry.attributes.position;
      const color = geometry.attributes.color;
      indices.forEach((vertexIndex, i) => {
        const [x, y, z] = projected[vertexIndex];
        position.setXYZ(i, x, y, z);
        color.setXYZ(i, colors[vertexIndex].r, colors[vertexIndex].g, colors[vertexIndex].b);
      });
      position.needsUpdate = true;
      color.needsUpdate = true;
    };
    write(edgeGeometry, EDGES.flat());
    write(pointGeometry, VERTICES.map((_, i) => i));
    if (p.faces) write(faceGeometry, FACES.flat());
  }

  let fit = 1;
  stage.onResize(() => {
    const view = stage.viewport();
    fit = Math.min(1, view.width / 8.7, view.height / 8.7);
  });

  let shown = -1;
  stage.onFrame((time, dt) => {
    const { pointer } = stage;
    // 触っていないときは、回転の軸をゆっくり移り変わらせる。
    const ax = pointer.inside ? pointer.sx : Math.sin(time * 0.23) * 0.7;
    const ay = pointer.inside ? pointer.sy : Math.cos(time * 0.31) * 0.6;
    const rate = dt * p.speed * (1 + state.kick * 5);
    angles.xw += rate * (0.55 + ax * 0.9) + dt * state.kick * state.pushX * 4;
    angles.yw += rate * ay * 1.1 + dt * state.kick * state.pushY * 4;
    angles.zw += rate * 0.31;
    angles.xy += rate * 0.17;
    update();
    root.scale.setScalar(fit * (0.001 + state.grow) * (1 - state.squeeze * 0.3));
    root.rotation.set(0.32 - ay * 0.35, ax * 0.5 + time * 0.05, 0);
    const spun = flips.map((flip) => flip.v * Math.PI * 2);
    rings[0].rotation.y += dt * 0.12;
    rings[1].rotation.z -= dt * 0.08;
    rings[2].rotation.x += dt * 0.05;
    rings[0].rotation.x = ringRest[0].x + spun[0];
    rings[1].rotation.y = ringRest[1].y + spun[1];
    rings[2].rotation.z = ringRest[2].z + spun[2];
    dust.rotation.y = time * 0.01 + ax * 0.05;
    pointMaterial.size = 0.42 * (1 + state.kick * 0.9);
    const slot = Math.floor(time * 10);
    if (slot !== shown) {
      shown = slot;
      const f = (name) => `${name.toUpperCase()} ${degrees(angles[name]).toFixed(1).padStart(5, '0')}°`;
      readout.textContent = `${f('xw')}  ${f('yw')}\n${f('zw')}  ${f('xy')}`;
    }
  });

  function spin() {
    if (stage.reduced) return;
    // たたんで縮む → 触った方向へ回りながら開き直る → 輪が順に宙返りして収まる。
    state.pushX = stage.pointer.x;
    state.pushY = stage.pointer.y;
    utils.remove(state);
    animate(state, {
      unfold: [{ to: 0, duration: 300, ease: 'inQuad' }, { to: 1, duration: 1500, ease: 'outElastic(1, .5)' }],
      squeeze: [{ to: 1, duration: 300, ease: 'inQuad' }, { to: 0, duration: 1100, ease: 'outElastic(1, .4)' }],
      kick: [{ to: 0.15, duration: 300 }, { to: 1, duration: 120, ease: 'outQuad' }, { to: 0, duration: 1900, ease: 'outExpo' }],
      grow: { to: 1, duration: 200 },
    });
    utils.remove(flips);
    flips.forEach((flip) => {
      flip.v = 0;
    });
    animate(flips, { v: 1, duration: 1600, ease: 'outElastic(1, .7)', delay: stagger(180, { start: 300 }) });
  }
  const auto = p.preview && !stage.reduced ? setInterval(spin, 5000) : 0;
  if (!stage.reduced) {
    animate(state, { grow: [0, 1], duration: 1500, ease: 'outExpo' });
    animate(state, { unfold: [0, 1], duration: 2200, delay: 500, ease: 'inOutQuart' });
  }
  container.addEventListener('click', spin);

  return {
    spin,
    destroy() {
      clearInterval(auto);
      container.removeEventListener('click', spin);
      utils.remove(state);
      utils.remove(flips);
      readout.remove();
      stage.destroy();
    },
  };
}
