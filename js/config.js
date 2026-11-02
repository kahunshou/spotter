// アプリ全体の決まった値。
// APP_VERSION を上げるときは sw.js の VERSION も同じ値に上げる（iPhone 側の更新のきっかけになる）。

export const APP_VERSION = '1.0.2';

// モデルと大きな部品を入れておく保存場所（sw.js と同じ名前）。中身を差し替えたら番号を上げる。
export const BIG_CACHE = 'big-v1';

export const MODEL_SIZES = [320, 416, 640];
export const IMPORT_SIZE = 640;          // 読み込んだ写真・動画は細かく見る

export const IOU_NMS = 0.7;              // 同じクラスの重なった枠をまとめる基準（ultralytics と同じ）
export const MAX_DET = 300;
export const PERSON_FILTER_CONF = 0.25;  // この信頼度以上の「人」の枠を、サル誤検出の除外に使う
export const INSIDE_RATIO = 0.6;         // サル枠の6割以上が人の枠の中なら捨てる（Pi と同じ）
export const ANIMAL_DUP_IOU = 0.5;       // サル枠とほぼ同じ場所の COCO の動物枠（犬・熊など）は捨てる

export const MAX_EXPORT_SIDE = 1920;     // 書き出す動画の長い辺（1080p）
export const MAX_PHOTO_SIDE = 2560;      // 保存する写真の長い辺（iPhone のメモリ不足を避けるため控えめに）
export const RECORD_BITRATE = 8_000_000;
