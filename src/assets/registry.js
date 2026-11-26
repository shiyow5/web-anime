// 素材フォルダーの中身を読み集めて、一覧として公開する。
// 新しい素材は src/assets/<分類>/<id>.js に置けば、ここを書き換えなくても一覧に載る。

const modules = import.meta.glob('./*/*.js', { eager: true });

export const CATEGORIES = Object.freeze([
  { id: 'webgl', label: '3D・WebGL' },
  { id: 'cyber', label: 'サイバー' },
  { id: 'scifi', label: 'SF' },
  { id: 'fantasy', label: 'ファンタジー' },
  { id: 'clock', label: '時計' },
  { id: 'nature', label: '自然・和風' },
  { id: 'science', label: 'サイエンス' },
  { id: 'fancy', label: 'ファンシー' },
  { id: 'pixel', label: 'ドット絵' },
  { id: 'ascii', label: 'アスキーアート' },
  { id: 'background', label: '背景' },
  { id: 'text', label: '文字' },
  { id: 'svg', label: 'SVG' },
  { id: 'ui', label: 'UI 部品' },
  { id: 'scroll', label: 'スクロール' },
  { id: 'loader', label: 'ローダー' },
  { id: 'transition', label: 'ページ遷移' },
]);

export const LIB_LABELS = Object.freeze({ three: 'three.js', animejs: 'anime.js' });

// 一覧の先頭に置く素材。軸の違う回転を持つ立体と、層を重ねた素材を前に出し、題材が続かないように並べる。
const FEATURED = [
  'holo-chronograph',
  'sigil-dome',
  'gear-reactor',
  'chrono-core',
  'carousel-music-box',
  'clockwork-movement',
  'arcane-gyro',
  'ascii-gyro',
  'holo-reactor',
  'text-particles',
  'planet-rings',
  'bevel-cube',
  'pixel-gyro-cube',
  'armillary-clock',
  'exploded-core',
  'rune-sphere',
  'bubble-float',
  'gyro-stabilizer',
  'ascii-torus',
  'glitch-dial',
  'gear-orrery',
  'lorenz-attractor',
  'strata-clock',
  'hex-shield',
  'liquid-orb',
  'data-sphere',
  'pixel-night-city',
  'astrolabe',
  'iso-stack',
  'aurora-sky',
  'ring-gate',
  'depth-type',
  'holo-globe',
  'neon-city',
  'dna-helix',
  'tesseract',
];

const found = Object.entries(modules)
  .filter(([, module]) => module.meta && typeof module.mount === 'function')
  .map(([path, module]) => Object.freeze({ ...module.meta, path: path.replace('./', 'src/assets/'), mount: module.mount }));

// 残りの素材は、分類を順に回しながら 1 点ずつ並べる。同じ題材が固まらないようにするため。
function roundRobin(rest) {
  const groups = CATEGORIES.map((category) => rest.filter((asset) => asset.category === category.id).sort((a, b) => a.id.localeCompare(b.id)));
  const known = new Set(CATEGORIES.map((category) => category.id));
  const others = rest.filter((asset) => !known.has(asset.category)).sort((a, b) => a.id.localeCompare(b.id));
  const longest = Math.max(0, ...groups.map((group) => group.length));
  const mixed = Array.from({ length: longest }, (_, i) => groups.map((group) => group[i]).filter(Boolean)).flat();
  return [...mixed, ...others];
}

const featured = FEATURED.map((id) => found.find((asset) => asset.id === id)).filter(Boolean);
export const assets = Object.freeze([...featured, ...roundRobin(found.filter((asset) => !FEATURED.includes(asset.id)))]);

export function findAsset(id) {
  return typeof id === 'string' ? (assets.find((asset) => asset.id === id) ?? null) : null;
}

export function categoryLabel(id) {
  return CATEGORIES.find((category) => category.id === id)?.label ?? id;
}

export function libsLabel(libs = []) {
  return libs.map((lib) => LIB_LABELS[lib] ?? lib).join(' + ');
}
