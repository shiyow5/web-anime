import * as THREE from 'three';
import { animate, steps, stagger, utils } from 'animejs';
import { createStage } from '../../lib/stage.js';
import { resolveParams } from '../../lib/params.js';
import { TAU, canvasTexture, circuitRing, drawGlyph, glow, glyphStrip, gridDisc, polygonOutline, ringBand, seeded, segmentRing, tickRing, wallBand } from '../../lib/holo.js';
import { createNoisePass } from '../../lib/postfx.js';

export const meta = {
  id: 'data-sphere',
  title: '情報の球',
  category: 'cyber',
  libs: ['three', 'animejs'],
  description:
    '緯線と経線の輪でできた 3 つの殻が、殻ごとに別の軸で回ります。表面を光の点が尾を引いて走り、周りでは小さな表示板が立ったまま球を回ります。数秒ごとに映像が乱れて殻がずれます。タップすると同期が始まります。殻の回転が止まりかけ、3 つの殻の軸が順に隣の殻の軸へ入れ替わり、映像が乱れたあと、表示板がタップした側から順にせり出して裏返り、別の表示に切り替わります。最後に殻が一気に回って落ち着きます。通信網や集計中のデータを表す場面に使えます。',
  params: {
    color: { type: 'color', label: '線の色', default: '#c8f1ff' },
    accent: { type: 'color', label: '差し色', default: '#a98bff' },
    point: { type: 'color', label: '走る点の色', default: '#ff7ac0' },
    background: { type: 'color', label: '背景色', default: '#04060e' },
    speed: { type: 'range', label: '回る速さ', min: 0, max: 3, step: 0.1, default: 1 },
    runners: { type: 'range', label: '殻ごとの光の点', min: 1, max: 8, step: 1, default: 4 },
    interval: { type: 'range', label: '乱れる間隔（秒、0 で止める）', min: 0, max: 10, step: 0.5, default: 4 },
  },
};

const TRAIL = 8;
const PANEL_COUNT = 5;
const ORBIT = 2.95;
// 殻ごとの半径、据え付けの傾き、回る軸（x・y・z の速さ）、登場のときに回り込んでくる向き。
const SHELLS = [
  { radius: 1.0, tilt: [0.2, 0, 0.1], rate: [0, 0.5, 0], from: [1.8, 0, 0] },
  { radius: 1.5, tilt: [0, 0.4, 0.5], rate: [-0.32, 0, 0.1], from: [0, 0, -1.9] },
  { radius: 2.0, tilt: [0.5, 0, -0.3], rate: [0.05, -0.2, 0], from: [-1.4, 1.6, 0] },
];

// 表示板の絵。枠と、作りものの文字と、種類ごとの図（棒・波・六角形）を描く。
function panelTexture(kind, seed) {
  return canvasTexture(256, 160, (ctx, width, height) => {
    const random = seeded(seed);
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, width - 8, height - 8);
    ctx.fillRect(4, 4, 70, 9);
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 6; i += 1) drawGlyph(ctx, 16 + i * 22, 24, 17, random);
    ctx.fillRect(16, 52, width - 32, 2);
    if (kind === 0) {
      for (let i = 0; i < 9; i += 1) {
        const bar = 14 + random() * 64;
        ctx.fillRect(20 + i * 25, 142 - bar, 14, bar);
      }
    } else if (kind === 1) {
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (let x = 16; x <= width - 16; x += 4) {
        const y = 102 + Math.sin(x * 0.09 + seed) * 26 * Math.sin(x * 0.021 + 0.6);
        if (x === 16) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    } else {
      ctx.lineWidth = 3;
      for (let i = 0; i < 4; i += 1) {
        ctx.beginPath();
        for (let k = 0; k <= 6; k += 1) {
          const a = (k / 6) * TAU;
          ctx[k === 0 ? 'moveTo' : 'lineTo'](44 + i * 56 + Math.cos(a) * 22, 102 + Math.sin(a) * 22);
        }
        if (random() < 0.5) ctx.fill();
        else ctx.stroke();
      }
    }
  });
}

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const stage = createStage(container, { fov: 40, cameraZ: 10.5, background: p.background, preview: p.preview, bloom: { strength: 0.42, radius: 0.25, threshold: 0.3 } });
  const noise = createNoisePass({ scan: 0.2, grain: 0.07, shift: 0.0012, auto: 0 });
  stage.addPass(noise.pass);
  const random = seeded(7);

  const line = (geometry, opacity = 1, extra) => new THREE.Mesh(geometry, glow(p.color, opacity, extra));
  const accent = (geometry, opacity = 1, extra) => new THREE.Mesh(geometry, glow(p.accent, opacity, extra));
  const root = new THREE.Group();
  stage.scene.add(root);

  // 緯線。高さ phi の位置に、水平な輪を置く。
  function latitude(make, radius, phi, width, arc) {
    const r = radius * Math.cos(phi);
    const mesh = make(ringBand(r - width / 2, r + width / 2, arc), 0.75);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = radius * Math.sin(phi);
    return mesh;
  }
  // 経線。立った輪を、Y 軸のまわりに theta だけ回して置く。
  function meridian(make, radius, theta, width, arc) {
    const mesh = make(ringBand(radius - width / 2, radius + width / 2, arc), 0.75);
    mesh.rotation.y = theta;
    return mesh;
  }
  const flat = (...children) => {
    const group = new THREE.Group();
    group.rotation.x = -Math.PI / 2;
    group.add(...children);
    return group;
  };

  const dot = canvasTexture(64, 64, (ctx) => {
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.7)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  });
  const runnerCount = p.preview ? Math.min(3, p.runners) : p.runners;
  const pointColor = new THREE.Color(p.point);

  const miniSpinners = [];
  const shells = SHELLS.map((spec, index) => {
    const R = spec.radius;
    const outer = new THREE.Group();
    outer.rotation.set(...spec.tilt);
    const inner = new THREE.Group();
    if (index === 0) {
      for (const deg of [-60, -30, 0, 30, 60]) inner.add(latitude(line, R, THREE.MathUtils.degToRad(deg), 0.02));
      for (let i = 0; i < 6; i += 1) inner.add(meridian(line, R, (i / 6) * Math.PI, 0.02));
    } else if (index === 1) {
      for (const [deg, start, sweep] of [[52, 0.3, 3.6], [22, 2.2, 4.4], [-22, 0.9, 3.2], [-52, 3.4, 4.6]]) inner.add(latitude(accent, R, THREE.MathUtils.degToRad(deg), 0.03, { start, sweep }));
      for (let i = 0; i < 4; i += 1) inner.add(meridian(accent, R, (i / 4) * Math.PI + 0.3, 0.03, { start: i * 1.3, sweep: 2.4 }));
      inner.add(flat(line(circuitRing(R, R + 0.13, 48, 23), 0.7), line(tickRing(R - 0.02, 72, 0.05, 0.012, { major: { every: 6 } }), 0.55)));
    } else {
      const map = glyphStrip({ count: 32, seed: 31 });
      map.repeat.x = 3;
      inner.add(line(wallBand(R, 0.15), 0.65, { map }));
      inner.add(flat(line(ringBand(R + 0.03, R + 0.05), 0.7)));
      inner.add(meridian(line, R, 0.4, 0.022), meridian(accent, R, 0.4 + Math.PI / 2, 0.03, { start: 0.4, sweep: 4.2 }));
      const ticks = line(tickRing(R + 0.06, 96, 0.06, 0.012, { major: { every: 8 } }), 0.5);
      ticks.rotation.y = 0.4;
      const dashes = accent(segmentRing(R - 0.09, R - 0.05, 18, { fill: 0.5 }), 0.6);
      dashes.rotation.y = 0.4 + Math.PI / 2;
      inner.add(ticks, dashes);
      // 赤道に載る小さな輪。面を外へ向けて立ち、自分の軸で回る。
      for (let i = 0; i < 4; i += 1) {
        const angle = (i / 4) * TAU + 0.6;
        const holder = new THREE.Group();
        holder.position.set(Math.cos(angle) * R, 0, Math.sin(angle) * R);
        holder.rotation.y = -angle + Math.PI / 2;
        const spinner = new THREE.Group();
        spinner.add(line(ringBand(0.14, 0.17), 0.85), accent(tickRing(0.13, 10, 0.04, 0.014), 0.8), line(polygonOutline(0.07, 6, 0.012), 0.8));
        holder.add(spinner);
        inner.add(holder);
        miniSpinners.push(spinner);
      }
    }

    // 表面を走る光の点。大円に沿って進み、後ろに尾を引く。
    const tracks = Array.from({ length: runnerCount }, () => {
      const u = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
      const v = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).cross(u).normalize();
      return { u, v, angle: random() * TAU, rate: (0.7 + random() * 0.9) * (random() < 0.5 ? -1 : 1) };
    });
    const positions = new Float32Array(runnerCount * TRAIL * 3);
    const colors = new Float32Array(runnerCount * TRAIL * 3);
    for (let i = 0; i < runnerCount * TRAIL; i += 1) {
      const fade = (1 - (i % TRAIL) / TRAIL) ** 2;
      colors.set([pointColor.r * fade, pointColor.g * fade, pointColor.b * fade], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.16, map: dot, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    points.frustumCulled = false;
    inner.add(points);

    outer.add(inner);
    const intro = new THREE.Group();
    intro.add(outer);
    root.add(intro);
    return { ...spec, swap: { k: 1 }, intro, outer, inner, tracks, positions, geometry, t: stage.reduced ? 1 : 0, fx: { shift: 0, boost: 0 } };
  });

  // 足場の輪と方眼。
  const base = flat(line(gridDisc(2.8, 9, 0.008), 0.1), line(ringBand(ORBIT - 0.015, ORBIT + 0.015), 0.6), accent(circuitRing(ORBIT + 0.06, ORBIT + 0.2, 72, 17, { density: 0.7 }), 0.55), line(tickRing(ORBIT - 0.05, 120, 0.05, 0.01, { major: { every: 10 } }), 0.4));
  base.position.y = -2.35;
  root.add(base);

  // 球を回る表示板。立ったまま公転し、板ごとに向きを少し振る。
  const orbit = new THREE.Group();
  root.add(orbit);
  const panels = Array.from({ length: PANEL_COUNT }, (_, i) => {
    const angle = (i / PANEL_COUNT) * TAU;
    const holder = new THREE.Group();
    const height = -0.45 + (i % 3) * 0.5;
    holder.position.set(Math.cos(angle) * ORBIT, height, Math.sin(angle) * ORBIT);
    const board = new THREE.Group();
    board.add((i % 2 ? accent : line)(new THREE.PlaneGeometry(0.96, 0.6), 0.8, { map: panelTexture(i % 3, 40 + i * 9) }));
    const drop = height + 2.35 - 0.3;
    const stem = line(new THREE.CylinderGeometry(0.006, 0.006, drop, 5), 0.35);
    stem.position.y = -0.3 - drop / 2;
    holder.add(board, stem);
    orbit.add(holder);
    return { holder, board, angle, mesh: board.children[0], flip: { v: 0 }, next: null, t: stage.reduced ? 1 : 0 };
  });

  let fit = 1;
  stage.onResize(() => {
    const view = stage.viewport();
    fit = Math.min(1, view.width / 8.2, view.height / 7.2);
    root.scale.setScalar(fit);
    root.position.y = 0.35 * fit;
  });

  // 乱れ。映像が裂け、殻が横へずれて戻り、しばらく速く回る。
  function glitch() {
    if (stage.reduced) return;
    noise.burst(1.1);
    shells.forEach((shell, index) => {
      const reach = utils.random(0.12, 0.3, 2) * (index % 2 ? -1 : 1);
      utils.remove(shell.fx);
      animate(shell.fx, {
        shift: [
          { to: reach, duration: 60, ease: steps(1) },
          { to: -reach * 0.6, duration: 80, ease: steps(1) },
          { to: 0, duration: 700, ease: 'outElastic(1, .5)' },
        ],
        boost: [{ to: 5, duration: 90, ease: 'outQuad' }, { to: 0, duration: 1500, ease: 'outQuad' }],
        delay: index * 50,
      });
    });
  }

  // 同期。殻が止まりかけ、軸が順に隣の殻の軸へ入れ替わる（準備）→ 映像が乱れ、表示板がタップした側から順に
  // せり出して裏返り、別の表示に替わる（山場）→ 殻が一気に回って落ち着く（余韻）。
  const maps = panels.map((panel) => panel.mesh.material.map);
  stage.onDispose(() => {
    for (const map of maps) map.dispose();
  });
  const settleMaps = () => {
    for (const panel of panels) {
      if (panel.next) panel.mesh.material.map = panel.next;
      panel.next = null;
    }
  };
  const seen = new THREE.Vector3();
  let burstTimer = 0;
  function resync(event) {
    if (stage.reduced) return;
    const rect = container.getBoundingClientRect();
    const nx = event?.clientX === undefined ? (Math.random() < 0.5 ? -0.6 : 0.6) : ((event.clientX - rect.left) / rect.width) * 2 - 1;
    settleMaps();
    const tilts = shells.map((shell) => shell.outer.quaternion.clone());
    shells.forEach((shell, index) => {
      utils.remove([shell.fx, shell.swap]);
      shell.fx.shift = 0;
      const from = tilts[index];
      const to = tilts[(index + 1) % shells.length];
      shell.swap.k = 0;
      animate(shell.swap, {
        k: 1,
        duration: 950,
        delay: 120 + index * 150,
        ease: 'inOutQuart',
        onUpdate() {
          shell.outer.quaternion.copy(from).slerp(to, shell.swap.k);
        },
      });
      animate(shell.fx, {
        boost: [
          { to: -0.92, duration: 220, ease: 'outQuad' },
          { to: -0.92, duration: 500 },
          { to: 7, duration: 320, ease: 'inQuad' },
          { to: 0, duration: 1600, ease: 'outExpo' },
        ],
        delay: index * 60,
      });
    });
    // タップした側に近い板から順に裏返す。半分まで返ったところで、隣の板の表示に替える。
    const current = panels.map((panel) => panel.mesh.material.map);
    const order = panels
      .map((panel, i) => ({ i, gap: Math.abs(panel.holder.getWorldPosition(seen).project(stage.camera).x - nx) }))
      .sort((a, b) => a.gap - b.gap);
    order.forEach(({ i }, rank) => {
      const panel = panels[i];
      utils.remove(panel.flip);
      panel.flip.v = 0;
      panel.next = current[(i + 1) % panels.length];
      animate(panel.flip, {
        v: 1,
        duration: 760,
        delay: 480 + rank * 130,
        ease: 'inOutBack(1.6)',
        onUpdate() {
          if (panel.next && panel.flip.v >= 0.5) {
            panel.mesh.material.map = panel.next;
            panel.next = null;
          }
        },
      });
    });
    clearTimeout(burstTimer);
    burstTimer = setTimeout(() => noise.burst(1.1), 380);
  }

  let nextGlitch = p.interval > 0 ? p.interval * 0.8 : Infinity;
  stage.onFrame((time, dt) => {
    noise.update(time, dt);
    if (time > nextGlitch) {
      nextGlitch = time + p.interval * (0.7 + Math.random() * 0.6);
      glitch();
    }
    for (const shell of shells) {
      const step = dt * p.speed * (1 + shell.fx.boost);
      shell.inner.rotation.x += shell.rate[0] * step;
      shell.inner.rotation.y += shell.rate[1] * step;
      shell.inner.rotation.z += shell.rate[2] * step;
      const rest = 1 - shell.t;
      shell.intro.visible = shell.t > 0.001;
      shell.intro.rotation.set(rest * shell.from[0], rest * shell.from[1], rest * shell.from[2]);
      shell.intro.scale.setScalar(Math.max(0.001, shell.t));
      shell.outer.position.x = shell.fx.shift;
      shell.outer.scale.y = 1 + Math.abs(shell.fx.shift) * 0.4;
      shell.tracks.forEach((track, i) => {
        track.angle += track.rate * step;
        for (let j = 0; j < TRAIL; j += 1) {
          const a = track.angle - Math.sign(track.rate) * j * 0.045;
          const c = Math.cos(a) * shell.radius;
          const s = Math.sin(a) * shell.radius;
          const at = (i * TRAIL + j) * 3;
          shell.positions[at] = track.u.x * c + track.v.x * s;
          shell.positions[at + 1] = track.u.y * c + track.v.y * s;
          shell.positions[at + 2] = track.u.z * c + track.v.z * s;
        }
      });
      shell.geometry.attributes.position.needsUpdate = true;
    }
    miniSpinners.forEach((spinner, i) => { spinner.rotation.z = time * (1.2 + i * 0.4) * p.speed; });
    orbit.rotation.y = -time * 0.16 * p.speed;
    for (const [i, panel] of panels.entries()) {
      // 板は外を向いたまま、自分の縦軸でゆっくり首を振る。
      panel.board.rotation.y = -panel.angle + Math.PI / 2 + Math.sin(time * 0.8 + i * 1.7) * 0.55;
      panel.board.rotation.x = Math.sin(time * 0.6 + i) * 0.12 + panel.flip.v * TAU;
      panel.holder.scale.setScalar(Math.max(0.001, panel.t) * (1 + Math.sin(Math.PI * Math.min(1, Math.max(0, panel.flip.v))) * 0.35));
    }
    base.rotation.z = time * 0.04;
    root.rotation.set(0.26 + Math.sin(time * 0.21) * 0.08 - stage.pointer.sy * 0.3, Math.sin(time * 0.13) * 0.3 + stage.pointer.sx * 0.5, 0);
  });

  container.addEventListener('pointerdown', resync);
  const auto = p.preview && !stage.reduced ? setInterval(() => resync(), 5400) : 0;
  if (!stage.reduced) {
    animate(shells, { t: 1, duration: 1600, delay: stagger(240), ease: 'outExpo' });
    animate(panels, { t: 1, duration: 900, delay: stagger(110, { start: 900 }), ease: 'outBack(2)' });
  }

  return {
    glitch,
    resync,
    destroy() {
      container.removeEventListener('pointerdown', resync);
      clearTimeout(burstTimer);
      clearInterval(auto);
      for (const shell of shells) utils.remove(shell.swap);
      for (const panel of panels) utils.remove(panel.flip);
      utils.remove(shells);
      for (const shell of shells) utils.remove(shell.fx);
      utils.remove(panels);
      stage.destroy();
    },
  };
}
