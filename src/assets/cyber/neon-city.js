import * as THREE from 'three';
import { animate, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'neon-city',
  title: 'ネオンの摩天楼',
  category: 'cyber',
  libs: ['three', 'animejs'],
  description:
    '夜の高層ビル街の大通りを、低く飛んで進みます。窓の明かりがビルごとに違う色でまたたき、足元を光の筋が走ります。遠くのビルは霧に溶けます。タップすると、手前から奥へ停電が走って窓が消え、続いて地上から屋上へ向かって明かりが灯り直し、ビルの色の割り当てが入れ替わります。機体はタップした側の車線へ寄り、押している間は加速を続けます。サイバーパンクな世界観のトップページに合います。',
  params: {
    colorA: { type: 'color', label: '窓の色 A', default: '#ff2e88' },
    colorB: { type: 'color', label: '窓の色 B', default: '#22e3ff' },
    fog: { type: 'color', label: '霧と空の色', default: '#0a0618' },
    speed: { type: 'range', label: '進む速さ', min: 0, max: 12, step: 0.5, default: 3.5 },
    density: { type: 'range', label: 'ビルの数', min: 60, max: 600, step: 20, default: 320 },
    height: { type: 'range', label: 'ビルの高さ', min: 0.5, max: 2.5, step: 0.1, default: 1.2 },
  },
};

const LENGTH = 90;
const HALF_WIDTH = 16;
const L = LENGTH.toFixed(1);

const buildingVertex = /* glsl */ `
uniform float uScroll;
attribute vec3 aOffset;
attribute vec3 aSize;
attribute float aSeed;
varying vec3 vLocal;
varying vec3 vNormal;
varying float vSeed;
varying float vDepth;
varying float vHeight;
void main(){
  vLocal = position * aSize;
  vNormal = normal;
  vSeed = aSeed;
  vec3 p = vLocal;
  p.y += aSize.y * 0.5;
  p.xz += aOffset.xz;
  vHeight = p.y;
  // 通り過ぎたビルを奥へ戻して、街が途切れないようにする。
  p.z = mod(p.z + uScroll, ${L}) - ${L} + 6.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const buildingFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uFog;
varying vec3 vLocal;
varying vec3 vNormal;
varying float vSeed;
varying float vDepth;
varying float vHeight;
uniform float uDark;
uniform float uRise;
uniform float uSwapFrom;
uniform float uSwapTo;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  // 停電の波が届いたところは窓が消える。灯り直しは地上から上がり、そこから上は色の割り当てが入れ替わる。
  float off = 1.0 - smoothstep(uDark - 5.0, uDark, vDepth);
  float relit = 1.0 - smoothstep(uRise - 0.6, uRise, vHeight);
  float power = max(1.0 - off, relit);
  float edge = smoothstep(0.9, 0.0, abs(vHeight - uRise + 0.3)) * step(0.0, uRise);
  float flip = mix(uSwapFrom, uSwapTo, relit);
  vec3 tint = mix(uA, uB, abs(step(0.5, fract(vSeed * 3.7)) - flip));
  vec3 col = uFog * 1.6 + 0.012;
  if (abs(vNormal.y) < 0.5) {
    // 側面に窓を並べる。窓ごとに、点いているかどうかを乱数で決める。
    vec2 uv = abs(vNormal.x) > 0.5 ? vLocal.zy : vLocal.xy;
    vec2 grid = uv * vec2(3.2, 2.6);
    vec2 cell = floor(grid);
    vec2 f = fract(grid);
    float pane = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.75);
    float seed = hash(cell + vSeed * 91.0);
    float lit = step(0.52, seed) * (0.6 + 0.4 * step(0.5, fract(seed * 7.0 + uTime * 0.07 * seed)));
    col += tint * pane * lit * (0.5 + 0.9 * fract(seed * 13.0)) * power;
    col += tint * edge * 0.9;
  } else {
    col += tint * 0.08;
  }
  float fog = smoothstep(8.0, ${(LENGTH * 0.8).toFixed(1)}, vDepth);
  gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
  #include <colorspace_fragment>
}
`;

const streakVertex = /* glsl */ `
uniform float uScroll;
uniform float uStretch;
attribute float aEnd;
attribute float aSeed;
varying float vAlpha;
varying float vLane;
void main(){
  vec3 p = position;
  // 車の流れ。街より速く進み、左右の車線で向きが逆になる。
  float lane = sign(p.x);
  p.z = mod(p.z + uScroll * (2.0 + aSeed) * lane, ${L}) - ${L} + 6.0;
  p.z -= aEnd * (1.2 + uStretch) * lane;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vAlpha = (1.0 - aEnd) * smoothstep(${(LENGTH * 0.8).toFixed(1)}, 10.0, -mv.z);
  vLane = lane;
  gl_Position = projectionMatrix * mv;
}
`;
const streakFragment = /* glsl */ `
uniform vec3 uA;
uniform vec3 uB;
varying float vAlpha;
varying float vLane;
void main(){
  vec3 col = vLane > 0.0 ? uA : uB;
  gl_FragColor = vec4(col * vAlpha * 1.6, vAlpha);
  #include <colorspace_fragment>
}
`;

function buildCity(count, heightScale) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = box.index;
  geometry.setAttribute('position', box.attributes.position);
  geometry.setAttribute('normal', box.attributes.normal);
  const offsets = new Float32Array(count * 3);
  const sizes = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    // 中央は大通りとして空ける。大通りに近いビルほど高くする。
    const side = i % 2 ? 1 : -1;
    const distance = 2.2 + Math.pow(Math.random(), 1.4) * (HALF_WIDTH - 2.2);
    const width = 1 + Math.random() * 1.8;
    const tall = (2 + Math.pow(Math.random(), 2.2) * 13) * heightScale * (1.15 - distance / (HALF_WIDTH * 1.6));
    offsets.set([side * (distance + width / 2), 0, Math.random() * LENGTH], i * 3);
    sizes.set([width, Math.max(1, tall), 1 + Math.random() * 1.8], i * 3);
    seeds[i] = Math.random();
  }
  geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
  geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 3));
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  geometry.instanceCount = count;
  return { geometry, box };
}

function buildStreaks(count) {
  const positions = new Float32Array(count * 6);
  const ends = new Float32Array(count * 2);
  const seeds = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    const x = (i % 2 ? 1 : -1) * (0.35 + Math.floor(Math.random() * 3) * 0.45);
    const y = 0.06 + (Math.random() < 0.25 ? 1 + Math.random() * 3 : 0);
    const z = Math.random() * LENGTH;
    const seed = Math.random();
    positions.set([x, y, z, x, y, z], i * 6);
    ends.set([0, 1], i * 2);
    seeds.set([seed, seed], i * 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  return geometry;
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, {
    fov: 58,
    far: 140,
    background: p.fog,
    preview: p.preview,
    maxDpr: p.preview ? 1 : 1.5,
    bloom: { strength: 0.5, radius: 0.3, threshold: 0.3 },
  });
  const state = { speed: p.speed };
  const colors = { uA: { value: new THREE.Color(p.colorA) }, uB: { value: new THREE.Color(p.colorB) }, uFog: { value: new THREE.Color(p.fog) } };
  const uniforms = { ...colors, uTime: { value: 0 }, uScroll: { value: 0 }, uDark: { value: -10 }, uRise: { value: -10 }, uSwapFrom: { value: 0 }, uSwapTo: { value: 0 } };
  const power = { dark: -10, rise: -10, lane: 0 };
  const streakUniforms = { ...colors, uScroll: uniforms.uScroll, uStretch: { value: 0 } };

  const { geometry, box } = buildCity(Math.round(p.preview ? Math.min(p.density, 180) : p.density), p.height);
  const city = new THREE.Mesh(geometry, new THREE.ShaderMaterial({ uniforms, vertexShader: buildingVertex, fragmentShader: buildingFragment }));
  city.frustumCulled = false;
  const streaks = new THREE.LineSegments(
    buildStreaks(p.preview ? 60 : 160),
    new THREE.ShaderMaterial({ uniforms: streakUniforms, vertexShader: streakVertex, fragmentShader: streakFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  streaks.frustumCulled = false;
  const road = new THREE.Mesh(new THREE.PlaneGeometry(HALF_WIDTH * 2.4, LENGTH * 1.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(p.fog).multiplyScalar(0.7) }));
  road.rotation.x = -Math.PI / 2;
  road.position.z = -LENGTH / 2 + 6;
  stage.scene.add(road, city, streaks);
  stage.onDispose(() => box.dispose());

  stage.onFrame((time, dt) => {
    uniforms.uTime.value = time;
    uniforms.uDark.value = power.dark;
    uniforms.uRise.value = power.rise;
    uniforms.uScroll.value = (uniforms.uScroll.value + state.speed * dt) % (LENGTH * 60);
    streakUniforms.uStretch.value = Math.max(0, state.speed - p.speed) * 0.15;
    // 低く飛びながら、ポインターの向きへ少し機体を傾ける。
    stage.camera.position.set(stage.pointer.sx * 1.2 + power.lane, 2.6 + stage.pointer.sy * 1.1 + Math.sin(time * 0.4) * 0.15, 6);
    stage.camera.lookAt(stage.pointer.sx * 3 + power.lane * 0.6, 3.2 + stage.pointer.sy * 1.5, -30);
  });

  const settle = () => animate(state, { speed: p.speed, duration: 1600, ease: 'outExpo' });
  const roof = 18 * p.height;
  let held = false;
  let surging = false;
  // タップの仕掛け。減速しながら停電が奥へ走る（準備）→ 地上から明かりが灯り直して色が入れ替わり、加速する（山場）→ 速さと車線が戻る（余韻）。
  function blackout(event) {
    if (stage.reduced) return;
    const rect = container.getBoundingClientRect();
    const side = event?.clientX === undefined ? (Math.random() < 0.5 ? -0.7 : 0.7) : ((event.clientX - rect.left) / rect.width) * 2 - 1;
    utils.remove([power, state]);
    // 途中でもう一度タップされたら、灯り直しの済んだ色をそのまま今の色として扱う。
    if (power.rise > roof * 0.5) uniforms.uSwapFrom.value = uniforms.uSwapTo.value;
    uniforms.uSwapTo.value = 1 - uniforms.uSwapFrom.value;
    power.dark = 0;
    power.rise = -10;
    surging = true;
    animate(power, { dark: LENGTH, duration: 520, ease: 'inOutQuad' });
    animate(power, {
      rise: [-1, roof],
      duration: 1150,
      delay: 620,
      ease: 'outQuad',
      onComplete() {
        uniforms.uSwapFrom.value = uniforms.uSwapTo.value;
        power.dark = -10;
        power.rise = -10;
      },
    });
    animate(power, {
      lane: [
        { to: side * 1.5, duration: 600, ease: 'outQuad' },
        { to: 0, duration: 1800, ease: 'inOutQuad' },
      ],
    });
    animate(state, {
      speed: [
        { to: p.speed * 0.25, duration: 420, ease: 'outQuad' },
        { to: p.speed * 3.5 + 6, duration: 800, delay: 200, ease: 'inQuad' },
      ],
      onComplete() {
        surging = false;
        if (!held) settle();
      },
    });
  }
  const boostOn = (event) => {
    held = true;
    blackout(event);
  };
  const boostOff = () => {
    if (!held) return;
    held = false;
    if (!surging && !stage.reduced) settle();
  };
  container.addEventListener('pointerdown', boostOn);
  window.addEventListener('pointerup', boostOff);
  container.addEventListener('pointerleave', boostOff);
  const auto = p.preview && !stage.reduced ? setInterval(() => blackout(), 5000) : 0;

  return {
    blackout,
    destroy() {
      clearInterval(auto);
      container.removeEventListener('pointerdown', boostOn);
      window.removeEventListener('pointerup', boostOff);
      container.removeEventListener('pointerleave', boostOff);
      utils.remove([state, power]);
      stage.destroy();
    },
  };
}
