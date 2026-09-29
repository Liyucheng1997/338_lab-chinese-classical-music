// 音频分析：FFT、精确音高检测、频谱质心、响度、谐波分析。
// 用来客观验证音准与音色（浏览器与 Node 共用）。

export function fft(re, im) {
  const n = re.length;
  // 位反转
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
  return w;
}

/** 幅度谱（已加汉宁窗），返回长度 n/2 的数组。 */
export function magnitudeSpectrum(x, start, n) {
  const re = new Float64Array(n), im = new Float64Array(n);
  const w = hann(n);
  for (let i = 0; i < n; i++) re[i] = (x[start + i] || 0) * w[i];
  fft(re, im);
  const mag = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]) / n * 4;
  return mag;
}

export function rms(x, start = 0, n = x.length - start) {
  let s = 0;
  for (let i = 0; i < n; i++) { const v = x[start + i]; s += v * v; }
  return Math.sqrt(s / Math.max(1, n));
}

export function peak(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; }
  return p;
}

/**
 * 归一化平方差函数 (McLeod NSDF) 音高检测，抛物线插值到亚采样精度。
 * expectedHz 给出时只在其 ±(range) 音分内搜索。
 * 返回 { f0, clarity }。
 */
export function detectPitch(x, start, n, fs, expectedHz = 0, rangeCents = 150) {
  let lagMin, lagMax;
  if (expectedHz > 0) {
    const r = Math.pow(2, rangeCents / 1200);
    lagMin = Math.max(2, Math.floor(fs / (expectedHz * r)) - 1);
    lagMax = Math.ceil(fs / (expectedHz / r)) + 1;
  } else {
    lagMin = Math.floor(fs / 2000); lagMax = Math.floor(fs / 60);
  }
  const W = n - lagMax - 2;
  if (W < lagMin * 2) return { f0: 0, clarity: 0 };
  const nsdf = new Float64Array(lagMax + 2);
  for (let lag = lagMin - 1; lag <= lagMax + 1; lag++) {
    let acf = 0, m = 0;
    for (let i = 0; i < W; i++) {
      const a = x[start + i], b = x[start + i + lag];
      acf += a * b; m += a * a + b * b;
    }
    nsdf[lag] = m > 0 ? 2 * acf / m : 0;
  }
  // 取最大峰
  let best = -1, bestV = -2;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    if (nsdf[lag] > nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1] && nsdf[lag] > bestV) {
      bestV = nsdf[lag]; best = lag;
    }
  }
  if (best < 0) return { f0: 0, clarity: 0 };
  const a = nsdf[best - 1], b = nsdf[best], c = nsdf[best + 1];
  const den = a - 2 * b + c;
  const delta = den !== 0 ? 0.5 * (a - c) / den : 0;
  const lag = best + delta;
  return { f0: fs / lag, clarity: bestV };
}

/** 谱质心 (Hz)。 */
export function spectralCentroid(x, start, n, fs) {
  const mag = magnitudeSpectrum(x, start, n);
  let num = 0, den = 0;
  for (let i = 1; i < mag.length; i++) {
    const f = i * fs / n;
    num += f * mag[i]; den += mag[i];
  }
  return den > 0 ? num / den : 0;
}

/** 前 K 个谐波相对基频的幅度 (dB)，在理论位置附近 ±3% 内取峰。 */
export function harmonicProfile(x, start, n, fs, f0, K = 12) {
  const mag = magnitudeSpectrum(x, start, n);
  const binHz = fs / n;
  const out = [];
  let ref = 0;
  for (let k = 1; k <= K; k++) {
    const fc = f0 * k;
    if (fc > fs / 2 - 200) break;
    const lo = Math.max(1, Math.floor(fc * 0.97 / binHz)), hi = Math.min(mag.length - 2, Math.ceil(fc * 1.03 / binHz));
    let m = 0;
    for (let i = lo; i <= hi; i++) if (mag[i] > m) m = mag[i];
    if (k === 1) ref = m;
    out.push(20 * Math.log10(Math.max(m, 1e-12) / Math.max(ref, 1e-12)));
  }
  return out;
}

/** 分段的短时能量包络（dB），用于检查起音/衰减形状。 */
export function envelopeDb(x, fs, hopMs = 10) {
  const hop = Math.round(fs * hopMs / 1000);
  const out = [];
  for (let i = 0; i + hop <= x.length; i += hop) out.push(20 * Math.log10(rms(x, i, hop) + 1e-12));
  return out;
}

/** 检查爆音：返回相邻采样差分超过阈值的次数与最大差分。 */
export function clickScan(x, thresh = 0.25) {
  let n = 0, mx = 0;
  for (let i = 1; i < x.length; i++) {
    const d = Math.abs(x[i] - x[i - 1]);
    if (d > mx) mx = d;
    if (d > thresh) n++;
  }
  return { count: n, maxDiff: mx };
}
