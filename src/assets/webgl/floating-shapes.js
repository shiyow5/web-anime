import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { animate, spring, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'floating-shapes',
  title: '浮かぶ立体',
  category: 'webgl',
  libs: ['three', 'animejs'],
  description:
    '色つきの立体がふわふわ浮かびます。読み込み時にばねの動きで 1 つずつ現れ、クリックすると、その場所へ立体が吸い寄せられてから外へ弾け、別々の軸で回りながら色を入れ替えて戻ります。明るい配色なので、サービス紹介やポートフォリオのトップに合います。',
  params: {
    color1: { type: 'color', label: '色 1', default: '#ff5d73' },
    color2: { type: 'color', label: '色 2', default: '#ffc145' },
    color3: { type: 'color', label: '色 3', default: '#3d5afe' },
    color4: { type: 'color', label: '色 4', default: '#00c2a8' },
    background: { type: 'color', label: '背景色', default: '#efeeff' },
    roughness: { type: 'range', label: '表面のざらつき', min: 0, max: 1, step: 0.05, default: 0.3 },
    float: { type: 'range', label: '揺れの大きさ', min: 0, max: 2, step: 0.1, default: 1 },
  },
};

// [形, x, y, z, 大きさ, 色の番号]
const LAYOUT = [
  ['torus', -3.6, 1.5, 0, 0.9, 0],
  ['sphere', -1.6, -1.5, 0.6, 0.75, 1],
  ['box', 0.2, 1.7, -0.6, 0.85, 2],
  ['capsule', 2.2, -1.2, 0.4, 0.8, 3],
  ['knot', 3.9, 1.3, -0.4, 0.7, 1],
  ['cone', -4.4, -1.3, -0.8, 0.8, 2],
  ['sphere', 1.4, 0.3, 1.2, 0.45, 0],
  ['octa', -2.3, 0.4, -1.4, 0.75, 3],
  ['torus', 4.6, -1.5, -1.2, 0.6, 2],
  ['box', -0.4, -0.4, -2.2, 0.6, 0],
  ['capsule', -5.4, 0.3, -1.6, 0.55, 1],
  ['sphere', 5.6, 0.2, -2, 0.6, 3],
];
const LAYOUT_WIDTH = 13;

const GEOMETRIES = {
  torus: () => new THREE.TorusGeometry(0.7, 0.3, 32, 72),
  sphere: () => new THREE.SphereGeometry(0.8, 48, 32),
  box: () => new RoundedBoxGeometry(1.2, 1.2, 1.2, 6, 0.22),
  capsule: () => new THREE.CapsuleGeometry(0.45, 0.9, 12, 32),
  knot: () => new THREE.TorusKnotGeometry(0.55, 0.2, 140, 20),
  cone: () => new THREE.ConeGeometry(0.75, 1.3, 48),
  octa: () => new THREE.OctahedronGeometry(0.85, 0),
};

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 40, cameraZ: 10, background: p.background, preview: p.preview });
  stage.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  stage.renderer.toneMappingExposure = 1.1;

  const pmrem = new THREE.PMREMGenerator(stage.renderer);
  const room = new RoomEnvironment();
  stage.scene.environment = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  keyLight.position.set(4, 6, 5);
  stage.scene.add(keyLight);

  const palette = [p.color1, p.color2, p.color3, p.color4];
  const materials = palette.map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: p.roughness, metalness: 0.05 }),
  );
  const group = new THREE.Group();
  stage.scene.add(group);

  const items = LAYOUT.map(([shape, x, y, z, size, colorIndex], index) => {
    const mesh = new THREE.Mesh(GEOMETRIES[shape](), materials[colorIndex]);
    mesh.rotation.set(index * 1.3, index * 0.7, index * 0.4);
    mesh.scale.setScalar(stage.reduced ? size : 0.0001);
    group.add(mesh);
    return {
      mesh,
      base: new THREE.Vector3(x, y, z),
      size,
      phase: index * 1.7,
      spin: 0.15 + (index % 4) * 0.07,
      axis: index % 3,
      colorIndex,
      away: new THREE.Vector3(),
      grow: { v: stage.reduced ? size : 0.0001 },
      kick: { pull: 0, kick: 0 },
    };
  });

  stage.onResize(() => {
    group.scale.setScalar(Math.min(1, stage.viewport().width / LAYOUT_WIDTH + 0.12));
  });
  // タップした場所（group の中の座標）。立体はいったんここへ吸い寄せられ、ここから外へ飛ぶ。
  const origin = new THREE.Vector3();
  stage.onFrame((time, dt) => {
    for (const item of items) {
      const { pull, kick } = item.kick;
      const fx = item.base.x + (origin.x - item.base.x) * pull * 0.82 + item.away.x * kick;
      const fy = item.base.y + (origin.y - item.base.y) * pull * 0.82 + item.away.y * kick;
      item.mesh.position.set(
        fx + Math.sin(time * 0.5 + item.phase) * 0.12 * p.float,
        fy + Math.sin(time * 0.8 + item.phase) * 0.22 * p.float,
        item.base.z * (1 - pull * 0.8) + kick * 1.4,
      );
      // 立体ごとに違う軸で回す。飛んでいるあいだは速くなる。
      const rush = 1 + kick * 9 + pull * 3;
      const axis = item.axis;
      item.mesh.rotation.x += dt * item.spin * (axis === 0 ? rush : 1);
      item.mesh.rotation.y += dt * item.spin * 0.7 * (axis === 1 ? rush * 1.4 : 1);
      item.mesh.rotation.z += dt * item.spin * (axis === 2 ? rush : 0);
      item.mesh.scale.setScalar(Math.max(0.0001, item.grow.v * (1 - pull * 0.45 + kick * 0.18)));
    }
    group.rotation.y = stage.pointer.sx * 0.22;
    group.rotation.x = -stage.pointer.sy * 0.14;
  });

  const scales = items.map((item) => item.grow);
  const kicks = items.map((item) => item.kick);
  if (!stage.reduced) {
    animate(scales, {
      v: (_, index) => items[index].size,
      delay: stagger(70, { start: 200 }),
      ease: spring({ stiffness: 110, damping: 9 }),
    });
  }

  // 準備: タップした場所へ近い順に吸い寄せられて縮む。山場: そこから外へ弾け、別々の軸で回りながら色が入れ替わる。
  // 余韻: 遠くまで飛んだものほど遅れて、ばねで元の場所へ戻る。
  function burst(event) {
    if (stage.reduced) return;
    const rect = container.getBoundingClientRect();
    const view = stage.viewport();
    const scale = group.scale.x || 1;
    const hasPoint = typeof event?.clientX === 'number' && rect.width > 0 && rect.height > 0;
    const nx = hasPoint ? ((event.clientX - rect.left) / rect.width) * 2 - 1 : Math.random() * 1.2 - 0.6;
    const ny = hasPoint ? 1 - ((event.clientY - rect.top) / rect.height) * 2 : Math.random() - 0.5;
    origin.set((nx * view.width) / 2 / scale, (ny * view.height) / 2 / scale, 0);
    let far = 0.001;
    for (const item of items) {
      item.reach = Math.hypot(item.base.x - origin.x, item.base.y - origin.y);
      far = Math.max(far, item.reach);
      const angle = Math.atan2(item.base.y - origin.y, item.base.x - origin.x);
      const power = 1.5 + (1 - item.reach / 12) * 1.3;
      item.away.set(Math.cos(angle) * power, Math.sin(angle) * power * 0.7, 0);
    }
    utils.remove(kicks);
    const wait = (_, index) => (items[index].reach / far) * 170;
    animate(kicks, {
      pull: [
        { to: 1, duration: 330, ease: 'inOutQuad' },
        { to: 0, duration: 170, ease: 'outQuad' },
      ],
      kick: [
        { to: 0, duration: 330 },
        { to: 1, duration: 260, ease: 'outExpo' },
        { to: 0, duration: 1700, ease: 'outElastic(1, .5)', delay: (_, index) => (items[index].reach / far) * 260 },
      ],
      delay: wait,
    });
    // 弾ける瞬間に、立体の色を 1 つずつ隣へ送る。
    clearTimeout(swapTimer);
    swapTimer = setTimeout(() => {
      for (const item of items) {
        item.colorIndex = (item.colorIndex + 1) % materials.length;
        item.mesh.material = materials[item.colorIndex];
      }
    }, 420);
  }
  let swapTimer = 0;
  container.addEventListener('click', burst);
  const autoBurst = p.preview ? setInterval(burst, 4500) : 0;

  return {
    burst,
    destroy() {
      clearInterval(autoBurst);
      clearTimeout(swapTimer);
      container.removeEventListener('click', burst);
      utils.remove([...scales, ...kicks]);
      room.dispose?.();
      stage.destroy();
    },
  };
}
