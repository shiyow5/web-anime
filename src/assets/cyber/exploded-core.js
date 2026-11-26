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
    '放熱板、基板、演算素子、コイル、レンズ、外枠の 6 つの部品でできた装置が、設計図の分解図のように上下へ開き、また組み上がります。部品は 1 つずつ時間差をつけて、ばねの動きで動きます。部品をタップすると、その部品だけが横へ抜き出されて 1 回転し、名前の札が出てから元の段へ戻ります。製品の構造を見せる場面に使えます。',
  params: {
    edge: { type: 'color', label: '輪郭の色', default: '#5cf2ff' },
    accent: { type: 'color', label: '発光部の色', default: '#ff8a3d' },
    body: { type: 'color', label: '部品の色', default: '#141a26' },
    background: { type: 'color', label: '背景色', default: '#070a11' },
    gap: { type: 'range', label: '開いたときの間隔', min: 0.3, max: 1.6, step: 0.05, default: 0.9 },
    spin: { type: 'range', label: '回る速さ', min: 0, max: 1, step: 0.05, default: 0.18 },
  },
};

const TAU = Math.PI * 2;
const PULL = 2.3;
const NAMES = ['放熱板 HEATSINK', '基板 BOARD', '演算素子 CORE', 'コイル COIL', 'レンズ LENS', '外枠 FRAME'];

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
  ].map((part) => ({ ...part, open: { v: 0 }, pull: { v: 0 }, turn: { v: 0 } }));
  for (const part of parts) device.add(part.object);

  // 抜き出した部品の名前を出す札。
  const label = document.createElement('div');
  Object.assign(label.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    padding: '0.3em 0.7em',
    borderLeft: `2px solid ${p.accent}`,
    background: 'rgba(4, 8, 14, 0.72)',
    color: p.edge,
    font: `600 ${p.preview ? 10 : 13}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`,
    letterSpacing: '0.08em',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    opacity: '0',
  });
  container.appendChild(label);
  const labelState = { v: 0 };
  let selected = -1;

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
    // 画面の右にあたる向きを、回っている装置の中の向きに直す。抜き出す部品はその向きへ動く。
    const side = device.rotation.y - Math.PI / 4;
    for (const part of parts) {
      const out = part.pull.v * PULL;
      part.object.position.set(Math.cos(side) * out, part.y + part.open.v * part.order * p.gap, Math.sin(side) * out);
      part.object.rotation.y = part.turn.v;
      part.object.scale.setScalar(1 + part.pull.v * 0.08);
    }
    label.style.opacity = labelState.v.toFixed(3);
    if (selected >= 0 && labelState.v > 0.001) {
      parts[selected].object.getWorldPosition(projected).project(stage.camera);
      const x = (projected.x * 0.5 + 0.5) * stage.size.width;
      const y = (-projected.y * 0.5 + 0.5) * stage.size.height;
      label.style.transform = `translate(${Math.min(x - 40, stage.size.width - label.offsetWidth - 8).toFixed(1)}px, ${(y + stage.size.height * 0.13).toFixed(1)}px)`;
    }
    glowMaterial.color.copy(accent).multiplyScalar(0.8 + Math.sin(time * 2.4) * 0.2 + (selected >= 0 ? parts[selected].pull.v * 0.5 : 0));
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

  // 部品の抜き出し。タップした部品だけが横へ抜けて 1 回転し、名前の札が出てから元の段へ戻る。
  const raycaster = new THREE.Raycaster();
  const projected = new THREE.Vector3();
  const pulls = parts.map((part) => part.pull);
  const turns = parts.map((part) => part.turn);
  let busy = false;
  let cursor = 0;
  let typing = { n: 0 };
  function pickPart(event) {
    if (!event) return -1;
    const rect = container.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1)), stage.camera);
    const hit = raycaster.intersectObjects(parts.map((part) => part.object), true).find((item) => item.object.isMesh);
    if (!hit) return -1;
    return parts.findIndex((part) => {
      let node = hit.object;
      while (node && node !== part.object) node = node.parent;
      return node === part.object;
    });
  }
  function inspect(index = cursor) {
    if (stage.reduced) return;
    const chosen = ((index % parts.length) + parts.length) % parts.length;
    cursor = chosen + 1;
    busy = true;
    utils.remove([...pulls, ...turns, labelState, typing]);
    // 準備。閉じていれば先に開き、前に抜いていた部品は戻す。
    if (!isOpen) toggle(true);
    parts.forEach((part, i) => {
      if (i !== chosen) animate(part.pull, { v: 0, duration: 420, ease: 'outQuart' });
      if (i !== chosen) animate(part.turn, { v: 0, duration: 420, ease: 'outQuart' });
    });
    selected = chosen;
    const part = parts[chosen];
    part.turn.v %= TAU;
    typing = { n: 0 };
    const name = `${String(chosen + 1).padStart(2, '0')} / ${NAMES[chosen]}`;
    label.textContent = '';
    // 山場で横へ抜けながら 1 回転し、札に名前が 1 文字ずつ出る。余韻で札が消え、部品が元の段へ戻る。
    animate(part.pull, {
      v: [
        { to: 1, duration: 700, delay: 120, ease: 'outExpo' },
        { to: 0, duration: 900, delay: 1900, ease: 'outBack(1.4)' },
      ],
      onComplete() {
        busy = false;
      },
    });
    animate(part.turn, { v: TAU, duration: 1700, delay: 260, ease: 'inOutQuart' });
    animate(labelState, {
      v: [
        { to: 1, duration: 300, delay: 320, ease: 'outQuad' },
        { to: 0, duration: 380, delay: 1800, ease: 'inQuad' },
      ],
    });
    animate(typing, {
      n: name.length,
      duration: 520,
      delay: 360,
      ease: 'linear',
      onUpdate() {
        label.textContent = name.slice(0, Math.round(typing.n));
      },
    });
  }
  const onClick = (event) => {
    if (stage.reduced) return toggle();
    const hit = pickPart(event);
    inspect(hit >= 0 ? hit : cursor);
  };
  container.addEventListener('click', onClick);
  const first = setTimeout(() => toggle(true), 700);
  // 触っていない間は開閉をくり返す。一覧では、部品を 1 つずつ順に抜き出して見せる。
  const loop = stage.reduced
    ? 0
    : setInterval(() => {
        if (p.preview) inspect();
        else if (!busy) toggle();
      }, p.preview ? 3600 : 5200);

  return {
    toggle,
    inspect,
    destroy() {
      clearTimeout(first);
      clearInterval(loop);
      container.removeEventListener('click', onClick);
      utils.remove([...opens, ...pulls, ...turns, labelState, typing]);
      label.remove();
      stage.destroy();
    },
  };
}
