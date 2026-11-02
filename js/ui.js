// 画面まわりの共通部品：お知らせ表示、確認シート、保存、画面を消さない設定。

export const $ = (sel) => document.querySelector(sel);

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c != null) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

let toastTimer = 0;
export function toast(msg, ms = 2500) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を作れませんでした'))), type, quality);
  });
}

// スマホは共有メニュー（「画像を保存」「ビデオを保存」で写真アプリへ）、PC はダウンロード
const isTouch = matchMedia('(pointer: coarse)').matches;

export async function saveFiles(files) {
  if (isTouch && navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files });
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
      if (e.name !== 'NotAllowedError') throw e;
      // 操作から時間がたって共有できなかったときはダウンロードに切り替える
    }
  }
  for (const f of files) {
    const a = el('a', { href: URL.createObjectURL(f), download: f.name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }
  return true;
}

// 撮影・書き出しの結果を見せて「保存」できるシート
export function showSheet({ title, media, files, note }) {
  const sheet = $('#sheet');
  const body = $('#sheetBody');
  $('#sheetTitle').textContent = title;
  body.replaceChildren(media);
  if (note) body.append(el('p', { class: 'sheet-note' }, note));
  sheet.hidden = false;
  return new Promise((resolve) => {
    const close = () => {
      sheet.hidden = true;
      if (media.src && media.src.startsWith('blob:')) URL.revokeObjectURL(media.src);
      body.replaceChildren();
      $('#sheetSave').onclick = null;
      $('#sheetClose').onclick = null;
      resolve();
    };
    $('#sheetSave').onclick = async () => {
      try {
        if (await saveFiles(files)) toast('保存しました');
      } catch (e) {
        toast(`保存できませんでした：${e.message}`, 4000);
      }
    };
    $('#sheetClose').onclick = close;
  });
}

// 画面を消さない（使っている理由ごとに数え、全部終わったら解除する）
const wakeReasons = new Set();
let wakeLock = null;

async function updateWakeLock() {
  if (!('wakeLock' in navigator)) return;
  if (wakeReasons.size && document.visibilityState === 'visible') {
    if (!wakeLock) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } catch {
        wakeLock = null;
      }
    }
  } else if (wakeLock) {
    const w = wakeLock;
    wakeLock = null;
    w.release().catch(() => {});
  }
}

export function keepAwake(reason, on) {
  if (on) wakeReasons.add(reason);
  else wakeReasons.delete(reason);
  updateWakeLock();
}

document.addEventListener('visibilitychange', updateWakeLock);
