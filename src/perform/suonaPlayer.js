// 唢呐演奏者：吹气、吐音、连音、打音（倚音）、滑音、颤音、花舌。

import { RNG, clamp } from '../dsp/core.js';
import { Timeline } from './timeline.js';

function stepKeys(seq, trans = 0.02) {
  const keys = [];
  for (let i = 0; i < seq.length; i++) {
    keys.push([seq[i].t, seq[i].hz]);
    if (i + 1 < seq.length) keys.push([Math.max(seq[i].t + 1e-3, seq[i + 1].t - trans), seq[i].hz]);
  }
  return keys;
}

export function performSuona(score, s, opts = {}) {
  const tl = new Timeline(score, opts.timeline || {});
  const rng = new RNG(opts.seed ?? 23);
  const tuning = s.tuning;
  const vibDepth = opts.vibDepth ?? 24;

  const notes = [];
  for (const ev of score.events) {
    if (ev.type === 'note') notes.push({ ev, t0: tl.time(ev.t), t1: tl.time(ev.t + ev.dur), midi: ev.midi });
    else if (ev.type === 'run' && ev.notes) {
      const t0 = tl.time(ev.t), t1 = tl.time(ev.t + ev.dur), n = ev.notes.length;
      ev.notes.forEach((m, k) => notes.push({
        ev: { ...ev, type: 'note', flags: { ...ev.flags }, midi: m, dur: ev.dur / n, vel: ev.vel, slur: ev.slur || -1, graces: [] },
        t0: t0 + (t1 - t0) * k / n, t1: t0 + (t1 - t0) * (k + 1) / n, midi: m,
      }));
    }
  }
  const stats = { notes: [], tongues: 0 };
  let prev = null;

  for (let i = 0; i < notes.length; i++) {
    const n = notes[i], ev = n.ev;
    const hz = tuning.freqFrac(n.midi);
    const t0 = n.t0, t1 = n.t1, span = Math.max(0.04, t1 - t0);
    const gap = prev ? t0 - prev.t1 : 99;
    const legato = prev && gap < 0.05 && ev.slur && ev.slur === prev.slur;
    const v01 = clamp(ev.vel, 0.1, 1.0);
    const level = 0.68 + 0.26 * Math.pow(v01, 0.8);
    const amp = 0.32 + 0.68 * Math.pow(v01, 0.75);
    const stac = !!ev.flags.stac;

    // ---- 音高 ----
    const interval = prev ? Math.abs(n.midi - prev.midi) : 0;
    let seq;
    const glide = ev.glideFrom !== undefined && prev;
    if (glide && gap < 0.3) {
      const gd = clamp(0.09 + 0.014 * interval, 0.09, 0.26);
      seq = [{ t: 0, hz: prev.hz }, { t: Math.min(gd, span * 0.7), hz }];
    } else if (legato) {
      const tr = clamp(0.02 + 0.004 * interval, 0.02, 0.05);
      seq = [{ t: 0, hz: prev.hz }, { t: Math.min(tr, span * 0.6), hz }];
    } else seq = [{ t: 0, hz }];
    let tPitch = t0;
    if (ev.graces && ev.graces.length) {
      const G = ev.graces.length;
      const gs = ev.graces.map((gm, k) => ({ t: k * 0.05, hz: tuning.freqFrac(gm) }));
      const main = seq.map(q => ({ t: q.t + G * 0.05, hz: q.hz }));
      seq = [...gs, ...main];
      tPitch = t0 - G * 0.05;
    }
    const keys = (ev.graces && ev.graces.length) ? stepKeys(seq, 0.014) : seq.map(q => [q.t, q.hz]);
    if (keys.length === 1) keys.push([0.01, keys[0][1]]);
    keys.push([keys[keys.length - 1][0] + 0.001, hz]);
    s.pitch(tPitch, keys);

    // ---- 吹气 ----
    if (legato) {
      s.breath(t0 - 0.02, level, 0.045);
    } else {
      stats.tongues++;
      // 吐音：先把口压放低，再猛地起吹（略有过冲）
      if (prev && gap < 0.06) s.breath(t0 - 0.028, 0.32, 0.014);
      const att = stac ? 0.008 : 0.016;
      s.breath(t0 - att * 0.3, Math.min(0.98, level * 1.05), att);
      s.breath(t0 + 0.035, level, 0.05);
    }
    s.amp(t0 - 0.01, amp, ev.flags.accent ? 0.01 : 0.03);
    // 收气
    const next = notes[i + 1];
    const nextGap = next ? next.t0 - t1 : 99;
    const nextLegato = next && nextGap < 0.05 && next.ev.slur && next.ev.slur === ev.slur;
    if (!nextLegato) {
      const rel = stac ? 0.02 : (nextGap < 0.06 ? 0.03 : 0.06);
      const tEnd = stac ? t0 + Math.min(span * 0.5, 0.09) : t1 - (nextGap < 0.06 ? 0 : 0.01);
      if (nextGap >= 0.06 || stac) s.breath(Math.max(t0 + 0.04, tEnd - rel), 0, rel);
    }
    // ---- 颤音 / 花舌 ----
    let vibbed = false, flutter = false;
    if (ev.flags.trem && span > 0.25) {
      s.flutterTongue(t0 + 0.06, 22 + 4 * rng.next(), 0.72, span - 0.1);
      flutter = true;
    } else if (span >= 0.55 && !stac) {
      const delay = Math.min(0.26, span * 0.35);
      s.vibrato(t0 + delay, 5.6 + 0.9 * rng.next(), vibDepth * (0.75 + 0.4 * v01), 0.3, span - delay - 0.03, 0.05);
      vibbed = true;
    }
    stats.notes.push({ t0, t1, midi: n.midi, hz, vel: v01, vib: vibbed, flutter, glide: !!glide, legato: !!legato, stac });
    prev = { hz, t1, midi: n.midi, slur: ev.slur || -2 };
  }
  return stats;
}
