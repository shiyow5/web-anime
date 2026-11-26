import * as THREE from 'three';
import { animate, createTimer, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'particle-clock',
  title: '粒の時計',
  category: 'clock',
  libs: ['three', 'animejs'],
  description:
    '現在の時刻を、粒の集まりで表示します。数字が変わる桁だけ、粒がいったん散ってから次の数字に組み替わります。ポインターを近づけると粒が逃げます。タップすると、粒が触った点へいったん吸い寄せられてから渦を巻いて弾け飛び、近い桁から順に今の時刻へ組み直されます。',
  params: {
    seconds: { type: 'boolean', label: '秒を表示する', default: true },
    count: { type: 'range', label: '粒の数', min: 4000, max: 60000, step: 2000, default: 28000 },
    colorA: { type: 'color', label: '色 A', default: '#f6f1ff' },
    colorB: { type: 'color', label: '色 B', default: '#7cf5d2' },
    background: { type: 'color', label: '背景色', default: '#0b1020' },
  },
};

const MAX_SLOTS = 8;
const SLOT_WIDTH = 0.26;
const CELL_W = 96;
const CELL_H = 144;
const CHAR_HEIGHT = 0.39;
const FONT_STACK = '"Bricolage Grotesque Variable", "Helvetica Neue", Arial, system-ui, sans-serif';

const pad = (n) => String(n).padStart(2, '0');

// 表示する文字列を返す。秒を出すときは「12:34:56」、出さないときは「12:34」。
export function clockText(date, seconds = true) {
  const parts = [pad(date.getHours()), pad(date.getMinutes())];
  if (seconds) parts.push(pad(date.getSeconds()));
  return parts.join(':');
}

// 1 文字をキャンバスに描き、塗られた画素から n 個の点を選んで out に書き込む。
function sampleChar(char, n, out, offset, centerX) {
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W;
  canvas.height = CELL_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.font = `800 ${CELL_H * 0.86}px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(char, CELL_W / 2, CELL_H / 2 + CELL_H * 0.03, CELL_W * 0.96);
  const { data } = ctx.getImageData(0, 0, CELL_W, CELL_H);
  const filled = [];
  for (let y = 0; y < CELL_H; y += 1) {
    for (let x = 0; x < CELL_W; x += 1) {
      if (data[(y * CELL_W + x) * 4 + 3] > 128) filled.push(x, y);
    }
  }
  const total = filled.length / 2;
  for (let i = 0; i < n; i += 1) {
    const k = total ? Math.floor(Math.random() * total) * 2 : 0;
    const px = total ? filled[k] + Math.random() : CELL_W / 2;
    const py = total ? filled[k + 1] + Math.random() : CELL_H / 2;
    out[offset + i * 3] = centerX + (px / CELL_W - 0.5) * SLOT_WIDTH;
    out[offset + i * 3 + 1] = -(py / CELL_H - 0.5) * CHAR_HEIGHT;
    out[offset + i * 3 + 2] = (Math.random() - 0.5) * 0.02;
  }
}

const vertexShader = /* glsl */ `
uniform float uMix[${MAX_SLOTS}];
uniform float uTime;
uniform float uScale;
uniform float uSize;
uniform float uHover;
uniform vec2 uPointer;
uniform vec2 uTap;
uniform float uBlast[${MAX_SLOTS}];
attribute vec3 aTo;
attribute vec4 aRand;
attribute float aSlot;
varying float vTint;
varying float vBurst;
void main(){
  float m = uMix[int(aSlot)];
  float t = clamp(m * 1.4 - aRand.x * 0.4, 0.0, 1.0);
  t = t * t * (3.0 - 2.0 * t);
  vec3 p = mix(position, aTo, t) * uScale;
  float burst = sin(t * 3.14159265);
  p += (aRand.yzw - 0.5) * burst * 0.7;
  p.xy += vec2(sin(uTime * 1.4 + aRand.y * 40.0), cos(uTime * 1.1 + aRand.z * 40.0)) * 0.005;
  // タップ。負の値で触った点へ吸い寄せ、正の値で渦を巻きながら外へ飛ばす。
  float b = uBlast[int(aSlot)];
  vec2 off = p.xy - uTap;
  float ang = b * (aRand.z - 0.3) * 2.6;
  off = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * off;
  off += normalize(off + 0.0001) * b * (0.25 + aRand.y * 1.5);
  off *= 1.0 + min(b, 0.0) * 0.7;
  p.xy = uTap + off;
  p.z += (aRand.w - 0.5) * max(b, 0.0) * 2.4;
  vec2 away = p.xy - uPointer;
  float push = smoothstep(0.7, 0.0, length(away)) * uHover;
  p.xy += normalize(away + 0.0001) * push * 0.35;
  p.z += push * 0.4;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.6 + aRand.w * 0.9) / -mv.z;
  vTint = aRand.x;
  vBurst = burst + push + abs(b);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
varying float vTint;
varying float vBurst;
void main(){
  float a = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5));
  vec3 col = mix(uColorA, uColorB, clamp(step(0.7, vTint) + vBurst * 0.9, 0.0, 1.0));
  gl_FragColor = vec4(col, a * 0.9);
  #include <colorspace_fragment>
}
`;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { cameraZ: 6, background: p.background, preview: p.preview, antialias: false });
  const slots = p.seconds ? 8 : 5;
  const perSlot = Math.floor((p.preview ? Math.min(p.count, 14000) : p.count) / slots);
  const count = perSlot * slots;
  const slotCenter = (slot) => (slot - (slots - 1) / 2) * SLOT_WIDTH;

  const from = new Float32Array(count * 3);
  const to = new Float32Array(count * 3);
  const slotIds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.3 + Math.random() * 0.9;
    from.set([Math.cos(a) * r, Math.sin(a) * r * 0.5, (Math.random() - 0.5) * 1.2], i * 3);
    slotIds[i] = Math.floor(i / perSlot);
  }
  const geometry = new THREE.BufferGeometry();
  const fromAttr = new THREE.BufferAttribute(from, 3);
  const toAttr = new THREE.BufferAttribute(to, 3);
  geometry.setAttribute('position', fromAttr);
  geometry.setAttribute('aTo', toAttr);
  geometry.setAttribute('aSlot', new THREE.BufferAttribute(slotIds, 1));
  geometry.setAttribute('aRand', new THREE.BufferAttribute(new Float32Array(count * 4).map(() => Math.random()), 4));

  const mixes = Array.from({ length: MAX_SLOTS }, () => ({ v: stage.reduced ? 1 : 0 }));
  const blasts = Array.from({ length: MAX_SLOTS }, () => ({ v: 0 }));
  const uniforms = {
    uMix: { value: mixes.map((m) => m.v) },
    uTime: { value: 0 },
    uScale: { value: 1 },
    uSize: { value: 1 },
    uHover: { value: 0 },
    uPointer: { value: new THREE.Vector2() },
    uTap: { value: new THREE.Vector2() },
    uBlast: { value: new Array(MAX_SLOTS).fill(0) },
    uColorA: { value: new THREE.Color(p.colorA) },
    uColorB: { value: new THREE.Color(p.colorB) },
  };
  const points = new THREE.Points(geometry, new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false }));
  points.frustumCulled = false;
  stage.scene.add(points);

  let shown = '';
  let ready = false;
  let destroyed = false;

  // 文字が変わった桁だけ、いまの並びを出発点に移して、次の数字を行き先にする。
  function update(text, force = false) {
    for (let slot = 0; slot < slots; slot += 1) {
      if (!force && text[slot] === shown[slot]) continue;
      const offset = slot * perSlot * 3;
      const length = perSlot * 3;
      if (!force) from.set(to.subarray(offset, offset + length), offset);
      sampleChar(text[slot], perSlot, to, offset, slotCenter(slot));
      const mix = mixes[slot];
      if (stage.reduced) {
        mix.v = 1;
      } else {
        mix.v = 0;
        animate(mix, { v: 1, duration: force ? 1800 : 900, delay: force ? slot * 90 : 0, ease: 'inOutQuart' });
      }
    }
    fromAttr.needsUpdate = true;
    toAttr.needsUpdate = true;
    shown = text;
  }

  stage.onResize(({ height, dpr }) => {
    const view = stage.viewport();
    uniforms.uScale.value = Math.min((view.width * 0.9) / (slots * SLOT_WIDTH), (view.height * 0.6) / CHAR_HEIGHT);
    uniforms.uSize.value = height * dpr * 0.03;
  });
  stage.onFrame((time, dt) => {
    const view = stage.viewport();
    uniforms.uTime.value = time;
    mixes.forEach((mix, i) => {
      uniforms.uMix.value[i] = mix.v;
      uniforms.uBlast.value[i] = blasts[i].v;
    });
    uniforms.uPointer.value.set((stage.pointer.sx * view.width) / 2, (stage.pointer.sy * view.height) / 2);
    const target = stage.pointer.inside ? 1 : 0;
    uniforms.uHover.value += (target - uniforms.uHover.value) * Math.min(1, dt * 5 + 0.02);
    if (!ready) return;
    const text = clockText(new Date(), p.seconds);
    if (text !== shown) update(text);
  });

  // タップ。触った点へ粒を吸い寄せてから弾き飛ばし、近い桁から順に組み直す。
  function blast(x = 0, y = 0) {
    if (stage.reduced || !ready) return;
    const view = stage.viewport();
    uniforms.uTap.value.set((x * view.width) / 2, (y * view.height) / 2);
    const tapSlot = uniforms.uTap.value.x / uniforms.uScale.value / SLOT_WIDTH + (slots - 1) / 2;
    utils.remove(blasts);
    blasts.forEach((item, slot) => {
      const far = Math.abs(slot - tapSlot);
      animate(item, {
        v: [
          { to: -0.55, duration: 200, ease: 'outQuad' },
          { to: 1, duration: 520, ease: 'outExpo' },
          { to: 0.85, duration: 260 + far * 110, ease: 'linear' },
          { to: 0, duration: 1000, ease: 'inOutQuart' },
        ],
        delay: far * 45,
      });
    });
  }
  const onPointerDown = (event) => {
    const rect = container.getBoundingClientRect();
    blast(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
  };
  container.addEventListener('pointerdown', onPointerDown);
  const auto = p.preview && !stage.reduced ? createTimer({ duration: 5600, loop: true, onLoop: () => blast(Math.random() - 0.5, 0) }) : null;

  // フォントの読み込みが終わってから描くと、数字の形が崩れない。
  (document.fonts?.ready ?? Promise.resolve()).then(() => {
    if (destroyed) return;
    update(clockText(new Date(), p.seconds), true);
    ready = true;
  });

  return {
    destroy() {
      destroyed = true;
      auto?.pause();
      container.removeEventListener('pointerdown', onPointerDown);
      utils.remove(mixes);
      utils.remove(blasts);
      stage.destroy();
    },
  };
}
