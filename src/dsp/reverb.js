// 空间与母带：反馈延迟网络（FDN）厅堂混响、早期反射、前视限幅器。

import { DelayLine, Biquad, clamp, TWO_PI } from './core.js';

/** 8 线 FDN（Householder 反馈矩阵），带分频衰减、慢速调制和输入扩散。 */
export class Reverb {
  /**
   * @param {number} fs
   * @param {object} o { rt60: 混响时间(s), damp: 高频衰减(0..1), predelay(s), size: 房间尺度, wet, seed }
   */
  constructor(fs, o = {}) {
    this.fs = fs;
    const rt60 = o.rt60 ?? 1.9;
    this.wet = o.wet ?? 0.22;
    const size = o.size ?? 1.0;
    const base = [1553, 1877, 2153, 2473, 2801, 3187, 3517, 3931].map(v => Math.round(v * size * fs / 44100));
    this.N = 8;
    this.lines = base.map(L => new DelayLine(L + 64));
    this.len = base;
    this.g = base.map(L => Math.pow(10, -3 * L / (fs * rt60)));
    // 高频阻尼：极点越大越暗
    const damp = o.damp ?? 0.42;
    this.dp = new Float64Array(this.N).fill(damp);
    this.dz = new Float64Array(this.N);
    // 调制
    this.phase = base.map((_, i) => i * 0.7);
    this.modRate = base.map((_, i) => 0.23 + 0.07 * i);
    this.modDepth = 1.6;
    // 预延迟
    this.pre = new DelayLine(Math.ceil(fs * 0.12) + 8);
    this.preD = Math.max(1, Math.round((o.predelay ?? 0.018) * fs));
    // 输入扩散：四个串联全通
    this.diff = [113, 337, 521, 787].map(L => ({ dl: new DelayLine(Math.round(L * fs / 44100) + 8), d: Math.round(L * fs / 44100), g: 0.55 }));
    // 早期反射（左右各 6 抽头）
    const er = (arr) => arr.map(([t, a]) => ({ d: Math.round(t * fs), a }));
    this.erL = er([[0.0071, 0.55], [0.0123, -0.42], [0.0191, 0.36], [0.0263, -0.30], [0.0347, 0.24], [0.0419, -0.18]]);
    this.erR = er([[0.0089, 0.50], [0.0151, -0.40], [0.0217, 0.33], [0.0301, -0.27], [0.0383, 0.22], [0.0457, -0.16]]);
    this.erBuf = new DelayLine(Math.ceil(fs * 0.06) + 8);
    this.eLP = [new Biquad().lowpass(5200, 0.7, fs), new Biquad().lowpass(5200, 0.7, fs)];
    // 输出音色：略削低频浑浊、削高频（厅堂空气吸收）
    this.outHP = [new Biquad().highpass(160, 0.7, fs), new Biquad().highpass(160, 0.7, fs)];
    this.outLP = [new Biquad().lowpass(7500, 0.6, fs), new Biquad().lowpass(7500, 0.6, fs)];
    this.tmp = new Float64Array(this.N);
    // 输出解码符号
    this.sgnL = [1, -1, 1, -1, 1, 1, -1, -1];
    this.sgnR = [1, 1, -1, -1, -1, 1, 1, -1];
    this.outScale = 1;
    this._opts = o;
    if (o.normalize !== false) this._normalize();
  }

  /** 归一化：使单位冲激的湿声能量为 1（wet=1 时混响与直达声等能量），之后 wet 即“混响/直达”的幅度比。 */
  _normalize() {
    const t = new Reverb(this.fs, { ...this._opts, normalize: false, wet: 1 });
    const n = Math.round(this.fs * 5), o = [0, 0];
    let e = 0;
    for (let i = 0; i < n; i++) { t.tick(i === 0 ? 1 : 0, i === 0 ? 1 : 0, o); e += 0.5 * (o[0] * o[0] + o[1] * o[1]); }
    this.outScale = 1 / Math.sqrt(Math.max(e, 1e-9));
  }

  /** 处理一个采样，返回 [l, r] 的湿声（不含干声）。 */
  tick(inL, inR, out) {
    const N = this.N, fs = this.fs;
    const mono = 0.5 * (inL + inR);
    this.pre.write(mono);
    let x = this.pre.readInt(this.preD);
    // 扩散
    for (const a of this.diff) {
      const y = a.dl.readInt(a.d);
      const w = x + a.g * y;
      a.dl.write(w);
      x = y - a.g * w;
    }
    // 读取各线并调制
    const t = this.tmp;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      this.phase[i] += TWO_PI * this.modRate[i] / fs;
      const d = this.len[i] - 2 + this.modDepth * Math.sin(this.phase[i]);
      let v = this.lines[i].read(d);
      // 阻尼与衰减
      this.dz[i] = (1 - this.dp[i]) * v + this.dp[i] * this.dz[i];
      v = this.dz[i] * this.g[i];
      t[i] = v; sum += v;
    }
    const k = 2 / N * sum;
    let oL = 0, oR = 0;
    for (let i = 0; i < N; i++) {
      const fb = t[i] - k; // Householder: x - (2/N) sum
      this.lines[i].write(fb + x * (i % 2 ? 0.35 : -0.35) * 0.5);
      oL += this.sgnL[i] * t[i]; oR += this.sgnR[i] * t[i];
    }
    // 早期反射
    this.erBuf.write(mono);
    let eL = 0, eR = 0;
    for (const e of this.erL) eL += e.a * this.erBuf.readInt(e.d);
    for (const e of this.erR) eR += e.a * this.erBuf.readInt(e.d);
    const l = this.outLP[0].process(this.outHP[0].process(oL * 0.30 + this.eLP[0].process(eL) * 0.35));
    const r = this.outLP[1].process(this.outHP[1].process(oR * 0.30 + this.eLP[1].process(eR) * 0.35));
    out[0] = l; out[1] = r;
  }

  /** 整块处理：在 inL/inR 上原地混入湿声。 */
  processBlock(inL, inR, n, sendGain = 1) {
    const o = [0, 0];
    for (let i = 0; i < n; i++) {
      this.tick(inL[i] * sendGain, inR[i] * sendGain, o);
      inL[i] += o[0] * this.wet * this.outScale;
      inR[i] += o[1] * this.wet * this.outScale;
    }
  }
}

/** 前视限幅器：立即压低即将超过门限的峰值，缓慢释放，保持透明。 */
export class Limiter {
  constructor(fs, thr = 0.89, lookMs = 2.0, relMs = 90) {
    this.thr = thr;
    this.look = Math.max(1, Math.round(fs * lookMs / 1000));
    this.dlL = new DelayLine(this.look + 8); this.dlR = new DelayLine(this.look + 8);
    this.env = 0; this.gain = 1;
    this.relC = Math.exp(-1 / (fs * relMs / 1000));
    this.atkC = 1 - Math.exp(-1 / (fs * lookMs / 1000 / 3));
  }
  process(l, r, out) {
    const a = Math.max(Math.abs(l), Math.abs(r));
    this.env = a > this.env ? a : this.env * this.relC + a * (1 - this.relC);
    const target = this.env > this.thr ? this.thr / this.env : 1;
    // 增益向下快速、向上缓慢
    this.gain += (target - this.gain) * (target < this.gain ? this.atkC : 1 - this.relC);
    this.dlL.write(l); this.dlR.write(r);
    out[0] = this.dlL.readInt(this.look) * this.gain;
    out[1] = this.dlR.readInt(this.look) * this.gain;
  }
}
