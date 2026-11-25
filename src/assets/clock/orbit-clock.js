import * as THREE from 'three';
import { animate, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { h } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'orbit-clock',
  title: '軌道の時計',
  category: 'clock',
  libs: ['three', 'animejs'],
  description:
    '時・分・秒を、太陽のまわりを回る 3 つの星で表す時計です。内側の輪が時、中の輪が分、外の輪が秒で、12 時の位置から星までの軌道が明るく光ります。秒の星は 1 秒ごとに弾むように進みます。',
  params: {
    colorHour: { type: 'color', label: '時の星の色', default: '#ffb347' },
    colorMinute: { type: 'color', label: '分の星の色', default: '#7de3ff' },
    colorSecond: { type: 'color', label: '秒の星の色', default: '#ff5c8a' },
    background: { type: 'color', label: '背景色', default: '#060714' },
    tilt: { type: 'range', label: '傾き', min: 0, max: 1.3, step: 0.05, default: 0.85 },
    readout: { type: 'boolean', label: '数字でも表示する', default: true },
  },
};

const RINGS = [
  { key: 'hour', radius: 1.0, ticks: 12 },
  { key: 'minute', radius: 1.6, ticks: 60 },
  { key: 'second', radius: 2.2, ticks: 60 },
];
const SEGMENTS = 240;

const ringVertex = /* glsl */ `
attribute float aFrac;
varying float vFrac;
void main(){
  vFrac = aFrac;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const ringFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uProgress;
varying float vFrac;
void main(){
  float passed = step(vFrac, uProgress);
  float head = smoothstep(0.08, 0.0, uProgress - vFrac) * passed;
  float a = mix(0.3, 1.0, passed) + head * 0.8;
  gl_FragColor = vec4(uColor * a, a);
  #include <colorspace_fragment>
}
`;
const glowVertex = /* glsl */ `
uniform float uSize;
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
void main(){
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * aSize / -mv.z;
}
`;
const glowFragment = /* glsl */ `
varying vec3 vColor;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float core = smoothstep(0.16, 0.1, d);
  float halo = pow(smoothstep(0.5, 0.0, d), 2.5);
  float a = core + halo * 0.7;
  gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.55) * a, a);
  #include <colorspace_fragment>
}
`;

// 12 時の位置を 0 として、時計回りに進んだ割合（0〜1）から座標を求める。
const onRing = (radius, frac) => {
  const a = Math.PI / 2 - frac * Math.PI * 2;
  return [Math.cos(a) * radius, Math.sin(a) * radius, 0];
};

// 時・分・秒の進み具合を、それぞれ 0〜1 で返す。
export function orbitFractions(date) {
  const s = date.getSeconds() + date.getMilliseconds() / 1000;
  const m = date.getMinutes() + s / 60;
  const hr = (date.getHours() % 12) + m / 60;
  return { hour: hr / 12, minute: m / 60, second: Math.floor(s) / 60 };
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 40, cameraZ: 6.8, background: p.background, preview: p.preview });
  const colors = { hour: new THREE.Color(p.colorHour), minute: new THREE.Color(p.colorMinute), second: new THREE.Color(p.colorSecond) };
  const system = new THREE.Group();
  stage.scene.add(system);

  const rings = RINGS.map(({ key, radius, ticks }) => {
    const positions = new Float32Array((SEGMENTS + 1) * 3);
    const fracs = new Float32Array(SEGMENTS + 1);
    for (let i = 0; i <= SEGMENTS; i += 1) {
      positions.set(onRing(radius, i / SEGMENTS), i * 3);
      fracs[i] = i / SEGMENTS;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aFrac', new THREE.BufferAttribute(fracs, 1));
    const uniforms = { uColor: { value: colors[key] }, uProgress: { value: 0 } };
    system.add(new THREE.Line(geometry, new THREE.ShaderMaterial({ uniforms, vertexShader: ringVertex, fragmentShader: ringFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));

    const tickPositions = new Float32Array(ticks * 3);
    for (let i = 0; i < ticks; i += 1) tickPositions.set(onRing(radius, i / ticks), i * 3);
    const tickGeometry = new THREE.BufferGeometry();
    tickGeometry.setAttribute('position', new THREE.BufferAttribute(tickPositions, 3));
    system.add(new THREE.Points(tickGeometry, new THREE.PointsMaterial({ color: colors[key], size: ticks === 12 ? 5 : 3, sizeAttenuation: false, transparent: true, opacity: 0.6, depthWrite: false })));
    return { key, radius, uniforms };
  });

  // 太陽と 3 つの星。4 つの光る点として描く。
  const bodyPositions = new Float32Array(4 * 3);
  const bodyColors = new Float32Array(4 * 3);
  const sun = new THREE.Color('#fff2cf');
  [sun, colors.hour, colors.minute, colors.second].forEach((color, i) => bodyColors.set([color.r, color.g, color.b], i * 3));
  const bodyGeometry = new THREE.BufferGeometry();
  const bodyAttribute = new THREE.BufferAttribute(bodyPositions, 3);
  bodyGeometry.setAttribute('position', bodyAttribute);
  bodyGeometry.setAttribute('aColor', new THREE.BufferAttribute(bodyColors, 3));
  bodyGeometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array([2.6, 1.5, 1.2, 0.9]), 1));
  const glowUniforms = { uSize: { value: 1 } };
  const bodies = new THREE.Points(bodyGeometry, new THREE.ShaderMaterial({ uniforms: glowUniforms, vertexShader: glowVertex, fragmentShader: glowFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  bodies.frustumCulled = false;
  system.add(bodies);

  const starPositions = new Float32Array(260 * 3).map(() => (Math.random() - 0.5) * 30);
  for (let i = 2; i < starPositions.length; i += 3) starPositions[i] = -6 - Math.random() * 8;
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  stage.scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.5, depthWrite: false })));

  const readout = p.readout
    ? h('p', {
        role: 'timer',
        style: {
          position: 'absolute', left: '0', right: '0', bottom: '6%', margin: '0', textAlign: 'center', pointerEvents: 'none',
          color: '#f3f4ff', fontFamily: 'var(--ua-display, system-ui, sans-serif)', fontWeight: '700', letterSpacing: '0.08em',
          fontVariantNumeric: 'tabular-nums', fontSize: 'clamp(12px, 3.2vmin, 28px)',
        },
      })
    : null;
  if (readout) container.appendChild(readout);

  // 秒の星は、整数の秒へ弾みながら進める。0 秒へ戻るときに逆回りしないよう、通し番号で持つ。
  const state = { second: 0 };
  let lastSecond = -1;
  let secondBase = 0;

  stage.onResize(({ height, dpr }) => {
    glowUniforms.uSize.value = height * dpr * 0.3;
    const view = stage.viewport();
    system.scale.setScalar(Math.min(1, view.width / 5.2, view.height / 4.2));
  });
  stage.onFrame(() => {
    const now = new Date();
    const fractions = orbitFractions(now);
    const second = now.getSeconds();
    if (second !== lastSecond) {
      if (lastSecond !== -1 && second < lastSecond) secondBase += 60;
      const target = secondBase + second;
      if (lastSecond === -1 || stage.reduced) state.second = target;
      else animate(state, { second: target, duration: 520, ease: 'outBack(3)' });
      lastSecond = second;
      if (readout) readout.textContent = [now.getHours(), now.getMinutes(), second].map((n) => String(n).padStart(2, '0')).join(':');
    }
    const shown = { hour: fractions.hour, minute: fractions.minute, second: (((state.second % 60) + 60) % 60) / 60 };
    rings.forEach((ring, index) => {
      ring.uniforms.uProgress.value = shown[ring.key];
      bodyPositions.set(onRing(ring.radius, shown[ring.key]), (index + 1) * 3);
    });
    bodyAttribute.needsUpdate = true;
    system.rotation.x = -p.tilt + stage.pointer.sy * 0.25;
    system.rotation.y = stage.pointer.sx * 0.35;
  });

  return {
    destroy() {
      utils.remove(state);
      readout?.remove();
      stage.destroy();
    },
  };
}
