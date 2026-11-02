// 写真の読み込み：選んだ写真を順番に 640 で検出し、枠ありの画像を作る。

import { CLASSES, classColor, textColor } from './classes.js';
import { IMPORT_SIZE, MAX_PHOTO_SIDE } from './config.js';
import { drawDetections } from './draw.js';
import { $, canvasToBlob, el, keepAwake, saveFiles, showSheet, toast } from './ui.js';

function baseName(name) {
  return name.replace(/\.[^.]+$/, '') || 'photo';
}

export function countChips(dets) {
  const counts = new Map();
  for (const d of dets) counts.set(d.cls, (counts.get(d.cls) || 0) + 1);
  if (!counts.size) return [el('span', { class: 'none' }, '検出なし')];
  return [...counts].sort((a, b) => b[1] - a[1]).map(([cls, n]) =>
    el('span', { class: 'chip', style: `--c:${classColor(cls)};--t:${textColor(cls)}` }, `${CLASSES[cls][0]} ${n}`));
}

export async function openPhotoScreen(files, { detector, getOptions, onClose }) {
  const screen = $('#photoScreen');
  const grid = el('div', { class: 'photo-grid' });
  const progress = el('p', { class: 'progress-text' });
  const saveAll = el('button', { type: 'button', class: 'primary', disabled: true }, 'すべて保存');
  const results = [];
  let closed = false;

  const close = () => {
    closed = true;
    keepAwake('photo', false);
    for (const r of results) URL.revokeObjectURL(r.url);
    screen.hidden = true;
    screen.replaceChildren();
    onClose();
  };

  screen.replaceChildren(
    el('header', { class: 'screen-head' },
      el('button', { type: 'button', class: 'back', onclick: close }, '閉じる'),
      el('h2', {}, `写真の検出（${files.length}枚）`),
      saveAll),
    el('div', { class: 'screen-body' }, progress, grid),
  );
  screen.hidden = false;
  keepAwake('photo', true);

  saveAll.addEventListener('click', async () => {
    try {
      if (await saveFiles(results.map((r) => r.file))) toast('保存しました');
    } catch (e) {
      toast(`保存できませんでした：${e.message}`, 4000);
    }
  });

  const opts = { ...getOptions(), maskTest: null };
  for (let i = 0; i < files.length && !closed; i++) {
    const f = files[i];
    progress.textContent = `検出中… ${i + 1} / ${files.length}`;
    try {
      const bmp = await createImageBitmap(f);
      const s = Math.min(1, MAX_PHOTO_SIDE / Math.max(bmp.width, bmp.height));
      const W = Math.round(bmp.width * s);
      const H = Math.round(bmp.height * s);
      const { dets } = await detector.detect(bmp, { x: 0, y: 0, w: bmp.width, h: bmp.height }, IMPORT_SIZE, opts);
      const c = el('canvas', { width: W, height: H });
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0, W, H);
      bmp.close();
      const scaled = dets.map((d) => ({ ...d, x1: d.x1 * s, y1: d.y1 * s, x2: d.x2 * s, y2: d.y2 * s }));
      drawDetections(ctx, scaled, W, H);
      const blob = await canvasToBlob(c);
      if (closed) break;
      const file = new File([blob], `${baseName(f.name)}_box.jpg`, { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      results.push({ file, url });
      const tile = el('button', { type: 'button', class: 'photo-tile' },
        el('img', { src: url, alt: f.name }),
        el('div', { class: 'chips' }, countChips(dets)));
      tile.addEventListener('click', () => showSheet({
        title: f.name,
        media: el('img', { src: URL.createObjectURL(blob), alt: f.name }),
        files: [file],
      }));
      grid.append(tile);
    } catch (e) {
      grid.append(el('div', { class: 'photo-tile error' }, `${f.name}：読み込めませんでした（${e.message}）`));
    }
  }
  if (!closed) {
    progress.textContent = `完了：${results.length} / ${files.length} 枚。写真をタップすると大きく表示します。`;
    saveAll.disabled = results.length === 0;
    keepAwake('photo', false);
  }
}
