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
  mask: '',
  recordClean: false,
  backend: 'wasm',       // wasm / webgpu（iPhone の WebGPU は落ちやすいので WASM を基本にする）
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
  if (s.backend !== 'webgpu') s.backend = 'wasm';   // 以前の「自動」は WASM にする
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
