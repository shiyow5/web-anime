import { animate, createTimeline, createTimer, stagger, steps, utils } from 'animejs';
import { createDisposer, createRoot, h, injectStyle, prefersReducedMotion, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'terminal-boot',
  title: '起動する端末',
  category: 'cyber',
  libs: ['animejs'],
  description:
    '起動ログが 1 行ずつ打ち出され、進捗の棒が伸び、右側の計器と記憶域の升目が順に点灯して、最後に待ち受け画面になります。待ち受けのあとは最初からくり返します。タップすると割り込みが入ります。起動が一時止まり、下から割り込みの欄がせり上がってコマンドが 1 文字ずつ打ち込まれ、結果の行が順に出て、計器の値と記憶域の升目がコマンドに応じて動いてから、起動の続きに戻ります。コマンドはタップのたびに記憶域の検査、送風、疎通の確認、再起動の順に変わります。',
  params: {
    host: { type: 'text', label: '端末の名前', default: 'KESTREL-7', maxLength: 12 },
    color: { type: 'color', label: '文字の色', default: '#ffb454' },
    accent: { type: 'color', label: '状態表示の色', default: '#5ef2c8' },
    background: { type: 'color', label: '背景色', default: '#0d0a07' },
    speed: { type: 'range', label: '起動の速さ', min: 0.4, max: 3, step: 0.1, default: 1 },
    scanlines: { type: 'boolean', label: '走査線を重ねる', default: true },
  },
};

const CSS = `
.ua-tb{position:absolute;inset:0;overflow:hidden;container-type:size;cursor:pointer;color:var(--ua-color);
  background:radial-gradient(120% 95% at 50% 38%,color-mix(in srgb,var(--ua-color) 10%,var(--ua-bg)),var(--ua-bg) 72%);
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
.ua-tb__screen{position:absolute;inset:5cqh 3.5cqw;display:grid;grid-template-rows:auto 1fr auto;gap:1.8cqh;
  font-size:max(8.5px,1.5cqw);line-height:1.55;text-shadow:0 0 .7em color-mix(in srgb,var(--ua-color) 55%,transparent)}
.ua-tb__bar,.ua-tb__foot{display:flex;justify-content:space-between;gap:1em;letter-spacing:.12em;white-space:nowrap;overflow:hidden}
.ua-tb__bar{padding-bottom:.5em;border-bottom:1px solid color-mix(in srgb,var(--ua-color) 38%,transparent)}
.ua-tb__foot{padding-top:.5em;border-top:1px solid color-mix(in srgb,var(--ua-color) 22%,transparent);opacity:.72;font-size:.86em}
.ua-tb__body{display:grid;grid-template-columns:1fr 30%;gap:2.4cqw;min-height:0}
.ua-tb__log{position:relative;overflow:hidden;min-width:0}
.ua-tb__lines{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-start}
.ua-tb__line{display:flex;gap:1em;white-space:pre;flex:none}
.ua-tb__msg{flex:1;min-width:0;overflow:hidden}
.ua-tb__tag{flex:none;color:var(--ua-accent);opacity:0;text-shadow:0 0 .7em var(--ua-accent)}
.ua-tb__tag--warn{color:#ff6b5a;text-shadow:0 0 .7em #ff6b5a}
.ua-tb__side{display:flex;flex-direction:column;gap:1.5cqh;min-width:0;padding-left:2cqw;
  border-left:1px solid color-mix(in srgb,var(--ua-color) 22%,transparent)}
.ua-tb__meter{display:grid;gap:.25em}
.ua-tb__meter div:first-child{display:flex;justify-content:space-between;font-size:.86em;letter-spacing:.1em}
.ua-tb__track{position:relative;height:.5em;overflow:hidden;background:color-mix(in srgb,var(--ua-color) 15%,transparent)}
.ua-tb__fill{position:absolute;inset:0;background:var(--ua-accent);transform-origin:0 50%;transform:scaleX(0);box-shadow:0 0 .8em var(--ua-accent)}
.ua-tb__map{display:grid;grid-template-columns:repeat(12,1fr);gap:2px;margin-top:auto}
.ua-tb__cell{aspect-ratio:1;background:color-mix(in srgb,var(--ua-color) 14%,transparent)}
.ua-tb__cell.is-on{background:var(--ua-color);box-shadow:0 0 .5em color-mix(in srgb,var(--ua-color) 70%,transparent)}
.ua-tb__cell.is-hot{background:var(--ua-accent)}
.ua-tb__idle{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:.5em;pointer-events:none}
.ua-tb__idle>*{opacity:0;white-space:nowrap}
.ua-tb__host{font-size:3em;font-weight:700;letter-spacing:.06em;line-height:1.1}
.ua-tb__ready{color:var(--ua-accent);letter-spacing:.2em;text-shadow:0 0 .8em var(--ua-accent)}
.ua-tb__rule{height:1px;width:72%;background:linear-gradient(90deg,var(--ua-color),transparent);transform-origin:0 50%}
.ua-tb__cursor{display:inline-block;width:.6em;height:1.05em;margin-left:.3em;background:var(--ua-color);vertical-align:text-bottom;
  box-shadow:0 0 .7em var(--ua-color)}
.ua-tb__scan{position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(to bottom,transparent 0 2px,rgba(0,0,0,.3) 2px 3px)}
.ua-tb__sweep{position:absolute;left:0;right:0;top:-20%;height:20%;pointer-events:none;
  background:linear-gradient(to bottom,transparent,color-mix(in srgb,var(--ua-color) 9%,transparent),transparent)}
.ua-tb__irq{position:absolute;left:0;right:0;bottom:0;padding:.7em .9em;display:grid;gap:.15em;white-space:pre;overflow:hidden;opacity:0;pointer-events:none;
  background:color-mix(in srgb,var(--ua-bg) 92%,var(--ua-accent));border:1px solid var(--ua-accent);border-left-width:.35em;
  box-shadow:0 0 1.6em color-mix(in srgb,var(--ua-accent) 30%,transparent)}
.ua-tb__irq b{color:var(--ua-accent);font-weight:700;letter-spacing:.14em;text-shadow:0 0 .7em var(--ua-accent)}
.ua-tb__irq i{font-style:normal;opacity:0}
.ua-tb__flash{position:absolute;inset:0;pointer-events:none;background:var(--ua-color);opacity:0}
`;

const SCRIPT = [
  { text: 'core: cold start, firmware 4.2.1', tag: 'OK', meter: 0 },
  { text: 'clk: oscillator locked 48.000 MHz', tag: 'OK' },
  { bar: 'mem: probing 48 banks', tag: 'OK', meter: 1, map: true },
  { text: 'bus: 12 of 12 nodes answered', tag: 'OK' },
  { text: 'thermal: sensor 3 high, fan raised', tag: 'WARN', meter: 3 },
  { text: 'net: link up, latency 3 ms', tag: 'OK', meter: 2 },
  { bar: 'fs: verifying /vault', tag: 'OK' },
  { text: 'sec: 4 keys loaded, seal intact', tag: 'OK' },
  { text: 'ui: handing over to shell', tag: 'OK' },
];
const METERS = [
  { label: 'CORE', value: 0.42 },
  { label: 'MEM', value: 0.68 },
  { label: 'LINK', value: 0.91 },
  { label: 'TEMP', value: 0.57 },
];
// 割り込みで打ち込むコマンド。meter は動かす計器の番号、to はその行き先、cells は升目の見せ方。
const COMMANDS = [
  { cmd: 'memtest --quick', out: ['scanning 48 banks ........ done', '0 faults · 2 remapped'], meter: 1, to: 0.97, cells: 'sweep' },
  { cmd: 'fan --max', out: ['fan 4200 rpm', 'thermal: sensor 3 falling'], meter: 3, to: 0.18, cells: 'none' },
  { cmd: 'ping core', out: ['reply from core: 2 ms', 'reply from core: 2 ms'], meter: 2, to: 1, cells: 'blink' },
  { cmd: 'reboot', out: ['sync ... ok', 'going down NOW'], meter: 0, to: 0.02, cells: 'drain', reboot: true },
];
const CELLS = 48;
const TYPE_MS = 430;
const BAR_MS = 950;
const GAP_MS = 150;
const IDLE_MS = 3600;

const stamp = (ms) => `[${(ms / 1000).toFixed(3).padStart(7, ' ')}] `;

function barText(label, k, width) {
  const filled = Math.round(k * width);
  return `${label} [${'#'.repeat(filled)}${'.'.repeat(width - filled)}] ${String(Math.round(k * 100)).padStart(3, ' ')}%`;
}

export function mount(container, options = {}) {
  injectStyle(meta.id, CSS);
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-tb', { '--ua-bg': p.background, '--ua-color': p.color, '--ua-accent': p.accent });
  const disposer = createDisposer();
  const reduced = prefersReducedMotion();
  const compact = Boolean(p.preview);
  const barWidth = compact ? 8 : 20;

  const clock = h('span', { text: 'T+00:00.00' });
  const phase = h('span', { text: 'BOOT' });
  const lines = h('div', { class: 'ua-tb__lines' });
  const cursor = h('span', { class: 'ua-tb__cursor' });
  const idleParts = [
    h('div', { class: 'ua-tb__ready', text: '● SYSTEM READY' }),
    h('div', { class: 'ua-tb__host', text: p.host }),
    h('div', { class: 'ua-tb__rule' }),
    h('div', { text: 'all 9 checks passed · 1 warning' }),
    h('div', {}, h('span', { text: 'operator@' + p.host.toLowerCase() + ':~$' }), cursor),
  ];
  const idle = h('div', { class: 'ua-tb__idle' }, idleParts);

  const meters = METERS.map((m) => {
    const readout = h('span', { text: '--' });
    const fill = h('div', { class: 'ua-tb__fill' });
    const el = h('div', { class: 'ua-tb__meter' }, h('div', {}, h('span', { text: m.label }), readout), h('div', { class: 'ua-tb__track' }, fill));
    return { ...m, el, readout, fill, state: { v: 0 } };
  });
  const cells = Array.from({ length: CELLS }, () => h('i', { class: 'ua-tb__cell' }));
  const flash = h('div', { class: 'ua-tb__flash' });
  const irqHead = h('b', { text: '^C  -- INTERRUPT --' });
  const irqCmd = h('span', { text: '' });
  const irqOut = [h('i', { text: '' }), h('i', { text: '' })];
  const irq = h('div', { class: 'ua-tb__irq' }, irqHead, irqCmd, irqOut);
  const sweep = h('div', { class: 'ua-tb__sweep' });

  root.append(
    h(
      'div',
      { class: 'ua-tb__screen' },
      h('div', { class: 'ua-tb__bar' }, h('span', { text: `${p.host} // BOOT MONITOR` }), phase),
      h(
        'div',
        { class: 'ua-tb__body' },
        h('div', { class: 'ua-tb__log' }, lines, idle, irq),
        h('div', { class: 'ua-tb__side' }, meters.map((m) => m.el), h('div', { class: 'ua-tb__map' }, cells)),
      ),
      h('div', { class: 'ua-tb__foot' }, h('span', { text: 'TTY1 · 0x3FA2 · 9600 8N1' }), clock),
    ),
    sweep,
    p.scanlines ? h('div', { class: 'ua-tb__scan' }) : null,
    flash,
  );

  function setMeter(meter, target, duration = 700) {
    animate(meter.state, {
      v: target,
      duration,
      ease: 'outExpo',
      onUpdate() {
        meter.fill.style.transform = `scaleX(${meter.state.v.toFixed(3)})`;
        meter.readout.textContent = `${Math.round(meter.state.v * 100)}%`;
      },
    });
  }
  let mapLevel = 0;
  function setCells(k) {
    mapLevel = k;
    const lit = Math.round(k * CELLS);
    cells.forEach((cell, i) => {
      cell.classList.toggle('is-on', i < lit);
      cell.classList.toggle('is-hot', i < lit && (i * 7) % 11 === 0);
    });
  }
  const formatClock = (ms) => {
    const sec = ms / 1000;
    return `T+${String(Math.floor(sec / 60)).padStart(2, '0')}:${(sec % 60).toFixed(2).padStart(5, '0')}`;
  };

  if (reduced) {
    for (const part of idleParts) part.style.opacity = '1';
    for (const meter of meters) {
      meter.fill.style.transform = `scaleX(${meter.value})`;
      meter.readout.textContent = `${Math.round(meter.value * 100)}%`;
    }
    setCells(1);
    phase.textContent = 'READY';
    return { destroy: () => removeRoot(root) };
  }

  let elapsed = 0;
  let cycle = null;
  let jitterAt = 0;

  function buildCycle() {
    utils.remove([lines, ...idleParts, ...meters.map((m) => m.state)]);
    lines.replaceChildren();
    lines.style.opacity = '1';
    lines.style.transform = 'none';
    for (const part of idleParts) part.style.opacity = '0';
    for (const meter of meters) {
      meter.state.v = 0;
      meter.fill.style.transform = 'scaleX(0)';
      meter.readout.textContent = '--';
    }
    setCells(0);
    phase.textContent = 'BOOT';
    let at = 350;
    const stepsList = SCRIPT.map((item) => {
      const duration = item.bar ? BAR_MS : TYPE_MS;
      const step = { ...item, start: at, duration, el: null, msg: null, tagEl: null, done: false };
      at += duration + GAP_MS;
      return step;
    });
    return { steps: stepsList, idleAt: at + 400, idleShown: false, total: at + 400 + IDLE_MS };
  }

  function beginStep(step) {
    step.msg = h('span', { class: 'ua-tb__msg' });
    step.tagEl = h('span', { class: `ua-tb__tag${step.tag === 'WARN' ? ' ua-tb__tag--warn' : ''}`, text: step.tag });
    step.el = h('div', { class: 'ua-tb__line' }, step.msg, step.tagEl);
    lines.appendChild(step.el);
  }
  function updateStep(step, k) {
    const prefix = compact ? '' : stamp(step.start);
    if (step.bar) {
      step.msg.textContent = prefix + barText(step.bar, k, barWidth);
      if (step.map) setCells(k);
    } else {
      const text = prefix + step.text;
      step.msg.textContent = text.slice(0, Math.ceil(k * text.length)) + (k < 1 ? '_' : '');
    }
  }
  function finishStep(step) {
    step.done = true;
    animate(step.tagEl, { opacity: [0, 1], duration: 260, ease: steps(3) });
    if (step.meter !== undefined) setMeter(meters[step.meter], meters[step.meter].value);
  }
  function showIdle() {
    phase.textContent = 'READY';
    animate(lines, { opacity: 0, translateY: '-6%', duration: 420, ease: 'inQuad' });
    animate(idleParts, { opacity: [0, 1], translateX: ['-1.2em', 0], duration: 620, ease: 'outExpo', delay: stagger(110, { start: 260 }) });
  }

  function restart() {
    elapsed = 0;
    jitterAt = 0;
    cycle = buildCycle();
    animate(flash, { opacity: [0.22, 0], duration: 380, ease: 'outQuad' });
  }

  // 割り込み。起動が止まり、欄がせり上がる（準備）→ コマンドが打ち込まれ、結果の行と計器と升目が順に動く（山場）
  // → 欄が下がり、起動の続きへ戻る（余韻）。
  const typed = { n: 0 };
  const scan = { n: 0 };
  let held = false;
  let irqTimeline = null;
  let commandIndex = 0;
  const prompt = compact ? '$ ' : 'operator$ ';
  function interrupt() {
    const command = COMMANDS[commandIndex % COMMANDS.length];
    commandIndex += 1;
    irqTimeline?.pause();
    utils.remove([irq, typed, scan, ...irqOut]);
    setCells(mapLevel);
    held = true;
    typed.n = 0;
    scan.n = 0;
    irqCmd.textContent = `${prompt}_`;
    irqOut.forEach((line, i) => {
      line.textContent = command.out[i];
      line.style.opacity = '0';
    });
    phase.textContent = 'IRQ';
    const before = mapLevel;
    const typeMs = command.cmd.length * 38;
    const ran = 420 + typeMs;
    irqTimeline = createTimeline({
      onComplete() {
        held = false;
        phase.textContent = cycle.idleShown ? 'READY' : 'BOOT';
        if (command.reboot) restart();
      },
    })
      .add(flash, { opacity: [0.16, 0], duration: 300, ease: 'outQuad' }, 0)
      .add(irq, { opacity: [0, 1], translateY: ['110%', '0%'], duration: 320, ease: 'outBack(1.6)' }, 0)
      .add(irqHead, { opacity: [0.2, 1], duration: 200, ease: steps(2), loop: 2 }, 0)
      .add(typed, {
        n: command.cmd.length,
        duration: typeMs,
        ease: 'linear',
        onUpdate() {
          const count = Math.round(typed.n);
          irqCmd.textContent = prompt + command.cmd.slice(0, count) + (count < command.cmd.length ? '_' : '');
        },
      }, 360)
      .add(irqOut, { opacity: [0, 1], translateX: ['-1em', 0], duration: 260, ease: 'outExpo', delay: stagger(260) }, ran + 80)
      .call(() => setMeter(meters[command.meter], command.to, 900), ran + 80)
      .add(scan, {
        n: CELLS,
        duration: 760,
        ease: 'linear',
        onUpdate() {
          if (command.cells === 'none') return;
          const head = Math.round(scan.n);
          cells.forEach((cell, i) => {
            if (command.cells === 'sweep') {
              cell.classList.toggle('is-on', i <= head || i < Math.round(before * CELLS));
              cell.classList.toggle('is-hot', Math.abs(i - head) < 3);
            } else if (command.cells === 'blink') {
              cell.classList.toggle('is-hot', (i + head) % 6 === 0);
            } else {
              cell.classList.toggle('is-on', i < Math.round(before * CELLS) - head);
              cell.classList.remove('is-hot');
            }
          });
        },
      }, ran + 80)
      .call(() => setCells(command.cells === 'sweep' ? 1 : command.cells === 'drain' ? 0 : before), ran + 860)
      .add(irq, { opacity: 0, translateY: '110%', duration: 360, ease: 'inQuad' }, ran + 1500);
  }

  cycle = buildCycle();
  animate(root.querySelector('.ua-tb__screen'), { opacity: [0, 1], scaleY: [0.02, 1], duration: 520, ease: 'outExpo' });
  animate(cursor, { opacity: [1, 0], duration: 520, ease: steps(1), loop: true, alternate: true });
  animate(sweep, { translateY: ['0%', '620%'], duration: 5200, ease: 'linear', loop: true });

  let last = performance.now();
  const timer = createTimer({
    onUpdate() {
      const now = performance.now();
      const dt = Math.min(120, now - last);
      last = now;
      // 割り込みのあいだは、起動の時計を止める。
      if (!held) elapsed += dt * p.speed;
      clock.textContent = formatClock(elapsed);
      for (const step of cycle.steps) {
        if (step.done || elapsed < step.start) continue;
        if (!step.el) beginStep(step);
        const k = Math.min(1, (elapsed - step.start) / step.duration);
        updateStep(step, k);
        if (k >= 1) finishStep(step);
      }
      if (!cycle.idleShown && elapsed >= cycle.idleAt) {
        cycle.idleShown = true;
        showIdle();
      }
      // 待ち受けの間は、計器の値を小さく揺らす。
      if (cycle.idleShown && elapsed > jitterAt) {
        jitterAt = elapsed + 520;
        for (const meter of held ? [] : meters) setMeter(meter, Math.min(1, Math.max(0.05, meter.value + utils.random(-0.07, 0.07, 3))), 480);
      }
      if (elapsed >= cycle.total) restart();
    },
  });
  disposer.add(() => timer.pause());
  disposer.add(() => irqTimeline?.pause());
  disposer.listen(root, 'click', interrupt);
  if (compact) disposer.interval(interrupt, 5200);

  return {
    restart,
    interrupt,
    destroy() {
      disposer.run();
      utils.remove([irq, typed, scan, ...irqOut, ...meters.map((m) => m.state)]);
      removeRoot(root);
    },
  };
}
