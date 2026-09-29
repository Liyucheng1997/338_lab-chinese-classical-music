// 唢呐物理建模
//
// 双簧（芦苇哨）+ 圆锥形管身 + 铜喇叭碗。
//   管身：输入阻抗用一组并联的二阶谐振器表示（模态法）。圆锥管的共振峰位于 f1, 2f1, 3f1 …（全谐波，
//         这是双簧圆锥管与单簧圆柱管(奇次谐波)的本质区别）；各阶峰高、Q 值随阶数递减（辐射与壁损耗）。
//   簧片：二阶质量-弹簧动力学（共振约 9 kHz 以上仅作稳定用途）+ 准静态流量定律
//         u = ζ·A(x)·sgn(Δ)·√|Δ|，Δ = 口压 − 管内压，A = 簧片开度；每个采样点显式（牛顿法）求解
//         簧片-管身的隐式耦合，得到完整的非线性振荡（起振、粘滞/拍击、谐波）。
//   辐射：铜碗按 n^γ 加权各阶模态压力（高频辐射更强，明亮穿透），再经簧片/喇叭共振峰均衡。
// 吹奏控制：口压包络（起音/吐音/花舌）、呼吸噪声、唇/指位造成的连续音高变化（滑音、打音、颤音）。
// 环路的音高精确由 f1 决定，校准表补偿簧片对音高的牵引。

import { Biquad, RNG, Ramp, SlowNoise, clamp, smoothstep, TWO_PI } from './core.js';
import { Tuning } from './tuning.js';
import { EQChain } from './body.js';

const NMODES = 14;

/** 簧片牵引造成的音高偏差（音分，负=偏低），由 tools/calibrate.js 测得并回填。 */
export let SUONA_PITCH_CAL = [[369.99, -1.58], [392, -1.8], [415.3, -2.08], [440, -2.39], [466.16, -2.72], [493.88, -3.07], [523.25, -3.44], [554.37, -3.83], [587.33, -4.23], [622.25, -4.67], [659.26, -5.14], [698.46, -5.65], [739.99, -6.2], [783.99, -6.74], [830.61, -7.3], [880, -7.93], [932.33, -8.63], [987.77, -9.33], [1046.5, -10.03], [1108.73, -10.82], [1174.66, -11.7], [1244.51, -12.61], [1318.51, -13.53], [1396.91, -14.47], [1479.98, -15.42], [1567.98, -16.52], [1661.22, -17.71], [1760, -18.93], [1864.66, -20.31], [1975.53, -21.73], [2093, -23.11], [2217.46, -24.67], [2349.32, -26.42], [2489.02, -28.26], [2637.02, -30.19], [2793.83, -31.67]];

function interpTable(tab, f) {
  if (f <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    if (f <= tab[i][0]) {
      const x = Math.log2(f / tab[i - 1][0]) / Math.log2(tab[i][0] / tab[i - 1][0]);
      return tab[i - 1][1] + (tab[i][1] - tab[i - 1][1]) * x;
    }
  }
  return tab[tab.length - 1][1];
}

export class SuonaBore {
  constructor(fs, o = {}) {
    this.fs = fs;
    this.zeta = o.zeta ?? 0.5;
    this.Q1 = o.Q1 ?? 100;
    this.g1 = o.g1 ?? 10;
    this.gLow = o.gLow ?? 2.2;
    this.gDecay = o.gDecay ?? 4;
    this.gExp = o.gExp ?? 1.5;
    this.qDecay = o.qDecay ?? 8;
    this.inh = o.inh ?? 0.0003;
    this.gamma = o.gamma ?? 0.15;
    this.reed = new Biquad().lowpass(o.fr ?? 9000, o.qr ?? 0.6, fs);
    this.n = NMODES;
    this.b0 = new Float64Array(this.n); this.b2 = new Float64Array(this.n);
    this.a1 = new Float64Array(this.n); this.a2 = new Float64Array(this.n);
    this.y1 = new Float64Array(this.n); this.y2 = new Float64Array(this.n);
    this.wgt = new Float64Array(this.n);
    this.u1 = 0; this.u2 = 0;
    this.G = 0; this.nActive = 0;
    this.Delta = 0;
    this.setF1(440);
  }

  /** 设置管腔第一共振频率 f1（Hz）。 */
  setF1(f1) {
    const fs = this.fs;
    let G = 0, n = 0;
    for (let k = 1; k <= this.n; k++) {
      const fn = f1 * k * (1 + this.inh * k * k);
      if (fn > fs * 0.45) break;
      const Q = this.Q1 / (1 + Math.pow(k / this.qDecay, 1.6));
      const g = this.g1 / (1 + Math.pow(k / this.gDecay, this.gExp)) * (k === 1 ? this.gLow : 1);
      const w0 = TWO_PI * fn / fs, al = Math.sin(w0) / (2 * Q), c = Math.cos(w0), a0 = 1 + al;
      this.b0[n] = g * al / a0; this.b2[n] = -g * al / a0;
      this.a1[n] = -2 * c / a0; this.a2[n] = (1 - al) / a0;
      this.wgt[n] = Math.pow(k, this.gamma);
      G += this.b0[n];
      n++;
    }
    this.nActive = n;
    this.G = G;
  }

  /** 一个采样：pm 口压（含噪声）。返回辐射压力（未均衡）。 */
  tick(pm) {
    const nA = this.nActive;
    let h = 0;
    const b2 = this.b2, a1 = this.a1, a2 = this.a2, y1 = this.y1, y2 = this.y2;
    const u2 = this.u2;
    for (let k = 0; k < nA; k++) h += b2[k] * u2 - a1[k] * y1[k] - a2[k] * y2[k];
    const s = pm - h;
    // 簧片位移（滞后于压差），开度 A
    const x = this.reed.process(this.Delta);
    const A = x >= 1 ? 0 : (x < 0 ? 1 : 1 - x);
    const zA = this.zeta * A, G = this.G;
    // 牛顿法解 Δ + G·zA·sgn(Δ)√|Δ| = s（左边对 Δ 单调递增）
    let d = this.Delta;
    for (let it = 0; it < 6; it++) {
      const ad = Math.abs(d);
      const sq = Math.sqrt(ad);
      const f = d + G * zA * (d < 0 ? -sq : sq) - s;
      const df = 1 + G * zA * 0.5 / (sq + 0.02);
      let step = f / df;
      if (step > 1) step = 1; else if (step < -1) step = -1;
      d -= step;
      if (Math.abs(step) < 1e-7) break;
    }
    this.Delta = d;
    const ad = Math.abs(d);
    const u = zA * (d < 0 ? -Math.sqrt(ad) : Math.sqrt(ad));
    let rad = 0;
    const b0 = this.b0, wg = this.wgt;
    for (let k = 0; k < nA; k++) {
      const y = b0[k] * u + b2[k] * u2 - a1[k] * y1[k] - a2[k] * y2[k];
      y2[k] = y1[k]; y1[k] = y;
      rad += wg[k] * y;
    }
    this.u2 = this.u1; this.u1 = u;
    return rad;
  }
}

export class Suona {
  constructor(fs = 44100, opts = {}) {
    this.fs = fs;
    this.tuning = opts.tuning || new Tuning(62, 'equal');
    this.rng = new RNG(opts.seed ?? 4242);
    this.gain = opts.gain ?? 1.0;
    this.bore = new SuonaBore(fs, opts.bore || {});
    // 喇叭碗 + 哨片共振峰：高亢、鼻音、穿透
    this.eq = new EQChain(fs, [
      { type: 'hp', f: 230, q: 0.7 },
      { type: 'peak', f: 900, q: 1.1, gain: 2.5 },
      { type: 'peak', f: 1650, q: 1.3, gain: 3.5 },
      { type: 'peak', f: 2700, q: 1.6, gain: 2.5 },
      { type: 'peak', f: 4200, q: 1.5, gain: 1.0 },
      { type: 'hs', f: 6500, gain: -6, s: 0.8 },
      { type: 'lp', f: 11000, q: 0.7 },
    ]);
    this.noiseHP = new Biquad().highpass(1800, 0.7, fs);
    this.pmDrift = new SlowNoise(fs, 3.5, this.rng);
    this.pitchDrift = new SlowNoise(fs / 16, 1.2, this.rng);
    this.driftAmt = opts.drift ?? 1;
    this.pm = new Ramp(0);
    this.ampR = new Ramp(1);
    this.keys = []; this.keyIdx = 0;
    this.vib = null; this.flutter = null;
    this.f0Now = 440;
    this.calibrated = opts.calibrated !== false;
    this.queue = []; this.qi = 0; this.qDirty = false;
    this.pos = 0;
    this.pmSmooth = 0;
  }

  schedule(ev) {
    ev.s = Math.round(ev.t * this.fs);
    if (this.qi > 0 && this.qi === this.queue.length) { this.queue.length = 0; this.qi = 0; }
    this.queue.push(ev); this.qDirty = true;
  }
  /** 口压目标 level(0..1，对应 pm≈0.6..0.9 映射由演奏层完成)，rampSec 内线性过渡。 */
  breath(t, level, rampSec = 0.02) { this.schedule({ t, type: 'breath', level, rampSec }); }
  /** 输出音量（力度）：g 线性增益，rampSec 内线性过渡。 */
  amp(t, g, rampSec = 0.03) { this.schedule({ t, type: 'amp', g, rampSec }); }
  /** 音高关键帧（Hz），段间在对数频率上平滑过渡。 */
  pitch(t, keys) { this.schedule({ t, type: 'pitch', keys }); }
  /** 颤音（口唇/腮部）：depth 音分，同时轻微调制口压。 */
  vibrato(t, rate, depth, rampSec, durSec, ampDepth = 0.05) {
    this.schedule({ t, type: 'vib', rate, depth, rampSec, durSec, ampDepth });
  }
  /** 花舌（弹舌）：以 rate Hz 调制口压，depth 0..1。 */
  flutterTongue(t, rate, depth, durSec) { this.schedule({ t, type: 'flutter', rate, depth, durSec }); }

  _apply(ev) {
    switch (ev.type) {
      case 'breath':
        this.pm.to(ev.level, Math.max(1, Math.round(ev.rampSec * this.fs)));
        break;
      case 'amp':
        this.ampR.to(ev.g, Math.max(1, Math.round(ev.rampSec * this.fs)));
        break;
      case 'pitch': {
        this.keys = ev.keys.map(k => ({ s: ev.s + Math.round(k[0] * this.fs), c: 1200 * Math.log2(k[1] / 440) }));
        this.keyIdx = 0;
        break;
      }
      case 'vib':
        this.vib = { s0: ev.s, rate: ev.rate, depth: ev.depth, amp: ev.ampDepth, ramp: Math.max(1, Math.round(ev.rampSec * this.fs)), end: ev.s + Math.round(ev.durSec * this.fs) };
        break;
      case 'flutter':
        this.flutter = { s0: ev.s, rate: ev.rate, depth: ev.depth, end: ev.s + Math.round(ev.durSec * this.fs) };
        break;
    }
  }

  _centsAt(pos) {
    const keys = this.keys;
    let cc = null;
    if (keys.length) {
      while (this.keyIdx + 1 < keys.length && keys[this.keyIdx + 1].s <= pos) this.keyIdx++;
      const k0 = keys[this.keyIdx];
      if (this.keyIdx + 1 >= keys.length || pos <= k0.s) cc = k0.c;
      else {
        const k1 = keys[this.keyIdx + 1];
        cc = k0.c + (k1.c - k0.c) * smoothstep((pos - k0.s) / (k1.s - k0.s));
      }
    }
    return cc;
  }

  /** 吹气电平 0..1 → 口压（连续映射；约 0.6 以下低于起振阈值，声音自然消失）。 */
  static pmOf(level) { return 0.93 * clamp(level, 0, 1.02); }

  process(outL, outR, offset, count) {
    if (this.qDirty) {
      const tail = this.queue.splice(this.qi);
      tail.sort((a, b) => a.s - b.s);
      this.queue = this.queue.concat(tail);
      this.qDirty = false;
    }
    const CTRL = 16, fs = this.fs, rng = this.rng;
    for (let i = 0; i < count; i++) {
      const pos = this.pos;
      while (this.qi < this.queue.length && this.queue[this.qi].s <= pos) this._apply(this.queue[this.qi++]);
      // 控制率：音高（含颤音）→ f1
      if ((pos & (CTRL - 1)) === 0) {
        let cents = this._centsAt(pos + CTRL);
        if (cents !== null) {
          let vibAmp = 1;
          const v = this.vib;
          if (v) {
            if (pos >= v.end) this.vib = null;
            else if (pos >= v.s0) {
              const env = Math.min(1, (pos - v.s0) / v.ramp) * Math.min(1, (v.end - pos) / (0.06 * fs));
              const ph = Math.sin(TWO_PI * v.rate * (pos - v.s0) / fs);
              cents += v.depth * env * ph;
            }
          }
          cents += 1.2 * this.driftAmt * this.pitchDrift.tick();
          let f = 440 * Math.pow(2, cents / 1200);
          this.f0Now = f;
          if (this.calibrated) f *= Math.pow(2, -interpTable(SUONA_PITCH_CAL, f) / 1200);
          this.bore.setF1(f);
        }
      }
      // 口压：包络 × 颤音幅度调制 × 花舌 + 呼吸噪声
      let level = this.pm.tick();
      let pmv = Suona.pmOf(level) * (1 + 0.012 * this.driftAmt * this.pmDrift.tick());
      const v = this.vib;
      if (v && pos >= v.s0 && pos < v.end) {
        const env = Math.min(1, (pos - v.s0) / v.ramp);
        pmv *= 1 + v.amp * env * Math.sin(TWO_PI * v.rate * (pos - v.s0) / fs - 0.6);
      }
      const fl = this.flutter;
      if (fl) {
        if (pos >= fl.end) this.flutter = null;
        else if (pos >= fl.s0) {
          // 舌尖“r”颤动：口压被周期性截断；深度渐入渐出，相位从满口压开始，避免起头爆音
          const ramp = 0.04 * fs;
          const env = Math.min(1, (pos - fl.s0) / ramp) * Math.min(1, (fl.end - pos) / ramp);
          const ph = 0.5 + 0.5 * Math.cos(TWO_PI * fl.rate * (pos - fl.s0) / fs);
          pmv *= 1 - fl.depth * env * (1 - ph * ph);
        }
      }
      if (pmv > 0) pmv += pmv * 0.02 * this.noiseHP.process(rng.bipolar()) + 0.0005 * rng.bipolar();
      const y = this.eq.process(this.bore.tick(pmv)) * 0.22 * this.gain * this.ampR.tick();
      outL[offset + i] += y; outR[offset + i] += y;
      this.pos++;
    }
  }
}
