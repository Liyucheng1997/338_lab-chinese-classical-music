// 爆音/不连续扫描：对每首曲子的干声，统计 5 ms 窗口内“最大相邻差 / 窗口 RMS”，列出最突兀的位置。
import { renderPiece } from '../src/render.js';
import { PIECES } from '../src/pieces.js';
const ids = process.argv.slice(2);
for (const piece of (ids.length ? PIECES.filter(p => ids.includes(p.id)) : PIECES)) {
  const r = renderPiece(piece, { keepDry: true, reverb: false });
  const x = Float64Array.from(r.dry.L, (v, i) => 0.5 * (v + r.dry.R[i])), fs = r.fs;
  const W = Math.round(fs * 0.005), out = [];
  for (let s = 1; s + W < x.length; s += W) {
    let e = 0, md = 0;
    for (let i = 0; i < W; i++) { const v = x[s + i]; e += v * v; const d = Math.abs(v - x[s + i - 1]); if (d > md) md = d; }
    const rms = Math.sqrt(e / W);
    if (rms > 2e-3) out.push({ t: s / fs, ratio: md / rms, md, rms });
  }
  // 参考：中位数
  const rs = out.map(o => o.ratio).sort((a, b) => a - b), med = rs[rs.length >> 1];
  out.sort((a, b) => b.ratio - a.ratio);
  console.log(`\n${piece.title}：中位比值 ${med.toFixed(2)}，最大 ${out[0].ratio.toFixed(2)}`);
  for (const o of out.slice(0, 8)) console.log(`  t=${o.t.toFixed(3)}s  ratio=${o.ratio.toFixed(2)}  maxdiff=${o.md.toFixed(4)} rms=${o.rms.toFixed(4)}`);
}
