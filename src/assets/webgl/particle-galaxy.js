import * as THREE from 'three';
import { animate, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'particle-galaxy',
  title: '渦巻き銀河',
  category: 'webgl',
  libs: ['three', 'animejs'],
  description:
    '数万個の粒を渦状に並べ、中心ほど速く回します。読み込み時に中心から広がり、ポインターの位置で傾きが変わります。タップすると腕が中心へ巻き上がり、超新星のように弾けて衝撃の輪が走り、粒がまた渦を巻いて戻ります。トップページの背景に向いています。',
  params: {
    count: { type: 'range', label: '粒の数', min: 10000, max: 150000, step: 5000, default: 70000 },
    arms: { type: 'range', label: '腕の本数', min: 2, max: 8, step: 1, default: 4 },
    spin: { type: 'range', label: '回る速さ', min: 0, max: 1, step: 0.05, default: 0.3 },
    colorInner: { type: 'color', label: '中心の色', default: '#ffb37a' },
    colorOuter: { type: 'color', label: '外側の色', default: '#4a5bff' },
    background: { type: 'color', label: '背景色', default: '#05060f' },
  },
};

const RADIUS = 4;

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uSpin;
uniform float uProgress;
uniform float uWind;
uniform float uCollapse;
uniform float uBlast;
uniform float uFlash;
attribute float aScale;
attribute vec3 aColor;
varying vec3 vColor;
void main(){
  vec3 p = position;
  float d = length(p.xz);
  // uWind は腕の巻き上げ。中心に近い粒ほど大きく回る。
  float angle = atan(p.z, p.x) + uTime * uSpin / (d + 0.5) + (1.0 - uProgress) * 3.0 + uWind * 2.6 / (d + 0.6);
  p.xz = vec2(cos(angle), sin(angle)) * d;
  p *= mix(0.02, 1.0, uProgress);
  // 巻き上げながら中心へ縮み、弾けるときは粒ごとに違う速さで外へ飛ぶ。
  p *= 1.0 - uCollapse * 0.78;
  float push = fract(aScale * 7.31);
  vec3 dir = normalize(p + vec3(0.0, (push - 0.5) * 0.9, 0.0) + 0.0001);
  p += dir * uBlast * (0.6 + push * 3.4);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * aScale * (1.0 + uFlash * 1.6) / -mv.z;
  vColor = aColor * (1.0 + uFlash * 2.2) + vec3(1.0, 0.9, 0.75) * uFlash * 0.5;
}
`;

const fragmentShader = /* glsl */ `
varying vec3 vColor;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = pow(smoothstep(0.5, 0.0, d), 2.5);
  gl_FragColor = vec4(vColor * a, a);
  #include <colorspace_fragment>
}
`;

function buildGeometry(count, arms, inner, outer) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const color = new THREE.Color();
  const scatter = () => Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? -1 : 1);
  for (let i = 0; i < count; i += 1) {
    const r = Math.pow(Math.random(), 1.7) * RADIUS;
    const angle = ((i % arms) / arms) * Math.PI * 2 + r * 1.15;
    const spread = 0.12 + r * 0.16;
    positions[i * 3] = Math.cos(angle) * r + scatter() * spread;
    positions[i * 3 + 1] = scatter() * spread * 0.55;
    positions[i * 3 + 2] = Math.sin(angle) * r + scatter() * spread;
    color.copy(inner).lerp(outer, Math.min(1, r / RADIUS + (Math.random() - 0.5) * 0.25));
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    scales[i] = 0.4 + Math.random() * 1.2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
  return geometry;
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { cameraZ: 6.2, background: p.background, preview: p.preview, antialias: false });
  const count = p.preview ? Math.min(p.count, 35000) : p.count;

  const uniforms = {
    uTime: { value: 0 },
    uSize: { value: 1 },
    uSpin: { value: p.spin },
    uProgress: { value: stage.reduced ? 1 : 0 },
    uWind: { value: 0 },
    uCollapse: { value: 0 },
    uBlast: { value: 0 },
    uFlash: { value: 0 },
  };
  const nova = { wind: 0, collapse: 0, blast: 0, flash: 0, ring: 0, ringFade: 0, tiltX: 0, tiltZ: 0 };
  const points = new THREE.Points(
    buildGeometry(count, Math.round(p.arms), new THREE.Color(p.colorInner), new THREE.Color(p.colorOuter)),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  points.frustumCulled = false;
  const group = new THREE.Group();
  group.add(points);
  // 弾けた瞬間に銀河の面を走る、衝撃の輪。
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.975, 1, 128),
    new THREE.MeshBasicMaterial({ color: p.colorInner, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  group.add(ring);
  stage.scene.add(group);

  stage.onResize(({ width, height, dpr }) => {
    uniforms.uSize.value = height * dpr * 0.022;
    // 縦長の画面でも銀河全体が入るように縮める。
    group.scale.setScalar(Math.min(1, (width / height) * 0.85 + 0.1));
  });
  stage.onFrame((time) => {
    uniforms.uTime.value = time + 20;
    group.rotation.x = 0.95 + stage.pointer.sy * 0.25 + nova.tiltX;
    group.rotation.z = -0.25 + stage.pointer.sx * 0.2 + nova.tiltZ;
    uniforms.uWind.value = nova.wind;
    uniforms.uCollapse.value = nova.collapse;
    uniforms.uBlast.value = nova.blast;
    uniforms.uFlash.value = nova.flash;
    ring.visible = nova.ringFade > 0.005;
    ring.scale.setScalar(0.2 + nova.ring * RADIUS * 1.5);
    ring.material.opacity = nova.ringFade;
  });

  function supernova(event) {
    if (stage.reduced) return;
    // タップした側へ、銀河の面がぐっと傾く。
    const rect = container.getBoundingClientRect();
    const hasPoint = typeof event?.clientX === 'number' && rect.width > 0 && rect.height > 0;
    const nx = hasPoint ? ((event.clientX - rect.left) / rect.width) * 2 - 1 : Math.random() * 1.4 - 0.7;
    const ny = hasPoint ? 1 - ((event.clientY - rect.top) / rect.height) * 2 : Math.random() - 0.5;
    utils.remove(nova);
    nova.ring = 0;
    nova.ringFade = 0;
    // 準備: 腕が巻き上がりながら中心へ縮む。
    animate(nova, {
      wind: [
        { to: 1, duration: 780, ease: 'inCubic' },
        { to: -0.35, duration: 520, ease: 'outQuad' },
        { to: 0, duration: 2300, ease: 'inOutSine' },
      ],
      collapse: [
        { to: 1, duration: 780, ease: 'inQuart' },
        { to: 0, duration: 200, ease: 'outQuad' },
      ],
    });
    // 山場: 中心が光り、粒が外へ弾ける。余韻: 粒が渦を巻きながら元の腕に戻る。
    animate(nova, {
      blast: [
        { to: 1, duration: 620, ease: 'outExpo' },
        { to: 0, duration: 2300, ease: 'inOutCubic' },
      ],
      flash: [
        { to: 1, duration: 110, ease: 'outQuad' },
        { to: 0, duration: 900, ease: 'outCubic' },
      ],
      delay: 760,
    });
    animate(nova, { ring: [0, 1], duration: 1300, delay: 800, ease: 'outCubic' });
    animate(nova, { ringFade: [{ to: 0.85, duration: 90 }, { to: 0, duration: 1200, ease: 'outQuad' }], delay: 800 });
    animate(nova, {
      tiltX: [{ to: ny * 0.3, duration: 700, ease: 'outCubic' }, { to: 0, duration: 2400, ease: 'inOutSine' }],
      tiltZ: [{ to: nx * 0.34, duration: 700, ease: 'outCubic' }, { to: 0, duration: 2400, ease: 'inOutSine' }],
    });
  }
  container.addEventListener('pointerdown', supernova);
  const auto = p.preview && !stage.reduced ? setInterval(supernova, 6500) : 0;

  if (!stage.reduced) animate(uniforms.uProgress, { value: 1, duration: 3200, ease: 'outExpo' });

  return {
    supernova,
    destroy() {
      clearInterval(auto);
      container.removeEventListener('pointerdown', supernova);
      utils.remove(nova);
      utils.remove(uniforms.uProgress);
      stage.destroy();
    },
  };
}
