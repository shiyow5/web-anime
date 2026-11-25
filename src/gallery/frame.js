import { h } from '../lib/dom.js';

// 素材を枠の中に入れる。素材側で例外が出ても、ページ全体は止めずに枠の中へ理由を表示する。
export function mountInFrame(asset, frame, options = {}) {
  try {
    const handle = asset.mount(frame, options);
    return {
      handle,
      destroy() {
        try {
          handle?.destroy?.();
        } catch (error) {
          console.error(`[web-anime] ${asset.id} の片付けに失敗しました`, error);
        }
        frame.replaceChildren();
      },
    };
  } catch (error) {
    console.error(`[web-anime] ${asset.id} を表示できませんでした`, error);
    frame.replaceChildren(
      h('p', { class: 'frame-error', text: `この素材を表示できませんでした。${error?.message ?? ''}` }),
    );
    return { handle: null, destroy: () => frame.replaceChildren() };
  }
}
