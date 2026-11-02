// オフライン対応：Service Worker の登録と、モデルなど大きなファイルの保存。

import { BIG_CACHE, MODEL_SIZES } from './config.js';
import { toast } from './ui.js';

const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname);

// 開発中（PC の localhost）は古い画面が残らないよう、?sw=1 を付けたときだけ登録する
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (isLocalDev && !new URLSearchParams(location.search).has('sw')) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('新しいバージョンを取り込みました。開き直すと反映されます。', 5000);
  });
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

export function bigFiles(detector) {
  return [
    ...MODEL_SIZES.flatMap((s) => [`models/yolo11n_${s}.onnx`, `models/monkey_v6_${s}.onnx`]),
    detector.gpu ? 'vendor/ort-wasm-simd-threaded.asyncify.wasm' : 'vendor/ort-wasm-simd-threaded.wasm',
  ];
}

export async function offlineStatus(detector) {
  const files = bigFiles(detector);
  let have = 0;
  try {
    const cache = await caches.open(BIG_CACHE);
    for (const f of files) if (await cache.match(f)) have++;
  } catch {
    return { ready: false, text: 'この環境では使えません' };
  }
  const shell = !!navigator.serviceWorker?.controller;
  const ready = have === files.length && shell;
  let text = ready ? '準備完了' : `保存済み ${have} / ${files.length}`;
  if (!shell && have === files.length) text = 'あと少し（開き直すと完了）';
  return { ready, text };
}

let preparing = null;

// まだ保存していないファイルを1つずつダウンロードして保存する
export function prepareOffline(detector, onProgress = () => {}) {
  if (preparing) return preparing;
  preparing = (async () => {
    const files = bigFiles(detector);
    try {
      const cache = await caches.open(BIG_CACHE);
      for (let i = 0; i < files.length; i++) {
        if (!(await cache.match(files[i]))) {
          onProgress(`保存中 ${i + 1} / ${files.length}`, false);
          await cache.add(files[i]);
        }
      }
    } catch (e) {
      onProgress(`保存できませんでした（${e.message}）`, false);
      return;
    } finally {
      preparing = null;
    }
    const st = await offlineStatus(detector);
    onProgress(st.text, st.ready);
  })();
  return preparing;
}
