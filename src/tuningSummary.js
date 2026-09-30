// 音准摘要：给定渲染结果，返回可在页面/命令行展示的音准统计。
import { detectPitch } from './analysis/analysis.js';
import { verifyMonophonic } from './analysis/verify.js';
import { Guzheng } from './dsp/guzheng.js';
import { Pipa } from './dsp/pipa.js';

/** 二胡/唢呐：对干声逐音检测；古筝、琵琶：对用到的每种（弦，按音 / 品位）组合单独拨响测量。 */
export function tuningSummary(piece, r) {
  if (piece.instrument === 'pipa') {
    const notes = r.stats.notes.filter(n => n.string !== undefined && n.kind !== 'jiao' && n.kind !== 'harm');
    const used = new Map();
    for (const n of notes) { const k = n.string + ':' + Math.round(n.fret * 10); if (!used.has(k)) used.set(k, n); }
    const errs = [];
    for (const n of used.values()) {
      const p = new Pipa(r.fs, { tuning: r.tuning });
      const target = r.tuning.freqFrac(n.midi);
      const cents = 1200 * Math.log2(target / p.strings[n.string].f0);
      p.pluck(0.05, n.string, 0.7, { cents });
      const len = Math.round(r.fs * 0.9), L = new Float64Array(len), R = new Float64Array(len);
      p.process(L, R, 0, len);
      const d = detectPitch(L, Math.round(r.fs * 0.15), 8192, r.fs, target, 120);
      errs.push(Math.abs(1200 * Math.log2(d.f0 / target)));
    }
    errs.sort((a, b) => a - b);
    const mean = errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length);
    return { kind: 'guzheng', count: notes.length, combos: errs.length, meanAbs: mean, max: errs[errs.length - 1] || 0 };
  }
  if (piece.instrument === 'guzheng') {
    const notes = r.stats.notes.filter(n => n.string !== undefined);
    const used = new Map();
    for (const n of notes) { const k = n.string + ':' + Math.round((n.cents || 0) / 10); if (!used.has(k)) used.set(k, n); }
    const errs = [];
    for (const n of used.values()) {
      const g = new Guzheng(r.fs, { tuning: r.tuning });
      g.pluck(0.05, n.string, 0.7, { cents: n.cents || 0 });
      const len = Math.round(r.fs * 1.2), L = new Float64Array(len), R = new Float64Array(len);
      g.process(L, R, 0, len);
      const target = r.tuning.freqFrac(n.midi);
      const p = detectPitch(L, Math.round(r.fs * 0.25), 16384, r.fs, target, 120);
      errs.push(Math.abs(1200 * Math.log2(p.f0 / target)));
    }
    errs.sort((a, b) => a - b);
    const mean = errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length);
    return { kind: 'guzheng', count: notes.length, combos: errs.length, meanAbs: mean, max: errs[errs.length - 1] || 0 };
  }
  const src = r.dry || r;
  const dl = src.L, dr = src.R;
  const mono = Float64Array.from(dl, (v, i) => 0.5 * (v + dr[i]));
  const v = verifyMonophonic(mono, r.fs, r.stats.notes);
  return { kind: 'mono', count: v.count, skipped: v.skipped, meanAbs: v.meanAbs, median: v.median, p90: v.p90, max: v.max, bias: v.bias };
}
