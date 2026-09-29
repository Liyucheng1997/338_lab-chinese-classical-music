// 动画工具：插值、缓动、按时间查找音符。
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** 已按 t 排序的音符中，最后一个 t ≤ time 的下标（没有则 −1）。 */
export function lastStarted(notes, time) {
  let a = 0;
  let b = notes.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (notes[m].t <= time) a = m + 1;
    else b = m;
  }
  return a - 1;
}

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const ftom = (f) => 69 + 12 * Math.log2(f / 440);

/**
 * 触发器：在两帧之间越过起音时刻的音符调用 fn；时间跳变（拖动进度、换曲）时只重置不触发。
 */
export class OnsetTracker {
  constructor() {
    this.last = -1;
    this.notes = null;
  }

  update(notes, time, fn) {
    if (notes !== this.notes || time < this.last - 0.05 || time > this.last + 0.5) {
      this.notes = notes;
      this.last = time;
      return;
    }
    if (time <= this.last) return;
    let i = lastStarted(notes, this.last) + 1;
    for (; i < notes.length && notes[i].t <= time; i++) fn(notes[i], i);
    this.last = time;
  }
}
