// 数字信号处理基础件：延迟线、滤波器、随机数、相位延迟解析计算。
// 全部为纯 JS，浏览器与 Node 共用。

export const TWO_PI = Math.PI * 2;

export function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
export function ftom(f) { return 69 + 12 * Math.log2(f / 440); }
export function dbToLin(db) { return Math.pow(10, db / 20); }
export function linToDb(x) { return 20 * Math.log10(Math.max(x, 1e-12)); }
export function centsBetween(f, fRef) { return 1200 * Math.log2(f / fRef); }

/** 平滑的 S 形过渡 0→1（三次 Hermite）。 */
export function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
/** 更柔和的余弦过渡 0→1。 */
export function cosStep(t) { t = clamp(t, 0, 1); return 0.5 - 0.5 * Math.cos(Math.PI * t); }

/** 确定性随机数（xorshift128+ 的 32 位版本），保证每次渲染结果完全可复现。 */
export class RNG {
  constructor(seed = 12345) {
    this.s = (seed >>> 0) || 0x9e3779b9;
  }
  /** [0,1) */
  next() {
    let x = this.s;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.s = x;
    return x / 4294967296;
  }
  /** [-1,1) */
  bipolar() { return this.next() * 2 - 1; }
  range(a, b) { return a + (b - a) * this.next(); }
  /** 近似高斯（六个均匀数之和）。 */
  gauss() {
    return (this.next() + this.next() + this.next() + this.next() + this.next() + this.next() - 3) * 1.4142;
  }
}

/**
 * 分数延迟线。写入指针先移动后写入；read(d) 读取 d 个采样之前的值（d=0 为最新写入）。
 * 分数部分使用四点三次拉格朗日插值，对慢变的延迟长度调制（颤音、滑音）无爆音。
 * 要求 d >= 1。
 */
export class DelayLine {
  constructor(maxDelay) {
    let n = 8;
    while (n < maxDelay + 8) n <<= 1;
    this.buf = new Float64Array(n);
    this.mask = n - 1;
    this.w = 0;
  }
  clear() { this.buf.fill(0); }
  write(x) {
    this.w = (this.w + 1) & this.mask;
    this.buf[this.w] = x;
  }
  /** 整数延迟读取（d 为整数 >= 0）。 */
  readInt(d) { return this.buf[(this.w - d) & this.mask]; }
  read(d) {
    const di = Math.floor(d);
    const f = d - di;
    const b = this.buf, m = this.mask, w = this.w;
    const a0 = b[(w - di + 1) & m];
    const b0 = b[(w - di) & m];
    const c0 = b[(w - di - 1) & m];
    const e0 = b[(w - di - 2) & m];
    const c1 = c0 - a0 / 3 - b0 / 2 - e0 / 6;
    const c2 = (a0 + c0) / 2 - b0;
    const c3 = (e0 - a0) / 6 + (b0 - c0) / 2;
    return ((c3 * f + c2) * f + c1) * f + b0;
  }
}

/** 一阶低通  y[n] = (1-p) x[n] + p y[n-1]，p 为极点。 */
export class OnePoleLP {
  constructor(p = 0) { this.p = p; this.z = 0; }
  setPole(p) { this.p = p; }
  setCutoff(fc, fs) { this.p = Math.exp(-TWO_PI * fc / fs); }
  reset() { this.z = 0; }
  process(x) {
    this.z = (1 - this.p) * x + this.p * this.z;
    return this.z;
  }
}

/** 直流阻断  y[n] = x[n] - x[n-1] + R y[n-1]。 */
export class DCBlocker {
  constructor(R = 0.995) { this.R = R; this.x1 = 0; this.y1 = 0; }
  reset() { this.x1 = 0; this.y1 = 0; }
  process(x) {
    const y = x - this.x1 + this.R * this.y1;
    this.x1 = x; this.y1 = y;
    return y;
  }
}

/** 一阶全通  y[n] = a x[n] + x[n-1] - a y[n-1]，H(z) = (a + z^-1)/(1 + a z^-1)。 */
export class Allpass1 {
  constructor(a = 0) { this.a = a; this.x1 = 0; this.y1 = 0; }
  reset() { this.x1 = 0; this.y1 = 0; }
  process(x) {
    const y = this.a * x + this.x1 - this.a * this.y1;
    this.x1 = x; this.y1 = y;
    return y;
  }
}

/** RBJ 双二阶滤波器（直接 II 转置）。 */
export class Biquad {
  constructor() {
    this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
    this.z1 = 0; this.z2 = 0;
  }
  reset() { this.z1 = 0; this.z2 = 0; }
  set(b0, b1, b2, a0, a1, a2) {
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  /** 频率 w (rad/sample) 处的复响应 [re, im]。 */
  response(w) {
    const c1 = Math.cos(w), s1 = -Math.sin(w), c2 = Math.cos(2 * w), s2 = -Math.sin(2 * w);
    const nr = this.b0 + this.b1 * c1 + this.b2 * c2, ni = this.b1 * s1 + this.b2 * s2;
    const dr = 1 + this.a1 * c1 + this.a2 * c2, di = this.a1 * s1 + this.a2 * s2;
    const d = dr * dr + di * di;
    return [(nr * dr + ni * di) / d, (ni * dr - nr * di) / d];
  }
  magDb(w) { const [r, i] = this.response(w); return 10 * Math.log10(r * r + i * i + 1e-30); }

  lowpass(fc, Q, fs) {
    const w = TWO_PI * fc / fs, c = Math.cos(w), al = Math.sin(w) / (2 * Q);
    return this.set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al);
  }
  highpass(fc, Q, fs) {
    const w = TWO_PI * fc / fs, c = Math.cos(w), al = Math.sin(w) / (2 * Q);
    return this.set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
  }
  /** 恒定 0dB 峰值增益的带通。 */
  bandpass(fc, Q, fs) {
    const w = TWO_PI * fc / fs, c = Math.cos(w), al = Math.sin(w) / (2 * Q);
    return this.set(al, 0, -al, 1 + al, -2 * c, 1 - al);
  }
  peaking(fc, Q, gainDb, fs) {
    const A = Math.pow(10, gainDb / 40);
    const w = TWO_PI * fc / fs, c = Math.cos(w), al = Math.sin(w) / (2 * Q);
    return this.set(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A);
  }
  highshelf(fc, gainDb, fs, S = 0.8) {
    const A = Math.pow(10, gainDb / 40);
    const w = TWO_PI * fc / fs, c = Math.cos(w), s = Math.sin(w);
    const al = s / 2 * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
    const tsa = 2 * Math.sqrt(A) * al;
    return this.set(
      A * ((A + 1) + (A - 1) * c + tsa),
      -2 * A * ((A - 1) + (A + 1) * c),
      A * ((A + 1) + (A - 1) * c - tsa),
      (A + 1) - (A - 1) * c + tsa,
      2 * ((A - 1) - (A + 1) * c),
      (A + 1) - (A - 1) * c - tsa);
  }
  lowshelf(fc, gainDb, fs, S = 0.8) {
    const A = Math.pow(10, gainDb / 40);
    const w = TWO_PI * fc / fs, c = Math.cos(w), s = Math.sin(w);
    const al = s / 2 * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
    const tsa = 2 * Math.sqrt(A) * al;
    return this.set(
      A * ((A + 1) - (A - 1) * c + tsa),
      2 * A * ((A - 1) - (A + 1) * c),
      A * ((A + 1) - (A - 1) * c - tsa),
      (A + 1) + (A - 1) * c + tsa,
      -2 * ((A - 1) + (A + 1) * c),
      (A + 1) + (A - 1) * c - tsa);
  }
}

/* ------------------------------------------------------------------ */
/* 解析相位延迟：用于把环路里所有滤波器的相位延迟从延迟线长度里扣除，       */
/* 让基频精确落在目标频率上（音准的关键）。                                */
/* ------------------------------------------------------------------ */

/** 一阶低通 (1-p)/(1-p z^-1) 在 w 处的相位延迟（采样数）。 */
export function phaseDelayOnePole(p, w) {
  // 分母 1 - p e^{-jw} 的相位为 atan2(p sin w, 1 - p cos w)，H 的相位 = -该值
  return Math.atan2(p * Math.sin(w), 1 - p * Math.cos(w)) / w;
}

/** 一阶全通 (a + z^-1)/(1 + a z^-1) 在 w 处的相位延迟（采样数），一阶全通相位在 (−π,0]。 */
export function phaseDelayAllpass1(a, w) {
  // 相位 = -w - 2*atan2(-a sin w ... ) 直接由复数求值
  const nr = a + Math.cos(w), ni = -Math.sin(w);
  const dr = 1 + a * Math.cos(w), di = -a * Math.sin(w);
  let ph = Math.atan2(ni, nr) - Math.atan2(di, dr);
  while (ph > 0) ph -= TWO_PI;
  while (ph <= -TWO_PI) ph += TWO_PI;
  return -ph / w;
}

/** 一阶全通的群/相位延迟在低频的近似 (1-a)/(1+a)。 */
export function allpassDcDelay(a) { return (1 - a) / (1 + a); }

/** 直流阻断器的相位延迟（负值：相位超前）。 */
export function phaseDelayDCBlock(R, w) {
  // H = (1 - z^-1)/(1 - R z^-1)
  const nr = 1 - Math.cos(w), ni = Math.sin(w);
  const dr = 1 - R * Math.cos(w), di = R * Math.sin(w);
  const ph = Math.atan2(ni, nr) - Math.atan2(di, dr);
  return -ph / w;
}

/** 一般双二阶的相位延迟。 */
export function phaseDelayBiquad(bq, w) {
  const [r, i] = bq.response(w);
  return -Math.atan2(i, r) / w;
}

/** 软限幅（tanh 型），保持小信号线性。 */
export function softClip(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

/** 线性斜坡平滑器。 */
export class Ramp {
  constructor(v = 0) { this.v = v; this.target = v; this.step = 0; }
  set(v) { this.v = v; this.target = v; this.step = 0; }
  to(target, samples) {
    this.target = target;
    this.step = samples > 0 ? (target - this.v) / samples : 0;
    if (samples <= 0) this.v = target;
  }
  tick() {
    if (this.step !== 0) {
      this.v += this.step;
      if ((this.step > 0 && this.v >= this.target) || (this.step < 0 && this.v <= this.target)) {
        this.v = this.target; this.step = 0;
      }
    }
    return this.v;
  }
}

/** 一阶指数平滑（每采样）。 */
export class Smooth {
  constructor(v = 0, tau = 0.01, fs = 44100) { this.v = v; this.k = 1 - Math.exp(-1 / (tau * fs)); }
  setTau(tau, fs) { this.k = 1 - Math.exp(-1 / (tau * fs)); }
  tick(target) { this.v += (target - this.v) * this.k; return this.v; }
}

/** 慢速低通噪声（近似单位方差）：用于演奏中弓速、口压、音高的微小随机漂移，避免“过于完美”的合成感。 */
export class SlowNoise {
  constructor(fs, cutoffHz, rng) {
    this.p = Math.exp(-TWO_PI * cutoffHz / fs);
    this.rng = rng;
    this.z = 0;
    // 均匀白噪声方差 1/3；一阶低通输出方差 = σ²(1-p)/(1+p)
    this.norm = 1 / Math.sqrt((1 / 3) * (1 - this.p) / (1 + this.p));
  }
  tick() {
    this.z = (1 - this.p) * this.rng.bipolar() + this.p * this.z;
    return this.z * this.norm;
  }
}
