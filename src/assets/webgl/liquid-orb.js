import * as THREE from 'three';
import { animate, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { snoise3 } from '../../lib/glsl.js';

export const meta = {
  id: 'liquid-orb',
  title: '液体の球',
  category: 'webgl',
  libs: ['three', 'animejs'],
  description:
    'ノイズで表面がうねる球です。見る角度で色が変わり、ポインターを速く動かすと波が大きくなります。クリックすると弾むように揺れます。',
  params: {
    distortion: { type: 'range', label: 'うねりの大きさ', min: 0.05, max: 0.7, step: 0.01, default: 0.3 },
    frequency: { type: 'range', label: 'うねりの細かさ', min: 0.4, max: 3, step: 0.1, default: 1.2 },
    speed: { type: 'range', label: '速さ', min: 0, max: 2, step: 0.05, default: 0.7 },
    colorA: { type: 'color', label: '谷の色', default: '#2b1bd1' },
    colorB: { type: 'color', label: '山の色', default: '#ff4fa3' },
    colorC: { type: 'color', label: 'ふちの色', default: '#8ef6ff' },
    background: { type: 'color', label: '背景色', default: '#0b0a1f' },
  },
};

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uFreq;
varying vec3 vNormal;
varying vec3 vView;
varying float vBand;
${snoise3}
float disp(vec3 dir){
  float a = snoise(dir * uFreq + vec3(0.0, uTime * 0.35, 0.0));
  float b = snoise(dir * uFreq * 2.4 - vec3(uTime * 0.25, 0.0, 0.0));
  return (a + b * 0.35) * uAmp;
}
vec3 orthogonal(vec3 v){
  return normalize(abs(v.x) > abs(v.z) ? vec3(-v.y, v.x, 0.0) : vec3(0.0, -v.z, v.y));
}
void main(){
  float radius = length(position);
  vec3 n = normalize(position);
  // 近くの 2 点も同じ式で動かして、変形後の法線を求める。
  vec3 t = orthogonal(n);
  vec3 b = normalize(cross(n, t));
  float e = 0.012;
  vec3 n1 = normalize(n + t * e);
  vec3 n2 = normalize(n + b * e);
  float d = disp(n);
  vec3 p = n * (radius + d);
  vec3 p1 = n1 * (radius + disp(n1));
  vec3 p2 = n2 * (radius + disp(n2));
  vec3 normal2 = normalize(cross(p1 - p, p2 - p));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormal = normalMatrix * normal2;
  vView = -mv.xyz;
  vBand = d / max(uAmp, 0.0001) * 0.5 + 0.5;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
varying vec3 vNormal;
varying vec3 vView;
varying float vBand;
void main(){
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vView);
  float fresnel = pow(1.0 - max(dot(n, v), 0.0), 2.4);
  vec3 col = mix(uA, uB, smoothstep(0.15, 0.9, vBand));
  vec3 l = normalize(vec3(0.5, 0.8, 0.6));
  float diffuse = max(dot(n, l), 0.0);
  float spec = pow(max(dot(reflect(-l, n), v), 0.0), 48.0);
  col *= 0.5 + 0.7 * diffuse;
  col = mix(col, uC, fresnel * 0.85);
  col += spec * 0.55;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { cameraZ: 6, background: p.background, preview: p.preview });
  const state = { kick: 0 };
  const uniforms = {
    uTime: { value: 0 },
    uAmp: { value: p.distortion },
    uFreq: { value: p.frequency },
    uA: { value: new THREE.Color(p.colorA) },
    uB: { value: new THREE.Color(p.colorB) },
    uC: { value: new THREE.Color(p.colorC) },
  };
  const orb = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.5, p.preview ? 28 : 56),
    new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader }),
  );
  stage.scene.add(orb);

  stage.onResize(() => {
    const { width, height } = stage.viewport();
    orb.scale.setScalar(Math.min(1, width / 4.6, height / 4.2));
  });
  stage.onFrame((time, dt) => {
    uniforms.uTime.value = time * p.speed + 4;
    uniforms.uAmp.value = p.distortion * (1 + stage.pointer.speed * 1.2 + state.kick);
    orb.rotation.y += dt * 0.12;
    orb.rotation.x = -stage.pointer.sy * 0.4;
    orb.position.x = stage.pointer.sx * 0.25;
    orb.position.y = stage.pointer.sy * 0.2;
  });

  function kick() {
    if (stage.reduced) return;
    animate(state, {
      kick: [
        { to: 1.4, duration: 160, ease: 'outQuad' },
        { to: 0, duration: 1500, ease: 'outElastic(1, .35)' },
      ],
    });
  }
  container.addEventListener('pointerdown', kick);
  const autoKick = p.preview ? setInterval(kick, 3600) : 0;

  return {
    destroy() {
      clearInterval(autoKick);
      container.removeEventListener('pointerdown', kick);
      utils.remove(state);
      stage.destroy();
    },
  };
}
