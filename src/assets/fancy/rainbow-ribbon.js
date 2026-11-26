import * as THREE from 'three';
import { animate, spring, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'rainbow-ribbon',
  title: '虹のリボン',
  category: 'fancy',
  libs: ['three', 'animejs'],
  description:
    '6 色の帯でできたリボンが、ポインターのあとをなめらかにうねって追いかけます。触らないあいだは、8 の字などを自動で描き続けます。クリックするとリボンがふくらんで、星の粒が散ります。お祝いのページや、子ども向けサービスの背景に使えます。',
  params: {
    palette: {
      type: 'select',
      label: '配色',
      default: 'pastel',
      options: [
        { value: 'pastel', label: 'パステル' },
        { value: 'candy', label: 'キャンディ' },
        { value: 'sherbet', label: 'シャーベット' },
      ],
    },
    pattern: {
      type: 'select',
      label: '自動で描く形',
      default: 'eight',
      options: [
        { value: 'eight', label: '8 の字' },
        { value: 'circle', label: '円' },
        { value: 'wave', label: '波' },
      ],
    },
    width: { type: 'range', label: '帯の幅', min: 0.2, max: 1.4, step: 0.05, default: 0.7 },
    length: { type: 'range', label: '長さ（秒）', min: 0.6, max: 4, step: 0.1, default: 2.4 },
    speed: { type: 'range', label: '自動の速さ', min: 0.2, max: 3, step: 0.1, default: 1 },
    sparkle: { type: 'boolean', label: '星の粒を出す', default: true },
    background: { type: 'color', label: '背景色', default: '#fff7ee' },
  },
};

const PALETTES = {
  pastel: ['#ff9aa8', '#ffc38a', '#ffe98a', '#9fe6b4', '#8fd0ff', '#c5a8ff'],
  candy: ['#ff5d8f', '#ff9f43', '#ffd93d', '#4cd9a0', '#4aa8ff', '#a06bff'],
  sherbet: ['#ffb3c7', '#ffd6a5', '#fdf6b0', '#c4f0d8', '#bfe3ff', '#e2ccff'],
};

const ribbonVertex = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ribbonFragment = /* glsl */ `
uniform vec3 uColors[6];
uniform float uTime;
uniform float uShadow;
varying vec2 vUv;
void main(){
  float band = clamp(vUv.y * 6.0, 0.0, 5.999);
  vec3 col = uColors[int(floor(band))];
  // 帯の境目に細い影と光を入れて、布の重なりのように見せる。
  float f = fract(band);
  col *= 1.0 - 0.07 * smoothstep(0.85, 1.0, f);
  col += 0.06 * smoothstep(0.2, 0.0, f);
  // ねじれて裏を向いたところは少し暗く、表は光沢を出す。
  float twist = cos(vUv.x * 7.0 - uTime * 2.2);
  col *= mix(0.86, 1.03, smoothstep(-0.6, 0.6, twist));
  col += 0.07 * pow(max(0.0, sin(vUv.x * 26.0 - uTime * 3.0)), 6.0);
  float a = smoothstep(0.0, 0.035, vUv.y) * smoothstep(1.0, 0.965, vUv.y) * smoothstep(1.0, 0.82, vUv.x);
  if (uShadow > 0.5) { gl_FragColor = vec4(0.42, 0.3, 0.5, a * 0.13); }
  else { gl_FragColor = vec4(col, a); }
  #include <colorspace_fragment>
}
`;

const sparkVertex = /* glsl */ `
uniform float uSize;
attribute float aLife;
attribute vec3 aColor;
varying float vLife;
varying vec3 vColor;
void main(){
  vLife = aLife;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * sin(clamp(aLife, 0.0, 1.0) * 3.1416) / -mv.z;
}
`;

const sparkFragment = /* glsl */ `
varying float vLife;
varying vec3 vColor;
void main(){
  if (vLife <= 0.0) discard;
  vec2 q = gl_PointCoord - 0.5;
  // 4 方向にとがった星の形。
  float star = smoothstep(0.022, 0.0, abs(q.x) * abs(q.y)) * smoothstep(0.5, 0.15, length(q));
  float core = smoothstep(0.16, 0.0, length(q));
  float a = max(star, core);
  gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.5), a);
  #include <colorspace_fragment>
}
`;

const SPARKS = 110;

function autoPoint(pattern, t, view, out) {
  const ax = view.width * 0.36;
  const ay = view.height * 0.3;
  if (pattern === 'circle') out.set(Math.cos(t) * Math.min(ax, ay * 1.5), Math.sin(t) * ay);
  else if (pattern === 'wave') out.set(Math.sin(t * 0.5) * ax * 1.05, Math.sin(t * 1.5) * ay * 0.75);
  else out.set(Math.sin(t) * ax, Math.sin(t * 2) * ay * 0.85);
  return out;
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { cameraZ: 6, background: p.background, preview: p.preview });
  const N = p.preview ? 90 : 150;
  const sampleStep = p.length / (N - 1);
  const colors = PALETTES[p.palette].map((hex) => new THREE.Color(hex));
  const view = { width: 1, height: 1, unit: 1 };

  const positions = new Float32Array(N * 2 * 3);
  const uvs = new Float32Array(N * 2 * 2);
  const indices = [];
  for (let i = 0; i < N; i += 1) {
    uvs.set([i / (N - 1), 0, i / (N - 1), 1], i * 4);
    if (i < N - 1) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const uniforms = { uColors: { value: colors }, uTime: { value: 0 }, uShadow: { value: 0 } };
  const shadowUniforms = { uColors: { value: colors }, uTime: uniforms.uTime, uShadow: { value: 1 } };
  const materialOptions = { vertexShader: ribbonVertex, fragmentShader: ribbonFragment, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide };
  const ribbon = new THREE.Mesh(geometry, new THREE.ShaderMaterial({ ...materialOptions, uniforms }));
  const shadow = new THREE.Mesh(geometry, new THREE.ShaderMaterial({ ...materialOptions, uniforms: shadowUniforms }));
  ribbon.frustumCulled = false;
  shadow.frustumCulled = false;
  ribbon.renderOrder = 2;
  shadow.renderOrder = 1;
  stage.scene.add(shadow, ribbon);

  const sparkPos = new Float32Array(SPARKS * 3);
  const sparkVel = new Float32Array(SPARKS * 2);
  const sparkLife = new Float32Array(SPARKS);
  const sparkColor = new Float32Array(SPARKS * 3);
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sparkGeometry.setAttribute('aLife', new THREE.BufferAttribute(sparkLife, 1));
  sparkGeometry.setAttribute('aColor', new THREE.BufferAttribute(sparkColor, 3));
  const sparkUniforms = { uSize: { value: 1 } };
  const sparks = new THREE.Points(
    sparkGeometry,
    new THREE.ShaderMaterial({ uniforms: sparkUniforms, vertexShader: sparkVertex, fragmentShader: sparkFragment, transparent: true, depthWrite: false, depthTest: false }),
  );
  sparks.frustumCulled = false;
  sparks.renderOrder = 3;
  stage.scene.add(sparks);
  let sparkCursor = 0;

  function emit(x, y, force) {
    const k = sparkCursor;
    sparkCursor = (sparkCursor + 1) % SPARKS;
    const angle = Math.random() * Math.PI * 2;
    const color = colors[Math.floor(Math.random() * colors.length)];
    sparkPos.set([x, y, 0], k * 3);
    sparkVel.set([Math.cos(angle) * force, Math.sin(angle) * force], k * 2);
    sparkColor.set([color.r, color.g, color.b], k * 3);
    sparkLife[k] = 1;
    sparkGeometry.attributes.aColor.needsUpdate = true;
  }

  // 先頭が通った位置を一定の間隔で覚えておき、それを結んでリボンにする。
  const history = new Float32Array(N * 2);
  const head = new THREE.Vector2();
  const target = new THREE.Vector2();
  const scratch = new THREE.Vector2();
  const state = { reveal: stage.reduced ? 1 : 0, pulse: 0 };
  let autoTime = 2.2;
  let sampleClock = 0;
  let sparkClock = 0;
  let activeUntil = -1;
  let filled = false;

  function prefill() {
    for (let i = 0; i < N; i += 1) {
      autoPoint(p.pattern, autoTime - i * sampleStep * 1.6 * p.speed, view, scratch);
      history[i * 2] = scratch.x;
      history[i * 2 + 1] = scratch.y;
    }
    head.set(history[0], history[1]);
    filled = true;
  }

  function build(time) {
    const half = (p.width * view.unit * state.reveal * (1 + state.pulse * 0.7)) / 2;
    let nx = 0;
    let ny = 1;
    for (let i = 0; i < N; i += 1) {
      const a = Math.max(0, i - 1);
      const b = Math.min(N - 1, i + 1);
      const tx = history[a * 2] - history[b * 2];
      const ty = history[a * 2 + 1] - history[b * 2 + 1];
      const len = Math.hypot(tx, ty);
      if (len > 1e-5) {
        nx = -ty / len;
        ny = tx / len;
      }
      const u = i / (N - 1);
      const taper = Math.sqrt(Math.min(1, u / 0.035)) * (1 - u) ** 0.55;
      const w = half * taper * (0.62 + 0.38 * Math.cos(u * 7 - time * 2.2));
      const wave = Math.sin(u * 9 - time * 3.2) * 0.07 * view.unit * u;
      const cx = history[i * 2] + nx * wave;
      const cy = history[i * 2 + 1] + ny * wave;
      positions.set([cx + nx * w, cy + ny * w, 0, cx - nx * w, cy - ny * w, 0], i * 6);
    }
    geometry.attributes.position.needsUpdate = true;
  }

  stage.onResize(({ height, dpr }) => {
    const v = stage.viewport();
    view.width = v.width;
    view.height = v.height;
    view.unit = Math.min(v.width, v.height) / 4.4;
    sparkUniforms.uSize.value = height * dpr * 0.3;
    shadow.position.set(view.unit * 0.06, -view.unit * 0.09, 0);
    if (!filled || stage.reduced) prefill();
  });

  stage.onFrame((time, dt) => {
    uniforms.uTime.value = time;
    if (stage.pointer.inside && stage.pointer.speed > 0.02) activeUntil = time + 1.4;
    const following = time < activeUntil;
    if (following) target.set((stage.pointer.x * view.width) / 2, (stage.pointer.y * view.height) / 2);
    else {
      autoTime += dt * 1.6 * p.speed;
      autoPoint(p.pattern, autoTime, view, target);
    }
    const prevX = head.x;
    const prevY = head.y;
    head.lerp(target, 1 - Math.exp(-dt * (following ? 9 : 14)));

    sampleClock += dt;
    let steps = Math.min(N, Math.floor(sampleClock / sampleStep));
    sampleClock -= steps * sampleStep;
    if (steps > 0) {
      history.copyWithin(steps * 2, 0, (N - steps) * 2);
      for (let k = 0; k < steps; k += 1) {
        // 新しいものほど先頭に近い。1 フレームに何個も足すときは、あいだを補う。
        const f = 1 - k / steps;
        history[k * 2] = prevX + (head.x - prevX) * f;
        history[k * 2 + 1] = prevY + (head.y - prevY) * f;
      }
      steps = 0;
    }
    history[0] = head.x;
    history[1] = head.y;
    build(time);

    if (p.sparkle && dt > 0) {
      sparkClock += dt;
      if (sparkClock > (p.preview ? 0.09 : 0.05)) {
        sparkClock = 0;
        const j = 4 + Math.floor(Math.random() * 30);
        emit(history[j * 2], history[j * 2 + 1], view.unit * (0.3 + Math.random() * 0.5));
      }
      for (let k = 0; k < SPARKS; k += 1) {
        if (sparkLife[k] <= 0) continue;
        sparkLife[k] -= dt * 0.9;
        sparkVel[k * 2 + 1] -= dt * view.unit * 0.5;
        sparkPos[k * 3] += sparkVel[k * 2] * dt;
        sparkPos[k * 3 + 1] += sparkVel[k * 2 + 1] * dt;
      }
      sparkGeometry.attributes.position.needsUpdate = true;
      sparkGeometry.attributes.aLife.needsUpdate = true;
    }
  });

  if (!stage.reduced) animate(state, { reveal: [0, 1], delay: 150, ease: spring({ stiffness: 90, damping: 9 }) });

  function puff() {
    if (stage.reduced) return;
    animate(state, {
      pulse: [
        { to: 1, duration: 140, ease: 'outQuad' },
        { to: 0, duration: 1100, ease: 'outElastic(1, .4)' },
      ],
    });
    if (!p.sparkle) return;
    for (let i = 0; i < 22; i += 1) {
      const j = Math.floor(Math.random() * 50);
      emit(history[j * 2], history[j * 2 + 1], view.unit * (0.8 + Math.random() * 1.6));
    }
  }
  container.addEventListener('click', puff);
  const autoPuff = p.preview ? setInterval(puff, 3200) : 0;

  return {
    puff,
    destroy() {
      clearInterval(autoPuff);
      container.removeEventListener('click', puff);
      utils.remove(state);
      stage.destroy();
    },
  };
}
