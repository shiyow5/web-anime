import { animate, createTimer, steps, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'pixel-gyro-cube',
  title: 'ドット絵の回る立方体',
  category: 'pixel',
  libs: ['animejs'],
  description:
    '低い解像度のキャンバスに、2 つの軸で回る立方体と、それを囲んで別々の軸で回る 2 本の輪を描きます。面の明るさは限られた色数と網点で表し、輪が立方体の手前と奥を通り抜けます。クリックすると勢いがついて、火花のドットが飛びます。ゲームの待機画面や、懐かしい雰囲気の見出しに使えます。',
  params: {
    tone: {
      type: 'select',
      label: '配色',
      options: [
        { value: 'arcade', label: '夜のゲーム機' },
        { value: 'lcd', label: '4 色の液晶' },
        { value: 'sunset', label: '夕焼け' },
      ],
      default: 'arcade',
    },
    speed: { type: 'range', label: '回る速さ', min: 0, max: 3, step: 0.1, default: 1 },
    resolution: { type: 'range', label: '横の画素数', min: 96, max: 256, step: 8, default: 168 },
    dither: { type: 'range', label: '網点の強さ', min: 0, max: 1, step: 0.05, default: 1 },
    stars: { type: 'boolean', label: '星を出す', default: true },
  },
};

const CSS = `
.ua-pgc{position:absolute;inset:0;overflow:hidden;cursor:pointer}
.ua-pgc canvas{position:absolute;left:0;top:0;display:block;image-rendering:crisp-edges;image-rendering:pixelated}
`;

// 配色。どれも暗い色から明るい色へ並べる。line は立方体の輪郭、thin は細い輪の 2 色。
const TONES = {
  arcade: {
    bg: ['#0e0b22', '#17133a', '#221c52'],
    cube: ['#3a1a66', '#7a2f9c', '#c94fb4', '#ff9ad1', '#fff0f6'],
    ring: ['#6a3212', '#c0701c', '#f4ba3c', '#fff4ac'],
    thin: ['#256c80', '#8df2e2'],
    line: '#1a0c34',
    star: '#b9b4ff',
    spark: '#fff4ac',
  },
  lcd: {
    bg: ['#12261c', '#12261c', '#1d3a2a'],
    cube: ['#1d3a2a', '#3f6e44', '#86b062', '#d4e8a0'],
    ring: ['#1d3a2a', '#3f6e44', '#86b062', '#d4e8a0'],
    thin: ['#3f6e44', '#86b062'],
    line: '#12261c',
    star: '#3f6e44',
    spark: '#d4e8a0',
  },
  sunset: {
    bg: ['#2a1238', '#4a1a4a', '#7a2a50'],
    cube: ['#40204a', '#28587a', '#3c9aa0', '#8ee0c0', '#f4ffe4'],
    ring: ['#7a2a30', '#d8582e', '#ffa040', '#ffe890'],
    thin: ['#b84a6a', '#ffb8c8'],
    line: '#200e2c',
    star: '#ffb8c8',
    spark: '#ffe890',
  },
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const TAU = Math.PI * 2;
const CAM = 5;
const BASE_ASPECT = 0.62;
const VIEW_SIN = Math.sin(0.6);
const VIEW_COS = Math.cos(0.6);

// 0〜1 の明るさを、levels 段の色番号に置き換える。段の間は 4×4 の網点で混ぜる。
// x, y は画素の位置。amount を 0 にすると、網点を使わずに近い段へ丸める。
export function ditherLevel(value, levels, x, y, amount = 1) {
  const scaled = Math.min(1, Math.max(0, value)) * (levels - 1);
  const low = Math.floor(scaled);
  const threshold = 0.5 + ((BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * amount;
  return Math.min(levels - 1, scaled - low > threshold ? low + 1 : low);
}

// 点 [x, y, z] を、X 軸、Y 軸、Z 軸の順に回した位置を返す（角度はラジアン）。
export function rotatePoint(point, ax = 0, ay = 0, az = 0) {
  const [x, y, z] = point;
  const y1 = y * Math.cos(ax) - z * Math.sin(ax);
  const z1 = y * Math.sin(ax) + z * Math.cos(ax);
  const x2 = x * Math.cos(ay) + z1 * Math.sin(ay);
  const z2 = -x * Math.sin(ay) + z1 * Math.cos(ay);
  return [x2 * Math.cos(az) - y1 * Math.sin(az), x2 * Math.sin(az) + y1 * Math.cos(az), z2];
}

const packColor = (hex) => (0xff000000 | (parseInt(hex.slice(5, 7), 16) << 16) | (parseInt(hex.slice(3, 5), 16) << 8) | parseInt(hex.slice(1, 3), 16)) >>> 0;
const hash = (n) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

const LIGHT = (() => {
  const len = Math.hypot(-0.5, 0.72, 0.62);
  return [-0.5 / len, 0.72 / len, 0.62 / len];
})();

// 立方体の 6 面。頂点の並びは、外から見て反時計回り。
const CUBE_FACES = [
  { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
];

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const tone = TONES[p.tone];
  const root = createRoot(container, 'ua-pgc', { background: tone.bg[0] });
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', 'ドット絵で描いた、輪に囲まれて回る立方体');
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const preview = Boolean(p.preview);
  const colors = {
    bg: tone.bg.map(packColor),
    cube: tone.cube.map(packColor),
    ring: tone.ring.map(packColor),
    thin: tone.thin.map(packColor),
    line: packColor(tone.line),
    star: packColor(tone.star),
    spark: packColor(tone.spark),
  };
  const baseW = p.resolution;
  const baseH = Math.round(baseW * BASE_ASPECT);
  const canvas = h('canvas', { 'aria-hidden': 'true' });
  root.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const view = { w: 0, h: 0, scale: 1, image: null, pixels: null, depth: null, visible: true };
  const state = { kick: 0, grow: reduced ? 1 : 0 };
  const angle = { cubeX: 0.6, cubeY: 0.4, ringTurn: 0.3, ringSpin: 0, thin: 1.1 };
  let sparks = [];
  let time = 0;

  function fit() {
    const cw = root.clientWidth || baseW;
    const ch = root.clientHeight || baseH;
    const scale = Math.max(1, Math.floor(Math.min(cw / baseW, ch / baseH)));
    const w = Math.ceil(cw / scale);
    const hh = Math.ceil(ch / scale);
    if (w === view.w && hh === view.h && scale === view.scale) return;
    canvas.width = w;
    canvas.height = hh;
    canvas.style.width = `${w * scale}px`;
    canvas.style.height = `${hh * scale}px`;
    const image = ctx ? ctx.createImageData(w, hh) : null;
    Object.assign(view, { w, h: hh, scale, image, pixels: image ? new Uint32Array(image.data.buffer) : null, depth: new Float32Array(w * hh) });
    if (reduced) draw();
  }

  function draw() {
    const { w, h: hgt, pixels, depth, image } = view;
    if (!pixels || !image) return;
    const cx = Math.floor(w / 2);
    const cy = Math.floor(hgt / 2) - 1;
    const unit = Math.min(w * 0.25, hgt * 0.28);
    const amount = p.dither;

    // 背景。下へ行くほど明るい 3 色を、網点でつなぐ。
    for (let y = 0; y < hgt; y += 1) {
      // 色の境目のまわりだけを網点にして、帯の中は 1 色で塗る。
      const band = (y / hgt) * 2;
      const part = Math.min(1, Math.max(0, (band - Math.floor(band) - 0.3) / 0.4));
      const t = (Math.min(1, Math.floor(band)) + (band < 2 ? part : 0)) / 2;
      for (let x = 0; x < w; x += 1) pixels[y * w + x] = colors.bg[ditherLevel(t, 3, x, y, amount)];
    }
    depth.fill(-Infinity);
    if (p.stars) {
      for (let i = 0; i < (preview ? 26 : 40); i += 1) {
        const twinkle = Math.sin(time * (0.7 + hash(i + 9) * 2) + hash(i + 3) * TAU);
        if (twinkle < -0.4) continue;
        const x = Math.floor(hash(i) * w);
        const y = Math.floor(hash(i + 50) * hgt * 0.9);
        pixels[y * w + x] = colors.star;
        if (i % 7 === 0 && twinkle > 0.8 && x > 0 && x < w - 1 && y > 0 && y < hgt - 1) {
          pixels[y * w + x - 1] = colors.star;
          pixels[y * w + x + 1] = colors.star;
          pixels[(y - 1) * w + x] = colors.star;
          pixels[(y + 1) * w + x] = colors.star;
        }
      }
    }
    // 床に落ちる影。市松の網点で、半分だけ暗くする。
    const shadowY = Math.min(hgt - 4, Math.round(cy + unit * 1.55));
    const shadowR = unit * 1.1 * state.grow;
    for (let dy = -3; dy <= 3; dy += 1) {
      const half = Math.round(shadowR * Math.sqrt(Math.max(0, 1 - (dy * dy) / 12)));
      for (let x = cx - half; x <= cx + half; x += 1) {
        const y = shadowY + dy;
        if (x >= 0 && x < w && y >= 0 && y < hgt && ((x + y) & 1) === 0) pixels[y * w + x] = colors.bg[0];
      }
    }

    // 少し上から見下ろす向きに全体を倒してから、遠近を付けて画面へ写す。
    const project = ([x, y0, z0]) => {
      const y = y0 * VIEW_COS - z0 * VIEW_SIN;
      const z = y0 * VIEW_SIN + z0 * VIEW_COS;
      const k = (CAM - 1) / (CAM - z);
      return [cx + x * k * unit, cy - y * k * unit, z];
    };
    const put = (x, y, z, color) => {
      if (x < 0 || x >= w || y < 0 || y >= hgt) return;
      const index = y * w + x;
      if (z <= depth[index]) return;
      depth[index] = z;
      pixels[index] = color;
    };

    // 立方体。X 軸と Y 軸の 2 本で回す。面は 2 枚の三角形に分けて塗る。
    const size = 0.56 * state.grow;
    const turnCube = (v) => rotatePoint(v, angle.cubeX, angle.cubeY, 0);
    if (size > 0.02) {
      for (const face of CUBE_FACES) {
        const normal = turnCube(face.n);
        const corners = face.v.map((v) => project(turnCube(v.map((c) => c * size))));
        const [a, b, c, d] = corners;
        const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        // 裏を向いた面は描かない（画面の y は下向きなので、表の面は負になる）。
        if (area >= 0) continue;
        const lit = Math.max(0, normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2]);
        const tris = [
          [a, b, c, [0, 0], [1, 0], [1, 1]],
          [a, c, d, [0, 0], [1, 1], [0, 1]],
        ];
        for (const [p0, p1, p2, t0, t1, t2] of tris) {
          const den = (p1[1] - p2[1]) * (p0[0] - p2[0]) + (p2[0] - p1[0]) * (p0[1] - p2[1]);
          if (Math.abs(den) < 1e-6) continue;
          const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
          const maxX = Math.min(w - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
          const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
          const maxY = Math.min(hgt - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
          for (let y = minY; y <= maxY; y += 1) {
            for (let x = minX; x <= maxX; x += 1) {
              const w0 = ((p1[1] - p2[1]) * (x - p2[0]) + (p2[0] - p1[0]) * (y - p2[1])) / den;
              const w1 = ((p2[1] - p0[1]) * (x - p2[0]) + (p0[0] - p2[0]) * (y - p2[1])) / den;
              const w2 = 1 - w0 - w1;
              if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
              const u = w0 * t0[0] + w1 * t1[0] + w2 * t2[0];
              const v = w0 * t0[1] + w1 * t1[1] + w2 * t2[1];
              const z = w0 * p0[2] + w1 * p1[2] + w2 * p2[2];
              const edge = Math.min(u, v, 1 - u, 1 - v);
              let color;
              if (edge < 0.06) color = colors.line;
              else {
                // 面の模様。内側の枠を 1 段暗く、中央のひし形を 1 段明るくする。
                let shade = 0.1 + lit * 0.78 + (1 - v) * 0.08;
                if (edge > 0.17 && edge < 0.24) shade -= 0.22;
                if (Math.abs(u - 0.5) + Math.abs(v - 0.5) < 0.17) shade += 0.3;
                color = colors.cube[ditherLevel(shade, colors.cube.length, x, y, amount)];
              }
              put(x, y, z, color);
            }
          }
        }
      }
    }

    // 輪。点を細かく打って、手前の点だけを残す。normal で明るさを決める。
    const splat = (pos, normal, ramp, bias) => {
      const [sx, sy, z] = project(pos);
      const x = Math.round(sx);
      const y = Math.round(sy);
      const lit = Math.max(0, normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2]);
      put(x, y, z, ramp[ditherLevel(0.12 + lit * 0.9 + bias, ramp.length, x, y, amount)]);
    };
    // 太い輪。自分の軸で回りながら（鋲の動きで分かる）、傾いた軸ごと Y 軸のまわりを回る。
    // 傾きは見下ろす角度より小さくしてあるので、輪が真横を向いて線になることはない。
    const turnRing = (v) => rotatePoint(rotatePoint(v, 0, 0, angle.ringSpin), 1.07, angle.ringTurn, 0);
    const ringR = 1.2 * state.grow;
    const tube = 0.085;
    if (ringR > 0.05) {
      const around = Math.ceil(ringR * unit * 8) + 24;
      const across = Math.max(8, Math.ceil(tube * unit * 7));
      for (let i = 0; i < around; i += 1) {
        const t = (i / around) * TAU;
        for (let j = 0; j < across; j += 1) {
          const f = (j / across) * TAU;
          const q = ringR + tube * Math.cos(f);
          splat(turnRing([q * Math.cos(t), q * Math.sin(t), tube * Math.sin(f)]), turnRing([Math.cos(f) * Math.cos(t), Math.cos(f) * Math.sin(t), Math.sin(f)]), colors.ring, 0);
        }
      }
      // 鋲。輪の上に 6 個の玉を付ける。
      const studR = 0.15;
      const studSteps = Math.max(8, Math.ceil(studR * unit * 5));
      for (let s = 0; s < 6; s += 1) {
        const t = (s / 6) * TAU;
        for (let i = 0; i <= studSteps; i += 1) {
          const lat = (i / studSteps) * Math.PI - Math.PI / 2;
          for (let j = 0; j < studSteps * 2; j += 1) {
            const lon = (j / (studSteps * 2)) * TAU;
            const n = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
            splat(turnRing([ringR * Math.cos(t) + n[0] * studR, ringR * Math.sin(t) + n[1] * studR, n[2] * studR]), turnRing(n), colors.ring, 0.12);
          }
        }
      }
    }
    // 細い輪。太い輪とも立方体とも違う、X 軸のまわりを回る。
    const thinR = 1.42 * state.grow;
    if (thinR > 0.05) {
      const around = Math.ceil(thinR * unit * 8) + 24;
      const turnThin = (v) => rotatePoint(rotatePoint(v, 0, 0.35, 0), angle.thin, 0, 0.3);
      for (let i = 0; i < around; i += 1) {
        const t = (i / around) * TAU;
        // 破線にして、輪の回る向きが見えるようにする。
        if (Math.floor((i / around) * 36) % 3 === 2) continue;
        const dir = [Math.cos(t), Math.sin(t), 0];
        const pos = turnThin([dir[0] * thinR, dir[1] * thinR, 0]);
        const [sx, sy, z] = project(pos);
        put(Math.round(sx), Math.round(sy), z, colors.thin[z > 0 ? 1 : 0]);
      }
    }

    // 火花。四角いドットが外へ飛ぶ。
    for (const s of sparks) {
      const k = s.life / s.max;
      if (k > 0.7 && Math.floor(time * 14 + s.max * 9) % 2 === 0) continue;
      const [sx, sy, z] = project([s.x, s.y, s.z]);
      const x = Math.round(sx);
      const y = Math.round(sy);
      const color = k < 0.5 ? colors.spark : colors.ring[1];
      put(x, y, z + 3, color);
      if (k < 0.35) put(x + 1, y, z + 3, color);
    }

    ctx.putImageData(image, 0, 0);
  }

  function update(dt) {
    time += dt;
    const rate = p.speed * (1 + state.kick * 5);
    angle.cubeX += dt * 0.7 * rate;
    angle.cubeY += dt * 1.1 * rate;
    angle.ringTurn -= dt * 0.55 * rate;
    angle.ringSpin += dt * 0.9 * rate;
    angle.thin += dt * 0.8 * rate;
    sparks = sparks
      .map((s) => ({ ...s, life: s.life + dt, x: s.x + s.vx * dt, y: s.y + s.vy * dt, z: s.z + s.vz * dt, vy: s.vy - dt * 1.6 }))
      .filter((s) => s.life < s.max);
  }

  // 勢いを付ける。回転が速まり、火花のドットが飛ぶ。
  function spin() {
    if (reduced) return;
    animate(state, { kick: [1, 0], duration: 1800, ease: 'outCubic' });
    const fresh = Array.from({ length: preview ? 14 : 28 }, () => {
      const a = Math.random() * TAU;
      const lift = Math.random() * 2 - 1;
      const speed = utils.random(1.2, 2.8, 2);
      const flat = Math.sqrt(1 - lift * lift);
      return { x: 0, y: 0, z: 0, vx: Math.cos(a) * flat * speed, vy: lift * speed + 0.6, vz: Math.sin(a) * flat * speed, life: 0, max: utils.random(0.5, 1.2, 2) };
    });
    sparks = [...sparks, ...fresh];
  }

  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(root);
  disposer.add(() => resizeObserver.disconnect());
  const intersectionObserver = new IntersectionObserver((entries) => {
    view.visible = entries[entries.length - 1].isIntersecting;
  });
  intersectionObserver.observe(root);
  disposer.add(() => intersectionObserver.disconnect());
  fit();

  let timer = null;
  if (!reduced) {
    // 登場。段を刻んで大きくなり、ドット絵らしいコマ送りにする。
    animate(state, { grow: 1, duration: 1100, ease: steps(8) });
    let last = performance.now();
    timer = createTimer({
      frameRate: 30,
      onUpdate() {
        const now = performance.now();
        const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
        last = now;
        if (!view.visible) return;
        update(dt);
        draw();
      },
    });
    disposer.listen(root, 'pointerdown', spin);
    if (preview) disposer.interval(spin, 4400);
  }

  return {
    spin,
    destroy() {
      timer?.pause();
      utils.remove(state);
      disposer.run();
      removeRoot(root);
    },
  };
}
