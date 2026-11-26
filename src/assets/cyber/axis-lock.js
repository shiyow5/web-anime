import * as THREE from 'three';
import { animate, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { createNoisePass } from '../../lib/postfx.js';
import { TAU, flatBand, glow, glyphStrip, polygonOutline, ringBand, segmentRing, strokes, tickRing, wallBand } from '../../lib/holo.js';

export const meta = {
  id: 'axis-lock',
  title: '多軸のダイヤル錠',
  category: 'cyber',
  libs: ['three', 'animejs'],
  description:
    '球の核を、軸がすべて違う 4 本の輪が囲みます。記号の並んだ輪が 1 本ずつ刻みながら回り、印の位置で止まると光って固定されます。4 本がそろうと輪が同じ面に倒れ込み、核が上下に割れて開きます。クリックするとやり直します。認証や解錠の演出に使えます。',
  params: {
    base: { type: 'color', label: '輪の色 A', default: '#35e8ff' },
    second: { type: 'color', label: '輪の色 B', default: '#b65cff' },
    lock: { type: 'color', label: '固定されたときの色', default: '#c8ff4a' },
    background: { type: 'color', label: '背景色', default: '#04050c' },
    speed: { type: 'range', label: '進む速さ', min: 0.4, max: 2.5, step: 0.1, default: 1 },
    noise: { type: 'range', label: '映像の乱れ', min: 0, max: 1, step: 0.05, default: 0.5 },
    auto: { type: 'range', label: '開いてからやり直すまで（秒、0 で止める）', min: 0, max: 10, step: 0.5, default: 4 },
  },
};

const HALF = Math.PI / 2;
const STEPS = 36; // 輪が刻む 1 周の段数
const RINGS = [
  { radius: 1.32, tilt: [1.15, 0.2, 0], speed: 1.0, glyphs: 26 },
  { radius: 1.66, tilt: [-0.5, 0.95, 0.3], speed: -0.75, glyphs: 32 },
  { radius: 2.0, tilt: [0.45, -0.85, -0.2], speed: 0.58, glyphs: 40 },
  { radius: 2.34, tilt: [-1.0, -0.35, 0.5], speed: -0.46, glyphs: 46 },
];
const WIDTH = 0.24;

// 輪を止める角度を求める。angle から direction の向きへ travel 以上回った先で、鍵の位置（1 周の倍数）に合う角度を返す。
export function lockTarget(angle, direction, travel = 3.5) {
  return direction >= 0 ? Math.ceil((angle + travel) / TAU) * TAU : Math.floor((angle - travel) / TAU) * TAU;
}

// 刻みながら回るときの見かけの角度。steps 段に丸める。
export function snapAngle(angle, steps = STEPS) {
  const step = TAU / steps;
  return Math.round(angle / step) * step;
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 40, cameraZ: 8, background: p.background, preview: p.preview, bloom: { strength: p.preview ? 0.28 : 0.4, radius: 0.3, threshold: 0.3 } });
  const noise = createNoisePass({ scan: 0.22 * p.noise, grain: 0.14 * p.noise, shift: 0.0016 * p.noise, auto: stage.reduced || p.noise === 0 ? 0 : 5 });
  stage.addPass(noise.pass);
  const lockColor = new THREE.Color(p.lock);
  const white = new THREE.Color('#ffffff');

  const system = new THREE.Group();
  const lock = new THREE.Group();
  const hud = new THREE.Group();
  system.add(lock, hud);
  stage.scene.add(system);

  // 輪。tilt が軸の向き、spin が輪そのものの回転。鍵の区切りが印の位置（+X）に来ると合う。
  const rings = RINGS.map((spec, i) => {
    const color = new THREE.Color(i % 2 ? p.second : p.base);
    const pale = color.clone().lerp(white, 0.55);
    const mats = [];
    const tinted = (base, opacity, extra) => {
      const material = glow(base, opacity, extra);
      mats.push({ material, base: new THREE.Color(base) });
      return material;
    };
    const inner = spec.radius - WIDTH / 2;
    const outer = spec.radius + WIDTH / 2;
    const tilt = new THREE.Group();
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(ringBand(inner, outer), tinted(color, 0.06)));
    spin.add(new THREE.Mesh(ringBand(outer - 0.014, outer), tinted(color, 0.95)));
    spin.add(new THREE.Mesh(ringBand(inner, inner + 0.012), tinted(color, 0.85)));
    spin.add(new THREE.Mesh(flatBand(inner + 0.035, outer - 0.035), tinted(pale, 0.95, { map: glyphStrip({ count: spec.glyphs, seed: 11 + i * 7, rails: false }) })));
    spin.add(new THREE.Mesh(tickRing(inner + 0.012, STEPS * 2, 0.02, 0.006, { inward: false, major: { every: 2, length: 0.04, width: 0.009 } }), tinted(pale, 0.7)));
    for (const [r, opacity] of [
      [outer, 0.3],
      [inner, 0.18],
    ]) {
      const wall = new THREE.Mesh(wallBand(r, 0.1, 96), tinted(color, opacity));
      wall.rotation.x = HALF;
      spin.add(wall);
    }
    // 鍵の区切り。ここが印に合うと固定される。
    const key = new THREE.Mesh(ringBand(inner, outer, { start: -0.075, sweep: 0.15 }), glow(p.lock, 0.55));
    const keyEdge = new THREE.Mesh(
      strokes(
        [
          [Math.cos(0.075) * inner, Math.sin(0.075) * inner, Math.cos(0.075) * outer, Math.sin(0.075) * outer],
          [Math.cos(0.075) * inner, -Math.sin(0.075) * inner, Math.cos(0.075) * outer, -Math.sin(0.075) * outer],
        ],
        0.016,
      ),
      glow(p.lock, 1),
    );
    spin.add(key, keyEdge);
    // 動かない印。輪の外から内へ向く矢と、短い弧。
    const marker = new THREE.Group();
    marker.add(
      new THREE.Mesh(
        strokes(
          [
            [outer + 0.2, 0.07, outer + 0.05, 0],
            [outer + 0.2, -0.07, outer + 0.05, 0],
            [outer + 0.2, 0.07, outer + 0.2, -0.07],
          ],
          0.014,
        ),
        tinted(white, 0.9),
      ),
    );
    marker.add(new THREE.Mesh(ringBand(outer + 0.035, outer + 0.05, { start: -0.22, sweep: 0.44 }), tinted(white, 0.6)));
    tilt.add(spin, marker);
    lock.add(tilt);
    return {
      spec,
      tilt,
      spin,
      mats,
      baseTilt: new THREE.Quaternion().setFromEuler(new THREE.Euler(...spec.tilt)),
      state: { angle: i * 1.7, mode: 'free', lit: 0, flash: 0, wobble: 1, e: stage.reduced ? 1 : 0 },
    };
  });

  // 核。上下 2 つの半球の殻と、中の結晶。殻は斜めの軸で回り、開くときは軸に沿って離れる。
  const core = new THREE.Group();
  core.rotation.z = 0.45;
  const shellGeometry = new THREE.SphereGeometry(0.66, 14, 6, 0, TAU, 0, HALF);
  const halves = [1, -1].map((sign) => {
    const half = new THREE.Group();
    const cap = new THREE.Group();
    cap.rotation.x = sign > 0 ? 0 : Math.PI;
    cap.add(new THREE.LineSegments(new THREE.EdgesGeometry(shellGeometry, 1), new THREE.LineBasicMaterial({ color: p.base, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })));
    cap.add(new THREE.Mesh(shellGeometry, glow(p.base, 0.03)));
    const lip = new THREE.Group();
    lip.rotation.x = -HALF;
    lip.add(new THREE.Mesh(ringBand(0.66, 0.7), glow(p.second, 0.7)));
    lip.add(new THREE.Mesh(segmentRing(0.72, 0.78, 12, { fill: 0.6 }), glow(p.second, 0.5)));
    lip.position.y = 0.012;
    cap.add(lip);
    half.add(cap);
    core.add(half);
    return { half, sign };
  });
  const heartMaterial = new THREE.MeshBasicMaterial({ color: p.second });
  const heart = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), heartMaterial);
  const heartCage = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.42, 0)), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
  core.add(heart, heartCage);
  lock.add(core);
  // 開いたときに広がる光の筋と輪。
  const rays = new THREE.Mesh(tickRing(1.02, 24, 0.5, 0.012, { major: { every: 3, length: 0.8, width: 0.02 } }), glow(p.lock, 0));
  const wave = new THREE.Mesh(ringBand(0.97, 1), glow(p.lock, 0));
  lock.add(rays, wave);

  // 下の表示。固定された輪の数だけ点く。
  const pips = rings.map((_, i) => {
    const pip = new THREE.Group();
    pip.position.set((i - 1.5) * 0.3, -2.92, 0);
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.13), glow(p.lock, 0));
    pip.add(new THREE.Mesh(polygonOutline(0.12, 4, 0.012, Math.PI / 4), glow(p.base, 0.8)), fill);
    hud.add(pip);
    return fill;
  });
  hud.add(new THREE.Mesh(strokes([[-0.95, -2.92, -0.68, -2.92], [0.68, -2.92, 0.95, -2.92]], 0.01), glow(p.base, 0.5)));

  const scene = { open: 0, align: 0, wave: 1, burst: 0 };
  const waits = new Set();
  const baseBloom = stage.bloomPass?.strength ?? 0;
  let spinClock = 0;

  // 待ってから次へ進む。やり直しのときにまとめて取り消せるよう、anime.js で数える。
  function wait(ms, fn) {
    const token = { t: 0 };
    waits.add(token);
    animate(token, {
      t: 1,
      duration: ms,
      ease: 'linear',
      onComplete() {
        waits.delete(token);
        fn();
      },
    });
  }

  function openCore() {
    if (!stage.reduced) noise.burst(1.2);
    animate(scene, { align: 1, duration: 1500, ease: 'inOutQuart' });
    animate(scene, { open: 1, duration: 1700, delay: 500, ease: 'outExpo' });
    animate(scene, { wave: [0, 1], duration: 1500, delay: 500, ease: 'outExpo' });
    animate(scene, { burst: [0, 1, 0], duration: 1400, delay: 500, ease: 'outQuad' });
    for (const ring of rings) animate(ring.state, { flash: [1, 0], duration: 1100, delay: 500, ease: 'outQuad' });
    const auto = p.preview ? Math.max(3, p.auto) : p.auto;
    if (auto > 0) wait(2200 + auto * 1000, restart);
  }

  function seek(index) {
    const ring = rings[index];
    if (!ring) {
      wait(450, openCore);
      return;
    }
    const { state, spec } = ring;
    state.mode = 'seek';
    animate(state, {
      angle: lockTarget(state.angle, spec.speed),
      duration: 1700 / p.speed,
      ease: 'outCubic',
      onComplete() {
        state.mode = 'locked';
        if (!stage.reduced) noise.burst(0.45);
        animate(state, { lit: 1, duration: 220, ease: 'outQuad' });
        animate(state, { flash: [1, 0], duration: 800, ease: 'outQuad' });
        animate(state, { wobble: 0, duration: 900, ease: 'outElastic(1, .45)' });
        wait(380 / p.speed, () => seek(index + 1));
      },
    });
  }

  function cancel() {
    utils.remove([scene, ...waits, ...rings.map((ring) => ring.state)]);
    waits.clear();
  }

  function start() {
    for (const ring of rings) ring.state.mode = 'free';
    wait(1500 / p.speed, () => seek(0));
  }

  // 閉じて、輪をばらばらの向きへ戻し、最初からやり直す。
  function restart() {
    if (stage.reduced) return;
    cancel();
    noise.burst(0.8);
    for (const ring of rings) {
      ring.state.mode = 'free';
      ring.state.e = 1;
      animate(ring.state, { lit: 0, flash: 0, duration: 400, ease: 'outQuad' });
      animate(ring.state, { wobble: 1, duration: 900, ease: 'outQuad' });
    }
    animate(scene, { open: 0, align: 0, burst: 0, duration: 800, ease: 'inOutQuart' });
    scene.wave = 1;
    start();
  }

  stage.onResize(() => {
    const view = stage.viewport();
    system.scale.setScalar(Math.min(1, view.width / 5.9, view.height / 6.4));
  });

  const wobbleEuler = new THREE.Euler();
  const wobbleQuat = new THREE.Quaternion();
  const identity = new THREE.Quaternion();
  stage.onFrame((time, dt) => {
    noise.update(time, dt);
    spinClock += dt * p.speed;
    const loose = 1 - scene.align;

    rings.forEach((ring, i) => {
      const { state, spec } = ring;
      if (state.mode === 'free') state.angle += dt * spec.speed * p.speed * 1.6;
      ring.spin.rotation.z = state.mode === 'seek' ? snapAngle(state.angle) : state.angle;
      // 固定されていない輪は、軸そのものもふらつく。そろうと、全部の輪が同じ面へ倒れ込む。
      wobbleEuler.set(Math.sin(spinClock * 0.7 + i * 1.9) * 0.24 * state.wobble, Math.cos(spinClock * 0.55 + i * 2.7) * 0.24 * state.wobble, 0);
      ring.tilt.quaternion.copy(ring.baseTilt).multiply(wobbleQuat.setFromEuler(wobbleEuler)).slerp(identity, scene.align);
      // 登場のときは、輪ごとに別の向きから回り込む。
      ring.tilt.rotateX((1 - state.e) * (i % 2 ? 2.4 : -2.4));
      ring.tilt.scale.setScalar(Math.max(0.001, state.e));
      const gain = (0.8 - 0.15 * state.lit) * (1 + state.flash * 0.8);
      for (const { material, base } of ring.mats) material.color.copy(base).lerp(lockColor, state.lit).multiplyScalar(gain);
      pips[i].material.opacity = state.lit * 0.9;
    });

    core.rotation.y = spinClock * 0.5;
    core.rotation.x = Math.sin(spinClock * 0.4) * 0.3 * loose;
    core.rotation.z = 0.45 * loose;
    for (const { half, sign } of halves) {
      half.position.y = sign * scene.open * 0.5;
      half.rotation.y = sign * scene.open * 1.4;
    }
    heart.rotation.set(time * 0.8, time * 1.1, 0);
    heartCage.rotation.set(-time * 0.5, time * 0.3, 0);
    heart.scale.setScalar(0.6 + scene.open * 0.5 + Math.sin(time * 4) * 0.04);
    heartMaterial.color.set(p.second).lerp(lockColor, scene.open).multiplyScalar(0.75 + scene.open * 0.2);
    rays.scale.setScalar(0.4 + scene.open * 0.75);
    rays.rotation.z = time * 0.15;
    rays.material.opacity = scene.open * 0.4;
    wave.scale.setScalar(0.7 + scene.wave * 2.6);
    wave.material.opacity = scene.wave < 1 ? (1 - scene.wave) * 0.9 : 0;
    if (stage.bloomPass) stage.bloomPass.strength = baseBloom + scene.burst * 0.2;

    lock.rotation.x = (0.12 + Math.sin(time * 0.27) * 0.24 - stage.pointer.sy * 0.4) * loose;
    lock.rotation.y = (Math.sin(time * 0.33) * 0.6 + stage.pointer.sx * 0.5) * loose;
  });

  container.addEventListener('pointerdown', restart);

  if (stage.reduced) {
    // 動きを止めた完成形。4 本とも固定され、核が開いている。
    for (const ring of rings) Object.assign(ring.state, { angle: 0, mode: 'locked', lit: 1, wobble: 0 });
    scene.open = 1;
  } else {
    animate(
      rings.map((ring) => ring.state),
      { e: 1, duration: 1500, delay: stagger(180), ease: 'outExpo' },
    );
    start();
  }

  return {
    reset: restart,
    destroy() {
      container.removeEventListener('pointerdown', restart);
      cancel();
      stage.destroy();
    },
  };
}
