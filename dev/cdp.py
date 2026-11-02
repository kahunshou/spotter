"""画面なしの Edge を操作して、アプリの画面を撮る（PC での確認用）。Python の標準機能だけで動く。

使い方:
    python dev/cdp.py <port> shot <保存先.png> [幅 高さ]
    python dev/cdp.py <port> eval "<JavaScript>"
    python dev/cdp.py <port> files "<セレクタ>" <ファイル>...   （ファイル選択欄にファイルを入れる）
"""

import base64
import json
import os
import socket
import struct
import sys
import urllib.request


class CDP:
    def __init__(self, port):
        tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
        page = next(t for t in tabs if t["type"] == "page" and "localhost" in t["url"])
        url = page["webSocketDebuggerUrl"]
        host_port, path = url[len("ws://"):].split("/", 1)
        host, p = host_port.split(":")
        self.s = socket.create_connection((host, int(p)))
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET /{path} HTTP/1.1\r\nHost: {host_port}\r\nUpgrade: websocket\r\n"
                        f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.s.recv(4096)
        self.rest = buf.split(b"\r\n\r\n", 1)[1]
        self.next_id = 0

    def _recv_exact(self, n):
        while len(self.rest) < n:
            chunk = self.s.recv(1 << 20)
            if not chunk:
                raise ConnectionError("closed")
            self.rest += chunk
        out, self.rest = self.rest[:n], self.rest[n:]
        return out

    def _recv_msg(self):
        data = b""
        while True:
            b1, b2 = self._recv_exact(2)
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._recv_exact(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._recv_exact(8))[0]
            data += self._recv_exact(n)
            if b1 & 0x80:
                return data.decode()

    def call(self, method, **params):
        self.next_id += 1
        payload = json.dumps({"id": self.next_id, "method": method, "params": params}).encode()
        mask = os.urandom(4)
        n = len(payload)
        head = bytes([0x81])
        if n < 126:
            head += bytes([0x80 | n])
        elif n < 65536:
            head += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            head += bytes([0x80 | 127]) + struct.pack(">Q", n)
        self.s.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))
        while True:
            msg = json.loads(self._recv_msg())
            if msg.get("id") == self.next_id:
                if "error" in msg:
                    raise RuntimeError(msg["error"])
                return msg["result"]


def main():
    port, cmd = sys.argv[1], sys.argv[2]
    c = CDP(port)
    if cmd == "shot":
        w, h = (int(sys.argv[4]), int(sys.argv[5])) if len(sys.argv) > 5 else (390, 844)
        c.call("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=2, mobile=True)
        r = c.call("Page.captureScreenshot", format="png")
        with open(sys.argv[3], "wb") as f:
            f.write(base64.b64decode(r["data"]))
        print("saved", sys.argv[3])
    elif cmd == "files":
        root = c.call("DOM.getDocument")["root"]["nodeId"]
        node = c.call("DOM.querySelector", nodeId=root, selector=sys.argv[3])["nodeId"]
        c.call("DOM.setFileInputFiles", nodeId=node, files=sys.argv[4:])
        print("set", len(sys.argv[4:]), "files")
    elif cmd == "eval":
        r = c.call("Runtime.evaluate", expression=sys.argv[3], awaitPromise=True, returnByValue=True)
        print(json.dumps(r.get("result", {}).get("value"), ensure_ascii=False))


if __name__ == "__main__":
    main()
