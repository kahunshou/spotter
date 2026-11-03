// 画面の操作をまとめる入口。

import { MONKEY } from './classes.js';
import { IMPORT_SIZE } from './config.js';
import { LiveCamera } from './camera.js';
import { Detector } from './detector.js';
import { Mask } from './mask.js';
import { offlineStatus, prepareOffline, registerServiceWorker } from './offline.js';
import { countChips, openPhotoScreen } from './photo.js';
import { saveSettings, selectedSet, settings } from './settings.js';
import { renderSettings } from './settings_ui.js';
import { Tilt } from './tilt.js';
import { $, el, formatTime, keepAwake, showSheet, stamp, toast } from './ui.js';
import { openVideoScreen } from './video.js';

const detector = new Detector();
const mask = new Mask();     // 今の向き（maskKey）の非検出エリア
let maskKey = null;
const cam = new LiveCamera(detector, {
  stage: $('#stage'), video: $('#video'), view: $('#view'), overlay: $('#overlay'),
});

let selected = selectedSet();
let started = false;
let screenOpen = false;     // 写真・動画の画面を開いているあいだはカメラを止める
let maskEditing = false;
let maskErase = false;
let recTimer = 0;

const maskActive = () => settings.maskOn && !mask.isEmpty();

// 何をしている途中かを端末に書いておく。iPhone がメモリ不足でアプリを終わらせると消されずに残るので、
// 次に開いたときに知らせられる。
const ACTIVITY_KEY = 'spotter-activity';
let activity = '';
function setActivity(name) {
  activity = name;
  markStored(name);
}
function markStored(name) {
  try {
    if (name) localStorage.setItem(ACTIVITY_KEY, name);
    else localStorage.removeItem(ACTIVITY_KEY);
  } catch {
    // 保存できなくても動かす
  }
}
function reportLastExit() {
  let last = null;
  try {
    last = localStorage.getItem(ACTIVITY_KEY);
  } catch {
    last = null;
  }
  if (last) {
    toast(`前回は「${last}」の途中でアプリが終了しました（メモリ不足の可能性）。重いときは設定でライブ検出のサイズを 320 にしてください。`, 8000);
    markStored('');
  }
}

function liveOptions() {
  return { conf: settings.conf, selected, maskTest: maskActive() ? (x, y) => mask.has(x, y) : null };
}

function importOptions() {
  return { conf: settings.conf, selected, maskTest: null };
}

cam.getOptions = liveOptions;
cam.getSize = () => settings.liveSize;
cam.onDetections = (dets, st) => {
  if (settings.showCounts) $('#counts').replaceChildren(...(dets.length ? countChips(dets) : []));
  $('#status').textContent = `${settings.liveSize}・${st.fps.toFixed(1)} fps・${detector.backend}`;
};
cam.onError = (e) => toast(`検出でエラー：${e.message}`, 4000);

// 非検出エリアは縦向き用と横向き用を別々に持ち、映像の向きが変わったら入れ替える
function saveMask() {
  if (!maskKey) return;
  settings.masks[maskKey] = mask.serialize();
  saveSettings();
}
cam.onOrientation = (key) => {
  if (maskEditing) saveMask();   // 描いている途中で回したときも、それまでの分は残す
  maskKey = key;
  mask.load(settings.masks[key]);
  applyVisibility();
};
// 読み込んだ動画に使う非検出エリア（動画の向きに合うほう）
function maskFor(key) {
  if (key === maskKey) return mask;
  const m = new Mask();
  m.load(settings.masks[key]);
  return m;
}
cam.drawOverlayContent = (ctx, r) => {
  if (maskEditing || settings.maskOn) {
    mask.draw(ctx, r.x, r.y, r.w, r.h, maskEditing ? 'rgba(255,48,48,0.45)' : 'rgba(255,48,48,0.2)');
  }
};

function applyVisibility() {
  $('#counts').hidden = !settings.showCounts;
  $('#maskButtons').hidden = !settings.showMaskButton || maskEditing;
  $('#maskToggle').classList.toggle('on', settings.maskOn);
  $('#maskToggle').setAttribute('aria-pressed', String(settings.maskOn));
  cam.overlayDirty = true;
}

// ---- 画面の向きのロック中に横に持ったとき ----
// 映像を回して横長で検出・保存し、ボタンのアイコンだけを持っている人から見てまっすぐに回す。
// 録画中は向きを変えず、終わってから合わせる。
const tilt = new Tilt(() => applyRotation());
function applyRotation() {
  const rot = settings.autoRotate ? tilt.rot : 0;
  if (cam.recording) return;
  cam.setRotation(rot);
  document.documentElement.style.setProperty('--ui-rot', `${rot}deg`);
}

function updateZoomLabel() {
  $('#zoomLabel').textContent = `${cam.zoom.toFixed(1)}x`;
}

async function startCamera() {
  try {
    await cam.start(settings.facing);
    keepAwake('camera', true);
    updateZoomLabel();
    setActivity('ライブ検出');
  } catch (e) {
    keepAwake('camera', false);
    const msg = e.name === 'NotAllowedError'
      ? 'カメラの使用が許可されていません。iPhone の「設定」→「Safari」→「カメラ」で許可してください。'
      : `カメラを起動できません：${e.message}`;
    toast(msg, 6000);
    throw e;
  }
}

function stopCamera() {
  cam.stop();
  keepAwake('camera', false);
}

// ---- 開始画面 ----
$('#startBtn').addEventListener('click', async () => {
  const btn = $('#startBtn');
  const msg = $('#startMsg');
  btn.disabled = true;
  // 傾きセンサーの許可は、ボタンを押したこの瞬間に求める必要がある（iPhone）
  tilt.requestPermission().then((ok) => { if (ok) tilt.start(); });
  try {
    msg.textContent = '準備中…';
    await detector.init(settings.backend);
    const progress = (label) => (p) => { msg.textContent = `${label}を読み込み中… ${Math.round(p * 100)}%`; };
    await detector.session('yolo11n', settings.liveSize, progress('モデル（1/2）'));
    await detector.session('monkey_v6', settings.liveSize, progress('モデル（2/2）'));
    msg.textContent = 'カメラを起動中…';
    await startCamera();
    started = true;
    $('#start').hidden = true;
    applyVisibility();
    // 使い始めてから、オフライン用のファイルを裏で保存する
    setTimeout(() => prepareOffline(detector), 3000);
  } catch (e) {
    msg.textContent = `開始できませんでした：${e.message}`;
    btn.disabled = false;
  }
});

// ---- ズーム（2本指で広げる・縮める。PC はマウスホイール） ----
let pinch = null;
$('#stage').addEventListener('touchstart', (e) => {
  if (e.touches.length === 2 && !maskEditing) {
    const [a, b] = e.touches;
    pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: cam.zoom };
  }
}, { passive: true });
$('#stage').addEventListener('touchmove', (e) => {
  if (pinch && e.touches.length === 2) {
    const [a, b] = e.touches;
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    cam.setZoom(pinch.z * d / pinch.d);
    updateZoomLabel();
    e.preventDefault();
  }
}, { passive: false });
$('#stage').addEventListener('touchend', (e) => {
  if (e.touches.length < 2) pinch = null;
});
$('#stage').addEventListener('wheel', (e) => {
  if (maskEditing) return;
  cam.setZoom(cam.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  updateZoomLabel();
  e.preventDefault();
}, { passive: false });
$('#zoomLabel').addEventListener('click', () => {
  cam.setZoom(Math.max(1, cam.zoomRange()[0]));
  updateZoomLabel();
});

// ---- 静止画 ----
$('#shutterBtn').addEventListener('click', async () => {
  if (!cam.isLive()) return;
  const flash = $('#flash');
  flash.hidden = false;
  setTimeout(() => { flash.hidden = true; }, 120);
  try {
    const { raw, boxed } = await cam.capture();
    const t = stamp();
    const files = [
      new File([boxed], `yolo_${t}_box.jpg`, { type: 'image/jpeg' }),
      new File([raw], `yolo_${t}.jpg`, { type: 'image/jpeg' }),
    ];
    showSheet({
      title: '静止画',
      media: el('img', { src: URL.createObjectURL(boxed), alt: '撮影した写真' }),
      files,
      note: '枠あり・枠なしの2枚を保存します。',
    });
  } catch (e) {
    toast(`撮影できませんでした：${e.message}`, 4000);
  }
});

// ---- 録画 ----
async function finishRecording() {
  clearInterval(recTimer);
  $('#recordBtn').classList.remove('on');
  $('#recTime').hidden = true;
  const r = await cam.stopRecording();
  applyRotation();   // 録画中に持ち方が変わっていたら、ここで合わせる
  if (!r) return;
  const t = stamp();
  const ext = r.boxed.type.includes('mp4') ? 'mp4' : 'webm';
  const files = [new File([r.boxed], `yolo_${t}_box.${ext}`, { type: r.boxed.type })];
  if (r.clean) files.push(new File([r.clean], `yolo_${t}.${ext}`, { type: r.clean.type }));
  showSheet({
    title: '録画',
    media: el('video', { src: URL.createObjectURL(r.boxed), controls: true, playsinline: true }),
    files,
    note: r.clean ? '枠あり・枠なしの2本を保存します。' : null,
  });
}

$('#recordBtn').addEventListener('click', async () => {
  if (cam.recording) {
    await finishRecording();
    return;
  }
  if (!cam.isLive()) return;
  try {
    cam.startRecording(settings.recordClean);
  } catch (e) {
    toast(e.message, 4000);
    return;
  }
  $('#recordBtn').classList.add('on');
  const rt = $('#recTime');
  rt.hidden = false;
  rt.textContent = '0:00';
  recTimer = setInterval(() => {
    if (cam.recording) rt.textContent = formatTime((Date.now() - cam.recording.started) / 1000);
  }, 500);
});

// ---- 前後カメラの切り替え ----
$('#flipBtn').addEventListener('click', async () => {
  if (cam.recording) {
    toast('録画中は切り替えできません');
    return;
  }
  settings.facing = settings.facing === 'environment' ? 'user' : 'environment';
  saveSettings();
  try {
    await startCamera();
  } catch {
    // startCamera がメッセージを出している
  }
});

// ---- 写真・動画の読み込み ----
// メニューを開いているあいだは透明な覆いを敷き、メニューの外を押したら閉じる
function setImportMenu(open) {
  $('#importMenu').hidden = !open;
  $('#importBackdrop').hidden = !open;
}

$('#importBtn').addEventListener('click', () => {
  if (cam.recording) {
    toast('録画中は読み込みできません');
    return;
  }
  setImportMenu(true);
});
$('#importBackdrop').addEventListener('click', () => setImportMenu(false));
$('#importPhoto').addEventListener('click', () => {
  setImportMenu(false);
  $('#photoInput').click();
});
$('#importVideo').addEventListener('click', () => {
  setImportMenu(false);
  $('#videoInput').click();
});

// 写真・動画の画面とライブでは使うサイズが違うので、使わないほうのモデルを片付けてから切り替える
function openImportScreen(name) {
  screenOpen = true;
  stopCamera();
  setActivity(name);
  detector.release([IMPORT_SIZE]);
}

async function resumeCamera() {
  screenOpen = false;
  setActivity('');
  detector.release([settings.liveSize]);
  try {
    await startCamera();
  } catch {
    // startCamera がメッセージを出している
  }
}

$('#photoInput').addEventListener('change', (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  openImportScreen('写真の読み込み');
  openPhotoScreen(files, { detector, getOptions: importOptions, onClose: resumeCamera });
});
$('#videoInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  openImportScreen('動画の読み込み');
  openVideoScreen(file, { detector, getOptions: importOptions, maskFor, onClose: resumeCamera });
});

// ---- 非検出エリア ----
function setMaskEditing(on) {
  maskEditing = on;
  $('#maskBar').hidden = !on;
  $('#bottombar').hidden = on;
  $('#zoomLabel').hidden = on;
  $('#overlay').classList.toggle('editing', on);
  if (!on) {
    if (!mask.isEmpty()) settings.maskOn = true;
    saveMask();
  }
  applyVisibility();
}

function setMaskTool(erase) {
  maskErase = erase;
  $('#maskPaint').classList.toggle('on', !erase);
  $('#maskErase').classList.toggle('on', erase);
}

$('#maskToggle').addEventListener('click', () => {
  if (!settings.maskOn && mask.isEmpty()) {
    setMaskTool(false);
    setMaskEditing(true);
    toast('検出しない範囲を指でなぞってください');
    return;
  }
  settings.maskOn = !settings.maskOn;
  saveSettings();
  applyVisibility();
  toast(settings.maskOn ? '非検出エリア：ON' : '非検出エリア：OFF');
});
$('#maskEdit').addEventListener('click', () => {
  setMaskTool(false);
  setMaskEditing(true);
});
$('#maskPaint').addEventListener('click', () => setMaskTool(false));
$('#maskErase').addEventListener('click', () => setMaskTool(true));
$('#maskClear').addEventListener('click', () => {
  mask.clear();
  cam.overlayDirty = true;
});
$('#maskDone').addEventListener('click', () => setMaskEditing(false));

const overlay = $('#overlay');
// 指の位置を、回して表示しているキャンバスの中の位置に直す
function pointInOverlay(e) {
  const b = overlay.getBoundingClientRect();
  const dx = e.clientX - (b.left + b.width / 2);
  const dy = e.clientY - (b.top + b.height / 2);
  const a = cam.rot * Math.PI / 180;
  return {
    x: dx * Math.cos(a) + dy * Math.sin(a) + overlay.clientWidth / 2,
    y: -dx * Math.sin(a) + dy * Math.cos(a) + overlay.clientHeight / 2,
  };
}

function paintAt(e) {
  const r = cam.contentRect();
  const sc = overlay.clientWidth / cam.view.width;
  const radius = Math.min(r.w, r.h) * sc * 0.06;
  const p = pointInOverlay(e);
  mask.paint(p.x - r.x * sc, p.y - r.y * sc, radius, r.w * sc, r.h * sc, !maskErase);
  cam.overlayDirty = true;
}
overlay.addEventListener('pointerdown', (e) => {
  if (!maskEditing) return;
  overlay.setPointerCapture(e.pointerId);
  paintAt(e);
});
overlay.addEventListener('pointermove', (e) => {
  if (maskEditing && e.buttons) paintAt(e);
});

// ---- 設定 ----
function onSettingChange(key) {
  if (key === 'selected') {
    selected = selectedSet();
    if (selected.has(MONKEY)) detector.session('monkey_v6', settings.liveSize).catch(() => {});
  } else if (key === 'liveSize') {
    detector.release([settings.liveSize]);
    toast('サイズを変更しました（切り替えに数秒かかります）');
  } else if (key === 'backend') {
    toast('アプリを開き直すと反映されます');
  } else if (key === 'autoRotate') {
    applyRotation();
  }
  applyVisibility();
}

$('#settingsBtn').addEventListener('click', async () => {
  const info = started ? await offlineStatus(detector) : { ready: false, text: '開始後に確認できます' };
  renderSettings({
    onChange: onSettingChange,
    detector,
    offlineInfo: info,
    onPrepareOffline: (cb) => (started ? prepareOffline(detector, cb) : cb('開始後に保存できます', false)),
  });
  $('#settings').hidden = false;
});
$('#settingsClose').addEventListener('click', () => {
  $('#settings').hidden = true;
});

// ---- 使い方 ----
for (const id of ['#helpBtn', '#startHelp']) {
  $(id).addEventListener('click', () => {
    $('#help').hidden = false;
    $('#help .screen-body').scrollTop = 0;
  });
}
$('#helpClose').addEventListener('click', () => {
  $('#help').hidden = true;
});

// ---- アプリを切り替えたとき ----
// 自分で閉じたり別のアプリに切り替えたりしたときは「途中で終了」の記録を消す
document.addEventListener('visibilitychange', () => {
  markStored(document.visibilityState === 'hidden' ? '' : activity);
});
window.addEventListener('pagehide', () => markStored(''));

document.addEventListener('visibilitychange', async () => {
  if (!started || screenOpen) return;
  if (document.visibilityState === 'hidden') {
    if (cam.recording) await finishRecording();
  } else if (!cam.isLive()) {
    try {
      await startCamera();
    } catch {
      // startCamera がメッセージを出している
    }
  }
});

registerServiceWorker();
applyVisibility();
reportLastExit();

if (new URLSearchParams(location.search).has('selftest')) {
  import('../dev/selftest.js').then((m) => m.run({ detector, cam, mask, settings }));
}
