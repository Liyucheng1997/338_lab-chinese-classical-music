// 头发：贴合头皮的发壳（按发际线遮罩、沿梳理方向绘制发丝）、发髻与发环（管状发束）、
// 垂发发片（带透明发梢）。发丝纹理按三维位置逐像素绘制，梳理方向由“汇聚点”决定。
import * as THREE from 'three';
import { radialGeometry, sampleR, Noise3, weldSeamNormals } from './sdf.js';
import { HEAD_GRID } from './Head.js';

const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
// 取 sRGB 分量（THREE.Color 内部为线性值，直接写入 sRGB 画布会偏暗偏艳）
const hex3 = (h) => {
  const c = new THREE.Color(h).getRGB({}, THREE.SRGBColorSpace);
  return [c.r * 255, c.g * 255, c.b * 255];
};

// 按水平角（0 正前、±π 后）插值发际线高度
export function hairlineFn(pts) {
  return (theta) => {
    const a = Math.abs(theta);
    if (a <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (a <= pts[i][0]) {
        const t = (a - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
        const s = t * t * (3 - 2 * t);
        return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * s;
      }
    }
    return pts[pts.length - 1][1];
  };
}

function blurGrid(R, nu, nv, passes = 3) {
  let a = Float32Array.from(R);
  let b = new Float32Array(R.length);
  const W = nu + 1;
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        let s = 0;
        let n = 0;
        for (let dj = -2; dj <= 2; dj++) {
          const jj = Math.min(nv, Math.max(0, j + dj));
          for (let di = -2; di <= 2; di++) {
            const ii = (i + di + nu) % nu;
            s += a[jj * W + ii];
            n++;
          }
        }
        b[j * W + i] = s / n;
      }
      b[j * W + nu] = b[j * W];
    }
    [a, b] = [b, a];
  }
  return a;
}

/**
 * 发壳。o: { mask(x,y,z,theta) → 0..1, thick(x,y,z) → 米, color, tip, pole:[x,y,z] 汇聚方向, part: 分缝宽度, seed, strands }
 */
export function hairCap(head, o) {
  const { NU, NV, CENTER } = HEAD_GRID;
  const nu = NU >> 1;
  const nv = NV >> 1;
  const Rb = blurGrid(head.R, NU, NV, 2);
  const R = new Float32Array((nu + 1) * (nv + 1));
  const M = new Float32Array((nu + 1) * (nv + 1));
  const d = [0, 0, 0];
  const param = head.param;
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const v = j / nv;
      param.dir(u, v, d);
      const r0 = Math.max(sampleR(Rb, NU, NV, u, v), sampleR(head.R, NU, NV, u, v));
      const x = CENTER[0] + d[0] * r0;
      const y = CENTER[1] + d[1] * r0;
      const z = CENTER[2] + d[2] * r0;
      const th = Math.atan2(x, z);
      const m = o.mask(x, y, z, th);
      // 几何按外扩约 6 毫米的遮罩生成，发际线的实际边缘交给逐像素透明
      const mg = Math.max(m, o.mask(x, y + 0.006, z, th), o.mask(x * 0.94, y + 0.004, z * 0.94, th));
      const k = j * (nu + 1) + i;
      M[k] = m;
      R[k] = r0 + (mg > 0.02 ? o.thick(x, y, z, th) * Math.max(0.35, Math.pow(m, 0.5)) + 0.0009 : -0.003);
    }
  }
  // 与头部同一参数化，但行列减半
  const half = {
    dir: (u, v, out) => param.dir(u, v, out),
  };
  const geo = radialGeometry(R, half, nu, nv, CENTER);
  weldSeamNormals(geo.attributes.normal, nu, nv);
  const tex = paintHair(head.R, NU, NV, half, CENTER, o);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: tex.map, alphaMap: tex.alpha, bumpMap: tex.bump, bumpScale: 0.8, roughness: o.roughness ?? 0.52,
    sheen: 0.6, sheenColor: new THREE.Color(o.sheen ?? 0x6a5040), sheenRoughness: 0.35,
    alphaTest: 0.5, alphaToCoverage: true, envMapIntensity: 0.8,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'hairCap';
  return mesh;
}

function paintHair(R, nu, nv, param, center, o) {
  const W = o.texW || 1024;
  const H = o.texH || 512;
  const col = document.createElement('canvas');
  col.width = W;
  col.height = H;
  const al = document.createElement('canvas');
  al.width = W;
  al.height = H;
  const bm = document.createElement('canvas');
  bm.width = W;
  bm.height = H;
  const cI = col.getContext('2d').createImageData(W, H);
  const aI = al.getContext('2d').createImageData(W, H);
  const bI = bm.getContext('2d').createImageData(W, H);
  const N = new Noise3(o.seed || 7);
  const base = hex3(o.color);
  const hi = hex3(o.tip || o.color);
  const pole = new THREE.Vector3(...o.pole).normalize();
  // 以汇聚方向为轴的正交基
  const e1 = new THREE.Vector3(1, 0, 0).addScaledVector(pole, -pole.x).normalize();
  const e2 = new THREE.Vector3().crossVectors(pole, e1);
  const d = [0, 0, 0];
  const strands = o.strands || 420;
  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) / H;
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5) / W;
      param.dir(u, v, d);
      const r = sampleR(R, nu, nv, u, v); // 头皮表面（全分辨率），发际线平滑
      const x = center[0] + d[0] * r;
      const y = center[1] + d[1] * r;
      const z = center[2] + d[2] * r;
      // 遮罩逐像素重算，发际线不受网格分辨率影响
      const m = o.mask(x, y, z, Math.atan2(x, z));
      // 梳理坐标：绕汇聚轴的方位角（同一根发丝上不变）与到汇聚点的角距
      const px = d[0];
      const py = d[1];
      const pz = d[2];
      const a1 = px * e1.x + py * e1.y + pz * e1.z;
      const a2 = px * e2.x + py * e2.y + pz * e2.z;
      const along = Math.acos(Math.max(-1, Math.min(1, px * pole.x + py * pole.y + pz * pole.z)));
      let az = Math.atan2(a2, a1);
      // 中分：两侧发丝各自从分缝向下梳
      if (o.part) az += Math.sign(x) * 0.0;
      const f = az * strands / (Math.PI * 2);
      const s1 = N.noise(f, along * 3, 1);
      const s2 = N.noise(f * 3.1, along * 9, 2);
      const s3 = N.noise(f * 9.7, along * 20, 3);
      const clump = N.noise(f * 0.18, along * 1.5, 5);
      const str = 0.5 + 0.3 * s1 + 0.18 * s2 + 0.12 * s3;
      let k = 0.45 + 0.8 * str + 0.25 * clump;
      // 分缝：沿正中线露出一线头皮色
      let part = 0;
      if (o.part && z > -0.02 && y > 0.02) part = Math.exp(-(x * x) / (o.part * o.part)) * sstep(0.02, 0.05, y);
      const c = [base[0] * k, base[1] * k, base[2] * k];
      // 发梢区（发际线附近）颜色略浅、较稀
      const edge = 1 - sstep(0.0, 0.5, m);
      c[0] += (hi[0] - c[0]) * edge * 0.4;
      c[1] += (hi[1] - c[1]) * edge * 0.4;
      c[2] += (hi[2] - c[2]) * edge * 0.4;
      if (part > 0) {
        const sk = hex3(o.scalp || '#c9a58e');
        c[0] += (sk[0] - c[0]) * part * 0.4;
        c[1] += (sk[1] - c[1]) * part * 0.4;
        c[2] += (sk[2] - c[2]) * part * 0.4;
      }
      const kk = (j * W + i) * 4;
      cI.data[kk] = Math.min(255, c[0]);
      cI.data[kk + 1] = Math.min(255, c[1]);
      cI.data[kk + 2] = Math.min(255, c[2]);
      cI.data[kk + 3] = 255;
      // 透明：发际线处按发丝噪声稀疏
      const wisp = m * 1.3 - 0.3 + ((str - 0.5) * 0.5 + s3 * 0.35) * (1 - sstep(0.55, 0.95, m));
      const a = m <= 0.001 ? 0 : sat(wisp * 3) * 255;
      aI.data[kk] = aI.data[kk + 1] = aI.data[kk + 2] = a;
      aI.data[kk + 3] = 255;
      const b = 128 + (str - 0.5) * 200 - part * 40;
      bI.data[kk] = bI.data[kk + 1] = bI.data[kk + 2] = Math.max(0, Math.min(255, b));
      bI.data[kk + 3] = 255;
    }
  }
  col.getContext('2d').putImageData(cI, 0, 0);
  al.getContext('2d').putImageData(aI, 0, 0);
  bm.getContext('2d').putImageData(bI, 0, 0);
  const t = (cv, srgb) => {
    const x = new THREE.CanvasTexture(cv);
    if (srgb) x.colorSpace = THREE.SRGBColorSpace;
    x.anisotropy = 8;
    return x;
  };
  return { map: t(col, true), alpha: t(al), bump: t(bm) };
}

// ───────────────────────────── 发束 / 发片 ─────────────────────────────

/** 沿长度方向的发丝纹理（u 沿发束，v 绕 / 横跨发束），末端可带透明发梢。 */
export function strandTexture(color, { W = 512, H = 256, seed = 3, tipFade = 0, lines = 90, tip } = {}) {
  const col = document.createElement('canvas');
  col.width = W;
  col.height = H;
  const al = document.createElement('canvas');
  al.width = W;
  al.height = H;
  const cI = col.getContext('2d').createImageData(W, H);
  const aI = al.getContext('2d').createImageData(W, H);
  const N = new Noise3(seed);
  const base = hex3(color);
  const hi = hex3(tip || color);
  for (let j = 0; j < H; j++) {
    const v = j / H;
    for (let i = 0; i < W; i++) {
      const u = i / W;
      const f = v * lines;
      const s = 0.5 + 0.32 * N.noise(f, u * 4, 1) + 0.18 * N.noise(f * 3, u * 10, 2) + 0.1 * N.noise(f * 8, u * 25, 3);
      const k = 0.42 + 0.85 * s + 0.2 * N.noise(f * 0.2, u * 2, 6);
      const tipT = tipFade > 0 ? sstep(1 - tipFade, 1, u) : 0;
      const kk = (j * W + i) * 4;
      cI.data[kk] = Math.min(255, (base[0] + (hi[0] - base[0]) * tipT * 0.5) * k);
      cI.data[kk + 1] = Math.min(255, (base[1] + (hi[1] - base[1]) * tipT * 0.5) * k);
      cI.data[kk + 2] = Math.min(255, (base[2] + (hi[2] - base[2]) * tipT * 0.5) * k);
      cI.data[kk + 3] = 255;
      // 发梢：按发丝长短不一地变稀
      const len = 1 - tipFade * (0.35 + 0.65 * sat(0.5 + 0.9 * N.noise(f * 1.3, 7.7, 4)));
      const a = tipFade > 0 ? sat((len - u) * 18 + (s - 0.5) * 1.2) : 1;
      aI.data[kk] = aI.data[kk + 1] = aI.data[kk + 2] = a * 255;
      aI.data[kk + 3] = 255;
    }
  }
  col.getContext('2d').putImageData(cI, 0, 0);
  al.getContext('2d').putImageData(aI, 0, 0);
  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const alpha = new THREE.CanvasTexture(al);
  alpha.wrapT = THREE.RepeatWrapping;
  return { map, alpha };
}

export function hairMaterial(tex, o = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: tex.map, alphaMap: o.alpha ? tex.alpha : null, alphaTest: o.alpha ? 0.45 : 0, alphaToCoverage: !!o.alpha,
    bumpMap: tex.map, bumpScale: 0.6, roughness: o.roughness ?? 0.52, side: o.side ?? THREE.FrontSide,
    sheen: 0.6, sheenColor: new THREE.Color(o.sheen ?? 0x6a5040), sheenRoughness: 0.35, envMapIntensity: 0.8,
  });
}

/**
 * 管状发束：沿曲线的扁圆管，截面半径 r(t)、扁度 flat，贴图 u 沿长度重复 rep 次。
 * twist：发丝绕管轴扭转的圈数（用于盘髻的绞纹）。
 */
export function hairTube(curve, { r = (t) => 0.01, flat = 0.8, seg = 80, radial = 14, closed = false, twist = 0, up = new THREE.Vector3(0, 1, 0), rep = 1 } = {}) {
  const frames = curve.computeFrenetFrames(seg, closed);
  const pos = [];
  const uv = [];
  const idx = [];
  const P = new THREE.Vector3();
  const n = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    curve.getPointAt(t, P);
    const T = frames.tangents[i];
    // 以 up 为参考构造稳定的截面坐标系，避免 Frenet 翻转
    n.copy(up).addScaledVector(T, -up.dot(T));
    if (n.lengthSq() < 1e-6) n.copy(frames.normals[i]);
    n.normalize();
    b.crossVectors(T, n);
    const rr = r(t);
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      pos.push(P.x + (n.x * ca * flat + b.x * sa) * rr, P.y + (n.y * ca * flat + b.y * sa) * rr, P.z + (n.z * ca * flat + b.z * sa) * rr);
      uv.push(t * rep, k / radial + twist * t);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * (radial + 1) + k;
      const c = a + radial + 1;
      idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * 发片：沿曲线的弯曲带（宽 w(t)、朝向 side 为带面法线参考），u 沿长度、v 横跨。
 * 用于垂发、鬓发与披帛等。
 */
export function ribbonStrip(points, { w = () => 0.03, normal = new THREE.Vector3(0, 0, 1), seg = 40, curl = () => 0 } = {}) {
  const curve = typeof points.getPointAt === 'function' ? points : new THREE.CatmullRomCurve3(points);
  const pos = [];
  const uv = [];
  const idx = [];
  const P = new THREE.Vector3();
  const T = new THREE.Vector3();
  const s = new THREE.Vector3();
  const nn = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T);
    const N0 = typeof normal === 'function' ? normal(t, P) : normal;
    s.crossVectors(T, N0).normalize();
    nn.crossVectors(s, T).normalize();
    const hw = w(t) / 2;
    const c = curl(t);
    for (let k = 0; k <= 4; k++) {
      const q = k / 4 - 0.5;
      // 横向微卷：两侧向法线反方向弯
      const off = c * (q * q * 4 - 0.33) * hw;
      pos.push(P.x + s.x * q * 2 * hw + nn.x * off, P.y + s.y * q * 2 * hw + nn.y * off, P.z + s.z * q * 2 * hw + nn.z * off);
      uv.push(t, k / 4);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let k = 0; k < 4; k++) {
      const a = i * 5 + k;
      idx.push(a, a + 5, a + 1, a + 1, a + 5, a + 6);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
