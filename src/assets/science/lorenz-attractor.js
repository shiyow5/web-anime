import * as THREE from 'three';
import { animate, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { h, injectStyle } from '../../lib/dom.js';

export const meta = {
  id: 'lorenz-attractor',
  title: 'ローレンツ・アトラクター',
  category: 'science',
  libs: ['three', 'animejs'],
  description:
    'ローレンツ方程式を解いて、蝶の羽のような軌跡を描きます。ほんの少しだけ違う場所から出発した点が、しばらくは重なって進み、やがてまったく別の道を行く様子が分かります。ρ を 24.7 より小さくすると、乱れが消えて渦の中心へ落ち着きます。クリックすると、軌跡が頭のほうから消えて箱が勢いよく回り、触った位置に応じた新しい出発点へ全部の点が集まります。そこから点が明るく弾けて早回しで飛び出し、重なっていた軌跡が分かれていく様子を見せてから、元の速さに戻ります。',
  params: {
    rho: { type: 'range', label: 'ρ（レイリー数）', min: 14, max: 45, step: 0.5, default: 28 },
    trails: { type: 'range', label: '軌跡の本数', min: 1, max: 5, step: 1, default: 3 },
    length: { type: 'range', label: '尾の長さ', min: 600, max: 7000, step: 200, default: 3600 },
    speed: { type: 'range', label: '進む速さ', min: 0.2, max: 3, step: 0.1, default: 1 },
    colorA: { type: 'color', label: '軌跡の色 1', default: '#ff6a3d' },
    colorB: { type: 'color', label: '軌跡の色 2', default: '#6fd6ff' },
    background: { type: 'color', label: '背景色', default: '#08070d' },
  },
};

const SIGMA = 10;
const BETA = 8 / 3;
const STEP = 0.006;

// ローレンツ方程式 dx/dt = σ(y − x), dy/dt = x(ρ − z) − y, dz/dt = xy − βz を、
// 4 次のルンゲ＝クッタ法で 1 刻み進める。s は [x, y, z] で、その場で書き換える。
export function lorenzStep(s, rho, dt = STEP) {
  const f = (x, y, z) => [SIGMA * (y - x), x * (rho - z) - y, x * y - BETA * z];
  const [x, y, z] = s;
  const k1 = f(x, y, z);
  const k2 = f(x + (k1[0] * dt) / 2, y + (k1[1] * dt) / 2, z + (k1[2] * dt) / 2);
  const k3 = f(x + (k2[0] * dt) / 2, y + (k2[1] * dt) / 2, z + (k2[2] * dt) / 2);
  const k4 = f(x + k3[0] * dt, y + k3[1] * dt, z + k3[2] * dt);
  s[0] = x + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
  s[1] = y + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
  s[2] = z + (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
  return s;
}

const vertexShader = /* glsl */ `
attribute float aAge;
varying float vAge;
void main(){
  vAge = aAge;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uReveal;
uniform float uGain;
varying float vAge;
void main(){
  // vAge は 0 が尾の先、1 が頭。頭に近いほど明るい。
  float a = (0.06 + 0.94 * pow(vAge, 2.2)) * step(vAge, uReveal) * uGain;
  vec3 color = mix(uColor, vec3(1.0), smoothstep(0.985, 1.0, vAge) * 0.7);
  gl_FragColor = vec4(color * a, a);
  #include <colorspace_fragment>
}
`;

const CSS = `
.ua-lz{position:absolute;inset:0;pointer-events:none;container-type:size;overflow:hidden;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:#e6e1ea}
.ua-lz__info{position:absolute;left:3.2cqw;top:3.2cqw;font-size:clamp(8px,1.45cqw,13px);line-height:1.55;letter-spacing:.08em}
.ua-lz__info b{display:block;font-weight:500;font-size:1.15em}
.ua-lz__info span{display:block;opacity:.65}
.ua-lz__read{position:absolute;right:3.2cqw;bottom:3.2cqw;font-size:clamp(8px,1.35cqw,12px);line-height:1.55;letter-spacing:.06em;text-align:right;white-space:pre;font-variant-numeric:tabular-nums}
.ua-lz__read span{display:block;opacity:.7}
`;

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, {
    fov: 40,
    cameraZ: 7,
    background: p.background,
    preview: p.preview,
    bloom: p.preview ? null : { strength: 0.55, radius: 0.5, threshold: 0.25 },
  });
  const trailCount = Math.round(p.trails);
  const length = Math.round(p.length * (p.preview ? 0.6 : 1));
  const centreZ = p.rho - 1;
  const unit = 1 / (p.rho * 0.5); // 方程式の座標を、画面の大きさへ縮める係数
  const reveal = { value: stage.reduced ? 1 : 0 };

  const world = new THREE.Group();
  const root = new THREE.Group();
  root.add(world);
  stage.scene.add(root);

  // 方程式の (x, y, z) を、z が上になるように three.js の座標へ移す。
  const toScene = (s, out, offset) => {
    out[offset] = s[0] * unit;
    out[offset + 1] = (s[2] - centreZ) * unit;
    out[offset + 2] = s[1] * unit;
  };

  const ages = new Float32Array(length);
  for (let i = 0; i < length; i += 1) ages[i] = i / (length - 1);
  const colorA = new THREE.Color(p.colorA);
  const colorB = new THREE.Color(p.colorB);
  const floorY = -centreZ * unit - 0.15;

  const trails = Array.from({ length: trailCount }, (_, index) => {
    const positions = new Float32Array(length * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aAge', new THREE.BufferAttribute(ages, 1));
    const color = new THREE.Color().lerpColors(colorA, colorB, trailCount > 1 ? index / (trailCount - 1) : 0);
    const make = (gain) =>
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: color }, uReveal: reveal, uGain: { value: gain } },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
    const line = new THREE.Line(geometry, make(1));
    line.frustumCulled = false;
    // 床に落とした影。xy 平面への投影になる。
    const shadow = new THREE.Line(geometry, make(0.22));
    shadow.frustumCulled = false;
    shadow.scale.y = 1e-4;
    shadow.position.y = floorY;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color('#ffffff'), 0.5) }));
    world.add(line, shadow, head);
    return { s: [0, 0, 0], positions, geometry, head };
  });

  function restart(prefill, x0 = 1, y0 = 1) {
    trails.forEach((trail, index) => {
      // 出発点の差は 1 万分の 1 ずつ。
      trail.s = [x0 + index * 1e-4, y0, centreZ * 0.6];
      if (prefill) {
        // 過渡的な部分を捨ててから、尾の長さぶんを先に計算しておく。
        for (let i = 0; i < 500; i += 1) lorenzStep(trail.s, p.rho);
        for (let i = 0; i < length; i += 1) toScene(lorenzStep(trail.s, p.rho), trail.positions, i * 3);
      } else {
        for (let i = 0; i < length; i += 1) toScene(trail.s, trail.positions, i * 3);
      }
      trail.geometry.attributes.position.needsUpdate = true;
    });
  }
  restart(true);

  // 枠と、2 つの不動点 C±（渦の中心）。
  const size = new THREE.Vector3(3.4, Math.max(2.4, (centreZ + p.rho * 0.85) * unit), 4);
  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)),
    new THREE.LineBasicMaterial({ color: '#b9aec9', transparent: true, opacity: 0.13 }),
  );
  box.position.y = floorY + size.y / 2;
  const fixed = Math.sqrt(BETA * (p.rho - 1));
  const fixedPoints = [];
  for (const sign of [-1, 1]) {
    const x = sign * fixed * unit;
    const z = sign * fixed * unit;
    const d = 0.07;
    fixedPoints.push(x - d, 0, z, x + d, 0, z, x, -d, z, x, d, z, x, 0, z - d, x, 0, z + d);
  }
  const fixedGeometry = new THREE.BufferGeometry();
  fixedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(fixedPoints, 3));
  world.add(box, new THREE.LineSegments(fixedGeometry, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 })));
  world.position.y = -(floorY + size.y / 2);

  const coordText = h('span');
  const gapText = h('span');
  const hud = h(
    'div',
    { class: 'ua-lz' },
    h('div', { class: 'ua-lz__info' }, h('b', { text: `σ = ${SIGMA}  ρ = ${p.rho}  β = 8/3` }), p.preview ? null : h('span', { text: 'ẋ = σ(y−x)  ẏ = x(ρ−z)−y  ż = xy−βz' }), h('span', { text: `RK4  Δt = ${STEP}` })),
    h('div', { class: 'ua-lz__read' }, coordText, gapText),
  );
  container.appendChild(hud);

  stage.onResize(() => {
    const view = stage.viewport();
    root.scale.setScalar(Math.min(1.15, view.width / 5.2, view.height / 4.7));
  });

  let carry = 0;
  let frames = 0;
  // 出発し直すときの動き。whirl は箱の回転の勢い、rush は計算の早回し、pop は点の大きさ。
  const fx = { whirl: 0, rush: 0, pop: 0 };
  let whirled = 0;
  stage.onFrame((time, dt) => {
    carry += dt * 60 * 3 * p.speed * (1 + fx.rush);
    whirled += dt * fx.whirl * 5;
    const steps = Math.min(40, Math.floor(carry));
    carry -= steps;
    for (const trail of trails) {
      if (steps > 0) {
        trail.positions.copyWithin(0, steps * 3);
        for (let i = 0; i < steps; i += 1) toScene(lorenzStep(trail.s, p.rho), trail.positions, (length - steps + i) * 3);
        trail.geometry.attributes.position.needsUpdate = true;
      }
      const last = (length - 1) * 3;
      trail.head.position.set(trail.positions[last], trail.positions[last + 1], trail.positions[last + 2]);
      trail.head.visible = reveal.value > 0.99;
      trail.head.scale.setScalar(1 + fx.pop * 2.6);
    }
    world.rotation.y = time * 0.16 + whirled;
    root.rotation.x = 0.22 - stage.pointer.sy * 0.4;
    root.rotation.y = stage.pointer.sx * 0.7;
    frames += 1;
    if (frames % 6 === 1) {
      const [x, y, z] = trails[0].s;
      const fmt = (n) => n.toFixed(2).padStart(7, ' ');
      coordText.textContent = `x${fmt(x)}  y${fmt(y)}  z${fmt(z)}`;
      if (trails.length > 1) {
        const o = trails[1].s;
        gapText.textContent = `|Δ₁₂| = ${Math.hypot(x - o[0], y - o[1], z - o[2]).toExponential(2)}`;
      }
    }
  });

  function relaunch() {
    if (stage.reduced) return;
    const { x, y } = stage.pointer;
    utils.remove(reveal);
    utils.remove(fx);
    // 軌跡を頭のほうから消しながら、箱を回す。
    // 消えきったところで、触った位置に応じた出発点へ集めて放す。
    animate(reveal, {
      value: 0,
      duration: 320,
      ease: 'inQuad',
      onComplete() {
        restart(false, 1 + x * 9, 1 + y * 9);
        reveal.value = 1;
      },
    });
    animate(fx, {
      whirl: [{ to: 1, duration: 320, ease: 'outQuad' }, { to: 0, duration: 1500, ease: 'outCubic' }],
      rush: [{ to: -0.9, duration: 320 }, { to: 2.4, duration: 200, ease: 'outQuad' }, { to: 0, duration: 2600, ease: 'inOutQuad' }],
      pop: [{ to: 0, duration: 320 }, { to: 1, duration: 110, ease: 'outQuad' }, { to: 0, duration: 1300, ease: 'outElastic(1, .4)' }],
    });
  }
  container.addEventListener('click', relaunch);
  if (!stage.reduced) animate(reveal, { value: [0, 1], duration: 2600, ease: 'inOutQuad' });

  return {
    relaunch,
    destroy() {
      container.removeEventListener('click', relaunch);
      utils.remove(reveal);
      utils.remove(fx);
      hud.remove();
      stage.destroy();
    },
  };
}
