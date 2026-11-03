// 設定の読み書き。端末のブラウザ（localStorage）に保存する。
// 保存できない環境（プライベートブラウズなど）でも初期値で動くようにする。

import { NUM_CLASSES } from './classes.js';

const KEY = 'monkey-cam-settings-v1';

const DEFAULTS = {
  selected: Array.from({ length: NUM_CLASSES }, (_, i) => i),
  conf: 0.25,
  liveSize: 320,
  showCounts: true,
  showMaskButton: true,
  maskOn: false,
  masks: { portrait: '', landscape: '' },   // 非検出エリア。映像が縦長か横長かで別々に持つ
  recordClean: false,
  backend: 'auto',       // auto / wasm / webgpu（auto は PC なら WebGPU、スマホなら WASM）
  facing: 'environment',
  videoInterval: 1,
  videoFps: 30,
};

export const settings = load();

function load() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    saved = {};
  }
  const s = { ...DEFAULTS, ...saved };
  if (!Array.isArray(s.selected)) s.selected = DEFAULTS.selected.slice();
  if (!['auto', 'wasm', 'webgpu'].includes(s.backend)) s.backend = 'auto';
  if (!s.masks || typeof s.masks !== 'object') s.masks = { portrait: '', landscape: '' };
  // 以前の版の非検出エリア（1つだけ）は、縦向き用として引き継ぐ
  if (typeof s.mask === 'string') {
    if (s.mask && !s.masks.portrait) s.masks.portrait = s.mask;
    delete s.mask;
  }
  return s;
}

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // 保存できなくてもアプリは動かす
  }
}

export function selectedSet() {
  return new Set(settings.selected);
}
