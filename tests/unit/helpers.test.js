import { describe, expect, it } from 'vitest';
import { ringProgress } from '../../src/assets/clock/chrono-core.js';
import { clockText as asciiClockText } from '../../src/assets/ascii/ascii-clock.js';
import { cleanText, wrapText } from '../../src/assets/ascii/ascii-typewriter.js';
import { mixColor } from '../../src/assets/text/depth-type.js';
import { waveAt } from '../../src/assets/cyber/signal-scope.js';
import { bearingOf } from '../../src/assets/scifi/radar-sweep.js';
import { EDGES, FACES, project } from '../../src/assets/scifi/tesseract.js';
import { electronConfig } from '../../src/assets/science/atom-orbitals.js';
import { fourierCoefficients } from '../../src/assets/science/fourier-draw.js';
import { lifeStep } from '../../src/assets/science/game-of-life.js';
import { lorenzStep } from '../../src/assets/science/lorenz-attractor.js';
import { pendulumLength } from '../../src/assets/science/pendulum-wave.js';
import { PLANETS, keplerPosition } from '../../src/assets/science/solar-system.js';
import { meshAngle, planetaryAngles } from '../../src/assets/cyber/gear-reactor.js';
import { coneAngles } from '../../src/assets/scifi/bevel-cube.js';
import { ringFractions } from '../../src/assets/clock/armillary-clock.js';
import { lockTarget, snapAngle } from '../../src/assets/cyber/axis-lock.js';
import { ditherLevel, rotatePoint } from '../../src/assets/pixel/pixel-gyro-cube.js';
import { trainAngles } from '../../src/assets/ui/gear-loader.js';
import { movementState } from '../../src/assets/clock/clockwork-movement.js';

// 素材が公開している計算用の関数を確かめる。画面を使わないので、どれも数値だけで検査できる。

describe('ringProgress（多層のサイバー時計）', () => {
  it('いまの秒・分・時の区切りまでを点灯させる割合を返す', () => {
    const p = ringProgress(new Date(2026, 0, 1, 15, 29, 59));
    expect(p.second).toBe(1);
    expect(p.minute).toBe(0.5);
    expect(p.hour).toBeCloseTo(4 / 12);
  });

  it('24 時間制では 1 日を 24 に区切る', () => {
    expect(ringProgress(new Date(2026, 0, 1, 23, 0, 0), true).hour).toBe(1);
    expect(ringProgress(new Date(2026, 0, 1, 0, 0, 0), true).hour).toBeCloseTo(1 / 24);
  });

  it('0 秒でも 1 区切りは点く', () => {
    expect(ringProgress(new Date(2026, 0, 1, 0, 0, 0)).second).toBeCloseTo(1 / 60);
  });
});

describe('clockText（文字の時計）', () => {
  it('時と分を 2 桁ずつで返す', () => {
    expect(asciiClockText(new Date(2026, 0, 1, 9, 5))).toBe('09:05');
    expect(asciiClockText(new Date(2026, 0, 1, 23, 59))).toBe('23:59');
  });

  it('12 時間制では 0 時と 12 時を 12 と表す', () => {
    expect(asciiClockText(new Date(2026, 0, 1, 0, 7), true)).toBe('12:07');
    expect(asciiClockText(new Date(2026, 0, 1, 12, 7), true)).toBe('12:07');
    expect(asciiClockText(new Date(2026, 0, 1, 15, 7), true)).toBe('03:07');
  });
});

describe('cleanText と wrapText（打ち出される大きな文字）', () => {
  it('使える文字だけを残して大文字にそろえる', () => {
    expect(cleanText('hello  world')).toBe('HELLO WORLD');
  });

  it('使える文字が残らなければ既定の文字にする', () => {
    const fallback = cleanText('');
    expect(fallback.length).toBeGreaterThan(0);
    expect(cleanText('あいう')).toBe(fallback);
  });

  it('単語の切れ目で折り返し、どの行も幅に収める', () => {
    expect(wrapText('AB CD EF', 5)).toEqual(['AB CD', 'EF']);
    for (const line of wrapText('THE QUICK BROWN FOX JUMPS', 7)) expect(line.length).toBeLessThanOrEqual(7);
  });

  it('1 行に入らない長い単語は途中で切る', () => {
    expect(wrapText('ABCDEFGH', 3)).toEqual(['ABC', 'DEF', 'GH']);
    expect(wrapText('HI ABCDEFG', 4)).toEqual(['HI', 'ABCD', 'EFG']);
  });
});

describe('mixColor（厚みのある文字）', () => {
  it('両端ではそれぞれの色を、中間では混ぜた色を返す', () => {
    expect(mixColor('#000000', '#ffffff', 0)).toBe('rgb(0, 0, 0)');
    expect(mixColor('#000000', '#ffffff', 1)).toBe('rgb(255, 255, 255)');
    expect(mixColor('#ff0000', '#0000ff', 0.5)).toBe('rgb(128, 0, 128)');
  });
});

describe('waveAt（波形の計器）', () => {
  it.each(['sine', 'square', 'saw', 'pulse'])('%s は -1.2〜1.2 に収まり、1 周で元に戻る', (shape) => {
    for (let i = 0; i < 64; i += 1) {
      const phase = (i / 64) * Math.PI * 2;
      const value = waveAt(shape, phase);
      expect(Math.abs(value)).toBeLessThanOrEqual(1.2);
      expect(waveAt(shape, phase + Math.PI * 2)).toBeCloseTo(value, 6);
    }
  });

  it('知らない形は正弦波として扱う', () => {
    expect(waveAt('nope', Math.PI / 2)).toBeCloseTo(1);
  });

  it('のこぎり波は 1 周のあいだ上がり続ける', () => {
    expect(waveAt('saw', 0)).toBeCloseTo(-1);
    expect(waveAt('saw', Math.PI)).toBeCloseTo(0);
  });
});

describe('bearingOf（探知レーダー）', () => {
  it('右向きの角度 0 を東（90 度）に、上向きを北（0 度）に直す', () => {
    expect(bearingOf(0)).toBe(90);
    expect(bearingOf(-Math.PI / 2)).toBe(0);
    expect(bearingOf(Math.PI / 2)).toBe(180);
    expect(bearingOf(Math.PI)).toBe(270);
  });

  it('何周しても 0〜359 に収まる', () => {
    for (const angle of [-20, -1, 7, 100]) {
      expect(bearingOf(angle)).toBeGreaterThanOrEqual(0);
      expect(bearingOf(angle)).toBeLessThan(360);
    }
  });
});

describe('四次元立方体', () => {
  it('辺は 32 本、面は 24 枚ある', () => {
    expect(EDGES).toHaveLength(32);
    expect(FACES).toHaveLength(24);
  });

  it('どの頂点にも 4 本の辺が集まる', () => {
    const degree = new Array(16).fill(0);
    for (const [a, b] of EDGES) {
      degree[a] += 1;
      degree[b] += 1;
    }
    expect(degree.every((n) => n === 4)).toBe(true);
  });

  it('回さないときは、w が大きい頂点ほど大きく写る', () => {
    const still = { xw: 0, yw: 0, zw: 0, xy: 0 };
    const near = project([1, 1, 1, 1], still, 3);
    const far = project([1, 1, 1, -1], still, 3);
    expect(near[0]).toBeCloseTo(1.5);
    expect(far[0]).toBeCloseTo(0.75);
    expect(near[3]).toBe(1);
  });

  it('元の頂点を書き換えない', () => {
    const vertex = [1, -1, 1, -1];
    project(vertex, { xw: 1, yw: 2, zw: 3, xy: 4 }, 3);
    expect(vertex).toEqual([1, -1, 1, -1]);
  });
});

describe('electronConfig（原子の電子雲）', () => {
  it('有効核電荷は、水素でそのまま、ヘリウムで 1.7 になる', () => {
    expect(electronConfig(1)).toEqual([{ name: '1s', n: 1, l: 0, electrons: 1, zeff: 1 }]);
    expect(electronConfig(2)[0].zeff).toBeCloseTo(1.7);
  });

  it('炭素は 1s² 2s² 2p² で、2p の電子は別々の向きに 1 個ずつ入る', () => {
    const shells = electronConfig(6);
    expect(shells.map((shell) => [shell.name, shell.electrons])).toEqual([['1s', 2], ['2s', 2], ['2p', 2]]);
    expect(shells[2].axes).toEqual([1, 1, 0]);
    expect(shells[2].zeff).toBeCloseTo(3.25);
  });

  it('ナトリウムは 3s に 1 個入り、電子の合計は原子番号と同じになる', () => {
    const shells = electronConfig(11);
    expect(shells.at(-1)).toMatchObject({ name: '3s', electrons: 1 });
    expect(shells.reduce((sum, shell) => sum + shell.electrons, 0)).toBe(11);
  });
});

describe('fourierCoefficients（フーリエ級数の作図）', () => {
  const circle = Array.from({ length: 16 }, (_, j) => [3 * Math.cos((2 * Math.PI * j) / 16), 3 * Math.sin((2 * Math.PI * j) / 16)]);

  it('円は、半径と同じ大きさの 1 つの成分だけになる', () => {
    const [first, second] = fourierCoefficients(circle);
    expect(first.k).toBe(1);
    expect(first.amp).toBeCloseTo(3);
    expect(second.amp).toBeCloseTo(0);
  });

  it('大きい順に並び、重心（k = 0）は含まない', () => {
    const terms = fourierCoefficients(circle.map(([x, y], j) => [x + 5 + (j % 3), y * 0.4]));
    expect(terms).toHaveLength(15);
    expect(terms.some((term) => term.k === 0)).toBe(false);
    for (let i = 1; i < terms.length; i += 1) expect(terms[i - 1].amp).toBeGreaterThanOrEqual(terms[i].amp);
  });
});

describe('lifeStep（ライフゲーム）', () => {
  const step = (cells, cols, rows) => {
    const next = new Uint8Array(cells.length);
    const population = lifeStep(Uint8Array.from(cells), next, cols, rows);
    return { next: Array.from(next), population };
  };

  it('縦 3 つの並びは、次の世代で横 3 つになる', () => {
    // prettier-ignore
    const vertical = [
      0, 0, 0, 0, 0,
      0, 0, 1, 0, 0,
      0, 0, 1, 0, 0,
      0, 0, 1, 0, 0,
      0, 0, 0, 0, 0,
    ];
    // prettier-ignore
    const horizontal = [
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 1, 1, 1, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ];
    expect(step(vertical, 5, 5)).toEqual({ next: horizontal, population: 3 });
  });

  it('2×2 のかたまりは変わらない', () => {
    // prettier-ignore
    const block = [
      0, 0, 0, 0,
      0, 1, 1, 0,
      0, 1, 1, 0,
      0, 0, 0, 0,
    ];
    expect(step(block, 4, 4)).toEqual({ next: block, population: 4 });
  });

  it('ひとつだけの升は消え、端は反対側につながっている', () => {
    expect(step([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4, 4).population).toBe(0);
    // 上の端に横 3 つ。上下がつながっているので、いちばん下の行にも升が生まれる。
    const edge = new Array(25).fill(0);
    edge[1] = edge[2] = edge[3] = 1;
    const { next } = step(edge, 5, 5);
    expect(next[20 + 2]).toBe(1);
    expect(next[5 + 2]).toBe(1);
  });
});

describe('lorenzStep（ローレンツ・アトラクター）', () => {
  it('原点は動かない', () => {
    expect(lorenzStep([0, 0, 0], 28)).toEqual([0, 0, 0]);
  });

  it('止まる点 (√(β(ρ−1)), √(β(ρ−1)), ρ−1) にとどまる', () => {
    const c = Math.sqrt((8 / 3) * 27);
    const s = lorenzStep([c, c, 27], 28);
    expect(s[0]).toBeCloseTo(c, 6);
    expect(s[1]).toBeCloseTo(c, 6);
    expect(s[2]).toBeCloseTo(27, 6);
  });

  it('長く進めても、決まった範囲の中を回り続ける', () => {
    const s = [0.1, 0, 0];
    for (let i = 0; i < 5000; i += 1) lorenzStep(s, 28);
    expect(s.every(Number.isFinite)).toBe(true);
    expect(Math.abs(s[0])).toBeLessThan(25);
    expect(s[2]).toBeGreaterThan(0);
    expect(s[2]).toBeLessThan(55);
  });
});

describe('pendulumLength（振り子の波）', () => {
  it('60 秒で 60 回揺れる振り子は、周期 1 秒の長さになる', () => {
    expect(pendulumLength(0, 60, 60)).toBeCloseTo(9.80665 / (4 * Math.PI ** 2), 6);
  });

  it('番号が進むほど短くなる', () => {
    const lengths = Array.from({ length: 12 }, (_, i) => pendulumLength(i, 50, 60));
    for (let i = 1; i < lengths.length; i += 1) expect(lengths[i]).toBeLessThan(lengths[i - 1]);
  });
});

describe('keplerPosition（太陽系の公転）', () => {
  it('円軌道では、角度がそのまま位置になる', () => {
    const p = keplerPosition(Math.PI / 2, 0);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1);
  });

  it('太陽にいちばん近い点と遠い点までの距離は 1−e と 1+e になる', () => {
    expect(keplerPosition(0, 0.2).x).toBeCloseTo(0.8);
    expect(keplerPosition(Math.PI, 0.2).x).toBeCloseTo(-1.2);
  });

  it('返す位置はケプラー方程式を満たす', () => {
    const e = 0.2056;
    const m = 1.1;
    const { x, y } = keplerPosition(m, e);
    const E = Math.atan2(y / Math.sqrt(1 - e * e), x + e);
    expect(E - e * Math.sin(E)).toBeCloseTo(m, 6);
  });

  it('惑星は 8 つで、太陽から近い順に並ぶ', () => {
    expect(PLANETS).toHaveLength(8);
  });
});

describe('歯車のかみ合い', () => {
  it('相手の歯車は、歯数の比だけ逆向きに回る', () => {
    const before = meshAngle(0, 20, 10, 0);
    const after = meshAngle(0.3, 20, 10, 0);
    expect(after - before).toBeCloseTo(-0.6);
  });

  it('こちらの歯が相手の谷に入るように、半歯ぶんずれる', () => {
    // 相手は方向 0 にいる。こちらの歯が方向 0 を向くとき、相手は反対向き（π）から半歯ずれた角度になる。
    expect(meshAngle(0, 12, 12, 0)).toBeCloseTo(Math.PI + Math.PI / 12);
  });

  it('遊星歯車の内歯の輪は、太陽と遊星 2 枚ぶんの歯数を持つ', () => {
    const state = planetaryAngles(0, 0, { sunTeeth: 18, planetTeeth: 12 });
    expect(state.ringTeeth).toBe(42);
    expect(state.planets).toHaveLength(3);
  });

  it('腕を止めて太陽を回すと、内歯の輪は歯数の比で逆向きに回る', () => {
    const gears = { sunTeeth: 18, planetTeeth: 12 };
    const turn = planetaryAngles(0.42, 0, gears).ring - planetaryAngles(0, 0, gears).ring;
    expect(turn).toBeCloseTo((-0.42 * 18) / 42);
  });

  it('太陽と腕を一緒に回すと、全体がそのまま回る', () => {
    const gears = { sunTeeth: 18, planetTeeth: 12 };
    expect(planetaryAngles(0.5, 0.5, gears).ring - planetaryAngles(0, 0, gears).ring).toBeCloseTo(0.5);
  });

  it('かさ歯車の円すいの角度は、2 つ合わせて 45 度になる', () => {
    const { face, idler } = coneAngles(20, 10);
    expect(face + idler).toBeCloseTo(Math.PI / 4);
    expect(face).toBeGreaterThan(idler);
  });

  it('ローダーの歯車列は、主歯車を回すと隣が歯数の比で逆向きに回る', () => {
    const before = trainAngles(0);
    const after = trainAngles(0.2);
    expect(after.a).toBe(0.2);
    expect(Math.sign(after.b - before.b)).toBe(-1);
    for (const key of ['b', 'c', 'd', 'e']) expect(Number.isFinite(after[key])).toBe(true);
  });
});

describe('movementState（機械式時計の中身）', () => {
  it('60 秒で秒の車が 1 周し、分の車はその 60 分の 1 だけ進む', () => {
    const state = movementState(60);
    expect(state.second).toBeCloseTo(-Math.PI * 2);
    expect(state.minute).toBeCloseTo((-Math.PI * 2) / 60);
    expect(state.hour).toBeCloseTo((-Math.PI * 2) / 720);
  });

  it('刻みの途中でも、進みは戻らない', () => {
    let last = -1;
    for (let t = 0; t < 3; t += 0.01) {
      const { ticked } = movementState(t);
      expect(ticked).toBeGreaterThanOrEqual(last);
      last = ticked;
    }
  });

  it('てんぷの振れは -1〜1 に収まる', () => {
    for (let t = 0; t < 2; t += 0.03) expect(Math.abs(movementState(t).balance)).toBeLessThanOrEqual(1);
  });
});

describe('ringFractions（渾天儀の時計）', () => {
  it('時・分・秒の輪が、それぞれ何割進んだかを返す', () => {
    expect(ringFractions(new Date(2026, 0, 1, 6, 0, 0))).toEqual({ hour: 0.5, minute: 0, second: 0 });
    const f = ringFractions(new Date(2026, 0, 1, 21, 30, 15));
    expect(f.second).toBeCloseTo(0.25);
    expect(f.minute).toBeCloseTo(30.25 / 60);
    expect(f.hour).toBeCloseTo((9 + 30.25 / 60) / 12);
  });
});

describe('多軸のダイヤル錠', () => {
  it('snapAngle は、いちばん近い刻みへ寄せる', () => {
    expect(snapAngle(0.01, 36)).toBeCloseTo(0);
    expect(snapAngle((Math.PI * 2) / 36 + 0.01, 36)).toBeCloseTo((Math.PI * 2) / 36);
  });

  it('lockTarget は、回っている向きの先にある 1 周の区切りを返す', () => {
    const turn = Math.PI * 2;
    const forward = lockTarget(1, 1);
    const backward = lockTarget(1, -1);
    expect(forward).toBeGreaterThanOrEqual(1 + 3.5);
    expect(backward).toBeLessThanOrEqual(1 - 3.5);
    expect(Math.abs(forward / turn - Math.round(forward / turn))).toBeLessThan(1e-9);
    expect(Math.abs(backward / turn - Math.round(backward / turn))).toBeLessThan(1e-9);
  });
});

describe('ドット絵で描く立体', () => {
  it('rotatePoint は、回しても原点からの距離を変えない', () => {
    const point = rotatePoint([1, 2, 3], 0.4, 1.1, -0.7);
    expect(Math.hypot(...point)).toBeCloseTo(Math.hypot(1, 2, 3));
  });

  it('rotatePoint は、Z 軸で 90 度回すと X が Y へ移る', () => {
    const [x, y, z] = rotatePoint([1, 0, 0], 0, 0, Math.PI / 2);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(1);
    expect(z).toBeCloseTo(0);
  });

  it('ditherLevel は、色番号の範囲に収まり、明るいほど大きい番号を返す', () => {
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        expect(ditherLevel(0, 4, x, y)).toBe(0);
        expect(ditherLevel(1, 4, x, y)).toBe(3);
        expect(ditherLevel(2, 4, x, y)).toBe(3);
        expect(ditherLevel(0.3, 4, x, y)).toBeLessThanOrEqual(ditherLevel(0.8, 4, x, y));
      }
    }
  });

  it('ditherLevel は、中間の明るさを 2 つの色の網点に分ける', () => {
    const levels = new Set();
    for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) levels.add(ditherLevel(0.5, 2, x, y));
    expect([...levels].sort()).toEqual([0, 1]);
  });
});
