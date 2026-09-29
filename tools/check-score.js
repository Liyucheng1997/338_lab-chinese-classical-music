// 乐谱检查：小节拍数校验 + 旋律大跳进（≥10 半音）提示，用于发现转谱时的八度误读
import { compileJianpu } from '../src/score/jianpu.js';
const name = process.argv[2];
const mod = await import(`../src/score/${name}.js`);
const r = compileJianpu(mod.text);
console.log(r.meta.title, '总拍数', r.totalBeats, '事件', r.events.length, '约', r.beatToSec(r.totalBeats).toFixed(0), 's');
console.log('小节告警', r.warnings.length);
r.warnings.slice(0, 80).forEach(w => console.log('  ', w));
const thr = +(process.argv[3] || 10);
let prev = null, n = 0;
for (const e of r.events) {
  if (e.type !== 'note') continue;
  if (prev && Math.abs(e.midi - prev.midi) >= thr && e.t - (prev.t + prev.dur) < 0.3) {
    console.log(`  大跳 小节${e.bar} 拍${e.t.toFixed(2)}: ${prev.midi}→${e.midi} (${e.midi - prev.midi > 0 ? '+' : ''}${e.midi - prev.midi})`);
    n++;
  }
  prev = e;
}
console.log('大跳进', n);
