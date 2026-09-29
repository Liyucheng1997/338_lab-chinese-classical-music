// 音准验证：把渲染出的干声逐音检测基频，与乐谱应有音高比较（单位：音分）。
// 揉弦/颤音的音取多个子窗口的音分平均（对称调制平均为 0）；滑音、摇指、和弦、极短音只统计不判。

import { detectPitch } from './analysis.js';

export function mean(a) { return a.reduce((x, y) => x + y, 0) / Math.max(1, a.length); }

/**
 * @param {Float32Array|Float64Array} x 干声（单声道）
 * @param {number} fs
 * @param {Array} notes  stats.notes（含 t0,t1,hz 或 midi,vib,glide,legato,scoop）
 * @param {object} o { freqOf(note) }
 */
export function verifyMonophonic(x, fs, notes, o = {}) {
  const res = [];
  for (const n of notes) {
    const hz = n.hz;
    const span = n.t1 - n.t0;
    if (span < 0.14 || n.glide || n.flutter || n.stac) { res.push({ ...n, skipped: true, reason: span < 0.14 ? 'short' : (n.glide ? 'glide' : (n.stac ? 'staccato' : 'flutter')) }); continue; }
    // 稳定区：跳过起音与滑入（前 45%），避开收弓（末 12%）
    const a = n.t0 + Math.min(0.55, span * 0.45), b = n.t1 - Math.max(0.03, span * 0.12);
    if (b - a < 0.06) { res.push({ ...n, skipped: true, reason: 'window' }); continue; }
    const W = 2048;
    const cents = [];
    for (let s = Math.round(a * fs); s + W <= Math.round(b * fs); s += 1024) {
      const p = detectPitch(x, s, W, fs, hz, 200);
      if (p.clarity > 0.9 && p.f0 > 0) cents.push(1200 * Math.log2(p.f0 / hz));
    }
    if (!cents.length) { res.push({ ...n, skipped: true, reason: 'noclarity' }); continue; }
    res.push({ ...n, err: mean(cents), nWin: cents.length });
  }
  const ok = res.filter(r => r.err !== undefined);
  const abs = ok.map(r => Math.abs(r.err)).sort((a, b) => a - b);
  const pct = (p) => abs.length ? abs[Math.min(abs.length - 1, Math.floor(p * abs.length))] : NaN;
  return {
    results: res,
    count: ok.length, skipped: res.length - ok.length,
    meanAbs: mean(abs), median: pct(0.5), p90: pct(0.9), max: abs.length ? abs[abs.length - 1] : NaN,
    bias: mean(ok.map(r => r.err)),
  };
}
