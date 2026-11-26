import * as THREE from 'three';

// 光る線画の部品。輪・区切り・目盛り・線を、XY 平面（+Z 向き）の薄い板として作る。
// WebGL の線は太さを変えられないので、どれも三角形の板にしてある。
// 返すのは位置だけを持つ BufferGeometry。glow() の素材と組み合わせて Mesh にする。
// 軸の違う回転を付けるときは、部品を Group に入れて、Group ごとに rotation を回す。

export const TAU = Math.PI * 2;

// 種から決まる乱数。同じ種なら、毎回同じ模様になる。
export function seeded(seed = 1) {
  let a = (Math.floor(seed) >>> 0) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toGeometry(positions) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function pushArc(out, inner, outer, start, sweep, steps) {
  for (let i = 0; i < steps; i += 1) {
    const a0 = start + (sweep * i) / steps;
    const a1 = start + (sweep * (i + 1)) / steps;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    out.push(c0 * inner, s0 * inner, 0, c0 * outer, s0 * outer, 0, c1 * outer, s1 * outer, 0);
    out.push(c0 * inner, s0 * inner, 0, c1 * outer, s1 * outer, 0, c1 * inner, s1 * inner, 0);
  }
}

function pushStroke(out, ax, ay, bx, by, width) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  const nx = (-dy / length) * width * 0.5;
  const ny = (dx / length) * width * 0.5;
  out.push(ax - nx, ay - ny, 0, bx - nx, by - ny, 0, bx + nx, by + ny, 0);
  out.push(ax - nx, ay - ny, 0, bx + nx, by + ny, 0, ax + nx, ay + ny, 0);
}

const stepsFor = (sweep) => Math.max(2, Math.ceil((Math.abs(sweep) / TAU) * 128));

// 輪、または弧。inner から outer までの幅を持つ。
export function ringBand(inner, outer, { start = 0, sweep = TAU, steps = stepsFor(sweep) } = {}) {
  const out = [];
  pushArc(out, inner, outer, start, sweep, steps);
  return toGeometry(out);
}

// 区切りのある輪。count 個に割り、それぞれの fill（0〜1）の割合だけを塗る。
// shape(i, count) を渡すと、区切りごとに形を変えられる。
// null を返した区切りは描かない。{ inner, outer, fill } を返すと、その区切りだけ値を置き換える。
export function segmentRing(inner, outer, count, { fill = 0.7, start = 0, sweep = TAU, shape = null } = {}) {
  const out = [];
  const each = sweep / count;
  for (let i = 0; i < count; i += 1) {
    const custom = shape ? shape(i, count) : {};
    if (custom === null) continue;
    const width = each * (custom?.fill ?? fill);
    const from = start + each * i + (each - width) / 2;
    pushArc(out, custom?.inner ?? inner, custom?.outer ?? outer, from, width, Math.max(1, Math.ceil(stepsFor(width) / 2)));
  }
  return toGeometry(out);
}

// 回路の縁取りのような、不ぞろいな区切りの輪。区切りごとに厚みと長さが変わる。
export function circuitRing(inner, outer, count, seed = 1, { start = 0, sweep = TAU, density = 0.8 } = {}) {
  const random = seeded(seed);
  const span = outer - inner;
  return segmentRing(inner, outer, count, {
    start,
    sweep,
    shape: () => {
      const roll = random();
      const a = random();
      const b = random();
      if (roll > density) return null;
      const low = inner + span * Math.min(a, b) * 0.7;
      const high = Math.max(low + span * 0.18, inner + span * (0.35 + Math.max(a, b) * 0.65));
      return { inner: low, outer: Math.min(outer, high), fill: 0.55 + random() * 0.42 };
    },
  });
}

// 目盛りの輪。radius から内側（inward が偽なら外側）へ length だけ伸びる線を count 本並べる。
// major を渡すと、every 本ごとに長さと太さを変える。
export function tickRing(radius, count, length, width, { start = 0, sweep = TAU, inward = true, major = null, skip = null } = {}) {
  const out = [];
  const closed = Math.abs(Math.abs(sweep) - TAU) < 1e-6;
  const total = closed ? count : count + 1;
  for (let i = 0; i < total; i += 1) {
    if (skip?.(i)) continue;
    const isMajor = major && i % major.every === 0;
    const len = isMajor ? (major.length ?? length * 1.8) : length;
    const w = isMajor ? (major.width ?? width * 1.6) : width;
    const angle = start + (sweep * i) / count;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const far = inward ? radius - len : radius + len;
    pushStroke(out, c * radius, s * radius, c * far, s * far, w);
  }
  return toGeometry(out);
}

// 線分の集まり。segments は [x1, y1, x2, y2] の配列。
export function strokes(segments, width) {
  const out = [];
  for (const [ax, ay, bx, by] of segments) pushStroke(out, ax, ay, bx, by, width);
  return toGeometry(out);
}

// 正多角形の輪郭。
export function polygonOutline(radius, sides, width, rotation = 0) {
  return starOutline(radius, sides, 1, width, rotation);
}

// 星形の輪郭。points 個の頂点を skip 個おきに結ぶ（5 点で skip 2 なら五芒星）。
export function starOutline(radius, points, skip, width, rotation = 0) {
  const vertex = (i) => {
    const angle = rotation + (i / points) * TAU;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  };
  const segments = Array.from({ length: points }, (_, i) => [...vertex(i), ...vertex(i + skip)]);
  return strokes(segments, width);
}

// 方眼。半径 radius の円に収まる線だけを残す。
export function gridDisc(radius, cells, width) {
  const segments = [];
  for (let i = -cells; i <= cells; i += 1) {
    const offset = (i / cells) * radius;
    const half = Math.sqrt(Math.max(0, radius * radius - offset * offset));
    if (half < 1e-6) continue;
    segments.push([offset, -half, offset, half], [-half, offset, half, offset]);
  }
  return strokes(segments, width);
}

// 光る線画のための素材。加算で重なり、重なったところほど明るくなる。
export function glow(color, opacity = 1, extra = {}) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    ...extra,
  });
}

// キャンバスに描いた絵をテクスチャにする。draw(ctx, width, height) で描く。
export function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// どの言語にも無い、作りものの文字を 1 つ描く。枠（size 四方）の中に、短い線と弧と点を組み合わせる。
export function drawGlyph(ctx, x, y, size, random) {
  const grid = [0.18, 0.5, 0.82];
  const at = (index) => [x + grid[index % 3] * size, y + grid[Math.floor(index / 3)] * size];
  ctx.beginPath();
  let from = Math.floor(random() * 9);
  const count = 2 + Math.floor(random() * 3);
  for (let i = 0; i < count; i += 1) {
    const to = (from + 1 + Math.floor(random() * 8)) % 9;
    const [ax, ay] = at(from);
    const [bx, by] = at(to);
    ctx.moveTo(ax, ay);
    if (random() < 0.3) ctx.quadraticCurveTo(x + size * random(), y + size * random(), bx, by);
    else ctx.lineTo(bx, by);
    from = to;
  }
  ctx.stroke();
  if (random() < 0.45) {
    const [cx, cy] = at(Math.floor(random() * 9));
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.07, 0, TAU);
    ctx.fill();
  }
}

// 作りものの文字を横 1 列に並べた帯のテクスチャ。円筒の側面や輪に巻いて使う。
export function glyphStrip({ count = 48, seed = 1, cell = 48, color = '#ffffff', rails = true } = {}) {
  const texture = canvasTexture(count * cell, cell * 1.5, (ctx, width, height) => {
    const random = seeded(seed);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';
    ctx.lineWidth = cell * 0.07;
    const top = (height - cell) / 2;
    for (let i = 0; i < count; i += 1) {
      if (random() < 0.12) continue;
      drawGlyph(ctx, i * cell + cell * 0.14, top + cell * 0.14, cell * 0.72, random);
    }
    if (rails) {
      ctx.fillRect(0, 2, width, cell * 0.05);
      ctx.fillRect(0, height - 2 - cell * 0.05, width, cell * 0.05);
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

// 帯のテクスチャを巻くための形。平らな輪（flat）と、立った円筒（wall）の 2 種類。
// どちらも、帯の横方向が円周に沿う。
export function flatBand(inner, outer, segments = 128) {
  const geometry = new THREE.RingGeometry(inner, outer, segments, 1);
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const angle = Math.atan2(y, x);
    uv.setXY(i, (angle < 0 ? angle + TAU : angle) / TAU, (Math.hypot(x, y) - inner) / (outer - inner));
  }
  // 角度が 0 に戻る継ぎ目の頂点は、1 周ぶんの終わりとして 1 にする。
  for (let ring = 0; ring <= 1; ring += 1) uv.setX(ring * (segments + 1) + segments, 1);
  uv.needsUpdate = true;
  return geometry;
}

export function wallBand(radius, height, segments = 128) {
  return new THREE.CylinderGeometry(radius, radius, height, segments, 1, true);
}
