// 批量渲染三首曲目为 16 位立体声 WAV，并输出音准报告 JSON。
//   npm run render            （默认 12 平均律）
//   node tools/render-all.js --tuning=pythagorean
import fs from 'node:fs';
import { renderPiece } from '../src/render.js';
import { encodeWav } from '../src/wav.js';
import { PIECES } from '../src/pieces.js';
import { peak, rms } from '../src/analysis/analysis.js';
import { tuningSummary } from '../src/tuningSummary.js';

const tun = (process.argv.find(a => a.startsWith('--tuning=')) || '--tuning=equal').split('=')[1];
if (!['equal', 'pythagorean', 'just'].includes(tun)) throw new Error('律制必须为 equal、pythagorean 或 just');
fs.mkdirSync('output', { recursive: true });
const report = [];
for (const p of PIECES) {
  const t0 = Date.now();
  const r = renderPiece(p, { tuning: tun, keepDry: true });
  const suffix = tun === 'equal' ? '' : '-' + tun;
  const file = `output/${p.id}${suffix}.wav`;
  fs.writeFileSync(file, encodeWav([r.L, r.R], r.fs, 16));
  const v = tuningSummary(p, r);
  const tuningInfo = { measured: v.combos ?? v.count, method: v.kind === 'guzheng' ? 'isolated-string-combinations' : 'stable-monophonic-notes', skipped: v.skipped ?? 0, meanAbsCents: +v.meanAbs.toFixed(2), maxAbsCents: +v.max.toFixed(2) };
  report.push({ id: p.id, title: p.title, instrument: p.instrumentName, temperament: tun, sampleRate: r.fs, seconds: +r.duration.toFixed(1), peak: +Math.max(peak(r.L), peak(r.R)).toFixed(3), rms: +rms(r.L).toFixed(4), tuning: tuningInfo });
  console.log(`${p.title}（${p.instrumentName}） ${r.duration.toFixed(0)}s → ${file}  用时 ${(Date.now() - t0) / 1000}s`);
}
fs.writeFileSync(`output/report${tun === 'equal' ? '' : '-' + tun}.json`, JSON.stringify(report, null, 2));
console.log('done');
