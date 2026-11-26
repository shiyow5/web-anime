import { animate, createTimer, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, localPointer, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'radar-sweep',
  title: '探知レーダー',
  category: 'scifi',
  libs: ['animejs'],
  description:
    '斜めに傾けた円盤の上を光の帯が回り、帯が通った場所の目標が光って、少しずつ消えていきます。目標は円盤から柱で浮き上がり、番号・方位・距離が添えられます。ポインターで円盤の傾きと向きが変わり、クリックすると、その場所へ枠が回りながら狭まって新しい目標が現れ、そこから探知の波が円盤の上を広がります。波が届いた順に、消えかけていたほかの目標も光り直します。',
  params: {
    sweep: { type: 'color', label: '光の帯の色', default: '#ffb347' },
    target: { type: 'color', label: '目標の色', default: '#ff4d6d' },
    background: { type: 'color', label: '背景色', default: '#120a06' },
    rpm: { type: 'range', label: '1 分あたりの回転数', min: 2, max: 30, step: 1, default: 11 },
    targets: { type: 'range', label: '目標の数', min: 1, max: 14, step: 1, default: 7 },
    tilt: { type: 'range', label: '傾き（度）', min: 20, max: 75, step: 1, default: 58 },
    rings: { type: 'range', label: '距離の輪の数', min: 2, max: 6, step: 1, default: 4 },
  },
};

const CSS = `
.ua-rs{position:absolute;inset:0;overflow:hidden;cursor:crosshair;
  background:radial-gradient(80% 70% at 50% 58%,color-mix(in srgb,var(--ua-sweep) 15%,var(--ua-bg)),var(--ua-bg) 75%)}
.ua-rs canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
`;

const TAU = Math.PI * 2;
const RANGE_KM = 80;
const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const rgba = (hex, alpha) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
const wrap = (angle) => ((angle % TAU) + TAU) % TAU;

// 円盤の上の角度（右が 0、時計回り）を、北を 0 度とする方位に直す。
export function bearingOf(angle) {
  return Math.round((wrap(angle + Math.PI / 2) * 180) / Math.PI) % 360;
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-rs', { '--ua-bg': p.background, '--ua-sweep': p.sweep });
  const canvas = h('canvas', { role: 'img', 'aria-label': '回転する探知レーダー' });
  root.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const omega = (p.rpm * TAU) / 60;
  const fadeTime = (60 / p.rpm) * 0.42;
  const state = { intro: reduced ? 1 : 0, angle: reduced ? 0.9 : -Math.PI / 2, tilt: (p.tilt * Math.PI) / 180, yaw: 0 };
  const pointer = { x: 0.5, y: 0.5, inside: false };
  let width = 1;
  let height = 1;
  let dpr = 1;
  let serial = 0;

  function makeTarget(radius = 0.18 + Math.random() * 0.74, angle = Math.random() * TAU, lit = 0) {
    serial += 1;
    return {
      id: `T-${String(serial).padStart(2, '0')}`,
      radius,
      angle,
      alt: 0.25 + Math.random() * 0.75,
      drift: (Math.random() - 0.5) * 0.05,
      climb: (Math.random() - 0.5) * 0.012,
      friend: serial % 4 === 0,
      seen: { radius, angle },
      trail: [],
      lit,
    };
  }
  // 最初から何体かは見えているように、消えかけの明るさで置いておく。
  let targets = Array.from({ length: Math.round(p.targets) }, () => makeTarget(undefined, undefined, 0.25 + Math.random() * 0.5));
  if (reduced) {
    for (const target of targets) target.lit = Math.max(0.12, 1 - wrap(state.angle - target.angle) / TAU);
  }

  const layout = () => {
    const ky = Math.cos(state.tilt);
    const kz = Math.sin(state.tilt);
    const R = Math.min(width * 0.365, (height * 0.33) / Math.max(0.3, ky));
    return { ky, kz, R, cx: width / 2, cy: height * 0.57 };
  };

  function draw() {
    const { ky, kz, R, cx, cy } = layout();
    const point = (radius, angle, z = 0) => [cx + Math.cos(angle + state.yaw) * radius * R, cy + Math.sin(angle + state.yaw) * radius * R * ky - z * R * kz];
    const rings = Math.round(p.rings);
    const fs = Math.max(8, R * 0.048);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';

    // 円盤の厚み。少し下にずらした輪を重ねて、板が浮いているように見せる。
    for (let i = 3; i >= 1; i -= 1) {
      ctx.strokeStyle = rgba(p.sweep, 0.1 * state.intro);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy + i * R * 0.035 * kz, R * (1 + i * 0.012), R * ky * (1 + i * 0.012), 0, 0, TAU);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ky);
    ctx.rotate(state.yaw);
    const floor = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    floor.addColorStop(0, rgba(p.sweep, 0.14 * state.intro));
    floor.addColorStop(1, rgba(p.sweep, 0.03 * state.intro));
    ctx.fillStyle = floor;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fill();

    // 距離の輪。登場のときは内側から順に現れる。
    for (let i = 1; i <= rings; i += 1) {
      const show = Math.min(1, Math.max(0, state.intro * (rings + 1) - i));
      ctx.strokeStyle = rgba(p.sweep, (i === rings ? 0.85 : 0.3) * show);
      ctx.lineWidth = i === rings ? 1.6 : 1;
      ctx.setLineDash(i === rings ? [] : [R * 0.012, R * 0.02]);
      ctx.beginPath();
      ctx.arc(0, 0, (R * i) / rings, 0, TAU * show);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = rgba(p.sweep, 0.16 * state.intro);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * TAU;
      ctx.moveTo(Math.cos(a) * R * 0.06, Math.sin(a) * R * 0.06);
      ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
    }
    ctx.stroke();
    // 方位の目盛り。2 度ごとに刻み、10 度と 30 度で長くする。
    ctx.strokeStyle = rgba(p.sweep, 0.7);
    ctx.beginPath();
    const ticks = Math.floor(180 * state.intro);
    for (let i = 0; i < ticks; i += 1) {
      const a = (i / 180) * TAU - Math.PI / 2;
      const long = i % 15 === 0 ? 0.075 : i % 5 === 0 ? 0.045 : 0.022;
      ctx.moveTo(Math.cos(a) * R * 1.02, Math.sin(a) * R * 1.02);
      ctx.lineTo(Math.cos(a) * R * (1.02 + long), Math.sin(a) * R * (1.02 + long));
    }
    ctx.stroke();

    // 光の帯。先頭がいちばん明るく、後ろへ向かって消える。
    const sweep = ctx.createConicGradient(state.angle, 0, 0);
    sweep.addColorStop(0, rgba(p.sweep, 0));
    sweep.addColorStop(0.7, rgba(p.sweep, 0));
    sweep.addColorStop(0.93, rgba(p.sweep, 0.16 * state.intro));
    sweep.addColorStop(1, rgba(p.sweep, 0.55 * state.intro));
    ctx.fillStyle = sweep;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba('#ffffff', 0.85 * state.intro);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(state.angle) * R, Math.sin(state.angle) * R);
    ctx.stroke();

    // 円盤の上に残す印。目標の足もとの輪と、前に見つけた位置の点。
    for (const target of targets) {
      const color = target.friend ? p.sweep : p.target;
      const x = Math.cos(target.seen.angle) * target.seen.radius * R;
      const y = Math.sin(target.seen.angle) * target.seen.radius * R;
      target.trail.forEach((old, i) => {
        ctx.fillStyle = rgba(color, 0.3 * target.lit * (1 - i / 3));
        ctx.beginPath();
        ctx.arc(Math.cos(old.angle) * old.radius * R, Math.sin(old.angle) * old.radius * R, R * 0.008, 0, TAU);
        ctx.fill();
      });
      ctx.strokeStyle = rgba(color, target.lit * 0.9);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(x, y, R * (0.02 + (1 - target.lit) * 0.09), 0, TAU);
      ctx.stroke();
      ctx.fillStyle = rgba(color, target.lit);
      ctx.beginPath();
      ctx.arc(x, y, R * 0.011, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // 光の帯の上に立つ、うすい光の壁。
    const wall = R * 0.2;
    const [bx, by] = point(1, state.angle);
    const gradient = ctx.createLinearGradient(0, cy, 0, cy - wall * kz * 1.2);
    gradient.addColorStop(0, rgba(p.sweep, 0.26 * state.intro));
    gradient.addColorStop(1, rgba(p.sweep, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx, by - wall * kz);
    ctx.lineTo(cx, cy - wall * kz);
    ctx.fill();

    // 方位と距離の数字。円盤の傾きに関係なく、正面を向けて書く。
    ctx.font = `${fs.toFixed(1)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let deg = 0; deg < 360; deg += 30) {
      const [x, y] = point(1.17, (deg * Math.PI) / 180 - Math.PI / 2);
      ctx.fillStyle = rgba(p.sweep, (deg % 90 === 0 ? 0.95 : 0.55) * state.intro);
      ctx.fillText(String(deg).padStart(3, '0'), x, y);
    }
    ctx.textAlign = 'left';
    ctx.font = `${(fs * 0.82).toFixed(1)}px ${FONT}`;
    for (let i = 1; i <= rings; i += 1) {
      const [x, y] = point(i / rings, 0.42);
      ctx.fillStyle = rgba(p.sweep, 0.6 * state.intro);
      ctx.fillText(`${Math.round((RANGE_KM * i) / rings)}`, x + 3, y - fs * 0.6);
    }

    // 目標。足もとから柱を立て、その先に印と札を付ける。
    for (const target of [...targets].sort((a, b) => Math.sin(a.seen.angle + state.yaw) - Math.sin(b.seen.angle + state.yaw))) {
      if (target.lit < 0.02) continue;
      const color = target.friend ? p.sweep : p.target;
      const [gx, gy] = point(target.seen.radius, target.seen.angle);
      const [tx, ty] = point(target.seen.radius, target.seen.angle, target.alt * 0.34);
      const size = R * 0.03;
      ctx.strokeStyle = rgba(color, target.lit * 0.6);
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = rgba(color, target.lit * 0.22);
      ctx.beginPath();
      ctx.arc(tx, ty, size * 2.6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba(color, target.lit);
      ctx.beginPath();
      if (target.friend) ctx.arc(tx, ty, size * 0.8, 0, TAU);
      else {
        ctx.moveTo(tx, ty - size);
        ctx.lineTo(tx + size, ty);
        ctx.lineTo(tx, ty + size);
        ctx.lineTo(tx - size, ty);
      }
      ctx.fill();
      ctx.strokeStyle = rgba(color, target.lit);
      ctx.lineWidth = 1.2;
      ctx.strokeRect(tx - size * 1.7, ty - size * 1.7, size * 3.4, size * 3.4);
      ctx.fillStyle = rgba('#ffffff', target.lit * 0.9);
      ctx.fillText(target.id, tx + size * 2.3, ty - fs * 0.45);
      ctx.fillStyle = rgba(color, target.lit * 0.9);
      ctx.fillText(`${String(bearingOf(target.seen.angle)).padStart(3, '0')}° ${Math.round(target.seen.radius * RANGE_KM)}km`, tx + size * 2.3, ty + fs * 0.55);
    }

    // クリックで出す探知の波と、狭まる枠。波は円盤の面に沿って広がる。
    for (const ping of pings) {
      if (ping.glow > 0.01 && ping.r > 0) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, ky);
        ctx.rotate(state.yaw);
        ctx.beginPath();
        ctx.arc(0, 0, R, 0, TAU);
        ctx.clip();
        const ox = Math.cos(ping.angle) * ping.radius * R;
        const oy = Math.sin(ping.angle) * ping.radius * R;
        for (let i = 0; i < 3; i += 1) {
          const r = (ping.r - i * 0.09) * R;
          if (r <= 0) continue;
          ctx.strokeStyle = rgba(i === 0 ? '#ffffff' : p.target, ping.glow * (0.9 - i * 0.3));
          ctx.lineWidth = i === 0 ? 2 : 1.2;
          ctx.beginPath();
          ctx.arc(ox, oy, r, 0, TAU);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (ping.mark > 0.01) {
        const [mx, my] = point(ping.radius, ping.angle, ping.alt * 0.34 * ping.lockIn);
        const half = R * 0.03 * (1.7 + (1 - ping.lockIn) * 6);
        const corner = half * 0.45;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate((1 - ping.lockIn) * 1.4);
        ctx.strokeStyle = rgba('#ffffff', ping.mark);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          ctx.moveTo(sx * half, sy * (half - corner));
          ctx.lineTo(sx * half, sy * half);
          ctx.lineTo(sx * (half - corner), sy * half);
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    // 中心の軸。
    ctx.strokeStyle = rgba(p.sweep, 0.9 * state.intro);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - wall * kz);
    ctx.stroke();
    ctx.fillStyle = rgba('#ffffff', state.intro);
    ctx.beginPath();
    ctx.arc(cx, cy - wall * kz, Math.max(1.5, R * 0.012), 0, TAU);
    ctx.fill();

    // 四隅の数値。
    const pad = Math.max(8, width * 0.03);
    const live = targets.filter((t) => t.lit > 0.05).length;
    ctx.font = `${fs.toFixed(1)}px ${FONT}`;
    ctx.fillStyle = rgba(p.sweep, 0.85 * state.intro);
    ctx.textAlign = 'left';
    ctx.fillText(`RANGE ${RANGE_KM}KM`, pad, pad + fs * 0.5);
    ctx.fillText(`BRG ${String(bearingOf(state.angle)).padStart(3, '0')}°`, pad, height - pad - fs * 0.5);
    ctx.textAlign = 'right';
    ctx.fillText(`CONTACTS ${String(live).padStart(2, '0')}`, width - pad, pad + fs * 0.5);
    ctx.fillText(`TILT ${Math.round((state.tilt * 180) / Math.PI)}° · ${p.rpm}RPM`, width - pad, height - pad - fs * 0.5);
  }

  function resize() {
    const rect = root.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, p.preview ? 1.5 : 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    draw();
  }

  // クリックした場所を円盤の上の位置に直して、目標を置く。
  function addAt(event) {
    const { px, py } = localPointer(event, root);
    const { ky, R, cx, cy } = layout();
    const dx = (px - cx) / R;
    const dy = (py - cy) / (R * ky);
    const radius = Math.hypot(dx, dy);
    if (radius > 1 || radius < 0.05) return;
    pingAt(radius, Math.atan2(dy, dx) - state.yaw);
  }
  // 枠が狭まって目標が現れ、そこから探知の波が広がる。波が通った目標は、その場で見つけ直したことにする。
  let pings = [];
  function pingAt(radius, angle) {
    const added = makeTarget(radius, angle, reduced ? 1 : 0);
    if (reduced) {
      targets = [...targets, added].slice(-14);
      draw();
      return;
    }
    const ping = { radius, angle, alt: added.alt, r: 0, before: 0, glow: 0, lockIn: 0, mark: 0 };
    pings = [...pings, ping].slice(-4);
    animate(ping, {
      lockIn: { to: 1, duration: 380, ease: 'inOutQuart' },
      mark: [{ to: 1, duration: 120 }, { to: 1, duration: 500 }, { to: 0, duration: 500 }],
      glow: [{ to: 0, duration: 380 }, { to: 1, duration: 80 }, { to: 0, duration: 1700, ease: 'inQuad' }],
      r: [{ to: 0, duration: 380 }, { to: 2, duration: 1780, ease: 'outQuad' }],
      onComplete() {
        pings = pings.filter((item) => item !== ping);
      },
    });
    disposer.timeout(() => {
      added.lit = 1;
      targets = [...targets, added].slice(-14);
    }, 380);
  }
  disposer.add(() => utils.remove(pings));

  const observer = new ResizeObserver(resize);
  observer.observe(root);
  disposer.add(() => observer.disconnect());
  resize();
  disposer.listen(root, 'click', addAt);

  if (reduced) {
    return { destroy: () => (disposer.run(), removeRoot(root)) };
  }

  animate(state, { intro: [0, 1], duration: 1800, ease: 'outQuart' });
  disposer.listen(root, 'pointermove', (event) => {
    const { x, y } = localPointer(event, root);
    pointer.x = x;
    pointer.y = y;
    pointer.inside = true;
  });
  disposer.listen(root, 'pointerleave', () => {
    pointer.inside = false;
  });

  const baseTilt = (p.tilt * Math.PI) / 180;
  let last = performance.now();
  let clock = 0;
  const timer = createTimer({
    onUpdate() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      clock += dt;
      const before = state.angle;
      state.angle += omega * dt;
      // 触っていないときは、円盤をゆっくり左右に振って立体感を見せる。
      const wantYaw = pointer.inside ? (pointer.x - 0.5) * 1.1 : Math.sin(clock * 0.25) * 0.3;
      const wantTilt = Math.min(1.4, Math.max(0.3, baseTilt + (pointer.inside ? (pointer.y - 0.5) * 0.6 : Math.sin(clock * 0.19) * 0.07)));
      const k = Math.min(1, dt * 4);
      state.yaw += (wantYaw - state.yaw) * k;
      state.tilt += (wantTilt - state.tilt) * k;
      for (const target of targets) {
        target.angle += target.drift * dt;
        target.radius += target.climb * dt;
        if (target.radius < 0.14 || target.radius > 0.94) target.climb *= -1;
        target.lit *= Math.exp(-dt / fadeTime);
        for (const ping of pings) {
          const far = Math.hypot(Math.cos(target.angle) * target.radius - Math.cos(ping.angle) * ping.radius, Math.sin(target.angle) * target.radius - Math.sin(ping.angle) * ping.radius);
          if (far > 0.02 && far > ping.before && far <= ping.r) {
            target.seen = { radius: target.radius, angle: target.angle };
            target.lit = Math.max(target.lit, 0.95);
          }
        }
        // 光の帯が目標の方角をまたいだら、その位置で見つけたことにする。
        const gap = wrap(target.angle - before);
        if (gap <= omega * dt + 1e-6) {
          target.trail = [{ ...target.seen }, ...target.trail].slice(0, 3);
          target.seen = { radius: target.radius, angle: target.angle };
          target.lit = 1;
        }
      }
      for (const ping of pings) ping.before = ping.r;
      draw();
    },
  });
  disposer.add(() => timer.pause());
  if (p.preview) disposer.interval(() => pingAt(0.25 + Math.random() * 0.6, Math.random() * TAU), 4600);

  return {
    destroy() {
      disposer.run();
      utils.remove(state);
      removeRoot(root);
    },
  };
}
