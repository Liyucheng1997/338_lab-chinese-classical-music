// 渲染管线：乐谱 → 演奏 → 乐器合成 → 混响 → 母带 → 立体声 PCM。
// 浏览器（Worker）与 Node 共用。

import { compileJianpu } from './score/jianpu.js';
import { Tuning, midiName } from './dsp/tuning.js';
import { Guzheng } from './dsp/guzheng.js';
import { Erhu } from './dsp/erhu.js';
import { Suona } from './dsp/suona.js';
import { Pipa } from './dsp/pipa.js';
import { Reverb, Limiter } from './dsp/reverb.js';
import { DCBlocker, Biquad } from './dsp/core.js';
import { performGuzheng } from './perform/guzhengPlayer.js';
import { performErhu } from './perform/erhuPlayer.js';
import { performSuona } from './perform/suonaPlayer.js';
import { performPipa } from './perform/pipaPlayer.js';
import { rms } from './analysis/analysis.js';
import { Timeline } from './perform/timeline.js';

const CHUNK = 8192;

/** 默认的各乐器空间/演奏参数。 */
export const INSTRUMENT_DEFAULTS = {
  guzheng: { rt60: 2.3, wet: 0.30, damp: 0.40, predelay: 0.016, size: 1.05, targetRms: 0.105, tail: 3.5 },
  erhu:    { rt60: 2.5, wet: 0.34, damp: 0.42, predelay: 0.020, size: 1.10, targetRms: 0.105, tail: 3.5 },
  suona:   { rt60: 1.8, wet: 0.26, damp: 0.38, predelay: 0.012, size: 0.95, targetRms: 0.105, tail: 2.5 },
  pipa:    { rt60: 2.0, wet: 0.26, damp: 0.40, predelay: 0.014, size: 1.0, targetRms: 0.105, tail: 3.0 },
};

export function createInstrument(kind, fs, tuning, opts = {}) {
  if (kind === 'guzheng') return new Guzheng(fs, { tuning, ...opts });
  if (kind === 'erhu') return new Erhu(fs, { tuning, ...opts });
  if (kind === 'suona') return new Suona(fs, { tuning, ...opts });
  if (kind === 'pipa') return new Pipa(fs, { tuning, ...opts });
  throw new Error('unknown instrument ' + kind);
}

/**
 * 渲染一首曲子。
 * @param {object} piece { instrument, text, tonicMidi, perform: {...}, timeline: {...}, reverb: {...} }
 * @param {object} o { fs, tuning: 'equal'|'pythagorean'|'just', onProgress(frac), reverb:boolean, seconds:限制长度 }
 */
export function renderPiece(piece, o = {}) {
  const fs = o.fs || 44100;
  const score = compileJianpu(piece.text, { tonic: piece.tonic || 'D4' });
  const tuning = new Tuning(score.meta.tonic, o.tuning || 'equal', 440);
  const inst = createInstrument(piece.instrument, fs, tuning, piece.instrumentOpts || {});
  const perfOpts = { ...(piece.perform || {}), timeline: piece.timeline || {} };
  let stats;
  if (piece.instrument === 'guzheng') stats = performGuzheng(score, inst, perfOpts);
  else if (piece.instrument === 'erhu') stats = performErhu(score, inst, perfOpts);
  else if (piece.instrument === 'pipa') stats = performPipa(score, inst, perfOpts);
  else stats = performSuona(score, inst, perfOpts);

  const def = { ...INSTRUMENT_DEFAULTS[piece.instrument], ...(piece.reverb || {}) };
  // 乐曲总长：最后一个事件之后再留出余音
  let tEnd = 0;
  const tlEnd = (stats.notes.length ? Math.max(...stats.notes.map(n => (n.t1 ?? (n.t + (n.dur || 0)) ))) : 0);
  tEnd = tlEnd + def.tail;
  if (o.seconds) tEnd = Math.min(tEnd, o.seconds);
  const N = Math.ceil(tEnd * fs);
  const L = new Float64Array(N), R = new Float64Array(N);
  for (let i = 0; i < N; i += CHUNK) {
    const n = Math.min(CHUNK, N - i);
    inst.process(L, R, i, n);
    if (o.onProgress) o.onProgress(0.85 * (i + n) / N);
  }
  const dryL = o.keepDry ? Float64Array.from(L) : null, dryR = o.keepDry ? Float64Array.from(R) : null;

  // 混响
  if (o.reverb !== false) {
    const rv = new Reverb(fs, def);
    for (let i = 0; i < N; i += CHUNK) {
      const n = Math.min(CHUNK, N - i);
      rv.processBlock(L.subarray(i, i + n), R.subarray(i, i + n), n, 1);
    }
  }
  // 母带：去直流 → 归一到目标响度 → 前视限幅
  const dcL = new DCBlocker(0.9993), dcR = new DCBlocker(0.9993);
  for (let i = 0; i < N; i++) { L[i] = dcL.process(L[i]); R[i] = dcR.process(R[i]); }
  // 响度：只统计能量高于门限的窗口，避免长静音拉低
  const win = Math.round(fs * 0.4);
  let acc = 0, cnt = 0;
  for (let i = 0; i + win < N; i += win) {
    const r = Math.sqrt(0.5 * (rms(L, i, win) ** 2 + rms(R, i, win) ** 2));
    if (r > 0.004) { acc += r * r; cnt++; }
  }
  const measured = cnt ? Math.sqrt(acc / cnt) : 0.05;
  const g = (def.targetRms || 0.085) / Math.max(measured, 1e-6);
  const lim = new Limiter(fs, 0.89, 2.0, 120);
  const out = [0, 0];
  const oL = new Float32Array(N), oR = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    lim.process(L[i] * g, R[i] * g, out);
    oL[i] = out[0]; oR[i] = out[1];
    if (o.onProgress && (i & 0xffff) === 0) o.onProgress(0.85 + 0.15 * i / N);
  }
  if (o.onProgress) o.onProgress(1);
  const tl = new Timeline(score, piece.timeline || {});
  const sections = score.events.filter(e => e.type === 'section').map(e => ({ name: e.name, t: tl.time(e.t) }));
  return { fs, L: oL, R: oR, duration: N / fs, stats, score, tuning, sections, gain: g, dry: o.keepDry ? { L: dryL, R: dryR } : null, inst };
}
