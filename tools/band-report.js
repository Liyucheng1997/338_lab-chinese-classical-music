// 长时平均频谱（倍频程能量分布），用于检查整体音色平衡
import fs from 'node:fs';
import { decodeWav } from '../src/wav.js';
import { magnitudeSpectrum } from '../src/analysis/analysis.js';
const wav = decodeWav(new Uint8Array(fs.readFileSync(process.argv[2])));
const x = wav.channels[0], fs_ = wav.sampleRate, N = 8192;
const bands = [[50, 100], [100, 200], [200, 400], [400, 800], [800, 1600], [1600, 3200], [3200, 6400], [6400, 12800]];
const acc = new Float64Array(bands.length); let frames = 0;
for (let s = 0; s + N < x.length; s += N * 2) {
  const mag = magnitudeSpectrum(x, s, N);
  let tot = 0; for (const m of mag) tot += m * m;
  if (tot < 1e-9) continue;
  frames++;
  bands.forEach(([a, b], k) => { let e = 0; for (let i = Math.floor(a * N / fs_); i < Math.floor(b * N / fs_); i++) e += mag[i] * mag[i]; acc[k] += e; });
}
const tot = acc.reduce((a, b) => a + b, 0);
console.log(process.argv[2], 'frames', frames);
bands.forEach(([a, b], k) => console.log(`${String(a).padStart(5)}-${String(b).padEnd(5)} Hz  ${(10 * Math.log10(acc[k] / tot + 1e-12)).toFixed(1).padStart(6)} dB  ${'#'.repeat(Math.max(0, Math.round(60 + 3 * 10 * Math.log10(acc[k] / tot + 1e-12)) / 3))}`));
