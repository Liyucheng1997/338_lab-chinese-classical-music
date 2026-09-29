// 古筝演奏者：把简谱事件翻译成拨弦、按音、揉弦、摇指、刮奏。

import { RNG, clamp } from '../dsp/core.js';
import { GUZHENG_MIDI } from '../dsp/guzheng.js';
import { Timeline } from './timeline.js';

const NEXT_STEP = { 0: 2, 2: 2, 4: 1, 5: 2, 7: 2, 9: 2, 11: 1 };

/** 按音上滑量：滑到下一个自然音级（全音或半音）。 */
function pressAmount(midi, tonic) {
  const pc = (((midi - tonic) % 12) + 12) % 12;
  return (NEXT_STEP[pc] ?? 2) * 100;
}

export function performGuzheng(score, g, opts = {}) {
  const tl = new Timeline(score, opts.timeline || {});
  const rng = new RNG(opts.seed ?? 31);
  const tonic = score.meta.tonic;
  const stats = { plucks: 0, skipped: 0, notes: [] };
  const lastPluck = new Float64Array(g.n).fill(-99);

  const velOf = (e, extra = 0) => clamp(0.20 + 0.74 * e.vel + extra, 0.12, 1.0);

  function fit(midi) {
    let m = midi;
    while (m < GUZHENG_MIDI[0] - 0.05) m += 12;
    while (m > GUZHENG_MIDI[g.n - 1] + 3.2) m -= 12;
    return m;
  }

  /** 拨一个音，返回 { string, cents } 供后续使用。 */
  function pluck(t, midi, vel, o = {}) {
    const m = fit(midi);
    const f = g.findString(m);
    if (!f) { stats.skipped++; return null; }
    // 再次拨同一根弦前先用手指按止旧的振动
    if (t - lastPluck[f.string] < 4 && !o.noMute) g.damp(Math.max(0, t - 0.012), f.string, 9, 0.70);
    g.pluck(t, f.string, vel, { cents: f.cents, pos: o.pos, bright: o.bright, extraGain: o.extraGain });
    lastPluck[f.string] = t;
    stats.plucks++;
    return f;
  }

  for (const e of score.events) {
    if (e.type === 'note') {
      const span = tl.span(e);
      let t0 = tl.time(e.t) + rng.gauss() * 0.0035;
      // 倚音
      if (e.graces && e.graces.length) {
        e.graces.forEach((gm, k) => pluck(t0 - 0.05 * (e.graces.length - k), gm, velOf(e, -0.25), { extraGain: 0.8 }));
      }
      const acc = e.flags.accent ? 0.10 : 0;
      if (e.flags.trem) {
        // 摇指：以 ~13 Hz 反复拨同一弦
        const f = pluck(t0, e.midi, velOf(e, acc), {});
        if (f) {
          const rate = clamp(13 + 3 * (e.vel - 0.5), 11, 16);
          g.shortenT60(t0 + 0.03, f.string, 1.1, 25);
          const n = Math.max(1, Math.floor(span * rate));
          for (let k = 1; k < n; k++) {
            const tt = t0 + k / rate + rng.gauss() * 0.0025;
            const shape = 0.62 + 0.18 * Math.sin(Math.PI * k / Math.max(2, n)) ;
            const s = g.strings[f.string];
            g.pluck(tt, f.string, velOf(e) * shape, { cents: f.cents, extraGain: 0.52, pos: 0.18 + 0.08 * rng.next() });
            stats.plucks++;
          }
          if (e.flags.press) {
            const amt = pressAmount(e.midi, tonic);
            g.bend(t0, f.string, [[0, f.cents], [0.05, f.cents], [0.22, f.cents + amt]]);
          }
          stats.notes.push({ t: t0, midi: e.midi, dur: span, string: f.string, kind: 'tremolo', vel: e.vel, press: !!e.flags.press });
        }
      } else {
        const f = pluck(t0, e.midi, velOf(e, acc), {});
        if (f) {
          stats.notes.push({ t: t0, midi: e.midi, dur: span, string: f.string, cents: f.cents, kind: 'note', vel: e.vel, press: !!e.flags.press, vib: !e.flags.press && span > 1.1 && !e.flags.stac, stac: !!e.flags.stac });
          if (e.flags.press) {
            const amt = pressAmount(e.midi, tonic);
            g.bend(t0, f.string, [[0, f.cents], [0.05, f.cents], [0.20, f.cents + amt]]);
          } else if (span > 1.1 && !e.flags.stac) {
            // 长音揉弦
            g.vibrato(t0 + 0.4, f.string, 5.0 + rng.next() * 0.6, 12 + 6 * e.vel, 0.6, span - 0.4);
          }
          if (e.flags.stac) g.damp(t0 + Math.min(span * 0.6, 0.25), f.string, 20, 0.80);
        }
      }
    } else if (e.type === 'chord') {
      const t0 = tl.time(e.t);
      const ps = [...e.pitches].sort((a, b) => a - b);
      const span = tl.span(e);
      ps.forEach((m, k) => {
        const f = pluck(t0 + k * 0.009 + rng.gauss() * 0.002, m, velOf(e, e.flags.accent ? 0.1 : 0) * (0.92 + 0.08 * k / Math.max(1, ps.length - 1)), {});
        if (f) {
          stats.notes.push({ t: t0 + k * 0.009, midi: m, dur: span, string: f.string, cents: f.cents, kind: 'chord', vel: e.vel, press: !!e.flags.press && k === ps.length - 1, trem: !!e.flags.trem });
          if (e.flags.trem) {
            const rate = 13;
            g.shortenT60(t0 + 0.03, f.string, 1.1, 25);
            const n = Math.max(1, Math.floor(span * rate));
            for (let q = 1; q < n; q++) {
              const shape = 0.6 + 0.18 * Math.sin(Math.PI * q / Math.max(2, n));
              g.pluck(t0 + q / rate + k * 0.004 + rng.gauss() * 0.0025, f.string, velOf(e) * shape, { cents: f.cents, extraGain: 0.5, pos: 0.18 + 0.08 * rng.next() });
              stats.plucks++;
            }
          }
          if (e.flags.press && k === ps.length - 1) {
            const amt = pressAmount(m, tonic);
            g.bend(t0, f.string, [[0, f.cents], [0.05, f.cents], [0.20, f.cents + amt]]);
          }
        }
      });
    } else if (e.type === 'run') {
      const t0 = tl.time(e.t), t1 = tl.time(e.t + e.dur);
      let pitches;
      if (e.sweep) {
        const a = e.sweep.from, b = e.sweep.to;
        const lo = Math.min(a, b), hi = Math.max(a, b);
        pitches = GUZHENG_MIDI.filter(m => m >= lo - 0.01 && m <= hi + 0.01);
        if (a > b) pitches.reverse();
      } else pitches = e.notes;
      const n = pitches.length;
      const rising = n > 1 && pitches[n - 1] > pitches[0];
      pitches.forEach((m, k) => {
        const tt = t0 + (t1 - t0) * k / n + rng.gauss() * 0.0015;
        // 走句力度：整体渐强或渐弱，首音略重
        const shape = e.sweep ? (0.72 + 0.28 * k / Math.max(1, n - 1)) : (1.0 - 0.28 * k / Math.max(1, n - 1));
        const f = pluck(tt, m, velOf(e, k === 0 ? 0.08 : 0) * shape, { noMute: true, extraGain: 0.95 });
        if (f) stats.notes.push({ t: tt, midi: m, dur: (t1 - t0) / n, string: f.string, kind: e.sweep ? 'sweep' : 'run', vel: e.vel * shape });
      });
    }
  }
  return stats;
}
