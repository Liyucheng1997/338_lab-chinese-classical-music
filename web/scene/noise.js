// 可平铺的值噪声 + 分形布朗运动，用于程序化纹理

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class ValueNoise {
  constructor(seed = 1) {
    const rnd = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    this.vals = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.vals[i] = rnd();
  }

  // 周期为 (px, py) 的二维值噪声，返回 [0,1]
  noise(x, y, px = 256, py = 256) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const x0 = ((xi % px) + px) % px;
    const y0 = ((yi % py) + py) % py;
    const x1 = (x0 + 1) % px;
    const y1 = (y0 + 1) % py;
    const P = this.perm;
    const V = this.vals;
    const a = V[P[P[x0 & 255] + (y0 & 255)]];
    const b = V[P[P[x1 & 255] + (y0 & 255)]];
    const c = V[P[P[x0 & 255] + (y1 & 255)]];
    const d = V[P[P[x1 & 255] + (y1 & 255)]];
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  // u,v ∈ [0,1)，freq 为基础频率（整数可保证平铺）
  fbm(u, v, freq = 4, octaves = 5, freqY = freq) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let fx = freq;
    let fy = freqY;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(u * fx, v * fy, fx, fy);
      norm += amp;
      amp *= 0.5;
      fx *= 2;
      fy *= 2;
    }
    return sum / norm;
  }
}

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const mix = (a, b, t) => a + (b - a) * t;
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
