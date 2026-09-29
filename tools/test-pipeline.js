// 流水线冒烟测试：三个小片段 → 渲染 → WAV
import { renderPiece } from '../src/render.js';
import { encodeWav } from '../src/wav.js';
import { peak, rms } from '../src/analysis/analysis.js';
import fs from 'node:fs';
fs.mkdirSync('output', { recursive: true });

const pieces = {
  guzheng: {
    instrument: 'guzheng', tonic: 'D4',
    text: `@tempo 58
@meter 4/4
!mf [3 3,] 5_ 6__. 1'___ 2, 2 |
[3 3,]_ 5_^ [3 3,]_^ 3__ 2__ 1,_ 1_. 2__ 6,_ |
[5 5,,] 5, <6, 1 5, 6,>_ 1,_ 1_^ |
<6,_. 1___ 6,__ 5,__> 3,^ 5,_ 6,__ 6,__ 5,_ 6,__ 6,__ |
[1 1,]~ [2 2,]~ [3 3,]~ - |`,
  },
  erhu: {
    instrument: 'erhu', tonic: 'D4',
    text: `@tempo 52
@meter 4/4
!p 0_. 6__ 5__ 6__ 4__ 3__ | 2 - 2_. 3__ 1_ 1__ 2__ |
3. 5_ (6_ 5_) 6__ 5__ 6__ 1'__ |
5 - 5_ 0_ 3'_ 5'_ 6'_ 5'_ |`,
  },
  suona: {
    instrument: 'suona', tonic: 'D5',
    text: `@tempo 88
@meter 2/4
!mf 5 (6_ 1'_) | 2'_. 1'__ 6_ 5_ | (3_ 5_ 6_ 5_) | 3 - |
!f {2'}3'~ - |`,
  },
};
for (const [k, p] of Object.entries(pieces)) {
  const t0 = Date.now();
  const r = renderPiece(p, {});
  console.log(k, 'dur', r.duration.toFixed(1), 's warnings', r.score.warnings, 'render ms', Date.now() - t0, 'peak', Math.max(peak(r.L), peak(r.R)).toFixed(3), 'rms', rms(r.L).toFixed(3));
  fs.writeFileSync(`output/test-${k}-pipeline.wav`, encodeWav([r.L, r.R], r.fs, 16));
}
