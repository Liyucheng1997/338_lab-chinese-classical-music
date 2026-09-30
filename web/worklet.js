// 实时演奏引擎（AudioWorklet）：古筝、二胡、唢呐、琵琶与曲目渲染共用同一套物理建模，只是事件来自鼠标/键盘。
import { Guzheng } from '../src/dsp/guzheng.js';
import { Erhu } from '../src/dsp/erhu.js';
import { Suona } from '../src/dsp/suona.js';
import { Pipa } from '../src/dsp/pipa.js';
import { Tuning } from '../src/dsp/tuning.js';
import { Reverb } from '../src/dsp/reverb.js';

class Live extends AudioWorkletProcessor {
  constructor() {
    super();
    const fs = sampleRate;
    const tuning = new Tuning(62, 'equal', 440);
    this.fs = fs;
    this.g = new Guzheng(fs, { tuning });
    this.e = new Erhu(fs, { tuning });
    this.s = new Suona(fs, { tuning });
    this.p = new Pipa(fs, { tuning });
    this.rv = new Reverb(fs, { rt60: 2.2, wet: 0.30, damp: 0.4, predelay: 0.016, size: 1.0 });
    this.bufL = new Float64Array(128); this.bufR = new Float64Array(128);
    this.tl = new Float64Array(128); this.tr = new Float64Array(128);
    this.gGain = 1.6; this.eGain = 0.7; this.sGain = 0.42; this.pGain = 1.5;
    this.eStr = -1; this.eHz = 0; this.sHz = 0; this.sOn = false;
    this.port.onmessage = (ev) => this.onMsg(ev.data);
    this.port.postMessage({ type: 'ready' });
  }

  onMsg(m) {
    const fs = this.fs;
    switch (m.type) {
      case 'guzhengOff': {
        this.clearPending(this.g);
        for (let i = 0; i < 21; i++) this.g.damp(this.g.pos / fs, i, 30, 0.5);
        break;
      }
      case 'pluck': { // 古筝：直接指定弦
        const g = this.g;
        g.pluck(g.pos / fs + 0.004, m.string, m.vel, { cents: m.cents || 0 });
        break;
      }
      case 'pipaPluck': { // 琵琶：弦 + 品（音分）
        const p = this.p;
        p.pluck(p.pos / fs + 0.004, m.string, m.vel, { cents: m.cents || 0 });
        break;
      }
      case 'pipaOff': {
        this.clearPending(this.p);
        for (let i = 0; i < 4; i++) this.p.damp(this.p.pos / fs, i, 30, 0.5);
        break;
      }
      case 'pluckMidi': {
        const g = this.g, f = g.findString(m.midi);
        if (f) g.pluck(g.pos / fs + 0.004, f.string, m.vel, { cents: f.cents });
        break;
      }
      case 'gPress': { // 按音：在弦上从当前音高滑到 cents
        const g = this.g;
        g.bend(g.pos / fs, m.string, [[0, 0], [0.12, m.cents]]);
        break;
      }
      case 'erhuOn': {
        const e = this.e, t = e.pos / fs + 0.003;
        this.clearPending(e);
        const str = m.hz < 430 ? 0 : 1;
        const fOpen = str === 0 ? 293.6648 : 440;
        const fingered = Math.abs(m.hz - fOpen) > 0.35;
        for (let i = 0; i < 2; i++) {
          e.vibrato(t, i, 5, 0, 0.01, 0.01);
          if (i !== str) e.bow(t, i, 0, 0.5, 0.04);
        }
        const from = (this.eStr === str && this.eHz > 0) ? this.eHz : m.hz;
        e.pitch(t, str, from !== m.hz ? [[0, from], [0.05, m.hz]] : [[0, m.hz]], fingered);
        const slope = Math.max(2.6, Math.min(5, 3.4 + 0.8 * Math.log2(m.hz / 440)));
        const pitchComp = Math.pow(m.hz / 440, 0.28);
        e.bow(t, str, (0.032 + 0.105 * Math.pow(m.vel, 1.15)) / pitchComp, (5 - slope) / 4, 0.06);
        e.vibrato(t + 0.35, str, 5.4, m.vib ?? 22, 0.4, 60);
        this.eStr = str; this.eHz = m.hz; this.eVel = m.vel;
        break;
      }
      case 'erhuBend': {
        const e = this.e, t = e.pos / fs;
        if (this.eStr < 0) break;
        if ((m.hz < 430 ? 0 : 1) !== this.eStr) { this.onMsg({ type: 'erhuOn', hz: m.hz, vel: this.eVel }); break; }
        const str = this.eStr;
        e.pitch(t, str, [[0, this.eHz], [0.03, m.hz]], Math.abs(m.hz - (str === 0 ? 293.6648 : 440)) > 0.35);
        this.eHz = m.hz;
        this.onMsg({ type: 'erhuExpression', vel: this.eVel });
        break;
      }
      case 'erhuExpression': {
        if (this.eStr < 0) break;
        this.eVel = m.vel;
        const slope = Math.max(2.6, Math.min(5, 3.4 + 0.8 * Math.log2(this.eHz / 440)));
        const vel = (0.032 + 0.105 * Math.pow(m.vel, 1.15)) / Math.pow(this.eHz / 440, 0.28);
        this.e.bow(this.e.pos / fs, this.eStr, vel, (5 - slope) / 4, 0.04);
        break;
      }
      case 'erhuOff': {
        const e = this.e, t = e.pos / fs;
        this.clearPending(e);
        for (let i = 0; i < 2; i++) { e.bow(t, i, 0, 0.5, 0.14); e.vibrato(t, i, 5, 0, 0.01, 0.01); }
        this.eStr = -1; this.eHz = 0;
        break;
      }
      case 'suonaOn': {
        const s = this.s, t = s.pos / fs + 0.003;
        this.clearPending(s);
        s.vibrato(t, 5, 0, 0.01, 0.01, 0);
        const level = 0.68 + 0.26 * Math.pow(m.vel, 0.8);
        const from = this.sOn && this.sHz > 0 ? this.sHz : m.hz;
        s.pitch(t, from !== m.hz ? [[0, from], [0.05, m.hz]] : [[0, m.hz]]);
        if (!this.sOn) s.breath(t - 0.004, Math.min(0.98, level * 1.05), 0.016);
        s.breath(t + 0.035, level, 0.05);
        s.amp(t, 0.32 + 0.68 * Math.pow(m.vel, 0.75), 0.03);
        s.vibrato(t + 0.3, 5.8, 24, 0.3, 60, 0.05);
        this.sOn = true; this.sHz = m.hz;
        break;
      }
      case 'suonaBend': {
        if (!this.sOn) break;
        const s = this.s, t = s.pos / fs;
        s.pitch(t, [[0, this.sHz], [0.03, m.hz]]);
        this.sHz = m.hz;
        break;
      }
      case 'suonaExpression': {
        if (!this.sOn) break;
        // 取消尚未执行的起音力度，避免短时间内拖动后又跳回旧力度。
        this.s.queue = this.s.queue.slice(this.s.qi).filter(e => e.type !== 'breath' && e.type !== 'amp');
        this.s.qi = 0;
        const t = this.s.pos / fs;
        this.s.breath(t, 0.68 + 0.26 * Math.pow(m.vel, 0.8), 0.04);
        this.s.amp(t, 0.32 + 0.68 * Math.pow(m.vel, 0.75), 0.04);
        break;
      }
      case 'suonaOff': {
        const s = this.s, t = s.pos / fs;
        this.clearPending(s);
        s.breath(t, 0, 0.06); s.vibrato(t, 5, 0, 0.01, 0.01);
        this.sOn = false; this.sHz = 0;
        break;
      }
    }
  }

  clearPending(inst) {
    // 手动演奏松开后，未来的起音/揉弦事件不能再次把乐器启动。
    inst.queue.length = 0; inst.qi = 0; inst.qDirty = false;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    const n = L.length;
    if (this.bufL.length !== n) {
      this.bufL = new Float64Array(n); this.bufR = new Float64Array(n);
      this.tl = new Float64Array(n); this.tr = new Float64Array(n);
    }
    const bl = this.bufL, br = this.bufR;
    bl.fill(0); br.fill(0);
    this.g.process(bl, br, 0, n);
    for (let i = 0; i < n; i++) { bl[i] *= this.gGain; br[i] *= this.gGain; }
    const tl = this.tl, tr = this.tr;
    tl.fill(0); tr.fill(0);
    this.e.process(tl, tr, 0, n);
    for (let i = 0; i < n; i++) { bl[i] += tl[i] * this.eGain; br[i] += tr[i] * this.eGain; }
    tl.fill(0); tr.fill(0);
    this.s.process(tl, tr, 0, n);
    for (let i = 0; i < n; i++) { bl[i] += tl[i] * this.sGain; br[i] += tr[i] * this.sGain; }
    tl.fill(0); tr.fill(0);
    this.p.process(tl, tr, 0, n);
    for (let i = 0; i < n; i++) { bl[i] += tl[i] * this.pGain; br[i] += tr[i] * this.pGain; }
    this.rv.processBlock(bl, br, n, 1);
    for (let i = 0; i < n; i++) {
      L[i] = Math.tanh(bl[i]); if (R !== L) R[i] = Math.tanh(br[i]);
    }
    return true;
  }
}
registerProcessor('live-instruments', Live);
