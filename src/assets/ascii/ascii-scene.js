import * as THREE from 'three';
import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'ascii-scene',
  title: '文字で描く立体',
  category: 'ascii',
  libs: ['three', 'animejs'],
  description:
    'three.js で回している立体を画面には出さず、その明るさを 1 升ずつ読み取って文字に置き換えます。結び目や多面体に光が当たる様子が、文字の濃淡だけで浮かび上がります。まわりを小さな立体が別の色で回り、ポインターを動かすと全体が傾きます。クリックすると、立体がいったん縮んでから大きく弾んで勢いよく回り、まわりの小さな立体は 1 つずつ順に外の軌道へはじき飛ばされて、らせんを描きながら戻ってきます。3D の作品紹介や技術系の見出しに使えます。',
  params: {
    shape: {
      type: 'select',
      label: '立体の形',
      options: [
        { value: 'knot', label: '結び目' },
        { value: 'icosa', label: '二十面体' },
        { value: 'dodeca', label: '十二面体' },
        { value: 'octa', label: '八面体' },
      ],
      default: 'knot',
    },
    color: { type: 'color', label: '文字の色', default: '#c9d8ea' },
    accent: { type: 'color', label: '小さな立体の色', default: '#ff8f6b' },
    background: { type: 'color', label: '背景色', default: '#0f1116' },
    speed: { type: 'range', label: '回る速さ', min: 0, max: 3, step: 0.1, default: 1 },
    satellites: { type: 'range', label: '小さな立体の数', min: 0, max: 6, step: 1, default: 3 },
    detail: { type: 'range', label: '文字の細かさ', min: 0.6, max: 1.6, step: 0.1, default: 1 },
  },
};

const RAMP = ' .\'`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
const RAMP_CODES = Array.from(RAMP, (ch) => ch.charCodeAt(0));
const LAST = RAMP_CODES.length - 1;
const BASE = 12;
const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';
const SPACE = 32;
const SUPER = 2; // 1 升あたり 2×2 画素で描いてから平均し、輪郭の濃淡をなめらかにする

const CSS = `
.ua-asc{position:absolute;inset:0;overflow:hidden;background:var(--ua-bg)}
.ua-asc__pre,.ua-asc__probe{position:absolute;left:0;top:0;margin:0;padding:0;border:0;background:none;white-space:pre;
  font:${BASE}px/${BASE}px ${MONO};letter-spacing:0;font-variant-ligatures:none}
.ua-asc__pre{transform-origin:0 0;pointer-events:none;user-select:none;color:var(--ua-fg)}
.ua-asc__pre--1{color:var(--ua-accent)}
.ua-asc__probe{visibility:hidden}
`;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 文字の升目を用意する。12px で組んでから transform で縮めるので、ブラウザーの最小文字サイズに左右されない。
function createSurface(root, cls, layerCount, cellPx) {
  const probe = h('span', { class: `${cls}__probe`, 'aria-hidden': 'true', text: 'M'.repeat(20) });
  const pres = Array.from({ length: layerCount }, (_, i) => h('pre', { class: `${cls}__pre ${cls}__pre--${i}`, 'aria-hidden': 'true' }));
  root.append(probe, ...pres);
  const g = { cols: 0, rows: 0, aspect: 0.6, layers: [] };
  g.fit = () => {
    const w = root.clientWidth;
    const ht = root.clientHeight;
    if (w < 8 || ht < 8) return false;
    const cw = probe.getBoundingClientRect().width / 20 || BASE * 0.6;
    const cell = cellPx(w, ht);
    const scale = cell / BASE;
    g.cols = Math.max(12, Math.floor(w / (cw * scale)));
    g.rows = Math.max(6, Math.floor(ht / cell));
    g.aspect = cw / BASE;
    g.layers = pres.map(() => new Uint16Array(g.cols * g.rows).fill(SPACE));
    const ox = (w - g.cols * cw * scale) / 2;
    const oy = (ht - g.rows * cell) / 2;
    for (const pre of pres) pre.style.transform = `translate(${ox.toFixed(2)}px,${oy.toFixed(2)}px) scale(${scale.toFixed(4)})`;
    return true;
  };
  g.flush = () => {
    pres.forEach((pre, i) => {
      const buf = g.layers[i];
      const lines = [];
      for (let r = 0; r < g.rows; r += 1) lines.push(String.fromCharCode.apply(null, buf.subarray(r * g.cols, (r + 1) * g.cols)));
      pre.textContent = lines.join('\n');
    });
  };
  g.put = (layer, row, col, text) => {
    if (row < 0 || row >= g.rows) return;
    for (let i = 0; i < text.length; i += 1) {
      const c = col + i;
      if (c >= 0 && c < g.cols) g.layers[layer][row * g.cols + c] = text.charCodeAt(i);
    }
  };
  return g;
}

const SHAPES = {
  knot: { label: 'TORUS KNOT 2-3', flat: false, build: (preview) => new THREE.TorusKnotGeometry(1, 0.36, preview ? 110 : 180, preview ? 16 : 24, 2, 3) },
  icosa: { label: 'ICOSAHEDRON', flat: true, build: () => new THREE.IcosahedronGeometry(1.5, 0) },
  dodeca: { label: 'DODECAHEDRON', flat: true, build: () => new THREE.DodecahedronGeometry(1.45, 0) },
  octa: { label: 'OCTAHEDRON', flat: true, build: () => new THREE.OctahedronGeometry(1.55, 0) },
};

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const preview = Boolean(p.preview);
  const reduced = prefersReducedMotion();
  const root = createRoot(container, 'ua-asc', { '--ua-bg': p.background, '--ua-fg': p.color, '--ua-accent': p.accent });
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', '回る立体の明るさを、文字の濃淡に置き換えた絵');
  const disposer = createDisposer();
  const g = createSurface(root, 'ua-asc', 2, (w) => clamp(w / (preview ? 64 : 105) / p.detail, 4.5, 16));

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (error) {
    root.remove();
    throw new Error('WebGL を初期化できませんでした。ブラウザーか GPU の設定を確認してください', { cause: error });
  }
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  // 描いた結果は画面に出さず、小さな 2D キャンバスへ写して画素を読む。
  const sampler = document.createElement('canvas');
  const ctx = sampler.getContext('2d', { willReadFrequently: true });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  camera.position.set(0, 0, 5.4);
  const key = new THREE.DirectionalLight(0xffffff, 1.9);
  key.position.set(-2.4, 3, 4);
  const fill = new THREE.DirectionalLight(0xffffff, 0.22);
  fill.position.set(3, -1.5, 2);
  scene.add(key, fill, new THREE.AmbientLight(0xffffff, 0.05));

  const shape = SHAPES[p.shape];
  const group = new THREE.Group();
  const body = new THREE.Mesh(shape.build(preview), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.05, flatShading: shape.flat }));
  group.add(body);
  // 小さな立体は赤だけを強く返す材質にして、読み取るときに本体と見分ける。
  const moonGeometry = new THREE.OctahedronGeometry(0.17, 0);
  const moonMaterial = new THREE.MeshStandardMaterial({ color: 0xff2a2a, roughness: 0.5, flatShading: true });
  const moons = Array.from({ length: Math.round(p.satellites) }, (_, i) => {
    const mesh = new THREE.Mesh(moonGeometry, moonMaterial);
    group.add(mesh);
    return { mesh, phase: (i / Math.max(1, Math.round(p.satellites))) * Math.PI * 2, radius: 2.05 + (i % 2) * 0.22, fling: 0 };
  });
  scene.add(group);

  const ptr = { x: 0.5, y: 0.5, sx: 0.5, sy: 0.5, inside: false };
  const intro = { v: reduced ? 1 : 0 };
  let time = reduced ? 2.4 : 0;
  const fx = { pop: 0, spin: 0 };
  let whirl = 0;

  // はじく。準備: 立体が縮む。山場: 弾んで勢いよく回り、小さな立体が順に外へ飛ぶ。余韻: らせんで戻る。
  function burst() {
    if (reduced) return;
    animate(fx, {
      pop: [
        { to: -0.28, duration: 180, ease: 'outQuad' },
        { to: 0.22, duration: 200, ease: 'outQuad' },
        { to: 0, duration: 1200, ease: 'outElastic(1, .4)' },
      ],
      spin: [
        { to: 0, duration: 180 },
        { to: 1, duration: 160, ease: 'outQuad' },
        { to: 0, duration: 2200, ease: 'outCubic' },
      ],
    });
    moons.forEach((moon, i) => {
      animate(moon, {
        fling: [
          { to: 1, duration: 320, ease: 'outCubic' },
          { to: 0, duration: 1900, ease: 'inOutSine' },
        ],
        delay: 200 + i * 110,
      });
    });
  }
  disposer.listen(root, 'pointerdown', burst);
  if (preview && !reduced) disposer.interval(burst, 5400);

  disposer.listen(root, 'pointermove', (event) => {
    const local = localPointer(event, root);
    ptr.x = local.x;
    ptr.y = local.y;
    ptr.inside = true;
  });
  disposer.listen(root, 'pointerleave', () => {
    ptr.inside = false;
  });

  function layout() {
    renderer.setSize(g.cols * SUPER, g.rows * SUPER, false);
    sampler.width = g.cols;
    sampler.height = g.rows;
    camera.aspect = (g.cols * g.aspect) / g.rows;
    camera.updateProjectionMatrix();
  }

  function draw(dt) {
    const { cols, rows } = g;
    const [shade, mark] = g.layers;
    time += dt * p.speed;
    const ease = 1 - Math.exp(-dt * 4);
    ptr.sx += ((ptr.inside ? ptr.x : 0.5) - ptr.sx) * ease;
    ptr.sy += ((ptr.inside ? ptr.y : 0.5) - ptr.sy) * ease;

    // 横幅が足りない枠では、小さな立体の軌道まで入るように全体を縮める。
    const size = Math.min(1, camera.aspect / 1.3) * (0.3 + 0.7 * intro.v);
    group.scale.setScalar(size);
    whirl += dt * fx.spin * 7;
    body.scale.setScalar(1 + fx.pop);
    group.rotation.set((ptr.sy - 0.5) * 1.3, (ptr.sx - 0.5) * 1.8 + (1 - intro.v) * 2.5, 0);
    body.rotation.set(time * 0.37 + whirl * 0.6, time * 0.53 + whirl, time * 0.11);
    for (const moon of moons) {
      const angle = time * 0.8 + moon.phase + moon.fling * 1.6;
      const orbit = moon.radius * (1 + moon.fling * 0.32);
      moon.mesh.position.set(Math.cos(angle) * orbit, Math.sin(angle * 2 + moon.phase) * (0.28 + moon.fling * 0.5), Math.sin(angle) * orbit);
      moon.mesh.rotation.set(time * 1.7, time * 1.3 + moon.phase, 0);
    }

    renderer.render(scene, camera);
    ctx.clearRect(0, 0, cols, rows);
    ctx.drawImage(renderer.domElement, 0, 0, cols, rows);
    const { data } = ctx.getImageData(0, 0, cols, rows);

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const index = r * cols + c;
        const at = index * 4;
        const alpha = data[at + 3] / 255;
        if (alpha < 0.08) {
          mark[index] = SPACE;
          // 背景には、等間隔の小さな目印だけを置く。
          shade[index] = c % 14 === 7 && r % 7 === 3 ? 46 : SPACE;
          continue;
        }
        const red = data[at];
        const blue = data[at + 2];
        const lum = clamp((red / 255) ** 1.7 * alpha * intro.v, 0.04, 1);
        const value = RAMP_CODES[Math.round(lum * LAST)];
        if (red - blue > 46) {
          mark[index] = RAMP_CODES[Math.round(clamp(lum * 1.25, 0.3, 1) * LAST)];
          shade[index] = SPACE;
        } else {
          shade[index] = value;
          mark[index] = SPACE;
        }
      }
    }

    const deg = (rad) => String(Math.round((((rad * 180) / Math.PI) % 360 + 360) % 360)).padStart(3, '0');
    g.put(0, 1, 2, shape.label);
    g.put(0, rows - 2, 2, `RX ${deg(body.rotation.x)}  RY ${deg(body.rotation.y)}`);
    const stamp = `${cols} x ${rows}`;
    g.put(0, rows - 2, cols - 2 - stamp.length, stamp);
  }

  function tick(dt) {
    if (!g.cols) return;
    draw(dt);
    g.flush();
  }

  let last = performance.now();
  const timer = reduced
    ? null
    : createTimer({
        frameRate: 30,
        onUpdate() {
          const now = performance.now();
          const dt = clamp((now - last) / 1000, 0, 0.1);
          last = now;
          tick(dt);
        },
      });
  if (!reduced) animate(intro, { v: 1, duration: 1800, ease: 'outExpo' });

  const refit = () => {
    if (!g.fit()) return;
    layout();
    if (reduced) tick(0);
  };
  const resizeObserver = new ResizeObserver(refit);
  resizeObserver.observe(root);
  const intersectionObserver = new IntersectionObserver((entries) => {
    if (!timer) return;
    if (entries.at(-1).isIntersecting) {
      last = performance.now();
      timer.resume();
    } else timer.pause();
  });
  intersectionObserver.observe(root);
  refit();

  return {
    destroy() {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      timer?.pause();
      utils.remove(intro);
      utils.remove(fx);
      utils.remove(moons);
      disposer.run();
      body.geometry.dispose();
      body.material.dispose();
      moonGeometry.dispose();
      moonMaterial.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      removeRoot(root);
    },
  };
}
