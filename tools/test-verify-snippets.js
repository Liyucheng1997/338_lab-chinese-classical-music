import { renderPiece } from '../src/render.js';
import { verifyMonophonic } from '../src/analysis/verify.js';
const erhu = { instrument: 'erhu', tonic: 'D4', text: `@tempo 52
@meter 4/4
!mp 0_. 6__ 5__ 6__ 4__ 3__ | 2 - 2_. 3__ 1_ 1__ 2__ |
3. 5_ (6_ 5_) 6__ 5__ 6__ 1'__ | 5 - 5_ 0_ 3'_ 5'_ 6'_ 5'_ | 3'. 2'_ 1' 6 | 5 - - - |` };
const suona = { instrument: 'suona', tonic: 'D5', text: `@tempo 88
@meter 2/4
!mf 5 (6_ 1'_) | 2'_. 1'__ 6_ 5_ | (3_ 5_ 6_ 5_) | 3 - | 5 6 | 1' - | 2' 3' | 5' 6'| 5' - |` };
for (const [name, p] of [['erhu', erhu], ['suona', suona]]) {
  const r = renderPiece(p, { keepDry: true, reverb: false });
  const mono = Float64Array.from(r.dry.L, (v, i) => 0.5 * (v + r.dry.R[i]));
  const v = verifyMonophonic(mono, r.fs, r.stats.notes);
  console.log(name, 'notes checked', v.count, 'skipped', v.skipped, 'meanAbs', v.meanAbs.toFixed(2), 'median', v.median.toFixed(2), 'p90', v.p90.toFixed(2), 'max', v.max.toFixed(2), 'bias', v.bias.toFixed(2));
  for (const q of v.results) console.log('  t', q.t0.toFixed(2), 'hz', q.hz.toFixed(1), q.skipped ? ('skip ' + q.reason) : ('err ' + q.err.toFixed(2) + (q.vib ? ' vib' : '')));
}
