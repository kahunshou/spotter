// 画面の向きのロック中でも、スマホを横に持ったことを傾きセンサーで知る。
// 結果は「画面に対して何度回して持っているか」：0（そのまま）、90（左に倒した）、-90（右に倒した）。
// 画面そのものが回ったとき（ロックなし）は、画面と持ち方が一致するので 0 になる。

const STABLE_MS = 300;     // 回している途中でちらつかないよう、この間同じ向きなら切り替える
const MARGIN_DEG = 35;     // 0 / 90 / -90 度からこの範囲に入ったらその向きとみなす
const MIN_UPRIGHT = 0.45;  // 机に平らに置いたときなど、立っていないときは向きを変えない

function screenAngle() {
  if (typeof window.orientation === 'number') return window.orientation;   // iPhone
  const a = screen.orientation ? screen.orientation.angle : 0;
  return a > 180 ? a - 360 : a;
}

function normalize(deg) {
  let d = ((deg % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

export class Tilt {
  constructor(onChange) {
    this.onChange = onChange;
    this.rot = 0;
    this.device = null;      // 持ち方（縦に持った状態から何度回したか）
    this.timer = 0;
    this.started = false;
  }

  // iPhone ではボタンを押したその場で許可を求める必要がある（await の前に呼ぶこと）
  requestPermission() {
    const E = window.DeviceOrientationEvent;
    if (E && typeof E.requestPermission === 'function') {
      return E.requestPermission().then((r) => r === 'granted').catch(() => false);
    }
    return Promise.resolve(!!E);
  }

  start() {
    if (this.started) return;
    this.started = true;
    window.addEventListener('deviceorientation', (e) => this.onSensor(e));
    window.addEventListener('orientationchange', () => this.update());
    window.addEventListener('resize', () => this.update());
  }

  onSensor(e) {
    if (e.beta == null || e.gamma == null) return;
    const b = e.beta * Math.PI / 180;
    const g = e.gamma * Math.PI / 180;
    // 「上」の向きを端末の座標で表す（x：画面の右、y：画面の上）
    const ux = -Math.sin(g) * Math.cos(b);
    const uy = Math.sin(b);
    if (Math.hypot(ux, uy) < MIN_UPRIGHT) return;
    const theta = Math.atan2(ux, uy) * 180 / Math.PI;
    for (const target of [0, 90, -90]) {
      if (Math.abs(normalize(theta - target)) < MARGIN_DEG) {
        if (this.device !== target) {
          this.device = target;
          this.update();
        }
        return;
      }
    }
    // 逆さまやななめのときは前の向きのまま
  }

  update() {
    if (this.device == null) return;
    let rot = normalize(this.device - screenAngle());
    if (Math.abs(rot) > 135) rot = 0;   // 逆さま持ちは扱わない
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (rot !== this.rot) {
        this.rot = rot;
        this.onChange(rot);
      }
    }, STABLE_MS);
  }
}
