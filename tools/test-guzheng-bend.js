import { Guzheng } from '../src/dsp/guzheng.js';
import { detectPitch, clickScan } from '../src/analysis/analysis.js';
const FS = 44100;
const g = new Guzheng(FS);
const idx = 10; // D4
g.pluck(0.1, idx, 0.85);
g.bend(0.3, idx, [[0, 0], [0.14, 200]]);            // 0.3s 起按音上滑到 +200 音分（升高一个大二度）
g.vibrato(0.8, idx, 5.5, 22, 0.4, 1.6);              // 揉弦
g.bend(2.2, idx, [[0, 200], [0.25, 0]]);             // 回滑
const n = FS * 3;
const L = new Float64Array(n), R = new Float64Array(n);
g.process(L, R, 0, n);
const f0 = g.strings[idx].f0;
console.log('t(s)  cents(measured vs open string)');
for (let t = 0.2; t < 2.9; t += 0.1) {
  const s = Math.round(t * FS);
  const p = detectPitch(L, s, 4096, FS, f0 * Math.pow(2, 100 / 1200), 400);
  console.log(t.toFixed(2), (1200 * Math.log2(p.f0 / f0)).toFixed(1).padStart(7), p.clarity.toFixed(2));
}
console.log('clicks', clickScan(L, 0.05));
