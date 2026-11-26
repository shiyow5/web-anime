import * as THREE from 'three';
import { animate, spring, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'exploded-core',
  title: '分解される装置',
  category: 'cyber',
  libs: ['three', 'animejs'],
  description:
    '放熱板、基板、演算素子、コイル、レンズ、外枠の 6 つの部品でできた装置が、設計図の分解図のように上下へ開き、また組み上がります。部品は 1 つずつ時間差をつけて、ばねの動きで動きます。クリックすると開閉が切り替わります。製品の構造を見せる場面に使えます。',
  params: {
    edge: { type: 'color', label: '輪郭の色', default: '#5cf2ff' },
    accent: { type: 'color', label: '発光部の色', default: '#ff8a3d' },
    body: { type: 'color', label: '部品の色', default: '#141a26' },
    background: { type: 'color', label: '背景色', default: '#070a11' },
    gap: { type: 'range', label: '開いたときの間隔', min: 0.3, max: 1.6, step: 0.05, default: 0.9 },
    spin: { type: 'range', label: '回る速さ', min: 0, max: 1, step: 0.05, default: 0.18 },
  },
};

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, {
    fov: 22,
    near: 1,
    far: 100,
    background: p.background,
    preview: p.preview,
    bloom: { strength: 0.35, radius: 0.2, threshold: 0.35 },
  });
  // 遠くから狭い画角で見ると、設計図のような等角投影に近い見え方になる。
  stage.camera.position.set(11, 9, 11);
  stage.camera.lookAt(0, 0.1, 0);

  const edgeColor = new THREE.Color(p.edge);
  const accent = new THREE.Color(p.accent);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: p.body, roughness: 0.55, metalness: 0.5 });
  const glowMaterial = new THREE.MeshBasicMaterial({ color: accent });
  const edgeMaterial = new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.9 });
  stage.scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x05070c, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 8, 6);
  stage.scene.add(key);

  // 部品に輪郭線を重ねて、図面のように見せる。
  const outlined = (geometry, material = bodyMaterial) => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry, material));
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20), edgeMaterial));
    return group;
  };

  const device = new THREE.Group();
  stage.scene.add(device);

  const heatsink = new THREE.Group();
  heatsink.add(outlined(new THREE.BoxGeometry(2.6, 0.16, 2.6)));
  for (let i = 0; i < 9; i += 1) {
    const fin = outlined(new THREE.BoxGeometry(2.4, 0.34, 0.07));
    fin.position.set(0, -0.25, -1.04 + i * 0.26);
    heatsink.add(fin);
  }

  const board = new THREE.Group();
  board.add(outlined(new THREE.BoxGeometry(2.8, 0.06, 2.8)));
  for (let i = 0; i < 14; i += 1) {
    const horizontal = i % 2 === 0;
    const trace = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? 0.5 + (i % 5) * 0.2 : 0.03, 0.012, horizontal ? 0.03 : 0.5 + (i % 4) * 0.22), glowMaterial);
    trace.position.set(-1.1 + ((i * 7) % 11) * 0.22, 0.04, -1.1 + ((i * 5) % 11) * 0.22);
    board.add(trace);
  }

  const chip = new THREE.Group();
  chip.add(outlined(new THREE.BoxGeometry(1.3, 0.22, 1.3)));
  const die = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.6), glowMaterial);
  die.position.y = 0.13;
  chip.add(die);
  for (let i = 0; i < 28; i += 1) {
    const side = Math.floor(i / 7);
    const offset = -0.54 + (i % 7) * 0.18;
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.16), bodyMaterial);
    pin.position.set(side < 2 ? offset : side === 2 ? -0.72 : 0.72, -0.08, side < 2 ? (side === 0 ? -0.72 : 0.72) : offset);
    if (side >= 2) pin.rotation.y = Math.PI / 2;
    chip.add(pin);
  }

  const coil = new THREE.Group();
  const coilBody = outlined(new THREE.TorusGeometry(0.95, 0.14, 12, 48));
  coilBody.rotation.x = Math.PI / 2;
  const coilGlow = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.025, 8, 64), glowMaterial);
  coilGlow.rotation.x = Math.PI / 2;
  coil.add(coilBody, coilGlow);

  const lensGeometry = new THREE.CylinderGeometry(0.8, 0.8, 0.08, 48);
  const lens = new THREE.Group();
  lens.add(new THREE.Mesh(lensGeometry, new THREE.MeshStandardMaterial({ color: p.edge, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.22 })));
  lens.add(new THREE.LineSegments(new THREE.EdgesGeometry(lensGeometry, 40), edgeMaterial));

  const frame = new THREE.Group();
  frame.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.9, 0.3, 2.9)), edgeMaterial));
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const corner = outlined(new THREE.BoxGeometry(0.34, 0.3, 0.34));
    corner.position.set(x * 1.28, 0, z * 1.28);
    frame.add(corner);
  }

  // 下から順に積む。y は閉じたときの高さ、order は開いたときの段。
  const parts = [
    { object: heatsink, y: -0.72, order: -2.5 },
    { object: board, y: -0.52, order: -1.5 },
    { object: chip, y: -0.36, order: -0.5 },
    { object: coil, y: -0.02, order: 0.5 },
    { object: lens, y: 0.24, order: 1.5 },
    { object: frame, y: 0.44, order: 2.5 },
  ].map((part) => ({ ...part, open: { v: 0 } }));
  for (const part of parts) device.add(part.object);

  // 中心を貫く補助線。分解図の軸にあたる。
  const axis = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -4, 0), new THREE.Vector3(0, 4, 0)]),
    new THREE.LineDashedMaterial({ color: edgeColor, dashSize: 0.08, gapSize: 0.08, transparent: true, opacity: 0.5 }),
  );
  axis.computeLineDistances();
  device.add(axis);

  stage.onResize(() => {
    device.scale.setScalar(Math.min(1, stage.camera.aspect / 1.2 + 0.2));
  });
  stage.onFrame((time, dt) => {
    device.rotation.y += dt * p.spin + stage.pointer.sx * dt * 0.8;
    for (const part of parts) part.object.position.y = part.y + part.open.v * part.order * p.gap;
    glowMaterial.color.copy(accent).multiplyScalar(0.8 + Math.sin(time * 2.4) * 0.2);
    axis.material.opacity = 0.15 + Math.max(0, parts[0].open.v) * 0.45;
  });

  const opens = parts.map((part) => part.open);
  let isOpen = false;
  function toggle(next = !isOpen) {
    isOpen = next;
    if (stage.reduced) {
      for (const open of opens) open.v = isOpen ? 1 : 0;
      return;
    }
    // 外側の部品から順に動かす。開くときと閉じるときで順番を逆にする。
    animate(opens, { v: isOpen ? 1 : 0, delay: stagger(90, { from: isOpen ? 'last' : 'first' }), ease: spring({ stiffness: 80, damping: 11 }) });
  }
  const onClick = () => toggle();
  container.addEventListener('click', onClick);
  const first = setTimeout(() => toggle(true), 700);
  const loop = stage.reduced ? 0 : setInterval(() => toggle(), p.preview ? 3200 : 5200);

  return {
    toggle,
    destroy() {
      clearTimeout(first);
      clearInterval(loop);
      container.removeEventListener('click', onClick);
      utils.remove(opens);
      stage.destroy();
    },
  };
}
