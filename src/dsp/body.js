// 共鸣体：模态滤波器组（每个模态是一个二阶带通谐振器）。
// 用来表示古筝共鸣箱、二胡蟒皮筒、唢呐铜碗的共振特性。

import { Biquad } from './core.js';

export class ResonatorBank {
  /**
   * @param {number} fs
   * @param {Array<{f:number,q:number,g:number}>} modes  频率 Hz、品质因数、增益（线性）
   * @param {number} dry 直达声增益
   */
  constructor(fs, modes, dry = 1) {
    this.fs = fs;
    this.dry = dry;
    this.filters = modes.map(m => new Biquad().bandpass(m.f, m.q, fs));
    this.gains = modes.map(m => m.g);
    this.n = modes.length;
  }
  reset() { for (const f of this.filters) f.reset(); }
  process(x) {
    let y = x * this.dry;
    for (let i = 0; i < this.n; i++) y += this.gains[i] * this.filters[i].process(x);
    return y;
  }
  /** 频率响应幅度 (dB)，用于检查设计。 */
  magDb(f) {
    const w = 2 * Math.PI * f / this.fs;
    let re = this.dry, im = 0;
    for (let i = 0; i < this.n; i++) {
      const [r, m] = this.filters[i].response(w);
      re += this.gains[i] * r; im += this.gains[i] * m;
    }
    return 10 * Math.log10(re * re + im * im + 1e-30);
  }
}

/** 串联均衡器：一组峰值/搁架滤波器依次处理。 */
export class EQChain {
  constructor(fs, bands) {
    this.fs = fs;
    this.filters = bands.map(b => {
      const f = new Biquad();
      switch (b.type) {
        case 'peak': f.peaking(b.f, b.q ?? 1, b.gain, fs); break;
        case 'hs': f.highshelf(b.f, b.gain, fs, b.s ?? 0.8); break;
        case 'ls': f.lowshelf(b.f, b.gain, fs, b.s ?? 0.8); break;
        case 'lp': f.lowpass(b.f, b.q ?? 0.707, fs); break;
        case 'hp': f.highpass(b.f, b.q ?? 0.707, fs); break;
        default: throw new Error('unknown band ' + b.type);
      }
      return f;
    });
  }
  reset() { for (const f of this.filters) f.reset(); }
  process(x) {
    for (let i = 0; i < this.filters.length; i++) x = this.filters[i].process(x);
    return x;
  }
  magDb(f) {
    const w = 2 * Math.PI * f / this.fs;
    let db = 0;
    for (const b of this.filters) db += b.magDb(w);
    return db;
  }
}

/** 古筝共鸣箱：长条形桐木面板，低频丰满、木质温暖；模态频率参考实测古筝面板/箱腔共振。 */
export function guzhengBodyModes() {
  return [
    { f: 98,   q: 9,  g: 0.55 },
    { f: 143,  q: 11, g: 0.55 },
    { f: 205,  q: 13, g: 0.50 },
    { f: 276,  q: 15, g: 0.44 },
    { f: 352,  q: 16, g: 0.40 },
    { f: 447,  q: 18, g: 0.34 },
    { f: 541,  q: 20, g: 0.30 },
    { f: 668,  q: 22, g: 0.26 },
    { f: 812,  q: 22, g: 0.21 },
    { f: 985,  q: 24, g: 0.18 },
    { f: 1180, q: 26, g: 0.15 },
    { f: 1450, q: 28, g: 0.12 },
    { f: 1800, q: 28, g: 0.09 },
  ];
}
