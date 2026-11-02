// オフライン用の Service Worker。
// - 画面のファイル（小さいもの）はインストール時にまとめて保存し、VERSION を上げると入れ替わる。
// - モデルなど大きなファイルは、ページ側（js/offline.js）が BIG_CACHE に保存する。
// - 保存してあるものは保存場所から返し、なければネットから取る。
// - 返すときに COOP/COEP の見出しを付け、複数スレッドでの計算を使えるようにする（GitHub Pages では設定できないため）。

const VERSION = '1.0.2';            // js/config.js の APP_VERSION と同じ値にする
const SHELL_CACHE = `shell-${VERSION}`;
const BIG_CACHE = 'big-v1';         // js/config.js と同じ名前

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/main.js',
  'js/camera.js',
  'js/classes.js',
  'js/config.js',
  'js/detector.js',
  'js/draw.js',
  'js/mask.js',
  'js/offline.js',
  'js/photo.js',
  'js/settings.js',
  'js/settings_ui.js',
  'js/ui.js',
  'js/video.js',
  'vendor/mp4-muxer.js',
  'vendor/ort.wasm.min.js',
  'vendor/ort.webgpu.min.js',
  'vendor/ort-wasm-simd-threaded.mjs',
  'vendor/ort-wasm-simd-threaded.asyncify.mjs',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL.map((p) => new Request(p, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k !== SHELL_CACHE && k !== BIG_CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isolate(resp) {
  if (!resp || resp.status === 0 || resp.type === 'opaque') return resp;
  const headers = new Headers(resp.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const key = req.mode === 'navigate' ? 'index.html' : req;
    const hit = (await caches.match(key, { ignoreSearch: true }))
      || (req.mode === 'navigate' ? await caches.match('./') : null);
    if (hit) return isolate(hit);
    try {
      return isolate(await fetch(req));
    } catch (e) {
      return new Response('オフラインのため読み込めません', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
