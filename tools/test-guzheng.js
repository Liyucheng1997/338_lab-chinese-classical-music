// 古筝空弦音准与音色测试
import { Guzheng, GUZHENG_MIDI } from '../src/dsp/guzheng.js';
import { detectPitch, rms, peak, spectralCentroid, harmonicProfile, clickScan } from '../src/analysis/analysis.js';
import { encodeWav } from '../src/wav.js';
import fs from 'node:fs';

const FS = 44100;
const errs = [];
console.log('string  midi  target(Hz)  measured(Hz)  err(cents)  clarity  rms   centroid(Hz)');
for (let i = 0; i < GUZHENG_MIDI.length; i++) {
  const g = new Guzheng(FS);
  g.pluck(0.05, i, 0.8);
  const n = FS * 2;
  const L = new Float64Array(n), R = new Float64Array(n);
  g.process(L, R, 0, n);
  const target = g.strings[i].f0;
  const start = Math.round(FS * 0.25), len = 16384;
  const p = detectPitch(L, start, len, FS, target, 100);
  const cents = 1200 * Math.log2(p.f0 / target);
  errs.push(Math.abs(cents));
  console.log(String(i).padStart(4), String(GUZHENG_MIDI[i]).padStart(6), target.toFixed(2).padStart(10), p.f0.toFixed(3).padStart(13), cents.toFixed(3).padStart(10), p.clarity.toFixed(3).padStart(9), rms(L, start, len).toFixed(4), spectralCentroid(L, start, 8192, FS).toFixed(0).padStart(8));
}
console.log('mean |err| cents =', (errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(3), ' max =', Math.max(...errs).toFixed(3));

// 一个音阶试听样例
const g = new Guzheng(FS);
const seq = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
seq.forEach((k, j) => g.pluck(0.2 + j * 0.42, k, 0.75));
const n = FS * 6;
const L = new Float64Array(n), R = new Float64Array(n);
g.process(L, R, 0, n);
const pk = Math.max(peak(L), peak(R));
console.log('peak', pk.toFixed(3), 'clicks', clickScan(L, 0.2));
const s = 0.6 / pk;
fs.mkdirSync('output', { recursive: true });
fs.writeFileSync('output/test-guzheng-scale.wav', encodeWav([L.map(v => v * s), R.map(v => v * s)], FS, 16));
