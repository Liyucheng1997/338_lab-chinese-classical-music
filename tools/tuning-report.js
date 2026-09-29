// 音准报告：对每首曲子渲染干声，逐音检测基频并与乐谱应有音高比较。
//   node tools/tuning-report.js [erquan|bainiao|yuzhou] [--tuning=equal|pythagorean|just] [--verbose]
import { renderPiece } from '../src/render.js';
import { PIECES } from '../src/pieces.js';
import { verifyMonophonic } from '../src/analysis/verify.js';
import { detectPitch } from '../src/analysis/analysis.js';
import { midiName } from '../src/dsp/tuning.js';
import { GUZHENG_MIDI } from '../src/dsp/guzheng.js';

const tun = (process.argv.find(a => a.startsWith('--tuning=')) || '--tuning=equal').split('=')[1];
const verbose = process.argv.includes('--verbose');
const ids = process.argv.slice(2).filter(a => !a.startsWith('--'));
const list = ids.length ? PIECES.filter(p => ids.includes(p.id)) : PIECES;
const summary = [];
for (const piece of list) {
  const r = renderPiece(piece, { keepDry: true, reverb: false, tuning: tun });
  console.log(`\n=== ${piece.title}（${piece.instrumentName}）  律制: ${tun}  时长 ${r.duration.toFixed(1)}s ===`);
  if (piece.instrument === 'guzheng') {
    // 古筝：复调，逐弦检查空弦音准 + 按音落点（弦选择与目标音的音分差）
    const inst = r.inst;
    const notes = r.stats.notes.filter(n => n.string !== undefined);
    let maxPress = 0, pressed = 0, open = 0, skipped = r.stats.skipped;
    for (const n of notes) {
      const c = n.cents || 0;
      if (Math.abs(c) < 0.5) open++; else { pressed++; maxPress = Math.max(maxPress, c); }
    }
    // 实测：每个用到的弦单独拨响，测基频误差（含按音）
    const used = new Map();
    for (const n of notes) { const key = n.string + ':' + Math.round((n.cents || 0) / 10); if (!used.has(key)) used.set(key, n); }
    const Guz = inst.constructor;
    const errs = [];
    for (const n of used.values()) {
      const g = new Guz(r.fs, { tuning: r.tuning });
      const cents = n.cents || 0;
      g.pluck(0.05, n.string, 0.7, { cents });
      const len = Math.round(r.fs * 1.2), L = new Float64Array(len), R = new Float64Array(len);
      g.process(L, R, 0, len);
      const target = r.tuning.freqFrac(n.midi);
      const p = detectPitch(L, Math.round(r.fs * 0.25), 16384, r.fs, target, 120);
      errs.push(1200 * Math.log2(p.f0 / target));
    }
    const abs = errs.map(Math.abs).sort((a, b) => a - b);
    console.log(`音符 ${notes.length}（空弦 ${open}，按音 ${pressed}，最大按音 ${maxPress.toFixed(0)} 音分，无法演奏 ${skipped}）`);
    console.log(`独立弦实测 ${errs.length} 种(弦,按音)组合：平均误差 ${(abs.reduce((a, b) => a + b, 0) / abs.length).toFixed(2)} 音分，最大 ${abs[abs.length - 1].toFixed(2)} 音分`);
    summary.push({ id: piece.id, meanAbs: abs.reduce((a, b) => a + b, 0) / abs.length, max: abs[abs.length - 1] });
    continue;
  }
  const mono = Float64Array.from(r.dry.L, (v, i) => 0.5 * (v + r.dry.R[i]));
  const v = verifyMonophonic(mono, r.fs, r.stats.notes);
  console.log(`已测 ${v.count} 个音（跳过 ${v.skipped}：滑音/花舌/极短音）`);
  console.log(`平均绝对误差 ${v.meanAbs.toFixed(2)} 音分   中位数 ${v.median.toFixed(2)}   90%分位 ${v.p90.toFixed(2)}   最大 ${v.max.toFixed(2)}   系统偏差 ${v.bias.toFixed(2)}`);
  summary.push({ id: piece.id, meanAbs: v.meanAbs, max: v.max, bias: v.bias });
  if (verbose) for (const q of v.results) if (q.err !== undefined && Math.abs(q.err) > 3) console.log(`  t=${q.t0.toFixed(2)}s ${midiName(q.midi)} ${q.hz.toFixed(1)}Hz 误差 ${q.err.toFixed(2)} 音分${q.vib ? ' 揉弦' : ''}`);
}
console.log('\n汇总:', summary.map(s => `${s.id}: 平均${s.meanAbs.toFixed(2)}c 最大${s.max.toFixed(2)}c`).join(' | '));
