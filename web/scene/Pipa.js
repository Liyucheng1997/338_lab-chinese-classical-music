// 琵琶：梨形桐木面板、红木背板、琴颈上的六个“相”、面板上的二十四个“品”、向后弯的弦槽与四个轸子、
// 如意琴头、覆手、四根弦（子弦在演奏者右手一侧）。
// 右手戴义甲在覆手与最低一品之间弹奏：弹（食指向外）、挑（拇指向内）、轮指（小、无名、中、食依次弹出，拇指挑回）、
// 扫 / 拂（食指一次划过四弦）；左手按品取音，推拉时手指横向推弦，长音吟揉，绞弦时把子弦、中弦绞在一起。
import * as THREE from 'three';
import { VibString } from './VibString.js';
import { Hand } from './Hand.js';
import { clamp, lerp, smooth, easeInOut, lastStarted, OnsetTracker } from './anim.js';
import { mergeStatic } from './merge.js';

// 乐器局部坐标：原点在琴底中心，+Y 沿琴身指向琴头，+Z 为面板朝外（听众），+X 为演奏者左侧
const L = 0.66;                 // 有效弦长（山口 → 覆手）
const Y_BRIDGE = 0.075;         // 覆手系弦处
const Y_NUT = Y_BRIDGE + L;     // 山口
const BODY_TOP = 0.53;          // 面板与琴颈交界
const Y_PLUCK = 0.148;          // 右手弹奏点
export const PIPA_FRETS = 30;   // 六相二十四品
const OPEN = [57, 52, 50, 45];  // 子、中、老、缠
const XS_NUT = [-0.0165, -0.0055, 0.0055, 0.0165];
const XS_BRIDGE = [-0.027, -0.009, 0.009, 0.027];

export const fretY = (n) => Y_NUT - L * (1 - Math.pow(2, -n / 12));
const stringX = (i, y) => lerp(XS_BRIDGE[i], XS_NUT[i], (y - Y_BRIDGE) / L);
const stringZ = (y) => lerp(0.0085, 0.0175, (y - Y_BRIDGE) / L);

/** 面板轮廓半宽：下部是半径 15 厘米的圆，上部收成梨形。 */
function halfW(y) {
  if (y <= 0.15) return Math.sqrt(Math.max(0, 0.15 * 0.15 - (0.15 - y) ** 2));
  const s = clamp((y - 0.15) / (BODY_TOP - 0.15), 0, 1);
  return 0.036 + 0.114 * Math.pow(Math.max(0, 1 - Math.pow(s, 1.7)), 0.75);
}
/** 背板鼓起的深度（中线）。 */
const backDepth = (y) => 0.012 + 0.046 * Math.sin(Math.PI * clamp(y / (BODY_TOP + 0.04), 0, 1)) ** 0.6;
/** 面板微拱。 */
const faceZ = (x, y) => 0.003 * Math.max(0, 1 - (x / Math.max(1e-4, halfW(y))) ** 2) * Math.sin(Math.PI * clamp(y / BODY_TOP, 0, 1));

export class Pipa {
  /** opts.hand：两只手的选项。 */
  constructor(scene, tex, handMats, effects, opts = {}) {
    this.effects = effects;
    this.group = new THREE.Group();
    this.group.name = 'pipa';
    scene.add(this.group);
    // 竖抱：琴头略偏向演奏者左肩、略向后仰；琴底搭在左腿上
    this.inst = new THREE.Group();
    this.inst.position.set(0.07, opts.baseY ?? 0.5, 0.17);
    this.inst.rotation.set(-0.16, 0, -0.2, 'YXZ');
    this.group.add(this.inst);

    this.#materials(tex);
    this.#buildBody();
    this.#buildNeckAndHead();
    this.#buildFrets();
    this.#buildStrings();

    this.right = new Hand('right', handMats, { picks: true, ...opts.hand });
    this.left = new Hand('left', handMats, opts.hand);
    this.inst.add(this.right.group, this.left.group);
    // 右手从演奏者右侧绕到面板前，掌心对着琴弦，手指斜向左上
    this.right.orient(new THREE.Vector3(1, 0.55, 0.15), new THREE.Vector3(0.1, -0.15, -1));
    // 左手从琴颈左侧握住，拇指在颈后，四指绕到前面按弦
    this.left.orient(new THREE.Vector3(-0.35, 0.1, 1), new THREE.Vector3(-1, -0.1, -0.15));

    this.onsets = new OnsetTracker();
    this.amps = new Float32Array(4);
    this.stops = new Float32Array(4);
    this.liveNotes = [];
    this.focus = new THREE.Vector3();
    this.leftPos = 2;
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this.#cacheRoots();
  }

  #materials(tex) {
    this.faceMat = new THREE.MeshPhysicalMaterial({
      map: tex.pipaFace.map, roughnessMap: tex.pipaFace.roughnessMap, bumpMap: tex.pipaFace.bumpMap, bumpScale: 0.12,
      roughness: 1, clearcoat: 0.35, clearcoatRoughness: 0.35,
    });
    this.backMat = new THREE.MeshPhysicalMaterial({
      map: tex.rosewood.map, roughnessMap: tex.rosewood.roughnessMap, bumpMap: tex.rosewood.bumpMap, bumpScale: 0.2,
      roughness: 1, clearcoat: 0.9, clearcoatRoughness: 0.1, color: 0xb08070,
    });
    this.ebony = new THREE.MeshPhysicalMaterial({
      map: tex.ebony.map, roughnessMap: tex.ebony.roughnessMap, roughness: 1, clearcoat: 0.9, clearcoatRoughness: 0.12,
    });
    this.bone = new THREE.MeshPhysicalMaterial({ color: 0xece2c8, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    this.bamboo = new THREE.MeshPhysicalMaterial({ color: 0xd7bd84, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.25 });
    this.dark = new THREE.MeshStandardMaterial({ color: 0x120a06, roughness: 0.8 });
  }

  // 面板（平、微拱）与背板（椭圆截面的鼓背），沿轮廓以侧沿相接
  #buildBody() {
    const g = new THREE.Group();
    const NY = 64;
    const NX = 28;
    const ys = Array.from({ length: NY + 1 }, (_, i) => BODY_TOP * Math.pow(i / NY, 1.0));
    const mkGrid = (fn, flip) => {
      const pos = [];
      const uv = [];
      const idx = [];
      for (let i = 0; i <= NY; i++) {
        for (let j = 0; j <= NX; j++) {
          const s = -1 + (2 * j) / NX;
          const y = ys[i];
          const p = fn(s, y);
          pos.push(p.x, p.y, p.z);
          uv.push(y / BODY_TOP, (s + 1) / 2);
        }
      }
      for (let i = 0; i < NY; i++) {
        for (let j = 0; j < NX; j++) {
          const a = i * (NX + 1) + j;
          const b = a + NX + 1;
          if (flip) idx.push(a, a + 1, b, a + 1, b + 1, b);
          else idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    };
    // 面板
    const face = new THREE.Mesh(mkGrid((s, y) => {
      const x = s * halfW(y);
      return new THREE.Vector3(x, y, faceZ(x, y));
    }, true), this.faceMat);
    face.receiveShadow = true;
    g.add(face);
    // 侧沿（面板边到背板边的一圈窄带）与鼓背
    const RIM = 0.012;
    const back = new THREE.Mesh(mkGrid((s, y) => {
      const hw = halfW(y);
      const x = s * hw;
      const e = Math.sqrt(Math.max(0, 1 - s * s));
      return new THREE.Vector3(x * (0.985 + 0.015 * e), y, -RIM - backDepth(y) * Math.pow(e, 0.8));
    }, false), this.backMat);
    g.add(back);
    const rimPts = [];
    const rimIdx = [];
    const outline = [];
    for (let i = 0; i <= NY; i++) outline.push([ys[i], 1]);
    for (let i = NY; i >= 0; i--) outline.push([ys[i], -1]);
    outline.forEach(([y, s], k) => {
      const x = s * halfW(y);
      rimPts.push(x, y, 0.0, x * 0.985, y, -RIM);
      if (k < outline.length - 1) {
        const a = 2 * k;
        rimIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    const rimGeo = new THREE.BufferGeometry();
    rimGeo.setAttribute('position', new THREE.Float32BufferAttribute(rimPts, 3));
    rimGeo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((rimPts.length / 3) * 2), 2));
    rimGeo.setIndex(rimIdx);
    rimGeo.computeVertexNormals();
    g.add(new THREE.Mesh(rimGeo, new THREE.MeshPhysicalMaterial({ color: 0x3a1a10, roughness: 0.4, clearcoat: 0.8, side: THREE.DoubleSide })));
    // 面板镶边：细黑线沿轮廓
    const edgePts = outline.map(([y, s]) => new THREE.Vector3(s * (halfW(y) - 0.004), y, faceZ(s * (halfW(y) - 0.004), y) + 0.0006));
    const edge = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edgePts, false), 200, 0.0012, 5, false), this.dark);
    g.add(edge);

    // 覆手：两端上卷的雕花横木，四个系弦孔
    const shape = new THREE.Shape();
    shape.moveTo(-0.072, 0);
    shape.bezierCurveTo(-0.08, 0.012, -0.066, 0.03, -0.05, 0.022);
    shape.bezierCurveTo(-0.03, 0.018, -0.02, 0.028, 0, 0.026);
    shape.bezierCurveTo(0.02, 0.028, 0.03, 0.018, 0.05, 0.022);
    shape.bezierCurveTo(0.066, 0.03, 0.08, 0.012, 0.072, 0);
    shape.bezierCurveTo(0.04, -0.01, -0.04, -0.01, -0.072, 0);
    const fu = new THREE.ExtrudeGeometry(shape, { depth: 0.009, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0015, bevelSegments: 2, curveSegments: 12 });
    const fuMesh = new THREE.Mesh(fu, this.backMat);
    fuMesh.position.set(0, Y_BRIDGE - 0.012, 0.0015);
    g.add(fuMesh);
    for (let i = 0; i < 4; i++) {
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.0016, 10), this.dark);
      hole.position.set(XS_BRIDGE[i], Y_BRIDGE, 0.0132);
      g.add(hole);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    mergeStatic(g);
    this.inst.add(g);
  }

  // 琴颈（相位）、弦槽、轸子、如意琴头
  #buildNeckAndHead() {
    const g = new THREE.Group();
    // 琴颈：正面平、背面半椭圆，自面板顶端延伸到山口，宽度收窄
    const neckGeo = (() => {
      const NY = 24;
      const NA = 16;
      const pos = [];
      const uv = [];
      const idx = [];
      for (let i = 0; i <= NY; i++) {
        const y = BODY_TOP - 0.02 + (Y_NUT + 0.004 - BODY_TOP + 0.02) * (i / NY);
        const hw = lerp(0.037, 0.028, clamp((y - BODY_TOP) / (Y_NUT - BODY_TOP), 0, 1));
        const dep = lerp(0.034, 0.026, clamp((y - BODY_TOP) / (Y_NUT - BODY_TOP), 0, 1));
        for (let a = 0; a <= NA; a++) {
          const th = Math.PI * (a / NA);
          pos.push(Math.cos(th) * hw, y, -Math.sin(th) * dep);
          uv.push(i / NY, a / NA);
        }
      }
      for (let i = 0; i < NY; i++) {
        for (let a = 0; a < NA; a++) {
          const p = i * (NA + 1) + a;
          const q = p + NA + 1;
          idx.push(p, q, p + 1, p + 1, q, q + 1);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    })();
    g.add(new THREE.Mesh(neckGeo, this.backMat));
    // 指板面（与面板齐平）
    const fb = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.ebony);
    fb.scale.set(0.062, Y_NUT - BODY_TOP + 0.02, 1);
    fb.position.set(0, (BODY_TOP + Y_NUT) / 2 - 0.01, 0.0004);
    g.add(fb);
    // 山口（骨质）
    const nut = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.008, 0.02), this.bone);
    nut.position.set(0, Y_NUT + 0.002, 0.009);
    g.add(nut);

    // 弦槽：向后弯折的槽形头，四个轸子左右交错
    const head = new THREE.Group();
    head.position.set(0, Y_NUT + 0.004, -0.004);
    head.rotation.x = -0.32;
    const HL = 0.15;
    const wall = (x) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.009, HL, 0.036), this.backMat);
      m.position.set(x, HL / 2, -0.012);
      head.add(m);
    };
    wall(0.0235);
    wall(-0.0235);
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(0.056, HL, 0.008), this.backMat);
    backWall.position.set(0, HL / 2, -0.03);
    head.add(backWall);
    const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.038, HL - 0.01), this.dark);
    slot.position.set(0, HL / 2, -0.0255);
    head.add(slot);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.012, 0.044), this.backMat);
    cap.position.set(0, HL + 0.004, -0.012);
    head.add(cap);
    // 轸子：锥形轴 + 竹节形把手
    const pegProf = [];
    const P = [[0, 0.0045], [0.03, 0.0048], [0.05, 0.0055], [0.055, 0.009], [0.062, 0.0105], [0.072, 0.0098], [0.078, 0.0112], [0.09, 0.0102], [0.097, 0.0068], [0.1, 0.0]];
    for (const [yy, r] of P) pegProf.push(new THREE.Vector2(r, yy));
    const pegGeo = new THREE.LatheGeometry(pegProf, 14);
    this.pegPositions = [];
    [[0.03, 1], [0.064, -1], [0.098, 1], [0.128, -1]].forEach(([h, s]) => {
      const peg = new THREE.Mesh(pegGeo, this.ebony);
      peg.position.set(-0.012 * s, h, -0.012);
      peg.rotation.z = -s * Math.PI / 2;
      peg.rotation.y = s * 0.15;
      head.add(peg);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.004, 10, 8), this.bone);
      tip.position.set(0.104 * s - 0.012 * s, h, -0.012 + 0.016 * s * 0.0);
      head.add(tip);
      this.pegPositions.push(new THREE.Vector3(0, h, -0.012));
    });
    // 如意琴头：云头形轮廓挤出，骨质镶边
    const ry = new THREE.Shape();
    ry.moveTo(0, 0);
    ry.bezierCurveTo(-0.026, 0.0, -0.034, 0.022, -0.022, 0.034);
    ry.bezierCurveTo(-0.036, 0.048, -0.026, 0.07, -0.008, 0.064);
    ry.bezierCurveTo(-0.006, 0.078, 0.006, 0.078, 0.008, 0.064);
    ry.bezierCurveTo(0.026, 0.07, 0.036, 0.048, 0.022, 0.034);
    ry.bezierCurveTo(0.034, 0.022, 0.026, 0.0, 0, 0);
    const ruyi = new THREE.Mesh(new THREE.ExtrudeGeometry(ry, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.002, bevelSegments: 3, curveSegments: 14 }), this.ebony);
    ruyi.position.set(0, HL + 0.008, -0.022);
    head.add(ruyi);
    const inlay = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0016, 8, 24), this.bone);
    inlay.position.set(0, HL + 0.045, -0.0025);
    head.add(inlay);
    g.add(head);
    this.head = head;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    mergeStatic(g);
    this.inst.add(g);
  }

  // 相：琴颈上的六个高楔形骨片；品：面板上的二十四根竹片，越往下越矮
  #buildFrets() {
    const g = new THREE.Group();
    this.fretTops = [];
    for (let n = 1; n <= PIPA_FRETS; n++) {
      const y = fretY(n);
      const top = stringZ(y) - 0.0014;
      if (n <= 6) {
        const w = lerp(0.056, 0.068, (n - 1) / 5);
        const shape = new THREE.Shape();
        shape.moveTo(-w / 2, 0);
        shape.lineTo(w / 2, 0);
        shape.lineTo(w / 2 - 0.003, top);
        shape.lineTo(-w / 2 + 0.003, top);
        shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.009, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 1 });
        geo.rotateX(Math.PI / 2);
        geo.translate(0, y + 0.0045, 0);
        g.add(new THREE.Mesh(geo, this.bone));
      } else {
        const w = Math.min(2 * halfW(y) - 0.02, lerp(0.075, 0.11, (n - 7) / 23));
        const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0028, w, 8, 1), this.bamboo);
        pin.rotation.z = Math.PI / 2;
        pin.scale.set(1, 1, top / 0.0028 * 0.5);
        pin.position.set(0, y, faceZ(0, y) + top * 0.5);
        g.add(pin);
      }
      this.fretTops.push(top);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    mergeStatic(g);
    this.inst.add(g);
  }

  #buildStrings() {
    this.vib = [];
    this.dead = [];
    this.pickables = [];
    const pickMat = new THREE.MeshBasicMaterial({ visible: false });
    const up = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < 4; i++) {
      const radius = [0.00045, 0.00055, 0.0006, 0.0008][i];
      const color = i === 0 ? 0xe4e2dc : 0xcbb48a;
      const v = new VibString({ radius, color, metal: true, up, maxAmp: 0.0026 - 0.0003 * i }).addTo(this.inst);
      const d = new VibString({ radius, color, metal: true, up, maxAmp: 0.001 }).addTo(this.inst);
      v.set(this.#pt(i, Y_BRIDGE), this.#pt(i, Y_NUT));
      d.set(this.#pt(i, Y_NUT - 0.01), this.#pt(i, Y_NUT));
      d.mesh.visible = false;
      this.vib.push(v);
      this.dead.push(d);
      // 拾取：自最低一品之下到山口
      const a = this.#pt(i, Y_BRIDGE + 0.04);
      const b = this.#pt(i, Y_NUT - 0.005);
      const dir = new THREE.Vector3().subVectors(b, a);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.0105, dir.length(), 0.02), pickMat);
      box.position.copy(a).addScaledVector(dir, 0.5);
      box.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      box.userData = { inst: 'pipa', string: i };
      this.inst.add(box);
      this.pickables.push(box);
    }
    // 系弦的弦尾：覆手孔到弦槽轸子
    this.pluckPts = [0, 1, 2, 3].map((i) => this.#pt(i, Y_PLUCK));
  }

  #pt(i, y, out = new THREE.Vector3()) {
    return out.set(stringX(i, y), y, faceZ(stringX(i, y), Math.min(y, BODY_TOP)) * (y < BODY_TOP ? 1 : 0) + stringZ(y));
  }

  /** 第 i 弦按在第 n 品时，手指按弦点（品的上方、靠山口一侧）。 */
  #pressPt(i, n, out = new THREE.Vector3()) {
    const y = n <= 0 ? Y_NUT : lerp(fretY(n), fretY(n - 1), 0.35);
    return this.#pt(i, y, out);
  }

  // ───────────────────────────── 手 ─────────────────────────────

  #rightPose(f) {
    const R = this.right;
    // 弹奏预备：食指屈于弦前，其余手指半屈，拇指立起
    R.pose([[0.35, 0.3], 1.0, 1.15, 1.25, 1.35]);
    if (f === 0) R.setFinger(0, 0.15, 0.1);
  }

  #leftPose(finger) {
    const Lh = this.left;
    Lh.pose([[0.75, 0.2], 0.95, 1.0, 1.05, 1.1]);
    if (finger > 0) {
      Lh.setFinger(finger, 1.3, 0);
      for (let k = 1; k < finger; k++) Lh.setFinger(k, 1.25, 0);
    }
  }

  #rightRoot(f, target) {
    this.#rightPose(f);
    this.right.group.position.set(0, 0, 0);
    this.right.placeTip(f, target);
    return this.right.group.position.clone();
  }

  #leftRoot(finger, target) {
    this.#leftPose(finger);
    this.left.group.position.set(0, 0, 0);
    this.left.placeTip(finger, target);
    return this.left.group.position.clone();
  }

  #cacheRoots() {
    this.inst.updateMatrixWorld(true);
    // 右手：食指（弹）与拇指（挑）落在各弦弹奏点时的腕位；指尖先在弦的一侧
    this.rCache = [0, 1].map((f) => [0, 1, 2, 3].map((i) => {
      const p = this.pluckPts[i].clone();
      p.x += f === 1 ? -0.004 : 0.004;
      p.z += 0.002;
      return this.#rightRoot(f, p);
    }));
    this.rightRest = this.rCache[1][1].clone().add(new THREE.Vector3(-0.02, -0.02, 0.04));
    // 左手：各弦各品、各手指的腕位（按需计算后缓存）
    this.lCache = new Map();
    this.leftRest = this.#leftRootFor(1, 3, 1).clone().add(new THREE.Vector3(0.008, 0, 0.03));
  }

  #leftRootFor(string, fret, finger) {
    const key = `${string}:${fret}:${finger}`;
    let r = this.lCache.get(key);
    if (!r) {
      const p = this.#pressPt(string, fret);
      p.z += 0.0015;
      r = this.#leftRoot(finger, p);
      this.lCache.set(key, r);
    }
    return r;
  }

  /** 预计算：每个音的右手手指、左手手指与把位。 */
  prepare(notes) {
    let pos = 2;
    let dir = 1;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      n._s = n.s ?? 0;
      const fret = Math.round(n.f ?? 0);
      n._fret = fret;
      // 左手把位：食、中、无名、小指各管相邻一品；超出范围则换把，让中指落在目标品
      if (fret > 0) {
        if (fret < pos || fret > pos + 3) pos = Math.max(1, fret - 1);
        n._lf = clamp(fret - pos + 1, 1, 4);
        n._pos = pos;
      } else {
        n._lf = 0;
        n._pos = pos;
      }
      // 右手：连续单音弹、挑交替；轮指、扫拂、和音另计
      if (n.k === 'lun' || n.tr) n._rf = 'lun';
      else if (n.k === 'sao' || n.k === 'chord') n._rf = 'sao';
      else if (n.k === 'jiao') n._rf = 'sao';
      else {
        const prev = notes[i - 1];
        if (prev && n.t - prev.t < 0.3 && prev._rf !== 'lun' && prev._rf !== 'sao') dir = -dir;
        else dir = 1;
        n._rf = dir > 0 ? 'tan' : 'tiao';
      }
    }
  }

  /** 实时演奏：string 弦、fret 品（0 为空弦）。 */
  pluckLive(string, fret, vel, time) {
    const n = { t: time, d: 1.2, s: string, f: fret, v: vel, k: 'note', m: OPEN[string] + fret };
    const last = this.liveNotes[this.liveNotes.length - 1];
    this.prepare(last ? [last, n] : [n]);
    this.liveNotes.push(n);
    if (this.liveNotes.length > 400) this.liveNotes.splice(0, 200);
  }

  releaseLive(time) {
    for (const n of this.liveNotes) if (n.t + n.d > time) n.d = Math.max(0.05, time - n.t);
  }

  /** 弦上拾取点 → { string, fret }：手指按在该点下方（靠覆手一侧）的品上。 */
  pitchAt(worldPoint, string) {
    const y = this.inst.worldToLocal(worldPoint.clone()).y;
    let fret = 0;
    for (let n = 1; n <= PIPA_FRETS; n++) if (fretY(n) >= y - 0.004) fret = n;
    if (y < fretY(PIPA_FRETS) - 0.01) fret = 0;
    return { string, fret, midi: OPEN[string] + fret };
  }

  #ampOf(n, tau) {
    if (tau < 0) return 0;
    const A = (0.0024 - 0.0003 * n._s) * (0.4 + 0.6 * (n.v ?? 0.6));
    if (n.tr && tau < n.d) return A * 0.8 * (0.85 + 0.15 * Math.sin(tau * 110));
    const T = 0.9 - 0.02 * (n._fret || 0);
    let a = A * Math.exp(-tau / T) * Math.min(1, tau / 0.004 + 0.2);
    if (n.tr) a = A * 0.8 * Math.exp(-(tau - n.d) / T);
    if ((n._fret || 0) > 0 && tau > n.d) a *= Math.exp(-(tau - n.d) * 18); // 抬指止音
    if (n.k === 'jiao') a *= Math.exp(-tau * 10);
    return a;
  }

  update(dt, src) {
    const { notes, time } = src;
    this.inst.updateMatrixWorld(true);
    this.onsets.update(notes, time, (n) => {
      if (n.tr && Math.random() < 0.5) return;
      const p = this.inst.localToWorld(this.pluckPts[n._s ?? 0].clone());
      const nrm = new THREE.Vector3(0, 0, 1).transformDirection(this.inst.matrixWorld);
      const v = n.v ?? 0.6;
      this.effects.ripple(p, 0.035 + 0.035 * v, v, src.clock, 0, nrm, null, 0.8);
      if (n.k === 'jiao' || n.k === 'sao') this.effects.sparks(p, nrm, v * 0.7, 4, 0.14);
    });

    // 弦振幅与按弦点
    this.amps.fill(0);
    this.stops.fill(0);
    const i0 = lastStarted(notes, time);
    for (let k = i0; k >= 0 && notes[k].t > time - 3; k--) {
      const n = notes[k];
      const s = n._s ?? 0;
      const a = this.#ampOf(n, time - n.t);
      if (a > this.amps[s]) {
        this.amps[s] = a;
        if (this.stops[s] === 0) this.stops[s] = time < n.t + n.d + 0.05 ? (n._fret || 0) : 0;
      }
    }

    // ── 右手 ──
    const cur = i0 >= 0 ? notes[i0] : null;
    const next = notes[i0 + 1] || null;
    const tau = cur ? time - cur.t : 99;
    const R = this.right;
    const root = this._v;
    const rf = cur ? cur._rf : 'tan';
    const fIdx = rf === 'tiao' ? 0 : 1;
    const rootOf = (n) => this.rCache[n && n._rf === 'tiao' ? 0 : 1][n ? n._s : 1];
    if (!cur && !next) root.copy(this.rightRest);
    else if (!cur) root.copy(this.rightRest).lerp(rootOf(next), easeInOut(smooth(next.t - 0.6, next.t - 0.05, time)));
    else {
      root.copy(rootOf(cur));
      if (next && next.t - time < 0.5) {
        const gap = next.t - cur.t;
        const Tm = Math.min(0.12, gap * 0.7);
        const w = easeInOut(clamp((time - (next.t - Tm)) / Tm, 0, 1));
        if (w > 0) root.lerp(rootOf(next), w);
      } else if (time > cur.t + cur.d + 0.8) {
        root.lerp(this.rightRest, easeInOut(smooth(cur.t + cur.d + 0.8, cur.t + cur.d + 1.8, time)));
      }
    }
    this.#rightPose(fIdx);
    let push = 0;
    if (cur && tau < 0.4) {
      if (rf === 'lun' && tau < cur.d) {
        // 轮指：小 → 无名 → 中 → 食 依次向外弹出，拇指挑回，一轮五下
        const ph = (tau * 17.5) % 5;
        const order = [4, 3, 2, 1, 0];
        for (let k = 0; k < 5; k++) {
          const f = order[k];
          const act = Math.max(0, 1 - Math.abs(ph - k - 0.5) * 1.6);
          if (f === 0) R.setFinger(0, 0.35 - 0.3 * act, 0.3 + 0.2 * act);
          else R.setFinger(f, [0, 1.0, 1.15, 1.25, 1.35][f] - 0.75 * act, 0.05 * (f - 2) * act);
        }
        push = 0.0015 * Math.sin(tau * 2 * Math.PI * 3.5);
      } else if (rf === 'sao') {
        // 扫：食指伸出，整只手自子弦一侧划过四弦
        const u = smooth(0, 0.05, tau);
        R.setFinger(1, 1.0 - 0.8 * u, 0);
        push = lerp(-0.03, 0.03, u) * (1 - smooth(0.12, 0.4, tau));
      } else {
        const stroke = smooth(0, 0.04, tau) * (1 - smooth(0.06, 0.35, tau));
        if (rf === 'tiao') {
          R.setFinger(0, 0.15 - 0.3 * stroke, 0.1);
          push = -0.008 * stroke;
        } else {
          R.setFinger(1, 1.0 - 0.8 * stroke, 0);
          push = 0.008 * stroke;
        }
      }
    }
    R.group.position.copy(root);
    R.group.position.x += push;
    if (!cur || tau > 1.2) R.group.position.y += 0.003 * Math.sin(src.clock * 1.2);

    // ── 左手：按品、换把、推拉、吟揉 ──
    const Lh = this.left;
    const lroot = this._w;
    let lcur = null;
    for (let k = i0; k >= 0 && k > i0 - 6; k--) if (notes[k]._fret > 0) { lcur = notes[k]; break; }
    let lnext = null;
    for (let k = i0 + 1; k < notes.length && k < i0 + 6; k++) if (notes[k]._fret > 0) { lnext = notes[k]; break; }
    const rootL = (n) => this.#leftRootFor(n._s, n._fret, n._lf);
    let finger = 0;
    if (!lcur && !lnext) lroot.copy(this.leftRest);
    else if (!lcur) lroot.copy(this.leftRest).lerp(rootL(lnext), easeInOut(smooth(lnext.t - 0.5, lnext.t - 0.04, time)));
    else {
      lroot.copy(rootL(lcur));
      finger = time < lcur.t + lcur.d + 0.05 ? lcur._lf : 0;
      if (lnext && lnext.t - time < 0.25) {
        const Tm = Math.min(0.1, (lnext.t - lcur.t) * 0.6);
        const w = easeInOut(clamp((time - (lnext.t - Tm)) / Math.max(0.02, Tm), 0, 1));
        if (w > 0) { lroot.lerp(rootL(lnext), w); if (w > 0.5) finger = lnext._lf; }
      } else if (time > lcur.t + lcur.d + 1.0) {
        lroot.lerp(this.leftRest, easeInOut(smooth(lcur.t + lcur.d + 1.0, lcur.t + lcur.d + 2.0, time)));
        finger = 0;
      }
      const lt = time - lcur.t;
      // 推拉：手指把弦往演奏者左侧推；吟：小幅往复
      if (lcur.b && lt < lcur.d) lroot.x += 0.006 * smooth(0.04, 0.2, lt) * Math.sign(lcur.b || 1);
      else if (lcur.vib && lt > 0.3 && lt < lcur.d) lroot.x += 0.0022 * (0.5 - 0.5 * Math.cos((lt - 0.3) * 2 * Math.PI * 5.5));
    }
    this.#leftPose(finger);
    Lh.group.position.copy(lroot);

    // 弦：按品时振动段自按弦点到覆手
    for (let i = 0; i < 4; i++) {
      const fr = this.stops[i];
      const top = fr > 0 ? this.#pressPt(i, fr, new THREE.Vector3()) : this.#pt(i, Y_NUT);
      if (fr > 0) top.z = faceZ(top.x, Math.min(top.y, BODY_TOP)) * (top.y < BODY_TOP ? 1 : 0) + this.fretTops[fr - 1] + 0.0006;
      this.vib[i].set(this.#pt(i, Y_BRIDGE), top);
      this.vib[i].update(this.amps[i], dt);
      // 空弦时山口到按弦点的一段长度为零，隐藏
      const nut = this.#pt(i, Y_NUT);
      const open = fr <= 0;
      this.dead[i].mesh.visible = !open;
      if (!open) {
        this.dead[i].set(top, nut);
        this.dead[i].update(0, dt);
      }
    }
    this.focus.set(0, 0.36, 0.02);
    this.inst.localToWorld(this.focus);
  }
}
