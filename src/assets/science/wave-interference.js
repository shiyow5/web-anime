import * as THREE from 'three';
import { animate, createTimer, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { fullscreenVertex } from '../../lib/glsl.js';
import { h, injectStyle } from '../../lib/dom.js';

export const meta = {
  id: 'wave-interference',
  title: '波の干渉',
  category: 'science',
  libs: ['three', 'animejs'],
  description:
    '2 つの波源から同じ波長の波が輪になって広がり、重なります。2 つの波源からの距離の差が波長の整数倍になる場所では強め合い、半波長ずれる場所では打ち消し合って、双曲線の縞ができます。ポインターを動かすと片方の波源が付いてきて、縞の本数と向きが変わります。タップすると、その場所に石を落としたように水面がへこんで、3 つめの波が輪になって広がります。波の先頭には細い輪が付き、もとの 2 つの波と重なって縞を乱しながら、数秒かけて弱まっていきます。上の帯は、その位置での波の強さです。',
  params: {
    wavelength: { type: 'range', label: '波長', min: 0.06, max: 0.4, step: 0.01, default: 0.16 },
    separation: { type: 'range', label: '波源の間隔', min: 0.1, max: 1.6, step: 0.02, default: 0.62 },
    speed: { type: 'range', label: '波の速さ', min: 0, max: 3, step: 0.1, default: 1 },
    trough: { type: 'color', label: '谷の色', default: '#0a2540' },
    crest: { type: 'color', label: '山の色', default: '#dff7f2' },
    accent: { type: 'color', label: '波源と節の色', default: '#ff9f43' },
    nodes: { type: 'boolean', label: '打ち消し合う線を描く', default: true },
  },
};

const fragmentShader = /* glsl */ `
precision highp float;
uniform vec2 uA;
uniform vec2 uB;
uniform float uTime;
uniform float uK;
uniform float uOmega;
uniform float uAspect;
uniform float uNodes;
uniform float uReveal;
uniform vec4 uDrops[3];
uniform vec3 uTrough;
uniform vec3 uCrest;
uniform vec3 uAccent;
varying vec2 vUv;

// 波源から r だけ離れた場所の振幅。平面を広がる波は、およそ 1/√r で弱まる。
float falloff(float r){ return 1.0 / sqrt(1.0 + r * 5.0); }

void main(){
  const float STRIP = 0.925;
  vec2 p = (vUv - 0.5) * 2.0 * vec2(uAspect, 1.0);
  bool strip = vUv.y > STRIP;
  if (strip) p.y = STRIP * 2.0 - 1.0;

  vec2 da = p - uA;
  vec2 db = p - uB;
  float ra = length(da);
  float rb = length(db);
  float aa = falloff(ra) * smoothstep(uReveal, uReveal - 0.25, ra);
  float ab = falloff(rb) * smoothstep(uReveal, uReveal - 0.25, rb);
  float pa = uK * ra - uOmega * uTime;
  float pb = uK * rb - uOmega * uTime;
  float height = aa * cos(pa) + ab * cos(pb);
  // タップで落とした波。先頭より外へはまだ届かず、時間とともに弱まる。
  float fronts = 0.0;
  for (int i = 0; i < 3; i++) {
    float age = uTime - uDrops[i].z;
    if (age < 0.0 || age > 7.0) continue;
    float rc = length(p - uDrops[i].xy);
    float front = age * uOmega / uK * 1.6 + 0.02;
    float amp = 2.2 * exp(-age * 0.75) * smoothstep(0.0, 0.12, age);
    height += amp * falloff(rc) * cos(uK * rc - uOmega * 1.6 * age) * smoothstep(front, front - 0.22, rc);
    // 落ちた瞬間のへこみ。
    height -= 1.6 * exp(-age * 9.0) * smoothstep(0.16, 0.0, rc);
    fronts += smoothstep(0.014, 0.0, abs(rc - front)) * exp(-age * 0.9);
  }
  // 時間で平均した振幅。2 つの波の位相差だけで決まる。
  float envelope = sqrt(max(aa * aa + ab * ab + 2.0 * aa * ab * cos(uK * (ra - rb)), 0.0));
  float total = aa + ab + 1e-4;

  vec3 mid = mix(uTrough, uCrest, 0.42) * vec3(0.55, 0.95, 1.05);
  vec3 color = height > 0.0 ? mix(mid, uCrest, smoothstep(0.0, 1.0, height)) : mix(mid, uTrough, smoothstep(0.0, 0.9, -height));

  // 水面の傾きから、光の照り返しを足す。
  vec2 slope = -aa * uK * sin(pa) * da / max(ra, 1e-3) - ab * uK * sin(pb) * db / max(rb, 1e-3);
  vec3 normal = normalize(vec3(-slope * 0.03, 1.0));
  float shine = pow(max(dot(normal, normalize(vec3(-0.35, 0.5, 0.8))), 0.0), 40.0);
  color += uCrest * shine * 0.35;

  // 打ち消し合う線。
  float node = smoothstep(0.16, 0.02, envelope / total) * smoothstep(0.05, 0.2, min(ra, rb));
  color = mix(color, mix(color, uAccent, 0.75), node * uNodes * 0.8);

  if (!strip) color = mix(color, uAccent, clamp(fronts, 0.0, 1.0) * 0.85);

  // 波源の印。
  float ring = min(abs(ra - 0.035), abs(rb - 0.035));
  color = mix(color, uAccent, smoothstep(0.008, 0.002, ring));
  color = mix(color, uAccent, smoothstep(0.014, 0.008, min(ra, rb)));

  if (strip) {
    // 検出器の帯。振幅の 2 乗（強さ）を明るさで示す。
    float intensity = envelope * envelope / (total * total);
    color = mix(uTrough * 0.35, uCrest, pow(intensity, 0.8));
    color = mix(color, uAccent, smoothstep(0.004, 0.0, vUv.y - STRIP));
  }
  // 四隅を少し落とす。
  color *= 1.0 - 0.28 * dot(vUv - 0.5, vUv - 0.5) * 2.0;
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

const CSS = `
.ua-wi{position:absolute;inset:0;pointer-events:none;container-type:size;overflow:hidden;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:var(--ua-ink)}
.ua-wi__info{position:absolute;left:3.2cqw;bottom:3.2cqw;font-size:clamp(8px,1.45cqw,13px);line-height:1.55;letter-spacing:.08em;text-shadow:0 0 .5em var(--ua-shade)}
.ua-wi__info b{display:block;font-weight:500;font-size:1.2em}
.ua-wi__info span{display:block;opacity:.8}
.ua-wi__tag{position:absolute;left:0;top:0;font-size:clamp(8px,1.4cqw,13px);color:var(--ua-accent);text-shadow:0 0 .4em var(--ua-shade);letter-spacing:.05em}
.ua-wi__strip{position:absolute;right:3.2cqw;top:9cqh;font-size:clamp(7px,1.15cqw,11px);letter-spacing:.12em;opacity:.75;text-shadow:0 0 .5em var(--ua-shade)}
`;

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { preview: p.preview, antialias: false, maxDpr: 1.5, startTime: 4 });
  const uniforms = {
    uA: { value: new THREE.Vector2(-p.separation / 2, 0) },
    uB: { value: new THREE.Vector2(p.separation / 2, 0) },
    uTime: { value: 0 },
    uK: { value: (Math.PI * 2) / p.wavelength },
    uOmega: { value: Math.PI * 2 * 1.1 * p.speed },
    uAspect: { value: 1 },
    uNodes: { value: p.nodes ? 1 : 0 },
    uReveal: { value: stage.reduced ? 9 : 0 },
    uDrops: { value: [0, 1, 2].map(() => new THREE.Vector4(0, 0, -100, 0)) },
    uTrough: { value: new THREE.Color(p.trough) },
    uCrest: { value: new THREE.Color(p.crest) },
    uAccent: { value: new THREE.Color(p.accent) },
  };
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: fullscreenVertex, fragmentShader, depthTest: false, depthWrite: false }),
  );
  quad.frustumCulled = false;
  stage.scene.add(quad);

  const hud = h('div', { class: 'ua-wi', style: { '--ua-ink': p.crest, '--ua-accent': p.accent, '--ua-shade': p.trough } });
  const ratioText = h('b');
  const fringeText = h('span');
  const tagA = h('div', { class: 'ua-wi__tag', text: 'S₁' });
  const tagB = h('div', { class: 'ua-wi__tag', text: 'S₂' });
  hud.append(
    h('div', { class: 'ua-wi__info' }, ratioText, fringeText, p.preview ? null : h('span', { text: `λ = ${p.wavelength.toFixed(2)}` })),
    tagA,
    tagB,
    h('div', { class: 'ua-wi__strip', text: 'I ∝ A²' }),
  );
  container.appendChild(hud);

  stage.onResize(({ width, height }) => {
    uniforms.uAspect.value = width / height;
  });

  function placeTag(tag, source) {
    const x = (source.x / uniforms.uAspect.value) * 0.5 + 0.5;
    const y = 0.5 - source.y * 0.5;
    tag.style.transform = `translate(${(x * stage.size.width + 8).toFixed(1)}px,${(y * stage.size.height - 20).toFixed(1)}px)`;
  }

  let shown = '';
  stage.onFrame((time) => {
    uniforms.uTime.value = time;
    const a = uniforms.uA.value;
    const b = uniforms.uB.value;
    if (stage.pointer.inside) {
      // ポインターのある場所へ、片方の波源を動かす。上の帯には入れない。
      a.set(stage.pointer.sx * uniforms.uAspect.value, Math.min(stage.pointer.sy, 0.7));
      b.set(p.separation / 2, 0);
    } else {
      // 触っていないときは、間隔をゆっくり変えて、縞が増えたり減ったりする様子を見せる。
      const half = (p.separation / 2) * (1 + 0.35 * Math.sin(time * 0.35));
      const lift = Math.sin(time * 0.23) * 0.12;
      a.set(-half, -lift);
      b.set(half, lift);
    }
    placeTag(tagA, a);
    placeTag(tagB, b);
    const ratio = a.distanceTo(b) / p.wavelength;
    const text = ratio.toFixed(1);
    if (text !== shown) {
      shown = text;
      ratioText.textContent = `d / λ = ${text}`;
      // 距離の差が (m + 1/2)λ になる線は、|m + 1/2| < d/λ のぶんだけある。
      fringeText.textContent = `nodal lines ${2 * Math.floor(ratio + 0.5)}`;
    }
  });

  // タップした場所に波を落とす。3 つまで重ねられる。
  let nextDrop = 0;
  function drop(x = 0, y = 0) {
    if (stage.reduced) return;
    uniforms.uDrops.value[nextDrop].set(x * uniforms.uAspect.value, Math.min(y, 0.75), uniforms.uTime.value, 0);
    nextDrop = (nextDrop + 1) % 3;
  }
  const onPointerDown = (event) => {
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    drop(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
  };
  container.addEventListener('pointerdown', onPointerDown);
  const auto = p.preview && !stage.reduced ? createTimer({ duration: 4200, loop: true, onLoop: () => drop(Math.random() * 1.4 - 0.7, Math.random() * 1.2 - 0.7) }) : null;

  if (!stage.reduced) animate(uniforms.uReveal, { value: [0, 4.5], duration: 2400, ease: 'outQuad' });

  return {
    drop,
    destroy() {
      auto?.pause();
      container.removeEventListener('pointerdown', onPointerDown);
      utils.remove(uniforms.uReveal);
      hud.remove();
      stage.destroy();
    },
  };
}
