import * as THREE from 'three';
import { animate, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { h, injectStyle } from '../../lib/dom.js';

export const meta = {
  id: 'dna-helix',
  title: 'DNA の二重らせん',
  category: 'science',
  libs: ['three', 'animejs'],
  description:
    '2 本の鎖と、それをつなぐ塩基対が、右巻きのらせんになって回ります。A と T、G と C が必ず組になり、塩基ごとに色が違います。ポインターを左右に動かすと、1 塩基対あたりのねじれ角が変わり、らせんが締まったり緩んだりします。',
  params: {
    scheme: {
      type: 'select',
      label: '塩基の配色',
      options: [
        { value: 'atlas', label: '図鑑' },
        { value: 'neon', label: '蛍光' },
        { value: 'ink', label: '淡彩' },
      ],
      default: 'atlas',
    },
    backbone: { type: 'color', label: '鎖の色', default: '#e9e2cf' },
    background: { type: 'color', label: '背景色', default: '#0a1a20' },
    pairs: { type: 'range', label: '塩基対の数', min: 12, max: 44, step: 1, default: 30 },
    twist: { type: 'range', label: 'ねじれ角（度）', min: 20, max: 50, step: 0.5, default: 34.3 },
    spin: { type: 'range', label: '回る速さ', min: 0, max: 2, step: 0.05, default: 0.45 },
  },
};

const SCHEMES = {
  atlas: { A: '#58c98a', T: '#e8604c', G: '#f2b84b', C: '#4a90d9' },
  neon: { A: '#3dffb0', T: '#ff3d8b', G: '#ffe93d', C: '#3dc8ff' },
  ink: { A: '#a8d5ba', T: '#e6a4a0', G: '#ead7a0', C: '#a0bfe6' },
};
const PARTNER = { A: 'T', T: 'A', G: 'C', C: 'G' };
const PURINE = { A: true, G: true };

// B 型 DNA の寸法の比。半径 1 nm に対して、塩基対 1 つぶんの進みが 0.34 nm。
const RADIUS = 0.8;
const RISE = RADIUS * 0.34;
// 2 本の鎖は真向かいではなく、少しずれて付く。これで広い溝と狭い溝ができる。
const GROOVE = 2.35;

const CSS = `
.ua-dna{position:absolute;inset:0;pointer-events:none;container-type:size;overflow:hidden;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:var(--ua-ink)}
.ua-dna__info{position:absolute;left:3.2cqw;top:3.2cqw;font-size:clamp(8px,1.45cqw,13px);line-height:1.55;letter-spacing:.08em}
.ua-dna__info b{display:block;font-weight:600;font-size:1.25em;letter-spacing:.16em}
.ua-dna__info span{opacity:.72;display:block}
.ua-dna__legend{position:absolute;right:3.2cqw;bottom:3.2cqw;display:flex;gap:1.3em;font-size:clamp(8px,1.45cqw,13px);letter-spacing:.08em}
.ua-dna__legend i{display:inline-block;width:.7em;height:.7em;border-radius:50%;margin-right:.45em;vertical-align:-.02em}
.ua-dna__seq{position:absolute;left:3.2cqw;bottom:3.2cqw;font-size:clamp(7px,1.2cqw,11px);letter-spacing:.2em;opacity:.55;white-space:nowrap}
`;

// 塩基の並びを、種から決まる擬似乱数で作る。
function makeSequence(count) {
  let seed = 20231;
  const letters = 'ATGC';
  return Array.from({ length: count }, () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return letters[(seed >> 16) & 3];
  });
}

const smooth = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 40, cameraZ: 9, background: p.background, preview: p.preview });
  const count = Math.round(p.pairs);
  const sequence = makeSequence(count);
  const palette = SCHEMES[p.scheme];
  const state = { grow: stage.reduced ? 1 : 0 };

  const hud = h('div', { class: 'ua-dna', style: { '--ua-ink': p.backbone } });
  const twistText = h('span');
  const turnText = h('span');
  hud.append(
    h('div', { class: 'ua-dna__info' }, h('b', { text: 'B-DNA' }), twistText, turnText, h('span', { text: 'rise 0.34 nm / bp' })),
    h('div', { class: 'ua-dna__legend' }, Object.entries(palette).map(([base, color]) => h('span', {}, h('i', { style: { background: color } }), base))),
  );
  if (!p.preview) hud.append(h('div', { class: 'ua-dna__seq', text: `5'-${sequence.join('')}-3'` }));
  container.appendChild(hud);

  stage.scene.add(new THREE.HemisphereLight(0xffffff, new THREE.Color(p.background), 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(2, 4, 6);
  const rim = new THREE.DirectionalLight(new THREE.Color(palette.C), 1.4);
  rim.position.set(-4, -2, -3);
  stage.scene.add(key, rim);

  const backboneMaterial = new THREE.MeshStandardMaterial({ color: p.backbone, roughness: 0.32, metalness: 0.05 });
  const beads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.105, 18, 12), backboneMaterial, count * 2);
  const links = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.042, 0.042, 1, 8), backboneMaterial, (count - 1) * 2);
  const bases = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.052, 0.052, 1, 10),
    new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0 }),
    count * 2,
  );
  const tint = new THREE.Color();
  sequence.forEach((base, i) => {
    bases.setColorAt(i * 2, tint.set(palette[base]));
    bases.setColorAt(i * 2 + 1, tint.set(palette[PARTNER[base]]));
  });
  for (const mesh of [beads, links, bases]) mesh.frustumCulled = false;

  // 中心軸と、10 塩基対ごとの目盛り。
  const length = (count - 1) * RISE;
  const axisPoints = [new THREE.Vector3(-length / 2 - 0.5, 0, 0), new THREE.Vector3(length / 2 + 0.5, 0, 0)];
  const axis = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(axisPoints),
    new THREE.LineDashedMaterial({ color: p.backbone, transparent: true, opacity: 0.35, dashSize: 0.08, gapSize: 0.07 }),
  );
  axis.computeLineDistances();

  const helix = new THREE.Group();
  helix.add(beads, links, bases, axis);
  const root = new THREE.Group();
  root.add(helix);
  root.rotation.z = 0.3;
  stage.scene.add(root);

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const pointsA = Array.from({ length: count }, () => new THREE.Vector3());
  const pointsB = Array.from({ length: count }, () => new THREE.Vector3());
  const grown = new Float32Array(count);

  function placeRod(mesh, index, from, to, thickness) {
    dir.subVectors(to, from);
    const len = dir.length();
    mid.addVectors(from, to).multiplyScalar(0.5);
    quaternion.setFromUnitVectors(up, dir.divideScalar(len || 1));
    matrix.compose(mid, quaternion, scale.set(thickness, Math.max(len, 1e-4), thickness));
    mesh.setMatrixAt(index, matrix);
  }

  function layout(twistRad) {
    const centre = (count - 1) / 2;
    for (let i = 0; i < count; i += 1) {
      const g = smooth(state.grow * (centre + 4) - Math.abs(i - centre));
      grown[i] = g;
      const angle = (i - centre) * twistRad;
      const x = (i - centre) * RISE;
      const r = RADIUS * (0.25 + 0.75 * g);
      pointsA[i].set(x, Math.cos(angle) * r, Math.sin(angle) * r);
      pointsB[i].set(x, Math.cos(angle + GROOVE) * r, Math.sin(angle + GROOVE) * r);
      quaternion.identity();
      matrix.compose(pointsA[i], quaternion, scale.setScalar(g));
      beads.setMatrixAt(i * 2, matrix);
      matrix.compose(pointsB[i], quaternion, scale.setScalar(g));
      beads.setMatrixAt(i * 2 + 1, matrix);
      // 塩基対。プリン（A・G）は大きいので、継ぎ目をピリミジン側へ寄せる。
      const split = PURINE[sequence[i]] ? 0.57 : 0.43;
      const joint = new THREE.Vector3().lerpVectors(pointsA[i], pointsB[i], split);
      placeRod(bases, i * 2, pointsA[i], joint, g);
      placeRod(bases, i * 2 + 1, joint, pointsB[i], g);
    }
    for (let i = 0; i < count - 1; i += 1) {
      const g = Math.min(grown[i], grown[i + 1]);
      placeRod(links, i * 2, pointsA[i], pointsA[i + 1], g);
      placeRod(links, i * 2 + 1, pointsB[i], pointsB[i + 1], g);
    }
    beads.instanceMatrix.needsUpdate = true;
    links.instanceMatrix.needsUpdate = true;
    bases.instanceMatrix.needsUpdate = true;
  }

  let shownTwist = '';
  function showTwist(degrees) {
    const text = degrees.toFixed(1);
    if (text === shownTwist) return;
    shownTwist = text;
    twistText.textContent = `twist ${text}° / bp`;
    turnText.textContent = `${(360 / degrees).toFixed(1)} bp / turn`;
  }

  stage.onResize(() => {
    const view = stage.viewport();
    const span = length + 1.4;
    root.scale.setScalar(Math.min(1.5, view.width / (span * 0.98), view.height / (span * 0.32 + 2.4)));
  });

  let twistNow = p.twist;
  stage.onFrame((time, dt) => {
    // ポインターが無いとき（一覧の小さな枠など）は、ねじれをゆっくり往復させる。
    const offset = stage.pointer.inside ? stage.pointer.sx * 13 : p.preview ? Math.sin(time * 0.7) * 7 : 0;
    const target = Math.min(54, Math.max(16, p.twist + offset));
    twistNow += (target - twistNow) * (dt > 0 ? 1 - Math.exp(-dt * 5) : 1);
    showTwist(twistNow);
    layout(THREE.MathUtils.degToRad(twistNow));
    helix.rotation.x += dt * p.spin;
    root.rotation.x = -stage.pointer.sy * 0.25;
    root.rotation.y = stage.pointer.sx * 0.2;
  });

  if (!stage.reduced) animate(state, { grow: [0, 1], duration: 2200, ease: 'outCubic' });

  return {
    destroy() {
      utils.remove(state);
      hud.remove();
      stage.destroy();
    },
  };
}
