// PC での自動テスト用（?selftest を付けて開いたときだけ読み込まれる。普段は使わない）。
// app_test_media の画像を検出して、結果を dev/serve.py 経由で dev/results/ に保存する。
//   ?selftest                 画像の検出と速度
//   ?selftest&video=名前&sec=5  動画の書き出しも試す（先頭 sec 秒）

import { CLASSES } from '../js/classes.js';
import { drawDetections } from '../js/draw.js';
import { canvasToBlob } from '../js/ui.js';
import { exportVideo, summarize } from '../js/video.js';

const params = new URLSearchParams(location.search);

async function post(name, body) {
  await fetch(`/__result/${name}`, { method: 'POST', body });
}

function log(msg) {
  console.log(msg);
  document.title = msg;
}

export async function run({ detector }) {
  const report = { ua: navigator.userAgent, isolated: self.crossOriginIsolated };
  try {
    await detector.init(params.get('backend') || 'auto');
    report.backend = detector.backend;
    report.threads = detector.threads;
    const all = new Set(CLASSES.map((_, i) => i));
    const opts = { conf: 0.25, selected: all, maskTest: null };

    // 1) 画像の検出
    const { images } = await (await fetch('/__test/manifest.json')).json();
    report.images = {};
    for (const name of images) {
      const bmp = await createImageBitmap(await (await fetch(`/__test/${name}`)).blob());
      const { dets } = await detector.detect(bmp, { x: 0, y: 0, w: bmp.width, h: bmp.height }, 640, opts);
      report.images[name] = dets.map((d) => [d.cls, +d.conf.toFixed(4), +d.x1.toFixed(1), +d.y1.toFixed(1), +d.x2.toFixed(1), +d.y2.toFixed(1)]);
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      drawDetections(ctx, dets, c.width, c.height);
      await post(`${name.replace(/\.jpg$/, '')}_box.jpg`, await canvasToBlob(c));
      log(`image ${name} ${dets.length}`);
    }

    // 2) 速度（サイズごとに 5 回の平均）
    report.speed = {};
    const bmp = await createImageBitmap(await (await fetch(`/__test/${images[0]}`)).blob());
    for (const size of [320, 416, 640]) {
      await detector.detect(bmp, { x: 0, y: 0, w: bmp.width, h: bmp.height }, size, opts);
      let total = 0;
      for (let i = 0; i < 5; i++) {
        total += (await detector.detect(bmp, { x: 0, y: 0, w: bmp.width, h: bmp.height }, size, opts)).ms;
      }
      report.speed[size] = +(total / 5).toFixed(1);
      log(`speed ${size} ${report.speed[size]}`);
    }

    // 3) 動画の書き出し
    const vname = params.get('video');
    if (vname) {
      const sec = Number(params.get('sec') || 5);
      const blob = await (await fetch(`/__test/${vname}`)).blob();
      const src = document.createElement('video');
      src.muted = true;
      src.playsInline = true;
      src.src = URL.createObjectURL(blob);
      await new Promise((r, j) => { src.onloadeddata = r; src.onerror = () => j(new Error('video load')); });
      const vw = src.videoWidth;
      const vh = src.videoHeight;
      const s = Math.min(1, 1920 / Math.max(vw, vh));
      const W = Math.round(vw * s / 2) * 2;
      const H = Math.round(vh * s / 2) * 2;
      const fps = Number(params.get('fps') || 30);
      const preview = document.createElement('canvas').getContext('2d');
      const t0 = performance.now();
      const res = await exportVideo({
        src, W, H, vw, vh, duration: Math.min(sec, src.duration), fps,
        interval: Number(params.get('interval') || 1), detector, preview,
        options: opts, job: { cancelled: false },
        onProgress: (d, t) => log(`video ${d}/${t}`),
      });
      report.video = {
        src: `${vw}x${vh}`, out: `${W}x${H}`, frames: res.nFrames, seconds: +((performance.now() - t0) / 1000).toFixed(1),
        bytes: res.blob.size,
        summary: summarize(res.perClass, res.nFrames, fps).map((r) => ({
          cls: CLASSES[r.cls][0], max: r.max, present: r.present, intervals: r.intervals,
        })),
      };
      await post('video_box.mp4', res.blob);
    }
    report.ok = true;
  } catch (e) {
    report.ok = false;
    report.error = `${e.name}: ${e.message}\n${e.stack}`;
  }
  await post('report.json', JSON.stringify(report, null, 1));
  log('selftest done');
}
