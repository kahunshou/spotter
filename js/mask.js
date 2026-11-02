// 非検出エリア。画面（映像の範囲）を 64×64 のマス目に分け、塗ったマスに中心がある枠は表示しない。
// 位置は映像の縦横に対する割合で持つので、解像度が変わってもそのまま使える。

const GW = 64;
const GH = 64;

export class Mask {
  constructor() {
    this.bits = new Uint8Array(GW * GH);
  }

  has(nx, ny) {
    const gx = Math.min(GW - 1, Math.max(0, Math.floor(nx * GW)));
    const gy = Math.min(GH - 1, Math.max(0, Math.floor(ny * GH)));
    return this.bits[gy * GW + gx] === 1;
  }

  isEmpty() {
    return !this.bits.includes(1);
  }

  clear() {
    this.bits.fill(0);
  }

  // (px, py) を中心に半径 radius の円を塗る（または消す）。w×h は表示している映像の大きさ。
  paint(px, py, radius, w, h, value) {
    const r2 = radius * radius;
    const gx0 = Math.max(0, Math.floor((px - radius) / w * GW));
    const gx1 = Math.min(GW - 1, Math.floor((px + radius) / w * GW));
    const gy0 = Math.max(0, Math.floor((py - radius) / h * GH));
    const gy1 = Math.min(GH - 1, Math.floor((py + radius) / h * GH));
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const cx = (gx + 0.5) / GW * w - px;
        const cy = (gy + 0.5) / GH * h - py;
        if (cx * cx + cy * cy <= r2) this.bits[gy * GW + gx] = value ? 1 : 0;
      }
    }
  }

  // 塗ったマスを (x, y, w, h) の範囲に半透明で描く
  draw(ctx, x, y, w, h, fill) {
    ctx.save();
    ctx.fillStyle = fill;
    const cw = w / GW;
    const ch = h / GH;
    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) {
        if (this.bits[gy * GW + gx]) {
          ctx.fillRect(x + gx * cw, y + gy * ch, Math.ceil(cw), Math.ceil(ch));
        }
      }
    }
    ctx.restore();
  }

  serialize() {
    let s = '';
    for (const b of this.bits) s += b;
    return s;
  }

  load(s) {
    this.clear();
    if (typeof s !== 'string' || s.length !== GW * GH) return;
    for (let i = 0; i < s.length; i++) this.bits[i] = s.charCodeAt(i) === 49 ? 1 : 0;
  }
}
