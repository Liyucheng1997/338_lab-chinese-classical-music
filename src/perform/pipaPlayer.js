// 琵琶演奏者：把简谱事件翻译成左手按品、右手弹挑、轮指、扫拂、推拉、吟揉、绞弦、泛音。
//
// 选弦：以把位低、少换把为原则；旋律优先在子弦上，低于子弦空弦的音依次落到中弦、老弦、缠弦。
// 右手：单音“弹”（食指外弹）与“挑”（拇指内挑）交替；~ 为轮指（小、无名、中、食四指依次外弹 + 拇指挑，
//       约每秒 16–20 下）；三音以上的和音为“扫”（由缠弦扫向子弦），带 ~ 的和音为扫拂交替。
// 左手：按品取音；^ 推弦到上方音级；/ \ 从前一音推拉滑到本音；长音加“吟”（琵琶吟揉只向上推）。
// 记号：x 绞弦（子、中两弦绞在一起弹，金铁撞击声），o 泛音。

import { RNG, clamp } from '../dsp/core.js';
import { PIPA_OPEN } from '../dsp/pipa.js';
import { Timeline } from './timeline.js';

const NEXT_STEP = { 0: 2, 2: 2, 4: 1, 5: 2, 7: 2, 9: 2, 11: 1 };
function stepUp(midi, tonic) {
  const pc = (((midi - tonic) % 12) + 12) % 12;
  return (NEXT_STEP[pc] ?? 2) * 100;
}

// 轮指一轮五下的力度（小、无名、中、食外弹，拇指内挑）
const LUN = [0.8, 0.86, 0.9, 1.0, 0.92];
export const LUN_FINGERS = ['小', '无名', '中', '食', '大'];

export function performPipa(score, p, opts = {}) {
  const tl = new Timeline(score, opts.timeline || {});
  const rng = new RNG(opts.seed ?? 41);
  const tonic = score.meta.tonic;
  const stats = { plucks: 0, skipped: 0, notes: [] };
  const velOf = (e, extra = 0) => clamp(0.22 + 0.74 * e.vel + extra, 0.12, 1.0);
  // 每根弦当前按的音分与最近一次拨弦时刻（用于换把止音）
  const held = [0, 0, 0, 0].map(() => ({ cents: 0, t: -99, end: -99 }));
  let pos = 0;         // 左手把位（半音）
  let dir = 1;         // 弹 / 挑 交替

  function fit(m) {
    while (m < PIPA_OPEN[3] - 0.05) m += 12;
    while (m > PIPA_OPEN[0] + 28.5) m -= 12;
    return m;
  }

  /** 选弦：把位低、少换把；exclude 为和音中已用的弦。 */
  function choose(midi, exclude = null, prefer = -1) {
    const c = p.candidates(fit(midi)).filter(x => !exclude || !exclude.has(x.string));
    if (!c.length) return null;
    let best = null, bc = 1e9;
    for (const x of c) {
      const cost = 0.18 * x.semis + (x.string === 0 ? 0 : 0.45) + 0.12 * Math.abs(x.semis - pos) * (x.semis > 0 ? 1 : 0.2)
        + (x.string === prefer ? -0.6 : 0) + (x.semis > 12 && x.string > 0 ? 3 : 0);
      if (cost < bc) { bc = cost; best = x; }
    }
    return best;
  }

  /** 左手离开旧的按音：换到别的品位时旧弦被手指抬起（半止音）。 */
  function release(t, sIdx, newCents) {
    const h = held[sIdx];
    if (h.cents > 40 && Math.abs(h.cents - newCents) > 40 && t - h.t < 3) p.damp(Math.max(h.t + 0.03, t - 0.01), sIdx, 25, 0.9);
  }

  function pluck(t, f, vel, o = {}) {
    release(t, f.string, f.cents);
    p.pluck(t, f.string, vel, { cents: f.cents, pos: o.pos, bright: o.bright, extraGain: o.extraGain, harm: o.harm });
    held[f.string] = { cents: f.cents, t, end: t };
    if (f.semis > 0) pos = f.semis;
    stats.plucks++;
  }

  /** 单音：弹 / 挑 / 轮指 / 推拉 / 吟 / 泛音 / 绞弦 */
  function playNote(e, midi, t0, span, prevNote) {
    const flags = e.flags || {};
    let f = null;
    const acc = flags.accent ? 0.1 : 0;
    // 滑音：同弦推拉
    if (e.glideFrom !== undefined && prevNote && prevNote.f && Math.abs(midi - e.glideFrom) <= 4) {
      const pf = prevNote.f;
      const semis = midi - PIPA_OPEN[pf.string];
      if (semis >= 0) f = { string: pf.string, semis, cents: 1200 * Math.log2(p.tuning.freqFrac(fit(midi)) / p.strings[pf.string].f0) };
    }
    if (!f) f = choose(midi, null, prevNote && prevNote.f ? prevNote.f.string : -1);
    if (!f) { stats.skipped++; return null; }
    const v = velOf(e, acc);
    let kind = 'note';
    let finger = dir > 0 ? 'tan' : 'tiao';
    if (flags.jiao) {
      // 绞弦：左手把子弦、中弦绞在一起按住，右手弹 —— 两弦同时发出相近而不准的音，并互相撞击
      kind = 'jiao';
      const c0 = 1200 * Math.log2(p.tuning.freqFrac(fit(midi)) / p.strings[0].f0);
      // 两弦绞在同一点被按住：音高接近而略不齐（±半音以内），靠撞击噪声取胜
      const c1 = c0 + 500 + 40 * rng.bipolar();
      const hits = flags.trem ? Math.max(1, Math.floor(span * 12)) : 1;
      for (let k = 0; k < hits; k++) {
        const tt = t0 + k / 12 + rng.gauss() * 0.003;
        p.pluck(tt, 0, v * 0.7, { cents: Math.max(0, c0 + 30 * rng.bipolar()), bright: 0.9, extraGain: 0.8 });
        p.pluck(tt + 0.003, 1, v * 0.6, { cents: Math.max(0, c1), bright: 0.9, extraGain: 0.8 });
        p.rattleHit(tt, v, 0.09 + 0.05 * rng.next(), 18 + 10 * rng.next());
        p.damp(tt + Math.min(0.07, 0.8 / 12), 0, 20, 0.82);
        p.damp(tt + Math.min(0.07, 0.8 / 12), 1, 20, 0.82);
        stats.plucks += 2;
      }
      held[0] = { cents: c0, t: t0, end: t0 + span }; held[1] = { cents: c1, t: t0, end: t0 + span };
      f = { string: 0, semis: c0 / 100, cents: c0 };
    } else if (flags.harm) {
      kind = 'harm';
      pluck(t0, f, v * 0.9, { harm: 2, bright: 0.2, pos: 0.25 });
    } else if (flags.trem) {
      kind = 'lun';
      // 轮指：速度随力度略增，首下为食指“弹”起
      const rate = clamp(16.5 + 3 * (e.vel - 0.5), 15, 19.5);
      const n = Math.max(1, Math.round(span * rate));
      pluck(t0, f, v, {});
      p.shortenT60(t0 + 0.03, f.string, 0.7, 25);
      for (let k = 1; k < n; k++) {
        const tt = t0 + k / rate + rng.gauss() * 0.0025;
        const shape = LUN[(k + 3) % 5] * (0.78 + 0.1 * Math.sin(Math.PI * k / Math.max(2, n)));
        // 轮指每一下比单弹轻，指甲触弦面积小，起音较柔
        p.pluck(tt, f.string, v * shape, { cents: f.cents, extraGain: 0.58, pos: 0.08 + 0.05 * rng.next(), bright: 0.42 });
        stats.plucks++;
      }
      held[f.string].end = t0 + span;
    } else {
      pluck(t0, f, v, {});
      dir = -dir;
    }
    // 左手：推弦 / 滑音 / 吟
    let bend = 0;
    if (kind !== 'jiao' && kind !== 'harm') {
      if (flags.press) {
        const amt = stepUp(midi, tonic);
        p.bend(t0, f.string, [[0, f.cents], [0.06, f.cents], [0.22, f.cents + amt]]);
        bend = amt;
      } else if (e.glideFrom !== undefined && prevNote && prevNote.f && prevNote.f.string === f.string) {
        const from = f.cents + (e.glideFrom - midi) * 100;
        p.bend(t0, f.string, [[0, from], [Math.min(0.12, span * 0.5), f.cents]]);
        bend = e.glideFrom - midi;
      } else if (span > 0.9 && !flags.stac) {
        p.vibrato(t0 + Math.min(0.35, span * 0.3), f.string, 5.2 + rng.next() * 0.8, 18 + 14 * e.vel, 0.35, span - 0.3);
      }
    }
    if (flags.stac) p.damp(t0 + Math.min(span * 0.6, 0.12), f.string, 15, 0.75);
    // 按音结束时左手抬指：弦被指肚带住，余音很快消失（空弦音则任其延续）
    else if (kind !== 'jiao' && kind !== 'harm' && f.semis > 0.4 && span < 4) p.damp(t0 + span - 0.004, f.string, 40, 0.965);
    stats.notes.push({
      t0, t1: t0 + span, midi, hz: p.tuning.freqFrac(midi), string: f.string, fret: Math.max(0, f.cents / 100), kind, finger,
      vel: e.vel, trem: kind === 'lun', stac: !!flags.stac, press: !!flags.press, bend, vib: span > 0.9 && kind === 'note',
    });
    return { f, midi };
  }

  /** 和音：两音为“分”（双指同拨），三音以上为“扫”；带 ~ 为扫拂交替。 */
  function playChord(e, pitches, t0, span) {
    // 和音选弦：四根弦各发一个音，穷举分配（最多 4! 种），把位总和最低、跨度最小者胜出；
    // 分配不下的音（两个音只能在同一根弦上）舍去较弱的低音
    const ms = [...new Set(pitches.map(fit))].sort((a, b) => b - a).slice(0, 4);
    const opts_ = ms.map(m => p.candidates(m));
    let best = null, bc = 1e9;
    const pick = [];
    (function search(k, used) {
      if (k === ms.length) {
        const sel = pick.filter(Boolean);
        if (!sel.length) return;
        const fr = sel.map(x => x.semis).filter(x => x > 0);
        const span = fr.length ? Math.max(...fr) - Math.min(...fr) : 0;
        const cost = (ms.length - sel.length) * 10 + sel.reduce((a, x) => a + 0.15 * x.semis, 0) + (span > 4 ? 2 * (span - 4) : 0);
        if (cost < bc) { bc = cost; best = sel.map(x => ({ f: x, m: x.m })); }
        return;
      }
      for (const c of opts_[k]) {
        if (used & (1 << c.string)) continue;
        pick[k] = { ...c, m: ms[k] };
        search(k + 1, used | (1 << c.string));
      }
      pick[k] = null;
      search(k + 1, used);
    })(0, 0);
    const fs = best || [];
    stats.skipped += ms.length - fs.length;
    if (!fs.length) return null;
    fs.sort((a, b) => b.f.string - a.f.string); // 缠弦 → 子弦
    const v = velOf(e, e.flags.accent ? 0.1 : 0);
    const strum = fs.length >= 3;
    const kind = strum ? 'sao' : 'chord';
    const strokes = e.flags.trem ? Math.max(1, Math.round(span * 12)) : 1;
    for (let k = 0; k < strokes; k++) {
      const down = k % 2 === 0; // 扫（向子弦）/ 拂（向缠弦）
      const order = down ? fs : [...fs].reverse();
      const tt = t0 + k / 12 + (k ? rng.gauss() * 0.003 : 0);
      const gap = strum ? 0.009 + 0.004 * rng.next() : 0.004;
      order.forEach((x, j) => {
        const vv = v * (k ? (down ? 0.85 : 0.72) : 1) * (0.92 + 0.08 * j / Math.max(1, order.length - 1));
        if (k === 0) pluck(tt + j * gap, x.f, vv, { pos: 0.1, bright: 0.8 });
        else { p.pluck(tt + j * gap, x.f.string, vv, { cents: x.f.cents, extraGain: 0.7, pos: 0.1 }); stats.plucks++; }
      });
    }
    if (strokes > 1) for (const x of fs) p.shortenT60(t0 + 0.03, x.f.string, 0.8, 25);
    if (e.flags.stac) for (const x of fs) p.damp(t0 + Math.min(span * 0.6, 0.12), x.f.string, 15, 0.75);
    fs.forEach((x, j) => stats.notes.push({
      t0: t0 + j * 0.01, t1: t0 + span, midi: x.m, hz: p.tuning.freqFrac(x.m), string: x.f.string, fret: Math.max(0, x.f.cents / 100),
      kind, finger: 'tan', vel: e.vel, trem: strokes > 1, stac: !!e.flags.stac, chord: fs.length, bend: 0,
    }));
    const top = fs[fs.length - 1];
    return { f: top.f, midi: top.m };
  }

  let prevNote = null;
  for (const e of score.events) {
    if (e.type === 'note') {
      const span = tl.span(e);
      const t0 = tl.time(e.t) + rng.gauss() * 0.003;
      if (e.graces && e.graces.length) {
        e.graces.forEach((gm, k) => {
          const f = choose(gm);
          if (f) pluck(t0 - 0.045 * (e.graces.length - k), f, velOf(e, -0.2), { extraGain: 0.8 });
        });
      }
      prevNote = playNote(e, e.midi, t0, span, prevNote) || prevNote;
    } else if (e.type === 'chord') {
      prevNote = playChord(e, e.pitches, tl.time(e.t), tl.span(e)) || prevNote;
    } else if (e.type === 'run') {
      const t0 = tl.time(e.t), t1 = tl.time(e.t + e.dur);
      let pitches = e.notes;
      if (e.sweep) {
        // 刮奏式快速音阶：按五声音阶逐级
        const a = e.sweep.from, b = e.sweep.to, out = [];
        const penta = [0, 2, 4, 7, 9];
        for (let m = Math.min(a, b); m <= Math.max(a, b); m++) if (penta.includes((((m - tonic) % 12) + 12) % 12)) out.push(m);
        pitches = a > b ? out.reverse() : out;
      }
      const n = pitches.length;
      pitches.forEach((m, k) => {
        const tt = t0 + (t1 - t0) * k / n + rng.gauss() * 0.0015;
        const sub = { ...e, flags: { ...e.flags, trem: false }, glideFrom: undefined };
        prevNote = playNote(sub, m, tt, (t1 - t0) / n, prevNote) || prevNote;
      });
    }
  }
  return stats;
}
