import '@fontsource-variable/bricolage-grotesque';
import './style.css';
import { assets, categoryLabel, findAsset, libsLabel } from '../assets/registry.js';
import { h } from '../lib/dom.js';
import { defaultsOf, diffFromDefaults, resolveParams } from '../lib/params.js';
import { mountInFrame } from './frame.js';

const stage = document.querySelector('#stage');
const panel = document.querySelector('#panel');
const REMOUNT_DELAY = 180;

const optionEntries = (spec) => spec.options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }));

// 貼り付け用のコード例を作る。既定値から変えた設定だけを書く。
function buildSnippet(asset, values) {
  const changed = diffFromDefaults(asset.params, values);
  const lines = Object.entries(changed).map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`);
  const options = lines.length ? `, {\n${lines.join('\n')}\n}` : '';
  return [
    `import { mount } from './${asset.path}';`,
    '',
    `const fx = mount(document.querySelector('#stage')${options});`,
    '',
    '// 使い終わったら片付ける',
    'fx.destroy();',
  ].join('\n');
}

function buildControl(key, spec, value, onChange) {
  const id = `param-${key}`;
  const label = h('label', { class: 'field__label', for: id, text: spec.label ?? key });
  if (spec.type === 'range') {
    const output = h('output', { class: 'field__value', for: id, text: String(value) });
    const input = h('input', { id, type: 'range', min: spec.min, max: spec.max, step: spec.step ?? 'any', value });
    input.addEventListener('input', () => {
      output.textContent = input.value;
      onChange(key, Number(input.value));
    });
    return h('div', { class: 'field' }, h('div', { class: 'field__head' }, label, output), input);
  }
  if (spec.type === 'color') {
    const output = h('output', { class: 'field__value', for: id, text: value });
    const input = h('input', { id, type: 'color', value });
    input.addEventListener('input', () => {
      output.textContent = input.value;
      onChange(key, input.value);
    });
    return h('div', { class: 'field field--inline' }, label, output, input);
  }
  if (spec.type === 'select') {
    const input = h(
      'select',
      { id },
      optionEntries(spec).map((o) => h('option', { value: o.value, selected: o.value === value, text: o.label })),
    );
    input.addEventListener('change', () => onChange(key, input.value));
    return h('div', { class: 'field' }, label, input);
  }
  if (spec.type === 'boolean') {
    const input = h('input', { id, type: 'checkbox', checked: value });
    input.addEventListener('change', () => onChange(key, input.checked));
    return h('div', { class: 'field field--inline' }, label, input);
  }
  const input = h('input', { id, type: 'text', value, maxlength: spec.maxLength ?? 200 });
  input.addEventListener('input', () => onChange(key, input.value));
  return h('div', { class: 'field' }, label, input);
}

function renderNotFound(id) {
  document.title = '素材が見つかりません | 動きの見本帳';
  stage.replaceChildren(h('p', { class: 'frame-error', text: 'この素材は見つかりませんでした。' }));
  panel.replaceChildren(
    h('h1', { class: 'panel__title', text: '素材が見つかりません' }),
    h('p', { class: 'panel__text', text: id ? `「${id.slice(0, 60)}」という素材はありません。見本帳から選び直してください。` : '素材が指定されていません。見本帳から選んでください。' }),
    h('a', { class: 'button', href: './', text: '見本帳を開く' }),
  );
}

function renderAsset(asset) {
  document.title = `${asset.title} | 動きの見本帳`;
  let values = defaultsOf(asset.params);
  let current = null;
  let timer = 0;

  const code = h('code');
  const copy = h('button', { class: 'button button--small', type: 'button', text: 'コードをコピー' });
  const form = h('form', { class: 'fields' });
  form.addEventListener('submit', (event) => event.preventDefault());

  function remount() {
    current?.destroy();
    current = mountInFrame(asset, stage, values);
    code.textContent = buildSnippet(asset, values);
  }
  function onChange(key, value) {
    values = resolveParams(asset.params, { ...values, [key]: value });
    code.textContent = buildSnippet(asset, values);
    clearTimeout(timer);
    timer = setTimeout(remount, REMOUNT_DELAY);
  }
  function renderControls() {
    form.replaceChildren(...Object.entries(asset.params).map(([key, spec]) => buildControl(key, spec, values[key], onChange)));
  }

  const reset = h('button', { class: 'button button--small button--ghost', type: 'button', text: '初期値に戻す' });
  reset.addEventListener('click', () => {
    clearTimeout(timer);
    values = defaultsOf(asset.params);
    renderControls();
    remount();
  });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.textContent);
      copy.textContent = 'コピーしました';
    } catch (error) {
      console.error('[web-anime] コピーに失敗しました', error);
      copy.textContent = 'コピーできませんでした';
    }
    setTimeout(() => {
      copy.textContent = 'コードをコピー';
    }, 1600);
  });

  const index = assets.indexOf(asset);
  const prev = assets[(index - 1 + assets.length) % assets.length];
  const next = assets[(index + 1) % assets.length];
  const neighbor = (target, label) => h('a', { class: 'neighbor', href: `demo.html?id=${encodeURIComponent(target.id)}` }, h('span', { class: 'neighbor__dir', text: label }), target.title);

  panel.replaceChildren(
    h('p', { class: 'panel__meta', text: `${categoryLabel(asset.category)}／${libsLabel(asset.libs)}` }),
    h('h1', { class: 'panel__title', text: asset.title }),
    h('p', { class: 'panel__text', text: asset.description }),
    h('section', { class: 'panel__block' }, h('div', { class: 'panel__head' }, h('h2', { text: '設定' }), reset), form),
    h(
      'section',
      { class: 'panel__block' },
      h('div', { class: 'panel__head' }, h('h2', { text: '使い方' }), copy),
      h('pre', { class: 'code', tabindex: 0 }, code),
      h('p', { class: 'panel__note', text: `ファイルは ${asset.path} です。src/lib フォルダーと一緒にコピーしてください。` }),
    ),
    h('nav', { class: 'neighbors', 'aria-label': 'ほかの素材' }, neighbor(prev, '前の素材'), neighbor(next, '次の素材')),
  );
  renderControls();
  remount();
}

function init() {
  if (!stage || !panel) return;
  const id = new URLSearchParams(window.location.search).get('id');
  const asset = findAsset(id);
  if (asset) renderAsset(asset);
  else renderNotFound(id);
}

init();
