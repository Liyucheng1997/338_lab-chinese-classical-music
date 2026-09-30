// 布料悬垂：位置动力学（PBD）在载入时一次解算，得到裙、袍下摆搭在大腿、膝头、凳面并落到地上的形状。
// 腰口一圈固定；碰撞体为胶囊、球、椭球、竖直圆柱、盒与地面，接触处带摩擦。
import * as THREE from 'three';

/**
 * @param {object} o
 *  ring: Vector3[] 腰口一圈（闭合，逆时针自上方看）
 *  rows, length: 行数与布长（米）
 *  hemScale: 下摆周长 / 腰围（裙摆展开程度）
 *  colliders: [{ type: 'capsule'|'sphere'|'ellipsoid'|'cylinder'|'box', ... }]
 *  floor: 地面高度
 *  steps, iters, lift: 迭代参数与初始上抬角（弧度，越小越接近水平伞状）
 */
export function drapeCloth(o) {
  const N = o.ring.length;
  const rows = o.rows;
  const ds = o.length / rows;
  const P = new Float32Array((rows + 1) * N * 3);
  const Q = new Float32Array(P.length); // 上一步位置
  const center = new THREE.Vector3();
  o.ring.forEach((p) => center.add(p));
  center.divideScalar(N);
  const lift = o.lift ?? 0.12;
  const tent = o.tent ?? 9;
  const floor0 = o.floor ?? 0;
  // 初始：自腰口近水平张开到半径 tent（罩住膝与脚），再竖直下垂，触地后沿地面外铺；随后在重力下落定
  for (let i = 0; i < N; i++) {
    const w = o.ring[i];
    const dx = w.x - center.x;
    const dz = w.z - center.z;
    const l = Math.hypot(dx, dz) || 1;
    const ux = dx / l;
    const uz = dz / l;
    const hMax = Math.max(0, tent - l);
    let px = w.x;
    let py = w.y;
    let pz = w.z;
    let horiz = 0;
    for (let r = 0; r <= rows; r++) {
      const k = (r * N + i) * 3;
      if (r > 0) {
        if (horiz < hMax) {
          const step = Math.min(ds, hMax - horiz);
          horiz += step;
          px += ux * step * Math.cos(lift);
          pz += uz * step * Math.cos(lift);
          py -= step * Math.sin(lift) + (ds - step);
        } else if (py - ds > floor0 + 0.02) py -= ds;
        else {
          px += ux * ds;
          pz += uz * ds;
          py = floor0 + 0.02;
        }
      }
      P[k] = px;
      P[k + 1] = py;
      P[k + 2] = pz;
    }
  }
  Q.set(P);
  // 约束
  const A = [];
  const B = [];
  const Lr = [];
  const Kc = []; // 压缩刚度（布易起皱，受压只部分抵抗）
  const ringLen = [];
  for (let i = 0; i < N; i++) ringLen.push(o.ring[i].distanceTo(o.ring[(i + 1) % N]));
  const hs = o.hemScale ?? 2;
  const add = (a, b, rest, kc) => { A.push(a); B.push(b); Lr.push(rest); Kc.push(kc); };
  const id = (r, i) => r * N + ((i + N) % N);
  for (let r = 0; r <= rows; r++) {
    // 布幅：自腰口在 ramp 比例的长度内展开到全幅（褶裙在腰头收褶，下面即是整幅布宽）
    const f = 1 + (hs - 1) * Math.pow(Math.min(1, r / rows / (o.ramp ?? 1)), o.flarePow ?? 1);
    for (let i = 0; i < N; i++) {
      const h = ringLen[i] * f;
      add(id(r, i), id(r, i + 1), h, 0.25);
      if (r < rows) {
        add(id(r, i), id(r + 1, i), ds, 1);
        const d = Math.hypot(h, ds);
        add(id(r, i), id(r + 1, i + 1), d, 0.3);
        add(id(r, i + 1), id(r + 1, i), d, 0.3);
      }
      if (r < rows - 1) add(id(r, i), id(r + 2, i), ds * 2, 0.15);
      add(id(r, i), id(r, i + 2), h * 2, 0.05);
    }
  }
  const nc = A.length;
  const Ai = Int32Array.from(A);
  const Bi = Int32Array.from(B);
  const Lf = Float32Array.from(Lr);
  const Kf = Float32Array.from(Kc);
  const cols = o.colliders || [];
  const th = o.thickness ?? 0.006;
  const fric = o.friction ?? 0.6;
  const floor = o.floor ?? 0;
  const g = -9.8;
  const dt = 1 / 60;
  const steps = o.steps ?? 160;
  const iters = o.iters ?? 6;
  const collide = (k) => {
    let x = P[k];
    let y = P[k + 1];
    let z = P[k + 2];
    let hit = false;
    for (const c of cols) {
      if (c.type === 'capsule') {
        const ax = c.a.x;
        const ay = c.a.y;
        const az = c.a.z;
        const bx = c.b.x - ax;
        const by = c.b.y - ay;
        const bz = c.b.z - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by + (z - az) * bz) / (bx * bx + by * by + bz * bz)));
        const cx = ax + bx * t;
        const cy = ay + by * t;
        const cz = az + bz * t;
        const r = (c.r0 ?? c.r) + ((c.r1 ?? c.r) - (c.r0 ?? c.r)) * t + th;
        const dx = x - cx;
        const dy = y - cy;
        const dz = z - cz;
        const d = Math.hypot(dx, dy, dz);
        if (d < r) {
          const s = d > 1e-6 ? r / d : 0;
          x = cx + dx * s;
          y = cy + dy * s + (d > 1e-6 ? 0 : r);
          z = cz + dz * s;
          hit = true;
        }
      } else if (c.type === 'sphere' || c.type === 'ellipsoid') {
        const rx = (c.rx ?? c.r) + th;
        const ry = (c.ry ?? c.r) + th;
        const rz = (c.rz ?? c.r) + th;
        const dx = (x - c.c.x) / rx;
        const dy = (y - c.c.y) / ry;
        const dz = (z - c.c.z) / rz;
        const d = Math.hypot(dx, dy, dz);
        if (d < 1) {
          const s = d > 1e-6 ? 1 / d : 1;
          x = c.c.x + dx * s * rx;
          y = c.c.y + (d > 1e-6 ? dy * s : 1) * ry;
          z = c.c.z + dz * s * rz;
          hit = true;
        }
      } else if (c.type === 'cylinder') {
        const dx = x - c.c.x;
        const dz = z - c.c.z;
        const d = Math.hypot(dx, dz);
        const r = c.r + th;
        const top = c.y1 + th;
        if (d < r && y < top && y > c.y0) {
          // 从最近的面推出：顶面或侧面
          if (top - y < r - d) y = top;
          else {
            const s = d > 1e-6 ? r / d : 1;
            x = c.c.x + dx * s;
            z = c.c.z + dz * s;
          }
          hit = true;
        }
      } else if (c.type === 'box') {
        const mn = c.min;
        const mx = c.max;
        if (x > mn.x - th && x < mx.x + th && y > mn.y - th && y < mx.y + th && z > mn.z - th && z < mx.z + th) {
          const pens = [x - mn.x + th, mx.x + th - x, y - mn.y + th, mx.y + th - y, z - mn.z + th, mx.z + th - z];
          let m = 0;
          for (let q = 1; q < 6; q++) if (pens[q] < pens[m]) m = q;
          if (m === 0) x = mn.x - th;
          else if (m === 1) x = mx.x + th;
          else if (m === 2) y = mn.y - th;
          else if (m === 3) y = mx.y + th;
          else if (m === 4) z = mn.z - th;
          else z = mx.z + th;
          hit = true;
        }
      }
    }
    if (y < floor + th) {
      y = floor + th;
      hit = true;
    }
    P[k] = x;
    P[k + 1] = y;
    P[k + 2] = z;
    return hit;
  };
  for (let s = 0; s < steps; s++) {
    const damp = s < steps * 0.7 ? 0.985 : 0.9;
    for (let p = N; p < (rows + 1) * N; p++) {
      const k = p * 3;
      const vx = (P[k] - Q[k]) * damp;
      const vy = (P[k + 1] - Q[k + 1]) * damp;
      const vz = (P[k + 2] - Q[k + 2]) * damp;
      Q[k] = P[k];
      Q[k + 1] = P[k + 1];
      Q[k + 2] = P[k + 2];
      P[k] += vx;
      P[k + 1] += vy + g * dt * dt;
      P[k + 2] += vz;
    }
    for (let it = 0; it < iters; it++) {
      for (let c = 0; c < nc; c++) {
        const a = Ai[c] * 3;
        const b = Bi[c] * 3;
        const dx = P[b] - P[a];
        const dy = P[b + 1] - P[a + 1];
        const dz = P[b + 2] - P[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
        let diff = (d - Lf[c]) / d;
        if (diff < 0) diff *= Kf[c];
        const wa = Ai[c] < N ? 0 : 1;
        const wb = Bi[c] < N ? 0 : 1;
        const ws = wa + wb;
        if (!ws) continue;
        const fa = (diff * wa) / ws;
        const fb = (diff * wb) / ws;
        P[a] += dx * fa;
        P[a + 1] += dy * fa;
        P[a + 2] += dz * fa;
        P[b] -= dx * fb;
        P[b + 1] -= dy * fb;
        P[b + 2] -= dz * fb;
      }
      for (let p = N; p < (rows + 1) * N; p++) {
        const k = p * 3;
        if (collide(k)) {
          // 摩擦：接触时削减速度
          Q[k] = P[k] + (Q[k] - P[k]) * (1 - fric);
          Q[k + 1] = P[k + 1] + (Q[k + 1] - P[k + 1]) * (1 - fric);
          Q[k + 2] = P[k + 2] + (Q[k + 2] - P[k + 2]) * (1 - fric);
        }
      }
    }
  }
  return { P, N, rows };
}

/**
 * 由解算结果生成细分后的网格：环向与纵向各按 Catmull-Rom 加密 sub 倍，
 * 并叠加腰口压褶（pleats 条，向下渐隐）。
 */
export function clothGeometry({ P, N, rows }, { sub = 2, pleats = 0, pleatAmp = 0.004, pleatFade = 0.35, uRepeat = 1 } = {}) {
  const W = N * sub;
  const H = rows * sub;
  const at = (r, i, out) => {
    const k = (Math.max(0, Math.min(rows, r)) * N + ((i % N) + N) % N) * 3;
    out[0] = P[k];
    out[1] = P[k + 1];
    out[2] = P[k + 2];
    return out;
  };
  const cr = (p0, p1, p2, p3, t, c) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3);
  };
  // 先沿环向加密
  const ringPts = [];
  const a0 = [0, 0, 0];
  const a1 = [0, 0, 0];
  const a2 = [0, 0, 0];
  const a3 = [0, 0, 0];
  for (let r = 0; r <= rows; r++) {
    const row = [];
    for (let j = 0; j < W; j++) {
      const f = j / sub;
      const i = Math.floor(f);
      const t = f - i;
      at(r, i - 1, a0);
      at(r, i, a1);
      at(r, i + 1, a2);
      at(r, i + 2, a3);
      row.push([cr(a0, a1, a2, a3, t, 0), cr(a0, a1, a2, a3, t, 1), cr(a0, a1, a2, a3, t, 2)]);
    }
    ringPts.push(row);
  }
  // 再沿纵向加密
  const pos = new Float32Array((H + 1) * (W + 1) * 3);
  const uv = new Float32Array((H + 1) * (W + 1) * 2);
  for (let q = 0; q <= H; q++) {
    const f = q / sub;
    const r = Math.min(rows - 1, Math.floor(f));
    const t = f - r;
    for (let j = 0; j <= W; j++) {
      const jj = j % W;
      const g = (rr) => ringPts[Math.max(0, Math.min(rows, rr))][jj];
      const k = (q * (W + 1) + j) * 3;
      for (let c = 0; c < 3; c++) pos[k + c] = cr(g(r - 1), g(r), g(r + 1), g(r + 2), t, c);
      uv[(q * (W + 1) + j) * 2] = (j / W) * uRepeat;
      uv[(q * (W + 1) + j) * 2 + 1] = 1 - q / H;
    }
  }
  const idx = [];
  for (let q = 0; q < H; q++) {
    for (let j = 0; j < W; j++) {
      const a = q * (W + 1) + j;
      const b = a + W + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  if (pleats > 0) {
    const n = geo.attributes.normal.array;
    for (let q = 0; q <= H; q++) {
      const v = q / H;
      const fade = Math.max(0, 1 - v / pleatFade);
      if (fade <= 0) continue;
      for (let j = 0; j <= W; j++) {
        const k = (q * (W + 1) + j) * 3;
        const d = Math.sin((j / W) * Math.PI * 2 * pleats) * pleatAmp * fade * fade * (q === 0 ? 0.3 : 1);
        pos[k] += n[k] * d;
        pos[k + 1] += n[k + 1] * d;
        pos[k + 2] += n[k + 2] * d;
      }
    }
    geo.computeVertexNormals();
  }
  // 接缝法线平均
  const n = geo.attributes.normal.array;
  for (let q = 0; q <= H; q++) {
    const a = q * (W + 1) * 3;
    const b = (q * (W + 1) + W) * 3;
    for (let c = 0; c < 3; c++) {
      const m = (n[a + c] + n[b + c]) / 2;
      n[a + c] = m;
      n[b + c] = m;
    }
  }
  return geo;
}
