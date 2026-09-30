// 有向距离场（SDF）雕刻：椭球、圆锥胶囊等基元的平滑并 / 差，
// 再从中心沿径向做球面追踪，得到“星形”曲面（头部、发髻等）的网格。
import * as THREE from 'three';

// ───────────────────────────── 基元 ─────────────────────────────

// 近似椭球距离（iq）：外部准确，内部近似
function ellipsoid(c, r) {
  const [cx, cy, cz] = c;
  const [rx, ry, rz] = r;
  const bound = Math.max(rx, ry, rz);
  return {
    c, bound,
    d(x, y, z) {
      const px = x - cx;
      const py = y - cy;
      const pz = z - cz;
      const ax = px / rx;
      const ay = py / ry;
      const az = pz / rz;
      const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
      const bx = ax / rx;
      const by = ay / ry;
      const bz = az / rz;
      const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
      return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
    },
  };
}

// 圆锥胶囊（两端半径不同的胶囊，iq sdRoundCone 精确版）
function roundCone(a, b, r1, r2) {
  const [ax, ay, az] = a;
  const bax = b[0] - ax;
  const bay = b[1] - ay;
  const baz = b[2] - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const bound = Math.sqrt(l2) / 2 + Math.max(r1, r2);
  return {
    c, bound,
    d(x, y, z) {
      const px = x - ax;
      const py = y - ay;
      const pz = z - az;
      const yv = px * bax + py * bay + pz * baz;
      const zv = yv - l2;
      const qx = px * l2 - bax * yv;
      const qy = py * l2 - bay * yv;
      const qz = pz * l2 - baz * yv;
      const x2 = qx * qx + qy * qy + qz * qz;
      const y2 = yv * yv * l2;
      const z2 = zv * zv * l2;
      const k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(zv) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
      if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
      return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - r1;
    },
  };
}

// 任意函数基元：需给出包围球
function custom(c, bound, d) {
  return { c, bound, d };
}

export const prim = { ellipsoid, roundCone, custom };

// ───────────────────────────── 组合 ─────────────────────────────

const smin = (a, b, k) => {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

/**
 * 按顺序组合的 SDF：add 平滑并、sub 平滑差、int 平滑交。
 * 每个基元带包围球，距离足够远时跳过精确计算。
 */
export class SDF {
  constructor() {
    this.ops = [];
  }

  add(p, k = 0) { this.ops.push({ op: 0, p, k }); return this; }
  sub(p, k = 0) { this.ops.push({ op: 1, p, k }); return this; }
  int(p, k = 0) { this.ops.push({ op: 2, p, k }); return this; }

  eval(x, y, z) {
    let d = 1e9;
    const ops = this.ops;
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i];
      const p = o.p;
      const dx = x - p.c[0];
      const dy = y - p.c[1];
      const dz = z - p.c[2];
      const lb = Math.sqrt(dx * dx + dy * dy + dz * dz) - p.bound;
      if (o.op === 0) {
        if (lb > d + o.k) continue;
        d = smin(d, p.d(x, y, z), o.k);
      } else if (o.op === 1) {
        if (lb > -d + o.k) continue;
        d = -smin(-d, p.d(x, y, z), o.k);
      } else {
        d = -smin(-d, -p.d(x, y, z), o.k);
      }
    }
    return d;
  }
}

// ───────────────────────────── 径向网格 ─────────────────────────────

/**
 * 径向参数化：u 绕 y 轴（0.5 为正前方 +Z，前方加密），v 自顶向下。
 * 返回方向与 uv 的互相映射，供网格与纹理绘制共用。
 */
export function radialParam(frontBias = 0.5, bands = []) {
  const a = frontBias;
  // 极角按密度 1 + Σ gain·窗函数 重新分布（在眼、唇等细节处加密行）
  const NT = 4096;
  const cum = new Float64Array(NT + 1);
  for (let i = 1; i <= NT; i++) {
    const ph = (Math.PI * (i - 0.5)) / NT;
    let rho = 1;
    for (const [p0, p1, g] of bands) {
      const w = Math.min(1, Math.max(0, (ph - p0) / 0.12), Math.max(0, (p1 - ph) / 0.12));
      rho += g * w * w * (3 - 2 * w);
    }
    cum[i] = cum[i - 1] + rho;
  }
  const inv = new Float64Array(NT + 1);
  let k = 0;
  for (let i = 0; i <= NT; i++) {
    const target = (cum[NT] * i) / NT;
    while (k < NT && cum[k + 1] < target) k++;
    const f = cum[k + 1] > cum[k] ? (target - cum[k]) / (cum[k + 1] - cum[k]) : 0;
    inv[i] = (Math.PI * Math.min(NT, k + f)) / NT;
  }
  return {
    theta: (u) => {
      const s = 2 * u - 1;
      return Math.PI * (a * s + (1 - a) * s * s * s);
    },
    phi: (v) => {
      const f = Math.min(1, Math.max(0, v)) * NT;
      const i = Math.min(NT - 1, f | 0);
      return inv[i] + (inv[i + 1] - inv[i]) * (f - i);
    },
    dir(u, v, out) {
      const th = this.theta(u);
      const ph = this.phi(v);
      const sp = Math.sin(ph);
      out[0] = sp * Math.sin(th);
      out[1] = Math.cos(ph);
      out[2] = sp * Math.cos(th);
      return out;
    },
  };
}

/** 从 center 出发沿每个方向自外向内球面追踪，返回每个网格点的半径。 */
export function traceRadii(sdf, param, nu, nv, center, rMax, filter = null, base = null) {
  const R = new Float32Array((nu + 1) * (nv + 1));
  const d = [0, 0, 0];
  const [cx, cy, cz] = center;
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const idx = j * (nu + 1) + i;
      param.dir(i / nu, j / nv, d);
      if (filter && !filter(d)) {
        R[idx] = base[idx];
        continue;
      }
      let r = rMax;
      let hit = 0.004;
      for (let s = 0; s < 90; s++) {
        const dist = sdf.eval(cx + d[0] * r, cy + d[1] * r, cz + d[2] * r);
        if (dist < 2e-5) { hit = r; break; }
        r -= Math.max(dist * 0.8, 1e-5);
        if (r < 0.004) { r = 0.004; break; }
        hit = r;
      }
      R[idx] = hit;
    }
  }
  return R;
}

/** 由半径表生成网格（带 uv 与接缝处连续的法线）。 */
export function radialGeometry(R, param, nu, nv, center) {
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3);
  const uv = new Float32Array((nu + 1) * (nv + 1) * 2);
  fillRadialPositions(pos, R, param, nu, nv, center);
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const k = j * (nu + 1) + i;
      uv[k * 2] = i / nu;
      uv[k * 2 + 1] = 1 - j / nv;
    }
  }
  const idx = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + nu + 1;
      if (j > 0) idx.push(a, b, a + 1);
      if (j < nv - 1) idx.push(a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  weldSeamNormals(g.attributes.normal, nu, nv);
  return g;
}

export function fillRadialPositions(pos, R, param, nu, nv, center) {
  const d = [0, 0, 0];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const k = j * (nu + 1) + i;
      param.dir(i / nu, j / nv, d);
      const r = R[k];
      pos[k * 3] = center[0] + d[0] * r;
      pos[k * 3 + 1] = center[1] + d[1] * r;
      pos[k * 3 + 2] = center[2] + d[2] * r;
    }
  }
}

// u = 0 与 u = 1 两列是同一处（后脑接缝），法线取平均；两极统一
export function weldSeamNormals(n, nu, nv) {
  const a = n.array;
  for (let j = 0; j <= nv; j++) {
    const p = j * (nu + 1) * 3;
    const q = (j * (nu + 1) + nu) * 3;
    for (let c = 0; c < 3; c++) {
      const m = (a[p + c] + a[q + c]) / 2;
      a[p + c] = m;
      a[q + c] = m;
    }
  }
  for (const j of [0, nv]) {
    const s = [0, 0, 0];
    for (let i = 0; i <= nu; i++) for (let c = 0; c < 3; c++) s[c] += a[(j * (nu + 1) + i) * 3 + c];
    const l = Math.hypot(...s) || 1;
    for (let i = 0; i <= nu; i++) for (let c = 0; c < 3; c++) a[(j * (nu + 1) + i) * 3 + c] = s[c] / l;
  }
  n.needsUpdate = true;
}

/** 半径表的双线性采样（u, v ∈ [0,1]）。 */
export function sampleR(R, nu, nv, u, v) {
  const x = u * nu;
  const y = v * nv;
  const i = Math.min(nu - 1, Math.max(0, Math.floor(x)));
  const j = Math.min(nv - 1, Math.max(0, Math.floor(y)));
  const fx = x - i;
  const fy = y - j;
  const k = j * (nu + 1) + i;
  const a = R[k];
  const b = R[k + 1];
  const c = R[k + nu + 1];
  const e = R[k + nu + 2];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
}

// ───────────────────────────── 三维值噪声 ─────────────────────────────

export class Noise3 {
  constructor(seed = 1) {
    let s = seed >>> 0;
    const rnd = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    this.vals = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.vals[i] = rnd() * 2 - 1;
  }

  noise(x, y, z) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const fx = x - xi;
    const fy = y - yi;
    const fz = z - zi;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const w = fz * fz * (3 - 2 * fz);
    const P = this.perm;
    const V = this.vals;
    const X = xi & 255;
    const Y = yi & 255;
    const Z = zi & 255;
    const h = (a, b, c) => V[P[P[P[a] + b] + c] & 255];
    const X1 = (X + 1) & 255;
    const Y1 = (Y + 1) & 255;
    const Z1 = (Z + 1) & 255;
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(h(X, Y, Z), h(X1, Y, Z), u), l(h(X, Y1, Z), h(X1, Y1, Z), u), v),
      l(l(h(X, Y, Z1), h(X1, Y, Z1), u), l(h(X, Y1, Z1), h(X1, Y1, Z1), u), v),
      w,
    );
  }

  fbm(x, y, z, oct = 4) {
    let s = 0;
    let a = 0.5;
    let f = 1;
    for (let o = 0; o < oct; o++) {
      s += a * this.noise(x * f, y * f, z * f);
      f *= 2.03;
      a *= 0.5;
    }
    return s;
  }
}
