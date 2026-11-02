# Spotter

iPhone などのブラウザで動く物体検出アプリ（PWA）です。
YOLO11n の 80 種類（COCO）に、独自に学習したサルのモデル（v6）を加えて検出します。

- カメラのライブ検出（前後カメラの切り替え、ピンチでズーム）
- 枠付きの静止画・動画の保存（静止画は枠なしも一緒に保存）
- 写真・動画の読み込み（動画は1コマずつ検出して書き出し、出現タイムラインとまとめ付き）
- 非検出エリア、検出するクラスの選択、しきい値、ライブ検出のサイズ（320 / 416 / 640）
- ホーム画面に追加すればオフラインでも使える

写真・動画はすべて端末の中で処理し、どこにも送信しません。

## 使い方（iPhone）

1. Safari で公開ページを開く
2. 共有ボタン →「ホーム画面に追加」
3. ホーム画面のアイコンから開き、ネットにつながった状態で一度「カメラを開始」する
   （モデルなど約 90MB を保存。Wi-Fi 推奨）
4. 設定画面の「オフライン用データ」が「準備完了」になれば、圏外でも使える

## フォルダ

| 場所 | 中身 |
|---|---|
| `index.html`, `css/`, `js/` | アプリ本体 |
| `sw.js`, `manifest.webmanifest`, `icons/` | オフライン対応とホーム画面用 |
| `models/` | ONNX モデル（yolo11n と monkey_v6、各サイズ） |
| `vendor/` | onnxruntime-web 1.30.0、mp4-muxer 5.2.2 |
| `dev/` | PC での確認用（`serve.py` で起動、自動テスト、OpenCV との答え合わせ） |

## 更新するとき

- `js/config.js` の `APP_VERSION` と `sw.js` の `VERSION` を同じ値に上げる
  （iPhone 側は、次にネットにつながって開いたときに新しい版を取り込む）
- モデルを差し替えたときは、`BIG_CACHE` の番号も両方のファイルで上げる

## PC での確認

```
python dev/serve.py
```

ブラウザで http://localhost:8765/ を開く。

## ライセンスとクレジット

- このアプリ：AGPL-3.0（`LICENSE`）
- 物体検出：[Ultralytics YOLO11](https://github.com/ultralytics/ultralytics)（AGPL-3.0）
- サルのモデル v6：YOLO11n をもとに独自に学習。学習データの一部に
  [Open Images Dataset](https://storage.googleapis.com/openimages/web/index.html) を使用
  （注釈 CC BY 4.0、画像 CC BY 2.0）
- [onnxruntime-web](https://github.com/microsoft/onnxruntime)（MIT、`vendor/LICENSE-onnxruntime-web.txt`）
- [mp4-muxer](https://github.com/Vanilagy/mp4-muxer)（MIT、`vendor/LICENSE-mp4-muxer.txt`）
