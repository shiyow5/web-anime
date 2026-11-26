import * as THREE from 'three';
import { animate, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { h, injectStyle } from '../../lib/dom.js';

export const meta = {
  id: 'solar-system',
  title: '太陽系の公転',
  category: 'science',
  libs: ['three', 'animejs'],
  description:
    '8 つの惑星が、実際の公転周期の比で太陽のまわりを回ります。軌道は実際の離心率を持つ楕円で、太陽に近いところでは速く動きます。距離と大きさは見やすいように縮めてあります。ポインターで傾きが変わり、クリックすると時間を早送りします。',
  params: {
    speed: { type: 'range', label: '1 秒で進む年数', min: 0.05, max: 5, step: 0.05, default: 0.6 },
    tilt: { type: 'range', label: '見下ろす角度（度）', min: 15, max: 85, step: 1, default: 58 },
    size: { type: 'range', label: '惑星の大きさ', min: 0.5, max: 2.5, step: 0.1, default: 1.2 },
    sun: { type: 'color', label: '太陽の色', default: '#ffcf70' },
    orbit: { type: 'color', label: '軌道の線の色', default: '#8fa3c8' },
    background: { type: 'color', label: '背景色', default: '#070810' },
    labels: { type: 'boolean', label: '名前を表示する', default: true },
  },
};

// a: 軌道長半径（天文単位）、period: 公転周期（年）、e: 離心率、radius: 地球を 1 とした半径、
// peri: 近日点の向き（度）、phase: 始めの位置（度）
export const PLANETS = [
  { name: 'Mercury', a: 0.387, period: 0.241, e: 0.206, radius: 0.383, peri: 77, phase: 170, color: '#b9a89a' },
  { name: 'Venus', a: 0.723, period: 0.615, e: 0.007, radius: 0.949, peri: 131, phase: 50, color: '#e8c98a' },
  { name: 'Earth', a: 1.0, period: 1.0, e: 0.017, radius: 1.0, peri: 103, phase: 300, color: '#5b9be0' },
  { name: 'Mars', a: 1.524, period: 1.881, e: 0.093, radius: 0.532, peri: 336, phase: 110, color: '#d9663f' },
  { name: 'Jupiter', a: 5.203, period: 11.86, e: 0.049, radius: 11.21, peri: 15, phase: 20, color: '#d8b48c' },
  { name: 'Saturn', a: 9.537, period: 29.46, e: 0.057, radius: 9.45, peri: 93, phase: 215, color: '#e6d3a0' },
  { name: 'Uranus', a: 19.19, period: 84.01, e: 0.046, radius: 4.01, peri: 171, phase: 120, color: '#9fe0e0' },
  { name: 'Neptune', a: 30.07, period: 164.8, e: 0.011, radius: 3.88, peri: 45, phase: 320, color: '#5878e8' },
];

// 距離は 0.42 乗で縮める。そのままだと内側の惑星が太陽に埋もれてしまう。
const displayDistance = (au) => au ** 0.42;
const displayRadius = (earthRadii) => 0.046 * Math.sqrt(earthRadii);
const OUTER = displayDistance(30.07) * 1.02;

// ケプラー方程式 M = E - e sin E をニュートン法で解き、軌道面での位置を返す。
export function keplerPosition(meanAnomaly, e) {
  let E = meanAnomaly;
  for (let i = 0; i < 5; i += 1) E -= (E - e * Math.sin(E) - meanAnomaly) / (1 - e * Math.cos(E));
  return { x: Math.cos(E) - e, y: Math.sqrt(1 - e * e) * Math.sin(E) };
}

const CSS = `
.ua-sol{position:absolute;inset:0;pointer-events:none;container-type:size;overflow:hidden;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:#dfe6f5}
.ua-sol__clock{position:absolute;left:3.2cqw;top:3.2cqw;font-size:clamp(8px,1.45cqw,13px);line-height:1.55;letter-spacing:.1em}
.ua-sol__clock b{display:block;font-weight:500;font-size:1.3em}
.ua-sol__clock span{opacity:.6}
.ua-sol__note{position:absolute;right:3.2cqw;bottom:3.2cqw;font-size:clamp(7px,1.15cqw,11px);letter-spacing:.1em;opacity:.5;text-align:right}
.ua-sol__label{position:absolute;left:0;top:0;font-size:clamp(7px,1.1cqw,11px);letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;opacity:.78;
  padding-left:.9em;border-left:1px solid currentColor;line-height:1.25;will-change:transform}
.ua-sol__label small{display:block;font-size:.85em;opacity:.65;letter-spacing:.08em;text-transform:none}
`;

function glowTexture(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  const c = new THREE.Color(color);
  const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
  gradient.addColorStop(0, `rgba(${rgb},1)`);
  gradient.addColorStop(0.18, `rgba(${rgb},.55)`);
  gradient.addColorStop(0.45, `rgba(${rgb},.12)`);
  gradient.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function orbitLine(planet, color) {
  const segments = 160;
  const points = [];
  const a = displayDistance(planet.a);
  for (let i = 0; i <= segments; i += 1) {
    const E = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(a * (Math.cos(E) - planet.e), 0, -a * Math.sqrt(1 - planet.e ** 2) * Math.sin(E)));
  }
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }),
  );
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 36, cameraZ: 13, background: p.background, preview: p.preview });
  const sizeScale = p.size * (p.preview ? 1.5 : 1);
  const state = { boost: 1, appear: stage.reduced ? 1 : 0 };
  let years = 0;

  // 遠くの星。
  const starCount = p.preview ? 250 : 700;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i += 1) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(60);
    starPositions.set([v.x, v.y, v.z], i * 3);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  stage.scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: '#c9d4f0', size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.6 })));

  const root = new THREE.Group();
  const system = new THREE.Group();
  root.add(system);
  stage.scene.add(root);

  const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(0.24, 32, 20), new THREE.MeshBasicMaterial({ color: p.sun }));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(p.sun), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.setScalar(1.9);
  system.add(sunMesh, glow, new THREE.PointLight(0xfff2dd, 3.2, 0, 0), new THREE.AmbientLight(0x8090b0, 0.35));

  const bodies = PLANETS.map((planet) => {
    const pivot = new THREE.Group(); // 近日点の向きに合わせて軌道を回す
    pivot.rotation.y = THREE.MathUtils.degToRad(planet.peri);
    const line = orbitLine(planet, p.orbit);
    const radius = displayRadius(planet.radius) * sizeScale;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), new THREE.MeshStandardMaterial({ color: planet.color, roughness: 0.75, metalness: 0 }));
    pivot.add(line, mesh);
    if (planet.name === 'Saturn') {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius * 1.35, radius * 2.2, 48),
        new THREE.MeshBasicMaterial({ color: '#cdbb8d', side: THREE.DoubleSide, transparent: true, opacity: 0.6 }),
      );
      ring.rotation.x = Math.PI / 2 - 0.47;
      mesh.add(ring);
    }
    let moon = null;
    if (planet.name === 'Earth') {
      moon = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.3, 10, 8), new THREE.MeshStandardMaterial({ color: '#c8c8c8', roughness: 0.9 }));
      mesh.add(moon);
    }
    system.add(pivot);
    return { planet, line, mesh, moon, radius, a: displayDistance(planet.a), label: null };
  });

  // 小惑星帯。火星と木星のあいだ（2.2〜3.3 天文単位）を、ケプラーの第 3 法則の速さで回る。
  const beltCount = p.preview ? 220 : 600;
  const belt = Array.from({ length: beltCount }, () => {
    const au = 2.2 + Math.random() * 1.1;
    return { r: displayDistance(au), rate: (Math.PI * 2) / au ** 1.5, phase: Math.random() * Math.PI * 2, y: (Math.random() - 0.5) * 0.05 };
  });
  const beltGeometry = new THREE.BufferGeometry();
  beltGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(beltCount * 3), 3));
  const beltPoints = new THREE.Points(beltGeometry, new THREE.PointsMaterial({ color: '#9c8f80', size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.55 }));
  beltPoints.frustumCulled = false;
  system.add(beltPoints);

  // 表示。
  const yearText = h('b', { text: 'T + 0.00 yr' });
  const hud = h(
    'div',
    { class: 'ua-sol' },
    h('div', { class: 'ua-sol__clock' }, yearText, h('span', { text: `1 s = ${p.speed.toFixed(2)} yr` })),
    p.preview ? null : h('div', { class: 'ua-sol__note', text: 'distance ∝ a^0.42 · radius ∝ √R' }),
  );
  if (p.labels && !p.preview) {
    for (const body of bodies) {
      body.label = h('div', { class: 'ua-sol__label', style: { color: body.planet.color } }, body.planet.name, h('small', { text: `${body.planet.period} yr` }));
      hud.appendChild(body.label);
    }
  }
  container.appendChild(hud);

  function place(time) {
    for (const body of bodies) {
      const { planet } = body;
      const mean = (time / planet.period) * Math.PI * 2 + THREE.MathUtils.degToRad(planet.phase);
      const { x, y } = keplerPosition(mean, planet.e);
      // 北から見て反時計回りになるように、z を反転する。
      body.mesh.position.set(body.a * x, 0, -body.a * y);
      if (body.moon) {
        const angle = (time / 0.0748) * Math.PI * 2;
        body.moon.position.set(Math.cos(angle) * body.radius * 2.4, 0, -Math.sin(angle) * body.radius * 2.4);
      }
    }
    const array = beltGeometry.attributes.position.array;
    for (let i = 0; i < beltCount; i += 1) {
      const rock = belt[i];
      const angle = rock.phase + rock.rate * time;
      array[i * 3] = Math.cos(angle) * rock.r;
      array[i * 3 + 1] = rock.y;
      array[i * 3 + 2] = -Math.sin(angle) * rock.r;
    }
    beltGeometry.attributes.position.needsUpdate = true;
  }

  const tiltRad = THREE.MathUtils.degToRad(p.tilt);
  stage.onResize(() => {
    const view = stage.viewport();
    root.scale.setScalar(Math.min(view.width / (OUTER * 2.12), view.height / (OUTER * 2 * Math.sin(tiltRad) + 1.3)));
  });

  const projected = new THREE.Vector3();
  let shownYear = '';
  stage.onFrame((time, dt) => {
    years += dt * p.speed * state.boost;
    place(years);
    root.rotation.x = tiltRad - stage.pointer.sy * 0.3;
    root.rotation.z = stage.pointer.sx * 0.12;
    system.rotation.y = time * 0.02 + stage.pointer.sx * 0.5;
    glow.scale.setScalar(1.9 + Math.sin(time * 1.7) * 0.06);
    bodies.forEach((body, index) => {
      const shown = Math.min(1, Math.max(0, state.appear * (bodies.length + 2) - index));
      body.line.material.opacity = 0.42 * shown;
      body.mesh.scale.setScalar(Math.max(shown, 1e-3));
      if (body.label) {
        body.mesh.getWorldPosition(projected).project(stage.camera);
        const x = (projected.x * 0.5 + 0.5) * stage.size.width + 6;
        const y = (-projected.y * 0.5 + 0.5) * stage.size.height - 6;
        body.label.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
        body.label.style.opacity = String(0.78 * shown);
      }
    });
    const text = years.toFixed(2);
    if (text !== shownYear) {
      shownYear = text;
      yearText.textContent = `T + ${text} yr`;
    }
  });

  function fastForward() {
    if (stage.reduced) return;
    animate(state, { boost: [{ to: 14, duration: 350, ease: 'outQuad' }, { to: 1, duration: 1800, ease: 'inOutQuad' }] });
  }
  container.addEventListener('click', fastForward);
  if (!stage.reduced) animate(state, { appear: [0, 1], duration: 2200, ease: 'outQuad' });

  return {
    fastForward,
    destroy() {
      container.removeEventListener('click', fastForward);
      utils.remove(state);
      hud.remove();
      stage.destroy();
    },
  };
}
