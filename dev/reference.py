"""アプリ（ブラウザ）の検出結果が正しいかを、OpenCV で同じ処理をして確かめる。

使い方（app_project フォルダで）:
    python dev/reference.py        # dev/results/report.json と比べる
"""

import json
import sys
from pathlib import Path

import cv2
import numpy as np

APP = Path(__file__).resolve().parent.parent
MEDIA = APP.parent / "app_test_media"
CONF, IOU, PERSON_CONF, INSIDE, DUP_IOU = 0.25, 0.7, 0.25, 0.6, 0.5
ANIMAL_LIKE = {14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 77}


def letterbox(img, size):
    h, w = img.shape[:2]
    r = min(size / w, size / h)
    nw, nh = round(w * r), round(h * r)
    dx, dy = round((size - nw) / 2 - 0.1), round((size - nh) / 2 - 0.1)
    out = np.full((size, size, 3), 114, np.uint8)
    out[dy:dy + nh, dx:dx + nw] = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    return out, r, dx, dy


def run(net, blob):
    net.setInput(blob)
    return net.forward()[0]  # (4+nc, N)


def decode(out, conf, r, dx, dy, w, h, offset):
    scores = out[4:]
    cls = scores.argmax(0)
    best = scores.max(0)
    keep = best >= conf
    boxes = []
    for i in np.where(keep)[0]:
        cx, cy, bw, bh = out[:4, i]
        x1 = np.clip((cx - bw / 2 - dx) / r, 0, w)
        y1 = np.clip((cy - bh / 2 - dy) / r, 0, h)
        x2 = np.clip((cx + bw / 2 - dx) / r, 0, w)
        y2 = np.clip((cy + bh / 2 - dy) / r, 0, h)
        boxes.append([int(cls[i]) + offset, float(best[i]), x1, y1, x2, y2])
    boxes.sort(key=lambda b: -b[1])
    kept = []
    for b in boxes:
        if all(k[0] != b[0] or iou(k, b) <= IOU for k in kept):
            kept.append(b)
    return kept


def iou(a, b):
    w = min(a[4], b[4]) - max(a[2], b[2])
    h = min(a[5], b[5]) - max(a[3], b[3])
    if w <= 0 or h <= 0:
        return 0.0
    inter = w * h
    return inter / ((a[4] - a[2]) * (a[5] - a[3]) + (b[4] - b[2]) * (b[5] - b[3]) - inter)


def inside(a, b):
    w = min(a[4], b[4]) - max(a[2], b[2])
    h = min(a[5], b[5]) - max(a[3], b[3])
    if w <= 0 or h <= 0:
        return 0.0
    return w * h / max((a[4] - a[2]) * (a[5] - a[3]), 1e-6)


def detect(img, coco_net, monkey_net, size=640):
    h, w = img.shape[:2]
    lb, r, dx, dy = letterbox(cv2.cvtColor(img, cv2.COLOR_BGR2RGB), size)
    blob = lb.transpose(2, 0, 1)[None].astype(np.float32) / 255
    coco = decode(run(coco_net, blob), min(CONF, PERSON_CONF), r, dx, dy, w, h, 0)
    monkeys = decode(run(monkey_net, blob), CONF, r, dx, dy, w, h, 80)
    persons = [d for d in coco if d[0] == 0 and d[1] >= PERSON_CONF]
    monkeys = [m for m in monkeys if not any(inside(m, p) >= INSIDE for p in persons)]
    coco = [d for d in coco if not (d[0] in ANIMAL_LIKE and any(iou(d, m) >= DUP_IOU for m in monkeys))]
    return [d for d in coco + monkeys if d[1] >= CONF]


def main():
    report = json.loads((APP / "dev" / "results" / "report.json").read_text(encoding="utf-8"))
    coco_net = cv2.dnn.readNetFromONNX(str(APP / "models" / "yolo11n_640.onnx"))
    monkey_net = cv2.dnn.readNetFromONNX(str(APP / "models" / "monkey_v6_640.onnx"))
    ok = True
    for name, js in report["images"].items():
        img = cv2.imread(str(MEDIA / name))
        ref = detect(img, coco_net, monkey_net)
        matched = 0
        worst_conf = 0.0
        worst_iou = 1.0
        for d in js:
            cands = [r for r in ref if r[0] == d[0]]
            if not cands:
                continue
            best = max(cands, key=lambda r: iou(r, d))
            if iou(best, d) > 0.9:
                matched += 1
                worst_conf = max(worst_conf, abs(best[1] - d[1]))
                worst_iou = min(worst_iou, iou(best, d))
        same = matched == len(js) == len(ref)
        ok &= same
        print(f"{name}: アプリ {len(js)} 個 / OpenCV {len(ref)} 個 / 一致 {matched} 個"
              f"（信頼度の差 最大 {worst_conf:.3f}、枠の重なり 最小 {worst_iou:.3f}）{'' if same else '  ← 要確認'}")
        names = {}
        for d in js:
            names[d[0]] = names.get(d[0], 0) + 1
        print("   ", ", ".join(f"{k}:{v}" for k, v in sorted(names.items())))
    print("結果:", "一致" if ok else "差あり")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
