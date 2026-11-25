# 動きの見本帳（web-anime）

three.js と anime.js で作った、ウェブサイトに組み込めるアニメーション素材集です。素材は35点で、SF、ファンタジー、時計、自然・和風といった題材ごとの素材も含みます。一覧ページで実物の動きを見比べ、個別ページで色や速さを変えて試し、決まった設定をコードとしてコピーできます。

## 動かし方

Node.js 22 以上が必要です。

```bash
npm install
npm run dev
```

表示されたURLをブラウザーで開くと、一覧ページが出ます。

| コマンド | すること |
|---|---|
| `npm run dev` | 開発用サーバーを起動する |
| `npm run build` | `dist/` に公開用のファイルを書き出す |
| `npm run preview` | 書き出したファイルを手元で確認する |
| `npm test` | 単体テストを実行する |
| `npm run coverage` | 単体テストを実行し、カバレッジを表示する |
| `npm run e2e` | Chrome で全素材を開き、表示・操作・片付けを確かめる（10 分ほどかかる） |

## 素材の一覧

| id | 名前 | 分類 | 使うライブラリ | 向いている場面 |
|---|---|---|---|---|
| `text-particles` | 文字になる粒 | 3D・WebGL | three.js + anime.js | トップページの主役 |
| `liquid-orb` | 液体の球 | 3D・WebGL | three.js + anime.js | トップページの主役 |
| `floating-shapes` | 浮かぶ立体 | 3D・WebGL | three.js + anime.js | サービス紹介、ポートフォリオ |
| `particle-galaxy` | 渦巻き銀河 | 3D・WebGL | three.js + anime.js | 暗い配色のトップページ |
| `image-ripple` | 画像の波紋と切り替え | 3D・WebGL | three.js + anime.js | 写真のスライド |
| `warp-tunnel` | ワープ航法 | 3D・WebGL | three.js + anime.js | ページ遷移、読み込み中 |
| `holo-globe` | ホログラムの惑星 | SF | three.js + anime.js | 技術系サイトの主役 |
| `black-hole` | ブラックホール | SF | three.js + anime.js | 宇宙や科学の題材 |
| `neon-horizon` | ネオンの地平線 | SF | three.js | 音楽やゲームのサイト |
| `hud-interface` | 宇宙船の計器盤 | SF | anime.js | 数値や状態を見せる画面 |
| `glitch-text` | 乱れる文字 | SF | anime.js | ゲームや音楽の見出し |
| `magic-circle` | 魔法陣 | ファンタジー | anime.js | ゲーム風の演出、読み込み中 |
| `crystal-gem` | 魔力の結晶 | ファンタジー | three.js + anime.js | 商品や特典の見せ場 |
| `portal-vortex` | 渦の門 | ファンタジー | three.js + anime.js | ページの入口 |
| `firefly-forest` | 蛍の森 | ファンタジー | three.js | 物語調のページの背景 |
| `flip-clock` | めくれる時計 | 時計 | anime.js | 時刻の表示、カウントダウンの土台 |
| `analog-clock` | 針の時計 | 時計 | anime.js | 時刻の表示 |
| `orbit-clock` | 軌道の時計 | 時計 | three.js + anime.js | 飾りを兼ねた時刻の表示 |
| `particle-clock` | 粒の時計 | 時計 | three.js + anime.js | トップページの主役 |
| `rain-ripples` | 雨の波紋 | 自然・和風 | three.js | 落ち着いたページの背景 |
| `sakura-fall` | 桜吹雪 | 自然・和風 | three.js | 和風のサイト、春の告知 |
| `aurora-gradient` | ゆらぐグラデーション | 背景 | three.js | 文字を重ねる背景 |
| `wave-terrain` | 点の波 | 背景 | three.js | 文字の多いページの背景 |
| `blob-morph` | 形を変える色のかたまり | 背景 | anime.js | WebGL を使えない場面の背景 |
| `kinetic-headline` | 動く見出し | 文字 | anime.js | 見出しの登場 |
| `scramble-text` | 解読される文字 | 文字 | anime.js | 技術系サイトの見出し |
| `line-draw` | 一筆で描かれる線画 | SVG | anime.js | ロゴの登場、図解 |
| `magnetic-button` | 吸いつくボタン | UI 部品 | anime.js | 申し込みや問い合わせのボタン |
| `stagger-grid` | 波打つ格子 | UI 部品 | anime.js | 背景、完了の合図 |
| `tilt-card` | 傾くカード | UI 部品 | anime.js | 作品一覧、商品カード |
| `cursor-trail` | 尾を引くカーソル | UI 部品 | anime.js | 演出を前に出したいサイト |
| `confetti-burst` | 紙吹雪 | UI 部品 | anime.js | 完了や達成のお祝い |
| `scroll-reveal` | スクロールで進む物語 | スクロール | anime.js | 長い紹介ページ |
| `loader-set` | ローダー 6 種 | ローダー | anime.js | 読み込み中の表示 |
| `page-curtain` | ページ切り替えの幕 | ページ遷移 | anime.js | ページの切り替え |

## 自分のサイトで使う

どの素材も、同じ 2 つの関数で扱えます。表示は `mount`、片付けは戻り値の `destroy` です。

```html
<div id="hero" style="height: 100vh"></div>
```

```js
import { mount } from './src/assets/webgl/liquid-orb.js';

const fx = mount(document.querySelector('#hero'), {
  colorA: '#0b3a8f',
  colorB: '#39d6c8',
  distortion: 0.4,
});

// ページを離れるときなど、使い終わったら片付ける
fx.destroy();
```

素材は、渡した要素の大きさに合わせて広がります。高さが 0 の要素に入れると何も見えないので、要素には高さを指定してください。

別のプロジェクトへ持っていくときは、次の 3 つをコピーします。

1. 使いたい素材のファイル（例: `src/assets/webgl/liquid-orb.js`）
2. `src/lib` フォルダー
3. `three` と `animejs` のインストール（`npm install three animejs`）

素材ファイルは `../../lib/` を相対パスで読みます。フォルダーの位置関係を変えたときは、import の行を書き換えてください。

### 設定できる項目

設定の名前と範囲は、個別ページの「設定」欄で確認できます。欄を動かすと、下の「使い方」のコードに反映されます。同じ内容は、各素材ファイルの `meta.params` でも読めます。

範囲の外の数値や、色として読めない文字列を渡した場合は、その項目だけ既定値に戻します。

### 素材ごとの追加機能

`mount` の戻り値に、`destroy` 以外の関数を持つ素材があります。

| 素材 | 関数 | すること |
|---|---|---|
| `page-curtain` | `go('curve' \| 'stripes' \| 'circle')` | 幕を出して次のページへ切り替える |
| `image-ripple` | `next()` | 次の画像へ切り替える |
| `scramble-text` | `next()` | 次の文へ置き換える |
| `stagger-grid` | `ripple(番号)` | 指定した点から波を起こす |
| `floating-shapes` | `burst()` | 立体を外へ弾けさせる |
| `warp-tunnel` | `boost(true \| false)` | 加速と減速を切り替える |
| `line-draw` | `replay()` | 最初から描き直す |
| `confetti-burst` | `burst(x, y)` | 指定した位置から紙吹雪を出す |
| `magic-circle` | `cast()` | 魔法陣を発動させる |
| `holo-globe` | `reboot()` | 映像を乱して走査し直す |
| `black-hole` | `flare()` | 円盤を明るく燃え上がらせる |
| `crystal-gem` | `chime()` | 結晶を震わせて粒を弾けさせる |
| `portal-vortex` | `reopen()` | 門を閉じて開き直す |
| `glitch-text` | `burst()` | 文字を乱れさせる |

`image-ripple` は、設定に `images` として画像のURLを2枚以上渡すと、見本のポスターの代わりにその画像を表示します。

```js
mount(el, { images: ['/photos/a.jpg', '/photos/b.jpg', '/photos/c.jpg'] });
```

## 素材を増やす

`src/assets/<分類>/<id>.js` を作り、`meta` と `mount` を export します。一覧への登録は要りません。`src/assets/registry.js` がフォルダーの中身を自動で読みます。

```js
import { createRoot, removeRoot } from '../../lib/dom.js';
import { resolveParams } from '../../lib/params.js';

export const meta = {
  id: 'my-effect', // ファイル名と同じにする
  title: '表示名',
  category: 'ui', // registry.js の CATEGORIES にある id
  libs: ['animejs'],
  description: '何が起きて、どこで使えるかを書く。',
  params: {
    color: { type: 'color', label: '色', default: '#ff5a36' },
    speed: { type: 'range', label: '速さ', min: 0, max: 2, step: 0.1, default: 1 },
  },
};

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  const root = createRoot(container, 'ua-my-effect');
  // ここで動きを付ける
  return { destroy: () => removeRoot(root) };
}
```

`params` の `type` は `range`、`color`、`select`、`text`、`boolean` の 5 種類です。個別ページの設定欄は、この定義から自動で作られます。

three.js を使う素材は、`src/lib/stage.js` の `createStage` を使ってください。レンダラーの用意、リサイズへの追従、描画ループ、ポインターの追跡、メモリーの解放を受け持ちます。

## 作りの方針

画面の外に出た素材と、隠れたタブの素材は、描画を止めます。OSで動きを減らす設定を選んでいる人には、動きを止めた状態を表示します。

一覧ページは、見えている枠の素材だけを動かします。ブラウザーが同時に持てるWebGLの数に上限があるためです。

設定値は `src/lib/params.js` で検証します。文字列を画面に出すときは `textContent` を使うので、HTMLとして解釈されることはありません。

`src/lib/glsl.js` のシンプレックスノイズは、Ian McEwan氏とAshima Artsによる実装（MIT License）です。

## テストの範囲

単体テストは `src/lib/params.js`、`src/lib/dom.js`、`src/assets/registry.js`、時計の時刻計算と、three.jsを使わない素材17点の組み立てと片付けを対象にしています。`src/lib/stage.js` とthree.jsを使う素材18点はWebGLが必要なので、単体テストの対象から外しました。こちらはブラウザーテストで確かめます。

ブラウザーテストは2本あります。`tests/e2e/gallery.spec.js` は、全素材を開いてエラーとシェーダーのコンパイル失敗が出ないことを見ます。`tests/e2e/verify.spec.js` は、素材ごとにポインター操作とクリック、スマートフォンの幅、動きを減らす設定を試すテストです。全素材を4回ずつ表示して片付け、要素・イベント・タイマーが残らないことも数えています。

テスト用のChromeはGPUを使わないソフトウェア描画で動きます。確かめられるのは描画の正しさまでで、実機での滑らかさは測れません。滑らかさは `npm run dev` で開いて、手元のブラウザーで確かめてください。

## 書くときの注意

素材を足すときに実際に踏んだ落とし穴です。

- コンテナ単位（`cqw` や `cqh`）は、`container-type` を付けた要素自身には効きません。大きさを決める指定は、その内側の要素に書きます。
- SVG要素をanime.jsで動かすとき、`x` と `y` は属性として扱われます。位置をずらしたいときは `translateX` と `translateY` と書きます。
- SVG全体に `filter: drop-shadow()` をかけて動かすと重くなります。光らせたいときは、太くて薄い線を下に敷きます。

## フォルダー構成

```
index.html          一覧ページ
demo.html           個別ページ（?id=素材の id）
src/
  assets/           素材（分類ごとのフォルダー）と registry.js
  lib/              素材が共通で使う部品
  gallery/          一覧ページと個別ページのコード
tests/
  unit/             vitest の単体テスト
  e2e/              playwright のブラウザーテスト
```
