import * as THREE from 'three';
import { animate, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { h, injectStyle } from '../../lib/dom.js';

export const meta = {
  id: 'atom-orbitals',
  title: '原子の電子雲',
  category: 'science',
  libs: ['three', 'animejs'],
  description:
    '原子核のまわりで電子が見つかる確率を、点の濃さで描きます。点は水素型の波動関数（1s・2s・2p・3s）の確率分布から選び、殻ごとの広がりはスレーターの規則で求めた有効核電荷で決めています。元素を選ぶと電子の配置が変わり、断面にすると 2s の節や 2p のくびれが見えます。',
  params: {
    element: {
      type: 'select',
      label: '元素',
      options: [
        { value: 'H', label: '水素 H' },
        { value: 'He', label: 'ヘリウム He' },
        { value: 'Li', label: 'リチウム Li' },
        { value: 'C', label: '炭素 C' },
        { value: 'N', label: '窒素 N' },
        { value: 'O', label: '酸素 O' },
        { value: 'Ne', label: 'ネオン Ne' },
        { value: 'Na', label: 'ナトリウム Na' },
      ],
      default: 'O',
    },
    view: {
      type: 'select',
      label: '見せ方',
      options: [
        { value: 'cloud', label: '雲の全体' },
        { value: 'half', label: '手前半分を切り取る' },
        { value: 'section', label: '薄い断面' },
      ],
      default: 'half',
    },
    colorS: { type: 'color', label: 's 軌道の色', default: '#5fd4ff' },
    colorP: { type: 'color', label: 'p 軌道の色', default: '#ff5c9e' },
    background: { type: 'color', label: '背景色', default: '#0c0818' },
    density: { type: 'range', label: '点の数（千）', min: 10, max: 120, step: 5, default: 70 },
    spin: { type: 'range', label: '回る速さ', min: 0, max: 1.5, step: 0.05, default: 0.25 },
  },
};

const ELEMENTS = { H: 1, He: 2, Li: 3, C: 6, N: 7, O: 8, Ne: 10, Na: 11 };
const SUPERSCRIPT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶'];

// 電子を 1s → 2s → 2p → 3s の順に入れる。2p はフントの規則で、3 つの向きに 1 個ずつ入れてから対にする。
export function electronConfig(z) {
  let left = z;
  const take = (max) => {
    const n = Math.min(left, max);
    left -= n;
    return n;
  };
  const s1 = take(2);
  const s2 = take(2);
  const p2 = take(6);
  const s3 = take(2);
  const n1 = s1;
  const n2 = s2 + p2;
  const n3 = s3;
  // スレーターの規則による有効核電荷。
  const zeff = {
    1: z - 0.3 * Math.max(0, n1 - 1),
    2: z - 0.35 * Math.max(0, n2 - 1) - 0.85 * n1,
    3: z - 0.35 * Math.max(0, n3 - 1) - 0.85 * n2 - n1,
  };
  const pAxes = [0, 0, 0];
  for (let i = 0; i < p2; i += 1) pAxes[i % 3] += 1;
  const shells = [];
  if (s1) shells.push({ name: '1s', n: 1, l: 0, electrons: s1, zeff: zeff[1] });
  if (s2) shells.push({ name: '2s', n: 2, l: 0, electrons: s2, zeff: zeff[2] });
  if (p2) shells.push({ name: '2p', n: 2, l: 1, electrons: p2, zeff: zeff[2], axes: pAxes });
  if (s3) shells.push({ name: '3s', n: 3, l: 0, electrons: s3, zeff: zeff[3] });
  return shells;
}

// 動径方向の確率密度 r² R(r)²（ρ = Zr/a₀ で表した水素型の式）。
const RADIAL = {
  '2s': (r) => r * r * (2 - r) ** 2 * Math.exp(-r),
  '3s': (r) => r * r * (27 - 18 * r + 2 * r * r) ** 2 * Math.exp((-2 * r) / 3),
};

function makeRejectionSampler(density, max) {
  let peak = 0;
  for (let r = 0; r <= max; r += 0.02) peak = Math.max(peak, density(r));
  return () => {
    for (let i = 0; i < 400; i += 1) {
      const r = Math.random() * max;
      if (Math.random() * peak < density(r)) return r;
    }
    return max / 2;
  };
}

const gamma = (k, scale) => {
  let product = 1;
  for (let i = 0; i < k; i += 1) product *= 1 - Math.random();
  return -Math.log(product) * scale;
};

const RADIUS_SAMPLERS = {
  '1s': () => gamma(3, 0.5), // r² e^(-2r)
  '2s': makeRejectionSampler(RADIAL['2s'], 18),
  '2p': () => gamma(5, 1), // r⁴ e^(-r)
  '3s': makeRejectionSampler(RADIAL['3s'], 36),
};

const CSS = `
.ua-atom{position:absolute;inset:0;pointer-events:none;container-type:size;overflow:hidden;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:#e9e4f5}
.ua-atom__card{position:absolute;left:3.2cqw;top:3.2cqw;display:flex;gap:.9em;align-items:flex-start;font-size:clamp(8px,1.45cqw,13px);line-height:1.5;letter-spacing:.06em}
.ua-atom__symbol{border:1px solid currentColor;padding:.25em .55em .15em;text-align:center;min-width:2.6em;opacity:.92}
.ua-atom__symbol small{display:block;font-size:.8em;text-align:left;opacity:.7}
.ua-atom__symbol b{display:block;font-size:2em;line-height:1.1;font-weight:500;font-family:var(--ua-display,system-ui,sans-serif)}
.ua-atom__config{opacity:.8}
.ua-atom__table{position:absolute;right:3.2cqw;bottom:3.2cqw;font-size:clamp(7px,1.25cqw,12px);line-height:1.6;letter-spacing:.06em;text-align:right;white-space:pre}
.ua-atom__table i{display:inline-block;width:.65em;height:.65em;border-radius:50%;margin-right:.5em}
.ua-atom__scale{position:absolute;left:3.2cqw;bottom:3.2cqw;font-size:clamp(7px,1.25cqw,12px);letter-spacing:.06em;opacity:.7}
`;

const vertexShader = /* glsl */ `
uniform float uSize;
uniform float uTime;
uniform float uGrow;
uniform float uView;
attribute vec3 aColor;
attribute float aSeed;
varying vec3 vColor;
varying float vAlpha;
void main(){
  vec4 mv = modelViewMatrix * vec4(position * uGrow, 1.0);
  vec4 centre = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float front = mv.z - centre.z;
  float cut = 1.0;
  if (uView > 1.5) cut = smoothstep(0.11, 0.07, abs(front)) * 2.2;
  else if (uView > 0.5) cut = smoothstep(0.03, -0.03, front);
  // 点をまたたかせて、測るたびに違う場所で見つかる様子を表す。
  float twinkle = 0.6 + 0.4 * sin(uTime * (1.0 + aSeed * 3.0) + aSeed * 60.0);
  vAlpha = cut * twinkle;
  vColor = aColor;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.8, uSize * (0.7 + aSeed * 0.6) / -mv.z);
}
`;

const fragmentShader = /* glsl */ `
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;
void main(){
  float a = smoothstep(0.5, 0.05, length(gl_PointCoord - 0.5)) * vAlpha * uOpacity;
  gl_FragColor = vec4(vColor * a, a);
  #include <colorspace_fragment>
}
`;

function buildCloud(shells, total, colors) {
  const electrons = shells.reduce((sum, shell) => sum + shell.electrons, 0);
  const positions = new Float32Array(total * 3);
  const tints = new Float32Array(total * 3);
  const seeds = new Float32Array(total);
  const radii = new Float32Array(total);
  let index = 0;
  for (const shell of shells) {
    const sampleRadius = RADIUS_SAMPLERS[shell.name];
    const quota = shell === shells.at(-1) ? total - index : Math.round((total * shell.electrons) / electrons);
    const color = colors[shell.name];
    for (let i = 0; i < quota && index < total; i += 1, index += 1) {
      const r = sampleRadius() / shell.zeff;
      let x;
      let y;
      let z;
      const phi = Math.random() * Math.PI * 2;
      if (shell.l === 0) {
        z = Math.random() * 2 - 1;
        const s = Math.sqrt(1 - z * z);
        x = Math.cos(phi) * s;
        y = Math.sin(phi) * s;
      } else {
        // p 軌道は軸に沿って cos²θ で分布する。電子の入っている向きから 1 つ選ぶ。
        let pick = Math.random() * shell.electrons;
        let axisIndex = 0;
        while (pick > shell.axes[axisIndex]) {
          pick -= shell.axes[axisIndex];
          axisIndex += 1;
        }
        const c = Math.cbrt(Math.random() * 2 - 1);
        const s = Math.sqrt(1 - c * c);
        const a = Math.cos(phi) * s;
        const b = Math.sin(phi) * s;
        [x, y, z] = axisIndex === 0 ? [c, a, b] : axisIndex === 1 ? [a, c, b] : [a, b, c];
      }
      positions.set([x * r, y * r, z * r], index * 3);
      const shade = 0.75 + Math.random() * 0.25;
      tints.set([color.r * shade, color.g * shade, color.b * shade], index * 3);
      seeds[index] = Math.random();
      radii[index] = r;
    }
  }
  // 電子の 9 割が入る半径を求め、それが枠に収まるように全体を縮める。
  const sorted = Float32Array.from(radii).sort();
  const r90 = sorted[Math.floor(total * 0.9)] || 1;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(tints, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  return { geometry, r90 };
}

function buildAxes(unit, extent, color) {
  const points = [];
  const tick = 0.035;
  for (let axis = 0; axis < 3; axis += 1) {
    const end = [0, 0, 0];
    end[axis] = extent;
    points.push(-end[0], -end[1], -end[2], end[0], end[1], end[2]);
    // 1 a₀ ごとの目盛り。細かくなりすぎるときは間引く。
    const stride = Math.max(1, Math.ceil(0.12 / unit));
    for (let k = stride; k * unit < extent; k += stride) {
      for (const sign of [-1, 1]) {
        const at = [0, 0, 0];
        at[axis] = k * unit * sign;
        const other = (axis + 1) % 3;
        const a = [...at];
        const b = [...at];
        a[other] -= tick;
        b[other] += tick;
        points.push(...a, ...b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.28 }));
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 40, cameraZ: 7, background: p.background, preview: p.preview });
  const z = ELEMENTS[p.element];
  const shells = electronConfig(z);
  const s = new THREE.Color(p.colorS);
  const colors = {
    '1s': new THREE.Color('#fff1c4'),
    '2s': s,
    '2p': new THREE.Color(p.colorP),
    '3s': s.clone().offsetHSL(-0.22, 0, 0.05),
  };
  const total = Math.round(p.density * 1000 * (p.preview ? 0.4 : 1));
  const { geometry, r90 } = buildCloud(shells, total, colors);
  const FIT = 1.5;
  const unit = FIT / r90; // 1 a₀ が画面上でいくつになるか

  const uniforms = {
    uSize: { value: 1 },
    uTime: { value: 0 },
    uGrow: { value: stage.reduced ? 1 : 0 },
    uView: { value: { cloud: 0, half: 1, section: 2 }[p.view] },
    uOpacity: { value: Math.min(1, 40000 / total) * (p.view === 'cloud' ? 0.6 : 0.9) },
  };
  const cloud = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }),
  );
  cloud.scale.setScalar(unit);
  cloud.frustumCulled = false;

  const nucleus = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  const atom = new THREE.Group();
  atom.add(cloud, nucleus, buildAxes(unit, FIT * 1.45, '#cfc6e8'));
  atom.rotation.set(0.45, 0.6, 0.12);
  const root = new THREE.Group();
  root.add(atom);
  stage.scene.add(root);

  // 説明の表示。
  const config = shells.map((shell) => `${shell.name}${SUPERSCRIPT[shell.electrons]}`).join(' ');
  const rows = shells.map((shell) => {
    const mean = (3 * shell.n * shell.n - shell.l * (shell.l + 1)) / (2 * shell.zeff);
    return h('div', {}, h('i', { style: { background: `#${colors[shell.name].getHexString()}` } }), `${shell.name}  Zeff ${shell.zeff.toFixed(2)}  ⟨r⟩ ${mean.toFixed(2)} a₀`);
  });
  const hud = h(
    'div',
    { class: 'ua-atom' },
    h(
      'div',
      { class: 'ua-atom__card' },
      h('div', { class: 'ua-atom__symbol' }, h('small', { text: String(z) }), h('b', { text: p.element })),
      h('div', { class: 'ua-atom__config' }, h('div', { text: config }), h('div', { text: '|ψ|² の点描' })),
    ),
    p.preview ? null : h('div', { class: 'ua-atom__table' }, rows),
    h('div', { class: 'ua-atom__scale', text: `r₉₀ = ${r90.toFixed(2)} a₀ (${(r90 * 52.9).toFixed(0)} pm)` }),
  );
  container.appendChild(hud);

  stage.onResize(({ height, dpr }) => {
    const view = stage.viewport();
    const scale = Math.min(1.15, view.width / 5.2, view.height / 4.6);
    root.scale.setScalar(scale);
    uniforms.uSize.value = height * dpr * 0.045 * scale;
  });
  stage.onFrame((time, dt) => {
    uniforms.uTime.value = time;
    atom.rotation.y += dt * p.spin;
    root.rotation.x = -stage.pointer.sy * 0.6;
    root.rotation.y = stage.pointer.sx * 0.8;
  });

  if (!stage.reduced) animate(uniforms.uGrow, { value: [0, 1], duration: 1800, ease: 'outExpo' });

  return {
    destroy() {
      utils.remove(uniforms.uGrow);
      hud.remove();
      stage.destroy();
    },
  };
}
