// 程序化手：掌 + 五指（各三节关节），前臂与袖口淡出。
// 局部坐标：腕部为原点，手指沿 +Z 伸出，掌心朝 −Y；右手拇指在 +X 侧，左手用镜像（scale.x = −1）。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// 名称顺序：0 拇指 1 食指 2 中指 3 无名指 4 小指
export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

const SPEC = [
  { base: [0.027, -0.008, 0.02], lens: [0.04, 0.031, 0.026], r: 0.0105, rot: [0.42, 0.72, -1.05] },
  { base: [0.026, 0.001, 0.087], lens: [0.041, 0.025, 0.02], r: 0.0086, rot: [0, 0.05, 0] },
  { base: [0.008, 0.002, 0.091], lens: [0.046, 0.028, 0.021], r: 0.0089, rot: [0, 0, 0] },
  { base: [-0.01, 0.001, 0.088], lens: [0.043, 0.027, 0.02], r: 0.0083, rot: [0, -0.05, 0] },
  { base: [-0.027, -0.002, 0.08], lens: [0.034, 0.021, 0.018], r: 0.0072, rot: [0, -0.12, 0] },
];
// 屈曲在三个关节上的分配
const FLEX_SHARE = [[0.35, 0.55, 0.5], [0.8, 1.05, 0.62], [0.8, 1.05, 0.62], [0.82, 1.08, 0.64], [0.85, 1.1, 0.66]];

// 渐细的指节：两端为球面（相邻指节在关节处重叠成自然的指节隆起），沿 +Z 从 0 延伸到 len
function segmentZ(r0, r1, len) {
  const pts = [];
  const N = 6;
  for (let i = 0; i <= N; i++) {
    const a = -Math.PI / 2 + (i / N) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r0, Math.sin(a) * r0));
  }
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-5, Math.cos(a) * r1), len + Math.sin(a) * r1));
  }
  const g = new THREE.LatheGeometry(pts, 14);
  g.rotateX(Math.PI / 2);
  g.scale(1.07, 0.9, 1); // 手指截面略扁
  return g;
}

/** o.skin / o.sheen / o.nail：各人物的肤色（与面部贴图同色）。 */
export function createHandMaterials(tex, o = {}) {
  const skin = new THREE.MeshPhysicalMaterial({
    color: o.skin ?? 0xcfa283, roughness: 0.55, metalness: 0, sheen: 0.35, sheenColor: new THREE.Color(o.sheen ?? 0xffa890), sheenRoughness: 0.55,
    clearcoat: 0.06, clearcoatRoughness: 0.6, envMapIntensity: 0.7,
  });
  const nail = new THREE.MeshPhysicalMaterial({ color: o.nail ?? 0xf0c8b8, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const arm = skin.clone();
  arm.transparent = true;
  arm.vertexColors = true; // 前臂用顶点 alpha 向肘部淡出
  arm.depthWrite = false;
  const sleeve = new THREE.MeshPhysicalMaterial({
    color: 0x6a1a14, roughness: 0.6, sheen: 1, sheenColor: new THREE.Color(0xe0a060), sheenRoughness: 0.35,
    side: THREE.DoubleSide, transparent: true, alphaMap: tex.fade, depthWrite: false,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0xd4a24c, roughness: 0.35, metalness: 1, transparent: true });
  const pick = new THREE.MeshPhysicalMaterial({ color: 0x7a4a22, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, transmission: 0.2, thickness: 0.002 });
  const tape = new THREE.MeshStandardMaterial({ color: 0xf0e6d6, roughness: 0.8 });
  return { skin, nail, arm, sleeve, trim, pick, tape };
}

export class Hand {
  /**
   * @param {'right'|'left'} side
   * @param {object} mats createHandMaterials 的返回值
   * @param {object} o { picks: 佩戴古筝义甲, sleeve: 显示袖口, scale, forearm: false 时不画渐隐前臂（由人物手臂接上） }
   */
  constructor(side, mats, o = {}) {
    this.side = side;
    this.group = new THREE.Group();
    this.group.name = `${side}Hand`;
    // 镜像节点：左手 scale.x = −1，外部只需设置 group 的位置与朝向
    this.mirror = new THREE.Group();
    if (side === 'left') this.mirror.scale.x = -1;
    this.mirror.scale.multiplyScalar(o.scale ?? 1);
    this.group.add(this.mirror);

    // 掌：圆角盒，腕端收窄、掌背微拱
    const palmGeo = new RoundedBoxGeometry(0.08, 0.029, 0.094, 4, 0.012);
    const p = palmGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      const t = (z + 0.047) / 0.094;
      p.setX(i, p.getX(i) * (0.8 + 0.2 * t));
      p.setY(i, p.getY(i) + (p.getY(i) > 0 ? 0.003 * Math.sin(Math.PI * t) : 0) - 0.0015 * Math.pow(p.getX(i) / 0.039, 2));
    }
    palmGeo.computeVertexNormals();
    palmGeo.translate(0, 0, 0.047);
    const palm = new THREE.Mesh(palmGeo, mats.skin);
    palm.castShadow = true;
    this.mirror.add(palm);
    // 拇指根部鱼际肌
    const thenar = new THREE.Mesh(new THREE.SphereGeometry(0.02, 16, 12), mats.skin);
    thenar.scale.set(0.9, 0.62, 1.45);
    thenar.position.set(0.021, -0.006, 0.033);
    thenar.castShadow = true;
    this.mirror.add(thenar);

    this.fingers = SPEC.map((s, fi) => {
      const root = new THREE.Group();
      root.position.set(...s.base);
      root.rotation.set(s.rot[0], s.rot[1], s.rot[2], 'YXZ');
      this.mirror.add(root);
      const joints = [];
      let parent = root;
      let r = s.r;
      s.lens.forEach((len, k) => {
        const j = new THREE.Group();
        if (k > 0) j.position.z = s.lens[k - 1];
        parent.add(j);
        const r1 = r * (k < 2 ? 0.92 : 0.86);
        const seg = new THREE.Mesh(segmentZ(r, r1, k < 2 ? len : len - r1 * 0.55), mats.skin);
        seg.castShadow = true;
        j.add(seg);
        joints.push(j);
        parent = j;
        if (k < 2) r = r1;
      });
      // 指甲
      const tipLen = s.lens[2];
      const nail = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mats.nail);
      nail.scale.set(r * 0.78, r * 0.22, tipLen * 0.36);
      nail.position.set(0, r * 0.82, tipLen * 0.66);
      nail.rotation.x = -0.08;
      joints[2].add(nail);
      // 古筝义甲：玳瑁片贴在指腹一侧，胶布缠绕
      if (o.picks && fi <= 3) {
        const pk = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8), mats.pick);
        pk.scale.set(r * 0.95, r * 0.18, tipLen * 0.62);
        pk.position.set(0, -r * 0.9, tipLen * 0.72);
        pk.rotation.x = 0.12;
        joints[2].add(pk);
        const tp = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, r * 0.28, 6, 16), mats.tape);
        tp.position.set(0, 0, tipLen * 0.45);
        tp.scale.set(1, 1, 1.4);
        joints[2].add(tp);
      }
      return { joints, lens: s.lens, r, root, pick: !!(o.picks && fi <= 3), flex: 0, spread: 0 };
    });

    // 前臂与袖口（沿 −Z 延伸并淡出）；接人物时由人物提供前臂
    if (o.forearm !== false) this.#stubArm(mats, o);
    const wrist = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), mats.skin);
    wrist.scale.set(0.98, 0.5, 0.7);
    wrist.position.set(0, -0.001, 0.004);
    wrist.castShadow = true;
    this.mirror.add(wrist);

    this._v = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._x = new THREE.Vector3();
    this._y = new THREE.Vector3();
    this._z = new THREE.Vector3();
  }

  #stubArm(mats, o) {
    const armGeo = new THREE.CylinderGeometry(0.026, 0.031, 0.17, 20, 1, true);
    armGeo.rotateX(-Math.PI / 2);
    armGeo.scale(1.15, 0.66, 1);
    armGeo.translate(0, -0.001, -0.075);
    const ap = armGeo.attributes.position;
    const col = new Float32Array(ap.count * 4);
    for (let i = 0; i < ap.count; i++) {
      const t = Math.min(1, Math.max(0, (ap.getZ(i) + 0.16) / 0.13));
      col.set([1, 1, 1, t * t * (3 - 2 * t)], i * 4);
    }
    armGeo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    const arm = new THREE.Mesh(armGeo, mats.arm);
    arm.renderOrder = 2;
    this.mirror.add(arm);
    if (o.sleeve) {
      const slGeo = new THREE.CylinderGeometry(0.05, 0.068, 0.2, 28, 1, true);
      slGeo.rotateX(-Math.PI / 2);
      slGeo.scale(1.15, 0.95, 1);
      slGeo.translate(0, -0.004, -0.2);
      const sl = new THREE.Mesh(slGeo, mats.sleeve);
      sl.renderOrder = 3;
      this.mirror.add(sl);
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.0035, 6, 32), mats.trim);
      cuff.scale.set(1.15, 0.95, 1);
      cuff.position.set(0, -0.004, -0.1);
      this.mirror.add(cuff);
    }
  }

  /** 屈曲 flex（弧度，约 0 伸直 ~ 1.6 握拳），spread 为侧向张开。 */
  setFinger(i, flex, spread = 0) {
    const f = this.fingers[i];
    const sh = FLEX_SHARE[i];
    f.flex = flex;
    f.spread = spread;
    for (let k = 0; k < 3; k++) f.joints[k].rotation.x = flex * sh[k];
    f.joints[0].rotation.y = spread;
  }

  /** 五指一起设置：[[flex, spread], ...] 或数字（仅屈曲）。 */
  pose(arr) {
    arr.forEach((v, i) => (Array.isArray(v) ? this.setFinger(i, v[0], v[1] || 0) : this.setFinger(i, v, 0)));
  }

  /** 手的朝向：手指方向 fingerDir、掌心朝向 palmDir（均为世界坐标，需大致正交）。 */
  orient(fingerDir, palmDir) {
    const z = this._z.copy(fingerDir).normalize();
    const y = this._y.copy(palmDir).multiplyScalar(-1);
    y.addScaledVector(z, -y.dot(z)).normalize();
    const x = this._x.crossVectors(y, z);
    this._m.makeBasis(x, y, z);
    this.group.quaternion.setFromRotationMatrix(this._m);
  }

  /** 指尖（指腹或义甲尖）在 hand.group 的父坐标系中的位置。 */
  tipLocal(i, out = new THREE.Vector3(), pad = true) {
    const f = this.fingers[i];
    const len = f.lens[2];
    if (f.pick) out.set(0, -f.r * 1.0, len * 1.05);
    else if (pad) out.set(0, -f.r * 0.62, len * 0.72);
    else out.set(0, 0, len + f.r * 0.4);
    // 先刷新父链的世界矩阵，否则与下面 worldToLocal（会自行刷新父链）不一致
    if (this.group.parent) this.group.parent.updateWorldMatrix(true, false);
    this.group.updateMatrixWorld(true);
    out.applyMatrix4(f.joints[2].matrixWorld);
    if (this.group.parent) this.group.parent.worldToLocal(out);
    return out;
  }

  /** 平移整只手，使第 i 指的指尖落在 target（父坐标系）。 */
  placeTip(i, target, pad = true) {
    const tip = this.tipLocal(i, this._v, pad);
    this.group.position.add(target).sub(tip);
  }
}
