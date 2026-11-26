import * as THREE from 'three';
import { animate, createTimeline, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { TAU, glow, ringBand, segmentRing, strokes, tickRing, circuitRing } from '../../lib/holo.js';
import { createNoisePass } from '../../lib/postfx.js';

export const meta = {
  id: 'gear-reactor',
  title: '歯車の反応炉',
  category: 'cyber',
  libs: ['three', 'animejs'],
  description:
    '光る線で描いた遊星歯車です。中心の太陽歯車、3 枚の遊星歯車、内歯の輪が歯数の比どおりに回り、輪の外側の歯には、直交する軸で立った小歯車が上下からかみ合います。全体はゆっくり向きを変え、ポインターで傾きます。タップすると変速が始まります。回転が止まって少し戻り、小歯車が 1 つずつ外へ離れ、中心の留め具が浮き、外側の 2 本の輪が同じ面にそろいます。続いて映像が乱れ、逆向きの回転で一気に吹け上がり、小歯車が順にかみ合い直して落ち着きます。タップのたびに回る向きが入れ替わります。機械や処理中の表現に使えます。',
  params: {
    color: { type: 'color', label: '輪と線の色', default: '#39f0ff' },
    accent: { type: 'color', label: '遊星歯車の色', default: '#ff3d9a' },
    spark: { type: 'color', label: '小歯車の色', default: '#ffc64a' },
    background: { type: 'color', label: '背景色', default: '#05060d' },
    speed: { type: 'range', label: '回る速さ', min: 0, max: 3, step: 0.1, default: 1 },
    noise: { type: 'range', label: 'ノイズの強さ', min: 0, max: 1, step: 0.05, default: 0.5 },
  },
};

// 角度を -π〜π に収める。輪を同じ面へそろえるとき、近い側へ回すために使う。
const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

// かみ合う相手の角度を返す。driver が角度 angle のとき、方向 phi にある相手の歯車の角度。
// 歯数の比で逆向きに回り、こちらの歯が相手の谷に入るように半歯ずらす。
export function meshAngle(angle, driverTeeth, drivenTeeth, phi) {
  return phi + Math.PI + Math.PI / drivenTeeth - ((angle - phi) * driverTeeth) / drivenTeeth;
}

// 遊星歯車の各部の角度。太陽歯車と腕（キャリア）の角度から、遊星と内歯の輪の角度を決める。
export function planetaryAngles(sun, carrier, { sunTeeth, planetTeeth, planets = 3 }) {
  const ringTeeth = sunTeeth + planetTeeth * 2;
  const relative = sun - carrier;
  const planetAngles = Array.from({ length: planets }, (_, i) => meshAngle(relative, sunTeeth, planetTeeth, (i / planets) * TAU));
  const ring = carrier + Math.PI / ringTeeth + (planetAngles[0] * planetTeeth) / ringTeeth;
  return { planets: planetAngles, ring, ringTeeth };
}

// 歯車の輪郭を線分の集まりで返す。角度 0 に歯の中心が来る。internal なら歯が内側を向く。
function gearSegments(teeth, radius, module, internal = false) {
  const pitch = TAU / teeth;
  const sign = internal ? -1 : 1;
  const root = radius - sign * module * 1.2;
  const tip = radius + sign * module;
  const points = [];
  for (let i = 0; i < teeth; i += 1) {
    const a = i * pitch;
    for (const [offset, r] of [[-0.3, root], [-0.16, tip], [0.16, tip], [0.3, root]]) {
      points.push([Math.cos(a + offset * pitch) * r, Math.sin(a + offset * pitch) * r]);
    }
  }
  return points.map((point, i) => [...point, ...points[(i + 1) % points.length]]);
}

function lineGear({ teeth, radius, module, color, internal = false, spokes = 0, hub = 0.12, width = 0.012 }) {
  const group = new THREE.Group();
  const sign = internal ? -1 : 1;
  group.add(new THREE.Mesh(strokes(gearSegments(teeth, radius, module, internal), width), glow(color, 0.95)));
  // 歯の内側を薄く塗って、線だけのときより歯を読み取りやすくする。
  const low = Math.min(radius - sign * module * 1.2, radius + sign * module);
  const high = Math.max(radius - sign * module * 1.2, radius + sign * module);
  group.add(new THREE.Mesh(segmentRing(low, high, teeth, { fill: 0.46, start: -Math.PI / teeth }), glow(color, 0.2)));
  const rim = radius - sign * module * 2.1;
  group.add(new THREE.Mesh(ringBand(Math.min(rim, rim - sign * width), Math.max(rim, rim - sign * width)), glow(color, 0.7)));
  if (!internal) {
    group.add(new THREE.Mesh(ringBand(hub, hub + width), glow(color, 0.9)));
    group.add(new THREE.Mesh(ringBand(hub * 0.45, hub * 0.45 + width * 0.8), glow(color, 0.6)));
    const lines = Array.from({ length: spokes }, (_, i) => {
      const a = (i / spokes) * TAU + Math.PI / spokes;
      return [Math.cos(a) * (hub + width), Math.sin(a) * (hub + width), Math.cos(a) * rim, Math.sin(a) * rim];
    });
    if (lines.length) group.add(new THREE.Mesh(strokes(lines, width * 0.8), glow(color, 0.55)));
  }
  return group;
}

const SUN = 18;
const PLANET = 12;
const RING = SUN + PLANET * 2;
const MODULE = 1.5 / (RING / 2);
const OUTER = 72;
const OUTER_RADIUS = 1.8;
const OUTER_MODULE = (OUTER_RADIUS * 2) / OUTER;
const PINION = 16;
const PINION_RADIUS = (PINION * OUTER_MODULE) / 2;
const CARRIER_RATIO = 0.2;

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, {
    fov: 38,
    cameraZ: 8,
    background: p.background,
    preview: p.preview,
    maxDpr: p.preview ? 1 : 1.5,
    bloom: { strength: 0.55, radius: 0.3, threshold: 0.25 },
  });
  const noise = createNoisePass({ scan: 0.22 * p.noise, grain: 0.14 * p.noise, shift: 0.0016 * p.noise, auto: stage.reduced || p.noise === 0 ? 0 : 4 });
  stage.addPass(noise.pass);

  const rig = new THREE.Group();
  const system = new THREE.Group();
  rig.add(system);
  stage.scene.add(rig);

  // 奥の計器盤。歯車とは逆向きにゆっくり回る。
  const dial = new THREE.Group();
  dial.position.z = -0.42;
  dial.add(new THREE.Mesh(tickRing(1.42, 120, 0.05, 0.006, { major: { every: 10, length: 0.12 } }), glow(p.color, 0.45)));
  dial.add(new THREE.Mesh(circuitRing(0.82, 1.2, 36, 7), glow(p.color, 0.16)));
  dial.add(new THREE.Mesh(ringBand(1.44, 1.452), glow(p.color, 0.5)));
  system.add(dial);

  const sun = lineGear({ teeth: SUN, radius: (SUN * MODULE) / 2, module: MODULE, color: p.color, spokes: 6, hub: 0.2 });
  const sunCap = new THREE.Group();
  sunCap.position.z = 0.3;
  sunCap.add(new THREE.Mesh(segmentRing(0.26, 0.34, 6, { fill: 0.7 }), glow(p.accent, 0.8)));
  sunCap.add(new THREE.Mesh(ringBand(0.1, 0.16), glow('#ffffff', 0.9)));
  sun.add(sunCap);
  system.add(sun);

  // 腕（キャリア）。3 枚の遊星歯車を支えて、太陽歯車より遅く回る。
  const carrier = new THREE.Group();
  const orbit = ((SUN + PLANET) * MODULE) / 2;
  const arms = new THREE.Group();
  arms.position.z = 0.16;
  arms.add(new THREE.Mesh(strokes([0, 1, 2].map((i) => {
    const a = (i / 3) * TAU;
    const b = ((i + 1) / 3) * TAU;
    return [Math.cos(a) * orbit, Math.sin(a) * orbit, Math.cos(b) * orbit, Math.sin(b) * orbit];
  }), 0.016), glow(p.accent, 0.5)));
  carrier.add(arms);
  const planets = [0, 1, 2].map((i) => {
    const a = (i / 3) * TAU;
    const gear = lineGear({ teeth: PLANET, radius: (PLANET * MODULE) / 2, module: MODULE, color: p.accent, spokes: 4, hub: 0.1 });
    const holder = new THREE.Group();
    holder.position.set(Math.cos(a) * orbit, Math.sin(a) * orbit, 0);
    const pin = new THREE.Mesh(ringBand(0.03, 0.06), glow('#ffffff', 0.9));
    pin.position.z = 0.16;
    holder.add(gear, pin);
    carrier.add(holder);
    return { gear, holder };
  });
  system.add(carrier);

  // 内歯の輪。外側にも歯があり、立った小歯車を回す。
  const ring = new THREE.Group();
  ring.add(lineGear({ teeth: RING, radius: 1.5, module: MODULE, color: p.color, internal: true }));
  ring.add(new THREE.Mesh(strokes(gearSegments(OUTER, OUTER_RADIUS, OUTER_MODULE), 0.01), glow(p.color, 0.95)));
  ring.add(new THREE.Mesh(segmentRing(OUTER_RADIUS - OUTER_MODULE * 1.2, OUTER_RADIUS + OUTER_MODULE, OUTER, { fill: 0.46, start: -Math.PI / OUTER }), glow(p.color, 0.2)));
  ring.add(new THREE.Mesh(segmentRing(1.63, 1.7, 24, { fill: 0.6 }), glow(p.color, 0.3)));
  system.add(ring);

  // 直交する軸の小歯車。輪の半径方向を軸にして立ち、輪の外側の歯と十字にかみ合う。
  const pinions = [0, 1, 2, 3].map((i) => {
    const psi = (i / 4) * TAU + 0.5;
    const below = i % 2 === 1;
    const mountGroup = new THREE.Group();
    mountGroup.rotation.z = psi;
    const stand = new THREE.Group();
    stand.position.set(OUTER_RADIUS, 0, below ? -PINION_RADIUS : PINION_RADIUS);
    stand.rotation.y = Math.PI / 2;
    const gear = lineGear({ teeth: PINION, radius: PINION_RADIUS, module: OUTER_MODULE, color: p.spark, spokes: 4, hub: 0.09, width: 0.01 });
    // 同じ軸の外側で回るはずみ車。
    const fly = new THREE.Group();
    fly.position.z = 0.22;
    fly.add(new THREE.Mesh(tickRing(0.24, 16, 0.07, 0.012), glow(p.spark, 0.7)));
    fly.add(new THREE.Mesh(ringBand(0.24, 0.25), glow(p.spark, 0.6)));
    gear.add(fly);
    stand.add(gear);
    mountGroup.add(stand);
    system.add(mountGroup);
    return { psi, below, gear, stand };
  });

  // 外側を別々の軸で回る 2 本の輪。
  const gimbalA = new THREE.Group();
  gimbalA.add(new THREE.Mesh(ringBand(2.3, 2.315), glow(p.color, 0.55)));
  gimbalA.add(new THREE.Mesh(tickRing(2.3, 72, 0.05, 0.007, { major: { every: 6 } }), glow(p.color, 0.5)));
  const gimbalB = new THREE.Group();
  gimbalB.add(new THREE.Mesh(segmentRing(2.38, 2.41, 8, { fill: 0.55 }), glow(p.accent, 0.6)));
  gimbalB.add(new THREE.Mesh(ringBand(2.44, 2.448), glow(p.accent, 0.4)));
  system.add(gimbalA, gimbalB);

  const kick = { boost: 0 };
  // 変速で使う値。drive は回転の向きと速さの倍率、align は外側の輪が同じ面にそろう度合い、clutch は中心の留め具の浮き。
  const shift = { drive: 1, align: 0, clutch: 0, tiltX: 0, tiltY: 0 };
  const outs = pinions.map(() => ({ v: 0 }));
  let direction = 1;
  const state = { spin: 0, sun: 1, planets: 1, ring: 1, pinions: 1, gimbal: 1 };
  if (!stage.reduced) Object.assign(state, { sun: 0, planets: 0, ring: 0, pinions: 0, gimbal: 0 });

  function place(time) {
    const sunAngle = state.spin;
    const carrierAngle = state.spin * CARRIER_RATIO;
    const set = planetaryAngles(sunAngle, carrierAngle, { sunTeeth: SUN, planetTeeth: PLANET });
    sun.rotation.set((1 - state.sun) * 1.7, 0, sunAngle);
    sun.scale.setScalar(Math.max(0.001, state.sun));
    carrier.rotation.z = carrierAngle;
    arms.scale.setScalar(Math.max(0.001, state.planets));
    planets.forEach(({ gear, holder }, i) => {
      gear.rotation.z = set.planets[i];
      holder.rotation.y = (1 - state.planets) * 2.2;
      holder.scale.setScalar(Math.max(0.001, state.planets));
    });
    ring.rotation.set(0, (1 - state.ring) * -1.9, set.ring);
    ring.scale.setScalar(Math.max(0.001, 0.4 + state.ring * 0.6));
    ring.visible = state.ring > 0.001;
    pinions.forEach(({ psi, below, gear, stand }, i) => {
      const turn = ((set.ring - psi) * OUTER) / PINION;
      gear.rotation.z = below ? Math.PI + Math.PI / PINION - turn : turn + Math.PI / PINION;
      stand.scale.setScalar(Math.max(0.001, state.pinions));
      // 変速のあいだ、小歯車は半径の外へ離れて、かみ合いが外れる。
      stand.position.x = OUTER_RADIUS + outs[i].v * 0.42;
      stand.rotation.y = Math.PI / 2 + outs[i].v * 0.9;
    });
    sunCap.position.z = 0.3 + shift.clutch * 0.55;
    sunCap.rotation.z = shift.clutch * 1.6;
    dial.rotation.z = -state.spin * 0.08;
    const free = 1 - shift.align;
    gimbalA.rotation.set(wrap(time * 0.33 + (1 - state.gimbal) * 2) * free, 0.3 * free, 0);
    gimbalB.rotation.set(0.5 * free, wrap(time * -0.27 - (1 - state.gimbal) * 2) * free, shift.align * 0.4);
    gimbalA.scale.setScalar(Math.max(0.001, state.gimbal));
    gimbalB.scale.setScalar(Math.max(0.001, state.gimbal));
  }

  stage.onResize(() => {
    const view = stage.viewport();
    rig.scale.setScalar(Math.min(1, view.width / 5.3, view.height / 4.5));
  });
  stage.onFrame((time, dt) => {
    state.spin += dt * p.speed * 0.9 * (shift.drive + kick.boost);
    place(time);
    // 全体も 2 つの軸でゆっくり向きを変える。
    rig.rotation.x = -0.92 + Math.sin(time * 0.21) * 0.2 - stage.pointer.sy * 0.3 + shift.tiltX;
    rig.rotation.y = Math.sin(time * 0.16) * 0.55 + stage.pointer.sx * 0.4 + shift.tiltY;
    system.rotation.z = time * 0.05;
    noise.update(time, dt);
  });
  if (stage.reduced) {
    rig.rotation.set(-0.92, 0.3, 0);
    place(0);
  }

  // 変速。止まって少し戻り、小歯車が離れて輪がそろう（準備）→ 映像が乱れ、逆向きに吹け上がる（山場）
  // → 小歯車が順にかみ合い直し、速さが落ち着く（余韻）。タップした側へ全体が傾く。
  function surge(event) {
    if (stage.reduced) return;
    const rect = container.getBoundingClientRect();
    const nx = event?.clientX === undefined ? 0 : ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = event?.clientY === undefined ? 0 : ((event.clientY - rect.top) / rect.height) * 2 - 1;
    const from = direction;
    direction = -direction;
    utils.remove([shift, kick, ...outs]);
    kick.boost = 0;
    animate(shift, {
      drive: [
        { to: 0, duration: 240, ease: 'outQuad' },
        { to: -0.18 * from, duration: 160, ease: 'outQuad' },
        { to: 0, duration: 300, ease: 'inOutQuad' },
        { to: direction * 6, duration: 420, ease: 'inQuad' },
        { to: direction, duration: 1500, ease: 'outExpo' },
      ],
    });
    animate(shift, {
      align: [
        { to: 1, duration: 520, delay: 120, ease: 'outExpo' },
        { to: 0, duration: 1100, delay: 420, ease: 'inOutQuart' },
      ],
      clutch: [
        { to: 1, duration: 320, ease: 'outBack(2.5)' },
        { to: 0, duration: 260, delay: 220, ease: 'inQuad' },
      ],
    });
    animate(shift, {
      tiltX: [{ to: ny * 0.35, duration: 300, ease: 'outQuad' }, { to: 0, duration: 1600, ease: 'outElastic(1, .55)' }],
      tiltY: [{ to: nx * 0.45, duration: 300, ease: 'outQuad' }, { to: 0, duration: 1600, ease: 'outElastic(1, .55)' }],
    });
    animate(outs, {
      v: [
        { to: 1, duration: 300, ease: 'outBack(2)' },
        { to: 0, duration: 420, delay: 520, ease: 'outBounce' },
      ],
      delay: stagger(80),
    });
    clearTimeout(burstTimer);
    burstTimer = setTimeout(() => {
      if (p.noise > 0) noise.burst(1);
    }, 700);
  }
  let burstTimer = 0;
  container.addEventListener('pointerdown', surge);
  const auto = p.preview && !stage.reduced ? setInterval(() => surge(), 5200) : 0;

  let intro = null;
  if (!stage.reduced) {
    // 登場。部品ごとに別の軸から回り込んで、定位置に収まる。
    intro = createTimeline({ defaults: { duration: 1300, ease: 'outExpo' } })
      .add(state, { sun: 1 }, 0)
      .add(state, { planets: 1, ease: 'outBack(1.4)' }, 250)
      .add(state, { ring: 1 }, 500)
      .add(state, { pinions: 1, ease: 'outBack(2)' }, 900)
      .add(state, { gimbal: 1, duration: 1800 }, 700);
  }

  return {
    surge,
    destroy() {
      container.removeEventListener('pointerdown', surge);
      clearTimeout(burstTimer);
      clearInterval(auto);
      intro?.pause();
      utils.remove([state, kick, shift, ...outs]);
      stage.destroy();
    },
  };
}
