// 音高体系：MIDI 音符 ↔ 频率，支持 12 平均律 / 五度相生律 / 纯律。
// 默认 12 平均律（A4 = 440 Hz），这也是现代古筝（电子调音器定弦）与加键唢呐的实际音律。

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiName(m) {
  const r = Math.round(m);
  return NOTE_NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
}

/** 主音到各半音的音分值（相对主音）。 */
export const TEMPERAMENTS = {
  equal:      [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100],
  pythagorean:[0, 113.685, 203.910, 294.135, 407.820, 498.045, 611.730, 701.955, 815.640, 905.865, 996.090, 1109.775],
  just:       [0, 111.731, 203.910, 315.641, 386.314, 498.045, 590.224, 701.955, 813.686, 884.359, 1017.596, 1088.269],
};

export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

export class Tuning {
  /**
   * @param {number} tonicMidi  主音 MIDI 号（如 D4=62）
   * @param {string} kind       'equal' | 'pythagorean' | 'just'
   * @param {number} a4         A4 基准频率
   */
  constructor(tonicMidi = 62, kind = 'equal', a4 = 440) {
    this.tonic = tonicMidi;
    this.kind = kind;
    this.a4 = a4;
    this.table = TEMPERAMENTS[kind] || TEMPERAMENTS.equal;
    this.tonicHz = a4 * Math.pow(2, (tonicMidi - 69) / 12);
  }
  /** 给定 MIDI 半音号（相对绝对音高）返回频率。 */
  freq(midi) {
    if (this.kind === 'equal') return this.a4 * Math.pow(2, (midi - 69) / 12);
    const rel = midi - this.tonic;
    const oct = Math.floor(rel / 12);
    const step = ((rel % 12) + 12) % 12;
    const cents = oct * 1200 + this.table[step];
    return this.tonicHz * Math.pow(2, cents / 1200);
  }
  /** 连续 MIDI 值（含小数）的频率，小数部分按平均律音分内插。 */
  freqFrac(midiFloat) {
    const lo = Math.floor(midiFloat), fr = midiFloat - lo;
    const f0 = this.freq(lo);
    if (fr === 0) return f0;
    const f1 = this.freq(lo + 1);
    return f0 * Math.pow(f1 / f0, fr);
  }
  /** 简谱音级 → MIDI：degree 1..7，accidental 半音偏移，octave 为八度偏移（相对主音所在八度）。 */
  degreeToMidi(degree, octave = 0, accidental = 0) {
    return this.tonic + MAJOR_SCALE[degree - 1] + accidental + 12 * octave;
  }
}
