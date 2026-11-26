import * as THREE from 'three';
import { animate, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams, splitList } from '../../lib/params.js';

export const meta = {
  id: 'text-particles',
  title: '文字になる粒',
  category: 'webgl',
  libs: ['three', 'animejs'],
  description:
    '粒が集まって言葉になり、いったん散ってから次の言葉に組み替わります。ポインターを近づけると粒が逃げます。クリックすると、その場所から衝撃の輪が走り、近い粒から順に外へ吹き飛んで、次の言葉に組み直ります。日本語も使えます。',
  params: {
    words: { type: 'text', label: '言葉（カンマ区切り）', default: 'MOTION, うごき, three.js, anime.js', maxLength: 120 },
    count: { type: 'range', label: '粒の数', min: 4000, max: 60000, step: 2000, default: 26000 },
    hold: { type: 'range', label: '止まる時間（秒）', min: 0.5, max: 6, step: 0.5, default: 2 },
    colorA: { type: 'color', label: '色 A', default: '#ffffff' },
    colorB: { type: 'color', label: '色 B', default: '#ff7a59' },
    background: { type: 'color', label: '背景色', default: '#12122b' },
  },
};

const CANVAS_W = 1024;
const CANVAS_H = 256;
const FONT_STACK = '"Bricolage Grotesque Variable", "Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", "Noto Sans CJK JP", system-ui, sans-serif';

// 文字を 2D キャンバスに描き、塗られた画素からランダムに点を選ぶ。
// 返す座標は x が -1〜1、y が -0.25〜0.25。
function sampleText(text, count) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const out = new Float32Array(count * 3);
  if (!ctx) return out;
  const base = 200;
  ctx.font = `800 ${base}px ${FONT_STACK}`;
  const measured = Math.max(1, ctx.measureText(text).width);
  const fontSize = Math.min(base, (base * CANVAS_W * 0.94) / measured);
  ctx.font = `800 ${fontSize}px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2);
  const { data } = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
  const filled = [];
  for (let y = 0; y < CANVAS_H; y += 2) {
    for (let x = 0; x < CANVAS_W; x += 2) {
      if (data[(y * CANVAS_W + x) * 4 + 3] > 128) filled.push(x, y);
    }
  }
  const total = filled.length / 2;
  if (total === 0) return out;
  for (let i = 0; i < count; i += 1) {
    const k = Math.floor(Math.random() * total) * 2;
    out[i * 3] = ((filled[k] + Math.random() * 2) / CANVAS_W - 0.5) * 2;
    out[i * 3 + 1] = -((filled[k + 1] + Math.random() * 2) / CANVAS_H - 0.5) * 2 * (CANVAS_H / CANVAS_W);
    out[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
  }
  return out;
}

function randomCloud(count) {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const r = 0.3 + Math.random() * 0.9;
    const a = Math.random() * Math.PI * 2;
    out[i * 3] = Math.cos(a) * r * 1.3;
    out[i * 3 + 1] = Math.sin(a) * r * 0.6;
    out[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
  }
  return out;
}

const vertexShader = /* glsl */ `
uniform float uMix;
uniform float uTime;
uniform float uScale;
uniform float uSize;
uniform float uHover;
uniform vec2 uPointer;
uniform vec2 uOrigin;
uniform float uFromTap;
uniform float uReach;
uniform float uShockR;
uniform float uShockAmp;
attribute vec3 aTo;
attribute vec4 aRand;
varying float vTint;
varying float vBurst;
void main(){
  // 粒ごとに出発を少しずらす。クリックで始まったときは、クリックした場所に近い粒から先に動く。
  vec2 fromTap = position.xy * uScale - uOrigin;
  float near = clamp(length(fromTap) / uReach, 0.0, 1.0);
  float order = mix(aRand.x, near * 0.82 + aRand.x * 0.18, uFromTap);
  float t = clamp(uMix * 1.5 - order * 0.5, 0.0, 1.0);
  t = t * t * (3.0 - 2.0 * t);
  vec3 p = mix(position, aTo, t) * uScale;
  float burst = sin(t * 3.14159265);
  vec3 scatter = (aRand.yzw - 0.5) * 1.8;
  vec3 blown = vec3(normalize(fromTap + 0.0001) * (0.5 + aRand.y * 1.7), (aRand.w - 0.5) * 1.8);
  p += mix(scatter, blown, uFromTap) * burst;
  // クリックした場所から広がる衝撃の輪。通り過ぎるときに粒が持ち上がる。
  vec2 fromShock = p.xy - uOrigin;
  float sf = length(fromShock) - uShockR;
  float shock = exp(-sf * sf * 12.0) * uShockAmp;
  p.xy += normalize(fromShock + 0.0001) * shock * 0.2;
  p.z += shock * 0.6;
  p.xy += vec2(sin(uTime * 1.4 + aRand.y * 40.0), cos(uTime * 1.1 + aRand.z * 40.0)) * 0.006;
  vec2 away = p.xy - uPointer;
  float push = smoothstep(0.75, 0.0, length(away)) * uHover;
  p.xy += normalize(away + 0.0001) * push * 0.4;
  p.z += push * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.6 + aRand.w * 0.9) / -mv.z;
  vTint = aRand.x;
  vBurst = burst + push + shock;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
varying float vTint;
varying float vBurst;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.1, d);
  vec3 col = mix(uColorA, uColorB, clamp(step(0.72, vTint) + vBurst * 0.8, 0.0, 1.0));
  gl_FragColor = vec4(col, a * 0.9);
  #include <colorspace_fragment>
}
`;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { cameraZ: 6, background: p.background, preview: p.preview, antialias: false });
  const count = p.preview ? Math.min(p.count, 14000) : p.count;
  const parsed = splitList(p.words, { maxItems: 8, maxLength: 16 });
  const words = parsed.length ? parsed : ['MOTION'];

  const rand = new Float32Array(count * 4).map(() => Math.random());
  const geometry = new THREE.BufferGeometry();
  const fromAttr = new THREE.BufferAttribute(randomCloud(count), 3);
  const toAttr = new THREE.BufferAttribute(sampleText(words[0], count), 3);
  geometry.setAttribute('position', fromAttr);
  geometry.setAttribute('aTo', toAttr);
  geometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));

  const uniforms = {
    uMix: { value: stage.reduced ? 1 : 0 },
    uTime: { value: 0 },
    uScale: { value: 1 },
    uSize: { value: 1 },
    uHover: { value: 0 },
    uPointer: { value: new THREE.Vector2() },
    uOrigin: { value: new THREE.Vector2() },
    uFromTap: { value: 0 },
    uReach: { value: 1 },
    uShockR: { value: 0 },
    uShockAmp: { value: 0 },
    uColorA: { value: new THREE.Color(p.colorA) },
    uColorB: { value: new THREE.Color(p.colorB) },
  };
  const points = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false }),
  );
  points.frustumCulled = false;
  stage.scene.add(points);

  stage.onResize(({ height, dpr }) => {
    const view = stage.viewport();
    uniforms.uScale.value = Math.min(view.width * 0.46, view.height * 1.5);
    uniforms.uSize.value = height * dpr * 0.03;
  });
  stage.onFrame((time, dt) => {
    const view = stage.viewport();
    uniforms.uTime.value = time;
    uniforms.uPointer.value.set((stage.pointer.sx * view.width) / 2, (stage.pointer.sy * view.height) / 2);
    const target = stage.pointer.inside ? 1 : 0;
    uniforms.uHover.value += (target - uniforms.uHover.value) * Math.min(1, dt * 5 + 0.02);
  });

  let index = 0;
  let busy = false;
  let holdTimer = 0;
  let destroyed = false;

  function scheduleNext() {
    clearTimeout(holdTimer);
    if (words.length > 1 && !stage.reduced) holdTimer = setTimeout(() => next(), p.hold * 1000);
  }
  function morph() {
    busy = true;
    animate(uniforms.uMix, {
      value: [0, 1],
      duration: 2400,
      ease: 'inOutQuart',
      onComplete() {
        busy = false;
        if (destroyed) return;
        // 組み替えの途中でクリックされていたら、続けてもう一度組み替える。
        if (queued) {
          queued = false;
          next(true);
        } else scheduleNext();
      },
    });
  }
  function next(fromTap = false) {
    if (busy || destroyed || (words.length < 2 && !fromTap)) return;
    clearTimeout(holdTimer);
    index = (index + 1) % words.length;
    // いまの並びを出発点に移し、次の言葉を行き先にする。
    fromAttr.array.set(toAttr.array);
    fromAttr.needsUpdate = true;
    toAttr.array.set(sampleText(words[index], count));
    toAttr.needsUpdate = true;
    uniforms.uFromTap.value = fromTap ? 1 : 0;
    uniforms.uMix.value = 0;
    morph();
  }
  let queued = false;
  // 準備: 衝撃の輪が走る。山場: 近い粒から外へ吹き飛ぶ。余韻: 次の言葉に組み直る。
  function blast(event) {
    if (destroyed) return;
    if (stage.reduced) {
      if (words.length < 2) return;
      index = (index + 1) % words.length;
      toAttr.array.set(sampleText(words[index], count));
      toAttr.needsUpdate = true;
      return;
    }
    const rect = container.getBoundingClientRect();
    const view = stage.viewport();
    const hasPoint = typeof event?.clientX === 'number' && rect.width > 0 && rect.height > 0;
    const nx = hasPoint ? ((event.clientX - rect.left) / rect.width) * 2 - 1 : 0;
    const ny = hasPoint ? 1 - ((event.clientY - rect.top) / rect.height) * 2 : 0;
    const reach = uniforms.uScale.value * 2.1;
    utils.remove([uniforms.uShockR, uniforms.uShockAmp]);
    animate(uniforms.uShockR, { value: [0, reach], duration: 1000, ease: 'outCubic' });
    animate(uniforms.uShockAmp, { value: [1, 0], duration: 1000, ease: 'inQuad' });
    if (busy) {
      queued = true;
      return;
    }
    uniforms.uOrigin.value.set((nx * view.width) / 2, (ny * view.height) / 2);
    uniforms.uReach.value = reach;
    next(true);
  }

  // フォントの読み込みが終わってから描くと、言葉の形が崩れない。
  const fontsReady = document.fonts?.ready ?? Promise.resolve();
  fontsReady.then(() => {
    if (destroyed) return;
    toAttr.array.set(sampleText(words[index], count));
    toAttr.needsUpdate = true;
    if (!stage.reduced) morph();
  });
  container.addEventListener('click', blast);

  return {
    destroy() {
      destroyed = true;
      clearTimeout(holdTimer);
      container.removeEventListener('click', blast);
      utils.remove([uniforms.uMix, uniforms.uShockR, uniforms.uShockAmp]);
      stage.destroy();
    },
  };
}
