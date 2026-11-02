// 動画の読み込み：1コマずつ位置を合わせて検出し、枠付きの MP4（音声なし）を書き出す。
// 書き出しには WebCodecs（VideoEncoder）と mp4-muxer を使う。

import { CLASSES, MONKEY, classColor, counterWord, textColor } from './classes.js';
import { IMPORT_SIZE, MAX_EXPORT_SIDE } from './config.js';
import { drawDetections } from './draw.js';
import { saveSettings, settings } from './settings.js';
import { $, el, formatTime, keepAwake, saveFiles, toast } from './ui.js';

const MERGE_GAP_SEC = 1.0;   // これより短い途切れは、同じ「映っていた時間帯」としてまとめる
const MAX_INTERVALS_SHOWN = 8;

function even(n) {
  return Math.max(2, Math.round(n / 2) * 2);
}

function waitEvent(target, name) {
  return new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const ng = () => { cleanup(); reject(new Error('動画を読み込めません（対応していない形式の可能性）')); };
    const cleanup = () => {
      target.removeEventListener(name, ok);
      target.removeEventListener('error', ng);
    };
    target.addEventListener(name, ok);
    target.addEventListener('error', ng);
  });
}

function withTimeout(promise, ms, message) {
  let timer = 0;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

// 同じ位置でも必ず位置合わせをする（読み込み直後は 0 秒のコマがまだ描けないことがある）
async function seek(video, t) {
  const p = waitEvent(video, 'seeked');
  video.currentTime = t;
  await p;
}

// iPhone は指示するまで動画の中身を読み込まないので、自分で読み込みを始めて最初のコマを用意する
async function loadVideo(video, url) {
  const meta = waitEvent(video, 'loadedmetadata');
  video.src = url;
  video.load();
  await withTimeout(meta, 15000, '動画を読み込めませんでした（対応していない形式か、ファイルが大きすぎる可能性があります）');
  try {
    await withTimeout(seek(video, 0.001), 5000, 'seek');
  } catch {
    // 位置合わせで反応がないときは、音なしで一瞬再生して最初のコマを出す
    await video.play();
    video.pause();
    await withTimeout(seek(video, 0.001), 10000, '動画の最初のコマを読み込めませんでした');
  }
}

async function pickEncoderConfig(width, height, fps) {
  const bitrate = Math.round(Math.min(12e6, Math.max(2e6, width * height * fps * 0.1)));
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.42001f']) {
    const config = { codec, width, height, bitrate, framerate: fps };
    try {
      const r = await VideoEncoder.isConfigSupported(config);
      if (r.supported) return r.config;
    } catch {
      // 次の候補を試す
    }
  }
  return null;
}

// 1コマごとの数から「映っていた時間帯」などをまとめる
export function summarize(perClass, nFrames, fps) {
  const gap = Math.round(MERGE_GAP_SEC * fps);
  const rows = [];
  for (const [cls, counts] of perClass) {
    let present = 0;
    let max = 0;
    const intervals = [];
    let start = -1;
    let last = -1;
    for (let i = 0; i < nFrames; i++) {
      if (!counts[i]) continue;
      present++;
      max = Math.max(max, counts[i]);
      if (start < 0) start = i;
      else if (i - last > gap) {
        intervals.push([start, last]);
        start = i;
      }
      last = i;
    }
    if (start >= 0) intervals.push([start, last]);
    if (present) rows.push({ cls, present, max, intervals });
  }
  // サルを先頭に、あとは映っていた時間の長い順
  rows.sort((a, b) => (b.cls === MONKEY) - (a.cls === MONKEY) || b.present - a.present);
  return rows;
}

function renderSummary(rows, fps) {
  if (!rows.length) return el('p', { class: 'none' }, '何も検出されませんでした。');
  return el('ul', { class: 'summary' }, rows.map((r) => {
    const times = r.intervals.slice(0, MAX_INTERVALS_SHOWN).map(([a, b]) => {
      const from = formatTime(a / fps);
      const to = formatTime((b + 1) / fps);
      return from === to ? `${from}ごろ` : `${from}〜${to}`;
    }).join('、');
    const more = r.intervals.length > MAX_INTERVALS_SHOWN ? ` ほか${r.intervals.length - MAX_INTERVALS_SHOWN}回` : '';
    return el('li', {},
      el('span', { class: 'chip', style: `--c:${classColor(r.cls)};--t:${textColor(r.cls)}` }, CLASSES[r.cls][0]),
      ` 最大 ${r.max}${counterWord(r.cls)}・合計 ${(r.present / fps).toFixed(1)} 秒`,
      el('br'), el('small', {}, times + more));
  }));
}

// 出現タイムライン：クラスごとに映っていたコマを色の帯で表示。タップでその場面へ。
function renderTimeline(rows, perClass, nFrames, player) {
  const wrap = el('div', { class: 'timeline' });
  if (!rows.length) return wrap;
  const bars = [];
  for (const r of rows) {
    const cv = el('canvas', { class: 'tl-bar', height: 20 });
    bars.push({ cv, counts: perClass.get(r.cls), color: classColor(r.cls) });
    wrap.append(el('div', { class: 'tl-row' },
      el('span', { class: 'tl-label', style: `--c:${classColor(r.cls)}` }, CLASSES[r.cls][0]), cv));
  }
  const head = el('div', { class: 'tl-head' });
  wrap.append(head);

  const draw = () => {
    for (const b of bars) {
      const w = Math.max(1, Math.round(b.cv.clientWidth * (window.devicePixelRatio || 1)));
      b.cv.width = w;
      const ctx = b.cv.getContext('2d');
      ctx.fillStyle = '#2a2a2e';
      ctx.fillRect(0, 0, w, 20);
      ctx.fillStyle = b.color;
      for (let x = 0; x < w; x++) {
        const f0 = Math.floor(x / w * nFrames);
        const f1 = Math.max(f0 + 1, Math.floor((x + 1) / w * nFrames));
        for (let f = f0; f < f1; f++) {
          if (b.counts[f]) {
            ctx.fillRect(x, 0, 1, 20);
            break;
          }
        }
      }
    }
  };
  const moveHead = () => {
    const first = bars[0].cv;
    const d = player.duration || 1;
    const x = first.offsetLeft + first.clientWidth * Math.min(1, player.currentTime / d);
    head.style.left = `${x}px`;
  };
  for (const b of bars) {
    b.cv.addEventListener('click', (e) => {
      const rect = b.cv.getBoundingClientRect();
      const t = (e.clientX - rect.left) / rect.width * (player.duration || 0);
      player.currentTime = Math.max(0, t);
      moveHead();
    });
  }
  player.addEventListener('timeupdate', moveHead);
  player.addEventListener('seeked', moveHead);
  new ResizeObserver(() => { draw(); moveHead(); }).observe(wrap);
  return wrap;
}

export async function openVideoScreen(file, { detector, getOptions, mask, onClose }) {
  const screen = $('#videoScreen');
  const src = el('video', { muted: true, playsinline: true, preload: 'auto' });
  src.muted = true;
  const srcUrl = URL.createObjectURL(file);
  let job = null;          // 書き出し中の状態 { cancelled }
  let resultUrl = null;

  const close = () => {
    if (job) job.cancelled = true;
    keepAwake('video', false);
    URL.revokeObjectURL(srcUrl);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    src.removeAttribute('src');
    src.load();
    screen.hidden = true;
    screen.replaceChildren();
    onClose();
  };

  const preview = el('canvas', { class: 'video-preview' });
  const info = el('p', { class: 'hint' }, '読み込み中…');
  const body = el('div', { class: 'screen-body' }, preview, info);
  screen.replaceChildren(
    el('header', { class: 'screen-head' },
      el('button', { type: 'button', class: 'back', onclick: close }, '閉じる'),
      el('h2', {}, '動画の検出'), el('span')),
    body,
  );
  screen.hidden = false;

  if (!('VideoEncoder' in window) || !window.Mp4Muxer) {
    info.textContent = 'このブラウザは動画の書き出しに対応していません（iPhone は iOS 16.4 以降が必要です）。';
    return;
  }

  if (/\.avi$/i.test(file.name)) {
    info.textContent = 'AVI 形式の動画は iPhone では読み込めません。MP4 や MOV に変換してから読み込んでください。';
    return;
  }
  // 画面に置いておく（画面の外の動画は iPhone で読み込まれないことがある）
  src.className = 'hidden-video';
  body.append(src);
  try {
    await loadVideo(src, srcUrl);
  } catch (e) {
    info.textContent = e.message;
    return;
  }
  if (!body.isConnected) return;   // 読み込み中に閉じられた
  const vw = src.videoWidth;
  const vh = src.videoHeight;
  const duration = src.duration;
  if (!vw || !vh || !Number.isFinite(duration) || duration <= 0) {
    info.textContent = 'この動画は読み込めません。';
    return;
  }
  const s = Math.min(1, MAX_EXPORT_SIDE / Math.max(vw, vh));
  const W = even(vw * s);
  const H = even(vh * s);
  preview.width = W;
  preview.height = H;
  const pctx = preview.getContext('2d');
  pctx.drawImage(src, 0, 0, W, H);
  info.textContent = `${file.name}・${formatTime(duration)}・${vw}×${vh}` + (s < 1 ? `（${W}×${H} で書き出し）` : '');

  // 書き出しの設定
  const intervalSel = el('select', {},
    [[1, '毎コマ'], [2, '2コマに1回'], [3, '3コマに1回'], [5, '5コマに1回']].map(([v, t]) =>
      el('option', { value: v, selected: settings.videoInterval === v }, t)));
  const fpsSel = el('select', {},
    [[30, '30 コマ/秒'], [15, '15 コマ/秒（速い）']].map(([v, t]) =>
      el('option', { value: v, selected: settings.videoFps === v }, t)));
  const useMask = el('input', { type: 'checkbox' });
  const maskRow = el('label', { class: 'row' }, el('span', { class: 'row-text' }, '非検出エリアを使う'), useMask);
  maskRow.hidden = mask.isEmpty();
  const estimate = el('p', { class: 'hint' });
  const updateEstimate = () => {
    const frames = Math.floor(duration * Number(fpsSel.value));
    estimate.textContent = `${frames} コマを処理します。検出は ${Math.ceil(frames / Number(intervalSel.value))} 回です。`;
  };
  intervalSel.addEventListener('change', updateEstimate);
  fpsSel.addEventListener('change', updateEstimate);
  updateEstimate();

  const startBtn = el('button', { type: 'button', class: 'primary wide' }, '検出して書き出す');
  const options = el('div', { class: 'video-options' },
    el('label', { class: 'row' }, el('span', { class: 'row-text' }, '検出の間隔'), intervalSel),
    el('label', { class: 'row' }, el('span', { class: 'row-text' }, '書き出しのコマ数'), fpsSel),
    maskRow, estimate,
    el('p', { class: 'hint' }, '処理中は画面を消したり、ほかのアプリに切り替えたりしないでください（止まります）。'),
    startBtn);
  body.append(options);

  startBtn.addEventListener('click', async () => {
    const interval = Number(intervalSel.value);
    const fps = Number(fpsSel.value);
    settings.videoInterval = interval;
    settings.videoFps = fps;
    saveSettings();
    options.hidden = true;

    const bar = el('progress', { max: 1, value: 0 });
    const ptext = el('p', { class: 'progress-text' }, '準備中…');
    const finishBtn = el('button', { type: 'button', class: 'primary' }, 'ここまでで終える');
    const cancelBtn = el('button', { type: 'button' }, '中止');
    const progressBox = el('div', { class: 'video-progress' }, bar, ptext,
      el('div', { class: 'progress-buttons' }, cancelBtn, finishBtn));
    body.append(progressBox);
    job = { cancelled: false, finishEarly: false };
    const myJob = job;
    cancelBtn.addEventListener('click', () => { myJob.cancelled = true; });
    finishBtn.addEventListener('click', () => {
      myJob.finishEarly = true;
      finishBtn.disabled = true;
      cancelBtn.disabled = true;
      ptext.textContent = 'ここまでの分をまとめています…';
    });
    keepAwake('video', true);

    try {
      const result = await exportVideo({
        src, W, H, vw, vh, duration, fps, interval, detector, preview: pctx,
        options: { ...getOptions(), maskTest: useMask.checked ? (x, y) => mask.has(x, y) : null },
        job: myJob,
        onProgress: (done, total, eta) => {
          bar.value = done / total;
          if (myJob.finishEarly) return;
          ptext.textContent = `${done} / ${total} コマ（${Math.round(done / total * 100)}%）` +
            (eta != null ? `・残り約 ${formatTime(eta)}` : '');
        },
      });
      progressBox.remove();
      if (!result) {
        toast('中止しました');
        options.hidden = false;
        return;
      }
      showResult(result, fps);
    } catch (e) {
      progressBox.remove();
      options.hidden = false;
      info.textContent = `書き出しに失敗しました：${e.message}`;
    } finally {
      keepAwake('video', false);
      job = null;
    }
  });

  function showResult({ blob, perClass, nFrames, partial }, fps) {
    preview.hidden = true;
    if (partial) info.textContent = `${file.name}：途中（${formatTime(nFrames / fps)} まで）で終えた結果です。`;
    resultUrl = URL.createObjectURL(blob);
    const player = el('video', { src: resultUrl, controls: true, playsinline: true, class: 'video-result' });
    const rows = summarize(perClass, nFrames, fps);
    const name = `${file.name.replace(/\.[^.]+$/, '') || 'video'}_box.mp4`;
    const saveBtn = el('button', { type: 'button', class: 'primary wide' }, '保存');
    saveBtn.addEventListener('click', async () => {
      try {
        if (await saveFiles([new File([blob], name, { type: 'video/mp4' })])) toast('保存しました');
      } catch (e) {
        toast(`保存できませんでした：${e.message}`, 4000);
      }
    });
    body.append(
      player,
      el('h3', {}, '出現タイムライン'),
      renderTimeline(rows, perClass, nFrames, player),
      el('h3', {}, 'まとめ'),
      renderSummary(rows, fps),
      saveBtn,
    );
  }
}

export async function exportVideo({ src, W, H, vw, vh, duration, fps, interval, detector, preview, options, job, onProgress }) {
  const config = await pickEncoderConfig(W, H, fps);
  if (!config) throw new Error('この端末では H.264 の書き出しができません');

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const muxer = new window.Mp4Muxer.Muxer({
    target: new window.Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H, frameRate: fps },
    fastStart: 'in-memory',
  });
  let encodeError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encodeError = e; },
  });
  encoder.configure(config);

  const nFrames = Math.max(1, Math.floor(duration * fps));
  const perClass = new Map();
  const full = { x: 0, y: 0, w: vw, h: vh };
  const sx = W / vw;
  const sy = H / vh;
  let dets = [];
  const t0 = performance.now();

  let done = nFrames;
  for (let i = 0; i < nFrames; i++) {
    if (job.cancelled || (job.finishEarly && i === 0)) {
      encoder.close();
      return null;
    }
    // 「ここまでで終える」：処理したコマだけで動画を仕上げる
    if (job.finishEarly) {
      done = i;
      break;
    }
    if (encodeError) throw encodeError;
    await seek(src, Math.min(i / fps, duration - 0.001));
    ctx.drawImage(src, 0, 0, W, H);
    if (i % interval === 0) {
      const res = await detector.detect(src, full, IMPORT_SIZE, options);
      dets = res.dets.map((d) => ({ ...d, x1: d.x1 * sx, y1: d.y1 * sy, x2: d.x2 * sx, y2: d.y2 * sy }));
    }
    drawDetections(ctx, dets, W, H);
    for (const d of dets) {
      let counts = perClass.get(d.cls);
      if (!counts) {
        counts = new Uint8Array(nFrames);
        perClass.set(d.cls, counts);
      }
      if (counts[i] < 255) counts[i]++;
    }
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    while (encoder.encodeQueueSize > 2) await new Promise((r) => setTimeout(r, 5));

    if (i % 3 === 0 || i === nFrames - 1) {
      preview.drawImage(canvas, 0, 0);
      const elapsed = (performance.now() - t0) / 1000;
      const eta = i > 5 ? elapsed / (i + 1) * (nFrames - i - 1) : null;
      onProgress(i + 1, nFrames, eta);
    }
  }
  await encoder.flush();
  if (encodeError) throw encodeError;
  encoder.close();
  canvas.width = 0;   // 画像用のメモリをすぐ空ける
  canvas.height = 0;
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  if (done < nFrames) {
    for (const [cls, counts] of perClass) perClass.set(cls, counts.subarray(0, done));
  }
  return { blob, perClass, nFrames: done, partial: done < nFrames };
}
