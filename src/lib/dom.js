import { utils } from 'animejs';

export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function assertContainer(container) {
  if (!container || container.nodeType !== 1) {
    throw new TypeError('mount の第 1 引数には、素材を入れる HTML 要素を渡してください');
  }
  return container;
}

// 中に絶対配置の要素を置けるように、位置指定の無い入れ物を relative にする。
// まだページに付いていない要素は position が空文字で返るので、それも同じ扱いにする。
export function ensurePositioned(container) {
  assertContainer(container);
  const { position } = getComputedStyle(container);
  if (!position || position === 'static') container.style.position = 'relative';
  return container;
}

// 素材ごとの CSS を 1 回だけ <head> に入れる。
export function injectStyle(id, css) {
  const key = `ua-style-${id}`;
  if (document.getElementById(key)) return;
  const style = document.createElement('style');
  style.id = key;
  style.textContent = css;
  document.head.appendChild(style);
}

// h('div', { class: 'a', style: { color: 'red' } }, child, 'text')
export function h(tag, attrs = {}, ...children) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const isSvg = attrs?.svg === true;
  const node = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (key === 'svg' || value === undefined || value === null || value === false) continue;
    if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) node.style.setProperty(prop, v);
        else node.style[prop] = v;
      }
    } else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

export const s = (tag, attrs = {}, ...children) => h(tag, { ...attrs, svg: true }, ...children);

// 素材の根元の要素を作って container に入れる。position が static なら relative にする。
export function createRoot(container, className, style = {}) {
  ensurePositioned(container);
  const root = h('div', { class: className, style });
  container.appendChild(root);
  return root;
}

// 根元以下の要素にかかっている anime.js のアニメーションを止めて、DOM から外す。
export function removeRoot(root) {
  utils.remove([root, ...root.querySelectorAll('*')]);
  root.remove();
}

// 後片付けの関数をためておき、destroy でまとめて呼ぶ。
export function createDisposer() {
  const tasks = [];
  return {
    add(task) {
      tasks.push(task);
      return task;
    },
    listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      tasks.push(() => target.removeEventListener(type, handler, options));
    },
    timeout(fn, ms) {
      const id = setTimeout(fn, ms);
      tasks.push(() => clearTimeout(id));
      return id;
    },
    interval(fn, ms) {
      const id = setInterval(fn, ms);
      tasks.push(() => clearInterval(id));
      return id;
    },
    run() {
      for (const task of tasks.splice(0).reverse()) {
        try {
          task();
        } catch (error) {
          console.error('[web-anime] 後片付けに失敗しました', error);
        }
      }
    },
  };
}

// 要素内でのポインター位置を 0〜1 で返す。
export function localPointer(event, element) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.width ? (event.clientX - rect.left) / rect.width : 0.5,
    y: rect.height ? (event.clientY - rect.top) / rect.height : 0.5,
    px: event.clientX - rect.left,
    py: event.clientY - rect.top,
    rect,
  };
}
