// 唢呐：音准 + 音色 + 起音时间 + 颤音/滑音/花舌测试
import { Suona } from '../src/dsp/suona.js';
import { detectPitch, rms, peak, spectralCentroid, harmonicProfile, clickScan, envelopeDb } from '../src/analysis/analysis.js';
import { encodeWav } from '../src/wav.js';
import fs from 'node:fs';
const FS = 44100;

function note(s, t, dur, hz, level = 0.8, att = 0.03) {
  s.pitch(t, [[0, hz]]);
  s.breath(t, level, att);
  s.breath(t + dur - 0.05, 0, 0.05);
}

const freqs = [440, 493.88, 587.33, 659.26, 739.99, 880, 987.77, 1174.66, 1318.51, 1479.98, 1760, 1975.53, 2349.32];
console.log('target   measured  err(cents)  clarity  rms    centroid  onset(ms)  harmonics');
const errs = [];
for (const hz of freqs) {
  const s = new Suona(FS);
  note(s, 0.05, 1.4, hz, 0.8);
  const n = FS * 1.6, L = new Float64Array(n), R = new Float64Array(n);
  s.process(L, R, 0, n);
  const st = Math.round(FS * 0.6), len = 8192;
  const p = detectPitch(L, st, len, FS, hz, 120);
  const err = 1200 * Math.log2(p.f0 / hz);
  errs.push(Math.abs(err));
  // 起音时间：包络首次达到稳态 70% 的时刻（相对起音开始）
  const target = rms(L, st, len) * 0.7;
  let onset = -1;
  for (let i = Math.round(FS * 0.05); i < n - 512; i += 64) if (rms(L, i, 256) >= target) { onset = (i - FS * 0.05) / FS * 1000; break; }
  console.log(hz.toFixed(1).padStart(7), p.f0.toFixed(2).padStart(9), err.toFixed(2).padStart(9), p.clarity.toFixed(3).padStart(9), rms(L, st, len).toFixed(3), spectralCentroid(L, st, 8192, FS).toFixed(0).padStart(7), onset.toFixed(0).padStart(8),
    harmonicProfile(L, st, len, FS, hz, 10).map(x => x.toFixed(0).padStart(3)).join(''));
}
console.log('mean |err|', (errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(2), 'max', Math.max(...errs).toFixed(2));

// 旋律样例：颤音、滑音、花舌、吐音
const s = new Suona(FS);
note(s, 0.1, 1.2, 880, 0.85);
s.vibrato(0.5, 5.8, 22, 0.25, 0.7, 0.06);
// 滑音 880 → 1174.66（口唇连续上滑），气不断
s.pitch(1.4, [[0, 880], [0.05, 880], [0.30, 1174.66]]);
s.breath(1.4, 0.85, 0.03);
s.breath(2.2, 0, 0.06);
// 花舌
note(s, 2.5, 1.0, 1174.66, 0.9);
s.flutterTongue(2.7, 24, 0.75, 0.7);
// 吐音：三个短音
[0, 1, 2].forEach(i => note(s, 3.7 + i * 0.22, 0.17, 987.77, 0.85, 0.012));
const n = FS * 4.6, L = new Float64Array(n), R = new Float64Array(n);
s.process(L, R, 0, n);
const pk = Math.max(peak(L), peak(R));
console.log('peak', pk.toFixed(3));
const sc = 0.6 / pk;
fs.mkdirSync('output', { recursive: true });
fs.writeFileSync('output/test-suona.wav', encodeWav([L.map(v => v * sc), R.map(v => v * sc)], FS, 16));
