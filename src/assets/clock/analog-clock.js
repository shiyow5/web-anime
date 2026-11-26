import { animate, createTimeline, createTimer, stagger, utils } from 'animejs';
import { createDisposer, createRoot, injectStyle, prefersReducedMotion, removeRoot, s } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'analog-clock',
  title: '針の時計',
  category: 'clock',
  libs: ['animejs'],
  description:
    '腕時計の文字盤のような、針で時刻を示す時計です。読み込み時に目盛りが順に現れ、針が 12 時の位置から現在の時刻まで振れて止まります。秒針は 1 秒ごとに、機械式のように少し行き過ぎてから戻ります。タップすると、針がいったん逆へ引かれてから時針 1 周・分針 3 周・秒針 5 周の早回しになり、減速して今の時刻に戻ります。目盛りは触った方角から順に波打ちます。',
  params: {
    motion: {
      type: 'select',
      label: '秒針の動き',
      options: [
        { value: 'tick', label: '1 秒ごとに刻む' },
        { value: 'sweep', label: 'なめらかに流れる' },
      ],
      default: 'tick',
    },
    face: { type: 'color', label: '文字盤の色', default: '#101b3a' },
    ink: { type: 'color', label: '針と目盛りの色', default: '#f2ead8' },
    accent: { type: 'color', label: '秒針の色', default: '#ff6b3d' },
    background: { type: 'color', label: '背景色', default: '#0a1126' },
  },
};

const CSS = `
.ua-ac{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;background:var(--ua-bg);
  font-family:var(--ua-display,system-ui,sans-serif)}
.ua-ac svg{width:min(90%,720px);height:90%}
.ua-ac__face{fill:var(--ua-face)}
.ua-ac__rim{fill:none;stroke:var(--ua-ink);stroke-width:1.2;opacity:.35}
.ua-ac__tick{stroke:var(--ua-ink);stroke-linecap:round;transform-box:fill-box;transform-origin:center}
.ua-ac__numeral{transform-box:fill-box;transform-origin:center;fill:var(--ua-ink);font-size:26px;font-weight:700;text-anchor:middle;dominant-baseline:central}
.ua-ac__hand{transform-origin:200px 200px}
.ua-ac__hand line{stroke:var(--ua-ink);stroke-linecap:round}
.ua-ac__hand--second line,.ua-ac__hand--second circle{stroke:var(--ua-accent);fill:var(--ua-accent)}
.ua-ac__cap{fill:var(--ua-face);stroke:var(--ua-accent);stroke-width:2.5}
`;

const C = 200;
const NUMERALS = { 0: '12', 3: '3', 6: '6', 9: '9' };

const FULL_DAY = 86400 * 6;

// 針の角度（度）を、その日の 0 時からの秒数で求める。
export function handAngles(date) {
  const seconds = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() + date.getMilliseconds() / 1000;
  return { hour: (seconds / 3600) * 30, minute: (seconds / 60) * 6, second: seconds * 6, wholeSecond: Math.floor(seconds) * 6 };
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-ac', { '--ua-bg': p.background, '--ua-face': p.face, '--ua-ink': p.ink, '--ua-accent': p.accent });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();

  const ticks = Array.from({ length: 60 }, (_, i) => {
    const major = i % 5 === 0;
    const quarter = i % 15 === 0;
    const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const outer = 176;
    const inner = quarter ? 176 : major ? 158 : 168;
    if (quarter) return null;
    return s('line', {
      class: 'ua-ac__tick',
      'stroke-width': major ? 3 : 1.2,
      x1: (C + Math.cos(a) * inner).toFixed(1),
      y1: (C + Math.sin(a) * inner).toFixed(1),
      x2: (C + Math.cos(a) * outer).toFixed(1),
      y2: (C + Math.sin(a) * outer).toFixed(1),
    });
  }).filter(Boolean);
  const numerals = Object.entries(NUMERALS).map(([hour, label]) => {
    const a = (Number(hour) / 12) * Math.PI * 2 - Math.PI / 2;
    return s('text', { class: 'ua-ac__numeral', x: (C + Math.cos(a) * 160).toFixed(1), y: (C + Math.sin(a) * 160).toFixed(1) }, label);
  });
  const hand = (kind, width, length, tail) => s('g', { class: `ua-ac__hand ua-ac__hand--${kind}` }, s('line', { x1: C, y1: C + tail, x2: C, y2: C - length, 'stroke-width': width }));
  const hour = hand('hour', 7, 92, 14);
  const minute = hand('minute', 4.5, 140, 18);
  const second = hand('second', 1.6, 158, 34);
  second.appendChild(s('circle', { cx: C, cy: C + 24, r: 5 }));

  root.appendChild(
    s(
      'svg',
      { viewBox: '0 0 400 400', role: 'img', 'aria-label': '現在の時刻を示す時計' },
      s('circle', { class: 'ua-ac__face', cx: C, cy: C, r: 192 }),
      s('circle', { class: 'ua-ac__rim', cx: C, cy: C, r: 186 }),
      ticks,
      numerals,
      hour,
      minute,
      second,
      s('circle', { class: 'ua-ac__cap', cx: C, cy: C, r: 6 }),
    ),
  );

  const place = (angles) => {
    utils.set(hour, { rotate: angles.hour });
    utils.set(minute, { rotate: angles.minute });
  };
  if (reduced) {
    // 動きを減らす設定では、演出を付けずに針の位置だけを更新し続ける。
    const show = () => {
      const angles = handAngles(new Date());
      place(angles);
      utils.set(second, { rotate: angles.wholeSecond });
    };
    show();
    disposer.interval(show, 1000);
    return {
      destroy() {
        disposer.run();
        removeRoot(root);
      },
    };
  }

  let running = false;
  let lastSecond = -1;
  // 0 時をまたぐと秒数が 0 に戻る。秒針が逆回りしないよう、1 日ぶんの角度を足して増やし続ける。
  let dayOffset = 0;
  // 秒針の角度（刻むときに弾ませる）と、タップでの早回しの進み具合（1 で 1 回ぶん）。
  const sec = { v: 0 };
  const spin = { k: 0 };
  const start = handAngles(new Date());
  // 起動。目盛りを順に出し、針を 12 時から現在の時刻まで振る。
  const intro = createTimeline({
    onComplete() {
      running = true;
    },
  })
    .add(ticks, { opacity: [0, 1], scale: [0.4, 1], duration: 500, ease: 'outBack(2)', delay: stagger(14) })
    .add(numerals, { opacity: [0, 1], translateY: [10, 0], duration: 600, ease: 'outExpo', delay: stagger(90) }, 300)
    .add(hour, { rotate: [0, start.hour], duration: 1700, ease: 'outElastic(1, .7)' }, 300)
    .add(minute, { rotate: [0, start.minute], duration: 1900, ease: 'outElastic(1, .7)' }, 400)
    .add(second, { rotate: [0, start.wholeSecond + 12], duration: 2000, ease: 'outElastic(1, .6)' }, 500);
  disposer.add(() => intro.pause());

  const clock = createTimer({
    onUpdate() {
      if (!running) return;
      const angles = handAngles(new Date());
      if (p.motion === 'sweep') {
        sec.v = angles.second;
      } else if (angles.wholeSecond !== lastSecond) {
        if (lastSecond !== -1 && angles.wholeSecond < lastSecond) dayOffset += FULL_DAY;
        const first = lastSecond === -1;
        lastSecond = angles.wholeSecond;
        if (first) sec.v = dayOffset + angles.wholeSecond + 12;
        animate(sec, { v: dayOffset + angles.wholeSecond, duration: 420, ease: 'outElastic(1, .45)' });
      }
      // 早回しのあいだは、時針 1 周・分針 3 周・秒針 5 周ぶんを上乗せする。k が整数に着くと、針は今の時刻に重なる。
      utils.set(hour, { rotate: angles.hour + spin.k * 360 });
      utils.set(minute, { rotate: angles.minute + spin.k * 1080 });
      utils.set(second, { rotate: sec.v + spin.k * 1800 });
    },
  });
  disposer.add(() => clock.pause());
  disposer.add(() => utils.remove([sec, spin]));

  // タップ。針を少し逆へ引いてから早回しし、減速して今の時刻へ戻す。目盛りは触った方角から波打つ。
  function wind(event) {
    if (!running) return;
    utils.remove(spin);
    const goal = Math.floor(spin.k + 0.5) + 1;
    animate(spin, {
      k: [
        { to: spin.k - 0.035, duration: 170, ease: 'outQuad' },
        { to: goal, duration: 2100, ease: 'inOutCubic' },
        { to: goal - 0.012, duration: 160, ease: 'outQuad' },
        { to: goal, duration: 520, ease: 'outElastic(1, .5)' },
      ],
      onComplete() {
        spin.k = 0;
      },
    });
    let origin = 0;
    if (event) {
      const rect = root.getBoundingClientRect();
      const a = Math.atan2(event.clientX - (rect.left + rect.width / 2), -(event.clientY - (rect.top + rect.height / 2)));
      origin = Math.round((((a / (Math.PI * 2)) % 1) + 1) % 1 * ticks.length) % ticks.length;
    }
    const around = (i) => Math.min(Math.abs(i - origin), ticks.length - Math.abs(i - origin));
    utils.remove(ticks);
    animate(ticks, {
      scale: [{ to: 1.9, duration: 150, ease: 'outQuad' }, { to: 1, duration: 620, ease: 'outElastic(1, .45)' }],
      opacity: [{ to: 0.35, duration: 150 }, { to: 1, duration: 500 }],
      delay: (_, i) => around(i) * 26,
    });
    animate(numerals, { scale: [{ to: 1.25, duration: 200, ease: 'outQuad' }, { to: 1, duration: 700, ease: 'outElastic(1, .5)' }], delay: stagger(110, { start: 300 }) });
  }
  disposer.listen(root, 'pointerdown', wind);
  if (options.preview) disposer.interval(() => wind(), 5600);

  return {
    destroy() {
      disposer.run();
      removeRoot(root);
    },
  };
}
