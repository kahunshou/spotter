// 物体検出の部品。yolo11n（COCO 80クラス）と monkey_v6 を onnxruntime-web で動かし、結果をまとめる。

import {
  ANIMAL_DUP_IOU, BIG_CACHE, INSIDE_RATIO, IOU_NMS, MAX_DET, PERSON_FILTER_CONF,
} from './config.js';
import { MONKEY, PERSON } from './classes.js';

// サルと間違えやすい COCO のクラス（鳥〜キリン、ぬいぐるみ）
const ANIMAL_LIKE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 77]);

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`${src} を読み込めません`));
    document.head.appendChild(s);
  });
}

// モデルは保存場所（Cache Storage）にあればそこから、なければダウンロードして保存する
export async function fetchCached(url, onProgress) {
  let cache = null;
  try {
    cache = await caches.open(BIG_CACHE);
    const hit = await cache.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch {
    cache = null;
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${url} を読み込めません（HTTP ${resp.status}）`);
  const total = Number(resp.headers.get('Content-Length')) || 0;
  const reader = resp.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (onProgress && total) onProgress(got / total);
  }
  const bytes = new Uint8Array(got);
  let pos = 0;
  for (const c of chunks) {
    bytes.set(c, pos);
    pos += c.length;
  }
  if (cache) {
    try {
      await cache.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }));
    } catch {
      // 容量不足などで保存できなくても検出は続ける
    }
  }
  return bytes;
}

function iou(a, b) {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / ((a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter);
}

// a の面積のうち、b の中に入っている割合
function insideRatio(a, b) {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max((a.x2 - a.x1) * (a.y2 - a.y1), 1e-6);
}

function nms(boxes) {
  boxes.sort((a, b) => b.conf - a.conf);
  const keep = [];
  for (const b of boxes) {
    if (keep.every((k) => k.cls !== b.cls || iou(k, b) <= IOU_NMS)) {
      keep.push(b);
      if (keep.length >= MAX_DET) break;
    }
  }
  return keep;
}

// 出力 [1, 4+クラス数, N] を枠の一覧にする（座標は crop の中の位置）
function decode(output, conf, pre, crop, clsOffset) {
  const data = output.data;
  const n = output.dims[2];
  const nc = output.dims[1] - 4;
  const boxes = [];
  for (let i = 0; i < n; i++) {
    let best = 0;
    let bc = -1;
    for (let c = 0; c < nc; c++) {
      const v = data[(4 + c) * n + i];
      if (v > best) {
        best = v;
        bc = c;
      }
    }
    if (best < conf) continue;
    const cx = data[i];
    const cy = data[n + i];
    const w = data[2 * n + i];
    const h = data[3 * n + i];
    boxes.push({
      cls: bc + clsOffset,
      conf: best,
      x1: Math.min(Math.max((cx - w / 2 - pre.dx) / pre.r, 0), crop.w),
      y1: Math.min(Math.max((cy - h / 2 - pre.dy) / pre.r, 0), crop.h),
      x2: Math.min(Math.max((cx + w / 2 - pre.dx) / pre.r, 0), crop.w),
      y2: Math.min(Math.max((cy + h / 2 - pre.dy) / pre.r, 0), crop.h),
    });
  }
  return nms(boxes);
}

export class Detector {
  constructor() {
    this.sessions = new Map();
    this.backend = '';
    this.threads = 1;
    this.queue = Promise.resolve();
    this.prepCanvas = document.createElement('canvas');
    this.prepCtx = this.prepCanvas.getContext('2d', { willReadFrequently: true });
  }

  // pref: auto / webgpu / wasm
  async init(pref) {
    let gpu = false;
    if (pref !== 'wasm' && navigator.gpu) {
      try {
        gpu = !!(await navigator.gpu.requestAdapter());
      } catch {
        gpu = false;
      }
    }
    await loadScript(gpu ? 'vendor/ort.webgpu.min.js' : 'vendor/ort.wasm.min.js');
    const ort = window.ort;
    ort.env.wasm.wasmPaths = new URL('vendor/', location.href).href;
    this.threads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    ort.env.wasm.numThreads = this.threads;
    this.gpu = gpu;
    this.backend = gpu ? 'WebGPU' : 'WASM';
  }

  async session(name, size, onProgress) {
    const key = `${name}_${size}`;
    if (!this.sessions.has(key)) {
      const p = (async () => {
        const bytes = await fetchCached(`models/${key}.onnx`, onProgress);
        const ort = window.ort;
        const providers = this.gpu ? ['webgpu', 'wasm'] : ['wasm'];
        const s = await ort.InferenceSession.create(bytes, {
          executionProviders: providers,
          graphOptimizationLevel: 'all',
        });
        // 1回目は遅いので、空の画像で慣らしておく
        const zeros = new ort.Tensor('float32', new Float32Array(3 * size * size), [1, 3, size, size]);
        await s.run({ [s.inputNames[0]]: zeros });
        return s;
      })();
      this.sessions.set(key, p);
      p.catch(() => this.sessions.delete(key));
    }
    return this.sessions.get(key);
  }

  // 使わないサイズのモデルを片付けてメモリを空ける
  async release(keepSizes) {
    for (const [key, p] of this.sessions) {
      const size = Number(key.split('_').pop());
      if (!keepSizes.includes(size)) {
        this.sessions.delete(key);
        try {
          (await p).release();
        } catch {
          // 片付けの失敗は無視
        }
      }
    }
  }

  prepare(source, crop, size) {
    const r = Math.min(size / crop.w, size / crop.h);
    const nw = Math.round(crop.w * r);
    const nh = Math.round(crop.h * r);
    const dx = Math.round((size - nw) / 2 - 0.1);
    const dy = Math.round((size - nh) / 2 - 0.1);
    const cv = this.prepCanvas;
    if (cv.width !== size) {
      cv.width = size;
      cv.height = size;
    }
    const ctx = this.prepCtx;
    ctx.fillStyle = 'rgb(114,114,114)';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, dx, dy, nw, nh);
    const px = ctx.getImageData(0, 0, size, size).data;
    const area = size * size;
    const input = new Float32Array(3 * area);
    for (let i = 0, j = 0; i < area; i++, j += 4) {
      input[i] = px[j] / 255;
      input[area + i] = px[j + 1] / 255;
      input[2 * area + i] = px[j + 2] / 255;
    }
    return { input, r, dx, dy };
  }

  // source の crop 範囲を検出する。結果は crop の中の座標。
  // opt: { conf, selected: Set, maskTest(nx, ny) → true なら捨てる }
  detect(source, crop, size, opt) {
    const job = this.queue.then(() => this._detect(source, crop, size, opt));
    this.queue = job.catch(() => {});
    return job;
  }

  async _detect(source, crop, size, opt) {
    const ort = window.ort;
    const t0 = performance.now();
    const pre = this.prepare(source, crop, size);
    const tensor = new ort.Tensor('float32', pre.input, [1, 3, size, size]);

    const cocoS = await this.session('yolo11n', size);
    const cocoOut = await cocoS.run({ [cocoS.inputNames[0]]: tensor });
    let coco = decode(cocoOut[cocoS.outputNames[0]], Math.min(opt.conf, PERSON_FILTER_CONF), pre, crop, 0);

    let monkeys = [];
    if (opt.selected.has(MONKEY)) {
      const mS = await this.session('monkey_v6', size);
      const mOut = await mS.run({ [mS.inputNames[0]]: tensor });
      monkeys = decode(mOut[mS.outputNames[0]], opt.conf, pre, crop, MONKEY);
      // サルのモデルは近くの人をサルと間違えやすいので、人の枠の中のサル枠は捨てる
      const persons = coco.filter((d) => d.cls === PERSON && d.conf >= PERSON_FILTER_CONF);
      monkeys = monkeys.filter((m) => !persons.some((p) => insideRatio(m, p) >= INSIDE_RATIO));
      // 同じサルに COCO が犬・熊などの枠も付けたときは、サル枠を残す
      coco = coco.filter((d) => !(ANIMAL_LIKE.has(d.cls) && monkeys.some((m) => iou(d, m) >= ANIMAL_DUP_IOU)));
    }

    let dets = coco.concat(monkeys).filter((d) => d.conf >= opt.conf && opt.selected.has(d.cls));
    if (opt.maskTest) {
      dets = dets.filter((d) => !opt.maskTest((d.x1 + d.x2) / 2 / crop.w, (d.y1 + d.y2) / 2 / crop.h));
    }
    return { dets, ms: performance.now() - t0 };
  }
}
