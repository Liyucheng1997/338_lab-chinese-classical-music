// 四位乐师的发型与头饰：少女（中分、后髻、双垂鬟、垂发、步摇与花钿）、琵琶女（侧分、低髻、碧玉簪）、
// 老琴师（帽下短白发、稀疏山羊须）、唢呐匠（羊肚手巾下的短黑发、髭须）。
import * as THREE from 'three';
import { hairCap, hairlineFn, strandTexture, hairMaterial, hairTube, ribbonStrip } from './Hair.js';
import { HEAD_GRID } from './Head.js';
import { sampleR } from './sdf.js';

const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 头部表面某方向（头局部坐标）上的点，外加 lift。 */
export function surfacePoint(head, dir, lift = 0) {
  const { NU, NV, CENTER } = HEAD_GRID;
  const d = dir.clone().normalize();
  const th = Math.atan2(d.x, d.z);
  const u = th / (2 * Math.PI) + 0.5;
  // 反求参数：theta(u) 非线性，这里迭代求逆
  let uu = u;
  for (let k = 0; k < 20; k++) {
    const t = head.param.theta(uu);
    uu += (th - t) / (2 * Math.PI) * 0.8;
    uu = Math.min(1, Math.max(0, uu));
  }
  const ph = Math.acos(Math.max(-1, Math.min(1, d.y)));
  let vv = ph / Math.PI;
  for (let k = 0; k < 20; k++) {
    vv += (ph - head.param.phi(vv)) / Math.PI * 0.8;
    vv = Math.min(1, Math.max(0, vv));
  }
  const r = sampleR(head.R, NU, NV, uu, vv) + lift;
  return new THREE.Vector3(CENTER[0], CENTER[1], CENTER[2]).addScaledVector(d, r);
}

// ───────────────────────────── 少女 ─────────────────────────────

export function girlHair(head, { color = '#1a110d', tip = '#3a261c' } = {}) {
  const g = new THREE.Group();
  g.name = 'girlHair';
  const line = hairlineFn([[0, 0.069], [0.4, 0.062], [0.72, 0.048], [0.92, 0.026], [1.08, 0.004], [1.3, -0.006], [1.6, -0.026], [2.0, -0.052], [2.6, -0.07], [3.15, -0.076]]);
  const cap = hairCap(head, {
    mask: (x, y, z, th) => sstep(line(th) - 0.004, line(th) + 0.003, y),
    thick: (x, y, z, th) => {
      let t = 0.0042;
      t += 0.005 * sstep(0.02, 0.08, y) * sstep(0.02, -0.06, z); // 头顶后部蓬松
      t += 0.0035 * sstep(0.9, 1.4, Math.abs(th)) * sstep(0.045, 0.0, Math.abs(y - 0.005)); // 鬓侧覆耳
      if (z > -0.01) t *= 1 - 0.55 * Math.exp(-(x * x) / 0.000016) * sstep(0.03, 0.06, y); // 中分缝
      return t;
    },
    color, tip, pole: [0, 0.6, -0.8], part: 0.0012, scalp: '#b89a88', strands: 520, seed: 17,
  });
  g.add(cap);

  const strand = strandTexture(color, { tip, lines: 60, seed: 5 });
  const strandTip = strandTexture(color, { tip, lines: 70, seed: 9, tipFade: 0.35 });
  const hm = hairMaterial(strand);
  const hmTip = hairMaterial(strandTip, { alpha: true, side: THREE.DoubleSide });

  // 后髻：绕髻轴盘两圈半的发束
  const axis = new THREE.Vector3(0, 0.62, -0.78).normalize();
  const bunBase = surfacePoint(head, axis, 0.004);
  const e1 = new THREE.Vector3(1, 0, 0);
  const e2 = new THREE.Vector3().crossVectors(axis, e1).normalize();
  const coil = [];
  for (let k = 0; k <= 60; k++) {
    const t = k / 60;
    const a = t * Math.PI * 2 * 2.4;
    const rr = 0.027 * (1 - 0.62 * t);
    const h = 0.004 + 0.022 * Math.sin(t * Math.PI * 0.55);
    coil.push(bunBase.clone().addScaledVector(e1, Math.cos(a) * rr).addScaledVector(e2, Math.sin(a) * rr * 0.9).addScaledVector(axis, h));
  }
  const coilCurve = new THREE.CatmullRomCurve3(coil);
  const bun = new THREE.Mesh(hairTube(coilCurve, { r: (t) => 0.0125 * (1 - 0.35 * t), flat: 0.85, seg: 160, radial: 16, up: axis, twist: 5, rep: 6 }), hm);
  bun.castShadow = true;
  g.add(bun);
  // 髻芯
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.02, 20, 14), hm);
  core.position.copy(bunBase).addScaledVector(axis, 0.012);
  g.add(core);

  // 双垂鬟：耳后两侧垂下的发环，扎红绳
  const ribbonMat = new THREE.MeshPhysicalMaterial({ color: 0xa8141c, roughness: 0.45, sheen: 1, sheenColor: new THREE.Color(0xff7060), side: THREE.DoubleSide });
  const loops = [];
  for (const s of [1, -1]) {
    const top = new THREE.Vector3(0.056 * s, 0.0, -0.058);
    const pts = [
      top,
      new THREE.Vector3(0.074 * s, -0.03, -0.05),
      new THREE.Vector3(0.082 * s, -0.07, -0.04),
      new THREE.Vector3(0.07 * s, -0.098, -0.036),
      new THREE.Vector3(0.058 * s, -0.082, -0.05),
      new THREE.Vector3(0.056 * s, -0.045, -0.062),
      top.clone().add(new THREE.Vector3(-0.004 * s, -0.004, -0.004)),
    ];
    const lc = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const loop = new THREE.Mesh(hairTube(lc, { r: (t) => 0.0108 * (0.75 + 0.25 * Math.sin(Math.PI * t)), flat: 0.72, seg: 70, radial: 12, up: new THREE.Vector3(s, 0, 0), twist: 1.5, rep: 3 }), hm);
    loop.castShadow = true;
    g.add(loop);
    // 红绳缠绕
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.0095, 0.0022, 8, 20), ribbonMat);
    tie.position.copy(top).add(new THREE.Vector3(0.006 * s, -0.012, 0.002));
    tie.rotation.set(Math.PI / 2 + 0.3, 0.3 * s, 0);
    g.add(tie);
    loops.push({ top, s });
  }
  g.userData.ribbonMat = ribbonMat;
  g.userData.loops = loops;

  // 鬓发：鬓角垂下的细发
  for (const s of [1, -1]) {
    const p0 = surfacePoint(head, new THREE.Vector3(1.1 * s, 0.3, 0.25), 0.003);
    const pts = [p0, p0.clone().add(new THREE.Vector3(0.004 * s, -0.022, 0.002)), p0.clone().add(new THREE.Vector3(0.008 * s, -0.048, 0.0)), p0.clone().add(new THREE.Vector3(0.007 * s, -0.066, -0.003))];
    const wisp = new THREE.Mesh(ribbonStrip(pts, { w: (t) => 0.006 * (1 - 0.6 * t), normal: new THREE.Vector3(s, 0, 0.2), seg: 16 }), hmTip);
    g.add(wisp);
  }

  // 步摇：金簪斜插髻侧，花头下垂三串珠
  const gold = new THREE.MeshStandardMaterial({ color: 0xe0b060, metalness: 1, roughness: 0.25 });
  const pearl = new THREE.MeshPhysicalMaterial({ color: 0xf6efe4, roughness: 0.18, clearcoat: 1, sheen: 1, sheenColor: new THREE.Color(0xffe0f0), iridescence: 0.5 });
  const gem = new THREE.MeshPhysicalMaterial({ color: 0xb01020, roughness: 0.05, transmission: 0.4, thickness: 0.004, clearcoat: 1 });
  const pin = new THREE.Group();
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0008, 0.11, 8), gold);
  rod.position.y = -0.03;
  pin.add(rod);
  const flower = new THREE.Group();
  for (let k = 0; k < 6; k++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), gold);
    p.scale.set(0.0052, 0.0014, 0.0028);
    const a = (k / 6) * Math.PI * 2;
    p.position.set(Math.cos(a) * 0.0058, 0, Math.sin(a) * 0.0058);
    p.rotation.y = -a;
    flower.add(p);
  }
  const heart = new THREE.Mesh(new THREE.SphereGeometry(0.0034, 14, 10), gem);
  heart.position.y = 0.0012;
  flower.add(heart);
  flower.position.y = 0.025;
  pin.add(flower);
  // 垂珠：由摆动组驱动
  const dangles = [];
  for (let k = 0; k < 3; k++) {
    const sw = new THREE.Group();
    sw.position.set((k - 1) * 0.006, 0.024, 0.0);
    const chain = [];
    for (let q = 0; q < 5; q++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(q === 4 ? 0.0024 : 0.0016, 10, 8), q === 4 ? gem : pearl);
      b.position.y = -0.006 - q * 0.0052 - (k === 1 ? 0.004 : 0);
      sw.add(b);
      chain.push(b);
    }
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), gold);
    leaf.scale.set(0.0022, 0.004, 0.0006);
    leaf.position.y = -0.036 - (k === 1 ? 0.004 : 0);
    sw.add(leaf);
    pin.add(sw);
    dangles.push({ g: sw, a: 0, v: 0, b: 0, vb: 0, len: 0.03 + (k === 1 ? 0.004 : 0) });
  }
  // 簪自髻右上斜插，花头露在髻外
  const pinPos = bunBase.clone().addScaledVector(axis, 0.018).addScaledVector(e1, 0.03).addScaledVector(e2, 0.006);
  pin.position.copy(pinPos);
  pin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), e1.clone().multiplyScalar(0.85).addScaledVector(axis, 0.5).normalize());
  pin.children.forEach((c) => { c.position.y -= 0.008; });
  g.add(pin);
  g.userData.dangles = dangles;
  g.userData.pin = pin;

  // 花钿式小花：髻另一侧三朵白梅
  const petal = new THREE.MeshPhysicalMaterial({ color: 0xfff0f0, roughness: 0.5, sheen: 1, sheenColor: new THREE.Color(0xffc0d0) });
  const stamen = new THREE.MeshStandardMaterial({ color: 0xf0c040, roughness: 0.5 });
  for (let f = 0; f < 3; f++) {
    const fl = new THREE.Group();
    for (let k = 0; k < 5; k++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), petal);
      p.scale.set(0.0042, 0.0012, 0.0034);
      const a = (k / 5) * Math.PI * 2;
      p.position.set(Math.cos(a) * 0.0042, 0, Math.sin(a) * 0.0042);
      p.rotation.y = -a;
      fl.add(p);
    }
    const st = new THREE.Mesh(new THREE.SphereGeometry(0.0016, 8, 6), stamen);
    st.position.y = 0.001;
    fl.add(st);
    const dir = axis.clone().addScaledVector(e1, -0.42 - f * 0.12).addScaledVector(e2, -0.15 + f * 0.14).normalize();
    fl.position.copy(surfacePoint(head, dir, 0.012));
    fl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    fl.scale.setScalar(1 - f * 0.18);
    g.add(fl);
  }
  g.userData.hairMat = hm;
  g.userData.hairTipMat = hmTip;
  return g;
}

/**
 * 少女垂发：自后脑髻下垂至背中部的发片（挂在胸腔骨骼上，随上身而非头部运动）。
 * backCurve(x) 返回某一横向位置沿背部下垂的控制点（胸腔局部坐标）。
 */
export function girlLongHair(mats, pathFor, count = 13) {
  const g = new THREE.Group();
  for (let k = 0; k < count; k++) {
    const t = (k / (count - 1)) * 2 - 1;
    const pts = pathFor(t, k);
    const w = 0.034 - Math.abs(t) * 0.008;
    const strip = new THREE.Mesh(ribbonStrip(pts, {
      w: (q) => w * (1 - 0.35 * q),
      normal: (q, P) => new THREE.Vector3(P.x * 3, 0.2, -1).normalize(),
      seg: 30, curl: () => 0.5,
    }), mats.tip);
    strip.castShadow = true;
    g.add(strip);
  }
  return g;
}

/** 步摇垂珠摆动：由头部角速度 / 加速度激励的阻尼摆。 */
export function swingDangles(dangles, dt, excite) {
  for (const d of dangles) {
    const w2 = 9.8 / d.len;
    d.v += (-w2 * d.a - 2.2 * d.v) * dt + excite.x * 0.6;
    d.a += d.v * dt;
    d.vb += (-w2 * d.b - 2.2 * d.vb) * dt + excite.y * 0.6;
    d.b += d.vb * dt;
    d.g.rotation.set(d.b, 0, d.a);
  }
}

// ───────────────────────────── 琵琶女 ─────────────────────────────

/** 侧分、两鬓收拢，颈后盘低髻，横插碧玉簪，髻边一朵白玉兰。 */
export function pipaHair(head, { color = '#140d0a', tip = '#2e2019' } = {}) {
  const g = new THREE.Group();
  g.name = 'pipaHair';
  const line = hairlineFn([[0, 0.074], [0.4, 0.067], [0.72, 0.052], [0.92, 0.03], [1.08, 0.008], [1.3, -0.006], [1.6, -0.028], [2.0, -0.054], [2.6, -0.072], [3.15, -0.078]]);
  const cap = hairCap(head, {
    mask: (x, y, z, th) => sstep(line(th) - 0.004, line(th) + 0.003, y),
    thick: (x, y, z, th) => {
      let t = 0.0038;
      t += 0.004 * sstep(0.02, 0.07, y) * sstep(0.0, -0.06, z);          // 头顶后部蓬松
      if (z > -0.01) t *= 1 - 0.5 * Math.exp(-((x - 0.018) ** 2) / 0.00002) * sstep(0.03, 0.06, y); // 右侧分缝
      return t;
    },
    color, tip, pole: [0, 0.2, -1], part: 0.0012, scalp: '#b89a88', strands: 560, seed: 61,
  });
  g.add(cap);
  const strand = strandTexture(color, { tip, lines: 60, seed: 7 });
  const hm = hairMaterial(strand);
  // 低髻：颈后盘成扁圆发髻
  const axis = new THREE.Vector3(0, -0.2, -1).normalize();
  const base = surfacePoint(head, new THREE.Vector3(0, -0.28, -1), 0.003);
  const e1 = new THREE.Vector3(1, 0, 0);
  const e2 = new THREE.Vector3().crossVectors(axis, e1).normalize();
  const coil = [];
  for (let k = 0; k <= 70; k++) {
    const t = k / 70;
    const a = t * Math.PI * 2 * 2.6;
    const rr = 0.034 * (1 - 0.6 * t);
    const h = 0.004 + 0.02 * Math.sin(t * Math.PI * 0.5);
    coil.push(base.clone().addScaledVector(e1, Math.cos(a) * rr * 1.25).addScaledVector(e2, Math.sin(a) * rr * 0.85).addScaledVector(axis, h));
  }
  const bun = new THREE.Mesh(hairTube(new THREE.CatmullRomCurve3(coil), { r: (t) => 0.013 * (1 - 0.3 * t), flat: 0.85, seg: 180, radial: 16, up: axis, twist: 5, rep: 6 }), hm);
  bun.castShadow = true;
  g.add(bun);
  const core = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), hm);
  core.scale.set(0.034, 0.024, 0.02);
  core.position.copy(base).addScaledVector(axis, 0.012);
  g.add(core);
  // 碧玉簪：横穿发髻
  const jade = new THREE.MeshPhysicalMaterial({ color: 0x3f9a6e, roughness: 0.12, transmission: 0.25, thickness: 0.004, clearcoat: 1, clearcoatRoughness: 0.05 });
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0014, 0.13, 10), jade);
  pin.position.copy(base).addScaledVector(axis, 0.02).addScaledVector(e2, 0.006);
  pin.rotation.z = Math.PI / 2 - 0.25;
  g.add(pin);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.0048, 12, 10), jade);
  knob.position.copy(pin.position).add(new THREE.Vector3(0.063 * Math.cos(0.25), 0.063 * Math.sin(0.25), 0));
  g.add(knob);
  // 白玉兰：髻的左上侧
  const petal = new THREE.MeshPhysicalMaterial({ color: 0xfbf6ee, roughness: 0.45, sheen: 1, sheenColor: new THREE.Color(0xfff0e0) });
  const fl = new THREE.Group();
  for (let k = 0; k < 6; k++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), petal);
    p.scale.set(0.0045, 0.0022, 0.011);
    const a = (k / 6) * Math.PI * 2;
    p.position.set(Math.sin(a) * 0.004, 0.004, Math.cos(a) * 0.004);
    p.rotation.set(0.9, a, 0, 'YXZ');
    fl.add(p);
  }
  const dir = axis.clone().addScaledVector(e1, 0.55).addScaledVector(e2, 0.35).normalize();
  fl.position.copy(surfacePoint(head, dir, 0.014));
  fl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.add(fl);
  g.userData.hairMat = hm;
  return g;
}

// ───────────────────────────── 老琴师 ─────────────────────────────

export function oldmanHair(head) {
  const g = new THREE.Group();
  const line = hairlineFn([[0, 0.07], [0.6, 0.06], [0.95, 0.03], [1.12, 0.012], [1.35, 0.0], [1.6, -0.02], [2.1, -0.05], [3.15, -0.066]]);
  const cap = hairCap(head, {
    mask: (x, y, z, th) => sstep(line(th) - 0.003, line(th) + 0.004, y),
    thick: () => 0.0024,
    color: '#8c8680', tip: '#b8b2aa', pole: [0, 1, -0.15], strands: 700, seed: 29, roughness: 0.6, sheen: 0x807870,
  });
  g.add(cap);
  // 山羊须：下巴与唇下几缕灰白须
  const beardTex = strandTexture('#9a948c', { tip: '#d8d2c8', lines: 40, seed: 12, tipFade: 0.5 });
  const bm = hairMaterial(beardTex, { alpha: true, side: THREE.DoubleSide, roughness: 0.6, sheen: 0x807870 });
  for (let k = 0; k < 7; k++) {
    const x = (k - 3) * 0.0042;
    const p0 = surfacePoint(head, new THREE.Vector3(x * 12, -0.8, 0.62), -0.001);
    const len = 0.038 - Math.abs(k - 3) * 0.006;
    const pts = [p0, p0.clone().add(new THREE.Vector3(x * 0.2, -len * 0.4, 0.008)), p0.clone().add(new THREE.Vector3(x * 0.3, -len * 0.8, 0.008)), p0.clone().add(new THREE.Vector3(x * 0.2, -len, 0.004))];
    g.add(new THREE.Mesh(ribbonStrip(pts, { w: (t) => 0.008 * (1 - 0.7 * t), normal: new THREE.Vector3(0, 0.3, 1), seg: 12 }), bm));
  }
  // 八字须
  for (const s of [1, -1]) {
    const L = head.P.lips;
    const p0 = new THREE.Vector3(0.003 * s, L.y + 0.009, L.z + 0.004);
    const pts = [p0, new THREE.Vector3(0.013 * s, L.y + 0.006, L.z + 0.001), new THREE.Vector3(0.022 * s, L.y - 0.002, L.z - 0.006), new THREE.Vector3(0.026 * s, L.y - 0.01, L.z - 0.01)];
    g.add(new THREE.Mesh(ribbonStrip(pts, { w: (t) => 0.005 * (1 - 0.6 * t), normal: new THREE.Vector3(0, 0.6, 1), seg: 12 }), bm));
  }
  return g;
}

// ───────────────────────────── 唢呐匠 ─────────────────────────────

export function suonaHair(head) {
  const g = new THREE.Group();
  const line = hairlineFn([[0, 0.068], [0.6, 0.062], [0.95, 0.036], [1.12, 0.012], [1.35, 0.002], [1.6, -0.018], [2.1, -0.05], [3.15, -0.07]]);
  const cap = hairCap(head, {
    mask: (x, y, z, th) => sstep(line(th) - 0.003, line(th) + 0.003, y),
    thick: () => 0.0035,
    color: '#14100c', tip: '#2a221c', pole: [0, 1, 0.2], strands: 600, seed: 41, roughness: 0.55,
  });
  g.add(cap);
  // 髭须
  const tex = strandTexture('#15100c', { tip: '#2a1f18', lines: 50, seed: 33, tipFade: 0.4 });
  const m = hairMaterial(tex, { alpha: true, side: THREE.DoubleSide, roughness: 0.6 });
  const L = head.P.lips;
  for (const s of [1, -1]) {
    const pts = [new THREE.Vector3(0.001 * s, L.y + 0.011, L.z + 0.0045), new THREE.Vector3(0.012 * s, L.y + 0.009, L.z + 0.002), new THREE.Vector3(0.021 * s, L.y + 0.002, L.z - 0.004), new THREE.Vector3(0.025 * s, L.y - 0.006, L.z - 0.008)];
    g.add(new THREE.Mesh(ribbonStrip(pts, { w: (t) => 0.0075 * (1 - 0.55 * t), normal: new THREE.Vector3(0, 0.7, 1), seg: 14 }), m));
  }
  return g;
}
