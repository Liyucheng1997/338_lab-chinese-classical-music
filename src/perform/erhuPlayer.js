// 二胡演奏者：选弦、运弓（拉/推、换弓、连弓）、揉弦、滑音、倚音、力度。

import { RNG, clamp } from '../dsp/core.js';
import { Timeline } from './timeline.js';

/** 平台式音高关键帧：每个音保持其音高，仅在音与音之间做很短的平滑过渡。 */
function stepKeys(seq, trans = 0.03) {
  // seq: [{t, hz}] 严格递增的时间（相对起点）
  const keys = [];
  for (let i = 0; i < seq.length; i++) {
    keys.push([seq[i].t, seq[i].hz]);
    if (i + 1 < seq.length) keys.push([Math.max(seq[i].t + 1e-3, seq[i + 1].t - trans), seq[i].hz]);
  }
  return keys;
}

export function performErhu(score, e, opts = {}) {
  const tl = new Timeline(score, opts.timeline || {});
  const rng = new RNG(opts.seed ?? 17);
  const tuning = e.tuning;
  const maxBowSec = opts.maxBowSec ?? 5.5;
  const vibDepth = opts.vibDepth ?? 24;
  const scoop = opts.scoop ?? 22;

  // 1) 展开为线性音符序列
  const notes = [];
  for (const ev of score.events) {
    if (ev.type === 'note') {
      notes.push({ ev, t0: tl.time(ev.t), t1: tl.time(ev.t + ev.dur), midi: ev.midi });
    } else if (ev.type === 'run' && ev.notes) {
      const t0 = tl.time(ev.t), t1 = tl.time(ev.t + ev.dur), n = ev.notes.length;
      ev.notes.forEach((m, k) => notes.push({ ev: { ...ev, type: 'note', flags: { ...ev.flags }, midi: m, dur: ev.dur / n, vel: ev.vel, slur: ev.slur || -1 }, t0: t0 + (t1 - t0) * k / n, t1: t0 + (t1 - t0) * (k + 1) / n, midi: m }));
    }
  }
  const stats = { notes: [], bowChanges: 0 };
  const fOpen = [tuning.freq(62), tuning.freq(69)];

  let prev = null;          // 上一个音符（含 str, hz, t1, bowStart）
  let bowStart = -1;

  for (let i = 0; i < notes.length; i++) {
    const n = notes[i], ev = n.ev;
    const hz = tuning.freqFrac(n.midi);
    const str = n.midi <= 68 ? 0 : 1;
    const fingered = Math.abs(hz - fOpen[str]) > 0.35;
    const t0 = n.t0, t1 = n.t1, span = Math.max(0.05, t1 - t0);
    const gap = prev ? t0 - prev.t1 : 99;
    const legato = prev && gap < 0.06 && (
      (ev.slur && ev.slur === prev.slur) ||
      (span < 0.6 && prev.span < 0.6 && Math.abs(n.midi - prev.midi) <= 5 && (t0 - bowStart) < maxBowSec * 0.7)
    );
    const v01 = clamp(ev.vel, 0.12, 1.0);
    // 弓速随力度与音高：高把位弓位比例增大，需相应降低弓速保持音量均衡
    const pitchComp = Math.pow(hz / 440, 0.28);
    const vB = (0.032 + 0.105 * Math.pow(v01, 1.15)) / pitchComp * (ev.flags.accent ? 1.15 : 1);
    const slope = clamp(3.4 + 0.8 * Math.log2(hz / 440), 2.6, 5.0);
    const press = (5 - slope) / 4;

    // 2) 音高
    const interval = prev ? Math.abs(n.midi - prev.midi) : 0;
    let seq;
    const gl = ev.glideFrom !== undefined && prev && prev.str === str;
    let tPitch = t0;
    if (legato && prev && prev.str === str) {
      // 连弓内的音高变化：手指移动，短暂过渡（滑音记号则更长）
      const trans = gl ? clamp(0.10 + 0.012 * interval, 0.10, 0.20) : clamp(0.018 + 0.004 * interval, 0.018, 0.05);
      seq = [{ t: 0, hz: prev.hz }, { t: Math.min(trans, span * 0.6), hz }];
      // 用平滑段：从 prev.hz 滑到 hz
    } else if (gl && prev && prev.str === str && gap < 0.2) {
      seq = [{ t: 0, hz: prev.hz }, { t: clamp(0.10 + 0.012 * interval, 0.10, 0.20), hz }];
    } else if (!prev || gap > 0.06 || !(legato)) {
      // 新弓起音：略从下方“滑上”，更像人声
      const from = (fingered && span > 0.35 && !ev.flags.stac) ? hz * Math.pow(2, -scoop / 1200) : hz;
      seq = from === hz ? [{ t: 0, hz }] : [{ t: 0, hz: from }, { t: 0.055, hz }];
    } else seq = [{ t: 0, hz }];
    // 倚音
    if (ev.graces && ev.graces.length) {
      const G = ev.graces.length;
      const gs = ev.graces.map((gm, k) => ({ t: k * 0.055, hz: tuning.freqFrac(gm) }));
      const main = seq.map(s => ({ t: s.t + G * 0.055, hz: s.hz }));
      seq = [...gs, ...main];
      tPitch = t0 - G * 0.055;
    }
    // 关键帧：相对 tPitch
    const keys = [];
    for (let k = 0; k < seq.length; k++) keys.push([seq[k].t, seq[k].hz]);
    if (seq.length === 1) keys.push([0.01, seq[0].hz]);
    // 如果是平台式（倚音）则用 stepKeys
    const useKeys = (ev.graces && ev.graces.length) ? stepKeys(seq, 0.02) : keys;
    // 落点保持
    useKeys.push([useKeys[useKeys.length - 1][0] + 0.001, hz]);
    e.pitch(tPitch, str, useKeys, fingered);

    // 3) 运弓
    const newBow = !legato;
    if (newBow) {
      stats.bowChanges++;
      bowStart = t0;
      // 换弓：前一弓在换弓处衰减到很低（推/拉方向反转），再起新弓
      if (prev && gap < 0.06) {
        // 同一弦：弓速经过接近零的低点再反向；换弦：旧弦完全放弓
        if (prev.str === str) e.bow(Math.max(0, t0 - 0.05), prev.str, vB * 0.12, press, 0.045);
        else e.bow(Math.max(0, t0 - 0.03), prev.str, 0, press, 0.03);
      } else if (prev && prev.str !== str) {
        e.bow(Math.max(0, t0 - 0.02), prev.str, 0, press, 0.02);
      }
      const attack = ev.flags.accent ? 0.03 : clamp(0.045 + 0.05 * (1 - v01), 0.045, 0.09);
      const noteDip = prev && gap < 0.06 ? 0.0 : 0;
      e.bow(t0 - 0.006, str, vB, press, attack + 0.006);
    } else {
      // 连弓：弓速平滑过渡；跨弦时旧弦放弓
      if (prev.str !== str) e.bow(t0 - 0.01, prev.str, 0, press, 0.03);
      e.bow(t0 - 0.02, str, vB, press, 0.06);
    }
    // 4) 收弓
    const next = notes[i + 1];
    const nextGap = next ? next.t0 - t1 : 99;
    const nextLegato = next && nextGap < 0.06 && (
      (next.ev.slur && next.ev.slur === ev.slur) ||
      (next.t1 - next.t0 < 0.6 && span < 0.6 && Math.abs(next.midi - n.midi) <= 5 && (next.t0 - bowStart) < maxBowSec * 0.7)
    );
    if (!nextLegato) {
      const rel = ev.flags.stac ? 0.03 : (nextGap < 0.06 ? 0.045 : clamp(0.08 + 0.05 * v01, 0.08, 0.14));
      const tEnd = t1 - (nextGap < 0.06 ? 0.0 : Math.min(rel, span * 0.3)) - (ev.flags.stac ? span * 0.35 : 0);
      // 与下一弓相接时由下一音的起弓处理，这里只在有间隙时收弓
      if (nextGap >= 0.06 || ev.flags.stac) e.bow(Math.max(t0 + 0.05, tEnd), str, 0, press, rel);
    }
    // 5) 揉弦
    let vibbed = false;
    if (span >= 0.72 && !ev.flags.stac) {
      const delay = Math.min(0.28, span * 0.3);
      const rate = 5.1 + 0.9 * rng.next();
      e.vibrato(t0 + delay, str, rate, vibDepth * (0.75 + 0.45 * v01) * (ev.flags.trem ? 1.3 : 1), 0.4, span - delay - 0.03);
      vibbed = true;
    } else if (ev.flags.trem && span > 0.3) {
      e.vibrato(t0 + 0.08, str, 6.0, vibDepth * 0.8, 0.15, span - 0.12);
      vibbed = true;
    }

    stats.notes.push({ t0, t1, midi: n.midi, hz, str, fingered, vel: v01, vib: vibbed, glide: !!gl, legato: !!legato, scoop: seq.length > 1 && !legato, stac: !!ev.flags.stac });
    prev = { str, hz, t1, midi: n.midi, span, slur: ev.slur || -2, bowStart };
  }
  return stats;
}
