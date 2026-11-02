"""PC で動作確認するための簡単なサーバー（公開はしない。自分の PC の中だけ）。

使い方（app_project フォルダで）:
    python dev/serve.py
ブラウザで http://localhost:8765/ を開く（localhost ならカメラも使える）。

- 複数スレッドで計算できるよう COOP/COEP の見出しを付ける。
- 確認のたびに最新のファイルが読まれるよう、キャッシュさせない。
- /__test/ は app_project の外の app_test_media フォルダ（テスト用の写真・動画。公開しない）。
- /__result/<名前> に POST された内容を dev/results/ に保存する（自動テストの結果の受け取り用）。
"""

import http.server
import mimetypes
import sys
from pathlib import Path
from urllib.parse import unquote

APP = Path(__file__).resolve().parent.parent
TEST_MEDIA = APP.parent / "app_test_media"
RESULTS = APP / "dev" / "results"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("application/octet-stream", ".onnx")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP), **kwargs)

    def translate_path(self, path):
        p = unquote(path.split("?", 1)[0])
        if p.startswith("/__test/"):
            target = (TEST_MEDIA / p[len("/__test/"):]).resolve()
            if TEST_MEDIA.resolve() in target.parents:
                return str(target)
        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        name = Path(unquote(self.path)).name
        if not self.path.startswith("/__result/") or not name:
            self.send_error(404)
            return
        RESULTS.mkdir(parents=True, exist_ok=True)
        length = int(self.headers.get("Content-Length", 0))
        (RESULTS / name).write_bytes(self.rfile.read(length))
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        if "/__result/" in (args[0] if args else ""):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"http://localhost:{PORT}/ で開けます（止めるときは Ctrl+C）")
    server.serve_forever()
