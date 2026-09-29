// 最小 WAV 读写（16/24 位 PCM、32 位浮点），浏览器与 Node 共用。

export function encodeWav(channels, sampleRate, bitDepth = 16) {
  const nCh = channels.length;
  const n = channels[0].length;
  const bytes = bitDepth / 8;
  const dataSize = n * nCh * bytes;
  const buf = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(buf);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF'); dv.setUint32(4, 36 + dataSize, true); wstr(8, 'WAVE');
  wstr(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, bitDepth === 32 ? 3 : 1, true);
  dv.setUint16(22, nCh, true); dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * nCh * bytes, true);
  dv.setUint16(32, nCh * bytes, true); dv.setUint16(34, bitDepth, true);
  wstr(36, 'data'); dv.setUint32(40, dataSize, true);
  let o = 44;
  // 16 位使用 TPDF 抖动，避免量化失真
  let seed = 22222;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nCh; c++) {
      let v = channels[c][i];
      if (v > 1) v = 1; else if (v < -1) v = -1;
      if (bitDepth === 16) {
        const d = (rnd() - rnd()) / 32768;
        let q = Math.round((v + d) * 32767);
        if (q > 32767) q = 32767; else if (q < -32768) q = -32768;
        dv.setInt16(o, q, true); o += 2;
      } else if (bitDepth === 24) {
        const q = Math.round(v * 8388607);
        dv.setUint8(o, q & 255); dv.setUint8(o + 1, (q >> 8) & 255); dv.setUint8(o + 2, (q >> 16) & 255); o += 3;
      } else {
        dv.setFloat32(o, v, true); o += 4;
      }
    }
  }
  return new Uint8Array(buf);
}

export function decodeWav(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const str = (o, n) => String.fromCharCode(...u8.subarray(o, o + n));
  if (str(0, 4) !== 'RIFF' || str(8, 4) !== 'WAVE') throw new Error('not a WAV');
  let o = 12, fmt = null, data = null;
  while (o + 8 <= u8.length) {
    const id = str(o, 4), size = dv.getUint32(o + 4, true);
    if (id === 'fmt ') {
      fmt = { format: dv.getUint16(o + 8, true), nCh: dv.getUint16(o + 10, true), sampleRate: dv.getUint32(o + 12, true), bits: dv.getUint16(o + 22, true) };
    } else if (id === 'data') { data = { o: o + 8, size }; break; }
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('bad WAV');
  const bytes = fmt.bits / 8;
  const n = Math.floor(data.size / (bytes * fmt.nCh));
  const channels = Array.from({ length: fmt.nCh }, () => new Float32Array(n));
  let p = data.o;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < fmt.nCh; c++) {
      let v;
      if (fmt.bits === 16) { v = dv.getInt16(p, true) / 32768; }
      else if (fmt.bits === 24) { v = ((dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getInt8(p + 2) << 16))) / 8388608; }
      else if (fmt.format === 3) { v = dv.getFloat32(p, true); }
      else { v = (dv.getInt32(p, true)) / 2147483648; }
      channels[c][i] = v; p += bytes;
    }
  }
  return { channels, sampleRate: fmt.sampleRate };
}
