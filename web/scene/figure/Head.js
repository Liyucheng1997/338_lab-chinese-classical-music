// 程序化头部：用 SDF 平滑组合雕出颅骨、额、颧、颊、下颌、鼻、唇、耳与眼睑，
// 径向投影成网格；眼睑闭合、鼓腮做成变形目标。皮肤颜色、眉、唇色、皱纹、胡茬等按三维位置逐像素绘制。
import * as THREE from 'three';
import { SDF, prim, radialParam, traceRadii, radialGeometry, sampleR, Noise3 } from './sdf.js';

const NU = 288;
const NV = 176;
const CENTER = [0, -0.012, 0.004];
const RMAX = 0.16;

// 默认：年轻女性（米）。x 为角色左侧，+z 为面部朝向，y = 0 约在眼高。
// profile：正中矢状面上面部轮廓 z(y)（鼻、唇另加）；curve：各高度的横向弯曲系数 a（z 减少 a·x²）
export const FACE_DEFAULTS = {
  cranium: { c: [0, 0.02, -0.016], r: [0.07, 0.09, 0.095] },
  profile: [[0.105, 0.03], [0.085, 0.058], [0.06, 0.075], [0.035, 0.0815], [0.018, 0.0825], [0.006, 0.0775], [-0.015, 0.0785],
    [-0.04, 0.083], [-0.055, 0.0842], [-0.07, 0.0822], [-0.082, 0.0802], [-0.093, 0.0768], [-0.104, 0.0818], [-0.113, 0.077],
    [-0.12, 0.062], [-0.125, 0.036], [-0.127, 0.0]],
  curve: [[0.1, 9], [0.06, 7.5], [0.02, 7], [0.0, 7.8], [-0.025, 11], [-0.05, 16], [-0.07, 19], [-0.09, 22], [-0.11, 28], [-0.13, 40]],
  maskBound: { c: [0, -0.016, 0.0], r: [0.057, 0.107, 0.106] },
  jaw: { a: [0.048, -0.064, -0.014], b: [0.022, -0.1, 0.036], r1: 0.012, r2: 0.009, k: 0.02 },
  cheekbone: { c: [0.046, -0.012, 0.046], r: [0.021, 0.013, 0.02] },
  cheek: { c: [0.036, -0.04, 0.047], r: [0.02, 0.022, 0.02], k: 0.018 },
  hollow: 0, // 颊凹（老年消瘦）
  brow: { c: [0.03, 0.02, 0.068], r: [0.022, 0.007, 0.01], k: 0.012 },
  eye: { c: [0.031, 0.002, 0.0605], R: 0.0118, up: 0.3, lo: -0.33, hw: 1.08, tilt: 0.07, bulge: 0.0012 },
  orbit: { c: [0.031, 0.001, 0.072], r: [0.0175, 0.0125, 0.0095], k: 0.006 },
  nose: { root: [0, 0.006, 0.079], tip: [0, -0.037, 0.0995], rootR: 0.0048, tipR: 0.0075, alaX: 0.0098, alaR: 0.0056, bridgeW: 1 },
  lips: { y: -0.0695, z: 0.0826, w: 0.0175, up: 0.0046, lo: 0.0055, pout: 0.0042, open: 0 },
  ear: { c: [0.0705, -0.01, -0.014], h: 0.029, w: 0.016, t: 0.0055, yaw: 0.28 },
  puff: null, // 鼓腮（唢呐）
};

// 按 y 降序排列的控制点做 Catmull-Rom 插值
function curveY(pts) {
  const n = pts.length;
  return (y) => {
    if (y >= pts[0][0]) return pts[0][1];
    if (y <= pts[n - 1][0]) return pts[n - 1][1];
    let i = 0;
    while (i < n - 2 && y < pts[i + 1][0]) i++;
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    const t = (p1[0] - y) / (p1[0] - p2[0]);
    const m1 = ((p2[1] - p0[1]) / (p0[0] - p2[0] || 1)) * (p1[0] - p2[0]);
    const m2 = ((p3[1] - p1[1]) / (p1[0] - p3[0] || 1)) * (p1[0] - p2[0]);
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
  };
}

// 面具：高度场 z < zm(x, y) 与包围椭球之交
function faceMask(P) {
  // 轮廓与弯曲系数预先制表（y ∈ [−0.16, 0.14]）
  const Y0 = -0.16;
  const NY = 1200;
  const DY = 0.3 / NY;
  const tz = new Float32Array(NY + 1);
  const ta = new Float32Array(NY + 1);
  const zf = curveY(P.profile);
  const kf = curveY(P.curve);
  for (let i = 0; i <= NY; i++) {
    tz[i] = zf(Y0 + i * DY);
    ta[i] = kf(Y0 + i * DY);
  }
  const zm = (x, y) => {
    let f = (y - Y0) / DY;
    f = f < 0 ? 0 : f > NY - 1e-6 ? NY - 1e-6 : f;
    const i = f | 0;
    const t = f - i;
    const z = tz[i] + (tz[i + 1] - tz[i]) * t;
    const a = ta[i] + (ta[i + 1] - ta[i]) * t;
    const x2 = x * x;
    return z - a * x2 - 900 * x2 * x2;
  };
  const bound = prim.ellipsoid(P.maskBound.c, P.maskBound.r);
  return prim.custom(P.maskBound.c, Math.max(...P.maskBound.r), (x, y, z) => {
    const h = 0.0015;
    const z0 = zm(x, y);
    const gx = (zm(x + h, y) - zm(x - h, y)) / (2 * h);
    const gy = (zm(x, y + h) - zm(x, y - h)) / (2 * h);
    const hf = (z - z0) / Math.sqrt(1 + gx * gx + gy * gy);
    return Math.max(hf, bound.d(x, y, z));
  });
}

function merge(base, over) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') Object.assign(out[k], v);
    else out[k] = v;
  }
  return out;
}

// 眼睑轮廓：h 为水平角（向外为正），返回上 / 下睑缘的仰角
function lidCurves(e, h, blink = 0) {
  const t = Math.min(1, Math.abs(h) / e.hw);
  const corner = e.tilt * (h > 0 ? 1 : -0.4); // 外眼角略上挑
  const shape = Math.pow(Math.max(0, 1 - t * t), 0.62);
  const lo = corner + (e.lo - corner) * Math.pow(Math.max(0, 1 - t * t), 0.8);
  let up = corner + (e.up - corner) * shape;
  up = up + (lo + 0.02 - up) * blink;
  return [up, lo];
}

function eyelidPrim(e, side, blink) {
  const [cx, cy, cz] = [e.c[0] * side, e.c[1], e.c[2]];
  const Rm = e.R + 0.0013;
  const th = 0.00095;
  return prim.custom([cx, cy, cz], e.R + 0.004, (x, y, z) => {
    const dx = (x - cx) * side;
    const dy = y - cy;
    const dz = z - cz;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const shell = Math.abs(l - Rm) - th;
    const h = Math.atan2(dx, dz);
    const el = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
    let f;
    if (Math.abs(h) > e.hw) f = Math.abs(h) - e.hw;
    else {
      const [up, lo] = lidCurves(e, h, blink);
      f = Math.max(el - up, lo - el);
      if (Math.abs(h) > e.hw * 0.8) f = Math.max(f, Math.abs(h) - e.hw);
    }
    return Math.max(shell, -f * Rm);
  });
}

// 耳：绕 y 轴偏转的扁椭球 + 耳甲腔 + 耳垂 + 耳轮
function rotEllipsoid(c, r, yaw) {
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const e = prim.ellipsoid([0, 0, 0], r);
  return prim.custom(c, Math.max(...r), (x, y, z) => {
    const px = x - c[0];
    const pz = z - c[2];
    return e.d(cs * px - sn * pz, y - c[1], sn * px + cs * pz);
  });
}

function lipPrims(P) {
  const L = P.lips;
  const E = prim.ellipsoid;
  return [
    E([0, L.y + L.up * 0.9, L.z], [L.w, L.up, L.pout]),
    E([0, L.y - L.lo * 0.9, L.z - 0.001], [L.w * 0.86, L.lo, L.pout]),
  ];
}

export function buildHeadSDF(P, { blink = 0, puff = 0 } = {}) {
  const s = new SDF();
  const E = prim.ellipsoid;
  const both = (fn) => { fn(1); fn(-1); };
  const mx = (c, side) => [c[0] * side, c[1], c[2]];
  s.add(E(P.cranium.c, P.cranium.r));
  s.add(faceMask(P), 0.024);
  both((sd) => s.add(prim.roundCone(mx(P.jaw.a, sd), mx(P.jaw.b, sd), P.jaw.r1, P.jaw.r2), P.jaw.k));
  both((sd) => s.add(E(mx(P.cheekbone.c, sd), P.cheekbone.r), 0.016));
  both((sd) => s.add(E(mx(P.cheek.c, sd), P.cheek.r), P.cheek.k));
  if (P.hollow > 0) both((sd) => s.sub(E(mx([0.05, -0.05, 0.03], sd), [0.012, 0.017, 0.016]), 0.018 + P.hollow * 0.008));
  if (P.puff && puff > 0) {
    const q = P.puff;
    both((sd) => s.add(E(mx(q.c, sd), q.r.map((v) => v * (0.55 + 0.45 * puff))), 0.02));
  }
  both((sd) => s.add(E(mx(P.brow.c, sd), P.brow.r), P.brow.k));
  // 太阳穴微凹
  both((sd) => s.sub(E(mx([0.07, 0.03, 0.036], sd), [0.009, 0.018, 0.016]), 0.018));
  // 眼窝
  both((sd) => s.sub(E(mx(P.orbit.c, sd), P.orbit.r), P.orbit.k));
  // 鼻：鼻梁、鼻侧、鼻尖、鼻翼
  const n = P.nose;
  s.add(prim.roundCone(n.root, [n.tip[0], n.tip[1] + 0.002, n.tip[2] - 0.002], n.rootR * n.bridgeW, n.tipR * 0.8), 0.009);
  both((sd) => s.add(prim.roundCone([0.006 * sd * n.bridgeW, -0.006, n.root[2] - 0.004], [(n.alaX - 0.002) * sd, n.tip[1], n.tip[2] - 0.012], 0.0035, 0.005), 0.006));
  s.add(E(n.tip, [n.tipR, n.tipR * 0.88, n.tipR * 0.9]), 0.005);
  both((sd) => s.add(E([n.alaX * sd, n.tip[1] + 0.0005, n.tip[2] - 0.0118], [n.alaR, n.alaR * 0.86, n.alaR * 1.1]), 0.0045));
  // 唇：上唇（含唇珠）、下唇
  const L = P.lips;
  for (const lp of lipPrims(P)) s.add(lp, 0.006);
  // 唇缝与嘴角
  s.sub(E([0, L.y, L.z + 0.004], [L.w * 1.02, 0.00055 + L.open, 0.0032]), 0.0011);
  // 人中
  s.sub(E([0, L.y + 0.0125, L.z + 0.0042], [0.0026, 0.0062, 0.0014]), 0.0025);
  // 眼睑
  both((sd) => s.add(eyelidPrim(P.eye, sd, blink), 0.0035));
  // 耳
  const ear = P.ear;
  both((sd) => {
    const c = [ear.c[0] * sd, ear.c[1], ear.c[2]];
    const yaw = -ear.yaw * sd;
    s.add(rotEllipsoid(c, [ear.t, ear.h, ear.w], yaw), 0.006);
    s.add(rotEllipsoid([c[0] + 0.001 * sd, c[1] - ear.h * 0.72, c[2] + 0.002], [ear.t * 0.9, ear.h * 0.34, ear.w * 0.55], yaw), 0.006);
    s.sub(rotEllipsoid([c[0] + 0.0045 * sd, c[1] - 0.004, c[2] + 0.002], [0.0042, ear.h * 0.5, ear.w * 0.52], yaw), 0.0024);
  });
  return s;
}

// ───────────────────────────── 皮肤绘制 ─────────────────────────────

// 取 sRGB 分量（THREE.Color 内部为线性值，直接写入 sRGB 画布会偏暗偏艳）
const hex3 = (h) => {
  const c = new THREE.Color(h).getRGB({}, THREE.SRGBColorSpace);
  return [c.r * 255, c.g * 255, c.b * 255];
};
const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const gauss = (dx, dy, dz, sx, sy, sz) => Math.exp(-((dx * dx) / (sx * sx) + (dy * dy) / (sy * sy) + (dz * dz) / (sz * sz)));
const mixc = (c, t, k) => {
  c[0] += (t[0] - c[0]) * k;
  c[1] += (t[1] - c[1]) * k;
  c[2] += (t[2] - c[2]) * k;
};

function paintSkin(R, param, P, look, W = 1024, H = 1024) {
  const col = document.createElement('canvas');
  col.width = W;
  col.height = H;
  const bump = document.createElement('canvas');
  bump.width = W;
  bump.height = H;
  const rough = document.createElement('canvas');
  rough.width = W;
  rough.height = H;
  const cImg = col.getContext('2d').createImageData(W, H);
  const bImg = bump.getContext('2d').createImageData(W, H);
  const rImg = rough.getContext('2d').createImageData(W, H);
  const N = new Noise3(look.seed || 3);
  const base = hex3(look.skin);
  const red = hex3(look.blush || '#d0645a');
  const lip = hex3(look.lip);
  const brow = hex3(look.brow || '#1c130e');
  const stubble = hex3(look.stubbleColor || '#2b2622');
  const hairTint = hex3(look.scalp || look.brow || '#1c130e');
  const e = P.eye;
  const lips = lipPrims(P);
  const d = [0, 0, 0];
  const c = [0, 0, 0];
  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) / H; // 画布第 0 行 = 纹理顶部 = 参数 v 的 0（头顶）
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5) / W;
      param.dir(u, v, d);
      const r = sampleR(R, NU, NV, u, v);
      const x = CENTER[0] + d[0] * r;
      const y = CENTER[1] + d[1] * r;
      const z = CENTER[2] + d[2] * r;
      const ax = Math.abs(x);
      const sd = x >= 0 ? 1 : -1;
      c[0] = base[0];
      c[1] = base[1];
      c[2] = base[2];
      // 斑驳与毛孔
      const mott = N.fbm(x * 90, y * 90, z * 90, 3);
      const pore = N.noise(x * 1400, y * 1400, z * 1400);
      c[0] *= 1 + mott * 0.07;
      c[1] *= 1 + mott * 0.05;
      c[2] *= 1 + mott * 0.04;
      let bmp = 0.5 + pore * 0.08 * (look.pores ?? 1);
      let rg = 0.58 + mott * 0.06;
      const front = sstep(0.0, 0.05, z);
      // 红润：颊、鼻尖、耳、下巴
      let blush = gauss(ax - 0.038, y + 0.036, z - 0.056, 0.018, 0.016, 0.03) * (look.cheekBlush ?? 0.35);
      blush += gauss(x, y - P.nose.tip[1], z - P.nose.tip[2], 0.012, 0.012, 0.02) * 0.28;
      blush += gauss(ax - P.ear.c[0], y - P.ear.c[1], z - P.ear.c[2], 0.014, 0.03, 0.02) * 0.3;
      blush += gauss(x, y + 0.1, z - 0.07, 0.02, 0.012, 0.03) * 0.12;
      // 眼睑与眼周
      const ex = ax - e.c[0];
      const ey = y - e.c[1];
      const ez = z - e.c[2];
      const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
      blush += gauss(ex, ey - 0.006, ez, 0.013, 0.008, 0.02) * (look.lidRed ?? 0.25);
      mixc(c, red, sat(blush));
      // 眼下暗影
      const under = gauss(ex + 0.002, ey + 0.013, ez - 0.006, 0.013, 0.005, 0.02) * (look.underEye ?? 0.12);
      c[0] *= 1 - under;
      c[1] *= 1 - under * 1.1;
      c[2] *= 1 - under * 0.8;
      // 睑缘：上睑睫毛线 / 眼线，内眦粉红
      if (el < e.R + 0.0045 && ez > -0.004) {
        const h = Math.atan2(ex, ez);
        const elev = Math.atan2(ey, Math.sqrt(ex * ex + ez * ez));
        const [up, lo] = lidCurves(e, Math.max(-e.hw, Math.min(e.hw, h)), look.closed ? 1 : 0);
        const du = elev - up;
        const liner = (1 - sstep(0.0, look.liner ?? 0.1, du)) * sstep(-0.03, 0.0, du) * sstep(e.hw + 0.05, e.hw * 0.6, Math.abs(h));
        mixc(c, [22, 14, 12], sat(liner * (look.linerAmt ?? 0.85)));
        const dl = lo - elev;
        const lower = (1 - sstep(0.0, 0.06, dl)) * sstep(-0.02, 0.0, dl) * sstep(e.hw, e.hw * 0.5, Math.abs(h));
        mixc(c, [110, 70, 62], sat(lower * 0.2));
        if (h < -e.hw * 0.72) mixc(c, [196, 110, 104], sat((-h - e.hw * 0.72) * 3) * 0.6);
        rg -= 0.25 * sat(liner + lower);
      }
      // 双眼皮褶
      if (look.crease && el < e.R + 0.008) {
        const h = Math.atan2(ex, ez);
        const elev = Math.atan2(ey, Math.sqrt(ex * ex + ez * ez));
        const [up] = lidCurves(e, Math.max(-e.hw, Math.min(e.hw, h)), 0);
        const cr = gauss(elev - (up + look.crease), 0, 0, 0.05, 1, 1) * sstep(e.hw, e.hw * 0.4, Math.abs(h)) * sstep(0.004, 0.0, Math.abs(el - e.R - 0.0045));
        c[0] *= 1 - cr * 0.18;
        c[1] *= 1 - cr * 0.22;
        c[2] *= 1 - cr * 0.18;
        bmp -= cr * 0.25;
      }
      // 唇
      const L = P.lips;
      let lipM = 0;
      if (Math.abs(x) < L.w * 1.3 && Math.abs(y - L.y) < 0.02 && z > L.z - 0.015) {
        const dl = Math.min(lips[0].d(x, y, z), lips[1].d(x, y, z));
        lipM = 1 - sstep(0.0007, 0.0019, dl);
        // 咬唇：唇心浓、向嘴角渐淡
        if (look.lipCenter) lipM *= 1 - look.lipCenter * (1 - Math.exp(-(x * x) / (L.w * L.w * 0.3)));
      }
      if (lipM > 0) {
        const vert = N.noise(x * 2600, y * 300, 1);
        mixc(c, lip, lipM * (look.lipAmt ?? 1));
        bmp += vert * 0.05 * lipM;
        rg = rg * (1 - lipM) + (look.lipGloss ?? 0.35) * lipM;
      }
      // 口角微凹的阴影
      const corner = gauss(Math.abs(x) - L.w * 1.02, y - L.y, 0, 0.0025, 0.002, 1) * sstep(L.z - 0.016, L.z - 0.006, z);
      c[0] *= 1 - corner * 0.3;
      c[1] *= 1 - corner * 0.35;
      c[2] *= 1 - corner * 0.33;
      // 唇缝：口内暗红（口角向内）
      if (Math.abs(x) < L.w * 1.15 && z > L.z - 0.014) {
        const seam = gauss(0, y - L.y, 0, 1, 0.0013 + L.open, 1) * sstep(L.w * 1.15, L.w * 0.75, Math.abs(x));
        mixc(c, [70, 22, 24], sat(seam * 0.9));
        rg -= seam * 0.2;
      }
      // 鼻孔
      const nt = P.nose.tip;
      const nos = gauss(ax - 0.0062, y - nt[1] + 0.0085, z - nt[2] + 0.004, 0.0032, 0.0018, 0.004);
      c[0] *= 1 - nos * 0.75;
      c[1] *= 1 - nos * 0.78;
      c[2] *= 1 - nos * 0.75;
      // 耳内阴影
      const ec = P.ear.c;
      const earIn = gauss(ax - ec[0] - 0.004, y - ec[1] + 0.003, z - ec[2] - 0.002, 0.004, 0.012, 0.006);
      c[0] *= 1 - earIn * 0.3;
      c[1] *= 1 - earIn * 0.36;
      c[2] *= 1 - earIn * 0.34;
      // 眉
      if (front > 0 && look.browAmt) {
        const bx = ax - look.browX0;
        const t = bx / look.browLen;
        if (t > -0.08 && t < 1.08) {
          const tt = sat(t);
          const by = look.browY + look.browArch * Math.sin(Math.PI * Math.min(1, tt * 1.25)) * (tt < 0.8 ? 1 : 1 - (tt - 0.8) * 2.4) - tt * look.browDrop;
          const wdt = look.browW * (1 - 0.6 * tt) * (t < 0 ? 0.5 : 1);
          const dist = Math.abs(y - by);
          const strand = 0.55 + 0.45 * N.noise(bx * 900 + y * 200, y * 1700 - bx * 500, 5);
          let m = (1 - sstep(wdt * 0.55, wdt, dist)) * sstep(-0.08, 0.05, t) * sstep(1.08, 0.9, t) * strand;
          m *= look.browAmt;
          mixc(c, brow, sat(m));
          bmp += m * 0.08;
        }
      }
      // 胡茬
      if (look.stubble) {
        // 络腮区：嘴角到耳前连线以下，含下巴与颏下；上唇另有髭区
        const yb = ax < 0.02 ? L.y - 0.004 : L.y - 0.004 + ((ax - 0.02) / 0.047) * (-0.012 - L.y);
        const cheekZone = (1 - sstep(yb - 0.006, yb + 0.002, y)) * sstep(-0.03, -0.012, z) * sstep(0.074, 0.066, ax) * sstep(-0.15, -0.13, y);
        const nb = P.nose.tip[1] - 0.009;
        const mustache = sstep(L.y + L.up * 2.1, L.y + L.up * 2.6, y) * (1 - sstep(nb - 0.003, nb + 0.001, y)) * sstep(L.w * 1.5, L.w * 1.1, ax) * sstep(0.05, 0.065, z);
        const zone = sat(Math.max(cheekZone, mustache * (look.mustache ?? 1))) * (1 - lipM);
        const dots = sstep(0.1, 0.55, N.noise(x * 2400, y * 2400, z * 2400));
        mixc(c, stubble, sat(zone * look.stubble * (0.45 + 0.55 * dots)));
        bmp += zone * dots * 0.1 * look.stubble;
      }
      // 皱纹：额纹、鱼尾纹、法令纹、眼袋
      if (look.wrinkles) {
        const W0 = look.wrinkles;
        let wr = 0;
        const fh = sstep(0.034, 0.042, y) * (1 - sstep(0.064, 0.074, y)) * sstep(0.05, 0.07, z) * (1 - sstep(0.03, 0.055, ax));
        const wy = y + N.noise(x * 45, y * 15, 2) * 0.004 + x * x * 0.8;
        wr += fh * Math.pow(Math.max(0, Math.sin(wy * 700)), 10) * (0.5 + 0.5 * N.noise(x * 90, y * 40, 4));
        wr += gauss(ax - 0.006, y - 0.03, 0, 0.0012, 0.006, 1) * front * 0.8; // 眉间竖纹
        const cx = ax - (e.c[0] + 0.016);
        const cy = y - e.c[1];
        const ang = Math.atan2(cy, cx);
        const crow = gauss(cx, cy, 0, 0.012, 0.012, 1) * sstep(0, 0.004, cx) * Math.pow(Math.max(0, Math.sin(ang * 9 + 1.3)), 8);
        wr += crow;
        const nl = gauss(ax - (0.019 + (P.nose.tip[1] - y) * 0.22), 0, 0, 0.0023, 1, 1) * sstep(P.nose.tip[1] - 0.004, P.nose.tip[1] - 0.012, y) * sstep(L.y - 0.022, L.y - 0.006, y) * front;
        wr += nl * 1.2;
        const bag = gauss(ex, ey + 0.017, ez - 0.004, 0.012, 0.0022, 0.02);
        wr += bag * 0.8;
        const neckL = sstep(-0.1, -0.12, y) * Math.pow(Math.max(0, Math.sin(y * 500)), 5) * 0.5;
        wr += neckL;
        c[0] *= 1 - wr * 0.2 * W0;
        c[1] *= 1 - wr * 0.25 * W0;
        c[2] *= 1 - wr * 0.25 * W0;
        bmp -= wr * 0.35 * W0;
        // 老年斑
        const spot = sstep(0.62, 0.7, N.noise(x * 170 + 7, y * 170, z * 170)) * W0 * 0.35;
        mixc(c, [120, 80, 55], spot);
      }
      // 头皮（发际线以上染发色，避免稀疏头发下露白）
      if (look.scalpMask) {
        const m = look.scalpMask(x, y, z);
        if (m > 0) {
          mixc(c, hairTint, m * 0.75);
          rg = rg * (1 - m) + 0.7 * m;
        }
      }
      // 花钿
      if (look.huadian) {
        const hy = y - 0.043;
        const rr = Math.sqrt(x * x + hy * hy);
        const a = Math.atan2(hy, x);
        const petal = 0.0036 * (0.55 + 0.45 * Math.abs(Math.cos(a * 1.5 + Math.PI / 4)));
        const m = (1 - sstep(petal * 0.8, petal, rr)) * front;
        mixc(c, [196, 36, 42], m);
        const dot = 1 - sstep(0.0008, 0.0012, Math.sqrt(x * x + (hy + 0.0062) ** 2));
        mixc(c, [214, 160, 60], dot * front);
      }
      const k = (j * W + i) * 4;
      cImg.data[k] = Math.min(255, c[0]);
      cImg.data[k + 1] = Math.min(255, c[1]);
      cImg.data[k + 2] = Math.min(255, c[2]);
      cImg.data[k + 3] = 255;
      const b = Math.max(0, Math.min(255, bmp * 255));
      bImg.data[k] = bImg.data[k + 1] = bImg.data[k + 2] = b;
      bImg.data[k + 3] = 255;
      // T 区略油亮
      const tz = gauss(x, y - 0.03, 0, 0.018, 0.04, 1) * front + gauss(x, y - P.nose.tip[1], z - P.nose.tip[2], 0.01, 0.02, 0.02);
      const rv = Math.max(0, Math.min(255, (rg - tz * 0.12) * 255));
      rImg.data[k] = rImg.data[k + 1] = rImg.data[k + 2] = rv;
      rImg.data[k + 3] = 255;
    }
  }
  col.getContext('2d').putImageData(cImg, 0, 0);
  bump.getContext('2d').putImageData(bImg, 0, 0);
  rough.getContext('2d').putImageData(rImg, 0, 0);
  const tex = (cv, srgb) => {
    const t = new THREE.CanvasTexture(cv);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: tex(col, true), bumpMap: tex(bump), roughnessMap: tex(rough) };
}

// ───────────────────────────── 眼球 ─────────────────────────────

function eyeTexture(iris = '#3a2416', seed = 5) {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  const img = g.createImageData(S, S);
  const N = new Noise3(seed);
  const ic = hex3(iris);
  for (let j = 0; j < S; j++) {
    const pol = (j / S) * Math.PI; // 画布第 0 行 = 纹理 v = 1 = 前极
    for (let i = 0; i < S; i++) {
      const az = (i / S) * Math.PI * 2;
      let c;
      const irisR = 0.5;
      if (pol < irisR) {
        const t = pol / irisR;
        const fib = N.noise(az * 12, t * 6, 1) * 0.5 + N.noise(az * 40, t * 3, 2) * 0.5;
        const k = 0.55 + 0.35 * fib + 0.25 * Math.pow(1 - t, 2);
        c = [ic[0] * k, ic[1] * k, ic[2] * k];
        // 瞳孔与虹膜外缘深环
        const pupil = 1 - sstep(0.3, 0.36, t);
        const limbal = sstep(0.8, 0.98, t);
        const dk = Math.max(pupil * 0.96, limbal * 0.6);
        c = c.map((x) => x * (1 - dk));
      } else {
        const t = (pol - irisR) / (Math.PI - irisR);
        const vein = Math.pow(Math.max(0, N.noise(az * 18, t * 20, 3)), 5) * sstep(0.1, 0.4, t) * 1.4;
        c = [238 - vein * 40, 228 - vein * 110, 222 - vein * 110];
        const edge = sstep(0.0, 0.08, t);
        c = c.map((x, q) => x * (0.84 + 0.16 * edge) + [0, -4, -6][q] * (1 - edge));
      }
      const k = (j * S + i) * 4;
      img.data[k] = c[0];
      img.data[k + 1] = c[1];
      img.data[k + 2] = c[2];
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function eyeballGeometry(R, bulge) {
  const g = new THREE.SphereGeometry(R, 40, 28);
  g.rotateX(Math.PI / 2); // 贴图的 +y 极转到 +z（前方）
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const pol = Math.acos(Math.max(-1, Math.min(1, v.z / R)));
    if (pol < 0.55) v.multiplyScalar(1 + (bulge / R) * Math.pow(Math.cos((pol / 0.55) * Math.PI / 2), 1.5));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// 睫毛条的透明贴图
function lashTexture() {
  const W = 256;
  const H = 64;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 150; k++) {
    const x = rnd() * W;
    const len = H * (0.55 + 0.45 * rnd()) * (0.6 + 0.4 * Math.sin((x / W) * Math.PI));
    g.lineWidth = 1.2 + rnd() * 1.2;
    g.globalAlpha = 0.8 + rnd() * 0.2;
    g.beginPath();
    g.moveTo(x, H);
    g.quadraticCurveTo(x + (rnd() - 0.3) * 6, H - len * 0.6, x + 4 + rnd() * 8, H - len);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  return t;
}

// 上睑阴影壳：固定在头上的半透明球壳，压暗眼白上缘与眼角
function occlusionTexture() {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  const img = g.createImageData(S, S);
  for (let j = 0; j < S; j++) {
    const vv = 1 - j / (S - 1); // 1 = 上方
    for (let i = 0; i < S; i++) {
      const uu = i / (S - 1);
      const top = sstep(0.45, 0.8, vv);
      const side = sstep(0.25, 0.0, Math.min(uu, 1 - uu));
      const a = Math.min(1, top * 0.8 + side * 0.6);
      const k = (j * S + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = a * 255;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(cv);
}

// ───────────────────────────── Head ─────────────────────────────

export class Head {
  /**
   * @param {object} face  FACE_DEFAULTS 的覆盖项
   * @param {object} look  { skin, lip, brow, iris, blink, stubble, wrinkles, huadian, lashes, closed, ... }
   */
  constructor(face = {}, look = {}) {
    this.P = merge(FACE_DEFAULTS, face);
    this.look = look;
    const P = this.P;
    this.group = new THREE.Group();
    this.group.name = 'head';
    // 行加密：眼（极角约 1.35–1.55）与口唇（约 2.05–2.3）
    const param = radialParam(0.42, [[1.3, 1.62, 1.4], [1.95, 2.35, 2.2]]);
    this.param = param;
    const closed = look.closed ? 1 : 0;
    const R0 = traceRadii(buildHeadSDF(P, { blink: closed, puff: 0 }), param, NU, NV, CENTER, RMAX);
    this.R = R0;
    const geo = radialGeometry(R0, param, NU, NV, CENTER);
    const morphs = [];
    this.morphIndex = {};
    const eyeDir = new THREE.Vector3(P.eye.c[0], P.eye.c[1] - CENTER[1], P.eye.c[2]).normalize();
    const addMorph = (name, sdf, filter) => {
      const R1 = traceRadii(sdf, param, NU, NV, CENTER, RMAX, filter, R0);
      const g1 = radialGeometry(R1, param, NU, NV, CENTER);
      const p0 = geo.attributes.position.array;
      const p1 = g1.attributes.position.array;
      const n0 = geo.attributes.normal.array;
      const n1 = g1.attributes.normal.array;
      const dp = new Float32Array(p0.length);
      const dn = new Float32Array(p0.length);
      for (let i = 0; i < p0.length; i++) {
        dp[i] = p1[i] - p0[i];
        dn[i] = n1[i] - n0[i];
      }
      this.morphIndex[name] = morphs.length;
      morphs.push({ dp, dn });
      g1.dispose();
    };
    if (look.blink && !look.closed) {
      addMorph('blink', buildHeadSDF(P, { blink: 1 }), (d) => {
        const ax = Math.abs(d[0]);
        return d[2] > 0.3 && Math.abs(ax - eyeDir.x) < 0.3 && Math.abs(d[1] - eyeDir.y) < 0.28;
      });
    }
    if (P.puff) {
      addMorph('puff', buildHeadSDF(P, { blink: closed, puff: 1 }), (d) => d[2] > 0.05 && d[1] < 0.1);
    }
    if (morphs.length) {
      geo.morphAttributes.position = morphs.map((m) => new THREE.BufferAttribute(m.dp, 3));
      geo.morphAttributes.normal = morphs.map((m) => new THREE.BufferAttribute(m.dn, 3));
      geo.morphTargetsRelative = true;
    }
    const tex = paintSkin(R0, param, P, look);
    this.material = new THREE.MeshPhysicalMaterial({
      map: tex.map, bumpMap: tex.bumpMap, bumpScale: 0.2, roughnessMap: tex.roughnessMap, roughness: 1,
      sheen: 0.35, sheenColor: new THREE.Color(look.sheen || 0xffa890), sheenRoughness: 0.55,
      clearcoat: look.clearcoat ?? 0.06, clearcoatRoughness: 0.5, envMapIntensity: 0.7,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    if (morphs.length) this.mesh.morphTargetInfluences = morphs.map(() => 0);
    this.group.add(this.mesh);
    this.#eyes();
    this.blinkT = 2 + Math.random() * 3;
    this.blinkPhase = -1;
    this.blinkRest = look.blinkRest ?? 0;
    this.gaze = new THREE.Vector2(0, 0);
    this.gazeTarget = new THREE.Vector2(0, 0);
  }

  #eyes() {
    const P = this.P;
    const e = P.eye;
    this.eyes = [];
    if (this.look.closed) return;
    const mat = new THREE.MeshPhysicalMaterial({
      map: eyeTexture(this.look.iris, this.look.seed || 5), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.2,
    });
    const geo = eyeballGeometry(e.R, e.bulge);
    const occ = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, alphaMap: occlusionTexture(), depthWrite: false, opacity: 0.6 });
    // phi = π/2 为 +z（正前方）
    const occGeo = new THREE.SphereGeometry(e.R + 0.00025, 32, 16, Math.PI / 2 - Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.15, Math.PI * 0.62);
    const lashTex = this.look.lashes ? lashTexture() : null;
    for (const side of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(e.c[0] * side, e.c[1], e.c[2]);
      const ball = new THREE.Mesh(geo, mat);
      ball.rotation.y = side * 0.06; // 眼轴略外展
      pivot.add(ball);
      this.group.add(pivot);
      const o = new THREE.Mesh(occGeo, occ);
      o.position.copy(pivot.position);
      o.renderOrder = 1;
      this.group.add(o);
      let lash = null;
      if (lashTex) {
        lash = this.#lashMesh(side, lashTex);
        lash.position.copy(pivot.position);
        this.group.add(lash);
      }
      this.eyes.push({ pivot, ball, lash, side });
    }
  }

  #lashMesh(side, tex) {
    const e = this.P.eye;
    const pos = [];
    const uv = [];
    const idx = [];
    const M = 24;
    const Rr = e.R + 0.0028;
    for (let k = 0; k <= M; k++) {
      const t = k / M;
      const h = -e.hw * 0.78 + t * e.hw * 1.72;
      const [up] = lidCurves(e, Math.min(h, e.hw * 0.98), 0);
      const dir = new THREE.Vector3(Math.sin(h) * Math.cos(up) * side, Math.sin(up), Math.cos(h) * Math.cos(up));
      const root = dir.clone().multiplyScalar(Rr);
      const len = (this.look.lashLen ?? 0.0065) * (0.55 + 0.6 * Math.pow(t, 1.3));
      const out = dir.clone().multiplyScalar(0.7).add(new THREE.Vector3(side * 0.25 * t, 0.85, 0.15)).normalize();
      const tip = root.clone().addScaledVector(out, len);
      pos.push(...root.toArray(), ...tip.toArray());
      uv.push(t, 0, t, 1);
      if (k < M) {
        const a = k * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      color: 0x120b08, roughness: 0.6, alphaMap: tex, alphaTest: 0.35, side: THREE.DoubleSide,
    }));
    return m;
  }

  /** 眼睛看向头部局部坐标系中的方向（yaw 右正、pitch 上正，弧度）。 */
  setGaze(yaw, pitch) {
    this.gazeTarget.set(Math.max(-0.45, Math.min(0.45, yaw)), Math.max(-0.4, Math.min(0.3, pitch)));
  }

  /** 看向世界坐标点。 */
  lookAtWorld(p) {
    const l = this.group.worldToLocal(p.clone());
    const e = this.P.eye;
    l.y -= e.c[1];
    l.z -= e.c[2];
    this.setGaze(Math.atan2(l.x, l.z), Math.atan2(l.y, Math.hypot(l.x, l.z)));
  }

  setPuff(v) {
    const i = this.morphIndex.puff;
    if (i !== undefined) this.mesh.morphTargetInfluences[i] = v;
  }

  update(dt) {
    // 眨眼：随机间隔，闭合 70 ms、张开 120 ms
    let b = this.blinkRest;
    if (this.morphIndex.blink !== undefined) {
      this.blinkT -= dt;
      if (this.blinkT <= 0 && this.blinkPhase < 0) this.blinkPhase = 0;
      if (this.blinkPhase >= 0) {
        this.blinkPhase += dt;
        const p = this.blinkPhase;
        const k = p < 0.07 ? p / 0.07 : Math.max(0, 1 - (p - 0.07) / 0.12);
        b = Math.max(b, k);
        if (p > 0.19) {
          this.blinkPhase = -1;
          this.blinkT = 1.8 + Math.random() * 4.5;
          if (Math.random() < 0.15) this.blinkT = 0.25; // 偶尔连眨
        }
      }
      this.mesh.morphTargetInfluences[this.morphIndex.blink] = b;
    }
    const k = 1 - Math.exp(-dt * 14);
    this.gaze.lerp(this.gazeTarget, k);
    for (const ey of this.eyes) {
      ey.pivot.rotation.set(-this.gaze.y, this.gaze.x, 0, 'YXZ');
      if (ey.lash) {
        const e = this.P.eye;
        ey.lash.rotation.x = (e.up - e.lo) * 0.92 * b + Math.min(0, -this.gaze.y) * 0.25;
        ey.lash.visible = b < 0.97;
      }
    }
  }
}

export const HEAD_GRID = { NU, NV, CENTER };
