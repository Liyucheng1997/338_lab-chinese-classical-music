// 自动化验证：DSP 基础、乐谱、音准、音频健康度。任何一项不达标则以非零状态退出。
//   npm test
import { DelayLine } from '../src/dsp/core.js';
import { Tuning } from '../src/dsp/tuning.js';
import { Guzheng, GUZHENG_MIDI } from '../src/dsp/guzheng.js';
import { compileJianpu } from '../src/score/jianpu.js';
import { renderPiece } from '../src/render.js';
import { PIECES } from '../src/pieces.js';
import { detectPitch, peak, rms, clickScan } from '../src/analysis/analysis.js';
import { verifyMonophonic } from '../src/analysis/verify.js';

let failed = 0, passed = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name} ${detail}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('【1】DSP 基础');
{
  // 三次拉格朗日分数延迟：对 0.05 fs(2.2kHz) 正弦，理论相对误差约 2e-4
  const dl = new DelayLine(64);
  const w = 2 * Math.PI * 0.05, d = 10.37;
  let maxErr = 0;
  for (let n = 0; n < 400; n++) {
    dl.write(Math.sin(w * n));
    if (n > 30) maxErr = Math.max(maxErr, Math.abs(dl.read(d) - Math.sin(w * (n - d))));
  }
  ok('分数延迟线插值精度', maxErr < 5e-4, `(最大误差 ${maxErr.toExponential(1)})`);
  const t = new Tuning(62, 'equal', 440);
  ok('12 平均律 A4=440', Math.abs(t.freq(69) - 440) < 1e-9);
  ok('12 平均律 D4=293.665', Math.abs(t.freq(62) - 293.6648) < 1e-3);
  const tp = new Tuning(62, 'pythagorean', 440), tj = new Tuning(62, 'just', 440);
  ok('五度相生律 纯五度 3:2', Math.abs(tp.freq(69) / tp.freq(62) - 1.5) < 1e-6);
  ok('纯律 大三度 5:4', Math.abs(tj.freq(66) / tj.freq(62) - 1.25) < 1e-6);
}

console.log('【2】古筝 21 根空弦音准');
{
  const FS = 44100;
  let maxE = 0, sum = 0;
  for (let i = 0; i < GUZHENG_MIDI.length; i++) {
    const g = new Guzheng(FS);
    g.pluck(0.05, i, 0.8);
    const n = FS * 1.5, L = new Float64Array(n), R = new Float64Array(n);
    g.process(L, R, 0, n);
    const f = g.strings[i].f0;
    const p = detectPitch(L, Math.round(FS * 0.25), 16384, FS, f, 100);
    const e = Math.abs(1200 * Math.log2(p.f0 / f));
    maxE = Math.max(maxE, e); sum += e;
  }
  ok('古筝空弦最大误差 < 1 音分', maxE < 1, `(最大 ${maxE.toFixed(2)}，平均 ${(sum / 21).toFixed(2)})`);
}

console.log('【3】乐谱');
for (const p of PIECES) {
  const sc = compileJianpu(p.text, { tonic: p.tonic });
  ok(`《${p.title}》小节拍数校验`, sc.warnings.length === 0, sc.warnings.length ? sc.warnings.slice(0, 3).join(' | ') : `(${sc.events.length} 个事件)`);
}

console.log('【4】整曲渲染：音准与音频健康度');
for (const p of PIECES) {
  const t0 = Date.now();
  const r = renderPiece(p, { keepDry: true, reverb: false });
  const dryL = r.dry.L;
  // 音频健康度：有限、无 NaN、峰值/均值
  let bad = 0, sum = 0;
  for (let i = 0; i < dryL.length; i++) { const v = dryL[i]; if (!Number.isFinite(v)) bad++; sum += v; }
  ok(`《${p.title}》干声全部为有限值`, bad === 0);
  ok(`《${p.title}》直流偏移可忽略`, Math.abs(sum / dryL.length) < 5e-4, `(${(sum / dryL.length).toExponential(1)})`);
  const full = renderPiece(p, {});
  const pk = Math.max(peak(full.L), peak(full.R));
  ok(`《${p.title}》成品不削波`, pk <= 0.999 && pk > 0.2, `(峰值 ${pk.toFixed(3)})`);
  const r_ = rms(full.L);
  ok(`《${p.title}》响度合理`, r_ > 0.05 && r_ < 0.2, `(RMS ${r_.toFixed(3)})`);
  if (p.instrument === 'guzheng') {
    ok(`《${p.title}》所有音符都能在 21 弦上演奏`, r.stats.skipped === 0, `(无法演奏 ${r.stats.skipped})`);
  } else {
    const mono = Float64Array.from(dryL, (v, i) => 0.5 * (v + r.dry.R[i]));
    const v = verifyMonophonic(mono, r.fs, r.stats.notes);
    ok(`《${p.title}》逐音音准 平均偏差 < 2 音分`, v.meanAbs < 2, `(测 ${v.count} 个音，平均 ${v.meanAbs.toFixed(2)}，最大 ${v.max.toFixed(2)})`);
    ok(`《${p.title}》逐音音准 最大偏差 < 8 音分`, v.max < 8);
  }
  console.log(`     渲染用时 ${(Date.now() - t0) / 1000}s  时长 ${r.duration.toFixed(0)}s`);
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
