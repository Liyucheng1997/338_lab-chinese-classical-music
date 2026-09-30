// 琵琶物理建模
//
// 四根弦（缠弦 A2、老弦 D3、中弦 E3、子弦 A3，现代标准定弦 A d e a），每根弦是一条数字波导环路：
//   四点拉格朗日分数延迟线 → 一阶低通（分频衰减）→ 两级全通（钢丝弦的刚度 → 轻微非谐）→ 回到延迟线。
// 与古筝相同，环路滤波器在基频处的相位延迟被解析扣除，音高精确落在按品后的目标频率上。
// 左手按“相”“品”取音：弦的有效长度改变 = 音分偏移；推拉（推弦升高）、吟揉（颤音）为连续音高关键帧。
// 右手戴义甲在“覆手”上方拨弦：激励 = 很短的指甲脉冲 + 拨弦位置梳状滤波（靠近覆手 → 泛音丰富、音色“脆”）。
// 箱体：梨形桐木面板 + 背板的模态滤波器组；四弦经覆手耦合，产生同情共鸣。
// 特殊技法：绞弦（子弦、中弦绞在一起互相撞击，金属噪声）、泛音、拍面板、煞音（按弦止振）。

import {
  DelayLine, Allpass1, RNG, Biquad, DCBlocker, clamp, smoothstep, TWO_PI,
  phaseDelayOnePole, phaseDelayAllpass1,
} from './core.js';
import { ResonatorBank } from './body.js';
import { Tuning } from './tuning.js';
import { designLoss } from './guzheng.js';

/** 空弦（第 1 弦 = 子弦，最高）：子 A3、中 E3、老 D3、缠 A2。 */
export const PIPA_OPEN = [57, 52, 50, 45];
export const PIPA_STRING_NAMES = ['子弦', '中弦', '老弦', '缠弦'];
/** 每根弦可按到的最高半音数（六相二十四品；子弦可再往上按到品外）。 */
export const PIPA_MAX_FRET = [28, 24, 24, 24];

const EX_SIZE = 8192;

/** 琵琶箱体（背板、面板与腔体）模态：较古筝小而亮，低频薄，中高频有明显的“木声”峰。 */
export function pipaBodyModes() {
  return [
    { f: 128,  q: 10, g: 0.30 },
    { f: 196,  q: 12, g: 0.45 },
    { f: 262,  q: 14, g: 0.50 },
    { f: 348,  q: 15, g: 0.46 },
    { f: 455,  q: 16, g: 0.40 },
    { f: 590,  q: 18, g: 0.36 },
    { f: 740,  q: 20, g: 0.30 },
    { f: 930,  q: 22, g: 0.26 },
    { f: 1180, q: 24, g: 0.22 },
    { f: 1520, q: 26, g: 0.18 },
    { f: 1960, q: 26, g: 0.14 },
    { f: 2600, q: 24, g: 0.10 },
  ];
}

export class PipaString {
  constructor(fs, midi, f0, index) {
    this.fs = fs; this.midi = midi; this.f0 = f0; this.index = index;
    // 钢丝弦：低音弦余音较长，被按住的弦（手指与品接触）衰减更快
    this.t60Open = clamp(3.4 * Math.pow(110 / f0, 0.35), 1.4, 3.6);
    this.aDisp = -0.3 - 0.04 * index;
    this.ap = [new Allpass1(this.aDisp), new Allpass1(this.aDisp)];
    this.dl = new DelayLine(Math.ceil(fs / (f0 * 0.8)) + 64);
    this.D = 100; this.Dcur = 100; this.dD = 0;
    this.cents = 0; this.baseCents = 0;
    this.p = 0.3; this.g = 0.999; this.lpz = 0;
    this.ex = new Float64Array(EX_SIZE); this.exPos = 0;
    this.gScale = 1; this.gTarget = 1; this.gStep = 0;
    this.energy = 0; this.age = 0; this.active = false;
    this.gainCal = 1;
    this.bendKeys = []; this.bendIdx = 0; this.vib = null;
    this.fretCents = -1;
    this.setFret(0);
    this.setCents(0, true);
  }

  /** 按品：cents 为相对空弦的音分。弦长变短 → 高频损耗变化；被按住时手指略增阻尼。 */
  setFret(cents) {
    const key = Math.round(cents / 25);
    if (key === this.fretCents) return;
    this.fretCents = key;
    const f = this.f0 * Math.pow(2, cents / 1200);
    const fretted = cents > 40;
    const t60 = this.t60Open * Math.pow(this.f0 / f, 0.42) * (fretted ? 0.78 : 1);
    // 高把位的短弦仍然很“脆”：高频相对衰减随音高减轻
    const hiRatio = clamp(0.05 * Math.pow(f / 110, 0.7), 0.05, 0.42);
    const { g, p } = designLoss(f, this.fs, t60, t60 * hiRatio, 6000);
    this.g = g; this.p = p;
  }

  setCents(c, immediate = false) {
    const f = this.f0 * Math.pow(2, c / 1200);
    const w = TWO_PI * f / this.fs;
    const tauLoss = phaseDelayOnePole(this.p, w);
    const tauDisp = 2 * phaseDelayAllpass1(this.aDisp, w);
    const D = this.fs / f - tauLoss - tauDisp - 1;
    this.cents = c;
    if (immediate) { this.D = D; this.Dcur = D; this.dD = 0; } else this.D = D;
  }

  /**
   * 拨弦：vel 0..1；pos 为拨点距覆手的比例；bright 0..1；
   * harm > 1 时为泛音：左手轻触 1/harm 节点，只保留该节点的倍频（用激励梳状滤波近似）。
   */
  pluck(vel, pos, bright, rng, extraGain = 1, harm = 0) {
    const fs = this.fs;
    const fc = harm > 1 ? 1800 + 1500 * bright : 3200 + 14000 * bright * bright;
    const a = Math.exp(-TWO_PI * fc / fs);
    const L = Math.min(EX_SIZE / 4, Math.ceil(9 / (1 - a)) + 6);
    const period = fs / (this.f0 * Math.pow(2, this.cents / 1200));
    const m = Math.max(2, Math.round(pos * period));
    const amp = vel * this.gainCal * extraGain;
    const mask = EX_SIZE - 1;
    const RISE = 5;
    let y1 = 0, y2 = 0;
    for (let i = 0; i < L; i++) {
      const x = i === 0 ? 1 : 0;
      y1 = (1 - a) * x + a * y1;
      y2 = (1 - a) * y1 + a * y2;
      const rise = i >= RISE ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * (i + 0.5) / RISE);
      const v = amp * rise * (y2 + (i < 40 ? 0.14 * bright * y2 * rng.bipolar() : 0));
      this.ex[(this.exPos + i) & mask] += v;
      this.ex[(this.exPos + i + m) & mask] -= v;
      if (harm > 1) {
        // 泛音：节点处轻触 → 周期为 period/harm 的梳状结构，基频及非倍频成分被抵消
        const hp = Math.round(period / harm);
        for (let k = 1; k < harm; k++) {
          this.ex[(this.exPos + i + k * hp) & mask] += v;
          this.ex[(this.exPos + i + k * hp + m) & mask] -= v;
        }
      }
    }
    this.gScale = 1; this.gTarget = 1; this.gStep = 0;
    this.active = true;
    this.age = 0;
  }

  damp(ms, level = 0.86) {
    this.gTarget = level;
    this.gStep = (level - this.gScale) / Math.max(1, ms * this.fs / 1000);
  }

  /** 把有效余音缩短为 t60eff 秒（轮指、滚奏时避免能量无限堆积）。 */
  setT60(t60eff, ms) {
    const f = this.f0 * Math.pow(2, this.cents / 1200);
    const A = t => Math.pow(10, -3 / (t * f));
    const ratio = Math.min(1, A(t60eff) / A(this.t60Open));
    this.gTarget = ratio;
    this.gStep = (ratio - this.gScale) / Math.max(1, ms * this.fs / 1000);
  }

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

export class Pipa {
  /**
   * @param {number} fs
   * @param {object} opts { tuning, seed, sympathy, brightness, gain }
   */
  constructor(fs = 44100, opts = {}) {
    this.fs = fs;
    this.tuning = opts.tuning || new Tuning(62, 'equal');
    this.rng = new RNG(opts.seed ?? 19620511);
    this.sympathy = opts.sympathy ?? 0.0006;
    this.brightness = opts.brightness ?? 0.62;
    this.gain = opts.gain ?? 1.0;
    this.strings = PIPA_OPEN.map((m, i) => new PipaString(fs, m, this.tuning.freq(m), i));
    this.n = 4;
    // 琵琶竖抱，声像集中；四弦只有很小的左右差
    this.panL = new Float64Array(4); this.panR = new Float64Array(4);
    for (let i = 0; i < 4; i++) {
      const x = 0.12 - 0.08 * i;
      const a = (x + 1) * Math.PI / 4;
      this.panL[i] = Math.cos(a); this.panR[i] = Math.sin(a);
    }
    const mL = pipaBodyModes();
    const mR = pipaBodyModes().map((m, i) => ({ ...m, f: m.f * (1 + 0.014 * ((i % 3) - 1)), g: m.g * 0.96 }));
    this.bodyL = new ResonatorBank(fs, mL, 1.0);
    this.bodyR = new ResonatorBank(fs, mR, 1.0);
    this.dcL = new DCBlocker(0.997); this.dcR = new DCBlocker(0.997);
    // 义甲的“脆”：2–4 kHz 抬升，极高频略收
    this.presL = new Biquad().peaking(2900, 0.9, 3.5, fs); this.presR = new Biquad().peaking(2900, 0.9, 3.5, fs);
    this.toneL = new Biquad().highshelf(7500, -4, fs); this.toneR = new Biquad().highshelf(7500, -4, fs);
    this.lowL = new Biquad().highpass(70, 0.7, fs); this.lowR = new Biquad().highpass(70, 0.7, fs);
    this.bridgeDC = new DCBlocker(0.994);
    this.bridgeLP = 0;
    this.queue = []; this.qi = 0; this.qDirty = false;
    this.pos = 0;
    this.click = { l: 0, r: 0 };
    // 绞弦：两弦相撞的噪声（带通），包络由演奏层控制
    this.rattle = { env: 0, decay: 0, bp1: new Biquad().bandpass(2400, 1.4, fs), bp2: new Biquad().bandpass(5200, 1.8, fs), am: 0, amRate: 0 };
    // 拍面板：箱体受击
    this.knock = { l: 0, r: 0 };
    this._calibrate();
  }

  _calibrate() {
    const fs = this.fs, N = Math.round(fs * 0.25);
    const rng = new RNG(97);
    for (const s of this.strings) {
      const t = new PipaString(fs, s.midi, s.f0, s.index);
      t.pluck(0.8, 0.14, 0.5, rng);
      let sum = 0;
      for (let i = 0; i < N; i++) { const y = t.tick(0); sum += y * y; }
      const r = Math.sqrt(sum / N) + 1e-9;
      s.gainCal = clamp(0.06 * Math.pow(s.f0 / 220, -0.12) / r, 0.2, 8);
    }
  }

  /** 音高 → 可选的（弦，音分）列表，按把位由低到高。 */
  candidates(midiFloat) {
    const out = [];
    for (let i = 0; i < 4; i++) {
      const d = midiFloat - PIPA_OPEN[i];
      if (d >= -0.05 && d <= PIPA_MAX_FRET[i] + 0.5) {
        const fT = this.tuning.freqFrac(midiFloat);
        out.push({ string: i, semis: d, cents: 1200 * Math.log2(fT / this.strings[i].f0) });
      }
    }
    return out.sort((a, b) => a.semis - b.semis);
  }

  /** 选弦：优先子弦（音色最亮、旋律弦），超出低把位（>9 半音）时才用下一根更低的弦。 */
  findString(midiFloat) {
    const c = this.candidates(midiFloat);
    if (!c.length) return null;
    const pref = c.find(x => x.string === 0) || c.find(x => x.semis <= 9) || c[0];
    return pref;
  }

  schedule(ev) {
    ev.s = Math.round(ev.t * this.fs);
    if (this.qi > 0 && this.qi === this.queue.length) { this.queue.length = 0; this.qi = 0; }
    this.queue.push(ev);
    this.qDirty = true;
  }

  /** 拨弦：opts { cents(按品), pos, bright, extraGain, harm(泛音倍数) } */
  pluck(t, stringIdx, vel, opts = {}) { this.schedule({ t, type: 'pluck', string: stringIdx, vel, ...opts }); }
  /** 音高关键帧（推拉、滑音）：keys = [[dtSec, cents], ...]，相对 t。 */
  bend(t, stringIdx, keys) { this.schedule({ t, type: 'bend', string: stringIdx, keys }); }
  /** 吟揉（颤音）。 */
  vibrato(t, stringIdx, rate, depth, rampSec, durSec) { this.schedule({ t, type: 'vib', string: stringIdx, rate, depth, rampSec, durSec }); }
  damp(t, stringIdx, ms = 30, level = 0.84) { this.schedule({ t, type: 'damp', string: stringIdx, ms, level }); }
  shortenT60(t, stringIdx, t60eff, ms = 20) { this.schedule({ t, type: 'dampT60', string: stringIdx, t60eff, ms }); }
  /** 绞弦撞击噪声：vel 力度，decay 衰减时间常数(s)，beat 两弦拍频(Hz)。 */
  rattleHit(t, vel, decay = 0.12, beat = 23) { this.schedule({ t, type: 'rattle', vel, decay, beat }); }
  /** 拍面板（“拍”“碰”）：箱体受击的木声。 */
  knockHit(t, vel) { this.schedule({ t, type: 'knock', vel }); }

  _apply(ev) {
    if (ev.type === 'rattle') {
      const r = this.rattle;
      r.env = Math.max(r.env, 0.9 * ev.vel);
      r.decay = Math.exp(-1 / (Math.max(0.01, ev.decay) * this.fs));
      r.amRate = ev.beat;
      return;
    }
    if (ev.type === 'knock') {
      const a = 0.35 * ev.vel;
      this.knock.l += a; this.knock.r += a * 0.93;
      return;
    }
    const s = this.strings[ev.string];
    switch (ev.type) {
      case 'pluck': {
        s.bendKeys = []; s.bendIdx = 0; s.vib = null;
        const c = ev.cents || 0;
        s.setFret(c);
        s.setCents(c, true);
        s.baseCents = c;
        const pos = ev.pos ?? (0.09 + 0.06 * this.rng.next());
        const bright = clamp((ev.bright ?? this.brightness) * (0.6 + 0.55 * ev.vel), 0, 1);
        s.pluck(ev.vel, pos, bright, this.rng, ev.extraGain ?? 1, ev.harm || 0);
        const a = (ev.harm ? 0.004 : 0.016) * ev.vel * ev.vel;
        this.click.l += a * this.panL[ev.string] * this.rng.bipolar() * 6;
        this.click.r += a * this.panR[ev.string] * this.rng.bipolar() * 6;
        break;
      }
      case 'bend': {
        const base = ev.s;
        s.bendKeys = ev.keys.map(k => ({ s: base + Math.round(k[0] * this.fs), c: k[1] }));
        s.bendIdx = 0;
        break;
      }
      case 'vib':
        s.vib = { s0: ev.s, rate: ev.rate, depth: ev.depth, ramp: Math.max(1, Math.round(ev.rampSec * this.fs)), end: ev.s + Math.round(ev.durSec * this.fs) };
        break;
      case 'damp': s.damp(ev.ms, ev.level); break;
      case 'dampT60': s.setT60(ev.t60eff, ev.ms); break;
    }
  }

  _centsAt(s, pos) {
    let c = s.baseCents || 0;
    const keys = s.bendKeys;
    if (keys.length) {
      while (s.bendIdx + 1 < keys.length && keys[s.bendIdx + 1].s <= pos) s.bendIdx++;
      const k0 = keys[s.bendIdx];
      if (pos < keys[0].s) c = s.baseCents || 0;
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
        const env = Math.min(1, (pos - v.s0) / v.ramp) * Math.min(1, (v.end - pos) / (0.1 * this.fs));
        // 琵琶吟揉是推弦式的：音高只向上偏
        c += v.depth * env * (0.5 - 0.5 * Math.cos(TWO_PI * v.rate * (pos - v.s0) / this.fs));
      }
    }
    return c;
  }

  process(outL, outR, offset, count) {
    if (this.qDirty) {
      const tail = this.queue.splice(this.qi);
      tail.sort((a, b) => a.s - b.s);
      this.queue = this.queue.concat(tail);
      this.qDirty = false;
    }
    const strings = this.strings, n = this.n, CTRL = 16, eps = this.sympathy;
    const r = this.rattle, rng = this.rng, fs = this.fs;
    let bridge = this.bridgeLP;
    for (let i = 0; i < count; i++) {
      const pos = this.pos;
      while (this.qi < this.queue.length && this.queue[this.qi].s <= pos) this._apply(this.queue[this.qi++]);
      if ((pos & (CTRL - 1)) === 0) {
        for (let k = 0; k < n; k++) {
          const s = strings[k];
          if (!s.active) continue;
          if (s.bendKeys.length || s.vib) {
            s.setCents(this._centsAt(s, pos + CTRL), false);
            s.dD = (s.D - s.Dcur) / CTRL;
          } else if (s.dD !== 0) s.dD = 0;
        }
      }
      const couple = eps * this.bridgeDC.process(bridge);
      let l = this.click.l, rr = this.click.r;
      this.click.l *= 0.8; this.click.r *= 0.8;
      let sum = 0;
      for (let k = 0; k < n; k++) {
        const s = strings[k];
        if (!s.active) continue;
        const y = s.tick(couple);
        sum += y;
        l += y * this.panL[k]; rr += y * this.panR[k];
        s.energy = s.energy * 0.9995 + y * y * 0.0005;
        if (s.age > 4 * s.Dcur + 4096 && s.energy < 1e-14 && Math.abs(couple) < 1e-9) s.active = false;
      }
      bridge += 0.4 * (sum - bridge);
      if (Math.abs(bridge) > 4e-4) for (let k = 0; k < n; k++) strings[k].active = true;
      // 绞弦：两弦相碰的金属噪声，以拍频断续
      if (r.env > 1e-5) {
        r.am += r.amRate / fs;
        const gate = 0.35 + 0.65 * Math.pow(Math.abs(Math.sin(Math.PI * r.am)), 3);
        const nz = rng.bipolar();
        const v = r.env * gate * (0.9 * r.bp1.process(nz) + 0.6 * r.bp2.process(nz));
        l += v * 0.5; rr += v * 0.5;
        r.env *= r.decay;
      }
      // 拍面板：进箱体的低频冲击
      const kl = this.knock.l, kr = this.knock.r;
      this.knock.l *= 0.55; this.knock.r *= 0.55;
      let ol = this.bodyL.process(this.dcL.process(l) + kl * rng.bipolar() * 0.3 + kl);
      let or = this.bodyR.process(this.dcR.process(rr) + kr * rng.bipolar() * 0.3 + kr);
      ol = this.toneL.process(this.presL.process(this.lowL.process(ol)));
      or = this.toneR.process(this.presR.process(this.lowR.process(or)));
      outL[offset + i] += ol * this.gain;
      outR[offset + i] += or * this.gain;
      this.pos++;
    }
    this.bridgeLP = bridge;
  }
}
