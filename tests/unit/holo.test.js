import { describe, expect, it } from 'vitest';
import { TAU, circuitRing, gridDisc, polygonOutline, ringBand, seeded, segmentRing, starOutline, strokes, tickRing } from '../../src/lib/holo.js';
import { clockFractions } from '../../src/assets/clock/holo-chronograph.js';
import { TIERS, rimPlacement } from '../../src/assets/fantasy/sigil-dome.js';

// 光る線画の部品は、位置だけを持つ三角形の集まりを返す。画面を使わずに、頂点の数と位置で確かめる。
const vertices = (geometry) => geometry.attributes.position.count;
const radii = (geometry) => {
  const position = geometry.attributes.position;
  return Array.from({ length: position.count }, (_, i) => Math.hypot(position.getX(i), position.getY(i)));
};
// 四角形 1 枚は、三角形 2 枚ぶんの 6 頂点。
const QUAD = 6;

describe('seeded', () => {
  it('同じ種からは同じ並びを、違う種からは違う並びを返す', () => {
    const a = seeded(5);
    const b = seeded(5);
    const c = seeded(6);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
  });

  it('0 以上 1 未満に収まる', () => {
    const random = seeded(99);
    for (let i = 0; i < 500; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('ringBand', () => {
  it('内側と外側の半径のあいだに収まる輪を作る', () => {
    const all = radii(ringBand(1, 1.2));
    expect(Math.min(...all)).toBeCloseTo(1);
    expect(Math.max(...all)).toBeCloseTo(1.2);
  });

  it('分割の数だけ四角形を作る', () => {
    expect(vertices(ringBand(1, 2, { steps: 10 }))).toBe(10 * QUAD);
  });

  it('弧にすると、指定した角度の範囲だけを塗る', () => {
    const position = ringBand(1, 1.1, { start: 0, sweep: Math.PI / 2 }).attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      expect(position.getX(i)).toBeGreaterThanOrEqual(-1e-6);
      expect(position.getY(i)).toBeGreaterThanOrEqual(-1e-6);
      expect(position.getZ(i)).toBe(0);
    }
  });
});

describe('segmentRing', () => {
  it('shape が null を返した区切りは描かない', () => {
    const all = vertices(segmentRing(1, 1.2, 12));
    const half = vertices(segmentRing(1, 1.2, 12, { shape: (i) => (i % 2 ? null : {}) }));
    expect(half).toBe(all / 2);
  });

  it('shape で区切りごとに半径を置き換えられる', () => {
    const all = radii(segmentRing(1, 1.2, 4, { shape: () => ({ inner: 2, outer: 2.5 }) }));
    expect(Math.min(...all)).toBeCloseTo(2);
    expect(Math.max(...all)).toBeCloseTo(2.5);
  });
});

describe('circuitRing', () => {
  it('同じ種なら同じ形になり、指定した半径の範囲に収まる', () => {
    const a = circuitRing(2, 2.4, 60, 3);
    const b = circuitRing(2, 2.4, 60, 3);
    expect(Array.from(a.attributes.position.array)).toEqual(Array.from(b.attributes.position.array));
    const all = radii(a);
    expect(Math.min(...all)).toBeGreaterThanOrEqual(2 - 1e-6);
    expect(Math.max(...all)).toBeLessThanOrEqual(2.4 + 1e-6);
  });

  it('密度を下げると、描く区切りが減る', () => {
    expect(vertices(circuitRing(2, 2.4, 80, 3, { density: 0.3 }))).toBeLessThan(vertices(circuitRing(2, 2.4, 80, 3, { density: 1 })));
  });
});

describe('tickRing', () => {
  it('1 周なら目盛りの数だけ、弧なら両端を含めて 1 本多く作る', () => {
    expect(vertices(tickRing(1, 60, 0.1, 0.01))).toBe(60 * QUAD);
    expect(vertices(tickRing(1, 10, 0.1, 0.01, { sweep: Math.PI }))).toBe(11 * QUAD);
  });

  it('内向きなら半径の内側へ、外向きなら外側へ伸びる', () => {
    expect(Math.max(...radii(tickRing(1, 12, 0.2, 0.001)))).toBeLessThan(1.001);
    expect(Math.min(...radii(tickRing(1, 12, 0.2, 0.001, { inward: false })))).toBeGreaterThan(0.999);
  });

  it('major を渡すと、決まった本数ごとに長くなる', () => {
    const plain = Math.min(...radii(tickRing(1, 12, 0.1, 0.001)));
    const withMajor = Math.min(...radii(tickRing(1, 12, 0.1, 0.001, { major: { every: 3, length: 0.4 } })));
    expect(plain).toBeCloseTo(0.9, 3);
    expect(withMajor).toBeCloseTo(0.6, 3);
  });

  it('skip が真を返した目盛りは描かない', () => {
    expect(vertices(tickRing(1, 12, 0.1, 0.01, { skip: (i) => i < 3 }))).toBe(9 * QUAD);
  });
});

describe('strokes と輪郭', () => {
  it('線分 1 本につき四角形を 1 枚作り、長さ 0 の線分は捨てる', () => {
    expect(vertices(strokes([[0, 0, 1, 0], [0, 0, 0, 1], [2, 2, 2, 2]], 0.1))).toBe(2 * QUAD);
  });

  it('線の太さは、線分に直角な向きへ半分ずつ広がる', () => {
    const position = strokes([[0, 0, 1, 0]], 0.2).attributes.position;
    const ys = Array.from({ length: position.count }, (_, i) => position.getY(i));
    expect(Math.min(...ys)).toBeCloseTo(-0.1);
    expect(Math.max(...ys)).toBeCloseTo(0.1);
  });

  it('多角形と星形は、頂点の数だけ辺を持つ', () => {
    expect(vertices(polygonOutline(1, 6, 0.01))).toBe(6 * QUAD);
    expect(vertices(starOutline(1, 5, 2, 0.01))).toBe(5 * QUAD);
  });

  it('方眼は、円の外にはみ出さない', () => {
    expect(Math.max(...radii(gridDisc(2, 6, 0.001)))).toBeLessThan(2.01);
  });
});

describe('clockFractions（副文字盤が浮かぶホログラム時計）', () => {
  it('3 時ちょうどは、時針が 4 分の 1、分針と秒針が 0 を指す', () => {
    expect(clockFractions(new Date(2026, 0, 1, 3, 0, 0, 0))).toEqual({ second: 0, minute: 0, hour: 0.25, day: 0.125 });
  });

  it('分針は秒の進みも、時針は分の進みも受け取って、なめらかに動く', () => {
    const f = clockFractions(new Date(2026, 0, 1, 18, 30, 30, 500));
    expect(f.second).toBeCloseTo(30.5 / 60);
    expect(f.minute).toBeCloseTo((30 + 30.5 / 60) / 60);
    expect(f.hour).toBeCloseTo((6 + f.minute) / 12);
    expect(f.day).toBeCloseTo((18 + f.minute) / 24);
  });
});

describe('天蓋の魔法陣', () => {
  it('段は下から上へ並び、頂がいちばん小さい', () => {
    for (let i = 1; i < TIERS.length; i += 1) expect(TIERS[i].y).toBeGreaterThan(TIERS[i - 1].y);
    expect(Math.min(...TIERS.map((tier) => tier.r))).toBe(TIERS.at(-1).r);
  });

  it('縁の魔法陣は、等間隔に、半径どおりの位置に置かれる', () => {
    for (let i = 0; i < 6; i += 1) {
      const place = rimPlacement(i, 6, 2.5);
      expect(Math.hypot(place.x, place.z)).toBeCloseTo(2.5);
    }
    expect(rimPlacement(0, 4, 1)).toMatchObject({ x: 1, z: 0 });
    expect(rimPlacement(1, 4, 1).z).toBeCloseTo(1);
  });

  it('面の向きは、置いた角度に合わせて回る', () => {
    expect(rimPlacement(0, 4, 1).facing).toBeCloseTo(Math.PI / 2);
    expect(rimPlacement(1, 4, 1).facing).toBeCloseTo(0);
    expect(rimPlacement(4, 4, 1).facing).toBeCloseTo(Math.PI / 2 - TAU);
  });
});
