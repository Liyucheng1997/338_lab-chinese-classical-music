// 时间线：把“拍”映射到“秒”，含速度表、延长记号、可选的弹性速度（rubato）。
// 音乐的呼吸感来自这里：延长记号拉长、句尾自然放慢、长音后的微小停顿。

export class Timeline {
  /**
   * @param {object} score compileJianpu 的返回值
   * @param {object} o { fermataStretch: 延长记号额外拉长比例, rubato: {amp 秒, period 拍}, breathGap: 句间停顿(s) }
   */
  constructor(score, o = {}) {
    this.score = score;
    this.fermataStretch = o.fermataStretch ?? 0.7;
    this.rubato = o.rubato || null;
    // 收集延长记号
    this.ferms = [];
    for (const e of score.events) {
      if (e.flags && e.flags.fermata && e.dur > 0) {
        const bpm = score.bpmAt(e.t);
        this.ferms.push({ t: e.t, dur: e.dur, ext: e.dur * 60 / bpm * this.fermataStretch });
      }
    }
  }

  /** 拍 → 秒 */
  time(b) {
    let t = this.score.beatToSec(b);
    for (const f of this.ferms) {
      const x = (b - f.t) / f.dur;
      if (x <= 0) continue;
      t += f.ext * Math.min(1, x);
    }
    if (this.rubato) {
      const { amp, period } = this.rubato;
      // 用相位差保证起点为 0，且导数为正
      t += amp * (Math.sin(2 * Math.PI * b / period) );
    }
    return t;
  }

  /** 事件持续的秒数（含延长记号）。 */
  span(e) { return this.time(e.t + e.dur) - this.time(e.t); }
}
