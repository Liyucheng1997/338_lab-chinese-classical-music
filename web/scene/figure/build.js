// 人物建模的公共部件：躯干放样与贴图映射、肢体放样、鞋、附着在躯干表面的缘边条、凳。
import * as THREE from 'three';
import { loft, loftPoint } from './Loft.js';
import { ribbonStrip } from './Hair.js';

/**
 * 躯干：水平截面自下而上放样。secs: [{ y, rx, rzF, rzB, cz, n, rxL, rxR }]。
 * 返回 { geo, vOf(y), aOf(u) }：纹理 v 与高度、u 与方位角的对应。
 */
export function torso(secs, o = {}) {
  const sections = secs.map((s) => ({ ...s, c: new THREE.Vector3(s.cx ?? 0, s.y, s.cz ?? 0) }));
  const geo = loft(sections, { rings: o.rings ?? 48, segs: o.segs ?? 64, vByLength: false, disp: o.disp });
  const ys = secs.map((s) => s.y);
  const vOf = (y) => {
    if (y <= ys[0]) return 0;
    for (let i = 1; i < ys.length; i++) if (y <= ys[i]) return (i - 1 + (y - ys[i - 1]) / (ys[i] - ys[i - 1])) / (ys.length - 1);
    return 1;
  };
  const yOf = (v) => {
    const f = v * (ys.length - 1);
    const i = Math.min(ys.length - 2, Math.floor(f));
    return ys[i] + (ys[i + 1] - ys[i]) * (f - i);
  };
  // a：0 为 +x（人物左侧），π/2 为正前；接缝在背后（u = 0）
  const aOf = (u) => -Math.PI / 2 + u * Math.PI * 2;
  const uOf = (a) => {
    let u = (a + Math.PI / 2) / (Math.PI * 2);
    return u - Math.floor(u);
  };
  const at = (a, y, lift = 0) => {
    const p = loftPoint(geo, a, vOf(y));
    const c = new THREE.Vector3(0, p.y, 0);
    const s = geo.userData.secs[Math.round(vOf(y) * geo.userData.rings)];
    c.x = s.c.x;
    c.z = s.c.z;
    const n = p.clone().sub(c).setY(0).normalize();
    return { p: p.addScaledVector(n, lift), n };
  };
  return { geo, vOf, yOf, aOf, uOf, at };
}

/** 贴在躯干表面的缘边条（领缘、襟缘）：path 为 [a, y] 序列。 */
export function surfaceBand(T, path, { width = 0.03, lift = 0.004, seg = 60, material, widthFn } = {}) {
  const pts = [];
  const nrm = [];
  for (const [a, y] of path) {
    const s = T.at(a, y, lift);
    pts.push(s.p);
    nrm.push(s.n);
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const nCurve = new THREE.CatmullRomCurve3(nrm.map((n) => n.clone()));
  const g = ribbonStrip(curve, { w: widthFn ?? (() => width), normal: (t) => nCurve.getPoint(t).normalize(), seg });
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return { mesh: m, curve, nCurve };
}

/** 沿路径的肢体放样：pts 为中心点，rad 为各点 [rx, rz]（rz 朝“前”：大腿朝上、小腿朝前）。 */
export function limb(pts, rad, o = {}) {
  const up = new THREE.Vector3(0, 1, 0);
  const fwd = new THREE.Vector3(0, 0, 1);
  const secs = [];
  let prevX = null;
  for (let i = 0; i < pts.length; i++) {
    const T = new THREE.Vector3().subVectors(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    const ref = Math.abs(T.dot(up)) < 0.7 ? up : fwd;
    const X = new THREE.Vector3().crossVectors(ref, T).normalize();
    if (prevX && X.dot(prevX) < 0) X.negate();
    prevX = X;
    const Z = new THREE.Vector3().crossVectors(T, X).normalize();
    const [rx, rz, rzB] = rad[i];
    secs.push({ c: pts[i].clone(), rx, rzF: rz, rzB: rzB ?? rz, n: o.n ?? 2, ax: X, az: Z });
  }
  return loft(secs, { rings: o.rings ?? 20, segs: o.segs ?? 24, cap0: o.cap0, cap1: o.cap1, disp: o.disp, a0: o.a0 ?? 0 });
}

/**
 * 鞋：自脚跟到脚尖的放样（鞋面）+ 略宽的鞋底。heel、toe 为地面上的两点。
 * o.upturn：翘头高度（绣鞋）。
 */
export function shoe(heel, toe, { width = 0.045, height = 0.06, upturn = 0, upper, sole, soleH = 0.012 }) {
  const g = new THREE.Group();
  const dir = new THREE.Vector3().subVectors(toe, heel);
  const len = dir.length();
  dir.normalize();
  const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
  const P = (t, h) => heel.clone().addScaledVector(dir, t * len).add(new THREE.Vector3(0, h, 0));
  const secs = [];
  const prof = [
    [0.0, 0.3, 0.45, 0.5], [0.08, 0.55, 0.62, 0.52], [0.3, 0.72, 0.8, 0.5], [0.55, 0.9, 0.62, 0.42],
    [0.78, 0.92, 0.42, 0.34], [0.93, 0.66, 0.26, 0.28], [1.0, 0.2, 0.12, 0.26 + upturn * 6],
  ];
  for (const [t, w, h, cy] of prof) {
    secs.push({ c: P(t, soleH + height * cy), rx: width * w, rzF: height * h, rzB: height * Math.min(h, cy) * 0.95, n: 2.4, ax: side, az: new THREE.Vector3(0, 1, 0) });
  }
  if (upturn) secs.push({ c: P(1.04, soleH + height * 0.3 + upturn), rx: width * 0.08, rzF: height * 0.08, rzB: height * 0.08, n: 2, ax: side, az: new THREE.Vector3(0, 1, 0) });
  const top = new THREE.Mesh(loft(secs, { rings: 24, segs: 24, a0: 0, cap0: true }), upper);
  top.castShadow = true;
  g.add(top);
  const soleSecs = [];
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    const w = width * (0.62 + 0.38 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08))) * 1.04;
    soleSecs.push({ c: P(t * 1.01 - 0.005, soleH / 2), rx: w, rz: soleH / 2, n: 4, ax: side, az: new THREE.Vector3(0, 1, 0) });
  }
  const so = new THREE.Mesh(loft(soleSecs, { rings: 12, segs: 20, a0: 0, cap0: true, cap1: true }), sole);
  so.castShadow = true;
  g.add(so);
  return g;
}

/** 绣墩（鼓凳）：鼓腹、上下两圈鼓钉、锦面坐垫。 */
export function drumStool({ r = 0.16, h = 0.43, body, gold, cushion }) {
  const g = new THREE.Group();
  const prof = [];
  for (let k = 0; k <= 24; k++) {
    const t = k / 24;
    prof.push(new THREE.Vector2(r * (0.86 + 0.2 * Math.sin(Math.PI * t)), t * (h - 0.02)));
  }
  prof.unshift(new THREE.Vector2(0, 0));
  prof.push(new THREE.Vector2(0, h - 0.02));
  const drum = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), body);
  drum.castShadow = true;
  drum.receiveShadow = true;
  g.add(drum);
  // 开光：四面海棠形镂空的暗面
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.055, 24), new THREE.MeshStandardMaterial({ color: 0x120806, roughness: 0.9 }));
    win.scale.set(0.8, 1.2, 1);
    const rr = r * (0.86 + 0.2) + 0.001;
    win.position.set(Math.cos(a) * rr, h * 0.48, Math.sin(a) * rr);
    win.lookAt(win.position.clone().multiplyScalar(2).setY(h * 0.48));
    g.add(win);
  }
  for (const [y, rr] of [[0.035, r * 0.9], [h - 0.05, r * 0.9]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.006, 8, 48), body);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    g.add(ring);
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      const nail = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 6), gold);
      nail.position.set(Math.cos(a) * (rr + 0.004), y + (y < 0.1 ? 0.014 : -0.014), Math.sin(a) * (rr + 0.004));
      g.add(nail);
    }
  }
  const cush = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.95, 0.03, 40), cushion);
  cush.position.y = h - 0.015;
  cush.castShadow = true;
  cush.receiveShadow = true;
  g.add(cush);
  return g;
}

/** 方凳：四腿、横枨、凳面。 */
export function squareStool({ w = 0.34, d = 0.3, h = 0.37, wood }) {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.028, d), wood);
  top.position.y = h - 0.014;
  g.add(top);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, h - 0.028, 0.03), wood);
      leg.position.set(sx * (w / 2 - 0.03), (h - 0.028) / 2, sz * (d / 2 - 0.03));
      leg.rotation.z = sx * 0.04;
      leg.rotation.x = -sz * 0.04;
      g.add(leg);
    }
  }
  for (const y of [0.1, h - 0.07]) {
    for (const sz of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w - 0.07, 0.018, 0.016), wood);
      b.position.set(0, y, sz * (d / 2 - 0.03));
      g.add(b);
    }
    for (const sx of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.018, d - 0.07), wood);
      b.position.set(sx * (w / 2 - 0.03), y + 0.03, 0);
      g.add(b);
    }
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/** 盘扣：两团结子与一字襻。 */
export function frogButton(material, size = 1) {
  const g = new THREE.Group();
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.0045 * size, 10, 8), material);
  g.add(knot);
  for (const s of [-1, 1]) {
    const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.0022 * size, 0.018 * size, 4, 8), material);
    bar.rotation.z = Math.PI / 2;
    bar.position.x = s * 0.013 * size;
    g.add(bar);
  }
  return g;
}
