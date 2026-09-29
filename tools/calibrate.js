// 校准：在整个音域逐半音渲染一个稳定长音，测出二胡(内/外弦)与唢呐的音高偏差，输出可回填的校准表。
//   node tools/calibrate.js erhu|suona [vel]
import { renderPiece } from '../src/render.js';
import { verifyMonophonic } from '../src/analysis/verify.js';

const which = process.argv[2] || 'erhu';
const vel = process.argv[3] || 'mf';
const TOK = ['1', '#1', '2', '#2', '3', '4', '#4', '5', '#5', '6', '#6', '7'];   // 相对主音的半音
function tokenOf(semi) { // semi: 主音以上的半音数（可为负）
  const oct = Math.floor(semi / 12), pc = ((semi % 12) + 12) % 12;
  return TOK[pc] + (oct > 0 ? "'".repeat(oct) : ','.repeat(-oct));
}
// 二胡：D4(0) ~ G6(...)；唢呐：以 D5 为主音，A4(-5) ~ E7
const cfg = which === 'erhu'
  ? { instrument: 'erhu', tonic: 'D4', lo: 0, hi: 29, str: m => (62 + m <= 68 ? 'inner' : 'outer') }
  : { instrument: 'suona', tonic: 'D5', lo: -8, hi: 27 };
const rows = [];
for (let m = cfg.lo; m <= cfg.hi; m++) {
  const tok = tokenOf(m);
  const text = `@tempo 60\n@meter 4/4\n!${vel} ${tok}. 0_ |`;   // 1.5 拍 + 半拍休止
  const piece = { instrument: cfg.instrument, tonic: cfg.tonic, text, perform: { vibDepth: 0, scoop: 0 }, instrumentOpts: { calibrated: false } };
  const r = renderPiece(piece, { keepDry: true, reverb: false });
  const mono = Float64Array.from(r.dry.L, (v, i) => 0.5 * (v + r.dry.R[i]));
  // 校准音长 1.5 拍 = 1.5 秒
  const notes = r.stats.notes.map(n => ({ ...n, vib: false }));
  const v = verifyMonophonic(mono, r.fs, notes);
  const q = v.results[0];
  if (q && q.err !== undefined) rows.push({ hz: q.hz, err: q.err, midi: q.midi });
  else console.log('skip', tok);
}
console.log(which, 'vel', vel);
for (const r of rows) console.log(r.hz.toFixed(2).padStart(8), r.err.toFixed(2).padStart(7));
// 简单平滑（3 点滑动平均）并输出表
const smooth = rows.map((r, i) => {
  const a = rows[Math.max(0, i - 1)].err, b = r.err, c = rows[Math.min(rows.length - 1, i + 1)].err;
  return [Math.round(r.hz * 100) / 100, Math.round(((a + 2 * b + c) / 4) * 100) / 100];
});
if (which === 'erhu') {
  const inner = smooth.filter(x => x[0] < 430), outer = smooth.filter(x => x[0] >= 430);
  console.log('\nERHU_PITCH_CAL =', JSON.stringify({ inner, outer }));
} else {
  console.log('\nSUONA_PITCH_CAL =', JSON.stringify(smooth));
}
