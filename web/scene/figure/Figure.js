// 人物骨架：下身（静止：腿、凳、裙摆）+ 腰椎枢轴（上身）→ 颈枢轴 → 头。
// 手臂以两段 IK 连到乐器上由演奏逻辑驱动的手腕，袖子与前臂为每帧重建的动态管。
import * as THREE from 'three';
import { TubeMesh } from './Loft.js';

/** 在 parent 下建立以 p 为转轴的组：返回 { pivot, inner }，inner 内可直接用静止坐标建模。 */
export function pivotGroup(parent, p, name = 'pivot') {
  const pivot = new THREE.Group();
  pivot.name = name;
  pivot.position.copy(p);
  const inner = new THREE.Group();
  inner.position.copy(p).multiplyScalar(-1);
  pivot.add(inner);
  parent.add(pivot);
  return { pivot, inner };
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * 手臂：肩锚点（挂在上身）→ 肘（IK）→ 腕（乐器上的手）。
 * layers: [{ material, t0, t1, r: (t) => [rx, ry], drape: (t) => m, fold, foldK, rings, segs, end }]
 *   t 沿肩 → 腕 0..1（可略超出 1 盖住腕部）；r 为截面两半轴（x 轴随前臂向手的拇指侧扭转）。
 */
export class Arm {
  constructor(fig, side, o) {
    this.fig = fig;
    this.side = side; // 1 左、−1 右（人物坐标 +x 为左）
    this.hand = o.hand;
    this.L1 = o.upper;
    this.L2 = o.fore;
    this.pole = o.pole.clone().normalize();
    this.anchor = new THREE.Object3D();
    this.anchor.position.copy(o.shoulder);
    o.parent.add(this.anchor);
    this.S = new THREE.Vector3();
    this.E = new THREE.Vector3();
    this.W = new THREE.Vector3();
    this.hx = new THREE.Vector3();
    this.hz = new THREE.Vector3();
    this.curve = new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], false, 'centripetal');
    this.layers = o.layers.map((l, i) => {
      const tube = new TubeMesh(l.rings ?? 18, l.segs ?? 20, l.material, { name: `arm${side}_${i}`, fold: l.fold ?? 0, foldK: l.foldK ?? 7, seed: i * 1.7 + side });
      fig.root.add(tube.mesh);
      const frames = [];
      for (let r = 0; r <= tube.rings; r++) frames.push({ c: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), rx: 0, ry: 0, drape: 0, down: new THREE.Vector3() });
      return { ...l, tube, frames };
    });
    this.wristLift = o.wristLift ?? 0;
    this.stretch = 1;
  }

  // 两段 IK：肘在 pole 方向；够不到时肩前伸、再略伸长
  solve() {
    const { S, W, E } = this;
    const d = _v.subVectors(W, S);
    let dist = d.length();
    const reach = this.L1 + this.L2;
    if (dist > reach * 0.96) {
      const m = Math.min(0.035, dist - reach * 0.96);
      S.addScaledVector(d, m / dist);
      d.subVectors(W, S);
      dist = d.length();
    }
    let k = 1;
    if (dist > reach * 0.995) k = Math.min(1.18, dist / (reach * 0.995));
    this.stretch = k;
    const l1 = this.L1 * k;
    const l2 = this.L2 * k;
    const dir = d.divideScalar(dist || 1);
    const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const pd = this.pole.clone().addScaledVector(dir, -this.pole.dot(dir)).normalize();
    E.copy(S).addScaledVector(dir, a).addScaledVector(pd, h);
  }

  update() {
    const root = this.fig.root;
    this.anchor.getWorldPosition(this.S);
    root.worldToLocal(this.S);
    const hg = this.hand.group;
    hg.updateWorldMatrix(true, false);
    this.W.setFromMatrixPosition(hg.matrixWorld);
    root.worldToLocal(this.W);
    // 手的 x（拇指侧）与 z（指向）轴，换到人物坐标
    root.getWorldQuaternion(_q).invert();
    this.hx.setFromMatrixColumn(hg.matrixWorld, 0).applyQuaternion(_q).normalize();
    this.hz.setFromMatrixColumn(hg.matrixWorld, 2).applyQuaternion(_q).normalize();
    // 腕关节中心略在手掌根后方
    this.W.addScaledVector(this.hz, -0.012);
    this.solve();
    const { S, E, W } = this;
    // 路径：肩稍内 → 肩 → 肘 → 腕 → 腕外（供袖口延伸）
    const pts = this.curve.points;
    const lat = _v.set(this.side, 0, 0);
    pts[0].copy(S).addScaledVector(lat, -0.07).y -= 0.01;
    pts[1].copy(S);
    pts[2].copy(E);
    pts[3].copy(W);
    this.curve.updateArcLengths();
    const total = this.curve.getLength();
    const l0 = pts[0].distanceTo(pts[1]);
    const lW = total;
    // 肘处弯曲平面法线：上臂截面 x 轴参考
    const nb = new THREE.Vector3().subVectors(E, S).cross(new THREE.Vector3().subVectors(W, E));
    if (nb.lengthSq() < 1e-8) nb.copy(this.pole).cross(new THREE.Vector3().subVectors(W, S));
    nb.normalize();
    let hx = this.hx.clone();
    if (hx.dot(nb) < 0) hx.negate();
    const lElbow = l0 + S.distanceTo(E);
    const P = new THREE.Vector3();
    const T = new THREE.Vector3();
    for (const L of this.layers) {
      const R = L.tube.rings;
      for (let r = 0; r <= R; r++) {
        const t = L.t0 + (L.t1 - L.t0) * (r / R);
        // t：0 = 肩，1 = 腕；按肩→腕的实际弧长映射到曲线参数
        const arc = l0 + t * (lW - l0);
        const u = Math.min(1, Math.max(0, arc / total));
        if (t <= 1) {
          this.curve.getPointAt(u, P);
          this.curve.getTangentAt(u, T);
        } else {
          this.curve.getTangentAt(1, T);
          P.copy(W).addScaledVector(T, (t - 1) * (lW - l0));
        }
        const f = L.frames[r];
        f.c.copy(P);
        // 截面轴：上臂取弯曲平面法线，前臂逐渐扭向手的拇指侧
        const w = smooth(lElbow, lW, arc);
        const ax = nb.clone().lerp(hx, w);
        ax.addScaledVector(T, -ax.dot(T));
        if (ax.lengthSq() < 1e-8) ax.set(1, 0, 0).addScaledVector(T, -T.x);
        ax.normalize();
        f.x.copy(ax);
        f.y.crossVectors(T, ax).normalize();
        const [rx, ry] = L.r(t, this);
        f.rx = rx;
        f.ry = ry;
        f.drape = L.drape ? L.drape(t, this) : 0;
        f.down.copy(DOWN).addScaledVector(T, -DOWN.dot(T));
        if (f.down.lengthSq() > 1e-6) f.down.normalize();
        f.foldAmt = L.foldAmt ? L.foldAmt(t) : 1;
      }
      L.tube.update(L.frames);
    }
  }
}

/** 人物基类：root 放在乐器组坐标系中；spine / neck / head 为逐级枢轴。 */
export class Figure {
  constructor(name) {
    this.root = new THREE.Group();
    this.root.name = name;
    this.lower = new THREE.Group();
    this.lower.name = 'lower';
    this.root.add(this.lower);
    this.arms = [];
    this.t = 0;
  }

  /** 建立腰、颈、头三级枢轴（静止坐标）。 */
  skeleton({ waist, neck, head, headPitch = 0 }) {
    const s = pivotGroup(this.root, waist, 'spine');
    this.spine = s.pivot;
    this.chest = s.inner;
    const n = pivotGroup(this.chest, neck, 'neck');
    this.neck = n.pivot;
    this.neckInner = n.inner;
    this.headHolder = new THREE.Group();
    this.headHolder.position.copy(head);
    this.headHolder.rotation.x = headPitch;
    this.neckInner.add(this.headHolder);
  }

  addArm(side, o) {
    const arm = new Arm(this, side, { parent: this.chest, ...o });
    this.arms.push(arm);
    return arm;
  }

  updateArms() {
    this.root.updateMatrixWorld(true);
    for (const a of this.arms) a.update();
  }
}

/** 标准手臂层：内衬袖、外袖（可宽袖下垂）、前臂皮肤。 */
export function armLayers({ skin, sleeve, inner, cuffAt = 0.86, sleeveR = [0.058, 0.05], cuffR = [0.06, 0.055], drape = 0, fold = 0.04, innerCuff = 0.93, wrist = [0.028, 0.019], fore = [0.036, 0.032] }) {
  const lerp = (a, b, t) => a + (b - a) * t;
  const layers = [
    // 前臂（肘下至腕），腕端与手的腕部椭球衔接
    {
      material: skin, t0: 0.5, t1: 1.02, rings: 12, segs: 16,
      r: (t) => {
        const u = smooth(0.5, 1.0, t);
        return [lerp(fore[0], wrist[0], u), lerp(fore[1], wrist[1], u)];
      },
    },
  ];
  if (inner) {
    layers.push({
      material: inner, t0: -0.02, t1: innerCuff, rings: 16, segs: 18, fold: 0.03,
      r: (t) => [lerp(0.05, fore[0] + 0.006, smooth(0.2, 0.9, t)), lerp(0.046, fore[1] + 0.006, smooth(0.2, 0.9, t))],
    });
  }
  layers.push({
    material: sleeve, t0: -0.04, t1: cuffAt, rings: 22, segs: 24, fold, foldK: 6,
    r: (t) => {
      const u = smooth(0.0, 1.0, t / cuffAt);
      return [lerp(sleeveR[0], cuffR[0], u), lerp(sleeveR[1], cuffR[1], u)];
    },
    drape: drape ? (t) => drape * smooth(0.15, cuffAt, t) : null,
    foldAmt: (t) => 0.4 + t,
  });
  return layers;
}
