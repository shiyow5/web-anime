import * as THREE from 'three';
import { animate, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { fullscreenVertex, snoise3 } from '../../lib/glsl.js';

export const meta = {
  id: 'image-ripple',
  title: '画像の波紋と切り替え',
  category: 'webgl',
  libs: ['three', 'animejs'],
  description:
    '画像の上でポインターを動かすと、水面のように波紋が出て色がにじみます。クリックすると、その場所が指で押したようにくぼみ、そこから広がる水の輪の内側がノイズでちぎれながら次の画像に替わって、あとに細かい波紋が残ります。images に画像の URL を渡すと自分の写真で使えます。',
  params: {
    intensity: { type: 'range', label: '波紋の強さ', min: 0, max: 3, step: 0.1, default: 1 },
    shift: { type: 'range', label: '色のにじみ', min: 0, max: 3, step: 0.1, default: 1 },
    duration: { type: 'range', label: '切り替え時間（秒）', min: 0.4, max: 3, step: 0.1, default: 1.4 },
    interval: { type: 'range', label: '自動送り（秒、0 で止める）', min: 0, max: 10, step: 0.5, default: 4 },
  },
};

const MAX_IMAGES = 12;
const POSTERS = [
  { word: 'Dune', from: '#ff9a5a', to: '#7a1f3d', ink: '#ffe9c9' },
  { word: 'Tide', from: '#0b3a8f', to: '#39d6c8', ink: '#eafffb' },
  { word: 'Moss', from: '#1f4d2c', to: '#d7e86a', ink: '#f6ffd9' },
  { word: 'Dusk', from: '#2a1458', to: '#ff6fa8', ink: '#ffe3ef' },
];

// 画像を渡されなかったときに使う、キャンバスで描いた見本のポスター。
function makePoster({ word, from, to, ink }, index) {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 800;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, to);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = ink;
  for (let i = 0; i < 5; i += 1) {
    ctx.beginPath();
    ctx.arc(260 + index * 190, 400, 120 + i * 95, 0, Math.PI * 2);
    ctx.lineWidth = 26 - i * 4;
    ctx.strokeStyle = ink;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.font = '800 300px "Bricolage Grotesque Variable", "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(word, canvas.width - 70, canvas.height - 90);
  return canvas;
}

function validImageUrls(images) {
  if (!Array.isArray(images)) return [];
  return images.filter((url) => typeof url === 'string' && url.length > 0 && url.length < 2048).slice(0, MAX_IMAGES);
}

const fragmentShader = /* glsl */ `
uniform sampler2D uTex1;
uniform sampler2D uTex2;
uniform float uAspect1;
uniform float uAspect2;
uniform float uPlaneAspect;
uniform float uProgress;
uniform float uTime;
uniform float uHover;
uniform float uIntensity;
uniform float uShift;
uniform vec2 uMouse;
uniform vec2 uOrigin;
uniform float uReach;
uniform float uPinch;
uniform float uAfter;
varying vec2 vUv;
${snoise3}
vec2 cover(vec2 uv, float imageAspect){
  vec2 s = uPlaneAspect > imageAspect
    ? vec2(1.0, imageAspect / uPlaneAspect)
    : vec2(uPlaneAspect / imageAspect, 1.0);
  return (uv - 0.5) * s + 0.5;
}
vec3 sampleShifted(sampler2D tex, vec2 uv, vec2 offset){
  return vec3(texture2D(tex, uv + offset).r, texture2D(tex, uv).g, texture2D(tex, uv - offset).b);
}
void main(){
  vec2 uv = vUv;
  vec2 fromMouse = (uv - uMouse) * vec2(uPlaneAspect, 1.0);
  float dist = length(fromMouse);
  float ripple = sin(dist * 42.0 - uTime * 7.0) * exp(-dist * 5.5) * uHover * uIntensity;
  uv += normalize(fromMouse + 0.0001) * ripple * 0.018;

  // クリックした場所からの距離。くぼみ、広がる輪、あとに残る波紋に使う。
  vec2 fromOrigin = (vUv - uOrigin) * vec2(uPlaneAspect, 1.0);
  float od = length(fromOrigin);
  vec2 dirO = fromOrigin / (od + 0.0001) / vec2(uPlaneAspect, 1.0);
  uv -= (vUv - uOrigin) * exp(-od * od * 26.0) * uPinch * 0.55;
  float after = sin(od * 40.0 - uTime * 9.0) * exp(-od * 3.2) * uAfter;
  uv += dirO * after * 0.014;

  float n = snoise(vec3(vUv * vec2(3.0, 5.0), 1.0)) * 0.5 + 0.5;
  float edge = od / uReach * 0.72 + n * 0.28;
  float m = smoothstep(edge - 0.09, edge + 0.09, uProgress * 1.25 - 0.12);
  float mid = m * (1.0 - m);
  uv += dirO * mid * 0.16;
  vec2 offset = vec2(ripple * 0.012 + mid * 0.05 + after * 0.01, 0.0) * uShift;
  vec3 a = sampleShifted(uTex1, cover(uv + dirO * m * 0.22 * n, uAspect1), offset);
  vec3 b = sampleShifted(uTex2, cover(uv - dirO * (1.0 - m) * 0.22 * n, uAspect2), offset);
  a += mid * 0.35;
  b += mid * 0.35;
  gl_FragColor = vec4(mix(a, b, m), 1.0);
}
`;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { preview: p.preview, antialias: false });
  const urls = validImageUrls(options.images);

  const slides = (urls.length >= 2 ? urls : POSTERS).map((source, index) => {
    if (typeof source === 'string') {
      const slide = { texture: null, aspect: 1.6 };
      slide.texture = new THREE.TextureLoader().load(
        source,
        (texture) => {
          const ratio = texture.image.width / texture.image.height;
          if (Number.isFinite(ratio) && ratio > 0) slide.aspect = ratio;
          syncAspects();
        },
        undefined,
        () => console.error(`[web-anime] 画像を読み込めませんでした: ${source}`),
      );
      return slide;
    }
    const canvas = makePoster(source, index);
    const texture = new THREE.CanvasTexture(canvas);
    return { texture, aspect: canvas.width / canvas.height };
  });

  let current = 0;
  let busy = false;
  const uniforms = {
    uTex1: { value: slides[0].texture },
    uTex2: { value: slides[1].texture },
    uAspect1: { value: slides[0].aspect },
    uAspect2: { value: slides[1].aspect },
    uPlaneAspect: { value: 1 },
    uProgress: { value: 0 },
    uTime: { value: 0 },
    uHover: { value: 0 },
    uIntensity: { value: p.intensity },
    uShift: { value: p.shift },
    uMouse: { value: new THREE.Vector2(0.5, 0.5) },
    uOrigin: { value: new THREE.Vector2(0.5, 0.5) },
    uReach: { value: 1 },
    uPinch: { value: 0 },
    uAfter: { value: 0 },
  };
  function syncAspects() {
    const nextIndex = (current + 1) % slides.length;
    uniforms.uAspect1.value = slides[current].aspect;
    uniforms.uAspect2.value = slides[nextIndex].aspect;
  }

  // 画像の色をそのまま表示したいので、テクスチャーにも出力にも色空間の変換をかけない。
  stage.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: fullscreenVertex, fragmentShader, depthTest: false }),
  );
  quad.frustumCulled = false;
  stage.scene.add(quad);

  stage.onResize(({ width, height }) => {
    uniforms.uPlaneAspect.value = width / height;
  });
  stage.onFrame((time, dt) => {
    uniforms.uTime.value = time;
    uniforms.uMouse.value.set((stage.pointer.sx + 1) / 2, (stage.pointer.sy + 1) / 2);
    const target = stage.pointer.inside ? Math.min(1, 0.35 + stage.pointer.speed) : 0;
    uniforms.uHover.value += (target - uniforms.uHover.value) * Math.min(1, dt * 4 + 0.02);
  });

  let settle = null;
  function next(event) {
    const tapped = typeof event?.clientX === 'number';
    if (busy) {
      // 自動送りの途中は何もしない。クリックされたときは、途中の切り替えを終わらせてから、その場所で始め直す。
      if (!tapped || !settle) return;
      utils.remove(uniforms.uProgress);
      settle();
    }
    busy = true;
    const nextIndex = (current + 1) % slides.length;
    uniforms.uTex2.value = slides[nextIndex].texture;
    uniforms.uAspect2.value = slides[nextIndex].aspect;
    // クリックした場所（自動送りのときは毎回ちがう場所）を、輪の中心にする。
    const rect = container.getBoundingClientRect();
    const hasPoint = typeof event?.clientX === 'number' && rect.width > 0 && rect.height > 0;
    const ox = hasPoint ? (event.clientX - rect.left) / rect.width : 0.2 + Math.random() * 0.6;
    const oy = hasPoint ? 1 - (event.clientY - rect.top) / rect.height : 0.25 + Math.random() * 0.5;
    const aspect = uniforms.uPlaneAspect.value;
    uniforms.uOrigin.value.set(ox, oy);
    uniforms.uReach.value = Math.hypot(Math.max(ox, 1 - ox) * aspect, Math.max(oy, 1 - oy));
    const finish = () => {
      current = nextIndex;
      uniforms.uTex1.value = slides[current].texture;
      uniforms.uProgress.value = 0;
      syncAspects();
      busy = false;
      settle = null;
    };
    settle = finish;
    if (stage.reduced) {
      finish();
      return;
    }
    utils.remove([uniforms.uPinch, uniforms.uAfter]);
    uniforms.uAfter.value = 0;
    // 準備: 押した場所がくぼむ。
    animate(uniforms.uPinch, {
      value: [
        { to: 1, duration: 170, ease: 'outQuad' },
        { to: 0, duration: 520, ease: 'outBack(3)' },
      ],
    });
    // 山場: くぼみから輪が広がり、内側が次の画像に替わる。
    animate(uniforms.uProgress, {
      value: [0, 1],
      duration: p.duration * 1000,
      delay: 130,
      ease: 'inOutCubic',
      onComplete: finish,
    });
    // 余韻: 輪が通り過ぎたあと、細かい波紋が残って消える。
    animate(uniforms.uAfter, {
      value: [
        { to: 1, duration: 300, ease: 'outQuad' },
        { to: 0, duration: 1500, ease: 'outQuad' },
      ],
      delay: 130 + p.duration * 550,
    });
  }
  container.addEventListener('click', next);
  const timer = p.interval > 0 && !stage.reduced ? setInterval(() => next(), p.interval * 1000) : 0;

  return {
    next,
    destroy() {
      clearInterval(timer);
      container.removeEventListener('click', next);
      utils.remove([uniforms.uProgress, uniforms.uPinch, uniforms.uAfter]);
      for (const slide of slides) slide.texture.dispose();
      stage.destroy();
    },
  };
}
