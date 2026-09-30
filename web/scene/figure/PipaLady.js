// 琵琶女：孔雀蓝真丝旗袍（大襟、立领、象牙白滚边与盘扣、及踝下摆）、侧分低髻与碧玉簪、珍珠耳坠，
// 坐绣墩，琵琶竖抱于左腿。上身随力度微微前倾，目光多在左手按品处，随强音轻点头。
import * as THREE from 'three';
import { Figure, armLayers } from './Figure.js';
import { Head } from './Head.js';
import { HEAD_PRESETS } from './presets.js';
import { pipaHair, swingDangles } from './hairstyles.js';
import { torso, surfaceBand, limb, shoe, drumStool, frogButton } from './build.js';
import { loft } from './Loft.js';
import { paintFabric, fabricMaterial, plum, medallion, vineBand } from './fabric.js';
import { HeadMotion } from './Performers.js';
import { mulberry32 } from '../noise.js';
import { lastStarted } from '../anim.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

export class PipaLady extends Figure {
  /** @param pipa Pipa 实例；@param handMats 与手同一套皮肤材质 */
  constructor(pipa, handMats) {
    super('pipaLady');
    this.pipa = pipa;
    this.handMats = handMats;
    pipa.group.add(this.root);
    this.skeleton({ waist: V(0, 0.56, -0.012), neck: V(0, 0.95, -0.026), head: V(0, 1.097, 0.024), headPitch: 0.26 });
    this.#materials();
    this.#torso();
    this.#skirt();
    this.#headAndHair();
    this.#arms();
    this.#stoolAndShoes();
    this.motion = new HeadMotion();
    this.nod = 0;
    this.nodV = 0;
    this.sway = { roll: 0, yaw: 0, pitch: 0 };
    this.onsetIdx = -1;
  }

  #materials() {
    // 旗袍：孔雀蓝真丝，暗金缠枝与白梅
    const silk = paintFabric({
      W: 1024, H: 1024, seed: 71, weave: 0.04, fine: 1.4,
      draw: (g, W, H) => {
        const gr = g.createLinearGradient(0, 0, 0, H);
        gr.addColorStop(0, '#1f4660');
        gr.addColorStop(1, '#173a52');
        g.fillStyle = gr;
        g.fillRect(0, 0, W, H);
        for (let y = 0; y < 9; y++) {
          vineBand(g, 0, (y + 0.2) * (H / 9), W, H / 18, 'rgba(200,160,80,0.35)', 1.6);
          for (let x = 0; x < 9; x++) plum(g, (x + (y % 2) * 0.5) * (W / 9), (y + 0.65) * (H / 9), W / 70, 'rgba(240,236,226,0.85)', '#d8b060');
        }
      },
    });
    this.silkMat = fabricMaterial(silk, { silk: true, sheenColor: 0x9fd0ff, bump: 0.2 });
    const sleeve = paintFabric({
      W: 512, H: 256, seed: 72, weave: 0.04, fine: 1.4,
      draw: (g, W, H) => {
        g.fillStyle = '#1c4059';
        g.fillRect(0, 0, W, H);
        for (let x = 0; x < 6; x++) plum(g, (x + 0.5) * (W / 6), H * 0.6, W / 36, 'rgba(240,236,226,0.85)', '#d8b060');
        // v = 1 端（画布顶部）为袖口：象牙白滚边
        g.fillStyle = '#efe6d2';
        g.fillRect(0, 0, W, 16);
        g.fillStyle = '#c9a050';
        g.fillRect(0, 16, W, 3);
      },
    });
    this.sleeveMat = fabricMaterial(sleeve, { silk: true, sheenColor: 0x9fd0ff, bump: 0.2 });
    this.pipingMat = new THREE.MeshPhysicalMaterial({ color: 0xefe6d2, roughness: 0.4, sheen: 1, sheenColor: new THREE.Color(0xffffff) });
    this.goldMat = new THREE.MeshStandardMaterial({ color: 0xd9aa55, metalness: 1, roughness: 0.3 });
  }

  #torso() {
    const secs = [
      { y: 0.5, rx: 0.14, rzF: 0.095, rzB: 0.1 },
      { y: 0.57, rx: 0.13, rzF: 0.088, rzB: 0.09 },
      { y: 0.64, rx: 0.112, rzF: 0.08, rzB: 0.078 },
      { y: 0.71, rx: 0.114, rzF: 0.088, rzB: 0.076, cz: 0.004 },
      { y: 0.78, rx: 0.125, rzF: 0.1, rzB: 0.078, cz: 0.006 },
      { y: 0.835, rx: 0.13, rzF: 0.1, rzB: 0.08, cz: 0.004 },
      { y: 0.885, rx: 0.15, rzF: 0.082, rzB: 0.08, n: 2.2 },
      { y: 0.915, rx: 0.162, rzF: 0.07, rzB: 0.073, n: 2.4, cz: -0.006 },
      { y: 0.94, rx: 0.14, rzF: 0.06, rzB: 0.065, n: 2.3, cz: -0.012 },
      { y: 0.96, rx: 0.085, rzF: 0.05, rzB: 0.055, cz: -0.018 },
      { y: 0.978, rx: 0.055, rzF: 0.044, rzB: 0.046, cz: -0.02 },
    ];
    const rnd = mulberry32(73);
    const folds = Array.from({ length: 6 }, () => [rnd() * 6, rnd() * 3 + 2, rnd() * 0.5 + 0.2]);
    const T = torso(secs, {
      disp: (a, t, p) => {
        let d = 0;
        for (const [ph, k, amp] of folds) d += Math.sin(a * k + ph + p.y * 30) * amp;
        return d * 0.0008;
      },
    });
    this.T = T;
    const body = new THREE.Mesh(T.geo, this.silkMat);
    body.castShadow = true;
    body.receiveShadow = true;
    this.chest.add(body);
    // 大襟：自领口斜向右腋，再沿右侧下行；象牙白滚边与三对盘扣
    const path = [[Math.PI / 2, 0.972], [Math.PI / 2 + 0.3, 0.955], [Math.PI / 2 + 0.75, 0.92], [Math.PI - 0.3, 0.87], [Math.PI - 0.22, 0.76], [Math.PI - 0.2, 0.6]];
    const edge = surfaceBand(T, path, { width: 0.008, lift: 0.0025, material: this.pipingMat });
    this.chest.add(edge.mesh);
    for (const u of [0.05, 0.3, 0.52]) {
      const p = edge.curve.getPointAt(u);
      const n = edge.nCurve.getPointAt(u).normalize();
      const tan = edge.curve.getTangentAt(u);
      const b = frogButton(this.pipingMat, 0.8);
      b.position.copy(p).addScaledVector(n, 0.003);
      b.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(tan, n).normalize(), tan, n));
      this.chest.add(b);
    }
    // 立领与领口滚边
    const collar = new THREE.Mesh(loft([
      { c: V(0, 0.966, -0.02), rx: 0.056, rzF: 0.047, rzB: 0.05 },
      { c: V(0, 1.0, -0.016), rx: 0.048, rzF: 0.043, rzB: 0.046 },
      { c: V(0, 1.024, -0.012), rx: 0.046, rzF: 0.041, rzB: 0.045 },
    ], { rings: 4, segs: 40 }), this.silkMat);
    collar.castShadow = true;
    this.chest.add(collar);
    const collarEdge = new THREE.Mesh(new THREE.TorusGeometry(1, 0.0025, 6, 48), this.pipingMat);
    collarEdge.scale.set(0.046, 0.043, 1);
    collarEdge.rotation.x = Math.PI / 2;
    collarEdge.position.set(0, 1.025, -0.012);
    this.chest.add(collarEdge);
    const neck = new THREE.Mesh(loft([
      { c: V(0, 0.94, -0.02), rx: 0.046, rzF: 0.041, rzB: 0.043 },
      { c: V(0, 0.99, -0.014), rx: 0.039, rzF: 0.038, rzB: 0.04 },
      { c: V(0, 1.035, -0.004), rx: 0.036, rzF: 0.035, rzB: 0.038 },
      { c: V(0, 1.072, 0.006), rx: 0.036, rzF: 0.033, rzB: 0.039 },
    ], { rings: 10, segs: 32 }), this.handMats.skin);
    neck.castShadow = true;
    this.neckInner.add(neck);
  }

  // 旗袍下身：贴身的臀、大腿与膝，下摆自膝头垂到小腿中部（两腿并拢，一片裹住），其下露出小腿
  #skirt() {
    const hip = [0.082, 0.5, 0.03];
    const knee = [0.074, 0.49, 0.42];
    const ankle = [0.074, 0.075, 0.47];
    this.legPts = { hip, knee, ankle };
    // 臀：坐在凳面上，下缘收拢
    const seat = new THREE.Mesh(loft([
      { c: V(0, 0.575, -0.004), rx: 0.138, rzF: 0.097, rzB: 0.1 },
      { c: V(0, 0.53, 0.0), rx: 0.158, rzF: 0.115, rzB: 0.118 },
      { c: V(0, 0.49, 0.0), rx: 0.16, rzF: 0.12, rzB: 0.12 },
      { c: V(0, 0.45, 0.0), rx: 0.14, rzF: 0.1, rzB: 0.1 },
    ], { rings: 10, segs: 48, cap1: true }), this.silkMat);
    seat.castShadow = true;
    this.lower.add(seat);
    for (const s of [-1, 1]) {
      const H = V(hip[0] * s, hip[1], hip[2]);
      const K = V(knee[0] * s, knee[1], knee[2]);
      const thigh = new THREE.Mesh(limb([H.clone().add(V(0, 0.01, -0.04)), H, H.clone().lerp(K, 0.5), K, K.clone().add(V(0, -0.012, 0.03))],
        [[0.08, 0.075], [0.078, 0.074], [0.07, 0.066], [0.06, 0.058], [0.052, 0.05]], {
          rings: 20, segs: 22, disp: (a, t) => 0.0015 * Math.sin(a * 5 + t * 18 + s),
        }), this.silkMat);
      thigh.castShadow = true;
      thigh.receiveShadow = true;
      this.lower.add(thigh);
    }
    // 下摆：自膝头垂下的一片，截面为包住两条小腿的圆角横条，下缘略外张
    const hem = new THREE.Mesh(loft([
      { c: V(0, 0.5, 0.425), rx: 0.135, rzF: 0.055, rzB: 0.05, n: 2.6 },
      { c: V(0, 0.44, 0.45), rx: 0.138, rzF: 0.058, rzB: 0.05, n: 2.6 },
      { c: V(0, 0.34, 0.462), rx: 0.136, rzF: 0.055, rzB: 0.048, n: 2.5 },
      { c: V(0, 0.24, 0.47), rx: 0.14, rzF: 0.056, rzB: 0.05, n: 2.4 },
      { c: V(0, 0.2, 0.472), rx: 0.144, rzF: 0.058, rzB: 0.052, n: 2.4 },
    ], { rings: 16, segs: 48, cap0: true, disp: (a, t, p) => 0.002 * Math.sin(a * 7 + p.y * 40) * (1 - (p.y - 0.2) / 0.3) }), this.silkMat);
    hem.castShadow = true;
    hem.receiveShadow = true;
    this.lower.add(hem);
    const hemEdge = new THREE.Mesh(new THREE.TorusGeometry(1, 0.0022, 6, 64), this.pipingMat);
    hemEdge.scale.set(0.144, 0.055, 1);
    hemEdge.rotation.x = Math.PI / 2;
    hemEdge.position.set(0, 0.2, 0.472);
    this.lower.add(hemEdge);
    // 露出的小腿
    for (const s of [-1, 1]) {
      const K = V(knee[0] * s, knee[1], knee[2]);
      const A = V(ankle[0] * s, ankle[1], ankle[2]);
      const shin = new THREE.Mesh(limb([K.clone().lerp(A, 0.55), K.clone().lerp(A, 0.8), A], [[0.036, 0.035], [0.031, 0.03], [0.028, 0.027]], { rings: 10, segs: 16 }), this.handMats.skin);
      shin.castShadow = true;
      this.lower.add(shin);
    }
  }

  #headAndHair() {
    const pr = HEAD_PRESETS.pipa;
    this.head = new Head(pr.face, pr.look);
    this.headHolder.add(this.head.group);
    this.hair = pipaHair(this.head);
    this.head.group.add(this.hair);
    const ear = this.head.P.ear;
    this.earrings = [];
    const pearlMat = new THREE.MeshPhysicalMaterial({ color: 0xf8f2ea, roughness: 0.15, clearcoat: 1, iridescence: 0.6, sheen: 1 });
    for (const s of [1, -1]) {
      const sw = new THREE.Group();
      sw.position.set((ear.c[0] + 0.003) * s, ear.c[1] - ear.h * 0.95, ear.c[2] + 0.004);
      const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.004, 12, 10), pearlMat);
      pearl.position.y = -0.007;
      sw.add(pearl);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.0016, 8, 6), this.goldMat);
      cap.position.y = -0.002;
      sw.add(cap);
      this.head.group.add(sw);
      this.earrings.push({ g: sw, a: 0, v: 0, b: 0, vb: 0, len: 0.01 });
    }
  }

  #arms() {
    const pp = this.pipa;
    const common = {
      skin: this.handMats.skin, sleeve: this.sleeveMat, cuffAt: 0.68, sleeveR: [0.05, 0.046], cuffR: [0.047, 0.043],
      drape: 0.01, fold: 0.03, wrist: [0.025, 0.017], fore: [0.031, 0.027],
    };
    this.addArm(-1, { hand: pp.right, shoulder: V(-0.138, 0.885, -0.012), upper: 0.27, fore: 0.235, pole: V(-0.9, -0.8, -0.1), layers: armLayers(common) });
    this.addArm(1, { hand: pp.left, shoulder: V(0.138, 0.885, -0.012), upper: 0.27, fore: 0.235, pole: V(0.7, -1.2, -0.15), layers: armLayers(common) });
  }

  #stoolAndShoes() {
    const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x241410, roughness: 0.35, clearcoat: 0.9, clearcoatRoughness: 0.15 });
    const cushTex = paintFabric({
      W: 256, H: 256, seed: 74, weave: 0.08,
      draw: (g, W, H) => {
        g.fillStyle = '#6a1a1c';
        g.fillRect(0, 0, W, H);
        medallion(g, W / 2, H / 2, W * 0.3, '#c9a050', '#3a0a0c');
      },
    });
    const stool = drumStool({ r: 0.15, h: 0.44, body: lacquer, gold: this.goldMat, cushion: fabricMaterial(cushTex, { silk: true, bump: 0.4 }) });
    stool.position.z = -0.02;
    this.lower.add(stool);
    const upper = new THREE.MeshPhysicalMaterial({ color: 0x1a1414, roughness: 0.3, clearcoat: 0.8 });
    const sole = new THREE.MeshStandardMaterial({ color: 0x100c0c, roughness: 0.6 });
    for (const s of [-1, 1]) {
      const heel = V(this.legPts.ankle[0] * s, 0, this.legPts.ankle[2] - 0.03);
      const toe = V(this.legPts.ankle[0] * s * 1.2, 0, this.legPts.ankle[2] + 0.17);
      this.lower.add(shoe(heel, toe, { width: 0.036, height: 0.05, upper, sole, soleH: 0.02 }));
    }
  }

  update(dt, src) {
    this.t += dt;
    const t = src.clock ?? this.t;
    const notes = src.notes || [];
    const i = lastStarted(notes, src.time);
    if (i !== this.onsetIdx) {
      if (i >= 0 && i > this.onsetIdx && src.time - notes[i].t < 0.1 && (notes[i].v ?? 0.6) > 0.55) this.nodV += 0.3 * (notes[i].v ?? 0.6);
      this.onsetIdx = i;
    }
    this.nodV += (-60 * this.nod - 9 * this.nodV) * dt;
    this.nod += this.nodV * dt;
    // 上身：抱琴微微右倾，随力度前倾；呼吸
    const breath = Math.sin(t * 1.5) * 0.006;
    const energy = (this.pipa.amps[0] + this.pipa.amps[1] + this.pipa.amps[2] + this.pipa.amps[3]) / 0.006;
    this.sway.pitch = damp(this.sway.pitch, 0.06 + 0.04 * clamp(energy, 0, 1), 2, dt);
    this.sway.roll = damp(this.sway.roll, -0.05 + Math.sin(t * 0.37) * 0.02, 2, dt);
    this.sway.yaw = damp(this.sway.yaw, 0.08 + Math.sin(t * 0.23) * 0.03, 2, dt);
    this.spine.rotation.set(this.sway.pitch + breath + this.nod * 0.25, this.sway.yaw, this.sway.roll, 'YXZ');
    this.neck.rotation.set(this.nod + Math.sin(t * 0.5) * 0.02, this.sway.yaw * 0.5 + 0.12, 0.06 + Math.sin(t * 0.31) * 0.03, 'YXZ');
    this.updateArms();
    // 注视：多半看左手按品，时而看右手
    const lw = this.pipa.left.group.getWorldPosition(new THREE.Vector3());
    const rw = this.pipa.right.group.getWorldPosition(new THREE.Vector3());
    this.head.lookAtWorld(lw.lerp(rw, 0.3 + 0.25 * Math.sin(t * 0.21)));
    this.head.update(dt);
    const w = this.motion.update(this.head.group, dt);
    swingDangles(this.earrings, dt, { x: -w.z * dt * 2 + Math.sin(t * 1.1) * 0.0004, y: w.x * dt * 2 });
  }
}
