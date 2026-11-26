# 素材を書くための手引き

素材を 1 点足すときに守る決まりと、実際に踏んだ落とし穴をまとめます。書き始める前に、手本になる素材を 2 つ読んでください。

- three.js を使う素材の手本は `src/assets/scifi/holo-globe.js` と `src/assets/fantasy/firefly-forest.js`
- anime.js だけで作る素材の手本は `src/assets/clock/flip-clock.js`、`src/assets/fantasy/magic-circle.js`、`src/assets/ui/confetti-burst.js`
- 共通の部品は `src/lib/dom.js`、`src/lib/params.js`、`src/lib/stage.js`、`src/lib/glsl.js`

## 1 点の素材の形

ファイルは `src/assets/<分類>/<id>.js` に置きます。`id` はファイル名と同じ、小文字とハイフンだけの名前にします。一覧への登録は要りません。

```js
export const meta = {
  id: 'my-effect',
  title: '短い日本語の名前',
  category: 'cyber', // src/assets/registry.js の CATEGORIES にある id
  libs: ['three', 'animejs'], // 実際に使っているものだけ。空にはできない
  description: '何が起きるか。触るとどうなるか。どんな場面で使えるか。この 3 つを 2〜3 文で書く。',
  params: {
    color: { type: 'color', label: '色', default: '#4de8ff' },
    speed: { type: 'range', label: '速さ', min: 0, max: 3, step: 0.1, default: 1 },
  },
};

export function mount(container, options = {}) {
  const p = resolveParams(meta.params, options);
  // ...
  return { destroy() {} };
}
```

`params` は 3〜7 個にします。`type` は `range`、`color`、`select`、`text`、`boolean` の 5 種類です。色は 6 桁の 16 進数で書き、既定値は範囲の中に収めます。個別ページの設定欄は、この定義から自動で作られます。

`libs` は `three` と `animejs` のどちらか、または両方です。キャンバスの 2D 描画や `<pre>` の書き換えだけで作る素材でも、時間の管理や値の変化に anime.js を実際に使ってください（`createTimer`、`animate`、`stagger` など）。

## 必ず守ること

- `mount` に要素以外が渡されたら `TypeError` にする。`createRoot` か `createStage` を使えば自動でそうなる
- `destroy` で、付けたものをすべて外す。イベント、`setInterval`、`setTimeout`、Observer、anime.js のアニメーション、作った要素が対象
- `options.preview` が真のときは、一覧の小さな枠（幅 380px ほど）に出ている。粒の数などを減らして軽くし、触らなくても動きが分かるように自動で動かす
- `prefersReducedMotion()` が真のときは、動きを止めた完成形を見せる。エラーにしない
- 設定値は `resolveParams(meta.params, options)` を通してから使う
- 文字列を画面に出すときは `textContent` か `h(tag, { text })` を使う。`innerHTML` は使わない
- `console.log` を残さない
- 外部の画像・フォント・通信に頼らない。依存パッケージを足さない
- 幅 900px の大きな枠でも、幅 380px の小さな枠でも、はみ出さずに見える大きさにする
- 実在の作品・キャラクター・ブランドの見た目を写さない。形も配色も自分で考える

## 見た目の水準

平らな 1 枚絵で済ませず、層と奥行きと光で見せます。手本は animejs.com のトップにある、細い輪・目盛り・弧を何層にも重ねた計器のような円盤です。

- ジャンルに合った配色を素材ごとに決める。どの素材も同じ「黒地に水色」にしない
- 細部を入れる。目盛り、細い補助線、小さな数値、粒など、近くで見て気づく要素が奥行きを作る
- 触ったときの反応を 1 つは入れる（ポインターで傾く、クリックで弾ける、など）
- 登場の演出を入れる。読み込み直後に、部品が順に現れて組み上がると印象に残る

## anime.js v4 の書き方

このリポジトリの anime.js は v4.5 です。v3 の書き方は動きません。

```js
import { animate, createTimeline, createTimer, createAnimatable, createDrawable, createDraggable,
  onScroll, splitText, spring, stagger, steps, utils } from 'animejs';
```

- イージングは文字列で書く。`'outExpo'`、`'inOutQuart'`、`'linear'`、`'outElastic(1, .5)'`、`'outBack(2)'`、`'out(3)'`、`'outBounce'` など
- ばねは `spring({ stiffness: 120, damping: 9 })`。`createSpring` は非推奨で警告が出る
- 段階的な変化は `steps(3)` と関数で渡す。文字列の `'steps(3)'` は廃止された
- キーフレームは配列で書く。`scale: [{ to: 1.2, duration: 150, ease: 'outQuad' }, { to: 1, duration: 800, ease: 'outElastic(1, .4)' }]`
- 値を要素ごとに変えるときは関数を渡す。`x: () => utils.random(-100, 100)`、`delay: stagger(40, { from: 'center' })`
- ただのオブジェクトも動かせる。`animate(state, { value: 1, onUpdate() {} })`。`destroy` では `utils.remove(state)` で止める
- 終わりのないループは `createTimer({ onUpdate() {} })` で作り、`destroy` で `timer.pause()` を呼ぶ
- タイムラインの途中で関数を呼ぶときは `timeline.call(fn, 位置)`
- `animate()` の戻り値を `await` しない。完了を待つときは `onComplete` で `Promise` を解決する
- `splitText` は `destroy` で `split.revert()` を呼ぶ。呼ばないと監視が残る

### SVG を動かすときの注意

- SVG 要素では `x` と `y` が属性として扱われる。位置をずらすときは `translateX` と `translateY` と書く
- SVG 要素を `scale` や `rotate` で動かすと、基準点が左上になる。CSS に `transform-box: fill-box; transform-origin: center` を付けるか、`transform-origin: 300px 300px` のように座標で指定する
- SVG 全体に `filter: drop-shadow()` をかけて動かすと重い。光らせたいときは、太くて薄い線を下に敷く

## CSS の注意

- 素材の CSS は `injectStyle(meta.id, CSS)` で入れ、クラス名は `ua-<略称>` で始める
- 入れ物の大きさに合わせるには、根元の要素に `container-type: size` を付け、内側の要素で `cqw` や `cqh` を使う。コンテナ単位は `container-type` を付けた要素自身には効かないので、根元の要素の `font-size` や `gap` には書かない
- 文字の書体は `font-family: var(--ua-display, system-ui, sans-serif)`、等幅は `ui-monospace, "SF Mono", Menlo, Consolas, monospace`
- 何百個もの要素に `will-change` を付けない

## three.js の注意

`createStage(container, options)` が、レンダラー、リサイズ、描画ループ、ポインターの追跡、片付けを受け持ちます。

| 項目 | 内容 |
|---|---|
| `fov`、`cameraZ` | カメラの画角と距離 |
| `background` | 背景色。省くと透明 |
| `preview` | `options.preview` をそのまま渡す。解像度が下がる |
| `antialias`、`maxDpr` | 全画面のシェーダーなら `antialias: false`、`maxDpr: 1.5` にして軽くする |
| `startTime` | 時間の初期値。最初から模様が広がった状態にしたいときに使う |
| `bloom` | `{ strength: 0.9, radius: 0.5, threshold: 0.1 }` を渡すと、明るい部分がにじんで光る |

戻り値の `stage` には `scene`、`camera`、`renderer`、`size`、`pointer`、`reduced` があります。`pointer` は `x`、`y`（-1〜1、右と上が正）、なめらかに追う `sx`、`sy`、枠の中にいるかの `inside`、動かした速さの `speed` を持ちます。毎フレームの処理は `stage.onFrame((time, dt) => {})`、大きさが変わったときの処理は `stage.onResize(({ width, height, dpr }) => {})` に書きます。`stage.viewport()` は、z = 0 の平面でカメラに映る幅と高さを返します。

- 自作のフラグメントシェーダーは、最後に `#include <colorspace_fragment>` を入れる。入れないと色が暗くなる
- 頂点シェーダーで位置を動かす物体は `frustumCulled = false` にする
- 縦長や小さな枠でも全体が入るように、`stage.viewport()` を見て全体を縮める
- `destroy` では、anime.js で動かしているオブジェクトを `utils.remove` で止めてから `stage.destroy()` を呼ぶ
- ノイズは `src/lib/glsl.js` の `snoise3`、全画面の板には `fullscreenVertex` が使える

## 確かめ方

開発用サーバーを起動してから、素材を 1 点ずつ確かめます。

```bash
npx vite --port 5190 --strictPort   # 別の端末で起動したままにする
node scripts/smoke.mjs my-effect
```

`OK` と出れば、エラーも警告も無く、片付けのあとに要素が残っていません。`test-results/smoke/` に画像が 2 枚できるので、必ず目で見てください。`my-effect.png` が個別ページの大きな枠、`my-effect-preview.png` が一覧の小さな枠です。はみ出し、文字の重なり、暗すぎる、何も映っていない、といった問題は画像を見ないと分かりません。

全素材のテストは `npm test` と `npm run e2e` です。`npm run e2e` は 15 分ほどかかるので、素材を書いている途中では使いません。

## 多軸の基準（2026-11 に追加）

立体の素材は、層を重ねるだけで終わらせません。次のどれかを必ず入れます。

- 軸の違う回転が 2 本以上ある。たとえば、水平に回る輪の上で、立った小さな輪がそれぞれ自分の軸で回る。入れ子の輪が、X・Y・Z の別々の軸で回る
- 部品どうしが連動する。歯車なら歯数の比で回転の速さが決まり、かみ合う相手は逆向きに回る
- 全体もゆっくり向きを変える。ポインターで傾くだけでなく、止めていても立体だと分かるようにする

three.js では、部品を `THREE.Group` に入れ、Group を入れ子にして、それぞれの `rotation` を別の軸で回します。CSS で作るときは `transform-style: preserve-3d` を親から子まで切らさずに続け、入れ子の要素に `rotateX` `rotateY` `rotateZ` を分けて付けます。

登場の演出でも軸を使います。輪が 1 本ずつ別の向きから回り込んで定位置に収まる、などです。

### 光る線画の部品 `src/lib/holo.js`

輪・区切り・目盛り・線を、太さのある薄い板として作る関数をまとめてあります。WebGL の線は太さが 1px 固定なので、線画はこれで作ります。どれも XY 平面に +Z 向きで作られるので、水平に寝かせるときは Group を `rotation.x = -Math.PI / 2` にします。

| 関数 | 作るもの |
|---|---|
| `ringBand(inner, outer, { start, sweep })` | 輪、または弧 |
| `segmentRing(inner, outer, count, { fill, shape })` | 区切りのある輪 |
| `circuitRing(inner, outer, count, seed)` | 回路の縁取りのような、不ぞろいな区切りの輪 |
| `tickRing(radius, count, length, width, { major })` | 目盛り |
| `strokes([[x1, y1, x2, y2], ...], width)` | 線分の集まり |
| `polygonOutline` / `starOutline` | 多角形と星形の輪郭 |
| `gridDisc(radius, cells, width)` | 円に収まる方眼 |
| `glow(color, opacity)` | 加算で光る素材 |
| `canvasTexture(w, h, draw)` | キャンバスに描いた絵のテクスチャ |
| `glyphStrip({ count, seed })` | 作りものの文字を並べた帯のテクスチャ |
| `flatBand(inner, outer)` / `wallBand(radius, height)` | 帯を巻くための平らな輪と、立った円筒 |
| `seeded(seed)` | 種から決まる乱数 |

```js
const dial = new THREE.Group();
dial.add(new THREE.Mesh(ringBand(1.9, 1.93), glow('#9fe8ff')));
dial.add(new THREE.Mesh(tickRing(1.88, 60, 0.06, 0.008, { major: { every: 5 } }), glow('#4de8ff', 0.8)));
```

### ノイズの後処理 `src/lib/postfx.js`

`createNoisePass` は、走査線、粒のざらつき、色のずれ、横方向の裂けを画面全体にかけます。`createStage` に `bloom` を渡したときだけ使えます。

```js
const stage = createStage(container, { background: '#04060c', bloom: { strength: 0.5, radius: 0.25, threshold: 0.3 } });
const noise = createNoisePass({ scan: 0.2, grain: 0.1, auto: 4 });
stage.addPass(noise.pass);
stage.onFrame((time, dt) => noise.update(time, dt));
// クリックなど、きっかけがあったときに強く乱す
noise.burst();
```

動きを減らす設定（`stage.reduced`）のときは `auto: 0` にして、`burst()` も呼ばないでください。サイバーや SF の素材に向きます。ファンシーや自然の素材には使いません。
