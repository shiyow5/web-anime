// 素材フォルダーの中身を読み集めて、一覧として公開する。
// 新しい素材は src/assets/<分類>/<id>.js に置けば、ここを書き換えなくても一覧に載る。

const modules = import.meta.glob('./*/*.js', { eager: true });

export const CATEGORIES = Object.freeze([
  { id: 'webgl', label: '3D・WebGL' },
  { id: 'scifi', label: 'SF' },
  { id: 'fantasy', label: 'ファンタジー' },
  { id: 'clock', label: '時計' },
  { id: 'nature', label: '自然・和風' },
  { id: 'background', label: '背景' },
  { id: 'text', label: '文字' },
  { id: 'svg', label: 'SVG' },
  { id: 'ui', label: 'UI 部品' },
  { id: 'scroll', label: 'スクロール' },
  { id: 'loader', label: 'ローダー' },
  { id: 'transition', label: 'ページ遷移' },
]);

export const LIB_LABELS = Object.freeze({ three: 'three.js', animejs: 'anime.js' });

// 一覧での並び順。ここに無い素材は後ろに id 順で並ぶ。
const ORDER = [
  'text-particles',
  'flip-clock',
  'holo-globe',
  'magic-circle',
  'liquid-orb',
  'kinetic-headline',
  'black-hole',
  'orbit-clock',
  'floating-shapes',
  'crystal-gem',
  'page-curtain',
  'neon-horizon',
  'sakura-fall',
  'particle-galaxy',
  'analog-clock',
  'portal-vortex',
  'magnetic-button',
  'hud-interface',
  'aurora-gradient',
  'firefly-forest',
  'line-draw',
  'image-ripple',
  'particle-clock',
  'glitch-text',
  'stagger-grid',
  'rain-ripples',
  'tilt-card',
  'warp-tunnel',
  'confetti-burst',
  'scramble-text',
  'blob-morph',
  'scroll-reveal',
  'wave-terrain',
  'loader-set',
  'cursor-trail',
];

const rank = (id) => {
  const index = ORDER.indexOf(id);
  return index === -1 ? ORDER.length : index;
};

export const assets = Object.freeze(
  Object.entries(modules)
    .filter(([, module]) => module.meta && typeof module.mount === 'function')
    .map(([path, module]) => Object.freeze({ ...module.meta, path: path.replace('./', 'src/assets/'), mount: module.mount }))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id)),
);

export function findAsset(id) {
  return typeof id === 'string' ? (assets.find((asset) => asset.id === id) ?? null) : null;
}

export function categoryLabel(id) {
  return CATEGORIES.find((category) => category.id === id)?.label ?? id;
}

export function libsLabel(libs = []) {
  return libs.map((lib) => LIB_LABELS[lib] ?? lib).join(' + ');
}
