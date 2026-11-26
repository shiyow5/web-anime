import * as THREE from 'three';
import { animate, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'data-corridor',
  title: 'データの回廊',
  category: 'cyber',
  libs: ['three', 'animejs'],
  description:
    '四角い枠が奥へ連なる回廊を、まっすぐ進みます。壁と床には、グラフ・記号の列・波形を映した板が並び、枠はゆっくりねじれます。遠くは霧に消えます。押している間は加速します。データや通信を扱うサービスの導入画面に合います。',
  params: {
    frame: { type: 'color', label: '枠の色', default: '#ffb347' },
    panel: { type: 'color', label: '板の色', default: '#3df0c8' },
    background: { type: 'color', label: '霧の色', default: '#06090f' },
    speed: { type: 'range', label: '進む速さ', min: 0, max: 20, step: 0.5, default: 5 },
    twist: { type: 'range', label: 'ねじれ', min: 0, max: 1, step: 0.05, default: 0.3 },
    panels: { type: 'range', label: '板の数', min: 0, max: 80, step: 4, default: 44 },
  },
};

const FRAMES = 26;
const SPACING = 3;
const LENGTH = FRAMES * SPACING;
const HALF_W = 2.6;
const HALF_H = 1.6;

// 壁に映す絵を 4 種類、キャンバスに描く。
function panelTextures() {
  const draw = (painter) => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.strokeStyle = '#fff';
      ctx.fillStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(2, 2, 252, 156);
      painter(ctx);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  return [
    draw((ctx) => {
      for (let i = 0; i < 12; i += 1) ctx.fillRect(18 + i * 19, 140 - (20 + ((i * 53) % 90)), 11, 20 + ((i * 53) % 90));
    }),
    draw((ctx) => {
      for (let row = 0; row < 6; row += 1) {
        for (let col = 0; col < 14; col += 1) if ((row * 7 + col * 3) % 5 !== 0) ctx.fillRect(16 + col * 16, 20 + row * 22, 6 + ((row + col) % 3) * 4, 8);
      }
    }),
    draw((ctx) => {
      ctx.beginPath();
      for (let x = 0; x <= 240; x += 4) ctx.lineTo(8 + x, 80 + Math.sin(x * 0.09) * 40 * Math.sin(x * 0.02 + 1));
      ctx.stroke();
      ctx.globalAlpha = 0.4;
      for (let y = 20; y < 160; y += 30) ctx.fillRect(8, y, 240, 1);
    }),
    draw((ctx) => {
      ctx.beginPath();
      ctx.arc(80, 80, 52, 0, Math.PI * 1.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(80, 80, 34, 1, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 5; i += 1) ctx.fillRect(156, 34 + i * 22, 40 + ((i * 31) % 50), 8);
    }),
  ];
}

function frameGeometry() {
  const corners = [[-HALF_W, -HALF_H], [HALF_W, -HALF_H], [HALF_W, HALF_H], [-HALF_W, HALF_H]];
  const points = [];
  corners.forEach(([x, y], i) => {
    const [nx, ny] = corners[(i + 1) % 4];
    points.push(x, y, 0, nx, ny, 0);
    // 角の内側に、短いかぎ形を足す。
    const sx = Math.sign(x);
    const sy = Math.sign(y);
    points.push(x - sx * 0.25, y - sy * 0.25, 0, x - sx * 0.7, y - sy * 0.25, 0, x - sx * 0.25, y - sy * 0.25, 0, x - sx * 0.25, y - sy * 0.6, 0);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return geometry;
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 62, cameraZ: 0, far: 120, background: p.background, preview: p.preview, bloom: { strength: 0.4, radius: 0.25, threshold: 0.35 } });
  stage.scene.fog = new THREE.Fog(p.background, 4, LENGTH * 0.72);
  const state = { speed: p.speed };
  const textures = panelTextures();

  const sharedFrame = frameGeometry();
  const frameMaterial = new THREE.LineBasicMaterial({ color: p.frame });
  const frames = Array.from({ length: FRAMES }, (_, i) => {
    const frame = new THREE.LineSegments(sharedFrame, frameMaterial);
    frame.position.z = -i * SPACING;
    stage.scene.add(frame);
    return frame;
  });

  const panelGeometry = new THREE.PlaneGeometry(1.6, 1);
  const materials = textures.map((map) => new THREE.MeshBasicMaterial({ map, color: p.panel, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  const panelCount = Math.round(p.preview ? Math.min(p.panels, 24) : p.panels);
  const panels = Array.from({ length: panelCount }, (_, i) => {
    const mesh = new THREE.Mesh(panelGeometry, materials[i % materials.length]);
    const wall = i % 4;
    const along = (Math.random() - 0.5) * (wall < 2 ? HALF_H * 1.2 : HALF_W * 1.4);
    if (wall === 0) mesh.position.set(-HALF_W + 0.05, along, 0);
    if (wall === 1) mesh.position.set(HALF_W - 0.05, along, 0);
    if (wall === 2) mesh.position.set(along, -HALF_H + 0.05, 0);
    if (wall === 3) mesh.position.set(along, HALF_H - 0.05, 0);
    mesh.rotation.set(wall >= 2 ? Math.PI / 2 : 0, wall < 2 ? Math.PI / 2 : 0, 0);
    mesh.scale.setScalar(0.6 + Math.random() * 0.7);
    const holder = new THREE.Group();
    holder.add(mesh);
    holder.position.z = -Math.random() * LENGTH;
    stage.scene.add(holder);
    return holder;
  });

  const twistAt = (z, time) => Math.sin(z * 0.07 + time * 0.25) * p.twist;
  stage.onFrame((time, dt) => {
    const move = state.speed * dt;
    for (const object of [...frames, ...panels]) {
      object.position.z += move;
      // 通り過ぎたものは、いちばん奥へ戻す。
      if (object.position.z > 2) object.position.z -= LENGTH;
      object.rotation.z = twistAt(object.position.z, time);
    }
    stage.camera.position.set(stage.pointer.sx * 0.5, stage.pointer.sy * 0.3, 0);
    stage.camera.rotation.set(stage.pointer.sy * 0.12, -stage.pointer.sx * 0.18, twistAt(0, time));
  });

  const boost = (on) => !stage.reduced && animate(state, { speed: on ? p.speed * 4 + 10 : p.speed, duration: on ? 600 : 1500, ease: on ? 'inQuad' : 'outExpo' });
  const boostOn = () => boost(true);
  const boostOff = () => boost(false);
  container.addEventListener('pointerdown', boostOn);
  window.addEventListener('pointerup', boostOff);
  container.addEventListener('pointerleave', boostOff);

  return {
    destroy() {
      container.removeEventListener('pointerdown', boostOn);
      window.removeEventListener('pointerup', boostOff);
      container.removeEventListener('pointerleave', boostOff);
      utils.remove(state);
      for (const texture of textures) texture.dispose();
      stage.destroy();
    },
  };
}
