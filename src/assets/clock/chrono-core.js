import * as THREE from 'three';
import { animate, spring, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'chrono-core',
  title: '多層のサイバー時計',
  category: 'clock',
  libs: ['three', 'animejs'],
  description:
    '秒・分・時の輪、目盛り、数字の表示を、奥行きの違う 8 枚の層に分けて重ねた時計です。ポインターを乗せると層が前後に開いて構造が見え、動かすと全体が傾きます。秒が変わるたびに輪が 1 つ点灯し、分が変わると目盛りの輪が回ります。',
  params: {
    format: {
      type: 'select',
      label: '時の輪の区切り',
      options: [
        { value: '12', label: '12 時間' },
        { value: '24', label: '24 時間' },
      ],
      default: '12',
    },
    primary: { type: 'color', label: '主な色', default: '#35f0ff' },
    secondary: { type: 'color', label: '2 番目の色', default: '#ff3d81' },
    accent: { type: 'color', label: '差し色', default: '#ffc247' },
    background: { type: 'color', label: '背景色', default: '#05070d' },
    depth: { type: 'range', label: '層の間隔', min: 0.1, max: 1.5, step: 0.05, default: 0.55 },
    glow: { type: 'range', label: '光のにじみ', min: 0, max: 1.5, step: 0.05, default: 0.3 },
  },
};

const TAU = Math.PI * 2;
const FONT = '"Bricolage Grotesque Variable", "Helvetica Neue", Arial, system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const pad = (n) => String(n).padStart(2, '0');
// 12 時の位置を 0 として、時計回りに進んだ割合から角度を求める。
const angleAt = (frac) => Math.PI / 2 - frac * TAU;

// 輪のうち何割を点灯させるかを返す。いまの秒・分・時にあたる区切りまでが点く。
export function ringProgress(date, hours24 = false) {
  const hourCount = hours24 ? 24 : 12;
  const hour = hours24 ? date.getHours() : date.getHours() % 12;
  return {
    second: (date.getSeconds() + 1) / 60,
    minute: (date.getMinutes() + 1) / 60,
    hour: (hour + 1) / hourCount,
  };
}

// 区切りのある輪を、薄い板の集まりとして作る。aSeg に「何番目の区切りか」を 0〜1 で持たせる。
function segmentRing(radius, count, thickness, gap) {
  const positions = [];
  const segs = [];
  const indices = [];
  const sub = Math.max(1, Math.ceil(96 / count));
  let v = 0;
  for (let i = 0; i < count; i += 1) {
    for (let s = 0; s < sub; s += 1) {
      const edges = [s, s + 1].map((k) => angleAt((i + gap / 2 + ((1 - gap) * k) / sub) / count));
      for (const a of edges) {
        positions.push(Math.cos(a) * (radius - thickness / 2), Math.sin(a) * (radius - thickness / 2), 0);
        positions.push(Math.cos(a) * (radius + thickness / 2), Math.sin(a) * (radius + thickness / 2), 0);
        segs.push(i / count, i / count);
      }
      indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      v += 4;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSeg', new THREE.Float32BufferAttribute(segs, 1));
  geometry.setIndex(indices);
  return geometry;
}

const ringVertex = /* glsl */ `
attribute float aSeg;
varying float vSeg;
void main(){
  vSeg = aSeg;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const ringFragment = /* glsl */ `
uniform vec3 uOn;
uniform vec3 uOff;
uniform float uProgress;
uniform float uCount;
uniform float uPulse;
varying float vSeg;
void main(){
  float lit = step(vSeg + 0.5 / uCount, uProgress);
  // いまの区切りだけを、変わった瞬間に強く光らせる。
  float head = 1.0 - step(0.6 / uCount, abs(vSeg - (uProgress - 1.0 / uCount)));
  vec3 col = mix(uOff * 0.3, uOn, lit) + uOn * head * uPulse * 1.2;
  float a = mix(0.16, 0.7, lit);
  gl_FragColor = vec4(col * a, a);
  #include <colorspace_fragment>
}
`;

function lineSegments(points, color, opacity) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
}

// 背面の板。同心円と放射線でできた、薄い方眼。
function backPlate(color) {
  const points = [];
  for (const radius of [0.6, 1.2, 1.8, 2.4, 3.0]) {
    for (let i = 0; i < 96; i += 1) {
      const a = (i / 96) * TAU;
      const b = ((i + 1) / 96) * TAU;
      points.push(Math.cos(a) * radius, Math.sin(a) * radius, 0, Math.cos(b) * radius, Math.sin(b) * radius, 0);
    }
  }
  for (let i = 0; i < 24; i += 1) {
    const a = (i / 24) * TAU;
    points.push(Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0, Math.cos(a) * 3.0, Math.sin(a) * 3.0, 0);
  }
  return lineSegments(points, color, 0.08);
}

function tickRing(color) {
  const points = [];
  for (let i = 0; i < 240; i += 1) {
    const a = (i / 240) * TAU;
    const outer = i % 20 === 0 ? 2.2 : i % 4 === 0 ? 2.15 : 2.1;
    points.push(Math.cos(a) * 2.03, Math.sin(a) * 2.03, 0, Math.cos(a) * outer, Math.sin(a) * outer, 0);
  }
  return lineSegments(points, color, 0.4);
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, {
    fov: 40,
    cameraZ: 9,
    background: p.background,
    preview: p.preview,
    maxDpr: p.preview ? 1 : 1.5,
    bloom: p.glow > 0 ? { strength: p.glow, radius: 0.15, threshold: 0.3 } : null,
  });
  const hours24 = p.format === '24';
  const hourCount = hours24 ? 24 : 12;
  const primary = new THREE.Color(p.primary);
  const secondary = new THREE.Color(p.secondary);
  const accent = new THREE.Color(p.accent);

  const makeRing = (radius, count, thickness, gap, on, off) => {
    const uniforms = { uOn: { value: on }, uOff: { value: off }, uProgress: { value: 0 }, uCount: { value: count }, uPulse: { value: 0 } };
    const mesh = new THREE.Mesh(
      segmentRing(radius, count, thickness, gap),
      new THREE.ShaderMaterial({ uniforms, vertexShader: ringVertex, fragmentShader: ringFragment, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    return { mesh, uniforms };
  };
  const basicRing = (radius, count, thickness, gap, color, opacity) =>
    new THREE.Mesh(
      segmentRing(radius, count, thickness, gap),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );

  const seconds = makeRing(2.42, 60, 0.2, 0.3, primary, primary);
  const minutes = makeRing(1.78, 60, 0.12, 0.2, secondary, secondary);
  const hours = makeRing(1.42, hourCount, 0.2, 0.08, accent, accent);

  // 外周の飾りの弧。3 色を順に並べる。
  const rim = new THREE.Group();
  [primary, accent, secondary].forEach((color, index) => {
    const arc = basicRing(2.82, 12, 0.035, 0.1, color, 0.9);
    arc.geometry.setDrawRange(0, Infinity);
    arc.rotation.z = -(index / 3) * TAU;
    // 12 個の区切りのうち 4 個ずつを、色ごとに受け持たせる。
    const perSegment = arc.geometry.index.count / 12;
    arc.geometry.setDrawRange(0, perSegment * 4);
    rim.add(arc);
  });

  const ticks = tickRing(primary);
  const dataRings = new THREE.Group();
  const dashes = basicRing(1.08, 48, 0.025, 0.55, primary, 0.8);
  const blocks = basicRing(0.92, 9, 0.06, 0.35, secondary, 0.7);
  dataRings.add(dashes, blocks);

  // 秒の位置を指す細い針と、その先の光る点。
  const hand = new THREE.Group();
  hand.add(lineSegments([0, 0.82, 0, 0, 2.6, 0], accent, 0.9));
  const tip = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), new THREE.MeshBasicMaterial({ color: accent, blending: THREE.AdditiveBlending, depthWrite: false }));
  tip.position.y = 2.42;
  hand.add(tip);

  // 中央の数字の表示。キャンバスに描いて、板に貼る。
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const readout = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 0.75),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  function drawReadout(date) {
    if (!ctx) return;
    ctx.clearRect(0, 0, 512, 256);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = p.primary;
    ctx.font = `800 132px ${FONT}`;
    ctx.fillText(`${pad(date.getHours())}:${pad(date.getMinutes())}`, 256, 108);
    ctx.fillStyle = p.accent;
    ctx.font = `600 30px ${MONO}`;
    ctx.fillText(`${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${WEEKDAYS[date.getDay()]}`, 200, 206);
    ctx.fillStyle = p.secondary;
    ctx.fillText(`:${pad(date.getSeconds())}`, 428, 206);
    texture.needsUpdate = true;
  }

  // 奥から手前へ、層を並べる。z は層の間隔を掛ける前の位置。
  const layers = [
    { object: backPlate(primary), z: -3 },
    { object: rim, z: -2 },
    { object: seconds.mesh, z: -1 },
    { object: ticks, z: 0 },
    { object: minutes.mesh, z: 1 },
    { object: hours.mesh, z: 2 },
    { object: dataRings, z: 3 },
    { object: hand, z: 3.5 },
    { object: readout, z: 4.5 },
  ].map((layer) => ({ ...layer, intro: { v: stage.reduced ? 1 : 0 } }));
  const root = new THREE.Group();
  for (const layer of layers) root.add(layer.object);
  stage.scene.add(root);

  const state = { explode: 0, spin: 0, pulseSecond: 0, pulseMinute: 0 };
  const fill = [{ v: stage.reduced ? 1 : 0 }, { v: stage.reduced ? 1 : 0 }, { v: stage.reduced ? 1 : 0 }];
  let lastSecond = -1;
  let lastMinute = -1;

  stage.onResize(() => {
    const view = stage.viewport();
    root.scale.setScalar(Math.min(1, view.width / 6.3, view.height / 6.3));
  });
  stage.onFrame((time, dt) => {
    const now = new Date();
    const progress = ringProgress(now, hours24);
    if (now.getSeconds() !== lastSecond) {
      lastSecond = now.getSeconds();
      drawReadout(now);
      if (!stage.reduced) animate(state, { pulseSecond: [1, 0], duration: 700, ease: 'outExpo' });
      if (now.getMinutes() !== lastMinute) {
        if (lastMinute !== -1 && !stage.reduced) {
          animate(state, { spin: state.spin + Math.PI / 6, pulseMinute: [1, 0], duration: 1400, ease: 'outExpo' });
        }
        lastMinute = now.getMinutes();
      }
    }
    seconds.uniforms.uProgress.value = progress.second * fill[0].v;
    seconds.uniforms.uPulse.value = state.pulseSecond;
    minutes.uniforms.uProgress.value = progress.minute * fill[1].v;
    minutes.uniforms.uPulse.value = state.pulseMinute;
    hours.uniforms.uProgress.value = progress.hour * fill[2].v;

    const smoothSecond = (now.getSeconds() + now.getMilliseconds() / 1000) / 60;
    hand.rotation.z = -smoothSecond * TAU;
    ticks.rotation.z = -state.spin - time * 0.02;
    dashes.rotation.z += dt * 0.25;
    blocks.rotation.z -= dt * 0.4;
    rim.rotation.z = time * 0.03;

    const gap = p.depth * (0.45 + state.explode * 1.0);
    for (const layer of layers) {
      const v = layer.intro.v;
      layer.object.visible = v > 0.001;
      layer.object.position.z = layer.z * gap - (1 - v) * 7;
      layer.object.scale.setScalar(0.55 + 0.45 * v);
    }
    // 触っていないときは、ゆっくり首を振って層の重なりを見せる。
    const idle = 1 - state.explode;
    root.rotation.x = -stage.pointer.sy * 0.4 + Math.sin(time * 0.31) * 0.12 * idle - 0.1;
    root.rotation.y = stage.pointer.sx * 0.5 + Math.sin(time * 0.23) * 0.38 * idle;
  });

  const open = () => !stage.reduced && animate(state, { explode: 1, ease: spring({ stiffness: 70, damping: 11 }) });
  const close = () => !stage.reduced && animate(state, { explode: 0, ease: spring({ stiffness: 70, damping: 13 }) });
  container.addEventListener('pointerenter', open);
  container.addEventListener('pointerleave', close);

  const intros = layers.map((layer) => layer.intro);
  let pulseTimer = 0;
  let pulseOff = 0;
  if (!stage.reduced) {
    // 起動。層が奥から順に飛んできて重なり、輪が 0 から現在の値まで点いていく。
    animate(intros, { v: 1, duration: 1500, ease: 'outExpo', delay: stagger(110) });
    animate(fill, { v: 1, duration: 1800, ease: 'inOutQuart', delay: stagger(220, { start: 900 }) });
    if (p.preview) {
      pulseTimer = setInterval(() => {
        open();
        pulseOff = setTimeout(close, 1900);
      }, 4800);
    }
  }

  return {
    destroy() {
      clearInterval(pulseTimer);
      clearTimeout(pulseOff);
      container.removeEventListener('pointerenter', open);
      container.removeEventListener('pointerleave', close);
      utils.remove([state, ...intros, ...fill]);
      texture.dispose();
      stage.destroy();
    },
  };
}
