// 二胡：六角琴筒（前口蟒皮、后口音窗）、琴杆、琴头、双轴、千斤、琴码、内外两弦；竹弓马尾夹在两弦之间。
// 右手持弓按“换弓 / 连弓”交替推拉；左手按音高在无品的弦上滑动取音（弦长比例 = 1 − f₀/f），含揉弦与滑音。
import * as THREE from 'three';
import { VibString } from './VibString.js';
import { Hand } from './Hand.js';
import { clamp, lerp, smooth, easeInOut, lastStarted, OnsetTracker, mtof } from './anim.js';
import { mergeStatic } from './merge.js';

const TUBE = { x0: -0.1, x1: 0.028, cy: 0.1, r: 0.046 };
const NECK = { x: 0.012, z: -0.019, r: 0.0125, top: 0.74 };
const BRIDGE_TOP = 0.117;
const STR_X = 0.037;
const QJ_Y = 0.5; // 千斤
const QJ_X = 0.022;
const STR_Z = [-0.0046, 0.0046]; // 内弦（近演奏者）/ 外弦
const BOW_Y = 0.163;
const BOW_LEN = 0.76;
const F_OPEN = [mtof(62), mtof(69)];
export const ERHU_SEAT = 0.5;

export class Erhu {
  /** opts.hand：手的选项；opts.seat = false 时不放圆墩（由演奏者的凳子代替）。 */
  constructor(scene, tex, handMats, effects, opts = {}) {
    this.effects = effects;
    this.group = new THREE.Group();
    this.group.name = 'erhu';
    scene.add(this.group);
    this.inst = new THREE.Group(); // 琴身（略向后倾）
    this.inst.position.y = ERHU_SEAT;
    this.inst.rotation.x = -0.1;
    this.group.add(this.inst);

    this.#materials(tex);
    this.#buildBody(tex);
    this.#buildStrings();
    this.#buildBow();
    if (opts.seat !== false) this.#buildSeat();

    this.left = new Hand('left', handMats, opts.hand);
    this.inst.add(this.left.group);
    this.left.orient(new THREE.Vector3(1, -0.12, 0.3), new THREE.Vector3(-0.28, 0.05, 1));
    this.right = new Hand('right', handMats, opts.hand);
    this.bow.add(this.right.group);
    this.right.orient(new THREE.Vector3(1, -0.15, 0.45), new THREE.Vector3(0.1, 0.25, -1));
    this.right.pose([[0.35, 0.25], 0.9, 1.15, 1.25, 1.4]);
    this.right.placeTip(1, new THREE.Vector3(-0.012, 0.004, 0.02));
    this.right.group.position.x -= 0.02;

    this.onsets = new OnsetTracker();
    this.liveNotes = [];
    this.focus = new THREE.Vector3();
    this.bowZ = 0;
    this.bowRoll = 0;
    this.strokes = [];
    this.#cacheRoots();
    this._v = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
  }

  #materials(tex) {
    this.rose = new THREE.MeshPhysicalMaterial({
      map: tex.rosewood.map, roughnessMap: tex.rosewood.roughnessMap, bumpMap: tex.rosewood.bumpMap, bumpScale: 0.25,
      roughness: 1, clearcoat: 0.9, clearcoatRoughness: 0.1, envMapIntensity: 1,
    });
    this.ebony = new THREE.MeshPhysicalMaterial({
      map: tex.ebony.map, roughnessMap: tex.ebony.roughnessMap, roughness: 1, clearcoat: 0.9, clearcoatRoughness: 0.12,
    });
    this.brass = new THREE.MeshStandardMaterial({ map: tex.brass.map, roughnessMap: tex.brass.ormMap, metalness: 1, roughness: 1 });
    this.bone = new THREE.MeshStandardMaterial({ color: 0xece0c6, roughness: 0.35 });
  }

  #buildBody(tex) {
    const g = new THREE.Group();
    const len = TUBE.x1 - TUBE.x0;
    const cx = (TUBE.x0 + TUBE.x1) / 2;
    // 六角琴筒
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(TUBE.r, TUBE.r, len, 6, 1, true), this.rose);
    tube.geometry.rotateZ(Math.PI / 2);
    tube.position.set(cx, TUBE.cy, 0);
    tube.material.side = THREE.DoubleSide;
    g.add(tube);
    // 前后口的加厚边框
    for (const [x, w] of [[TUBE.x1 - 0.004, 0.008], [TUBE.x0 + 0.004, 0.008], [cx, 0.006]]) {
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(TUBE.r + 0.0025, TUBE.r + 0.0025, w, 6, 1), this.ebony);
      rim.geometry.rotateZ(Math.PI / 2);
      rim.position.set(x, TUBE.cy, 0);
      g.add(rim);
    }
    // 蟒皮
    const skinGeo = new THREE.CircleGeometry(TUBE.r - 0.0005, 6);
    skinGeo.rotateY(Math.PI / 2);
    const skin = new THREE.Mesh(skinGeo, new THREE.MeshStandardMaterial({
      map: tex.python.map, bumpMap: tex.python.bumpMap, bumpScale: 0.6, roughness: 0.55, metalness: 0,
    }));
    skin.position.set(TUBE.x1 + 0.0006, TUBE.cy, 0);
    this.skin = skin;
    // 后口音窗
    const winGeo = new THREE.CircleGeometry(TUBE.r - 0.001, 6);
    winGeo.rotateY(-Math.PI / 2);
    const win = new THREE.Mesh(winGeo, new THREE.MeshPhysicalMaterial({
      map: tex.rosewood.map, alphaMap: tex.soundWindow, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.4, clearcoat: 0.6,
    }));
    win.position.set(TUBE.x0 + 0.004, TUBE.cy, 0);
    g.add(win);
    // 琴杆、琴头（向后卷曲）
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(NECK.r * 0.92, NECK.r, NECK.top, 20), this.ebony);
    neck.position.set(NECK.x, NECK.top / 2, NECK.z);
    g.add(neck);
    const head = new THREE.CatmullRomCurve3([
      new THREE.Vector3(NECK.x, NECK.top - 0.01, NECK.z),
      new THREE.Vector3(NECK.x - 0.004, NECK.top + 0.03, NECK.z),
      new THREE.Vector3(NECK.x - 0.022, NECK.top + 0.055, NECK.z),
      new THREE.Vector3(NECK.x - 0.045, NECK.top + 0.058, NECK.z),
      new THREE.Vector3(NECK.x - 0.058, NECK.top + 0.044, NECK.z),
      new THREE.Vector3(NECK.x - 0.05, NECK.top + 0.03, NECK.z),
    ]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(head, 40, NECK.r * 0.85, 14, false), this.ebony));
    const knob = new THREE.Mesh(new THREE.SphereGeometry(NECK.r * 0.9, 16, 12), this.ebony);
    knob.position.set(NECK.x - 0.05, NECK.top + 0.03, NECK.z);
    g.add(knob);
    // 琴轴（两轴，向后伸出）
    this.pegY = [0.63, 0.68];
    for (const y of this.pegY) {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.006, 0.09, 12), this.ebony);
      shaft.rotation.z = Math.PI / 2;
      shaft.position.set(NECK.x - 0.035, y, NECK.z);
      g.add(shaft);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.009, 0.03, 8), this.ebony);
      grip.rotation.z = Math.PI / 2;
      grip.position.set(NECK.x - 0.085, y, NECK.z);
      g.add(grip);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0115, 0.0115, 0.004, 8), this.brass);
      cap.rotation.z = Math.PI / 2;
      cap.position.set(NECK.x - 0.101, y, NECK.z);
      g.add(cap);
    }
    // 琴托（底座）
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.014, 0.06), this.rose);
    base.position.set(cx, TUBE.cy - TUBE.r - 0.007, 0);
    g.add(base);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.02, 16), this.ebony);
    foot.position.set(NECK.x, 0.01, NECK.z);
    g.add(foot);
    // 琴码（放在蟒皮上）
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.012, 0.02), new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.5 }));
    bridge.position.set(TUBE.x1 + 0.005, BRIDGE_TOP - 0.006, 0);
    g.add(bridge);
    // 千斤：丝线缠绕
    const qj = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.0016, 6, 24), new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.8 }));
    qj.rotation.x = Math.PI / 2;
    qj.scale.set(1, 0.72, 1);
    qj.position.set((NECK.x + QJ_X) / 2 + 0.002, QJ_Y, (NECK.z + 0) / 2);
    g.add(qj);
    // 红色丝穗
    const tassel = new THREE.Group();
    const silk = new THREE.MeshStandardMaterial({ color: 0xa3201a, roughness: 0.7 });
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), silk);
    knot.position.set(NECK.x - 0.05, NECK.top + 0.018, NECK.z);
    tassel.add(knot);
    for (let k = 0; k < 7; k++) {
      const th = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.09, 4), silk);
      th.position.set(NECK.x - 0.05 + (k - 3) * 0.0022, NECK.top - 0.03, NECK.z + ((k % 2) - 0.5) * 0.003);
      th.rotation.z = (k - 3) * 0.03;
      tassel.add(th);
    }
    g.add(tassel);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.inst.add(g);
    mergeStatic(g);
    this.inst.add(skin);
    skin.receiveShadow = true;
  }

  #buildStrings() {
    this.strings = [];
    this.pickables = [];
    this.bridgePts = STR_Z.map((z) => new THREE.Vector3(STR_X, BRIDGE_TOP, z * 0.9));
    this.qjPts = STR_Z.map((z) => new THREE.Vector3(QJ_X, QJ_Y, z * 0.75));
    const pickMat = new THREE.MeshBasicMaterial({ visible: false });
    const lines = [];
    for (let s = 0; s < 2; s++) {
      const vs = new VibString({
        radius: s === 0 ? 0.00055 : 0.00042, color: 0xd8d4cc, metal: true, maxAmp: 0.0026,
        up: new THREE.Vector3(0, 0, 1), glow: new THREE.Color(1.0, 0.62, 0.3),
      }).addTo(this.inst);
      vs.set(this.bridgePts[s], this.qjPts[s]);
      this.strings.push(vs);
      // 琴码以下到琴托、千斤以上到琴轴
      const bot = new THREE.Vector3(0.022, 0.032, STR_Z[s] * 0.4);
      const peg = new THREE.Vector3(NECK.x + 0.004, this.pegY[1 - s], NECK.z + 0.008);
      lines.push(...this.bridgePts[s].toArray(), ...bot.toArray(), ...this.qjPts[s].toArray(), ...peg.toArray());
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    this.inst.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x8c877c })));
    // 拾取：两弦之间、千斤到琴码之间的薄板（按竖直位置决定音高）
    const h = QJ_Y - BRIDGE_TOP - 0.06;
    const pick = new THREE.Mesh(new THREE.BoxGeometry(0.03, h, 0.04), pickMat);
    pick.position.set((STR_X + QJ_X) / 2, BRIDGE_TOP + 0.06 + h / 2, 0);
    pick.userData = { inst: 'erhu' };
    this.inst.add(pick);
    this.pickables.push(pick);
  }

  #buildBow() {
    const bow = new THREE.Group();
    const bamboo = new THREE.MeshPhysicalMaterial({ color: 0xb58a4c, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3 });
    const stick = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.045, 0.0, 0.013),
      new THREE.Vector3(0.1, 0.002, 0.019),
      new THREE.Vector3(0.38, 0.003, 0.025),
      new THREE.Vector3(0.66, 0.002, 0.019),
      new THREE.Vector3(0.772, 0.0, 0.01),
      new THREE.Vector3(0.785, 0.0, 0.002),
    ]);
    bow.add(new THREE.Mesh(new THREE.TubeGeometry(stick, 80, 0.0038, 8, false), bamboo));
    // 竹节
    for (let k = 1; k < 5; k++) {
      const p = stick.getPoint(k / 5);
      const node = new THREE.Mesh(new THREE.TorusGeometry(0.0039, 0.0009, 6, 12), bamboo);
      node.position.copy(p);
      node.lookAt(stick.getPoint(k / 5 + 0.01));
      bow.add(node);
    }
    // 马尾：扁带，位于局部 XY 平面
    const hairMat = new THREE.MeshStandardMaterial({ color: 0xf4efe2, roughness: 0.75, side: THREE.DoubleSide });
    const hair = new THREE.Mesh(new THREE.BoxGeometry(BOW_LEN, 0.0075, 0.0009), hairMat);
    hair.position.set(BOW_LEN / 2, 0, 0);
    bow.add(hair);
    // 弓根（含螺丝）与弓尖
    const frog = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.015), this.ebony);
    frog.position.set(-0.02, 0, 0.007);
    bow.add(frog);
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.02, 10), this.brass);
    screw.rotation.z = Math.PI / 2;
    screw.position.set(-0.055, 0, 0.013);
    bow.add(screw);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.009, 0.012), this.bone);
    tip.position.set(BOW_LEN + 0.006, 0, 0.005);
    bow.add(tip);
    bow.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.bow = bow;
    this.inst.add(bow);
  }

  // 圆墩（象征演奏者的膝上位置）
  #buildSeat() {
    const g = new THREE.Group();
    const prof = [[0, 0], [0.14, 0], [0.15, 0.02], [0.12, 0.06], [0.1, 0.25], [0.12, 0.44], [0.15, 0.48], [0.14, 0.5], [0, 0.5]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const seat = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), new THREE.MeshPhysicalMaterial({
      map: this.rose.map, roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.15, color: 0x9a5a40,
    }));
    seat.castShadow = true;
    seat.receiveShadow = true;
    g.add(seat);
    const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.145, 0.018, 40), new THREE.MeshPhysicalMaterial({
      color: 0x7a1c16, roughness: 0.7, sheen: 1, sheenColor: new THREE.Color(0xe0a060),
    }));
    cushion.position.y = 0.5 - 0.005;
    g.add(cushion);
    g.position.set(-0.03, 0, 0);
    this.group.add(g);
  }

  // ───────────────────────────── 演奏 ─────────────────────────────

  // 手指在弦上的位置：比例 s 自千斤量起
  #pressPoint(str, hz, out) {
    const semis = 12 * Math.log2(hz / F_OPEN[str]);
    const s = clamp(1 - Math.pow(2, -semis / 12), 0, 0.7);
    return out.copy(this.qjPts[str]).lerp(this.bridgePts[str], s);
  }

  #fingerFor(semis) {
    if (semis < 0.4) return -1;
    const pos = semis <= 7.5 ? 0 : semis <= 12.5 ? 5 : 10;
    const d = semis - pos;
    return d <= 2.5 ? 1 : d <= 4.5 ? 2 : d <= 6.3 ? 3 : 4;
  }

  #leftPose(f) {
    const L = this.left;
    // 不按弦的手指略抬起、自然弯曲；按弦的手指指尖压到弦上
    L.pose([[0.5, 0.35], 0.95, 1.0, 1.1, 1.2]);
    if (f > 0) {
      L.setFinger(f, 1.25, 0);
      for (let k = 1; k < f; k++) L.setFinger(k, 1.2, 0);
    }
  }

  #rootFor(f, target) {
    this.#leftPose(f);
    this.left.group.position.set(0, 0, 0);
    this.left.placeTip(f, target);
    return this.left.group.position.clone();
  }

  #cacheRoots() {
    this.inst.updateMatrixWorld(true);
    this.restRoot = this.#rootFor(1, this.#pressPoint(0, F_OPEN[0] * Math.pow(2, 2 / 12), new THREE.Vector3()).add(new THREE.Vector3(-0.004, 0, -0.012)));
  }

  #noteRoot(n) {
    const hz = n.hz || mtof(n.m);
    const str = n.str ?? (n.m <= 68 ? 0 : 1);
    const semis = 12 * Math.log2(hz / F_OPEN[str]);
    const f = this.#fingerFor(semis);
    n._str = str;
    n._fg = f;
    if (f < 0) return null;
    const p = this.#pressPoint(str, hz, new THREE.Vector3());
    p.z -= 0.0022; // 指尖从演奏者一侧压弦
    return this.#rootFor(f, p);
  }

  /** 预计算：每个音的左手位置与手指；运弓分段（推 / 拉交替）。 */
  prepare(notes) {
    let last = this.restRoot;
    for (const n of notes) {
      const r = this.#noteRoot(n);
      n._root = r || last;
      if (r) last = r;
    }
    this.strokes = this.#strokes(notes);
  }

  #strokes(notes) {
    const out = [];
    let p = 0.14;
    let dir = -1;
    let cur = null;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const prev = notes[i - 1];
      const gap = prev ? n.t - (prev.t + prev.d) : 99;
      if (!cur || !n.lg || gap > 0.06) {
        if (cur) out.push(cur);
        // 长休止后选择剩余弓段较长的方向；否则推拉交替
        dir = gap > 0.8 || !cur ? (p < 0.5 ? 1 : -1) : -dir;
        cur = { t0: n.t, t1: n.t + n.d, dir, p0: p, v: n.v };
      } else cur.t1 = n.t + n.d;
      const dur = cur.t1 - cur.t0;
      const speed = 0.14 + 0.2 * (cur.v ?? 0.6);
      cur.p1 = clamp(cur.p0 + cur.dir * Math.min(0.84, 0.06 + dur * speed), 0.07, 0.93);
      p = cur.p1;
    }
    if (cur) out.push(cur);
    return out;
  }

  #bowAt(time, strokes) {
    let a = 0;
    let b = strokes.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if (strokes[m].t0 <= time) a = m + 1;
      else b = m;
    }
    const s = strokes[a - 1];
    if (!s) return { p: strokes[0] ? strokes[0].p0 : 0.14, active: false, speed: 0 };
    if (s.t1 > 1e6) {
      // 实时演奏：按住不放时匀速运弓，到弓尖 / 弓根自动换弓
      const lo = 0.07;
      const hi = 0.93;
      const span = hi - lo;
      const speed = 0.16 + 0.16 * (s.v ?? 0.6);
      let x = (s.p0 - lo) + (s.dir > 0 ? 1 : -1) * speed * (time - s.t0);
      x = ((x % (2 * span)) + 2 * span) % (2 * span);
      return { p: lo + (x > span ? 2 * span - x : x), active: true, speed, stroke: s };
    }
    if (time <= s.t1) {
      const u = (time - s.t0) / Math.max(0.03, s.t1 - s.t0);
      const e = u * 0.72 + u * u * (3 - 2 * u) * 0.28;
      const speed = Math.abs(s.p1 - s.p0) / Math.max(0.03, s.t1 - s.t0);
      return { p: lerp(s.p0, s.p1, e), active: true, speed, stroke: s };
    }
    return { p: s.p1, active: false, speed: 0, stroke: s };
  }

  /** 指板拾取点 → 音高：自千斤向下线性覆盖 D4–D6，低于 A4 用内弦。 */
  pitchAt(worldPoint) {
    const p = this.inst.worldToLocal(worldPoint.clone());
    const u = clamp((QJ_Y - p.y) / (QJ_Y - BRIDGE_TOP - 0.07), 0, 1);
    return 62 + u * 24;
  }

  noteOnLive(hz, vel, time) {
    const str = hz < 430 ? 0 : 1;
    const last = this.liveNotes[this.liveNotes.length - 1];
    const lg = !!(last && last.t + last.d >= time - 0.01 && last._str === str);
    if (last && last.d > 1e6) last.d = time - last.t;
    const n = { t: time, d: 1e9, hz, m: 69 + 12 * Math.log2(hz / 440), v: vel, str, lg, vib: true };
    const r = this.#noteRoot(n);
    n._root = r || (last ? last._root : this.restRoot);
    this.liveNotes.push(n);
    if (this.liveNotes.length > 600) this.liveNotes.splice(0, 300);
    this.liveStrokes = this.#strokes(this.liveNotes);
  }

  releaseLive(time) {
    const last = this.liveNotes[this.liveNotes.length - 1];
    if (last && last.d > 1e6) last.d = Math.max(0.05, time - last.t);
    this.liveStrokes = this.#strokes(this.liveNotes);
  }

  update(dt, src) {
    const { notes, time } = src;
    this.inst.updateMatrixWorld(true);
    const strokes = src.live ? (this.liveStrokes || []) : this.strokes;
    // 音头特效：蟒皮上的涟漪
    this.onsets.update(notes, time, (n) => {
      const c = this.inst.localToWorld(new THREE.Vector3(TUBE.x1 + 0.004, TUBE.cy, 0));
      const nrm = new THREE.Vector3(1, 0, 0).applyQuaternion(this.inst.getWorldQuaternion(new THREE.Quaternion()));
      if (!n.lg) this.effects.ripple(c, 0.05 + 0.04 * (n.v ?? 0.6), n.v ?? 0.6, src.clock, 0, nrm, null, 1.1);
    });

    const i = lastStarted(notes, time);
    const n = i >= 0 ? notes[i] : null;
    const sounding = n && time < n.t + n.d + 0.02;
    const bow = this.#bowAt(time, strokes);
    // 运弓：弓在两弦之间，按内 / 外弦微微偏向
    const str = n ? (n._str ?? 0) : 0;
    const zT = sounding ? (str === 0 ? -0.0017 : 0.0017) : 0;
    const k = 1 - Math.exp(-dt * 18);
    this.bowZ += (zT - this.bowZ) * k;
    this.bowRoll += ((sounding ? (str === 0 ? 0.12 : -0.12) : 0) - this.bowRoll) * k;
    const contactX = lerp(this.bridgePts[0].x, this.qjPts[0].x, (BOW_Y - BRIDGE_TOP) / (QJ_Y - BRIDGE_TOP));
    this.bow.position.set(contactX - bow.p * BOW_LEN, BOW_Y, this.bowZ);
    this.bow.rotation.set(this.bowRoll, 0, 0);

    // 左手：按音位置（换把滑动、滑音、揉弦）
    const root = this._v;
    if (!n) root.copy(this.restRoot);
    else {
      const prev = notes[i - 1];
      root.copy(n._root);
      const tau = time - n.t;
      const trans = n.gl ? 0.14 : 0.05;
      if (prev && tau < trans && prev._root) root.copy(prev._root).lerp(n._root, easeInOut(clamp(tau / trans, 0, 1)));
      if (n.vib && tau > 0.3 && sounding) root.y += 0.0024 * Math.sin((tau - 0.3) * 2 * Math.PI * 5.5) * Math.min(1, (tau - 0.3) * 3);
      if (!sounding && time - (n.t + n.d) > 1.5) root.lerp(this.restRoot, easeInOut(smooth(n.t + n.d + 1.5, n.t + n.d + 2.5, time)));
    }
    this.#leftPose(n && sounding ? n._fg : -1);
    if (n && sounding && n._fg > 0 && time - n.t < 0.06) this.left.setFinger(n._fg, 0.8 + 0.15 * (time - n.t) / 0.06, 0);
    this.left.group.position.copy(root);

    // 弦：发声弦自指位（或千斤）振动到琴码
    for (let s = 0; s < 2; s++) {
      const vs = this.strings[s];
      const on = sounding && s === str;
      const top = this._a.copy(this.qjPts[s]);
      if (on && n._fg > 0) {
        this.#pressPoint(s, n.hz || mtof(n.m), top);
        // 揉弦时指位随手上下
        top.y += root.y - n._root.y;
      }
      vs.set(this.bridgePts[s], top);
      let amp = 0;
      if (on) amp = (0.0008 + 0.0018 * (n.v ?? 0.6)) * (bow.active ? Math.min(1, 0.4 + bow.speed * 2.5) : Math.exp(-(time - n.t - n.d) * 20));
      vs.update(amp, dt);
    }
    this.focus.set(0.02, 0.28, 0);
    this.inst.localToWorld(this.focus);
  }
}
