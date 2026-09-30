// 渲染 Worker：在后台线程中用同一套物理建模引擎把整首曲子渲染成立体声 PCM。
import { renderPiece } from '../src/render.js';
import { PIECES } from '../src/pieces.js';
import { tuningSummary } from '../src/tuningSummary.js';

self.onmessage = (e) => {
  const { id, tuning, requestId } = e.data;
  try {
    const piece = PIECES.find(p => p.id === id);
    const r = renderPiece(piece, {
      tuning, keepDry: true,
      onProgress: (f) => self.postMessage({ type: 'progress', requestId, f }),
    });
    const summary = tuningSummary(piece, r);
    const notes = r.stats.notes.map(n => ({
      t: n.t0 ?? n.t, d: n.t1 !== undefined ? n.t1 - n.t0 : (n.dur || 0.2),
      m: n.midi, hz: n.hz || 0, s: n.string, k: n.kind || '', st: !!n.stac,
      v: n.vel ?? 0.6, str: n.str, lg: !!n.legato, vib: !!n.vib, gl: !!n.glide, fl: !!n.flutter,
      pr: !!n.press, tr: !!n.trem || n.kind === 'tremolo',
      f: n.fret, fg: n.finger, b: n.bend || 0, ch: n.chord || 0,
    }));
    self.postMessage({
      type: 'done', requestId, fs: r.fs, L: r.L, R: r.R, notes, duration: r.duration,
      sections: r.sections, summary, warnings: r.score.warnings,
    }, [r.L.buffer, r.R.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', requestId, message: String(err && err.stack || err) });
  }
};
