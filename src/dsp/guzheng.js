// 古筝物理建模
//
// 每根弦 = 数字波导环路：
//   四点拉格朗日分数延迟线 → 一阶低通（分频衰减）→ 全通级联（弦刚度带来的微小非谐性）→ 回到延迟线
// 环路总相位延迟在基频处被解析求出并从延迟线长度中扣除，因此基频精确落在目标音高上。
// 21 根弦通过“桥”耦合：任一弦的振动经桥传给其他弦，产生同度/八度/五度的同情共鸣。
// 拨弦激励 = 升余弦脉冲 + 拨弦位置梳状滤波；输出经箱体模态滤波器组塑形。
// 左手技法：按音（音高上滑，弦张力增大）、揉弦（颤音）、回滑；右手：摇指（重复拨弦）、止音。

import {
  DelayLine, Allpass1, RNG, Biquad, DCBlocker, clamp, smoothstep, TWO_PI,
  phaseDelayOnePole, phaseDelayAllpass1,
} from './core.js';
import { ResonatorBank, guzhengBodyModes } from './body.js';
import { Tuning } from './tuning.js';

/** 21 弦标准 D 大调五声定弦（D E F# A B），D2 … D6。 */
export const GUZHENG_MIDI = (() => {
  const off = [0, 2, 4, 7, 9];
  const out = [];
  for (let oct = 0; oct < 4; oct++) for (const o of off) out.push(38 + 12 * oct + o);
  out.push(86);
  return out;
})();

/** 按 T60(低频) 与 T60(高频) 设计一阶低通损耗：返回 { g, p }。 */
export function designLoss(f0, fs, t60Lo, t60Hi, fHi) {
  const A = (t60, f) => Math.pow(10, -3 / (t60 * f0)); // 每次环路往返的幅度衰减
  const aLo = A(t60Lo, f0), aHi = A(t60Hi, fHi);
  const wLo = TWO_PI * f0 / fs, wHi = TWO_PI * fHi / fs;
  const s = (w, p) => (1 - p) / Math.sqrt(1 - 2 * p * Math.cos(w) + p * p);
  const target = aHi / aLo;
  let lo = 0, hi = 0.97;
  const ratio = p => s(wHi, p) / s(wLo, p);
  if (ratio(hi) > target) { lo = hi; } // 目标不可达，取上限
  else {
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (ratio(mid) > target) lo = mid; else hi = mid;
    }
  }
  const p = (lo + hi) / 2;
  const g = Math.min(0.99995, aLo / s(wLo, p));
  return { g, p };
}

const EX_SIZE = 8192;
const RISE = 7;

export class GuzhengString {
  constructor(fs, midi, f0, index) {
    this.fs = fs; this.midi = midi; this.f0 = f0; this.index = index;
    // 衰减：低音弦余音长，高音弦短
    this.t60Lo = clamp(5.4 * Math.pow(100 / f0, 0.5), 1.5, 5.6);
    this.t60Hi = this.t60Lo * 0.07;
    const { g, p } = designLoss(f0, fs, this.t60Lo, this.t60Hi, 4000);
    this.g = g; this.p = p;
    this.lpz = 0;
    // 弦刚度：两级全通，a<0 使高频延迟更短（高次泛音略高于整数倍）
    this.aDisp = -0.28 - 0.10 * clamp(Math.log2(f0 / 100) / 4, 0, 1);
    this.ap = [new Allpass1(this.aDisp), new Allpass1(this.aDisp)];
    this.dl = new DelayLine(Math.ceil(fs / (f0 * 0.75)) + 64);
    this.D = 100; this.Dcur = 100; this.dD = 0;
    this.cents = 0;
    this.ex = new Float64Array(EX_SIZE); this.exPos = 0;
    this.gScale = 1; this.gTarget = 1; this.gStep = 0;
    this.energy = 0;
    this.age = 0;
    this.active = false;
    this.gainCal = 1;
    // 音高控制关键帧与颤音
    this.bendKeys = []; this.bendIdx = 0; this.vib = null;
    this.setCents(0, true);
  }

  /** 设置音高偏移（音分），精确扣除环路滤波器的相位延迟。 */
  setCents(c, immediate = false) {
    const f = this.f0 * Math.pow(2, c / 1200);
    const w = TWO_PI * f / this.fs;
    const tauLoss = phaseDelayOnePole(this.p, w);
    const tauDisp = 2 * phaseDelayAllpass1(this.aDisp, w);
    const D = this.fs / f - tauLoss - tauDisp - 1; // -1：读后再写带来的单位延迟
    this.cents = c;
    if (immediate) { this.D = D; this.Dcur = D; this.dD = 0; }
    else { this.D = D; }
  }

  /** 拨弦：vel 0..1，pos 为拨点距桥的比例，bright 0..1。 */
  pluck(vel, pos, bright, rng, extraGain = 1) {
    const fs = this.fs;
    // 义甲/拨片与弦的接触很短：激励 = 被一阶低通平滑的短脉冲，截止频率随力度与“亮度”升高
    const fc = 1.7 * (2200 + 9500 * bright * bright);
    const a = Math.exp(-TWO_PI * fc / fs);
    const L = Math.min(EX_SIZE / 4, Math.ceil(9 / (1 - a)) + 6);
    const period = Math.round(fs / (this.f0 * Math.pow(2, this.cents / 1200)));
    const m = Math.max(2, Math.round(pos * period));
    const amp = vel * this.gainCal * extraGain;
    const mask = EX_SIZE - 1;
    // 两级一阶低通级联：起音边沿不再是“台阶”，而是圆润上升（-12 dB/oct），避免咔哒声
    let y1 = 0, y2 = 0;
    for (let i = 0; i < L; i++) {
      const x = i === 0 ? 1 : 0;
      y1 = (1 - a) * x + a * y1;
      y2 = (1 - a) * y1 + a * y2;
      // 指甲触弦需要约 0.15 ms 的接触上升时间：前 7 个采样按余弦窗渐入，起音不再是满幅台阶
      const rise = i >= RISE ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * (i + 0.5) / RISE);
      // 少量随机毛刺：指甲触弦的不规则性
      const v = amp * rise * (y2 + (i < 60 ? 0.10 * bright * y2 * rng.bipolar() : 0));
      this.ex[(this.exPos + i) & mask] += v;
      this.ex[(this.exPos + i + m) & mask] -= v;
    }
    this.gScale = 1; this.gTarget = 1; this.gStep = 0;
    this.active = true;
    this.age = 0;
  }

  /** 止音：在 ms 毫秒内把环路增益压低。 */
  damp(ms, level = 0.86) {
    this.gTarget = level;
    this.gStep = (level - this.gScale) / Math.max(1, ms * this.fs / 1000);
  }

  /** 把有效余音缩短为 t60eff 秒（摇指时避免能量无限堆积）。 */
  setT60(t60eff, ms) {
    const f = this.f0 * Math.pow(2, this.cents / 1200);
    const A = t => Math.pow(10, -3 / (t * f));
    const ratio = Math.min(1, A(t60eff) / A(this.t60Lo));
    this.gTarget = ratio;
    this.gStep = (ratio - this.gScale) / Math.max(1, ms * this.fs / 1000);
  }

  /** 处理一个采样，ext 为来自桥的耦合输入。返回弦在桥处的输出。 */
  tick(ext) {
    if (this.dD !== 0) this.Dcur += this.dD; else this.Dcur = this.D;
    const y = this.dl.read(this.Dcur);
    if (this.gStep !== 0) {
      this.gScale += this.gStep;
      if ((this.gStep < 0 && this.gScale <= this.gTarget) || (this.gStep > 0 && this.gScale >= this.gTarget)) {
        this.gScale = this.gTarget; this.gStep = 0;
      }
    }
    this.lpz = (1 - this.p) * y + this.p * this.lpz;
    let s = this.lpz * this.g * this.gScale;
    s = this.ap[0].process(s);
    s = this.ap[1].process(s);
    const e = this.ex[this.exPos]; this.ex[this.exPos] = 0;
    this.exPos = (this.exPos + 1) & (EX_SIZE - 1);
    this.dl.write(s + e + ext);
    this.age++;
    return y;
  }
}

export class Guzheng {
  /**
   * @param {number} fs 采样率
   * @param {object} opts { tuning, seed, sympathy, brightness }
   */
  constructor(fs = 44100, opts = {}) {
    this.fs = fs;
    this.tuning = opts.tuning || new Tuning(62, 'equal');
    this.rng = new RNG(opts.seed ?? 20240607);
    this.sympathy = opts.sympathy ?? 0.00035;
    this.brightness = opts.brightness ?? 0.55;
    this.gain = opts.gain ?? 1.0;
    this.strings = GUZHENG_MIDI.map((m, i) => new GuzhengString(fs, m, this.tuning.freq(m), i));
    this.n = this.strings.length;
    // 声像：低音偏左、高音偏右，幅度不大（约 ±0.42）
    this.panL = new Float64Array(this.n); this.panR = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const x = -0.42 + 0.84 * i / (this.n - 1);
      const a = (x + 1) * Math.PI / 4;
      this.panL[i] = Math.cos(a); this.panR[i] = Math.sin(a);
    }
    // 箱体：左右各一组，模态频率略有差异（相当于双话筒）以增加宽度
    const mL = guzhengBodyModes();
    const mR = guzhengBodyModes().map((m, i) => ({ ...m, f: m.f * (1 + 0.012 * ((i % 3) - 1)), g: m.g * 0.97 }));
    this.bodyL = new ResonatorBank(fs, mL, 1.0);
    this.bodyR = new ResonatorBank(fs, mR, 1.0);
    this.dcL = new DCBlocker(0.9975); this.dcR = new DCBlocker(0.9975);
    this.toneL = new Biquad().highshelf(5500, -3.5, fs); this.toneR = new Biquad().highshelf(5500, -3.5, fs);
    this.bridgeLP = 0;
    this.bridgeDC = new DCBlocker(0.994);
    this.queue = []; this.qi = 0; this.qDirty = false;
    this.pos = 0;
    this.clickState = { l: 0, r: 0 };
    this._calibrate();
  }

  /** 让 21 根弦拨响后的响度一致（按 A 计权的一个简单趋势微调）。 */
  _calibrate() {
    const fs = this.fs, N = Math.round(fs * 0.25);
    const rng = new RNG(99);
    for (const s of this.strings) {
      s.gainCal = 1;
      // 用独立的副本弦测量
      const t = new GuzhengString(fs, s.midi, s.f0, s.index);
      t.pluck(0.8, 0.22, 0.5, rng);
      let sum = 0;
      for (let i = 0; i < N; i++) { const y = t.tick(0); sum += y * y; }
      const r = Math.sqrt(sum / N) + 1e-9;
      const target = 0.06 * Math.pow(s.f0 / 440, -0.10);
      s.gainCal = clamp(target / r, 0.2, 8);
    }
  }

  /**
   * 音高（MIDI，可含小数）→ { string, cents }。
   * 选择“不高于目标、且最近”的一根弦，音高差靠左手按音补上；cents 用调律体系的频率精确计算。
   */
  findString(midiFloat, maxPress = 3.2) {
    let cand = -1, dmin = 1e9;
    for (let i = 0; i < this.n; i++) {
      const d = midiFloat - GUZHENG_MIDI[i];
      if (d >= -0.05 && d <= maxPress && Math.abs(d) < dmin) { dmin = Math.abs(d); cand = i; }
    }
    if (cand < 0) return null;
    const fT = this.tuning.freqFrac(midiFloat);
    return { string: cand, cents: 1200 * Math.log2(fT / this.strings[cand].f0) };
  }

  // ---- 事件调度（时间单位：秒） ----
  schedule(ev) {
    ev.s = Math.round(ev.t * this.fs);
    if (this.qi > 0 && this.qi === this.queue.length) { this.queue.length = 0; this.qi = 0; }
    this.queue.push(ev);
    this.qDirty = true;
  }

  /** 拨弦：opts { pos, bright, cents(初始按音音分), extraGain } */
  pluck(t, stringIdx, vel, opts = {}) {
    this.schedule({ t, type: 'pluck', string: stringIdx, vel, ...opts });
  }
  /** 音高关键帧：keys = [[dtSec, cents], ...]，相对 t，之间用平滑曲线插值。 */
  bend(t, stringIdx, keys) {
    this.schedule({ t, type: 'bend', string: stringIdx, keys });
  }
  /** 颤音（揉弦）：depth 音分、rate Hz，从 t 开始，rampSec 渐入，durSec 后结束。 */
  vibrato(t, stringIdx, rate, depth, rampSec, durSec) {
    this.schedule({ t, type: 'vib', string: stringIdx, rate, depth, rampSec, durSec });
  }
  damp(t, stringIdx, ms = 30, level = 0.84) {
    this.schedule({ t, type: 'damp', string: stringIdx, ms, level });
  }
  /** 把某弦的有效 T60 缩短到 t60eff 秒（摇指用）。 */
  shortenT60(t, stringIdx, t60eff, ms = 20) {
    this.schedule({ t, type: 'dampT60', string: stringIdx, t60eff, ms });
  }

  _apply(ev) {
    const s = this.strings[ev.string];
    switch (ev.type) {
      case 'pluck': {
        // 新拨弦：以起始按音为基准，清除旧的音高包络
        s.bendKeys = []; s.bendIdx = 0; s.vib = null;
        s.setCents(ev.cents || 0, true);
        s.baseCents = ev.cents || 0;
        const pos = ev.pos ?? (0.16 + 0.10 * this.rng.next());
        const bright = clamp((ev.bright ?? this.brightness) * (0.55 + 0.6 * ev.vel), 0, 1);
        s.pluck(ev.vel, pos, bright, this.rng, ev.extraGain ?? 1);
        // 指甲拨弦的瞬态“咔”声（进输出，不进弦）
        this._click(ev.string, ev.vel);
        break;
      }
      case 'bend': {
        const base = ev.s;
        const keys = ev.keys.map(k => ({ s: base + Math.round(k[0] * this.fs), c: k[1] }));
        s.bendKeys = keys; s.bendIdx = 0;
        break;
      }
      case 'vib':
        s.vib = {
          s0: ev.s, rate: ev.rate, depth: ev.depth,
          ramp: Math.max(1, Math.round(ev.rampSec * this.fs)),
          end: ev.s + Math.round(ev.durSec * this.fs),
        };
        break;
      case 'damp':
        s.damp(ev.ms, ev.level);
        break;
      case 'dampT60':
        s.setT60(ev.t60eff, ev.ms);
        break;
    }
  }

  _click(stringIdx, vel) {
    // 短促的带通噪声脉冲，模拟义甲触弦声
    const a = 0.012 * vel * vel;
    this.clickState.l += a * this.panL[stringIdx] * this.rng.bipolar() * 6;
    this.clickState.r += a * this.panR[stringIdx] * this.rng.bipolar() * 6;
  }

  /** 弦当前应有的音高偏移（关键帧 + 颤音）。 */
  _centsAt(s, pos) {
    let c = s.baseCents || 0;
    const keys = s.bendKeys;
    if (keys.length) {
      while (s.bendIdx + 1 < keys.length && keys[s.bendIdx + 1].s <= pos) s.bendIdx++;
      const k0 = keys[s.bendIdx];
      if (pos < keys[0].s) c = (s.baseCents || 0);
      else if (s.bendIdx + 1 >= keys.length) c = k0.c;
      else {
        const k1 = keys[s.bendIdx + 1];
        c = k0.c + (k1.c - k0.c) * smoothstep((pos - k0.s) / (k1.s - k0.s));
      }
    }
    if (s.vib) {
      const v = s.vib;
      if (pos >= v.end) s.vib = null;
      else if (pos >= v.s0) {
        const env = Math.min(1, (pos - v.s0) / v.ramp) * Math.min(1, (v.end - pos) / (0.15 * this.fs));
        c += v.depth * env * Math.sin(TWO_PI * v.rate * (pos - v.s0) / this.fs);
      }
    }
    return c;
  }

  /** 渲染 count 个采样到 outL/outR（从 offset 起，累加输出）。 */
  process(outL, outR, offset, count) {
    if (this.qDirty) {
      const tail = this.queue.splice(this.qi);
      tail.sort((a, b) => a.s - b.s);
      this.queue = this.queue.concat(tail);
      this.qDirty = false;
    }
    const strings = this.strings, n = this.n;
    const CTRL = 16;
    const eps = this.sympathy;
    let bridge = this.bridgeLP;
    for (let i = 0; i < count; i++) {
      const pos = this.pos;
      // 事件
      while (this.qi < this.queue.length && this.queue[this.qi].s <= pos) this._apply(this.queue[this.qi++]);
      // 控制率更新：音高调制
      if ((pos & (CTRL - 1)) === 0) {
        for (let k = 0; k < n; k++) {
          const s = strings[k];
          if (!s.active) continue;
          if (s.bendKeys.length || s.vib) {
            const c = this._centsAt(s, pos + CTRL);
            const oldD = s.D;
            s.setCents(c, false);
            s.dD = (s.D - s.Dcur) / CTRL;
          } else if (s.dD !== 0) { s.dD = 0; }
        }
      }
      const couple = eps * this.bridgeDC.process(bridge);
      let l = this.clickState.l, r = this.clickState.r;
      this.clickState.l *= 0.86; this.clickState.r *= 0.86;
      let sum = 0;
      for (let k = 0; k < n; k++) {
        const s = strings[k];
        if (!s.active) continue;
        const y = s.tick(couple);
        sum += y;
        l += y * this.panL[k]; r += y * this.panR[k];
        // 能量监测：衰减到听不见时休眠
        s.energy = s.energy * 0.9995 + y * y * 0.0005;
        if (s.age > 4 * s.Dcur + 4096 && s.energy < 1e-14 && Math.abs(couple) < 1e-9) s.active = false;
      }
      // 桥处的低通（桥的质量），一采样延迟避免代数环
      bridge += 0.35 * (sum - bridge);
      // 大信号时唤醒所有弦（同情共鸣），小信号时保持休眠
      if (Math.abs(bridge) > 4e-4) {
        for (let k = 0; k < n; k++) strings[k].active = true;
      }
      // 箱体
      let ol = this.bodyL.process(this.dcL.process(l));
      let or = this.bodyR.process(this.dcR.process(r));
      ol = this.toneL.process(ol); or = this.toneR.process(or);
      outL[offset + i] += ol * this.gain;
      outR[offset + i] += or * this.gain;
      this.pos++;
    }
    this.bridgeLP = bridge;
  }
}
