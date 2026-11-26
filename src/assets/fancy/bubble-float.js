import * as THREE from 'three';
import { animate, spring, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { fullscreenVertex } from '../../lib/glsl.js';

export const meta = {
  id: 'bubble-float',
  title: 'しゃぼん玉',
  category: 'fancy',
  libs: ['three', 'animejs'],
  description:
    '虹色に光るしゃぼん玉が、ゆらゆら揺れながら上がっていきます。膜の色はシェーダーで作っていて、時間とともに流れます。クリックすると弾けて、しぶきが飛びます。春の特集や子ども用品の紹介、やさしい印象の背景に使えます。',
  params: {
    count: { type: 'range', label: '玉の数', min: 6, max: 40, step: 1, default: 20 },
    size: { type: 'range', label: '玉の大きさ', min: 0.5, max: 1.8, step: 0.05, default: 1 },
    speed: { type: 'range', label: '上がる速さ', min: 0, max: 3, step: 0.1, default: 1 },
    iridescence: { type: 'range', label: '虹色の強さ', min: 0, max: 1, step: 0.05, default: 0.8 },
    skyTop: { type: 'color', label: '空の上の色', default: '#9fd8f5' },
    skyBottom: { type: 'color', label: '空の下の色', default: '#ffd6e6' },
  },
};

const skyFragment = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec2 uRes;
uniform vec2 uPointer;
uniform float uTime;
varying vec2 vUv;
void main(){
  float aspect = uRes.x / uRes.y;
  vec2 uv = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);
  vec3 col = mix(uBottom, uTop, smoothstep(0.0, 1.0, vUv.y + sin(vUv.x * 3.0 + uTime * 0.2) * 0.04));
  // やわらかい日だまり。ポインターに少しついてくる。
  vec2 sun = vec2(-0.32 * aspect, 0.3) + uPointer * 0.06;
  col = mix(col, vec3(1.0, 0.98, 0.9), 0.5 * smoothstep(0.75, 0.0, length(uv - sun)));
  col = mix(col, vec3(1.0), 0.22 * smoothstep(0.5, 0.0, length(uv - vec2(0.4 * aspect, -0.42))));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const bubbleVertex = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// 薄い膜の色。膜の厚みを場所と時間で変え、厚みに応じて色相を回す。
const bubbleFragment = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uPop;
uniform float uIri;
varying vec2 vUv;
void main(){
  vec2 q = vUv * 2.0 - 1.0;
  float r = length(q);
  if (r > 1.0) discard;
  float z = sqrt(1.0 - r * r);
  float fres = pow(1.0 - z, 1.5);
  float swirl = sin(q.x * 3.1 + uTime * 0.7 + uSeed * 6.0) * cos(q.y * 2.7 - uTime * 0.5 + uSeed * 3.0);
  float thick = 0.9 - q.y * 0.35 + swirl * 0.3 + fres * 0.9 + uSeed;
  vec3 film = 0.5 + 0.5 * cos(6.2832 * (thick * 1.25 + vec3(0.0, 0.33, 0.67)));
  film = mix(vec3(1.0), film, uIri);
  film = mix(film, vec3(1.0), 0.3);
  float a = mix(0.1, 0.92, fres);
  float h1 = smoothstep(0.24, 0.02, length((q - vec2(-0.4, 0.44)) * vec2(1.0, 1.5)));
  float h2 = smoothstep(0.12, 0.0, length(q - vec2(0.4, -0.5))) * 0.7;
  float arc = smoothstep(0.05, 0.0, abs(r - 0.8)) * smoothstep(0.2, 0.9, dot(normalize(q + 0.0001), vec2(0.6, -0.8))) * 0.5;
  float hi = max(h1, max(h2, arc));
  vec3 col = mix(film, vec3(1.0), hi);
  a = max(a, hi * 0.95);
  float edge = smoothstep(1.0, 0.95, r);
  float ring = mix(1.0, smoothstep(0.72, 0.98, r), uPop);
  gl_FragColor = vec4(col, a * edge * ring * (1.0 - uPop));
  #include <colorspace_fragment>
}
`;

const dropVertex = /* glsl */ `
uniform float uSize;
attribute float aLife;
attribute float aHue;
varying float vLife;
varying float vHue;
void main(){
  vLife = aLife;
  vHue = aHue;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.4 + aHue * 0.6) * smoothstep(0.0, 0.3, aLife) / -mv.z;
}
`;

const dropFragment = /* glsl */ `
varying float vLife;
varying float vHue;
void main(){
  if (vLife <= 0.0) discard;
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.36, d);
  vec3 tint = 0.5 + 0.5 * cos(6.2832 * (vHue + vec3(0.0, 0.33, 0.67)));
  vec3 col = mix(vec3(1.0), tint, 0.35 + 0.4 * smoothstep(0.2, 0.5, d));
  gl_FragColor = vec4(col, a * min(1.0, vLife * 2.0) * 0.95);
  #include <colorspace_fragment>
}
`;

const DROPS = 180;
const DROPS_PER_POP = 16;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { cameraZ: 6, preview: p.preview, startTime: 8 });
  const count = Math.round(p.preview ? Math.min(p.count, 14) : p.count);

  const skyUniforms = {
    uTop: { value: new THREE.Color(p.skyTop) },
    uBottom: { value: new THREE.Color(p.skyBottom) },
    uRes: { value: new THREE.Vector2(1, 1) },
    uPointer: { value: new THREE.Vector2() },
    uTime: { value: 0 },
  };
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms: skyUniforms, vertexShader: fullscreenVertex, fragmentShader: skyFragment, depthTest: false, depthWrite: false }),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  stage.scene.add(sky);

  const quad = new THREE.PlaneGeometry(2, 2);
  const view = { width: 1, height: 1, unit: 1 };
  const bubbles = Array.from({ length: count }, (_, index) => {
    const uniforms = {
      uTime: { value: 0 },
      uSeed: { value: Math.random() },
      uPop: { value: 0 },
      uIri: { value: p.iridescence },
    };
    const mesh = new THREE.Mesh(
      quad,
      new THREE.ShaderMaterial({ uniforms, vertexShader: bubbleVertex, fragmentShader: bubbleFragment, transparent: true, depthWrite: false, depthTest: false }),
    );
    mesh.frustumCulled = false;
    stage.scene.add(mesh);
    return {
      mesh,
      uniforms,
      u: ((index + 0.5) / count - 0.5) * 1.05 + (Math.random() - 0.5) * 0.08,
      v: (index * 0.618) % 1,
      z: -1.6 + Math.random() * 2.2,
      radius: 0.2 + Math.random() ** 1.6 * 0.42,
      rise: 0.035 + Math.random() * 0.04,
      phase: Math.random() * 20,
      grow: { v: stage.reduced ? 1 : 0 },
      popping: false,
    };
  });
  // 大きい玉を手前に描く。
  [...bubbles].sort((a, b) => a.z - b.z).forEach((bubble, order) => {
    bubble.mesh.renderOrder = order;
  });

  const dropPos = new Float32Array(DROPS * 3);
  const dropVel = new Float32Array(DROPS * 3);
  const dropLife = new Float32Array(DROPS);
  const dropHue = new Float32Array(DROPS).map(() => Math.random());
  const dropGeometry = new THREE.BufferGeometry();
  dropGeometry.setAttribute('position', new THREE.BufferAttribute(dropPos, 3));
  dropGeometry.setAttribute('aLife', new THREE.BufferAttribute(dropLife, 1));
  dropGeometry.setAttribute('aHue', new THREE.BufferAttribute(dropHue, 1));
  const dropUniforms = { uSize: { value: 1 } };
  const drops = new THREE.Points(
    dropGeometry,
    new THREE.ShaderMaterial({ uniforms: dropUniforms, vertexShader: dropVertex, fragmentShader: dropFragment, transparent: true, depthWrite: false, depthTest: false }),
  );
  drops.frustumCulled = false;
  drops.renderOrder = 999;
  stage.scene.add(drops);
  let dropCursor = 0;
  let dropsAlive = false;

  function place(bubble, time) {
    const r = bubble.radius * p.size * view.unit;
    const span = view.height + r * 2.4;
    const y = (bubble.v - 0.5) * span;
    const sway = Math.sin(time * 0.6 + bubble.phase) * 0.22 + Math.sin(time * 1.3 + bubble.phase * 2.0) * 0.07;
    bubble.mesh.position.set(bubble.u * view.width + sway * view.unit, y, bubble.z);
    const wobble = Math.sin(time * 2.1 + bubble.phase) * 0.04;
    const s = r * bubble.grow.v * (1 + bubble.uniforms.uPop.value * 0.35);
    bubble.mesh.scale.set(s * (1 + wobble), s * (1 - wobble), 1);
    bubble.uniforms.uTime.value = time;
  }

  function respawn(bubble) {
    bubble.v = -0.02;
    bubble.u = (Math.random() - 0.5) * 1.05;
    bubble.uniforms.uPop.value = 0;
    bubble.uniforms.uSeed.value = Math.random();
    bubble.popping = false;
    bubble.grow.v = 1;
  }

  function pop(bubble) {
    if (!bubble || bubble.popping || stage.reduced) return;
    bubble.popping = true;
    const { x, y, z } = bubble.mesh.position;
    const r = bubble.mesh.scale.x;
    for (let i = 0; i < DROPS_PER_POP; i += 1) {
      const k = dropCursor;
      dropCursor = (dropCursor + 1) % DROPS;
      const angle = (i / DROPS_PER_POP) * Math.PI * 2 + Math.random() * 0.4;
      const force = (1.2 + Math.random() * 1.6) * (0.5 + r);
      dropPos.set([x + Math.cos(angle) * r * 0.85, y + Math.sin(angle) * r * 0.85, z], k * 3);
      dropVel.set([Math.cos(angle) * force, Math.sin(angle) * force + 0.6, 0], k * 3);
      dropLife[k] = 0.7 + Math.random() * 0.5;
    }
    dropsAlive = true;
    animate(bubble.uniforms.uPop, { value: [0, 1], duration: 320, ease: 'outQuad', onComplete: () => respawn(bubble) });
  }

  // クリックした位置にいちばん近い玉を探す。画面上の距離で比べる。
  const projected = new THREE.Vector3();
  function pick(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    const fovScale = 2 * Math.tan(THREE.MathUtils.degToRad(stage.camera.fov) / 2);
    let best = null;
    let bestDistance = Infinity;
    for (const bubble of bubbles) {
      if (bubble.popping) continue;
      projected.copy(bubble.mesh.position).project(stage.camera);
      const px = (projected.x * 0.5 + 0.5) * rect.width;
      const py = (-projected.y * 0.5 + 0.5) * rect.height;
      const depth = stage.camera.position.z - bubble.mesh.position.z;
      const radiusPx = (bubble.mesh.scale.x / (fovScale * depth)) * rect.height;
      const distance = Math.hypot(clientX - rect.left - px, clientY - rect.top - py) / Math.max(radiusPx, 14);
      if (distance < 1.15 && distance < bestDistance) {
        best = bubble;
        bestDistance = distance;
      }
    }
    return best;
  }
  const onClick = (event) => pop(pick(event.clientX, event.clientY));
  container.addEventListener('click', onClick);
  container.style.cursor = 'pointer';

  stage.onResize(({ width, height, dpr }) => {
    const v = stage.viewport();
    view.width = v.width;
    view.height = v.height;
    view.unit = Math.min(v.height, v.width * 0.9) / 3.4;
    skyUniforms.uRes.value.set(width, height);
    dropUniforms.uSize.value = height * dpr * 0.16;
  });

  stage.onFrame((time, dt) => {
    skyUniforms.uTime.value = time;
    skyUniforms.uPointer.value.set(stage.pointer.sx, stage.pointer.sy);
    for (const bubble of bubbles) {
      if (!bubble.popping) {
        bubble.v += dt * bubble.rise * p.speed;
        if (bubble.v > 1.02) respawn(bubble);
      }
      place(bubble, time);
      // ポインターが近いと、少し押しのけられる。
      if (stage.pointer.inside) {
        const dx = bubble.mesh.position.x - (stage.pointer.sx * view.width) / 2;
        const dy = bubble.mesh.position.y - (stage.pointer.sy * view.height) / 2;
        const push = Math.max(0, 1 - Math.hypot(dx, dy) / (view.unit * 1.4)) * 0.18 * view.unit;
        bubble.mesh.position.x += Math.sign(dx) * push;
      }
    }
    if (dropsAlive) {
      dropsAlive = false;
      for (let k = 0; k < DROPS; k += 1) {
        if (dropLife[k] <= 0) continue;
        dropLife[k] -= dt;
        dropVel[k * 3 + 1] -= dt * 4.2;
        dropPos[k * 3] += dropVel[k * 3] * dt;
        dropPos[k * 3 + 1] += dropVel[k * 3 + 1] * dt;
        dropsAlive = true;
      }
      dropGeometry.attributes.position.needsUpdate = true;
      dropGeometry.attributes.aLife.needsUpdate = true;
    }
  });

  const grows = bubbles.map((bubble) => bubble.grow);
  if (!stage.reduced) {
    animate(grows, { v: [0, 1], delay: stagger(60, { start: 150 }), ease: spring({ stiffness: 120, damping: 8 }) });
  }

  // 一覧では、画面の中ほどにいる玉を順に弾けさせる。
  const autoPop = p.preview
    ? setInterval(() => {
        const candidates = bubbles.filter((bubble) => !bubble.popping && bubble.v > 0.3 && bubble.v < 0.75);
        pop(candidates[Math.floor(Math.random() * candidates.length)]);
      }, 1500)
    : 0;

  return {
    pop: () => pop(bubbles.find((bubble) => !bubble.popping && bubble.v > 0.25 && bubble.v < 0.8)),
    destroy() {
      clearInterval(autoPop);
      container.removeEventListener('click', onClick);
      container.style.cursor = '';
      utils.remove([...grows, ...bubbles.map((bubble) => bubble.uniforms.uPop)]);
      stage.destroy();
    },
  };
}
