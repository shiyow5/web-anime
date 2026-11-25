import * as THREE from 'three';
import { animate, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { fullscreenVertex, snoise3 } from '../../lib/glsl.js';

export const meta = {
  id: 'portal-vortex',
  title: '渦の門',
  category: 'fantasy',
  libs: ['three', 'animejs'],
  description:
    '炎のような輪の内側で、別の世界へ続く渦が回ります。読み込み時に弾むように開き、クリックするといったん閉じてから開き直します。ページの入口や、ゲーム風の演出に使えます。',
  params: {
    core: { type: 'color', label: '渦の色', default: '#48e0ff' },
    deep: { type: 'color', label: '渦の奥の色', default: '#1a0b52' },
    edge: { type: 'color', label: '輪の色', default: '#ff8a2b' },
    background: { type: 'color', label: '背景色', default: '#07060f' },
    speed: { type: 'range', label: '回る速さ', min: 0, max: 3, step: 0.1, default: 1 },
    size: { type: 'range', label: '門の大きさ', min: 0.3, max: 1.1, step: 0.02, default: 0.78 },
  },
};

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uOpen;
uniform float uSize;
uniform vec2 uRes;
uniform vec2 uPointer;
uniform vec3 uCore;
uniform vec3 uDeep;
uniform vec3 uEdge;
uniform vec3 uBg;
varying vec2 vUv;
${snoise3}
void main(){
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 2.4 - uPointer * 0.06;
  float r = length(p);
  float a = atan(p.y, p.x);
  float R = uSize * uOpen;

  // 渦。中心に近いほど角度を大きくずらして、巻き込まれるように見せる。
  float swirl = a + 2.2 / (r + 0.25) - uTime * 0.9;
  float n1 = snoise(vec3(cos(swirl) * 1.6, sin(swirl) * 1.6, r * 3.0 - uTime * 0.4));
  float n2 = snoise(vec3(cos(swirl * 2.0) * 2.5, sin(swirl * 2.0) * 2.5, r * 6.0 + uTime * 0.3));
  vec3 inside = mix(uDeep, uCore, smoothstep(-0.4, 0.9, n1 * 0.7 + n2 * 0.3));
  inside *= 0.3 + 0.95 * smoothstep(0.0, max(R, 0.001), r);
  inside += uCore * smoothstep(0.6, 1.0, n2) * 0.5;

  // 輪から外へ伸びる炎。
  float flame = snoise(vec3(cos(a) * 3.0, sin(a) * 3.0, uTime * 1.2)) * 0.5 + 0.5;
  float flicker = snoise(vec3(cos(a) * 8.0, sin(a) * 8.0, uTime * 2.2 + 5.0)) * 0.5 + 0.5;
  float reach = R + (flame * 0.13 + flicker * 0.05) * uOpen;
  float tongues = smoothstep(reach + 0.02, R, r) * step(R, r);

  vec3 col = uBg;
  col += uEdge * 0.16 * pow(smoothstep(1.5, R, r), 2.0) * uOpen;
  col += uEdge * tongues * (0.5 + flame);
  col = mix(col, inside, smoothstep(R, R - 0.06, r));
  col += uEdge * smoothstep(0.1, 0.0, abs(r - R)) * 1.3 * uOpen;
  col += vec3(1.0) * smoothstep(0.028, 0.0, abs(r - R)) * 0.7 * uOpen;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { preview: p.preview, antialias: false, maxDpr: p.preview ? 1 : 1.5, startTime: 8 });
  const state = { open: stage.reduced ? 1 : 0 };
  const uniforms = {
    uTime: { value: 0 },
    uOpen: { value: state.open },
    uSize: { value: p.size },
    uRes: { value: new THREE.Vector2(1, 1) },
    uPointer: { value: new THREE.Vector2() },
    uCore: { value: new THREE.Color(p.core) },
    uDeep: { value: new THREE.Color(p.deep) },
    uEdge: { value: new THREE.Color(p.edge) },
    uBg: { value: new THREE.Color(p.background) },
  };
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: fullscreenVertex, fragmentShader, depthTest: false }),
  );
  quad.frustumCulled = false;
  stage.scene.add(quad);

  stage.onResize(({ width, height }) => {
    uniforms.uRes.value.set(width, height);
    // 縦長の画面では、門が横にはみ出さないように縮める。
    uniforms.uSize.value = p.size * Math.min(1, (width / height) * 1.05);
  });
  stage.onFrame((time) => {
    uniforms.uTime.value = time * p.speed;
    uniforms.uOpen.value = Math.max(0, state.open);
    uniforms.uPointer.value.set(stage.pointer.sx, stage.pointer.sy);
  });

  const open = () => animate(state, { open: 1, duration: 1700, ease: 'outElastic(1, .55)' });
  function reopen() {
    if (stage.reduced) return;
    animate(state, { open: 0, duration: 420, ease: 'inBack(2)', onComplete: open });
  }
  if (!stage.reduced) open();
  container.addEventListener('click', reopen);
  const autoReopen = p.preview && !stage.reduced ? setInterval(reopen, 5200) : 0;

  return {
    reopen,
    destroy() {
      clearInterval(autoReopen);
      container.removeEventListener('click', reopen);
      utils.remove(state);
      stage.destroy();
    },
  };
}
