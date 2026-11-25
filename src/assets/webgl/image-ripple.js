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
    '画像の上でポインターを動かすと、水面のように波紋が出て色がにじみます。クリックすると、ノイズでちぎれるように次の画像へ切り替わります。images に画像の URL を渡すと自分の写真で使えます。',
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

  float n = snoise(vec3(vUv * vec2(3.0, 5.0), 1.0)) * 0.5 + 0.5;
  float edge = vUv.x * 0.6 + n * 0.4;
  float m = smoothstep(edge - 0.15, edge + 0.15, uProgress * 1.3 - 0.15);
  float mid = m * (1.0 - m);
  vec2 offset = vec2(ripple * 0.012 + mid * 0.05, 0.0) * uShift;
  vec3 a = sampleShifted(uTex1, cover(uv + vec2(m * 0.3 * n, 0.0), uAspect1), offset);
  vec3 b = sampleShifted(uTex2, cover(uv - vec2((1.0 - m) * 0.3 * n, 0.0), uAspect2), offset);
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

  function next() {
    if (busy) return;
    busy = true;
    const nextIndex = (current + 1) % slides.length;
    uniforms.uTex2.value = slides[nextIndex].texture;
    uniforms.uAspect2.value = slides[nextIndex].aspect;
    animate(uniforms.uProgress, {
      value: [0, 1],
      duration: stage.reduced ? 1 : p.duration * 1000,
      ease: 'inOutCubic',
      onComplete() {
        current = nextIndex;
        uniforms.uTex1.value = slides[current].texture;
        uniforms.uProgress.value = 0;
        syncAspects();
        busy = false;
      },
    });
  }
  container.addEventListener('click', next);
  const timer = p.interval > 0 && !stage.reduced ? setInterval(next, p.interval * 1000) : 0;

  return {
    next,
    destroy() {
      clearInterval(timer);
      container.removeEventListener('click', next);
      utils.remove(uniforms.uProgress);
      for (const slide of slides) slide.texture.dispose();
      stage.destroy();
    },
  };
}
