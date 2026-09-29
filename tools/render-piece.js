// 渲染单首曲子到 WAV：node tools/render-piece.js yuzhou|erquan|bainiao [out.wav] [--tuning=equal|pythagorean|just]
import fs from 'node:fs';
import { renderPiece } from '../src/render.js';
import { encodeWav } from '../src/wav.js';
import { PIECES } from '../src/pieces.js';
import { peak, rms } from '../src/analysis/analysis.js';

const id = process.argv[2];
const piece = PIECES.find(p => p.id === id);
if (!piece) { console.error('可选曲目:', PIECES.map(p => p.id).join(', ')); process.exit(1); }
const outArg = process.argv.find((a, i) => i > 2 && !a.startsWith('--'));
const tun = (process.argv.find(a => a.startsWith('--tuning=')) || '--tuning=equal').split('=')[1];
const t0 = Date.now();
const r = renderPiece(piece, { tuning: tun, onProgress: f => { if (Math.round(f * 100) % 20 === 0) process.stdout.write('.'); } });
console.log(`\n${piece.title}  ${r.duration.toFixed(1)} s   渲染 ${(Date.now() - t0) / 1000}s   告警 ${r.score.warnings.length}`);
for (const w of r.score.warnings) console.log('  ', w);
console.log('peak', Math.max(peak(r.L), peak(r.R)).toFixed(3), 'rms', rms(r.L).toFixed(4), 'notes', r.stats.notes.length);
fs.mkdirSync('output', { recursive: true });
const out = outArg || `output/${piece.id}.wav`;
fs.writeFileSync(out, encodeWav([r.L, r.R], r.fs, 16));
console.log('wrote', out);
