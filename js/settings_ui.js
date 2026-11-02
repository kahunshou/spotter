// 設定画面。変更はすぐ保存し、onChange(項目名) で main.js に知らせる。

import { CLASSES, GROUPS, PRESETS, classColor } from './classes.js';
import { APP_VERSION, MODEL_SIZES } from './config.js';
import { saveSettings, settings } from './settings.js';
import { $, el } from './ui.js';

function toggleRow(label, key, onChange, note) {
  const input = el('input', { type: 'checkbox', class: 'switch' });
  input.checked = !!settings[key];
  input.addEventListener('change', () => {
    settings[key] = input.checked;
    saveSettings();
    onChange(key);
  });
  return el('label', { class: 'row' },
    el('span', { class: 'row-text' }, label, note ? el('small', {}, note) : null), input);
}

function segmented(options, current, onPick) {
  const wrap = el('div', { class: 'segmented' });
  for (const [value, label] of options) {
    const b = el('button', { type: 'button', class: value === current ? 'on' : '' }, label);
    b.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      onPick(value);
    });
    wrap.append(b);
  }
  return wrap;
}

function classSection(onChange) {
  const selected = new Set(settings.selected);
  const countLabel = el('span', { class: 'count' });
  const boxes = new Map();
  const commit = () => {
    settings.selected = [...selected].sort((a, b) => a - b);
    saveSettings();
    countLabel.textContent = `${selected.size} / ${CLASSES.length} 選択中`;
    onChange('selected');
  };

  const list = el('div', { class: 'class-list' });
  for (const [title, ids] of GROUPS) {
    const group = el('div', { class: 'class-group' }, el('h4', {}, title));
    for (const id of ids) {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = selected.has(id);
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(id);
        else selected.delete(id);
        commit();
      });
      boxes.set(id, cb);
      const [en, ja] = CLASSES[id];
      group.append(el('label', { class: 'class-item', 'data-search': `${en} ${ja}`.toLowerCase() },
        cb, el('span', { class: 'swatch', style: `background:${classColor(id)}` }), `${en}（${ja}）`));
    }
    list.append(group);
  }

  const presets = el('div', { class: 'presets' });
  for (const [label, ids] of PRESETS) {
    presets.append(el('button', {
      type: 'button',
      onclick: () => {
        selected.clear();
        ids().forEach((i) => selected.add(i));
        boxes.forEach((cb, id) => { cb.checked = selected.has(id); });
        commit();
      },
    }, label));
  }

  const search = el('input', { type: 'search', placeholder: '検索（例：dog、犬）', class: 'search' });
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    list.querySelectorAll('.class-item').forEach((item) => {
      item.hidden = q !== '' && !item.dataset.search.includes(q);
    });
    list.querySelectorAll('.class-group').forEach((g) => {
      g.hidden = [...g.querySelectorAll('.class-item')].every((i) => i.hidden);
    });
  });

  countLabel.textContent = `${selected.size} / ${CLASSES.length} 選択中`;
  return el('section', {},
    el('h3', {}, '検出するもの ', countLabel), presets, search, list);
}

let currentTab = 'classes';   // 開き直したときも前に見ていたタブを出す

export function renderSettings({ onChange, detector, offlineInfo, onPrepareOffline }) {
  const body = $('#settingsBody');
  body.replaceChildren();

  const confValue = el('span', { class: 'value' }, settings.conf.toFixed(2));
  const conf = el('input', { type: 'range', min: '0.05', max: '0.95', step: '0.05', value: String(settings.conf) });
  conf.addEventListener('input', () => {
    settings.conf = Number(conf.value);
    confValue.textContent = settings.conf.toFixed(2);
    saveSettings();
    onChange('conf');
  });

  const sizeSeg = segmented(MODEL_SIZES.map((s) => [s, String(s)]), settings.liveSize, (v) => {
    settings.liveSize = v;
    saveSettings();
    onChange('liveSize');
  });

  const backendSeg = segmented([['wasm', 'WASM（おすすめ）'], ['webgpu', 'WebGPU']], settings.backend, (v) => {
    settings.backend = v;
    saveSettings();
    onChange('backend');
  });

  const offlineText = el('span', { class: 'value' }, offlineInfo.text);
  const offlineBtn = el('button', { type: 'button', class: 'small' }, '今すぐ保存');
  offlineBtn.hidden = offlineInfo.ready;
  offlineBtn.addEventListener('click', () => onPrepareOffline((t, ready) => {
    offlineText.textContent = t;
    offlineBtn.hidden = ready;
  }));

  const classesPane = el('div', {}, classSection(onChange));
  const otherPane = el('div', {},
    el('section', {},
      el('h3', {}, 'しきい値 ', confValue),
      el('p', { class: 'hint' }, 'この値より信頼度が低い枠は表示しません。下げると見逃しが減り、誤検出が増えます。'),
      conf),
    el('section', {},
      el('h3', {}, 'ライブ検出のサイズ'),
      el('p', { class: 'hint' }, '大きいほど遠くの小さいものを見つけやすくなりますが、遅くなります。読み込んだ写真・動画は常に 640 で検出します。'),
      sizeSeg),
    el('section', {},
      el('h3', {}, '表示と保存'),
      toggleRow('検出数を表示', 'showCounts', onChange),
      toggleRow('非検出エリアのボタンを表示', 'showMaskButton', onChange),
      toggleRow('録画時に枠なし動画も保存', 'recordClean', onChange, '2本同時に録画するため少し重くなります')),
    el('section', {},
      el('h3', {}, 'オフライン'),
      el('div', { class: 'row' }, el('span', { class: 'row-text' }, 'オフライン用データ'), offlineText, offlineBtn),
      el('p', { class: 'hint' }, 'ホーム画面に追加したアプリで一度ネットにつないで開くと保存されます（約90MB、Wi-Fi 推奨）。')),
    el('section', {},
      el('h3', {}, '計算方式（詳細）'),
      el('p', { class: 'hint' }, `現在：${detector.backend || '—'}（スレッド ${detector.threads}）。WASM は安定して動きます。WebGPU は端末によっては速くなりますが、iPhone では落ちやすいことがあります。変更はアプリを開き直すと反映されます。`),
      backendSeg),
    el('section', { class: 'about' },
      el('h3', {}, 'このアプリについて'),
      el('p', {}, `Spotter v${APP_VERSION}`),
      el('p', {}, '写真・動画はこの端末の中だけで処理し、どこにも送信しません。'),
      el('p', {}, '物体検出：Ultralytics YOLO11n（AGPL-3.0）。サル：独自学習モデル v6（学習データの一部に Open Images Dataset を使用。注釈 CC BY 4.0、画像 CC BY 2.0）。'),
      el('p', {}, '使用ライブラリ：onnxruntime-web（MIT）、mp4-muxer（MIT）。このアプリ自体も AGPL-3.0 で公開しています。')),
  );

  // タブ：「検出するもの」と「その他の設定」を分けて表示する
  const show = (tab) => {
    currentTab = tab;
    classesPane.hidden = tab !== 'classes';
    otherPane.hidden = tab !== 'other';
    body.scrollTop = 0;
  };
  const tabs = segmented([['classes', '検出するもの'], ['other', 'その他の設定']], currentTab, show);
  tabs.classList.add('tabs');
  body.append(tabs, classesPane, otherPane);
  show(currentTab);
}
