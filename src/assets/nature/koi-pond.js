import { animate, createTimer, stagger, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'koi-pond',
  title: '鯉の池',
  category: 'nature',
  libs: ['animejs'],
  description:
    '上から見た池を、鯉が尾を左右に振りながらゆったり泳ぎます。体は背骨の節を順に追わせて描いているので、向きを変えるとしなやかに曲がります。通った跡には波紋が残り、ポインターを置くとその場所へ寄ってきます。クリックすると、その場所に餌がぱらぱらと落ちます。波紋が届いた鯉から順に向きを変えて集まり、粒をひとつずつ食べては水しぶきを立てます。波紋は岸で折り返し、蓮の葉が順に揺れます。',
  params: {
    count: { type: 'range', label: '鯉の数', min: 2, max: 10, step: 1, default: 6 },
    speed: { type: 'range', label: '泳ぐ速さ', min: 0.2, max: 3, step: 0.1, default: 1 },
    water: { type: 'color', label: '水の色', default: '#1d6f6a' },
    ripples: { type: 'range', label: '波紋の強さ', min: 0, max: 1, step: 0.05, default: 0.7 },
    lilies: { type: 'boolean', label: '蓮の葉を浮かべる', default: true },
  },
};

const CSS = `
.ua-kp{position:absolute;inset:0;overflow:hidden;background:#0d3f3d}
.ua-kp__c{position:absolute;inset:0;width:100%;height:100%;display:block}
`;

const JOINTS = 12;
// 頭から尾までの、体の半分の幅（体長に対する割合）。
const PROFILE = [0.046, 0.074, 0.088, 0.092, 0.089, 0.08, 0.068, 0.054, 0.04, 0.028, 0.018, 0.011];
const COATS = [
  { body: '#f7f1e6', marks: ['#e8542f', '#e8542f', '#1f1f27'] },
  { body: '#f29a2e', marks: ['#fff3d9', '#fbd9a0'] },
  { body: '#fbfbf6', marks: ['#d93a2b'] },
  { body: '#e9b949', marks: ['#f8ecbb', '#d98a24'] },
  { body: '#262630', marks: ['#f08a2a', '#f7f1e6'] },
  { body: '#f7f1e6', marks: ['#f2a23a', '#d93a2b'] },
];
const PADS = [
  { x: 0.13, y: 0.2, r: 0.115, flower: true },
  { x: 0.87, y: 0.15, r: 0.08, flower: false },
  { x: 0.9, y: 0.8, r: 0.125, flower: true },
  { x: 0.09, y: 0.86, r: 0.085, flower: false },
  { x: 0.67, y: 0.07, r: 0.055, flower: false },
  { x: 0.24, y: 0.09, r: 0.05, flower: false },
];

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const from = rgb(a);
  const to = rgb(b);
  return `rgb(${from.map((v, i) => Math.round(v + (to[i] - v) * t)).join(',')})`;
};
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const turnBy = (dx, dy, a) => ({ x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) });

// 点の列を、なめらかな閉じた曲線にする。
function smoothPath(ctx, points) {
  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.moveTo((last.x + points[0].x) / 2, (last.y + points[0].y) / 2);
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    ctx.quadraticCurveTo(points[i].x, points[i].y, (points[i].x + next.x) / 2, (points[i].y + next.y) / 2);
  }
  ctx.closePath();
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-kp');
  const canvas = h('canvas', { class: 'ua-kp__c', 'aria-hidden': 'true' });
  root.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const floor = document.createElement('canvas');
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const count = Math.round(p.preview ? Math.min(p.count, 5) : p.count);

  let width = 1;
  let height = 1;
  let unit = 1;
  let ripples = [];
  let pellets = [];
  const pointer = { x: 0, y: 0, active: false, lastX: 0, lastY: 0 };
  const pads = (p.lilies ? PADS : []).map((pad, i) => ({ ...pad, scale: reduced ? 1 : 0, turn: i * 1.9 }));

  const fishes = Array.from({ length: count }, (_, i) => {
    const coat = COATS[i % COATS.length];
    return {
      x: 0.18 + Math.random() * 0.64,
      y: 0.2 + Math.random() * 0.6,
      angle: Math.random() * Math.PI * 2,
      size: 0.75 + Math.random() * 0.4,
      pace: 0.8 + Math.random() * 0.45,
      seed: Math.random() * 100,
      curiosity: 0.6 + Math.random() * 0.6,
      phase: Math.random() * 6,
      boost: 0,
      alpha: reduced ? 1 : 0,
      alertAt: Infinity,
      wake: Math.random() * 0.5,
      coat,
      marks: Array.from({ length: 3 + (i % 2) }, (_, k) => ({
        joint: 1 + Math.floor(Math.random() * 8),
        side: Math.random() * 1.6 - 0.8,
        r: 0.7 + Math.random() * 0.8,
        color: coat.marks[k % coat.marks.length],
      })),
      joints: null,
    };
  });

  const bodyLength = (fish) => unit * 0.21 * fish.size;

  function placeJoints(fish) {
    const seg = bodyLength(fish) / (JOINTS - 1);
    fish.joints = Array.from({ length: JOINTS }, (_, i) => ({
      x: fish.x - Math.cos(fish.angle) * seg * i,
      y: fish.y - Math.sin(fish.angle) * seg * i,
    }));
  }

  function addRipple(x, y, size, strength, t, rate = 0.085, life = 2.8) {
    if (p.ripples <= 0) return;
    ripples.push({ x, y, size, strength, born: t, rate, life });
    if (ripples.length > 90) ripples = ripples.slice(-90);
  }

  // 餌を撒く。準備: 粒が時間差で落ちる。山場: 波紋が届いた鯉から集まって食べる。余韻: 波紋が岸で折り返し、蓮の葉が揺れる。
  function feed(x, y, t) {
    const rate = 0.2;
    const life = 3.6;
    addRipple(x, y, 1.5, 1, t, rate, life);
    // 岸の向こうに鏡写しの波源を置く。輪が岸に届いた頃に、内側へ戻る弧として見える。
    addRipple(-x, y, 1.5, 0.5, t, rate, life);
    addRipple(2 * width - x, y, 1.5, 0.5, t, rate, life);
    addRipple(x, -y, 1.5, 0.5, t, rate, life);
    addRipple(x, 2 * height - y, 1.5, 0.5, t, rate, life);
    const amount = 6;
    const spin = Math.random() * Math.PI * 2;
    for (let i = 0; i < amount; i += 1) {
      const angle = spin + (i / amount) * Math.PI * 2 + Math.random() * 0.6;
      const reach = unit * (0.03 + Math.random() * 0.09);
      pellets.push({
        x: clamp(x + Math.cos(angle) * reach, unit * 0.14, width - unit * 0.14),
        y: clamp(y + Math.sin(angle) * reach, unit * 0.14, height - unit * 0.14),
        land: t + 0.12 + i * 0.1,
        landed: false,
        eaten: false,
      });
    }
    if (pellets.length > 30) pellets = pellets.slice(-30);
    const speed = unit * 1.5 * rate;
    for (const fish of fishes) {
      // 波紋が届いた鯉から気づく。
      fish.alertAt = Math.min(fish.alertAt, t + 0.2 + Math.hypot(fish.x - x, fish.y - y) / (speed * 2.2) + Math.random() * 0.25);
    }
    for (const pad of pads) {
      const delay = (Math.hypot(pad.x * width - x, pad.y * height - y) / speed) * 1000;
      animate(pad, {
        scale: [
          { to: 1.09, duration: 260, ease: 'outQuad' },
          { to: 1, duration: 1200, ease: 'outElastic(1, .35)' },
        ],
        delay,
      });
    }
  }

  function nearestPellet(fish) {
    let best = null;
    let bestDistance = Infinity;
    for (const pellet of pellets) {
      if (!pellet.landed || pellet.eaten) continue;
      const d = Math.hypot(pellet.x - fish.x, pellet.y - fish.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = pellet;
      }
    }
    return best ? { pellet: best, distance: bestDistance } : null;
  }

  function step(dt, t) {
    const target = pointer.active
      ? pointer
      : p.preview
        ? { x: width * (0.5 + Math.sin(t * 0.45) * 0.3), y: height * (0.5 + Math.sin(t * 0.7 + 1) * 0.26) }
        : null;
    for (const pellet of pellets) {
      if (!pellet.landed && t >= pellet.land) {
        pellet.landed = true;
        addRipple(pellet.x, pellet.y, 0.45, 0.8, t);
      }
    }
    for (const fish of fishes) {
      let turn = Math.sin(t * 0.5 + fish.seed) * 0.5 + Math.sin(t * 0.23 + fish.seed * 0.5) * 0.3;
      const food = t >= fish.alertAt ? nearestPellet(fish) : null;
      if (food) {
        // 餌に気づいた鯉は、いちばん近い粒へ急ぐ。口が届いたら食べて、水しぶきを立てる。
        turn += clamp(wrapAngle(Math.atan2(food.pellet.y - fish.y, food.pellet.x - fish.x) - fish.angle) * 4.5, -4.2, 4.2);
        fish.boost = food.distance > unit * 0.14 ? Math.max(fish.boost, 1.7) : 0.25;
        if (food.distance < unit * 0.05) {
          food.pellet.eaten = true;
          fish.boost = 1.1;
          addRipple(food.pellet.x, food.pellet.y, 0.7, 0.9, t);
        }
      } else if (target) {
        const dx = target.x - fish.x;
        const dy = target.y - fish.y;
        if (Math.hypot(dx, dy) > unit * 0.11) turn += clamp(wrapAngle(Math.atan2(dy, dx) - fish.angle) * 2.2, -2.2, 2.2) * fish.curiosity;
      }
      // 岸に近づいたら、池の中央へ向き直る。
      const margin = unit * 0.1;
      if (fish.x < margin || fish.x > width - margin || fish.y < margin || fish.y > height - margin) {
        turn += clamp(wrapAngle(Math.atan2(height / 2 - fish.y, width / 2 - fish.x) - fish.angle) * 3, -2.6, 2.6);
      }
      fish.angle += turn * dt;
      const pace = fish.pace * p.speed * (1 + fish.boost);
      fish.boost *= Math.exp(-dt * 1.3);
      fish.x += Math.cos(fish.angle) * unit * 0.1 * pace * dt;
      fish.y += Math.sin(fish.angle) * unit * 0.1 * pace * dt;
      fish.phase += dt * 5.2 * pace;

      // 背骨の節は、前の節との間隔を保ったまま後を追う。
      const seg = bodyLength(fish) / (JOINTS - 1);
      fish.joints[0].x = fish.x;
      fish.joints[0].y = fish.y;
      for (let i = 1; i < JOINTS; i += 1) {
        const prev = fish.joints[i - 1];
        const joint = fish.joints[i];
        const dx = joint.x - prev.x;
        const dy = joint.y - prev.y;
        const d = Math.hypot(dx, dy) || 1;
        joint.x = prev.x + (dx / d) * seg;
        joint.y = prev.y + (dy / d) * seg;
      }
      fish.wake -= dt * pace;
      if (fish.wake <= 0) {
        fish.wake = 0.55;
        const tail = fish.joints[JOINTS - 3];
        addRipple(tail.x, tail.y, 0.5 * fish.size, 0.55, t);
      }
    }
    ripples = ripples.filter((ripple) => t - ripple.born < ripple.life);
    pellets = pellets.filter((pellet) => !pellet.eaten);
    if (pellets.length === 0) for (const fish of fishes) fish.alertAt = Infinity;
  }

  // 尾を振った分だけ横へずらした、描画用の背骨を作る。
  function spineOf(fish) {
    const length = bodyLength(fish);
    return fish.joints.map((joint, i) => {
      const a = fish.joints[Math.max(0, i - 1)];
      const b = fish.joints[Math.min(JOINTS - 1, i + 1)];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      const nx = -dy / d;
      const ny = dx / d;
      const sway = Math.sin(fish.phase - i * 0.55) * length * 0.075 * Math.pow(i / (JOINTS - 1), 1.6);
      return { x: joint.x + nx * sway, y: joint.y + ny * sway, nx, ny, fx: dx / d, fy: dy / d, w: PROFILE[i] * length };
    });
  }

  function outline(spine, length) {
    const head = spine[0];
    const nose = { x: head.x + head.fx * length * 0.055, y: head.y + head.fy * length * 0.055 };
    const left = spine.map((s) => ({ x: s.x + s.nx * s.w, y: s.y + s.ny * s.w }));
    const right = spine.map((s) => ({ x: s.x - s.nx * s.w, y: s.y - s.ny * s.w })).reverse();
    return [nose, ...left, ...right];
  }

  function drawFin(base, dirX, dirY, angle, length, spreadAngle) {
    const tip = turnBy(dirX, dirY, angle);
    const a = turnBy(dirX, dirY, angle + spreadAngle);
    const b = turnBy(dirX, dirY, angle - spreadAngle);
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.quadraticCurveTo(base.x + a.x * length * 0.8, base.y + a.y * length * 0.8, base.x + tip.x * length, base.y + tip.y * length);
    ctx.quadraticCurveTo(base.x + b.x * length * 0.8, base.y + b.y * length * 0.8, base.x, base.y);
    ctx.fill();
  }

  function drawFish(fish, shadow) {
    const length = bodyLength(fish);
    const spine = spineOf(fish);
    const points = outline(spine, length);
    if (shadow) {
      ctx.save();
      ctx.translate(unit * 0.014, unit * 0.022);
      ctx.globalAlpha = 0.24 * fish.alpha;
      ctx.fillStyle = '#012221';
      smoothPath(ctx, points);
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.globalAlpha = fish.alpha;
    const tail = spine[JOINTS - 1];
    const swing = Math.sin(fish.phase - JOINTS * 0.55) * 0.55;
    // ひれは体より先に描く。半透明にして、水に透ける感じを出す。
    ctx.fillStyle = mix(fish.coat.body, '#ffffff', 0.45);
    ctx.globalAlpha = 0.7 * fish.alpha;
    drawFin(tail, -tail.fx, -tail.fy, swing + 0.38, length * 0.27, 0.3);
    drawFin(tail, -tail.fx, -tail.fy, swing - 0.38, length * 0.27, 0.3);
    const chest = spine[3];
    const flap = 0.2 * Math.sin(fish.phase * 0.5);
    for (const side of [1, -1]) {
      const base = { x: chest.x + chest.nx * chest.w * 0.8 * side, y: chest.y + chest.ny * chest.w * 0.8 * side };
      drawFin(base, -chest.fx, -chest.fy, side * (0.95 + flap), length * 0.17, 0.42);
    }
    const belly = spine[7];
    for (const side of [1, -1]) {
      const base = { x: belly.x + belly.nx * belly.w * 0.7 * side, y: belly.y + belly.ny * belly.w * 0.7 * side };
      drawFin(base, -belly.fx, -belly.fy, side * 0.8, length * 0.09, 0.4);
    }

    ctx.globalAlpha = fish.alpha;
    ctx.fillStyle = fish.coat.body;
    smoothPath(ctx, points);
    ctx.fill();
    // 模様は体の形で切り抜いて描く。
    ctx.save();
    ctx.clip();
    for (const mark of fish.marks) {
      const at = spine[mark.joint];
      ctx.fillStyle = mark.color;
      ctx.beginPath();
      ctx.ellipse(at.x + at.nx * at.w * mark.side, at.y + at.ny * at.w * mark.side, at.w * mark.r * 1.3, at.w * mark.r, Math.atan2(at.fy, at.fx), 0, Math.PI * 2);
      ctx.fill();
    }
    // 背に沿う明るい筋で、丸みを出す。
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = Math.max(1, length * 0.018);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(spine[1].x, spine[1].y);
    for (let i = 2; i < JOINTS - 2; i += 1) ctx.lineTo(spine[i].x, spine[i].y);
    ctx.stroke();
    ctx.restore();
    const head = spine[0];
    ctx.fillStyle = '#10141a';
    for (const side of [1, -1]) {
      ctx.beginPath();
      ctx.arc(head.x + head.nx * head.w * 0.72 * side + head.fx * length * 0.012, head.y + head.ny * head.w * 0.72 * side + head.fy * length * 0.012, Math.max(1, length * 0.013), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPad(pad, t) {
    if (pad.scale <= 0.01) return;
    const x = pad.x * width + Math.sin(t * 0.4 + pad.turn) * unit * 0.006;
    const y = pad.y * height + Math.cos(t * 0.33 + pad.turn) * unit * 0.006;
    const r = pad.r * unit * pad.scale;
    const a = pad.turn + Math.sin(t * 0.2 + pad.turn) * 0.12;
    const shape = () => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, a + 0.22, a + Math.PI * 2 - 0.22);
      ctx.closePath();
    };
    ctx.save();
    ctx.translate(x + unit * 0.012, y + unit * 0.02);
    ctx.fillStyle = 'rgba(1,34,33,0.28)';
    shape();
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(x, y);
    const fill = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    fill.addColorStop(0, '#6cc27a');
    fill.addColorStop(1, '#2f8554');
    ctx.fillStyle = fill;
    shape();
    ctx.fill();
    ctx.strokeStyle = 'rgba(210,245,200,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 9; i += 1) {
      const va = a + 0.22 + ((Math.PI * 2 - 0.44) * i) / 9;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(va) * r * 0.88, Math.sin(va) * r * 0.88);
    }
    ctx.stroke();
    if (pad.flower) {
      const fx = Math.cos(a + 2.6) * r * 0.42;
      const fy = Math.sin(a + 2.6) * r * 0.42;
      for (const [petals, reach, color] of [[9, 0.36, '#f6b8cd'], [6, 0.24, '#fde4ec']]) {
        ctx.fillStyle = color;
        for (let i = 0; i < petals; i += 1) {
          const pa = (i / petals) * Math.PI * 2 + reach * 3;
          ctx.beginPath();
          ctx.ellipse(fx + Math.cos(pa) * r * reach * 0.5, fy + Math.sin(pa) * r * reach * 0.5, r * reach * 0.55, r * reach * 0.24, pa, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = '#f6c544';
      ctx.beginPath();
      ctx.arc(fx, fy, r * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function draw(t) {
    ctx.drawImage(floor, 0, 0, width, height);
    // 水底に落ちる、ゆらぐ光。
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i += 1) {
      const x = width * (0.5 + Math.sin(t * 0.13 + i * 2.1) * 0.42);
      const y = height * (0.5 + Math.cos(t * 0.17 + i * 1.3) * 0.4);
      const r = unit * (0.22 + 0.06 * Math.sin(t * 0.5 + i));
      const light = ctx.createRadialGradient(x, y, 0, x, y, r);
      light.addColorStop(0, 'rgba(190,255,230,0.09)');
      light.addColorStop(1, 'rgba(190,255,230,0)');
      ctx.fillStyle = light;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const fish of fishes) drawFish(fish, true);
    for (const fish of fishes) drawFish(fish, false);

    ctx.lineWidth = 1.3;
    for (const ripple of ripples) {
      const age = t - ripple.born;
      const fade = Math.pow(1 - age / ripple.life, 1.6) * ripple.strength * p.ripples;
      for (let ring = 0; ring < 3; ring += 1) {
        const radius = unit * ripple.size * (0.03 + age * ripple.rate) - ring * unit * 0.022 * ripple.size;
        if (radius <= 0) continue;
        ctx.strokeStyle = `rgba(225,255,245,${(fade * (0.6 - ring * 0.17)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // 餌の粒。落ちてくる間は影が小さく濃くなり、水面に着くと粒が浮かぶ。
    for (const pellet of pellets) {
      const until = pellet.land - t;
      if (until > 0.3) continue;
      if (!pellet.landed) {
        const k = 1 - until / 0.3;
        ctx.fillStyle = `rgba(0,25,25,${(0.1 + k * 0.25).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(pellet.x, pellet.y, unit * (0.022 - k * 0.012), 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const bob = Math.sin(t * 5 + pellet.x) * unit * 0.0015;
      ctx.fillStyle = '#c98a3c';
      ctx.beginPath();
      ctx.arc(pellet.x, pellet.y + bob, unit * 0.009, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,236,190,0.9)';
      ctx.beginPath();
      ctx.arc(pellet.x - unit * 0.003, pellet.y + bob - unit * 0.003, unit * 0.0035, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const pad of pads) drawPad(pad, t);
    const edge = ctx.createRadialGradient(width / 2, height / 2, unit * 0.35, width / 2, height / 2, Math.hypot(width, height) * 0.6);
    edge.addColorStop(0, 'rgba(0,20,22,0)');
    edge.addColorStop(1, 'rgba(0,20,22,0.5)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, width, height);
  }

  // 水底は動かないので、大きさが変わったときだけ別のキャンバスに描いておく。
  function paintFloor(dpr) {
    floor.width = canvas.width;
    floor.height = canvas.height;
    const f = floor.getContext('2d');
    f.setTransform(dpr, 0, 0, dpr, 0, 0);
    const water = f.createRadialGradient(width * 0.38, height * 0.36, 0, width * 0.5, height * 0.5, Math.hypot(width, height) * 0.62);
    water.addColorStop(0, mix(p.water, '#b9f0dc', 0.34));
    water.addColorStop(0.55, p.water);
    water.addColorStop(1, mix(p.water, '#021c1c', 0.6));
    f.fillStyle = water;
    f.fillRect(0, 0, width, height);
    let seed = 11;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 90; i += 1) {
      const r = unit * (0.008 + rand() * 0.024);
      f.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,30,30,0.13)';
      f.beginPath();
      f.ellipse(rand() * width, rand() * height, r, r * (0.6 + rand() * 0.4), rand() * 3, 0, Math.PI * 2);
      f.fill();
    }
  }

  const started = performance.now();
  const now = () => (performance.now() - started) / 1000;
  let sized = false;

  function resize() {
    const rect = root.getBoundingClientRect();
    const nextWidth = Math.max(1, rect.width);
    const nextHeight = Math.max(1, rect.height);
    for (const fish of fishes) {
      if (!sized) {
        fish.x *= nextWidth;
        fish.y *= nextHeight;
      } else {
        fish.x *= nextWidth / width;
        fish.y *= nextHeight / height;
      }
    }
    width = nextWidth;
    height = nextHeight;
    unit = Math.min(width, height);
    sized = true;
    for (const fish of fishes) placeJoints(fish);
    const dpr = Math.min(window.devicePixelRatio || 1, p.preview ? 1 : 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintFloor(dpr);
    if (reduced) {
      // 動きを止めるときも、体が自然に曲がった形になるまで少し進めてから描く。
      for (let i = 0; i < 90; i += 1) step(1 / 30, i / 30);
      ripples = [];
      for (const fish of fishes) addRipple(fish.joints[JOINTS - 3].x, fish.joints[JOINTS - 3].y, 0.6, 0.6, 2);
      draw(3);
    } else draw(now());
  }
  const observer = new ResizeObserver(resize);
  observer.observe(root);
  disposer.add(() => observer.disconnect());
  resize();

  if (!reduced) {
    // 登場: 鯉が 1 匹ずつ水底から浮かび、蓮の葉が開く。
    animate(fishes, { alpha: 1, duration: 900, delay: stagger(160), ease: 'outQuad' });
    animate(pads, { scale: 1, duration: 900, delay: stagger(110, { start: 200 }), ease: 'outBack(1.8)' });
    let last = performance.now();
    const timer = createTimer({
      onUpdate() {
        const current = performance.now();
        const dt = Math.min(0.05, (current - last) / 1000);
        last = current;
        step(dt, now());
        draw(now());
      },
    });
    disposer.add(() => timer.pause());
    disposer.listen(root, 'pointermove', (event) => {
      const at = localPointer(event, root);
      pointer.x = at.px;
      pointer.y = at.py;
      pointer.active = true;
      if (Math.hypot(at.px - pointer.lastX, at.py - pointer.lastY) > unit * 0.12) {
        pointer.lastX = at.px;
        pointer.lastY = at.py;
        addRipple(at.px, at.py, 0.55, 0.5, now());
      }
    });
    disposer.listen(root, 'pointerleave', () => {
      pointer.active = false;
    });
    disposer.listen(root, 'pointerdown', (event) => {
      const at = localPointer(event, root);
      pointer.x = at.px;
      pointer.y = at.py;
      pointer.active = true;
      feed(at.px, at.py, now());
    });
    // 一覧では、数秒おきに場所を変えて餌を撒く。
    if (p.preview) disposer.interval(() => feed(width * (0.3 + Math.random() * 0.4), height * (0.3 + Math.random() * 0.4), now()), 6500);
  }

  return {
    destroy() {
      disposer.run();
      utils.remove(fishes);
      utils.remove(pads);
      removeRoot(root);
    },
  };
}
