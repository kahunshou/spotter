"""アプリのアイコン（icons/*.png）を作る。Pillow が必要。

使い方（app_project フォルダで）:
    python dev/make_icons.py

絵柄：雪山の景色の上に、虹色の「spot」の枠。枠の中にトナカイ・キツネ・ネコと青い小鳥2羽。
動物は四角・三角だけで描いた1色のシルエットに、白いふちを付ける。
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

OUT = Path(__file__).resolve().parent.parent / "icons"
S = 1024  # 大きく描いてから縮める

# 七色（赤→橙→黄→緑→青→藍→紫）：いろいろな物を spot する、という意味
SEVEN = ["#FF0000", "#FF8C00", "#FFE600", "#00C853", "#00A2FF", "#3D3DFF", "#B000FF"]

# 枠（左右の位置）と、線・余白・ラベルの太さ
X0, X1 = 84, 940
K = (X1 - X0) / 684
LINE, PAD, LABEL, FS = int(34 * K * 0.85), int(30 * K), int(110 * K), int(76 * K)
DY = -30  # 上の空きが目立たないよう、全体を少し上へ
EDGE_PX = 11  # 動物の白いふちの太さ

# (形, 色, 高さ, 中心x, 足元y, 左右反転)。奥から順に。位置関係だけ決め、あとで枠いっぱいに収める
ANIMALS = [("deer", "#9A5F31", 400, 620, 800, False),
           ("fox", "#F07B2C", 190, 330, 820, True),
           ("cat", "#7F8BA0", 220, 470, 832, False)]
# (形, 色, 高さ, 枠の内側での x の割合, y の割合, 左右反転)
BIRDS = [("song", "#1DA1F2", 120, 0.17, 0.24, False),
         ("song", "#7CCBF7", 80, 0.38, 0.1, False)]


def hexrgb(h: str) -> tuple:
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


class Shape:
    """シルエットの形を mask に描く。"""

    def __init__(self):
        self.mask = Image.new("L", (S, S), 0)
        self.d = ImageDraw.Draw(self.mask)

    def poly(self, pts):
        self.d.polygon(pts, fill=255)

    def rect(self, box, r=0):
        self.d.rounded_rectangle(box, radius=r, fill=255)

    def bar(self, pts, w):
        """角を丸めた太い線（角・しっぽなど）。"""
        self.d.line(pts, fill=255, width=w, joint="curve")
        for x, y in pts:
            self.d.ellipse((x - w // 2, y - w // 2, x + w // 2, y + w // 2), fill=255)


def reindeer(a: Shape) -> None:
    a.rect((384, 640, 414, 806), r=12)
    a.rect((612, 640, 642, 806), r=12)
    a.poly([(320, 560), (628, 540), (668, 664), (330, 676)])          # 胴
    a.poly([(320, 562), (282, 548), (312, 596)])                      # しっぽ
    a.rect((344, 650, 374, 806), r=12)
    a.rect((646, 640, 676, 806), r=12)
    a.poly([(596, 566), (652, 440), (706, 452), (668, 610)])          # 首
    a.poly([(640, 418), (716, 404), (776, 468), (700, 486)])          # 頭（くさび形）
    a.poly([(650, 430), (606, 412), (640, 458)])                      # 耳
    a.bar([(676, 412), (650, 330), (624, 296)], 22)                   # 角
    a.bar([(658, 356), (604, 334)], 20)
    a.bar([(698, 408), (712, 320), (746, 290)], 22)
    a.bar([(708, 352), (762, 336)], 20)


def fox(a: Shape) -> None:
    a.rect((424, 680, 448, 806), r=10)
    a.rect((598, 680, 622, 806), r=10)
    a.poly([(268, 520), (230, 640), (300, 720), (418, 668), (420, 620)])  # 大きなしっぽ
    a.poly([(392, 612), (620, 596), (650, 690), (400, 700)])          # 胴
    a.rect((454, 680, 478, 806), r=10)
    a.rect((628, 676, 652, 806), r=10)
    a.poly([(600, 604), (650, 520), (760, 602), (672, 650)])          # 頭（三角に近い形）
    a.poly([(616, 580), (622, 476), (664, 548)])                      # 耳
    a.poly([(650, 540), (684, 464), (700, 562)])
    a.poly([(620, 640), (672, 650), (640, 690)])                      # 胸


def cat(a: Shape) -> None:
    a.bar([(600, 790), (680, 772), (708, 700), (690, 640)], 30)       # しっぽ
    a.poly([(400, 806), (624, 806), (590, 600), (434, 600)])          # 座った胴
    a.rect((432, 430, 592, 576), r=34)                                # 頭（角丸の四角）
    a.poly([(436, 460), (444, 360), (502, 434)])                      # 耳
    a.poly([(588, 460), (580, 360), (522, 434)])


def songbird(a: Shape) -> None:
    """小鳥：丸い体・小さなくちばし・羽を1枚上げて飛ぶ。"""
    a.poly([(446, 532), (356, 494), (366, 540), (452, 566)])          # 尾
    a.poly([(430, 520), (520, 474), (610, 490), (624, 552), (544, 592), (462, 574)])  # 体
    a.rect((560, 446, 652, 538), r=46)                                # 頭
    a.poly([(646, 482), (690, 498), (646, 512)])                      # くちばし
    a.poly([(482, 506), (500, 372), (600, 498)])                      # 羽


SHAPES = {"deer": reindeer, "fox": fox, "cat": cat, "song": songbird}


def silhouette(name: str, height: int, flip: bool) -> Image.Image:
    a = Shape()
    SHAPES[name](a)
    m = a.mask.crop(a.mask.getbbox())
    if flip:
        m = ImageOps.mirror(m)
    return m.resize((int(m.width * height / m.height), height), Image.LANCZOS)


def place(name, height, cx, bottom, flip=False) -> Image.Image:
    """シルエットを高さ height にして、中心 x と足元 y を指定して置いた mask を返す。"""
    m = silhouette(name, height, flip)
    out = Image.new("L", (S, S), 0)
    out.paste(m, (int(cx - m.width / 2), bottom - height))
    return out


def place_bird(name, height, cx, cy, flip=False) -> Image.Image:
    m = silhouette(name, height, flip)
    out = Image.new("L", (S, S), 0)
    out.paste(m, (int(cx - m.width / 2), int(cy - height / 2)))
    return out


def union_bbox(masks):
    union = Image.new("L", (S, S), 0)
    for m in masks:
        union.paste(255, mask=m)
    return union.getbbox()


def fit_group(masks, area):
    """全員の並びはそのままに、まとめて枠の内側いっぱいに収める（足元は下にそろえる）。"""
    x0, y0, x1, y1 = union_bbox(masks)
    k = min((area[2] - area[0]) / (x1 - x0), (area[3] - area[1]) / (y1 - y0))
    w, h = int((x1 - x0) * k), int((y1 - y0) * k)
    ox, oy = (area[0] + area[2] - w) // 2, area[3] - h
    out = []
    for m in masks:
        full = Image.new("L", (S, S), 0)
        full.paste(m.crop((x0, y0, x1, y1)).resize((w, h), Image.LANCZOS), (ox, oy))
        out.append(full)
    return out


def shadow(im: Image.Image, mask: Image.Image, off, blur, alpha) -> None:
    sh = Image.new("L", (S, S), 0)
    sh.paste(mask.point(lambda v: v * alpha // 255), off)
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    im.alpha_composite(Image.merge("RGBA", [Image.new("L", (S, S), 30)] * 3 + [sh]))


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


def rainbow_box(im: Image.Image, box) -> None:
    """四角い虹色の枠と、左上の「spot」ラベル。"""
    try:
        font = ImageFont.truetype("seguibl.ttf", FS)
    except OSError:
        font = ImageFont.truetype("arialbd.ttf", FS)
    m = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(m)
    md.rectangle(box, outline=255, width=LINE)
    tw = md.textlength("spot", font=font)
    lab = (box[0], box[1] - LABEL + LINE, box[0] + tw + 56, box[1] + LINE)
    md.rectangle(lab, fill=255)
    shadow(im, m, (0, 12), 18, 45)
    im.alpha_composite(Image.merge("RGBA", (*rainbow(box[0], box[1] - LABEL, box[2], box[3]).split(), m)))
    # 文字の見た目の上下を測って、ラベルの中央に置く（フォントで位置がずれないように）
    d = ImageDraw.Draw(im)
    bx = d.textbbox((0, 0), "spot", font=font)
    bo = d.textbbox((0, 0), "o", font=font)   # 小文字の本体（o の高さ）を中央にそろえる
    cy = (lab[1] + lab[3]) / 2 - LINE / 2
    d.text((box[0] + 28 - bx[0], cy - (bo[1] + bo[3]) / 2), "spot", font=font, fill="white")


def foreground():
    """枠と動物たちを透明な画像に描く（景色とは別にしておく）。足元の y も返す。"""
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    masks = [place(name, h, cx, bottom, flip) for name, _, h, cx, bottom, flip in ANIMALS]
    x0, y0, x1, y1 = union_bbox(masks)
    inner_w = (X1 - X0) - 2 * LINE - 2 * PAD
    h = min(560, int(inner_w * (y1 - y0) / (x1 - x0)))
    top = (S - (LABEL + 2 * LINE + 2 * PAD + h)) // 2 + LABEL + DY
    box = (X0, top, X1, top + 2 * LINE + 2 * PAD + h)
    rainbow_box(im, box)
    area = (X0 + LINE + PAD, box[1] + LINE + PAD, X1 - LINE - PAD, box[3] - LINE - PAD)
    masks = fit_group(masks, area)
    flyers = [(col, place_bird(name, bh, area[0] + fx * (area[2] - area[0]), area[1] + fy * (area[3] - area[1]), flip))
              for name, col, bh, fx, fy, flip in BIRDS]

    # 足元のうすい影（地面に立っている感じを出す）
    g = Image.new("L", (S, S), 0)
    gd = ImageDraw.Draw(g)
    for m in masks:
        bx0, _, bx1, by1 = m.getbbox()
        gd.ellipse((bx0 + 10, by1 - 12, bx1 - 10, by1 + 12), fill=255)
    g = g.filter(ImageFilter.GaussianBlur(10)).point(lambda v: v * 60 // 255)
    im.alpha_composite(Image.merge("RGBA", [Image.new("L", (S, S), 40)] * 3 + [g]))

    for col, m in [(a[1], m) for a, m in zip(ANIMALS, masks)] + flyers:
        shadow(im, m, (0, 8), 12, 30)
        # 重なっても見分けられるよう、白いふちを付けてから塗る
        edge = m.filter(ImageFilter.MaxFilter(EDGE_PX))
        im.alpha_composite(Image.merge("RGBA", [Image.new("L", (S, S), 255)] * 3 + [edge]))
        im.alpha_composite(Image.merge("RGBA", (*Image.new("RGB", (S, S), col).split(), m)))
    return im, area[3]


def background(gy: float) -> Image.Image:
    """雪山の景色（アイコン全体）。gy は動物の足元の高さで、山のすそと地面をそこに合わせる。"""
    im = Image.new("RGB", (S, S))
    d = ImageDraw.Draw(im)
    top, bot = hexrgb("#E6EEF8"), hexrgb("#FAFCFE")
    for y in range(S):
        t = y / S
        d.line((0, y, S, y), fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bot)))
    X = lambda f: f * S
    Y = lambda f: f * gy
    # 三角の山に白い雪をのせる（奥の2つはうすく、手前は少し濃く）
    for cx, peak_y, w, col in ((0.3, 0.12, 0.42, "#C9D5E6"), (0.78, 0.2, 0.36, "#C9D5E6"), (0.55, 0.36, 0.34, "#B5C4D9")):
        peak, foot = (X(cx), Y(peak_y)), Y(0.9)
        d.polygon([(X(cx - w), foot), peak, (X(cx + w), foot)], fill=col)
        s = 0.28   # 頂上から 28% までが雪
        sy = peak[1] + (foot - peak[1]) * s
        sx = (X(cx + w) - X(cx)) * s
        d.polygon([(peak[0] - sx, sy), peak, (peak[0] + sx, sy), (peak[0] + sx / 3, sy - 16),
                   (peak[0] - sx / 3, sy + 4)], fill="#FFFFFF")
    d.rectangle((0, Y(0.9), S, S), fill="#EEF2F7")
    return im


def compose(fg: Image.Image, gy: float, scale: float) -> Image.Image:
    """景色の上に枠と動物を重ねる。scale < 1 なら枠と動物だけ縮めて余白を足す（景色は全体のまま）。"""
    out = background(S / 2 + (gy - S / 2) * scale).convert("RGBA")
    n = int(S * scale)
    out.alpha_composite(fg.resize((n, n), Image.LANCZOS), ((S - n) // 2, (S - n) // 2))
    return out.convert("RGB")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    fg, gy = foreground()
    im = compose(fg, gy, 1.0)
    for name, size in (("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)):
        im.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
        print("作成:", OUT / name)
    # Android の丸や角丸で切り取られても枠が欠けないよう、絵を 80% に縮めて余白を足す
    compose(fg, gy, 0.8).resize((512, 512), Image.LANCZOS).save(OUT / "icon-maskable-512.png", optimize=True)
    print("作成:", OUT / "icon-maskable-512.png")


if __name__ == "__main__":
    main()
