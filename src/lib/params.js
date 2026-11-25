// 素材に渡された設定値を検証して、既定値で埋める。
// 外から来た値は信用せず、型と範囲が合わないものは既定値に戻す。

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_TEXT_LENGTH = 200;

const optionValues = (spec) =>
  (spec.options ?? []).map((o) => (typeof o === 'object' && o !== null ? o.value : o));

const resolvers = {
  range(spec, value) {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n)) return spec.default;
    return Math.min(spec.max, Math.max(spec.min, n));
  },
  color(spec, value) {
    return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : spec.default;
  },
  select(spec, value) {
    return optionValues(spec).includes(value) ? value : spec.default;
  },
  text(spec, value) {
    if (typeof value !== 'string' || value.trim() === '') return spec.default;
    return value.slice(0, spec.maxLength ?? MAX_TEXT_LENGTH);
  },
  boolean(spec, value) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return typeof value === 'boolean' ? value : spec.default;
  },
};

export function resolveParam(spec, value) {
  const resolver = resolvers[spec?.type];
  if (!resolver) throw new Error(`未対応の設定の種類です: ${spec?.type}`);
  return value === undefined || value === null ? spec.default : resolver(spec, value);
}

// specs にない項目（preview など）はそのまま通す。
export function resolveParams(specs = {}, options = {}) {
  const safeOptions = options && typeof options === 'object' ? options : {};
  const resolved = Object.fromEntries(
    Object.entries(specs).map(([key, spec]) => [key, resolveParam(spec, safeOptions[key])]),
  );
  return Object.freeze({ ...safeOptions, ...resolved });
}

export function defaultsOf(specs = {}) {
  return Object.fromEntries(Object.entries(specs).map(([key, spec]) => [key, spec.default]));
}

// 既定値から変えた項目だけを返す。使い方のコード例を短くするために使う。
export function diffFromDefaults(specs = {}, values = {}) {
  return Object.fromEntries(
    Object.entries(specs)
      .filter(([key, spec]) => key in values && values[key] !== spec.default)
      .map(([key]) => [key, values[key]]),
  );
}

// 「A, B, C」のような区切り文字つきの文字列を、空要素を除いた配列にする。
export function splitList(text, { separator = ',', maxItems = 8, maxLength = 24 } = {}) {
  if (typeof text !== 'string') return [];
  return text
    .split(separator)
    .map((s) => s.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}
