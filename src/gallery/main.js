import '@fontsource-variable/bricolage-grotesque';
import './style.css';
import { animate, stagger } from 'animejs';
import { CATEGORIES, assets, categoryLabel, libsLabel } from '../assets/registry.js';
import { h, prefersReducedMotion } from '../lib/dom.js';
import { mountInFrame } from './frame.js';

const sheet = document.querySelector('#sheet');
const filter = document.querySelector('#filter');
const lead = document.querySelector('#lead-count');
const live = new Map();

const demoUrl = (id) => `demo.html?id=${encodeURIComponent(id)}`;

function buildTile(asset, index) {
  const frame = h('div', { class: 'tile__frame', 'aria-hidden': 'true' });
  const link = h('a', { class: 'tile__title', href: demoUrl(asset.id), text: asset.title });
  const tile = h(
    'article',
    { class: `tile${index === 0 ? ' tile--featured' : ''}`, 'data-category': asset.category, 'data-id': asset.id },
    frame,
    h('div', { class: 'tile__caption' }, h('h2', {}, link), h('p', { class: 'tile__meta', text: `${categoryLabel(asset.category)}／${libsLabel(asset.libs)}` })),
  );
  // 枠の中のクリックは素材に渡さず、個別ページへ移動する。
  frame.addEventListener(
    'click',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.location.assign(demoUrl(asset.id));
    },
    true,
  );
  return tile;
}

// 見えている枠だけ素材を動かす。WebGL の同時利用数に上限があるので、画面外に出たら片付ける。
const visibility = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const tile = entry.target;
      const id = tile.dataset.id;
      const frame = tile.querySelector('.tile__frame');
      if (entry.isIntersecting && !live.has(id)) {
        const asset = assets.find((a) => a.id === id);
        live.set(id, mountInFrame(asset, frame, { preview: true }));
        // 枠の中のボタンやリンクは、キーボードの移動先から外す。
        for (const focusable of frame.querySelectorAll('a, button')) focusable.tabIndex = -1;
      } else if (!entry.isIntersecting && live.has(id)) {
        live.get(id).destroy();
        live.delete(id);
      }
    }
  },
  { rootMargin: '120px 0px' },
);

function buildFilter() {
  const counts = new Map(CATEGORIES.map((c) => [c.id, assets.filter((a) => a.category === c.id).length]));
  const chips = [{ id: 'all', label: 'すべて', count: assets.length }, ...CATEGORIES.map((c) => ({ ...c, count: counts.get(c.id) }))]
    .filter((chip) => chip.count > 0)
    .map(({ id, label, count }) =>
      h('button', { class: 'chip', type: 'button', 'data-filter': id, 'aria-pressed': id === 'all' ? 'true' : 'false' }, label, h('span', { class: 'chip__count', text: String(count) })),
    );
  filter.append(...chips);
  filter.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    for (const other of chips) other.setAttribute('aria-pressed', String(other === chip));
    applyFilter(chip.dataset.filter);
  });
}

function applyFilter(category) {
  const tiles = [...sheet.children];
  const shown = tiles.filter((tile) => {
    const match = category === 'all' || tile.dataset.category === category;
    tile.hidden = !match;
    return match;
  });
  tiles.forEach((tile) => tile.classList.toggle('tile--featured', tile === shown[0] && category === 'all'));
  if (!prefersReducedMotion()) {
    animate(shown, { opacity: [0, 1], y: [14, 0], duration: 500, ease: 'outQuart', delay: stagger(35) });
  }
}

function init() {
  if (!sheet || !filter) return;
  lead.textContent = String(assets.length);
  const tiles = assets.map(buildTile);
  sheet.append(...tiles);
  buildFilter();
  for (const tile of tiles) visibility.observe(tile);
}

init();
