// 放样几何：由一串截面（超椭圆，前后深度可不同）插值成光滑曲面；
// 动态管（每帧按骨骼更新的袖子、前臂）。
import * as THREE from 'three';

const TAU = Math.PI * 2;

// 截面轮廓：a = 0 为截面 x 轴正向，a = π/2 为 z 轴正向（前）
function profile(sec, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const n = sec.n ?? 2;
  const e = 2 / n;
  const px = Math.sign(c) * Math.pow(Math.abs(c), e) * (c >= 0 ? sec.rxL ?? sec.rx : sec.rxR ?? sec.rx);
  const pz = Math.sign(s) * Math.pow(Math.abs(s), e) * (s >= 0 ? sec.rzF ?? sec.rz : sec.rzB ?? sec.rz);
  return [px, pz];
}

// 截面参数的 Catmull-Rom 插值
const KEYS = ['rx', 'rz', 'rzF', 'rzB', 'rxL', 'rxR', 'n'];
function interpSections(secs, rings) {
  const out = [];
  const m = secs.length;
  const get = (i) => secs[Math.max(0, Math.min(m - 1, i))];
  const cr = (p0, p1, p2, p3, t) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  for (let r = 0; r <= rings; r++) {
    const f = (r / rings) * (m - 1);
    const i = Math.min(m - 2, Math.floor(f));
    const t = f - i;
    const s0 = get(i - 1);
    const s1 = get(i);
    const s2 = get(i + 1);
    const s3 = get(i + 2);
    const sec = { c: new THREE.Vector3() };
    for (const ax of ['x', 'y', 'z']) sec.c[ax] = cr(s0.c[ax], s1.c[ax], s2.c[ax], s3.c[ax], t);
    for (const k of KEYS) {
      if (s1[k] === undefined && s2[k] === undefined) continue;
      const v = (s) => s[k] ?? (k === 'n' ? 2 : k.startsWith('rz') ? s.rz : s.rx);
      sec[k] = Math.max(0, cr(v(s0), v(s1), v(s2), v(s3), t));
    }
    // 截面坐标轴（默认水平截面）
    const ax0 = s1.ax || new THREE.Vector3(1, 0, 0);
    const ax1 = s2.ax || ax0;
    const az0 = s1.az || new THREE.Vector3(0, 0, 1);
    const az1 = s2.az || az0;
    sec.ax = ax0.clone().lerp(ax1, t).normalize();
    sec.az = az0.clone().lerp(az1, t).normalize();
    sec.t = r / rings;
    out.push(sec);
  }
  return out;
}

/**
 * 放样。sections: [{ c: Vector3, rx, rz | rzF/rzB, rxL/rxR, n, ax?, az? }]（自下而上或沿路径）。
 * o.disp(a, t, point, normal) → 沿法线的位移（褶皱、纹理起伏）。
 */
export function loft(sections, o = {}) {
  const rings = o.rings ?? 32;
  const segs = o.segs ?? 48;
  const secs = interpSections(sections.map((s) => ({ ...s, c: s.c.isVector3 ? s.c : new THREE.Vector3(...s.c) })), rings);
  const pos = new Float32Array((rings + 1) * (segs + 1) * 3);
  const uv = new Float32Array((rings + 1) * (segs + 1) * 2);
  const a0 = o.a0 ?? -Math.PI / 2; // 接缝默认在背后
  // 沿中心线的累计长度作为 v
  const len = [0];
  for (let r = 1; r <= rings; r++) len.push(len[r - 1] + secs[r].c.distanceTo(secs[r - 1].c) + 1e-6);
  const total = len[rings];
  for (let r = 0; r <= rings; r++) {
    const s = secs[r];
    for (let k = 0; k <= segs; k++) {
      const a = a0 + (k / segs) * TAU;
      const [px, pz] = profile(s, a);
      const i = (r * (segs + 1) + k) * 3;
      pos[i] = s.c.x + s.ax.x * px + s.az.x * pz;
      pos[i + 1] = s.c.y + s.ax.y * px + s.az.y * pz;
      pos[i + 2] = s.c.z + s.ax.z * px + s.az.z * pz;
      uv[(r * (segs + 1) + k) * 2] = (o.uScale ?? 1) * (k / segs);
      uv[(r * (segs + 1) + k) * 2 + 1] = (o.vScale ?? 1) * (o.vByLength === false ? s.t : len[r] / total);
    }
  }
  const idx = [];
  for (let r = 0; r < rings; r++) {
    for (let k = 0; k < segs; k++) {
      const a = r * (segs + 1) + k;
      const b = a + segs + 1;
      if (o.flip) idx.push(a, a + 1, b, a + 1, b + 1, b);
      else idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  weldRingSeam(g, rings, segs);
  if (o.disp) {
    const n = g.attributes.normal.array;
    const p = new THREE.Vector3();
    const nv = new THREE.Vector3();
    for (let r = 0; r <= rings; r++) {
      for (let k = 0; k <= segs; k++) {
        const i = (r * (segs + 1) + k) * 3;
        p.set(pos[i], pos[i + 1], pos[i + 2]);
        nv.set(n[i], n[i + 1], n[i + 2]);
        const d = o.disp(a0 + (k / segs) * TAU, r / rings, p, nv, len[r]);
        pos[i] += nv.x * d;
        pos[i + 1] += nv.y * d;
        pos[i + 2] += nv.z * d;
      }
    }
    g.computeVertexNormals();
    weldRingSeam(g, rings, segs);
  }
  if (o.cap0 || o.cap1) {
    // 端盖：扇形三角面（隐藏在其他部件内时可省）
    const base = pos.length / 3;
    const cp = [];
    const ci = [];
    for (const [flag, r, dir] of [[o.cap0, 0, -1], [o.cap1, rings, 1]]) {
      if (!flag) continue;
      const c = secs[r].c;
      const ic = base + cp.length / 3;
      cp.push(c.x, c.y, c.z);
      for (let k = 0; k < segs; k++) {
        const a = r * (segs + 1) + k;
        if (dir < 0) ci.push(ic, a + 1, a);
        else ci.push(ic, a, a + 1);
      }
    }
    const np = new Float32Array(pos.length + cp.length);
    np.set(g.attributes.position.array);
    np.set(cp, pos.length);
    const nu = new Float32Array(uv.length + (cp.length / 3) * 2);
    nu.set(uv);
    g.setAttribute('position', new THREE.BufferAttribute(np, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(nu, 2));
    g.setIndex([...idx, ...ci]);
    g.computeVertexNormals();
  }
  g.userData.secs = secs;
  g.userData.segs = segs;
  g.userData.rings = rings;
  g.userData.a0 = a0;
  return g;
}

/** 放样面上 (a, t) 处的点（未含 disp），用于贴附领缘、纽扣等。 */
export function loftPoint(geo, a, t, out = new THREE.Vector3()) {
  const secs = geo.userData.secs;
  const f = Math.min(secs.length - 1.0001, Math.max(0, t * (secs.length - 1)));
  const i = Math.floor(f);
  const w = f - i;
  const P = (s) => {
    const [px, pz] = profile(s, a);
    return new THREE.Vector3().copy(s.c).addScaledVector(s.ax, px).addScaledVector(s.az, pz);
  };
  return out.copy(P(secs[i])).lerp(P(secs[i + 1]), w);
}

function weldRingSeam(g, rings, segs) {
  const n = g.attributes.normal.array;
  for (let r = 0; r <= rings; r++) {
    const a = r * (segs + 1) * 3;
    const b = (r * (segs + 1) + segs) * 3;
    for (let c = 0; c < 3; c++) {
      const m = (n[a + c] + n[b + c]) / 2;
      n[a + c] = m;
      n[b + c] = m;
    }
  }
  g.attributes.normal.needsUpdate = true;
}

// ───────────────────────────── 动态管 ─────────────────────────────

/**
 * 每帧更新顶点的管：rings 个截面环，每环 segs 段。
 * update(frames)：frames[i] = { c, x, y, rx, ry, drape, down }，x / y 为截面内两轴（单位向量），
 * drape 为向 down 方向额外下垂的长度（袖子的袋状下垂）。
 */
export class TubeMesh {
  constructor(rings, segs, material, { name = 'tube', fold = 0, foldK = 7, seed = 0, flip = false } = {}) {
    this.rings = rings;
    this.segs = segs;
    this.fold = fold;
    this.foldK = foldK;
    this.seed = seed;
    const n = (rings + 1) * (segs + 1);
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    for (let r = 0; r <= rings; r++) {
      for (let k = 0; k <= segs; k++) {
        const i = r * (segs + 1) + k;
        uv[i * 2] = k / segs;
        uv[i * 2 + 1] = r / rings;
      }
    }
    const idx = [];
    for (let r = 0; r < rings; r++) {
      for (let k = 0; k < segs; k++) {
        const a = r * (segs + 1) + k;
        const b = a + segs + 1;
        if (flip) idx.push(a, a + 1, b, a + 1, b + 1, b);
        else idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.geometry = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  update(frames) {
    const { rings, segs, pos } = this;
    for (let r = 0; r <= rings; r++) {
      const f = frames[r];
      const dn = f.down;
      for (let k = 0; k <= segs; k++) {
        const a = (k / segs) * TAU;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        let ox = f.x.x * ca * f.rx + f.y.x * sa * f.ry;
        let oy = f.x.y * ca * f.rx + f.y.y * sa * f.ry;
        let oz = f.x.z * ca * f.rx + f.y.z * sa * f.ry;
        // 褶皱：沿环向的正弦起伏，相位随环缓慢变化
        if (this.fold) {
          const w = 1 + this.fold * Math.sin(a * this.foldK + r * 0.7 + this.seed) * (f.foldAmt ?? 1);
          ox *= w;
          oy *= w;
          oz *= w;
        }
        if (f.drape && dn) {
          const l = Math.hypot(ox, oy, oz) || 1;
          const dd = (ox * dn.x + oy * dn.y + oz * dn.z) / l;
          if (dd > 0) {
            const e = f.drape * dd * dd;
            ox += dn.x * e;
            oy += dn.y * e;
            oz += dn.z * e;
          }
        }
        const i = (r * (segs + 1) + k) * 3;
        pos[i] = f.c.x + ox;
        pos[i + 1] = f.c.y + oy;
        pos[i + 2] = f.c.z + oz;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
    weldRingSeam(this.geometry, rings, segs);
  }
}
