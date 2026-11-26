import * as THREE from 'three';
import { animate, stagger, steps, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { TAU, canvasTexture, circuitRing, flatBand, glow, glyphStrip, gridDisc, polygonOutline, ringBand, segmentRing, strokes, tickRing } from '../../lib/holo.js';
import { createNoisePass } from '../../lib/postfx.js';

export const meta = {
  id: 'glitch-dial',
  title: '乱れる計器盤',
  category: 'cyber',
  libs: ['three', 'animejs'],
  description:
    '斜め下から見上げる大きな円盤の上に、高さの違う小さな計器が 6 個浮かび、それぞれ自分の軸で傾いて揺れます。針・波形・棒グラフ・数字が値に合わせて動き、数秒ごとに強いノイズが走って計器の位置がずれ、弾みながら戻ります。タップすると較正が始まります。映像が乱れたあと、計器がタップした位置へ顔を向け、近いものから順に値を 0 へ落としてから最大まで振り切り、面を 1 回転させて、弾みながら今の値へ戻ります。足もとの円盤も勢いよく回って落ち着きます。値は setValue で外から渡せます。',
  params: {
    color: { type: 'color', label: '線の色', default: '#cdf3ff' },
    accent: { type: 'color', label: '差し色', default: '#b08cff' },
    warn: { type: 'color', label: '値が高いときの色', default: '#ff6fae' },
    background: { type: 'color', label: '背景色', default: '#06060f' },
    speed: { type: 'range', label: '値の変わる速さ', min: 0, max: 3, step: 0.1, default: 1 },
    interval: { type: 'range', label: '乱れる間隔（秒、0 で止める）', min: 0, max: 10, step: 0.5, default: 3.5 },
  },
};

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));
const ARC_START = Math.PI * 1.25;
const ARC_SWEEP = -Math.PI * 1.5;
const ARC_STEPS = 48;
const WAVE_SEGMENTS = 40;
const BAR_COUNT = 7;
const RADIAL_COUNT = 24;
const HIGH = 0.8;

// 値（0〜1）を、針の角度に直す。左下から時計回りに 270 度ぶん振れる。
export function needleAngle(value, start = ARC_START, sweep = ARC_SWEEP) {
  return start + sweep * clamp01(value);
}

// 外から値を渡していないときに見せる、ゆっくり揺れる値（0〜1）。
export function autoValue(index, time) {
  return clamp01(0.5 + 0.3 * Math.sin(time * (0.5 + index * 0.13) + index * 1.9) + 0.2 * Math.sin(time * (1.3 + index * 0.21) + index));
}

// 計器ごとの種類、円盤の上での位置（x, z）、高さ、半径、据え付けの傾き。
const GAUGES = [
  { kind: 'needle', x: -1.75, z: 0.1, height: 2.1, radius: 0.55, tilt: [0.5, 0.35, 0.05] },
  { kind: 'wave', x: 0.0, z: -0.4, height: 3.05, radius: 0.62, tilt: [0.35, -0.1, 0] },
  { kind: 'bars', x: 1.75, z: 0.2, height: 1.9, radius: 0.52, tilt: [0.55, -0.4, -0.06] },
  { kind: 'radial', x: -0.85, z: 0.9, height: 0.6, radius: 0.38, tilt: [0.7, 0.2, 0.1] },
  { kind: 'needle', x: 0.95, z: 0.9, height: 0.65, radius: 0.42, tilt: [0.75, -0.2, -0.1] },
  { kind: 'radial', x: -0.1, z: 0.2, height: 1.55, radius: 0.34, tilt: [0.45, 0.1, 0] },
];

function writeStroke(out, at, ax, ay, bx, by, width) {
  const length = Math.hypot(bx - ax, by - ay) || 1;
  const nx = (-(by - ay) / length) * width * 0.5;
  const ny = ((bx - ax) / length) * width * 0.5;
  out.set([ax - nx, ay - ny, 0, bx - nx, by - ny, 0, bx + nx, by + ny, 0, ax - nx, ay - ny, 0, bx + nx, by + ny, 0, ax + nx, ay + ny, 0], at);
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 45, cameraZ: 7.6, background: p.background, preview: p.preview, bloom: { strength: 0.42, radius: 0.25, threshold: 0.3 } });
  const noise = createNoisePass({ scan: 0.22, grain: 0.08, shift: 0.0014, auto: 0 });
  stage.addPass(noise.pass);

  const lineColor = new THREE.Color(p.color);
  const accentColor = new THREE.Color(p.accent);
  const warnColor = new THREE.Color(p.warn);
  const line = (geometry, opacity = 1, extra) => new THREE.Mesh(geometry, glow(p.color, opacity, extra));
  const accent = (geometry, opacity = 1, extra) => new THREE.Mesh(geometry, glow(p.accent, opacity, extra));

  const rig = new THREE.Group();
  const board = new THREE.Group();
  board.position.y = -1.0;
  rig.add(board);
  stage.scene.add(rig);

  // 大きな円盤。高さの違う 3 枚の輪が、互い違いに回る。
  const deck = new THREE.Group();
  deck.rotation.x = -Math.PI / 2;
  board.add(deck);
  const glyphs = glyphStrip({ count: 32, seed: 6 });
  glyphs.repeat.x = 4;
  const deckLayers = [
    { z: 0, rate: 0.06, parts: [line(ringBand(2.565, 2.6), 0.8), line(tickRing(2.52, 120, 0.06, 0.01, { major: { every: 10 } }), 0.55), line(gridDisc(1.9, 8, 0.008), 0.1)] },
    { z: -0.14, rate: -0.1, parts: [accent(circuitRing(2.66, 2.82, 80, 13, { density: 0.75 }), 0.7), line(ringBand(2.86, 2.87), 0.4)] },
    { z: 0.12, rate: 0.16, parts: [line(flatBand(2.18, 2.3), 0.65, { map: glyphs }), accent(segmentRing(1.96, 2.02, 16, { fill: 0.55 }), 0.75), line(polygonOutline(0.5, 6, 0.014), 0.5)] },
  ].map((spec, index) => {
    const group = new THREE.Group();
    group.position.z = spec.z;
    group.add(...spec.parts);
    deck.add(group);
    return { group, rate: spec.rate, from: [index === 1 ? 1.4 : -1.2, index === 2 ? 1.5 : 0.4], t: stage.reduced ? 1 : 0 };
  });

  const gauges = GAUGES.map((spec, index) => {
    const r = spec.radius;
    const holder = new THREE.Group();
    const tilt = new THREE.Group();
    const face = new THREE.Group();
    face.add(line(ringBand(r - 0.03, r), 0.9));
    face.add(index % 2 ? accent(segmentRing(r + 0.04, r + 0.09, 9 + index, { fill: 0.6 }), 0.7) : accent(circuitRing(r + 0.03, r + 0.13, 22 + index * 3, 50 + index), 0.7));
    const live = [];
    const item = { ...spec, tilt0: spec.tilt, index, holder, tilt, live, value: autoValue(index, 0), shown: -1, off: { x: 0, y: 0, z: 0, turn: 0 }, cal: { on: 0, v: 0, face: 0, spin: 0 }, t: stage.reduced ? 1 : 0 };

    if (spec.kind === 'needle') {
      face.add(line(tickRing(r - 0.06, 20, 0.07, 0.012, { start: ARC_START, sweep: ARC_SWEEP, major: { every: 5 } }), 0.6));
      item.arc = accent(ringBand(r - 0.26, r - 0.2, { start: ARC_START, sweep: ARC_SWEEP, steps: ARC_STEPS }), 0.85);
      item.needle = line(strokes([[-0.08, 0, r - 0.1, 0]], 0.022), 1);
      face.add(item.arc, item.needle, line(polygonOutline(0.05, 6, 0.012), 0.9));
      live.push(item.arc.material, item.needle.material);
    } else if (spec.kind === 'wave') {
      item.wavePositions = new Float32Array(WAVE_SEGMENTS * 18);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(item.wavePositions, 3).setUsage(THREE.DynamicDrawUsage));
      item.wave = accent(geometry, 0.95);
      item.wave.frustumCulled = false;
      face.add(item.wave, line(gridDisc(r * 0.82, 3, 0.006), 0.18), line(strokes([[-r * 0.8, 0, r * 0.8, 0]], 0.008), 0.4));
      live.push(item.wave.material);
    } else if (spec.kind === 'bars') {
      item.bars = Array.from({ length: BAR_COUNT }, (_, j) => {
        const geometry = new THREE.PlaneGeometry(r * 0.1, 1);
        geometry.translate(0, 0.5, 0);
        const bar = accent(geometry, 0.85);
        bar.position.set((j - (BAR_COUNT - 1) / 2) * r * 0.17, -r * 0.42, 0);
        face.add(bar);
        live.push(bar.material);
        return bar;
      });
      face.add(line(strokes([[-r * 0.66, -r * 0.45, r * 0.66, -r * 0.45]], 0.012), 0.6));
    } else {
      item.radial = accent(segmentRing(r - 0.2, r - 0.09, RADIAL_COUNT, { fill: 0.7, start: Math.PI / 2, sweep: -TAU }), 0.9);
      item.perSegment = item.radial.geometry.attributes.position.count / RADIAL_COUNT;
      item.inner = line(tickRing(r - 0.25, 12, 0.05, 0.012), 0.6);
      face.add(item.radial, item.inner);
      live.push(item.radial.material);
    }

    // 数字の表示。値が変わったときだけ描き直す。
    item.readout = canvasTexture(128, 48, () => {});
    const digits = line(new THREE.PlaneGeometry(r * 0.72, r * 0.27), 0.9, { map: item.readout });
    digits.position.set(0, spec.kind === 'bars' ? r * 0.62 : -r * 0.5, 0.02);
    if (spec.kind === 'wave') digits.position.y = -r * 0.62;
    face.add(digits);

    tilt.add(face);
    holder.add(tilt);
    board.add(holder);
    // 円盤から計器へ伸びる細い柱と、足もとの印。
    const stem = line(new THREE.CylinderGeometry(0.006, 0.006, spec.height, 5), 0.3);
    stem.position.set(spec.x, spec.height / 2, spec.z);
    const foot = line(ringBand(0.09, 0.11), 0.6);
    foot.position.set(spec.x, -spec.z, 0.01);
    board.add(stem);
    deck.add(foot);
    item.stem = stem;
    return item;
  });

  function drawReadout(gauge) {
    const number = Math.round(gauge.value * 100);
    if (number === gauge.shown) return;
    gauge.shown = number;
    const ctx = gauge.readout.image.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 128, 48);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(number).padStart(3, '0'), 64, 26);
    gauge.readout.needsUpdate = true;
  }

  const fixed = GAUGES.map(() => null);
  let fit = 1;
  stage.onResize(() => {
    const view = stage.viewport();
    fit = Math.min(1, view.width / 6.4, view.height / 5.6);
    rig.scale.setScalar(fit);
  });

  // 乱れ。強いノイズと一緒に、計器が別々の向きへ飛び、弾みながら戻る。
  function glitch() {
    if (stage.reduced) return;
    noise.burst(1.3);
    for (const gauge of gauges) {
      const jump = () => utils.random(-0.4, 0.4, 2);
      const jitter = (first) => [
        { to: first, duration: 60, ease: steps(1) },
        { to: -first * 0.5, duration: 90, ease: steps(1) },
        { to: 0, duration: 800, ease: 'outElastic(1, .45)' },
      ];
      utils.remove(gauge.off);
      animate(gauge.off, { x: jitter(jump()), y: jitter(jump() * 0.6), z: jitter(jump()), turn: jitter(jump() * 1.5), delay: gauge.index * 35 });
    }
  }

  // 較正。映像が乱れ、計器がタップした位置へ顔を向ける（準備）→ 近いものから順に 0 へ落ちて最大まで振り切り、
  // 面が 1 回転する（山場）→ 弾みながら今の値へ戻り、向きもほどける（余韻）。
  const aim = { x: 0, y: 0 };
  const deckSpin = { a: 0 };
  const seen = new THREE.Vector3();
  let clock = 0;
  function calibrate(event) {
    if (stage.reduced) return;
    const rect = container.getBoundingClientRect();
    const nx = event?.clientX === undefined ? 0 : ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = event?.clientY === undefined ? 0.2 : -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    aim.x = -ny * 0.45;
    aim.y = nx * 0.6;
    noise.burst(1);
    utils.remove(deckSpin);
    animate(deckSpin, { a: deckSpin.a + 1.8, duration: 2000, delay: 300, ease: 'outExpo' });
    const order = gauges
      .map((gauge) => {
        gauge.holder.getWorldPosition(seen).project(stage.camera);
        return { gauge, gap: Math.hypot(seen.x - nx, seen.y - ny) };
      })
      .sort((a, b) => a.gap - b.gap);
    order.forEach(({ gauge }, rank) => {
      const { cal, index } = gauge;
      const delay = 140 + rank * 120;
      const live = fixed[index] ?? autoValue(index, (clock + (delay + 1500) / 1000) * p.speed);
      utils.remove(cal);
      cal.v = gauge.value;
      cal.on = 1;
      cal.spin = 0;
      animate(cal, {
        v: [
          { to: 0, duration: 260, ease: 'inQuad' },
          { to: 1, duration: 520, ease: 'inOutQuad' },
          { to: 1, duration: 140 },
          { to: live, duration: 620, ease: 'outBack(2.2)' },
        ],
        delay,
        onComplete() {
          cal.on = 0;
        },
      });
      animate(cal, {
        face: [
          { to: 1, duration: 320, ease: 'outBack(2)' },
          { to: 1, duration: delay + 1000 },
          { to: 0, duration: 1000, ease: 'outElastic(1, .5)' },
        ],
      });
      animate(cal, { spin: TAU, duration: 900, delay: delay + 260, ease: 'inOutQuart' });
    });
  }

  let nextGlitch = p.interval > 0 ? p.interval * 0.9 : Infinity;
  let readoutAt = 0;
  const tint = new THREE.Color();
  stage.onFrame((time, dt) => {
    noise.update(time, dt);
    clock = time;
    if (time > nextGlitch) {
      nextGlitch = time + p.interval * (0.75 + Math.random() * 0.5);
      glitch();
    }
    for (const layer of deckLayers) {
      const rest = 1 - layer.t;
      layer.group.rotation.set(rest * layer.from[0], rest * layer.from[1], time * layer.rate + deckSpin.a * Math.sign(layer.rate || 1));
      layer.group.scale.setScalar(Math.max(0.001, layer.t));
    }
    const follow = 1 - Math.exp(-dt * 6);
    const redraw = time - readoutAt > 0.12;
    if (redraw) readoutAt = time;
    for (const gauge of gauges) {
      const { index, radius: r } = gauge;
      const goal = fixed[index] ?? autoValue(index, time * p.speed);
      // 較正のあいだは、較正の値をそのまま見せる。
      if (gauge.cal.on) gauge.value = clamp01(gauge.cal.v);
      else gauge.value += (goal - gauge.value) * (stage.reduced ? 1 : follow);
      const v = gauge.value;
      if (redraw || gauge.shown < 0) drawReadout(gauge);
      // 値が高い計器は、色が変わる。
      tint.copy(accentColor).lerp(warnColor, clamp01((v - HIGH + 0.08) / 0.08));
      for (const material of gauge.live) material.color.copy(tint);

      if (gauge.kind === 'needle') {
        gauge.needle.material.color.copy(lineColor).lerp(warnColor, clamp01((v - HIGH + 0.08) / 0.08));
        gauge.needle.rotation.z = needleAngle(v) + Math.sin(time * 31 + index) * 0.012;
        gauge.arc.geometry.setDrawRange(0, Math.round(v * ARC_STEPS) * 6);
      } else if (gauge.kind === 'wave') {
        const half = r * 0.78;
        const point = (k) => {
          const u = k / WAVE_SEGMENTS;
          const envelope = Math.sin(u * Math.PI);
          return [(u * 2 - 1) * half, (Math.sin(u * 14 - time * 5) * 0.6 + Math.sin(u * 31 + time * 8) * 0.4) * envelope * r * 0.5 * (0.15 + v)];
        };
        for (let k = 0; k < WAVE_SEGMENTS; k += 1) writeStroke(gauge.wavePositions, k * 18, ...point(k), ...point(k + 1), 0.022);
        gauge.wave.geometry.attributes.position.needsUpdate = true;
      } else if (gauge.kind === 'bars') {
        gauge.bars.forEach((bar, j) => { bar.scale.y = r * (0.06 + 0.9 * clamp01(v * (0.65 + 0.35 * Math.sin(time * 2.3 + j * 1.3)))); });
      } else {
        gauge.radial.geometry.setDrawRange(0, Math.round(v * RADIAL_COUNT) * gauge.perSegment);
        gauge.inner.rotation.z = -time * (0.6 + v * 2);
      }

      const rest = 1 - gauge.t;
      gauge.holder.visible = gauge.t > 0.001;
      gauge.holder.position.set(gauge.x + gauge.off.x, gauge.height * gauge.t + gauge.off.y + Math.sin(time * 0.9 + index * 1.7) * 0.04, gauge.z + gauge.off.z);
      gauge.holder.scale.setScalar(Math.max(0.001, gauge.t));
      // 計器ごとに、据え付けの傾きを中心に別々の軸で揺れる。
      gauge.tilt.rotation.set(
        gauge.tilt0[0] + Math.sin(time * 0.8 + index) * 0.1 + rest * 1.5 + gauge.cal.face * aim.x,
        gauge.tilt0[1] + Math.sin(time * 0.6 + index * 2.1) * 0.2 + rest * (index % 2 ? 2 : -2) + gauge.cal.face * aim.y,
        gauge.tilt0[2] + Math.sin(time * 0.5 + index * 0.7) * 0.06 + gauge.off.turn + gauge.cal.spin,
      );
      gauge.stem.scale.y = Math.max(0.001, gauge.t);
      gauge.stem.position.y = (gauge.height * gauge.t) / 2;
    }
    // 斜め下から見上げる。ゆっくり左右に向きを変える。
    rig.rotation.set(-0.5 + Math.sin(time * 0.24) * 0.05 - stage.pointer.sy * 0.14, Math.sin(time * 0.17) * 0.28 + stage.pointer.sx * 0.35, -0.08);
  });

  container.addEventListener('pointerdown', calibrate);
  const autoCal = p.preview && !stage.reduced ? setInterval(() => calibrate(), 6000) : 0;
  if (!stage.reduced) {
    animate(deckLayers, { t: 1, duration: 1300, delay: stagger(160), ease: 'outExpo' });
    animate(gauges, { t: 1, duration: 1100, delay: stagger(130, { start: 500 }), ease: 'outBack(1.6)' });
  }

  return {
    glitch,
    // index 番目（0〜5）の計器に、値（0〜1）を渡す。渡した計器は自動で揺れなくなる。
    setValue(index, value) {
      if (Number.isInteger(index) && index >= 0 && index < fixed.length) fixed[index] = clamp01(value);
    },
    // すべての計器を、自動で揺れる値に戻す。
    auto() {
      fixed.fill(null);
    },
    calibrate,
    destroy() {
      container.removeEventListener('pointerdown', calibrate);
      clearInterval(autoCal);
      utils.remove(deckSpin);
      for (const gauge of gauges) utils.remove(gauge.cal);
      utils.remove(deckLayers);
      utils.remove(gauges);
      for (const gauge of gauges) utils.remove(gauge.off);
      stage.destroy();
    },
  };
}
