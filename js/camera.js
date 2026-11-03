// ライブカメラ：映像の表示、検出のくり返し、ズーム、静止画・録画。
// view キャンバスに「映像＋枠」を描き、録画もこのキャンバスから取る。
// overlay キャンバスは非検出エリアなど画面だけに出すもの（保存されない）。

import { drawDetections } from './draw.js';
import { RECORD_BITRATE } from './config.js';
import { canvasToBlob } from './ui.js';

const DIGITAL_ZOOM_MAX = 8;
const HW_ZOOM_MAX = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// (w, h) を (W, H) の中に縦横比を保って収める位置
export function fitRect(w, h, W, H) {
  const s = Math.min(W / w, H / h);
  const fw = w * s;
  const fh = h * s;
  return { x: (W - fw) / 2, y: (H - fh) / 2, w: fw, h: fh };
}

function pickRecorderType() {
  if (!window.MediaRecorder) return null;
  const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

export class LiveCamera {
  constructor(detector, { stage, video, view, overlay }) {
    this.detector = detector;
    this.stage = stage;
    this.video = video;
    this.view = view;
    this.overlay = overlay;
    this.vctx = view.getContext('2d');
    this.octx = overlay.getContext('2d');
    this.clean = document.createElement('canvas');
    this.cctx = this.clean.getContext('2d');
    this.running = false;
    this.stream = null;
    this.track = null;
    this.dets = [];             // 位置は映像（ズーム後の範囲）に対する割合
    this.zoom = 1;
    this.hwZoom = null;         // カメラ側のズームが使えるときの範囲 {min, max}
    this.recording = null;
    this.overlayDirty = true;
    this.frameTimes = [];
    // main.js から設定する
    this.getOptions = () => ({});
    this.getSize = () => 320;
    this.onDetections = () => {};
    this.onError = () => {};
    this.onOrientation = () => {};   // 映像が縦長⇔横長に変わったとき（'portrait' / 'landscape'）
    this.drawOverlayContent = () => {};
    this.orient = null;
    this.rot = 0;
    this.needLayout = false;
    this.render = this.render.bind(this);
    window.addEventListener('resize', () => this.layout());
  }

  async start(facing) {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    this.track = this.stream.getVideoTracks()[0];
    this.video.srcObject = this.stream;
    await this.video.play();
    const caps = this.track.getCapabilities ? this.track.getCapabilities() : {};
    this.hwZoom = caps.zoom ? { min: caps.zoom.min, max: Math.min(caps.zoom.max, HW_ZOOM_MAX) } : null;
    this.zoom = 1;
    if (this.hwZoom) this.applyHwZoom();
    this.dets = [];
    this.orient = null;
    this.running = true;
    requestAnimationFrame(this.render);
    this.detectLoop();
  }

  stop() {
    this.running = false;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
    this.video.srcObject = null;
  }

  isLive() {
    return this.running && this.track && this.track.readyState === 'live';
  }

  zoomRange() {
    return this.hwZoom ? [this.hwZoom.min, this.hwZoom.max] : [1, DIGITAL_ZOOM_MAX];
  }

  setZoom(z) {
    const [lo, hi] = this.zoomRange();
    this.zoom = Math.min(hi, Math.max(lo, z));
    if (this.hwZoom) this.applyHwZoom();
    this.overlayDirty = true;
  }

  // カメラへのズーム指示は、前の指示が終わってから最新の値だけ送る
  async applyHwZoom() {
    if (this.zoomBusy) {
      this.zoomPending = true;
      return;
    }
    this.zoomBusy = true;
    try {
      do {
        this.zoomPending = false;
        await this.track.applyConstraints({ advanced: [{ zoom: this.zoom }] });
      } while (this.zoomPending);
    } catch {
      // カメラが受け付けなければ画面上のズームに切り替える
      this.hwZoom = null;
      this.zoom = 1;
    }
    this.zoomBusy = false;
  }

  // 検出・表示に使う映像の範囲（画面上のズームのときは中央を切り出す）
  crop() {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (this.hwZoom || this.zoom <= 1) return { x: 0, y: 0, w: vw, h: vh };
    const w = vw / this.zoom;
    const h = vh / this.zoom;
    return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
  }

  // 画面の向きのロック中に横に持ったとき：映像を回して横長の画像として扱う（0 / 90 / -90）
  setRotation(rot) {
    if (rot === this.rot) return;
    this.rot = rot;
    this.dets = [];
    this.needLayout = true;
  }

  // 回したあとの映像の大きさ
  uprightSize(c = this.crop()) {
    return this.rot ? { w: c.h, h: c.w } : { w: c.w, h: c.h };
  }

  // キャンバスを画面いっぱいに（縦横比を保って）置く。
  // 横に持っているときは、横長のキャンバスを画面上で回して表示する（持っている人から見てまっすぐ）。
  layout() {
    const W = this.view.width;
    const H = this.view.height;
    if (!W || !H) return;
    const sw = this.stage.clientWidth;
    const sh = this.stage.clientHeight;
    const turned = this.rot !== 0;
    const r = turned ? fitRect(H, W, sw, sh) : fitRect(W, H, sw, sh);   // 画面上で占める範囲
    const cw = turned ? r.h : r.w;   // 回す前のキャンバスの表示サイズ
    const ch = turned ? r.w : r.h;
    for (const c of [this.view, this.overlay]) {
      Object.assign(c.style, {
        left: `${r.x + (r.w - cw) / 2}px`, top: `${r.y + (r.h - ch) / 2}px`,
        width: `${cw}px`, height: `${ch}px`,
        transform: turned ? `rotate(${this.rot}deg)` : '',
      });
    }
    const dpr = window.devicePixelRatio || 1;
    this.overlay.width = Math.round(cw * dpr);
    this.overlay.height = Math.round(ch * dpr);
    this.overlayDirty = true;
  }

  // 映像を置く位置（録画中に縦横が変わったときは黒帯を付けて収める）
  contentRect() {
    const u = this.uprightSize();
    return fitRect(u.w, u.h, this.view.width, this.view.height);
  }

  drawFrame(ctx, W, H) {
    const c = this.crop();
    const u = this.uprightSize(c);
    const r = fitRect(u.w, u.h, W, H);
    if (r.w < W - 0.5 || r.h < H - 0.5) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
    }
    if (this.rot) {
      const s = r.w / u.w;
      ctx.save();
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
      ctx.rotate(-this.rot * Math.PI / 180);
      ctx.drawImage(this.video, c.x, c.y, c.w, c.h, -c.w * s / 2, -c.h * s / 2, c.w * s, c.h * s);
      ctx.restore();
    } else {
      ctx.drawImage(this.video, c.x, c.y, c.w, c.h, r.x, r.y, r.w, r.h);
    }
    return r;
  }

  mappedDets(r) {
    return this.dets.map((d) => ({
      ...d,
      x1: r.x + d.x1 * r.w, y1: r.y + d.y1 * r.h, x2: r.x + d.x2 * r.w, y2: r.y + d.y2 * r.h,
    }));
  }

  render() {
    if (!this.running) return;
    requestAnimationFrame(this.render);
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) return;
    // スマホを回すと映像（回したあと）の縦横が入れ替わる
    const full = this.rot ? { w: v.videoHeight, h: v.videoWidth } : { w: v.videoWidth, h: v.videoHeight };
    const orient = full.w >= full.h ? 'landscape' : 'portrait';
    if (orient !== this.orient) {
      this.orient = orient;
      this.dets = [];
      this.onOrientation(orient);
    }
    if (!this.recording && (this.view.width !== full.w || this.view.height !== full.h)) {
      this.view.width = this.clean.width = full.w;
      this.view.height = this.clean.height = full.h;
      this.needLayout = true;
    }
    if (this.needLayout) {
      this.needLayout = false;
      this.layout();
    }
    const W = this.view.width;
    const H = this.view.height;
    let r;
    if (this.recording && this.recording.clean) {
      r = this.drawFrame(this.cctx, W, H);
      this.vctx.drawImage(this.clean, 0, 0);
    } else {
      r = this.drawFrame(this.vctx, W, H);
    }
    drawDetections(this.vctx, this.mappedDets(r), W, H);

    if (this.overlayDirty) {
      this.overlayDirty = false;
      const o = this.overlay;
      this.octx.clearRect(0, 0, o.width, o.height);
      const s = o.width / W;
      this.drawOverlayContent(this.octx, { x: r.x * s, y: r.y * s, w: r.w * s, h: r.h * s });
    }
  }

  async detectLoop() {
    while (this.running) {
      const v = this.video;
      if (v.readyState >= 2 && v.videoWidth && document.visibilityState === 'visible') {
        const c = this.crop();
        const rot = this.rot;
        const u = this.uprightSize(c);
        try {
          const res = await this.detector.detect(v, c, this.getSize(), { ...this.getOptions(), rot });
          if (rot !== this.rot) continue;   // 検出中に持ち方が変わったら結果を捨てる
          this.dets = res.dets.map((d) => ({
            ...d, x1: d.x1 / u.w, y1: d.y1 / u.h, x2: d.x2 / u.w, y2: d.y2 / u.h,
          }));
          const now = performance.now();
          this.frameTimes.push(now);
          while (this.frameTimes.length && now - this.frameTimes[0] > 2000) this.frameTimes.shift();
          const fps = this.frameTimes.length > 1
            ? (this.frameTimes.length - 1) / ((now - this.frameTimes[0]) / 1000) : 0;
          this.onDetections(this.dets, { ms: res.ms, fps });
        } catch (e) {
          this.onError(e);
          await sleep(1000);
        }
      } else {
        await sleep(100);
      }
      await sleep(0);
    }
  }

  // 静止画：枠なしと枠ありの2枚
  async capture() {
    const W = this.view.width;
    const H = this.view.height;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    const r = this.drawFrame(ctx, W, H);
    const dets = this.mappedDets(r);
    const raw = await canvasToBlob(c);
    drawDetections(ctx, dets, W, H);
    const boxed = await canvasToBlob(c);
    c.width = 0;   // 画像用のメモリをすぐ空ける
    c.height = 0;
    return { raw, boxed, dets };
  }

  // 録画：枠ありは必ず、枠なしは withClean のとき
  startRecording(withClean) {
    const type = pickRecorderType();
    if (type === null) throw new Error('このブラウザは録画に対応していません');
    const make = (canvas) => {
      const stream = canvas.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: type || undefined, videoBitsPerSecond: RECORD_BITRATE });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const done = new Promise((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || type || 'video/mp4' }));
      });
      rec.start(1000);
      return { rec, done };
    };
    this.recording = { boxed: make(this.view), clean: withClean ? make(this.clean) : null, started: Date.now() };
  }

  async stopRecording() {
    const r = this.recording;
    if (!r) return null;
    r.boxed.rec.stop();
    if (r.clean) r.clean.rec.stop();
    const boxed = await r.boxed.done;
    const clean = r.clean ? await r.clean.done : null;
    this.recording = null;
    return { boxed, clean };
  }
}
