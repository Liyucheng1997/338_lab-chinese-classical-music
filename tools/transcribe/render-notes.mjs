// 渲染一首曲目并导出演奏音符（供扒谱评估）：node tools/transcribe/render-notes.mjs <id> <out.wav> <out.json>
import fs from 'node:fs';
import { renderPiece } from '../../src/render.js';
import { encodeWav } from '../../src/wav.js';
import { PIECES } from '../../src/pieces.js';

const [id, wav, json] = process.argv.slice(2);
const piece = PIECES.find((p) => p.id === id);
const r = renderPiece(piece, {});
fs.writeFileSync(wav, encodeWav([r.L, r.R], r.fs, 16));
fs.writeFileSync(json, JSON.stringify(r.stats.notes.map((n) => [n.t0 ?? n.t, n.t1 ?? (n.t + n.dur), n.midi])));
console.log(`${piece.title}：${r.duration.toFixed(1)} 秒，${r.stats.notes.length} 个音`);
