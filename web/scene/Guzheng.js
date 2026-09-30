// 古筝：拱形桐木面板、红木侧板、前后岳山、21 个雁柱与 21 根弦、筝架；
// 右手戴义甲在岳山与雁柱之间拨弦（托、抹、勾、摇指、刮奏），左手在雁柱左侧按弦（按音、揉弦）。
import * as THREE from 'three';
import { VibString } from './VibString.js';
import { Hand } from './Hand.js';
import { clamp, lerp, smooth, easeInOut, lastStarted, OnsetTracker } from './anim.js';
import { mergeStatic } from './merge.js';

const L = 1.63;
const X_HEAD = 0.815;
const X_TAIL = -0.815;
const X_FY = 0.672; // 前岳山
const X_RY = -0.652; // 后岳山
const N = 21;
export const GUZHENG_BODY_Y = 0.58; // 琴底离台面高度

const halfWidth = (x) => lerp(0.136, 0.166, (x - X_TAIL) / L);
const sideH = (x) => lerp(0.06, 0.076, (x - X_TAIL) / L);
function topY(x, z) {
  const w = clamp(z / halfWidth(x), -1, 1);
  const u = clamp((x - X_TAIL) / L, 0, 1);
  return sideH(x) + 0.028 * (1 - w * w) + 0.012 * Math.sin(Math.PI * u);
}
const zFront = (i) => lerp(-0.126, 0.126, i / (N - 1));
const zRear = (i) => lerp(-0.108, 0.108, i / (N - 1));
const zAt = (i, x) => lerp(zRear(i), zFront(i), (x - X_RY) / (X_FY - X_RY));
const bridgeX = (i) => X_FY - (0.24 + 0.78 * Math.pow(1 - i / (N - 1), 1.2));
const pluckX = (i) => X_FY - Math.min(0.115, (X_FY - bridgeX(i)) * 0.4);

// 把一个盒子“披”在拱形面板上（底面贴合 topY）
function drapedBox(x, wx, h, z0, z1, segZ = 24, lift = 0) {
  const g = new THREE.BoxGeometry(wx, h, z1 - z0, 2, 1, segZ);
  g.translate(x, h / 2, (z0 + z1) / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + topY(p.getX(i), p.getZ(i)) + lift);
  g.computeVertexNormals();
  return g;
}

export class Guzheng {
  /** opts.hand：传给两只手的选项（缩放、是否画渐隐前臂）。 */
  constructor(scene, tex, handMats, effects, opts = {}) {
    this.effects = effects;
    this.group = new THREE.Group();
    this.group.name = 'guzheng';
    scene.add(this.group);
    this.body = new THREE.Group();
    this.group.add(this.body);
    this.body.position.y = GUZHENG_BODY_Y;

    this.#buildBody(tex);
    this.#buildStand(tex);
    this.#buildStrings();

    this.right = new Hand('right', handMats, { picks: true, ...opts.hand });
    this.left = new Hand('left', handMats, opts.hand);
    this.body.add(this.right.group, this.left.group);
    this.right.orient(new THREE.Vector3(-0.28, -0.62, -1), new THREE.Vector3(-0.1, -1, 0.35));
    this.left.orient(new THREE.Vector3(0.18, -0.7, -1), new THREE.Vector3(0.05, -1, 0.4));
    this.rightRest = new THREE.Vector3(0.52, 0.2, 0.2);
    this.leftRest = new THREE.Vector3(-0.08, 0.2, 0.18);
    this.#computeRests();

    this.onsets = new OnsetTracker();
    this.amps = new Float32Array(N);
    this.liveNotes = [];
    this.livePress = null;
    this.focus = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
  }

  // ───────────────────────────── 建模 ─────────────────────────────

  #buildBody(tex) {
    const NX = 96;
    const NZ = 26;
    // 面板
    const pos = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i <= NX; i++) {
      const x = lerp(X_TAIL, X_HEAD, i / NX);
      const hw = halfWidth(x);
      for (let j = 0; j <= NZ; j++) {
        const z = lerp(-hw, hw, j / NZ);
        pos.push(x, topY(x, z), z);
        uv.push(i / NX, 1 - j / NZ);
      }
    }
    for (let i = 0; i < NX; i++) {
      for (let j = 0; j < NZ; j++) {
        const a = i * (NZ + 1) + j;
        const b = a + NZ + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const topGeo = new THREE.BufferGeometry();
    topGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    topGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    topGeo.setIndex(idx);
    topGeo.computeVertexNormals();
    const topMat = new THREE.MeshPhysicalMaterial({
      map: tex.guzhengTop.map, roughnessMap: tex.guzhengTop.roughnessMap, bumpMap: tex.guzhengTop.bumpMap, bumpScale: 0.3,
      roughness: 1, clearcoat: 0.55, clearcoatRoughness: 0.22, envMapIntensity: 0.8,
    });
    const top = new THREE.Mesh(topGeo, topMat);
    top.receiveShadow = true;
    top.castShadow = true;
    this.body.add(top);
    this.topMesh = top;

    // 侧板（两长边）
    const sideMat = new THREE.MeshPhysicalMaterial({
      map: tex.guzhengSide, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15, envMapIntensity: 0.9,
    });
    for (const s of [-1, 1]) {
      const p = [];
      const u = [];
      const id = [];
      for (let i = 0; i <= NX; i++) {
        const x = lerp(X_TAIL, X_HEAD, i / NX);
        const z = s * halfWidth(x);
        p.push(x, 0, z, x, topY(x, z), z);
        u.push(i / NX, 0, i / NX, 1);
      }
      for (let i = 0; i < NX; i++) {
        const a = i * 2;
        if (s > 0) id.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        else id.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
      g.setIndex(id);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, sideMat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.body.add(m);
    }

    // 两端封板（红木）与底板
    const rose = new THREE.MeshPhysicalMaterial({
      map: tex.rosewood.map, roughnessMap: tex.rosewood.roughnessMap, bumpMap: tex.rosewood.bumpMap, bumpScale: 0.3,
      roughness: 1, clearcoat: 0.85, clearcoatRoughness: 0.12,
    });
    this.rose = rose;
    const cap = new THREE.Group();
    for (const x of [X_TAIL, X_HEAD]) {
      const hw = halfWidth(x);
      const p = [x, 0, 0];
      const K = 20;
      p.push(x, 0, -hw);
      for (let k = 0; k <= K; k++) {
        const z = lerp(-hw, hw, k / K);
        p.push(x, topY(x, z), z);
      }
      p.push(x, 0, hw);
      const id = [];
      const n = p.length / 3;
      for (let k = 1; k < n - 1; k++) {
        if (x > 0) id.push(0, k, k + 1);
        else id.push(0, k + 1, k);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      const uvs = [];
      for (let k = 0; k < n; k++) uvs.push((p[k * 3 + 2] + 0.2) * 2, p[k * 3 + 1] * 4);
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(id);
      g.computeVertexNormals();
      cap.add(new THREE.Mesh(g, rose));
    }
    const bottom = new THREE.Mesh(new THREE.PlaneGeometry(L, 0.3), new THREE.MeshStandardMaterial({ color: 0x1a0d08, roughness: 0.8 }));
    bottom.rotation.x = Math.PI / 2;
    bottom.position.y = 0.001;
    cap.add(bottom);

    // 面板长边的红木压边
    for (const s of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const x = lerp(X_TAIL + 0.004, X_HEAD - 0.004, i / 40);
        const z = s * (halfWidth(x) - 0.002);
        pts.push(new THREE.Vector3(x, topY(x, z) - 0.001, z));
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.0055, 8, false), rose);
      tube.castShadow = true;
      cap.add(tube);
    }

    // 前岳山、后岳山（红木 + 骨质弦枕），琴尾弦钉盒
    const bone = new THREE.MeshStandardMaterial({ color: 0xefe4cc, roughness: 0.35 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd0a050, roughness: 0.3, metalness: 1 });
    this.gold = gold;
    const hwF = halfWidth(X_FY) - 0.008;
    const hwR = halfWidth(X_RY) - 0.008;
    cap.add(new THREE.Mesh(drapedBox(X_FY, 0.03, 0.0155, -hwF, hwF), rose));
    cap.add(new THREE.Mesh(drapedBox(X_FY, 0.008, 0.0035, -hwF + 0.004, hwF - 0.004, 24, 0.0155), bone));
    cap.add(new THREE.Mesh(drapedBox(X_RY, 0.032, 0.0175, -hwR, hwR), rose));
    cap.add(new THREE.Mesh(drapedBox(X_RY, 0.008, 0.0035, -hwR + 0.004, hwR - 0.004, 24, 0.0175), bone));
    const hwT = halfWidth(-0.75) - 0.01;
    cap.add(new THREE.Mesh(drapedBox(-0.748, 0.118, 0.03, -hwT, hwT), rose));
    cap.add(new THREE.Mesh(drapedBox(-0.748, 0.122, 0.004, -hwT - 0.002, hwT + 0.002, 24, 0.03), gold));
    cap.add(new THREE.Mesh(drapedBox(-0.69, 0.006, 0.026, -hwT, hwT, 24, 0.002), gold));

    // 雁柱：人字形，两足横跨，顶端骨枕承弦
    const shape = new THREE.Shape();
    shape.moveTo(-0.0125, 0);
    shape.lineTo(-0.0078, 0);
    shape.quadraticCurveTo(0, 0.013, 0.0078, 0);
    shape.lineTo(0.0125, 0);
    shape.quadraticCurveTo(0.004, 0.012, 0.0026, 0.0275);
    shape.lineTo(-0.0026, 0.0275);
    shape.quadraticCurveTo(-0.004, 0.012, -0.0125, 0);
    const bGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.0065, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0006, bevelSegments: 2, curveSegments: 6 });
    bGeo.translate(0, 0, -0.00325);
    bGeo.rotateY(Math.PI / 2);
    const capGeo = new THREE.BoxGeometry(0.0072, 0.0026, 0.0056);
    const bridgeMat = new THREE.MeshPhysicalMaterial({ color: 0x6b2a1a, roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.1 });
    const bridges = new THREE.Group();
    this.bridgeTops = [];
    for (let i = 0; i < N; i++) {
      const x = bridgeX(i);
      const z = zAt(i, x);
      const y = topY(x, z);
      const b = new THREE.Mesh(bGeo, bridgeMat);
      b.position.set(x, y, z);
      b.castShadow = true;
      bridges.add(b);
      const c = new THREE.Mesh(capGeo, bone);
      c.position.set(x, y + 0.0285, z);
      bridges.add(c);
      this.bridgeTops.push(new THREE.Vector3(x, y + 0.03, z));
    }
    // 琴头弦孔骨扣
    const btnGeo = new THREE.SphereGeometry(0.0034, 10, 8);
    this.headAnchors = [];
    for (let i = 0; i < N; i++) {
      const x = 0.745;
      const z = lerp(-0.13, 0.13, i / (N - 1));
      const y = topY(x, z);
      const m = new THREE.Mesh(btnGeo, bone);
      m.position.set(x, y + 0.001, z);
      m.scale.y = 0.5;
      bridges.add(m);
      this.headAnchors.push(new THREE.Vector3(x, y + 0.002, z));
    }
    this.body.add(cap, bridges);
    mergeStatic(cap);
    mergeStatic(bridges);
  }

  #buildStand() {
    const g = new THREE.Group();
    const m = this.rose;
    const H = GUZHENG_BODY_Y;
    for (const x of [-0.5, 0.48]) {
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.36), m);
      top.position.set(x, H - 0.015, 0);
      g.add(top);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.42), m);
      foot.position.set(x, 0.015, 0);
      g.add(foot);
      // 交叉的两条腿
      for (const s of [-1, 1]) {
        const a = new THREE.Vector3(x + s * 0.012, H - 0.03, -0.15 * s);
        const b = new THREE.Vector3(x + s * 0.012, 0.03, 0.16 * s);
        const d = new THREE.Vector3().subVectors(b, a);
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.022, d.length(), 0.034), m);
        leg.position.copy(a).addScaledVector(d, 0.5);
        leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
        g.add(leg);
      }
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 12), this.gold);
      pin.rotation.z = Math.PI / 2;
      pin.position.set(x, H / 2 + 0.005, 0);
      g.add(pin);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    mergeStatic(g);
    this.group.add(g);
  }

  #buildStrings() {
    this.rightSeg = [];
    this.leftSeg = [];
    this.pickables = [];
    this.pluckPoints = [];
    this.pressFrac = [];
    const pickMat = new THREE.MeshBasicMaterial({ visible: false });
    const tails = new THREE.Group();
    const tailPos = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const radius = lerp(0.00095, 0.00042, t);
      const isSol = i % 5 === 3; // 每组的 5（A）用绿弦标记
      const color = isSol ? 0x5fae78 : i < 5 ? 0xd9c49a : 0xe6e2da;
      const zf = zFront(i);
      const zr = zRear(i);
      const front = new THREE.Vector3(X_FY, topY(X_FY, zf) + 0.019, zf);
      const bridge = this.bridgeTops[i];
      const rear = new THREE.Vector3(X_RY, topY(X_RY, zr) + 0.021, zr);
      const maxAmp = lerp(0.0034, 0.0013, t);
      const R = new VibString({ radius, color, metal: i < 5, maxAmp, glow: isSol ? new THREE.Color(0.55, 1.0, 0.6) : undefined }).addTo(this.body);
      R.set(bridge, front);
      const Lg = new VibString({ radius, color, metal: i < 5, maxAmp: maxAmp * 0.5 }).addTo(this.body);
      Lg.set(rear, bridge);
      this.rightSeg.push(R);
      this.leftSeg.push(Lg);
      // 两端延伸到琴头骨扣与琴尾
      const ha = this.headAnchors[i];
      tailPos.push(front.x, front.y, front.z, ha.x, ha.y, ha.z);
      const pinX = -0.689;
      tailPos.push(rear.x, rear.y, rear.z, pinX, topY(pinX, zr) + 0.013, zr * 0.98);
      // 拨弦点
      const px = pluckX(i);
      const s = (px - bridge.x) / (front.x - bridge.x);
      this.pluckPoints.push(R.pointAt(s));
      // 按弦点：雁柱左侧约 10 厘米
      this.pressFrac.push(1 - 0.1 / (bridge.x - rear.x));
      // 拾取体
      for (const [seg, a, b] of [['R', bridge, front], ['L', rear, bridge]]) {
        const d = new THREE.Vector3().subVectors(b, a);
        const box = new THREE.Mesh(new THREE.BoxGeometry(d.length(), 0.03, 0.0115), pickMat);
        box.position.copy(a).addScaledVector(d, 0.5);
        box.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.normalize());
        box.userData = { inst: 'guzheng', string: i, seg };
        this.body.add(box);
        this.pickables.push(box);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(tailPos, 3));
    tails.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x7d766a })));
    this.body.add(tails);
  }

  // ───────────────────────────── 演奏 ─────────────────────────────

  // 放置手的朝向后求“接触姿态”下指尖落在拨弦点时手腕的位置
  #contactPose(hand, f, side) {
    if (side === 'R') {
      hand.pose([[0.25, 0.12], 0.8, 0.95, 1.2, 1.35]);
      if (f === 0) hand.setFinger(0, 0.1, 0.2);
      else hand.setFinger(f, 0.95, 0);
      if (f !== 1) hand.setFinger(1, 0.55, 0);
      if (f === 2) hand.setFinger(1, 0.35, 0.05);
    } else {
      hand.pose([[0.2, 0.2], 0.55, 0.62, 0.95, 1.1]);
    }
  }

  #rootFor(hand, f, target, side) {
    this.#contactPose(hand, f, side);
    hand.group.position.set(0, 0, 0);
    hand.placeTip(f, target);
    return hand.group.position.clone();
  }

  #computeRests() {
    this.#contactPose(this.right, 1, 'R');
    this.right.group.position.copy(this.rightRest);
    this.#contactPose(this.left, 2, 'L');
    this.left.group.position.copy(this.leftRest);
    // 每根弦的拨弦根位置按手指缓存
    this.rootCache = [0, 1, 2].map((f) => this.pluckPoints.map((p) => this.#rootFor(this.right, f, p.clone().add(new THREE.Vector3(0, 0.0015, 0)), 'R')));
    this.pressCache = this.leftSeg.map((s, i) => this.#rootFor(this.left, 2, s.pointAt(this.pressFrac[i]).add(new THREE.Vector3(0, 0.001, 0)), 'L'));
    const mid = this.rootCache[1][10];
    this.rightRest.copy(mid).add(new THREE.Vector3(0.02, 0.05, 0.03));
    this.leftRest.copy(this.pressCache[12]).add(new THREE.Vector3(0.0, 0.05, 0.02));
  }

  /** 为音符指定手指与方向（托 / 抹 / 勾）。 */
  prepare(notes) {
    let prev = null;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      this.#assign(n, prev, notes, i);
      prev = n;
    }
    this.pressNotes = notes.filter((n) => n.pr || n.vib);
  }

  #assign(n, prev, notes, i) {
    if (n.tr) { n._f = 0; return; }
    if (n.k === 'chord' && notes) {
      // 同一和弦：低音勾（中指）、高音托（拇指）、中间抹（食指）
      const group = [];
      for (let k = i - 3; k <= i + 3; k++) if (notes[k] && notes[k].k === 'chord' && Math.abs(notes[k].t - n.t) < 0.04) group.push(notes[k]);
      group.sort((a, b) => a.s - b.s);
      const r = group.indexOf(n);
      n._f = r === group.length - 1 ? 0 : r === 0 ? 2 : 1;
      n._chord = group;
      return;
    }
    if (prev && n.t - prev.t < 0.35 && prev.s !== n.s) n._f = n.s > prev.s ? 1 : 0;
    else n._f = n.s >= 11 ? 0 : n.s < 6 ? 2 : 1;
  }

  pluckLive(string, vel, time) {
    const n = { t: time, d: 3, s: string, v: vel, k: 'note' };
    this.#assign(n, this.liveNotes[this.liveNotes.length - 1] || null);
    this.liveNotes.push(n);
    if (this.liveNotes.length > 400) this.liveNotes.splice(0, 200);
  }

  pressLive(string, on, time) {
    if (on) this.livePress = { s: string, t: time, pr: true, d: 1e9 };
    else if (this.livePress) this.livePress.d = time - this.livePress.t;
  }

  releaseLive(time) {
    for (const n of this.liveNotes) if (n.t + n.d > time) n.d = Math.max(0.05, time - n.t) + 0.08;
    if (this.livePress) this.livePress.d = Math.min(this.livePress.d, time - this.livePress.t);
  }

  #ampOf(n, tau) {
    const t = n.s / (N - 1);
    const A = lerp(0.0034, 0.0013, t) * (0.35 + 0.65 * n.v);
    if (tau < 0) return 0;
    if (n.tr && tau < n.d) return A * 0.75 * (0.8 + 0.2 * Math.sin(tau * 60));
    if (n._damped !== undefined && tau > n._damped) return 0;
    const T = lerp(1.9, 0.55, t);
    let a = A * Math.exp(-tau / T) * Math.min(1, tau / 0.004 + 0.2);
    if (n.st && tau > 0.22) a *= Math.exp(-(tau - 0.22) * 25);
    if (n.tr) a = A * 0.75 * Math.exp(-(tau - n.d) / T);
    return a;
  }

  /**
   * @param {number} dt
   * @param {{notes: object[], time: number, live: boolean}} src
   */
  update(dt, src) {
    const { notes, time } = src;
    this.body.updateMatrixWorld(true);
    // 起音特效
    this.onsets.update(notes, time, (n) => {
      const p = this.body.localToWorld(this.pluckPoints[n.s].clone());
      const v = n.v ?? 0.6;
      if (n.k !== 'sweep' || Math.random() < 0.35) {
        this.effects.ripple(p, 0.03 + 0.03 * v, v, src.clock, 0, new THREE.Vector3(0, 1, 0), null, 0.7);
      }
      this.effects.sparks(p, new THREE.Vector3(0, 1, 0), v * 0.6, 3, 0.12);
    });

    // 弦振幅
    this.amps.fill(0);
    const i0 = lastStarted(notes, time);
    for (let k = i0; k >= 0 && notes[k].t > time - 4; k--) {
      const n = notes[k];
      const a = this.#ampOf(n, time - n.t);
      if (a > this.amps[n.s]) this.amps[n.s] = a;
    }

    // ── 右手 ──
    const R = this.right;
    const cur = i0 >= 0 ? notes[i0] : null;
    let next = notes[i0 + 1] || null;
    let root = this._v;
    let active = null;
    let tau = 99;
    let rootCur = null;
    if (cur) {
      // 和弦由拇指音定位
      const lead = cur._chord ? cur._chord[cur._chord.length - 1] : cur;
      rootCur = this.rootCache[lead._f][lead.s];
      active = cur;
      tau = time - cur.t;
    }
    if (next && next._chord) next = next._chord[next._chord.length - 1];
    const rootNext = next ? this.rootCache[next._f][next.s] : null;
    if (!cur && !next) root.copy(this.rightRest);
    else if (!cur) {
      const w = easeInOut(smooth(next.t - 0.6, next.t - 0.05, time));
      root.copy(this.rightRest).lerp(rootNext, w);
    } else {
      root.copy(rootCur);
      const end = cur.t + (cur.tr ? cur.d : 0.25);
      if (next && next.t - time < 0.6) {
        const gap = next.t - cur.t;
        const Tm = Math.min(0.16, gap * 0.75);
        const w = easeInOut(clamp((time - (next.t - Tm)) / Tm, 0, 1));
        if (w > 0) {
          root.lerp(rootNext, w);
          if (gap > 0.14) root.y += 0.012 * Math.sin(Math.PI * w);
        }
      } else if (time > end + 0.6) {
        root.lerp(this.rightRest, easeInOut(smooth(end + 0.6, end + 1.6, time)));
      }
    }
    // 拨弦动作：接触 → 穿过 → 回位
    const f = active ? active._f : 1;
    const dir = f === 0 ? -1 : 1; // 托：向外；抹、勾：向内
    this.#contactPose(R, f, 'R');
    let push = 0;
    if (active && tau < 0.4) {
      if (active.tr && tau < active.d) {
        push = 0.0035 * Math.sin(tau * 2 * Math.PI * 8.5);
        R.setFinger(0, 0.1 + 0.08 * Math.sin(tau * 2 * Math.PI * 8.5), 0.2);
      } else {
        const stroke = smooth(0, 0.045, tau) * (1 - smooth(0.06, 0.4, tau));
        push = dir * 0.009 * stroke;
        if (f === 0) R.setFinger(0, 0.1 - 0.25 * stroke, 0.2 + 0.2 * stroke);
        else R.setFinger(f, 0.95 + 0.55 * stroke, 0);
        if (active._chord) {
          for (const c of active._chord) if (c._f !== f) R.setFinger(c._f, (c._f === 0 ? 0.1 : 0.95) + 0.45 * stroke, c._f === 0 ? 0.3 : 0);
        }
      }
    }
    // 下一个音之前手指提起预备
    if (next && next.t - time < 0.12 && next.t > time && next._f !== f) {
      const pre = 1 - (next.t - time) / 0.12;
      if (next._f === 0) R.setFinger(0, 0.1 + 0.1 * pre, 0.2);
      else R.setFinger(next._f, 0.95 - 0.25 * pre, 0);
    }
    R.group.position.copy(root);
    R.group.position.z += push;
    // 抬起离弦时整体略高
    if (!cur || tau > 1.2) R.group.position.y += 0.004 * Math.sin(src.clock * 1.3);

    // ── 左手：按音与揉弦 ──
    const Lh = this.left;
    const pn = src.live ? (this.livePress ? [this.livePress] : []) : this.pressNotes || [];
    const pj = lastStarted(pn, time + 0.35);
    const p = pj >= 0 ? pn[pj] : null;
    const lroot = this._w.copy(this.leftRest);
    let press = 0;
    let pressString = -1;
    if (p) {
      const target = this.pressCache[p.s];
      const prevP = pj > 0 ? pn[pj - 1] : null;
      const tp = time - p.t;
      const end = p.t + (p.d ?? 0.5);
      const from = prevP && p.t - (prevP.t + prevP.d) < 0.5 ? this.pressCache[prevP.s] : this.leftRest;
      if (time < p.t) lroot.copy(from).lerp(target, easeInOut(smooth(p.t - 0.35, p.t - 0.04, time)));
      else if (time < end + 0.5) {
        lroot.copy(target);
        pressString = p.s;
        const amt = 0.0105;
        if (p.pr) press = amt * smooth(0.04, 0.2, tp) * (1 - smooth(end - 0.06, end + 0.05, time));
        else if (p.vib && tp > 0.35) press = (0.0025 + 0.002 * Math.sin((tp - 0.35) * 2 * Math.PI * 5.2)) * (1 - smooth(end - 0.1, end, time));
        if (time > end) lroot.lerp(this.leftRest, easeInOut(smooth(end, end + 0.5, time)));
      }
    }
    this.#contactPose(Lh, 2, 'L');
    Lh.group.position.copy(lroot);
    Lh.group.position.y -= press;
    if (pressString < 0) Lh.group.position.y += 0.003 * Math.sin(src.clock * 1.1 + 1);

    // 弦
    for (let i = 0; i < N; i++) {
      const pa = i === pressString ? press : 0;
      this.rightSeg[i].update(this.amps[i], dt);
      this.leftSeg[i].update(this.amps[i] * 0.35, dt, pa, pa > 0 ? this.pressFrac[i] : 0);
    }
    this.focus.copy(R.group.position).lerp(Lh.group.position, 0.3);
    this.body.localToWorld(this.focus);
  }
}
