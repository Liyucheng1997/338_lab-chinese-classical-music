// 二胡：音准 + 音色 + 颤音/滑音测试
import { Erhu } from '../src/dsp/erhu.js';
import { detectPitch, rms, peak, spectralCentroid, harmonicProfile, clickScan } from '../src/analysis/analysis.js';
import { encodeWav } from '../src/wav.js';
import fs from 'node:fs';
const FS = 44100;

// 一个音：弓起 → 保持 → 弓收
function play(e, t, dur, hz, str, vel = 0.5, opts = {}) {
  const fingered = !!opts.fingered;
  e.pitch(t, str, [[0, hz]], fingered);
  const v = 0.03 + 0.10 * vel, p = 0.25 + 0.5 * vel;
  e.bow(t, str, v, p, opts.attack ?? 0.05);
  if (opts.vib) e.vibrato(t + 0.3, str, 5.5, opts.vib, 0.3, dur - 0.3);
  e.bow(t + dur - 0.06, str, 0, p, 0.06);
}

const cases = [
  ['inner', 293.66, false], ['inner', 329.63, true], ['inner', 369.99, true], ['inner', 392.0, true], ['inner', 415.3, true],
  ['outer', 440.0, false], ['outer', 493.88, true], ['outer', 554.37, true], ['outer', 587.33, true], ['outer', 659.26, true],
  ['outer', 739.99, true], ['outer', 880.0, true], ['outer', 987.77, true], ['outer', 1174.66, true],
];
console.log('string  target  measured  err(cents)  clarity  rms   centroid  harmonics(dB rel f0)');
const errs = [];
for (const [k, hz, fg] of cases) {
  const e = new Erhu(FS);
  const str = k === 'inner' ? 0 : 1;
  play(e, 0.05, 1.6, hz, str, 0.55, { fingered: fg });
  const n = FS * 2, L = new Float64Array(n), R = new Float64Array(n);
  e.process(L, R, 0, n);
  const st = Math.round(FS * 0.7), len = 8192;
  const p = detectPitch(L, st, len, FS, hz, 120);
  const err = 1200 * Math.log2(p.f0 / hz);
  errs.push(Math.abs(err));
  console.log(k.padEnd(6), hz.toFixed(1).padStart(7), p.f0.toFixed(2).padStart(9), err.toFixed(2).padStart(9), p.clarity.toFixed(3).padStart(9), rms(L, st, len).toFixed(3), spectralCentroid(L, st, len, FS).toFixed(0).padStart(6),
    harmonicProfile(L, st, len, FS, hz, 8).map(x => x.toFixed(0)).join(' '));
}
console.log('mean |err|', (errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(2), 'max', Math.max(...errs).toFixed(2));

// 一段旋律样例：带揉弦和滑音
const e = new Erhu(FS);
play(e, 0.2, 1.4, 440, 1, 0.55, { vib: 28 });
// 从 A4 滑到 B4（同弦），弓不停
e.pitch(1.7, 1, [[0, 440], [0.12, 440], [0.32, 493.88]], true);
e.bow(1.7, 1, 0.09, 0.5, 0.05);
e.vibrato(2.2, 1, 5.5, 30, 0.3, 1.0);
e.bow(3.2, 1, 0, 0.5, 0.15);
const n = FS * 4, L = new Float64Array(n), R = new Float64Array(n);
e.process(L, R, 0, n);
const pk = Math.max(peak(L), peak(R));
console.log('peak', pk.toFixed(3), 'clicks', clickScan(L, 0.15));
const s = 0.6 / pk;
fs.mkdirSync('output', { recursive: true });
fs.writeFileSync('output/test-erhu.wav', encodeWav([L.map(v => v * s), R.map(v => v * s)], FS, 16));
