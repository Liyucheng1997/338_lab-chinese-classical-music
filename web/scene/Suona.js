// 唢呐：哨子（双簧）、气牌、铜芯子、八孔木杆（前七后一）、铜碗。
// 双手按指法表开闭音孔：筒音作 5（全按 = E4），自下而上逐孔开放；变化音用半孔，高八度开背孔。
import * as THREE from 'three';
import { Hand } from './Hand.js';
import { clamp, smooth, lastStarted, OnsetTracker, mtof } from './anim.js';
import { mergeStatic } from './merge.js';

const BELL_TOP = 0.112;
const BODY_TOP = 0.39;
const HOLE_Y = (k) => 0.158 + k * 0.03; // 前孔 k = 0（最下）… 6（最上）
const BACK_Y = 0.352;
const bodyR = (y) => 0.0158 - (y - BELL_TOP) / (BODY_TOP - BELL_TOP) * 0.005;
const SCALE = [0, 2, 4, 5, 7, 9, 10]; // 自筒音起的音级（E 大调式音阶中 A 大调的 5 6 7 1 2 3 4）
const BASE = 64;

/** 指法：返回长度 8 的覆盖度（0 开 ~ 1 闭），前 7 孔 + 背孔。 */
export function fingering(midi) {
  let m = Math.round(midi);
  while (m < BASE) m += 12;
  const oct = Math.floor((m - BASE) / 12);
  const d = (m - BASE) % 12;
  let c = 0;
  for (let k = 0; k < SCALE.length; k++) if (SCALE[k] <= d) c = k;
  const half = SCALE[c] !== d;
  const cover = new Array(8).fill(1);
  for (let k = 0; k < c; k++) cover[k] = 0;
  if (half) cover[c] = 0.45;
  cover[7] = oct === 0 ? 1 : oct === 1 ? 0.5 : 0;
  return cover;
}

// 手指 → 孔：左手（上）食中无名 = 孔 6 5 4、拇指 = 背孔；右手（下）食中无名小 = 孔 3 2 1 0
const LEFT_MAP = [[1, 6], [2, 5], [3, 4]];
const RIGHT_MAP = [[1, 3], [2, 2], [3, 1], [4, 0]];

export class Suona {
  constructor(scene, tex, handMats, effects) {
    this.effects = effects;
    this.group = new THREE.Group();
    this.group.name = 'suona';
    scene.add(this.group);
    this.inst = new THREE.Group();
    this.group.add(this.inst);
    // 演奏姿势：哨子朝上后方（口），碗朝下前方
    this.inst.position.set(0, 1.02, 0);
    this.inst.rotation.set(-0.92, 0.0, 0, 'YXZ');

    this.#build(tex);
    this.left = new Hand('left', handMats);
    this.right = new Hand('right', handMats);
    this.inst.add(this.left.group, this.right.group);
    this.left.orient(new THREE.Vector3(-1, 0, 0.12), new THREE.Vector3(0.1, 0, -1));
    this.right.orient(new THREE.Vector3(1, 0, 0.12), new THREE.Vector3(-0.1, 0, -1));
    this.#place();
    this.onsets = new OnsetTracker();
    this.liveNotes = [];
    this.cover = new Array(8).fill(1);
    this.focus = new THREE.Vector3();
    this.glow = 0;
  }

  #build(tex) {
    const g = new THREE.Group();
    const brass = new THREE.MeshStandardMaterial({
      map: tex.brass.map, roughnessMap: tex.brass.ormMap, metalnessMap: tex.brass.ormMap, metalness: 1, roughness: 1,
      side: THREE.DoubleSide, emissive: new THREE.Color(0xffa040), emissiveIntensity: 0, envMapIntensity: 1.2,
    });
    this.brass = brass;
    // 铜碗：指数喇叭口 + 卷边
    const bell = [];
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      const y = t * BELL_TOP;
      const r = 0.0165 + 0.047 * Math.pow(1 - t, 2.6);
      bell.push(new THREE.Vector2(r, y));
    }
    const bellMesh = new THREE.Mesh(new THREE.LatheGeometry(bell, 48), brass);
    g.add(bellMesh);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.0637, 0.0022, 8, 48), brass);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 0.0005;
    g.add(lip);
    this.bellMouth = new THREE.Vector3(0, 0, 0);

    // 木杆：锥形，带铜箍
    const wood = new THREE.MeshPhysicalMaterial({
      map: tex.rosewood.map, roughnessMap: tex.rosewood.roughnessMap, bumpMap: tex.rosewood.bumpMap, bumpScale: 0.2,
      roughness: 1, clearcoat: 0.8, clearcoatRoughness: 0.15,
    });
    const prof = [];
    for (let k = 0; k <= 30; k++) {
      const y = BELL_TOP - 0.01 + (k / 30) * (BODY_TOP - BELL_TOP + 0.01);
      prof.push(new THREE.Vector2(bodyR(y), y));
    }
    g.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 28), wood));
    for (const y of [BELL_TOP + 0.004, 0.25, BODY_TOP - 0.004]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(bodyR(y) + 0.0014, bodyR(y) + 0.0014, 0.009, 28), brass);
      band.position.y = y;
      g.add(band);
    }
    // 音孔（前七后一）
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x060302 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x2a140c, roughness: 0.5 });
    this.holes = [];
    const addHole = (y, back) => {
      const r = bodyR(y);
      const n = new THREE.Vector3(0, 0, back ? -1 : 1);
      const p = new THREE.Vector3(0, y, (back ? -1 : 1) * (r + 0.0002));
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.0034, 16), holeMat);
      d.position.copy(p);
      d.lookAt(p.clone().add(n));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0037, 0.0006, 6, 16), rimMat);
      ring.position.copy(p);
      ring.lookAt(p.clone().add(n));
      g.add(d, ring);
      this.holes.push({ p, n });
    };
    for (let k = 0; k < 7; k++) addHole(HOLE_Y(k), false);
    addHole(BACK_Y, true);

    // 芯子、气牌、哨子
    const staple = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0042, 0.06, 14), brass);
    staple.position.y = BODY_TOP + 0.03;
    g.add(staple);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.0175, 0.0175, 0.0025, 32), brass);
    disc.position.y = BODY_TOP + 0.061;
    g.add(disc);
    const reedGeo = new THREE.CylinderGeometry(0.0062, 0.0036, 0.026, 16);
    reedGeo.scale(1, 1, 0.34);
    const reed = new THREE.Mesh(reedGeo, new THREE.MeshStandardMaterial({ color: 0xc9a466, roughness: 0.6 }));
    reed.position.y = BODY_TOP + 0.077;
    g.add(reed);
    const bind = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.005, 12), new THREE.MeshStandardMaterial({ color: 0x8a2a1a, roughness: 0.7 }));
    bind.position.y = BODY_TOP + 0.067;
    g.add(bind);
    this.reedTip = new THREE.Vector3(0, BODY_TOP + 0.09, 0);
    // 红绸（系于碗颈）
    const silk = new THREE.MeshPhysicalMaterial({ color: 0xa81e18, roughness: 0.6, sheen: 1, sheenColor: new THREE.Color(0xff8a60), side: THREE.DoubleSide });
    const knot = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.004, 8, 24), silk);
    knot.rotation.x = Math.PI / 2;
    knot.position.y = BELL_TOP + 0.012;
    g.add(knot);
    for (const s of [-1, 1]) {
      const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(0.018, 0.11, 1, 8), silk);
      const pp = ribbon.geometry.attributes.position;
      for (let i = 0; i < pp.count; i++) {
        const y = pp.getY(i);
        pp.setZ(i, 0.01 * Math.sin((y + 0.055) * 40) * s);
      }
      ribbon.geometry.computeVertexNormals();
      ribbon.position.set(s * 0.017, BELL_TOP - 0.042, -0.012);
      ribbon.rotation.set(0.2, 0, s * 0.25);
      g.add(ribbon);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.inst.add(g);
    this.bellMesh = bellMesh;
    mergeStatic(g, (o) => o.material !== brass);

    // 拾取：沿木杆的包围体（按位置决定音）
    const pick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, BODY_TOP - BELL_TOP, 12), new THREE.MeshBasicMaterial({ visible: false }));
    pick.position.y = (BODY_TOP + BELL_TOP) / 2;
    pick.userData = { inst: 'suona' };
    this.inst.add(pick);
    this.pickables = [pick];
  }

  // 两只手放到持管位置：各自以中间一指对准其孔
  #place() {
    this.inst.updateMatrixWorld(true);
    this.#pose(new Array(8).fill(1));
    const hl = this.holes[5];
    this.left.group.position.set(0, 0, 0);
    this.left.placeTip(2, hl.p.clone().add(new THREE.Vector3(0, 0, 0.001)));
    this.leftRoot = this.left.group.position.clone();
    const hr = this.holes[2];
    this.right.group.position.set(0, 0, 0);
    this.right.placeTip(2, hr.p.clone().add(new THREE.Vector3(0, 0, 0.001)));
    this.rightRoot = this.right.group.position.clone();
  }

  // 覆盖度 → 手指屈曲：盖孔时指腹贴孔，开孔时抬起
  #pose(cover) {
    const L = this.left;
    const R = this.right;
    L.setFinger(0, 0.55 + 0.35 * cover[7], 0.4 - 0.25 * cover[7]);
    R.setFinger(0, 0.7, 0.35);
    for (const [f, h] of LEFT_MAP) L.setFinger(f, 0.35 + 0.6 * cover[h], (f - 2) * -0.06);
    for (const [f, h] of RIGHT_MAP) R.setFinger(f, 0.35 + 0.6 * cover[h], (f - 2) * 0.1);
  }

  // 指法完全由音高决定，无需预计算
  prepare() {}

  noteOnLive(hz, vel, time) {
    const last = this.liveNotes[this.liveNotes.length - 1];
    const lg = !!(last && last.d > 1e6);
    if (lg) last.d = time - last.t;
    this.liveNotes.push({ t: time, d: 1e9, hz, m: 69 + 12 * Math.log2(hz / 440), v: vel, lg });
    if (this.liveNotes.length > 600) this.liveNotes.splice(0, 300);
  }

  releaseLive(time) {
    const last = this.liveNotes[this.liveNotes.length - 1];
    if (last && last.d > 1e6) last.d = Math.max(0.05, time - last.t);
  }

  /** 管身上的拾取点 → 最近音孔对应的音（开到该孔为止）；靠近哨端的背孔区为高八度。 */
  pitchAt(worldPoint) {
    const y = this.inst.worldToLocal(worldPoint.clone()).y;
    let k = 0;
    let best = 9;
    for (let i = 0; i < 7; i++) {
      const d = Math.abs(HOLE_Y(i) - y);
      if (d < best) { best = d; k = i; }
    }
    return BASE + 12 + SCALE[k] - (y < HOLE_Y(0) - 0.012 ? 12 : 0);
  }

  /** 按管上位置（0 = 碗端 … 1 = 哨端）得到最接近的五声音。 */
  pitchAtHole(frac) {
    const y = BELL_TOP + frac * (BODY_TOP - BELL_TOP);
    let k = 0;
    let best = 9;
    for (let i = 0; i < 7; i++) {
      const d = Math.abs(HOLE_Y(i) - y);
      if (d < best) { best = d; k = i; }
    }
    return BASE + SCALE[k] + (y > BACK_Y + 0.01 ? 12 : 0);
  }

  update(dt, src) {
    const { notes, time } = src;
    this.inst.updateMatrixWorld(true);
    this.onsets.update(notes, time, (n) => {
      if (n.lg && Math.random() < 0.6) return;
      const c = this.inst.localToWorld(this.bellMouth.clone());
      const axis = new THREE.Vector3(0, -1, 0).transformDirection(this.inst.matrixWorld);
      const v = n.v ?? 0.6;
      this.effects.ripple(c.clone().addScaledVector(axis, 0.01), 0.09 + 0.05 * v, v, src.clock, 0, axis, null, 0.9);
      this.effects.ripple(c.clone().addScaledVector(axis, 0.03), 0.07 + 0.04 * v, v * 0.6, src.clock, 0.12, axis, null, 0.9);
      if (v > 0.7) this.effects.sparks(c, axis, v * 0.6, 4, 0.18);
    });

    const i = lastStarted(notes, time);
    let n = i >= 0 ? notes[i] : null;
    const sounding = n && time < n.t + n.d + 0.02 && !(n.st && time > n.t + Math.min(n.d * 0.5, 0.09));
    // 下一音提前 30 ms 换指
    const next = notes[i + 1];
    let target = n ? fingering(n.m) : new Array(8).fill(1);
    if (next && next.t - time < 0.03) target = fingering(next.m);
    if (n && n.t + n.d + 0.8 < time && !(next && next.t - time < 0.3)) target = new Array(8).fill(1);
    const k = 1 - Math.exp(-dt * 40);
    for (let h = 0; h < 8; h++) this.cover[h] += (target[h] - this.cover[h]) * k;
    this.#pose(this.cover);

    // 花舌时哨子颤动；颤音时整管微动
    const tau = n ? time - n.t : 0;
    let shake = 0;
    if (sounding && n.fl) shake = 0.0012 * Math.sin(tau * 2 * Math.PI * 22);
    else if (sounding && n.vib && tau > 0.25) shake = 0.0006 * Math.sin((tau - 0.25) * 2 * Math.PI * 5.8);
    this.left.group.position.copy(this.leftRoot);
    this.right.group.position.copy(this.rightRoot);
    this.inst.position.y = 1.02 + shake;

    // 铜碗随音量发光
    const env = sounding ? (0.45 + 0.55 * (n.v ?? 0.6)) * (1 - 0.3 * smooth(0, 0.6, tau)) * (n.st ? 1.4 : 1) : 0;
    this.glow += (env - this.glow) * (1 - Math.exp(-dt * (env > this.glow ? 30 : 6)));
    this.brass.emissiveIntensity = this.glow * 0.5;
    this.focus.set(0, 0.24, 0);
    this.inst.localToWorld(this.focus);
  }
}
