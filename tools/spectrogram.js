// 频谱图：WAV → PNG（对数频率轴），用于目视检查泛音结构、颤音、滑音。
// 用法：node tools/spectrogram.js in.wav out.png [t0=0] [t1=end] [fmin=80] [fmax=8000] [width=1200] [height=500]
import fs from 'node:fs';
import zlib from 'node:zlib';
import { decodeWav } from '../src/wav.js';
import { fft, hann } from '../src/analysis/analysis.js';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePng(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function colormap(t) {
  // 黑 → 深蓝 → 紫红 → 橙 → 亮黄（近似 inferno）
  t = Math.max(0, Math.min(1, t));
  const stops = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]];
  const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  return stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
}

export function spectrogramPng(x, fs_, opts = {}) {
  const { t0 = 0, t1 = x.length / fs_, fmin = 80, fmax = 8000, W = 1200, H = 500, dbRange = 85, nfft = 4096 } = opts;
  const win = hann(nfft);
  const rgb = Buffer.alloc(W * H * 3);
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  const cols = [];
  let maxDb = -200;
  for (let cx = 0; cx < W; cx++) {
    const t = t0 + (t1 - t0) * (cx + 0.5) / W;
    const c = Math.round(t * fs_) - nfft / 2;
    for (let i = 0; i < nfft; i++) { re[i] = (x[c + i] || 0) * win[i]; im[i] = 0; }
    fft(re, im);
    const col = new Float64Array(H);
    for (let y = 0; y < H; y++) {
      const f = fmin * Math.pow(fmax / fmin, 1 - y / (H - 1));
      const b = f * nfft / fs_;
      const b0 = Math.floor(b), fr = b - b0;
      const m0 = Math.hypot(re[b0], im[b0]), m1 = Math.hypot(re[b0 + 1], im[b0 + 1]);
      const db = 20 * Math.log10((m0 * (1 - fr) + m1 * fr) / nfft * 4 + 1e-12);
      col[y] = db; if (db > maxDb) maxDb = db;
    }
    cols.push(col);
  }
  for (let cx = 0; cx < W; cx++) for (let y = 0; y < H; y++) {
    const [r, g, b] = colormap((cols[cx][y] - (maxDb - dbRange)) / dbRange);
    const o = (y * W + cx) * 3; rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
  }
  // 画频率刻度线
  for (const f of [100, 200, 500, 1000, 2000, 4000, 8000]) {
    if (f < fmin || f > fmax) continue;
    const y = Math.round((1 - Math.log(f / fmin) / Math.log(fmax / fmin)) * (H - 1));
    for (let cx = 0; cx < 14; cx++) { const o = (y * W + cx) * 3; rgb[o] = rgb[o + 1] = rgb[o + 2] = 255; }
  }
  return encodePng(W, H, rgb);
}

if (process.argv[1] && process.argv[1].endsWith('spectrogram.js')) {
  const [, , inp, out, t0, t1, fmin, fmax, W, H] = process.argv;
  const wav = decodeWav(new Uint8Array(fs.readFileSync(inp)));
  const png = spectrogramPng(wav.channels[0], wav.sampleRate, {
    t0: t0 ? +t0 : 0, t1: t1 ? +t1 : wav.channels[0].length / wav.sampleRate,
    fmin: fmin ? +fmin : 80, fmax: fmax ? +fmax : 8000, W: W ? +W : 1200, H: H ? +H : 500,
  });
  fs.writeFileSync(out, png);
  console.log('wrote', out);
}
