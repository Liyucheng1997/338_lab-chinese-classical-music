// 二胡物理建模
//
// 弦：弓弦摩擦的数字波导（Smith / McIntyre-Schumacher-Woodhouse 型）
//   弓把弦分成“琴码侧”和“千斤/指位侧”两段，各用一条含端点反射的往返延迟线表示；
//   弓处的摩擦为速度差的非线性函数（粘-滑），在弦上形成赫尔姆霍兹运动。
//   琴码反射：一阶低通（频率相关损耗）；指位反射：手指指腹为软终端（高频吸收更多），空弦则较硬。
//   弦长（音高）由指位连续控制——二胡无品，滑音/揉弦就是延迟线长度的连续变化。
// 琴筒：蟒皮膜 + 琴筒空腔的模态共振（鼻音/“沙”的音色核心）。
// 环路相位延迟解析扣除，基频精确落在目标音高。

import {
  DelayLine, RNG, Biquad, DCBlocker, OnePoleLP, SlowNoise, clamp, smoothstep, TWO_PI,
  phaseDelayOnePole, Ramp,
} from './core.js';
import { ResonatorBank } from './body.js';
import { Tuning } from './tuning.js';

/** 摩擦非线性造成的音高偏差（音分，正=偏高），由 tools/calibrate.js 测得并回填；按弦分别标定。 */
export const ERHU_PITCH_CAL = {
  inner: [[293.66, 0.99], [311.13, 1.17], [329.63, 1.4], [349.23, 1.68], [369.99, 1.83], [392, 1.72], [415.3, 1.49]],
  outer: [[440, 1.33], [466.16, 1.57], [493.88, 1.96], [523.25, 2.08], [554.37, 2.29], [587.33, 2.57], [622.25, 2.59], [659.26, 2.87], [698.46, 3.38], [739.99, 3.28], [783.99, 3.24], [830.61, 4.24], [880, 5.26], [932.33, 5.32], [987.77, 5.27], [1046.5, 5.63], [1108.73, 6.12], [1174.66, 6.54], [1244.51, 6.93], [1318.51, 7.39], [1396.91, 7.64], [1479.98, 7.7], [1567.98, 7.91]],
};
function interpCal(tab, f) {
  if (f <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    if (f <= tab[i][0]) {
      const x = Math.log2(f / tab[i - 1][0]) / Math.log2(tab[i][0] / tab[i - 1][0]);
      return tab[i - 1][1] + (tab[i][1] - tab[i - 1][1]) * x;
    }
  }
  return tab[tab.length - 1][1];
}

export class BowedString {
  /**
   * @param {number} fs
   * @param {number} fOpen 空弦频率
   * @param {'inner'|'outer'} kind  内弦(老弦，粗、暖) / 外弦(子弦，细、亮)
   */
  constructor(fs, fOpen, kind = 'inner') {
    this.fs = fs; this.fOpen = fOpen; this.kind = kind;
    const inner = kind === 'inner';
    // 琴码端低通极点/增益：外弦更亮
    this.pB = inner ? 0.34 : 0.26;
    this.gB = inner ? 0.9945 : 0.9930;
    // 指位端：空弦较硬；按弦时指腹吸收高频
    this.pNopen = 0.10; this.gNopen = 0.9992;
    this.pNfing = inner ? 0.42 : 0.36; this.gNfing = 0.9955;
    this.pN = this.pNfing; this.gN = this.gNfing;
    this.bridgeLine = new DelayLine(Math.ceil(fs / 90) + 32);
    this.nutLine = new DelayLine(Math.ceil(fs / 90) + 32);
    this.lpB = 0; this.lpN = 0;
    this.Db = 20; this.Dn = 100; this.DbC = 20; this.DnC = 100; this.dDb = 0; this.dDn = 0;
    this.freq = fOpen;
    // 弓相对于琴码的物理距离占空弦长的比例；二胡弓位约在弦长 1/8 处
    this.bowRatio = inner ? 0.135 : 0.125;
    this.fingered = false;
    this.energy = 0;
    this.active = false;
    this.age = 0;
    this.setFreq(fOpen, false, true);
  }

  /** 设置音高：f 为基频；fingered 是否按弦（影响指位端反射）。 */
  setFreq(f, fingered, immediate = false, controlSamples = 16) {
    if (fingered !== this.fingered) {
      this.fingered = fingered;
    }
    const pN = fingered ? this.pNfing : this.pNopen;
    const gN = fingered ? this.gNfing : this.gNopen;
    // 平滑过渡指位端滤波器（避免按/放弦瞬间爆音）
    this.pN += (pN - this.pN) * (immediate ? 1 : 0.2);
    this.gN += (gN - this.gN) * (immediate ? 1 : 0.2);
    const T = this.fs / f;
    const w = TWO_PI * f / this.fs;
    // 弓与琴码的距离固定，弦有效长度随音高缩短 → 弓位比例随音高升高
    const beta = clamp(this.bowRatio * (f / this.fOpen), 0.06, this.maxBeta ?? 0.26);
    const tauB = phaseDelayOnePole(this.pB, w);
    const tauN = phaseDelayOnePole(this.pN, w);
    const Db = beta * T - 1 - tauB;
    const Dn = (1 - beta) * T - 1 - tauN;
    this.freq = f; this.beta = beta;
    if (immediate) { this.Db = this.DbC = Db; this.Dn = this.DnC = Dn; this.dDb = this.dDn = 0; }
    else {
      this.Db = Db; this.Dn = Dn;
      this.dDb = (Db - this.DbC) / controlSamples;
      this.dDn = (Dn - this.DnC) / controlSamples;
    }
  }

  /**
   * 一个采样：vBow 弓速，slope 摩擦曲线斜率（弓压越大越小），noise 弓毛噪声。
   * 返回琴码处的输出。
   */
  tick(vBow, slope, noise) {
    if (this.dDb !== 0) { this.DbC += this.dDb; this.DnC += this.dDn; }
    else { this.DbC = this.Db; this.DnC = this.Dn; }
    const yb = this.bridgeLine.read(this.DbC);
    const yn = this.nutLine.read(this.DnC);
    this.lpB = (1 - this.pB) * yb + this.pB * this.lpB;
    this.lpN = (1 - this.pN) * yn + this.pN * this.lpN;
    const bridgeIn = -this.gB * this.lpB;
    const nutIn = -this.gN * this.lpN;
    const vs = bridgeIn + nutIn;
    const d = vBow - vs + noise;
    const t = Math.abs(slope * d) + 0.75;
    const t2 = t * t;
    let mu = 1 / (t2 * t2);
    if (mu > 1) mu = 1;
    const nv = d * mu;
    this.bridgeLine.write(nutIn + nv);
    this.nutLine.write(bridgeIn + nv);
    this.age++;
    return yb;
  }
}

/** 二胡琴筒模态（蟒皮 + 空腔），产生二胡特有的鼻音与中频共鸣。 */
export function erhuBodyModes() {
  return [
    { f: 215,  q: 5,  g: 0.30 },
    { f: 335,  q: 5,  g: 0.42 },
    { f: 480,  q: 6,  g: 0.40 },
    { f: 660,  q: 6,  g: 0.42 },
    { f: 900,  q: 7,  g: 0.62 },
    { f: 1250, q: 7,  g: 0.70 },
    { f: 1700, q: 6,  g: 0.55 },
    { f: 2300, q: 5,  g: 0.42 },
    { f: 3100, q: 5,  g: 0.28 },
    { f: 4200, q: 4,  g: 0.14 },
  ];
}

export class Erhu {
  constructor(fs = 44100, opts = {}) {
    this.fs = fs;
    this.tuning = opts.tuning || new Tuning(62, 'equal');
    this.rng = new RNG(opts.seed ?? 777);
    this.gain = opts.gain ?? 1.0;
    this.calibrated = opts.calibrated !== false;
    // 标准定弦：内弦 D4，外弦 A4
    const fD = this.tuning.freq(62), fA = this.tuning.freq(69);
    this.strings = [new BowedString(fs, fD, 'inner'), new BowedString(fs, fA, 'outer')];
    this.ctl = this.strings.map(() => ({
      vb: new Ramp(0), pr: new Ramp(0.5), gAmp: 1,
      keys: [], keyIdx: 0, baseHz: 0, vib: null, fingered: true,
      damp: 1,
    }));
    const mL = erhuBodyModes();
    const mR = erhuBodyModes().map((m, i) => ({ ...m, f: m.f * (1 + 0.01 * ((i % 3) - 1)) }));
    this.bodyL = new ResonatorBank(fs, mL, 0.55);
    this.bodyR = new ResonatorBank(fs, mR, 0.55);
    this.hp = [new Biquad().highpass(150, 0.7, fs), new Biquad().highpass(150, 0.7, fs)];
    this.lp = [new Biquad().lowpass(7200, 0.6, fs), new Biquad().lowpass(7200, 0.6, fs)];
    this.noiseHP = new Biquad().highpass(2500, 0.7, fs);
    // 演奏中的微小随机漂移：弓速 ±3%，音高 ±1.5 音分（均值为零）
    this.vbDrift = new SlowNoise(fs, 2.5, this.rng);
    this.pitchDrift = new SlowNoise(fs / 16, 0.9, this.rng);
    this.driftAmt = opts.drift ?? 1;
    this.queue = []; this.qi = 0; this.qDirty = false;
    this.pos = 0;
  }

  // ---- 事件（时间单位：秒） ----
  schedule(ev) {
    ev.s = Math.round(ev.t * this.fs);
    if (this.qi > 0 && this.qi === this.queue.length) { this.queue.length = 0; this.qi = 0; }
    this.queue.push(ev); this.qDirty = true;
  }
  /** 弓速/弓压的目标值，rampSec 内线性过渡。 */
  bow(t, str, vel, press, rampSec = 0.03) { this.schedule({ t, type: 'bow', str, vel, press, rampSec }); }
  /** 音高关键帧：keys = [[dtSec, hz], ...]，段间用平滑曲线在对数频率上内插。fingered=false 为空弦。 */
  pitch(t, str, keys, fingered = true) { this.schedule({ t, type: 'pitch', str, keys, fingered }); }
  /** 揉弦：depth 音分（峰值）、rate Hz。 */
  vibrato(t, str, rate, depth, rampSec, durSec) { this.schedule({ t, type: 'vib', str, rate, depth, rampSec, durSec }); }
  /** 立刻清空琴弦（换弦时的止音）。 */
  mute(t, str, level = 0.5) { this.schedule({ t, type: 'mute', str, level }); }

  _apply(ev) {
    const c = this.ctl[ev.str], s = this.strings[ev.str];
    switch (ev.type) {
      case 'bow':
        c.vb.to(ev.vel, Math.round(ev.rampSec * this.fs));
        c.pr.to(ev.press, Math.round(ev.rampSec * this.fs));
        if (ev.vel > 0) { s.active = true; s.age = 0; c.damp = 1; }
        break;
      case 'pitch': {
        const keys = ev.keys.map(k => ({ s: ev.s + Math.round(k[0] * this.fs), c: 1200 * Math.log2(k[1] / 440) }));
        c.keys = keys; c.keyIdx = 0; c.fingered = ev.fingered;
        if (!s.active) {
          let f0 = ev.keys[0][1];
          if (this.calibrated) f0 *= Math.pow(2, -interpCal(ev.str === 0 ? ERHU_PITCH_CAL.inner : ERHU_PITCH_CAL.outer, f0) / 1200);
          s.setFreq(f0, ev.fingered, true);
        }
        s.active = true; s.age = 0;
        break;
      }
      case 'vib':
        c.vib = { s0: ev.s, rate: ev.rate, depth: ev.depth, ramp: Math.max(1, Math.round(ev.rampSec * this.fs)), end: ev.s + Math.round(ev.durSec * this.fs) };
        break;
      case 'mute':
        c.damp = ev.level;
        break;
    }
  }

  _centsAt(c, pos) {
    const keys = c.keys;
    let cc = 0;
    if (keys.length) {
      while (c.keyIdx + 1 < keys.length && keys[c.keyIdx + 1].s <= pos) c.keyIdx++;
      const k0 = keys[c.keyIdx];
      if (c.keyIdx + 1 >= keys.length || pos <= k0.s) cc = k0.c;
      else {
        const k1 = keys[c.keyIdx + 1];
        cc = k0.c + (k1.c - k0.c) * smoothstep((pos - k0.s) / (k1.s - k0.s));
      }
    }
    if (c.vib) {
      const v = c.vib;
      if (pos >= v.end) c.vib = null;
      else if (pos >= v.s0) {
        const env = Math.min(1, (pos - v.s0) / v.ramp) * Math.min(1, (v.end - pos) / (0.08 * this.fs));
        cc += v.depth * env * Math.sin(TWO_PI * v.rate * (pos - v.s0) / this.fs);
      }
    }
    return cc;
  }

  process(outL, outR, offset, count) {
    if (this.qDirty) {
      const tail = this.queue.splice(this.qi);
      tail.sort((a, b) => a.s - b.s);
      this.queue = this.queue.concat(tail);
      this.qDirty = false;
    }
    const CTRL = 16;
    const rng = this.rng;
    for (let i = 0; i < count; i++) {
      const pos = this.pos;
      while (this.qi < this.queue.length && this.queue[this.qi].s <= pos) this._apply(this.queue[this.qi++]);
      if ((pos & (CTRL - 1)) === 0) {
        for (let k = 0; k < 2; k++) {
          const s = this.strings[k], c = this.ctl[k];
          if (!s.active || !c.keys.length) continue;
          const cents = this._centsAt(c, pos + CTRL);
          let f = 440 * Math.pow(2, (cents + 1.5 * this.driftAmt * this.pitchDrift.tick()) / 1200);
          if (this.calibrated) f *= Math.pow(2, -interpCal(k === 0 ? ERHU_PITCH_CAL.inner : ERHU_PITCH_CAL.outer, f) / 1200);
          s.setFreq(f, c.fingered, false, CTRL);
        }
      }
      let mono = 0;
      for (let k = 0; k < 2; k++) {
        const s = this.strings[k];
        if (!s.active) continue;
        const c = this.ctl[k];
        const vb = c.vb.tick() * (1 + 0.03 * this.driftAmt * this.vbDrift.tick());
        const pr = c.pr.tick();
        // 弓压→摩擦斜率：压得越重斜率越小
        const slope = 5.0 - 4.0 * pr;
        // 弓毛与松香的“沙沙”噪声，随弓速增强
        const noise = vb * 0.06 * this.noiseHP.process(rng.bipolar());
        let y = s.tick(vb, slope, noise);
        if (c.damp < 1) { s.lpB *= c.damp; s.lpN *= c.damp; }
        mono += y;
        s.energy = s.energy * 0.9995 + y * y * 0.0005;
        if (vb === 0 && s.age > 8000 && s.energy < 1e-13) s.active = false;
      }
      const x = this.lp[0].process(this.hp[0].process(mono));
      outL[offset + i] += this.bodyL.process(x) * this.gain;
      outR[offset + i] += this.bodyR.process(x) * this.gain;
      this.pos++;
    }
  }
}
