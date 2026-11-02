"""アプリのアイコン（icons/*.png）を作る。Pillow が必要。

使い方（app_project フォルダで）:
    python dev/make_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent.parent / "icons"
S = 1024  # 大きく描いてから縮める

# 七色（赤→橙→黄→緑→青→藍→紫）：いろいろな物を spot する、という意味
SEVEN = ["#FF0000", "#FF8C00", "#FFE600", "#00C853", "#00A2FF", "#3D3DFF", "#B000FF"]


def hexrgb(h: str) -> tuple:
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def background() -> Image.Image:
    """上から下へ暗くなる黒のグラデーション。"""
    im = Image.new("RGB", (S, S))
    d = ImageDraw.Draw(im)
    top, bot = (30, 30, 36), (8, 8, 12)
    for y in range(S):
        t = y / (S - 1)
        d.line((0, y, S, y), fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bot)))
    return im


def rainbow(x0: int, y0: int, x1: int, y1: int) -> Image.Image:
    """左上の赤から右下の紫へ、斜めに七色が変わる画像。"""
    cols = [hexrgb(c) for c in SEVEN]
    im = Image.new("RGB", (S, S))
    px = im.load()
    for y in range(S):
        for x in range(S):
            t = min(1.0, max(0.0, ((x - x0) + (y - y0)) / ((x1 - x0) + (y1 - y0))))
            f = t * (len(cols) - 1)
            i = min(int(f), len(cols) - 2)
            u = f - i
            px[x, y] = tuple(int(a + (b - a) * u) for a, b in zip(cols[i], cols[i + 1]))
    return im


def draw_lens(im: Image.Image, cx: int, cy: int, r: int) -> None:
    d = ImageDraw.Draw(im)
    for k, col in ((1.0, "#2a2f45"), (0.86, "#0b0d18"), (0.62, "#2c4bff"), (0.40, "#7a8cff"), (0.18, "#05060c")):
        rr = int(r * k)
        d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=col)
    # 光の反射
    hl = Image.new("L", (S, S), 0)
    hd = ImageDraw.Draw(hl)
    hd.ellipse((cx - int(r * 0.42), cy - int(r * 0.46), cx - int(r * 0.16), cy - int(r * 0.20)), fill=200)
    hd.ellipse((cx + int(r * 0.18), cy + int(r * 0.16), cx + int(r * 0.28), cy + int(r * 0.26)), fill=120)
    im.paste(Image.new("RGB", (S, S), "white"), mask=hl.filter(ImageFilter.GaussianBlur(4)))


def foreground() -> Image.Image:
    """レンズと検出枠だけを透明な画像に描く（背景とは別にしておく）。"""
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw_lens(im, 512, 560, 300)

    # 検出枠と「spot」のラベル（七色のグラデーション）
    try:
        font = ImageFont.truetype("arialbd.ttf", 96)
    except OSError:
        font = ImageFont.load_default()
    box, w, th = (170, 260, 854, 870), 30, 112
    mask = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mask)
    md.rectangle(box, outline=255, width=w)
    tw = md.textlength("spot", font=font)
    md.rectangle((box[0], box[1] - th, box[0] + tw + 44, box[1]), fill=255)
    im.paste(rainbow(box[0], box[1] - th, box[2], box[3]), mask=mask)

    d = ImageDraw.Draw(im)
    d.text((box[0] + 24, box[1] - th + 8), "spot", font=font, fill=(60, 0, 0))  # 薄い影
    d.text((box[0] + 22, box[1] - th + 6), "spot", font=font, fill="white")
    return im


def compose(fg: Image.Image, scale: float) -> Image.Image:
    """背景の上に絵を重ねる。scale < 1 で余白を足す。"""
    out = background().convert("RGBA")
    n = int(S * scale)
    small = fg.resize((n, n), Image.LANCZOS)
    out.alpha_composite(small, ((S - n) // 2, (S - n) // 2))
    return out.convert("RGB")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    fg = foreground()
    im = compose(fg, 1.0)
    for name, size in (("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)):
        im.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
        print("作成:", OUT / name)
    # Android の丸や角丸で切り取られても枠が欠けないよう、絵を 80% に縮めて余白を足す
    compose(fg, 0.8).resize((512, 512), Image.LANCZOS).save(OUT / "icon-maskable-512.png", optimize=True)
    print("作成:", OUT / "icon-maskable-512.png")


if __name__ == "__main__":
    main()
