// クラス名・表示色・設定画面のグループ分け。
// 0〜79 は yolo11n（COCO）、80 は monkey_v6 のサル。

export const MONKEY = 80;
export const PERSON = 0;

// [英語名, 日本語名]
export const CLASSES = [
  ['person', '人'], ['bicycle', '自転車'], ['car', '車'], ['motorcycle', 'オートバイ'],
  ['airplane', '飛行機'], ['bus', 'バス'], ['train', '電車'], ['truck', 'トラック'],
  ['boat', 'ボート'], ['traffic light', '信号機'], ['fire hydrant', '消火栓'], ['stop sign', '一時停止標識'],
  ['parking meter', 'パーキングメーター'], ['bench', 'ベンチ'], ['bird', '鳥'], ['cat', '猫'],
  ['dog', '犬'], ['horse', '馬'], ['sheep', '羊'], ['cow', '牛'],
  ['elephant', '象'], ['bear', '熊'], ['zebra', 'シマウマ'], ['giraffe', 'キリン'],
  ['backpack', 'リュック'], ['umbrella', '傘'], ['handbag', 'ハンドバッグ'], ['tie', 'ネクタイ'],
  ['suitcase', 'スーツケース'], ['frisbee', 'フリスビー'], ['skis', 'スキー板'], ['snowboard', 'スノーボード'],
  ['sports ball', 'ボール'], ['kite', '凧'], ['baseball bat', 'バット'], ['baseball glove', 'グローブ'],
  ['skateboard', 'スケートボード'], ['surfboard', 'サーフボード'], ['tennis racket', 'テニスラケット'], ['bottle', 'ボトル'],
  ['wine glass', 'ワイングラス'], ['cup', 'カップ'], ['fork', 'フォーク'], ['knife', 'ナイフ'],
  ['spoon', 'スプーン'], ['bowl', 'ボウル'], ['banana', 'バナナ'], ['apple', 'りんご'],
  ['sandwich', 'サンドイッチ'], ['orange', 'オレンジ'], ['broccoli', 'ブロッコリー'], ['carrot', 'にんじん'],
  ['hot dog', 'ホットドッグ'], ['pizza', 'ピザ'], ['donut', 'ドーナツ'], ['cake', 'ケーキ'],
  ['chair', '椅子'], ['couch', 'ソファ'], ['potted plant', '鉢植え'], ['bed', 'ベッド'],
  ['dining table', 'テーブル'], ['toilet', 'トイレ'], ['tv', 'テレビ'], ['laptop', 'ノートPC'],
  ['mouse', 'マウス'], ['remote', 'リモコン'], ['keyboard', 'キーボード'], ['cell phone', '携帯電話'],
  ['microwave', '電子レンジ'], ['oven', 'オーブン'], ['toaster', 'トースター'], ['sink', 'シンク'],
  ['refrigerator', '冷蔵庫'], ['book', '本'], ['clock', '時計'], ['vase', '花瓶'],
  ['scissors', 'はさみ'], ['teddy bear', 'ぬいぐるみ'], ['hair drier', 'ドライヤー'], ['toothbrush', '歯ブラシ'],
  ['monkey', 'サル'],
];

export const NUM_CLASSES = CLASSES.length;

// ultralytics の Colors と同じ並び（クラス番号 % 20）
const PALETTE = [
  '042AFF', '0BDBEB', 'F3F3F3', '00DFB7', '111F68', 'FF6FDD', 'FF444F', 'CCED00', '00F344', 'BD00FF',
  '00B4FF', 'DD00BA', '00FFFF', '26C000', '01FFB3', '7D24FF', '7B0068', 'FF1B6C', 'FC6D2F', 'A2FF0B',
];
// ultralytics が文字を濃紺にする明るい色（それ以外は白文字）
const DARK_TEXT = new Set(['0BDBEB', 'F3F3F3', '00DFB7', 'FF6FDD', 'CCED00', '00F344', '00FFFF', '01FFB3', 'A2FF0B']);
// サルは person と同じ色（042AFF）になってしまうので、Pi と同じく赤にする
const MONKEY_COLOR = 'FF0000';

export function classColor(c) {
  return '#' + (c === MONKEY ? MONKEY_COLOR : PALETTE[c % PALETTE.length]);
}

export function textColor(c) {
  const hex = c === MONKEY ? MONKEY_COLOR : PALETTE[c % PALETTE.length];
  return DARK_TEXT.has(hex) ? '#111F68' : '#FFFFFF';
}

export function className(c) {
  return CLASSES[c][0];
}

// 設定画面の見出し（COCO の上位分類に合わせる）。サルは動物の先頭。
export const GROUPS = [
  ['人', [0]],
  ['動物', [80, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]],
  ['乗り物', [1, 2, 3, 4, 5, 6, 7, 8]],
  ['屋外', [9, 10, 11, 12, 13]],
  ['持ち物', [24, 25, 26, 27, 28]],
  ['スポーツ', [29, 30, 31, 32, 33, 34, 35, 36, 37, 38]],
  ['キッチン', [39, 40, 41, 42, 43, 44, 45]],
  ['食べ物', [46, 47, 48, 49, 50, 51, 52, 53, 54, 55]],
  ['家具', [56, 57, 58, 59, 60, 61]],
  ['電子機器', [62, 63, 64, 65, 66, 67]],
  ['家電', [68, 69, 70, 71, 72]],
  ['日用品', [73, 74, 75, 76, 77, 78, 79]],
];

// まとめ選択のボタン
export const PRESETS = [
  ['すべて', () => CLASSES.map((_, i) => i)],
  ['なし', () => []],
  ['人＋サル', () => [PERSON, MONKEY]],
  ['動物', () => GROUPS[1][1].slice()],
  ['乗り物', () => GROUPS[2][1].slice()],
];

// まとめ表示の数え方
export function counterWord(c) {
  if (c === PERSON) return '人';
  if (c === MONKEY || (c >= 14 && c <= 23)) return '匹';
  return '個';
}
