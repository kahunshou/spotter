// 枠とラベルを ultralytics（cv2 版 Annotator.box_label）と同じ見た目で描く。

import { classColor, className, textColor } from './classes.js';

// Hershey フォント（cv2）の文字の高さ ≒ 22px × 文字倍率。Arial の大文字の高さは約 0.716em。
const HERSHEY_HEIGHT = 22;
const ARIAL_CAP = 0.716;

export function lineWidth(w, h) {
  return Math.max(Math.round((w + h) / 2 * 0.003), 2);
}

// dets: [{cls, conf, x1, y1, x2, y2}]（キャンバスの座標）
export function drawDetections(ctx, dets, w, h) {
  const lw = lineWidth(w, h);
  const sf = lw / 3;
  const textH = Math.round(HERSHEY_HEIGHT * sf);
  const fontPx = Math.max(Math.round(textH / ARIAL_CAP), 10);
  ctx.save();
  ctx.lineJoin = 'miter';
  ctx.font = `${lw >= 3 ? 'bold ' : ''}${fontPx}px Arial, Helvetica, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  for (const d of dets) {
    const color = classColor(d.cls);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.strokeRect(d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1);

    const label = `${className(d.cls)} ${d.conf.toFixed(2)}`;
    const tw = Math.ceil(ctx.measureText(label).width);
    const th = textH + 3;
    let x = Math.round(d.x1);
    const y = Math.round(d.y1);
    const outside = y >= th;
    if (x > w - tw) x = w - tw;
    ctx.fillStyle = color;
    ctx.fillRect(x, outside ? y - th : y, tw, th);
    ctx.fillStyle = textColor(d.cls);
    ctx.fillText(label, x, outside ? y - 2 : y + th - 1);
  }
  ctx.restore();
}
