// 三位乐师：古筝少女（齐胸襦裙、大袖、步摇）、二胡盲眼老琴师（长衫、毡帽、墨镜）、陕北唢呐匠（对襟袄、羊肚手巾、红腰带）。
// 人物放在各自乐器的组坐标系中；手由乐器演奏逻辑驱动，人物用 IK 手臂接上并做呼吸、随乐摆动、注视、眨眼等动作。
import * as THREE from 'three';
import { Figure, armLayers } from './Figure.js';
import { Head } from './Head.js';
import { HEAD_PRESETS } from './presets.js';
import { girlHair, girlLongHair, swingDangles, oldmanHair, suonaHair, surfacePoint } from './hairstyles.js';
import { hairTube, ribbonStrip } from './Hair.js';
import { torso, surfaceBand, limb, shoe, drumStool, squareStool, frogButton } from './build.js';
import { drapeCloth, clothGeometry } from './Cloth.js';
import { loft } from './Loft.js';
import { paintFabric, fabricMaterial, plum, cloud, medallion, vineBand } from './fabric.js';
import { mulberry32 } from '../noise.js';
import { lastStarted } from '../anim.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const shadowAll = (o) => o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });

// 头部角速度 → 步摇激励
class HeadMotion {
  constructor() {
    this.q = new THREE.Quaternion();
    this.w = new THREE.Vector3();
    this.first = true;
  }

  update(obj, dt) {
    const q = obj.getWorldQuaternion(new THREE.Quaternion());
    if (this.first) {
      this.q.copy(q);
      this.first = false;
    }
    const dq = q.clone().multiply(this.q.clone().invert());
    const ang = 2 * Math.acos(clamp(dq.w, -1, 1));
    const axis = new THREE.Vector3(dq.x, dq.y, dq.z);
    if (axis.lengthSq() > 1e-12) axis.normalize().multiplyScalar(ang / Math.max(dt, 1e-3));
    else axis.set(0, 0, 0);
    this.w.lerp(axis, 0.5);
    this.q.copy(q);
    return this.w;
  }
}

// ═════════════════════════════ 古筝少女 ═════════════════════════════

export class GuzhengGirl extends Figure {
  /** @param gz Guzheng 实例；@param handMats 与手同一套皮肤材质 */
  constructor(gz, handMats) {
    super('guzhengGirl');
    this.gz = gz;
    this.handMats = handMats;
    // 坐在琴的演奏者一侧（组坐标 +z），面向琴（−z）
    this.root.position.set(0.3, 0, 0.5);
    this.root.rotation.y = Math.PI;
    gz.group.add(this.root);
    this.skeleton({ waist: V(0, 0.58, -0.01), neck: V(0, 0.975, -0.025), head: V(0, 1.122, 0.028), headPitch: 0.3 });
    this.spine.rotation.x = 0.1;

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
    // 上襦：月白绫，暗织云纹
    const top = paintFabric({
      W: 512, H: 512, seed: 3, weave: 0.05, fine: 1.4,
      draw: (g, W, H) => {
        g.fillStyle = '#d5dce1';
        g.fillRect(0, 0, W, H);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) cloud(g, (x + (y % 2) * 0.5) * (W / 8), (y + 0.5) * (H / 8), W / 14, 'rgba(150,170,185,0.35)', 2);
      },
    });
    this.topMat = fabricMaterial(top, { silk: true, sheenColor: 0xdfe8ff, bump: 0.25 });
    // 缘边：绛红地、金线卷草
    const band = paintFabric({
      W: 512, H: 64, seed: 4, weave: 0.08, fine: 2,
      draw: (g, W, H) => {
        g.fillStyle = '#7a1418';
        g.fillRect(0, 0, W, H);
        g.fillStyle = '#c9a050';
        g.fillRect(0, 3, W, 3);
        g.fillRect(0, H - 6, W, 3);
        vineBand(g, 0, 10, W, H - 20, '#d8b060', 2.2);
      },
    });
    band.map.repeat.set(6, 1);
    band.bumpMap.repeat.set(6, 1);
    this.bandMat = fabricMaterial(band, { silk: true, sheenColor: 0xffc080, bump: 0.6 });
    // 裙：石榴红，暗花团窠，裙摆金线缘
    const skirt = paintFabric({
      W: 1024, H: 512, seed: 6, weave: 0.05, fine: 1.2,
      draw: (g, W, H) => {
        const gr = g.createLinearGradient(0, 0, 0, H);
        gr.addColorStop(0, '#b8222c');
        gr.addColorStop(0.75, '#a41c26');
        gr.addColorStop(1, '#8a1620');
        g.fillStyle = gr;
        g.fillRect(0, 0, W, H);
        for (let y = 0; y < 6; y++) for (let x = 0; x < 16; x++) medallion(g, (x + (y % 2) * 0.5) * (W / 16), (y + 0.4) * (H / 7), W / 70, 'rgba(210,90,80,0.28)', 'rgba(120,10,20,0.35)');
        // 下摆缘边
        g.fillStyle = '#6a0e14';
        g.fillRect(0, H - 46, W, 46);
        g.fillStyle = '#d4a650';
        g.fillRect(0, H - 48, W, 3);
        g.fillRect(0, H - 10, W, 2);
        vineBand(g, 0, H - 42, W, 30, '#d9b25e', 2);
      },
    });
    this.skirtMat = fabricMaterial(skirt, { silk: true, sheenColor: 0xff9080, bump: 0.3 });
    // 中衣（内衬）：素白
    const inner = paintFabric({ W: 128, H: 128, seed: 8, weave: 0.05, draw: (g, W, H) => { g.fillStyle = '#e4ded4'; g.fillRect(0, 0, W, H); } });
    this.innerMat = fabricMaterial(inner, { silk: true, bump: 0.2 });
    // 大袖：月白，袖口宽缘
    const sleeve = paintFabric({
      W: 512, H: 512, seed: 9, weave: 0.05, fine: 1.4,
      draw: (g, W, H) => {
        g.fillStyle = '#d5dce1';
        g.fillRect(0, 0, W, H);
        for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) cloud(g, (x + (y % 2) * 0.5) * (W / 6), (y + 0.6) * (H / 7), W / 11, 'rgba(150,170,185,0.32)', 2);
        // v = 1（画布顶部）为袖口
        g.fillStyle = '#7a1418';
        g.fillRect(0, 0, W, 58);
        g.fillStyle = '#c9a050';
        g.fillRect(0, 2, W, 3);
        g.fillRect(0, 54, W, 3);
        vineBand(g, 0, 10, W, 40, '#d8b060', 2.4);
      },
    });
    this.sleeveMat = fabricMaterial(sleeve, { silk: true, sheenColor: 0xdfe8ff, bump: 0.25 });
    this.goldMat = new THREE.MeshStandardMaterial({ color: 0xd9aa55, metalness: 1, roughness: 0.3 });
  }

  // 躯干：腰以上放样；贴图按高度与方位分区（裙腰、束胸带下的裙、上襦、交领内的中衣）
  #torso() {
    const secs = [
      { y: 0.52, rx: 0.13, rzF: 0.09, rzB: 0.095 },
      { y: 0.58, rx: 0.124, rzF: 0.084, rzB: 0.086 },
      { y: 0.645, rx: 0.114, rzF: 0.08, rzB: 0.078 },
      { y: 0.72, rx: 0.121, rzF: 0.088, rzB: 0.078, cz: 0.004 },
      { y: 0.79, rx: 0.13, rzF: 0.1, rzB: 0.08, cz: 0.004 },
      { y: 0.845, rx: 0.136, rzF: 0.1, rzB: 0.082, cz: 0.002 },
      { y: 0.9, rx: 0.156, rzF: 0.084, rzB: 0.08, n: 2.2 },
      { y: 0.93, rx: 0.168, rzF: 0.072, rzB: 0.074, n: 2.4, cz: -0.006 },
      { y: 0.955, rx: 0.145, rzF: 0.062, rzB: 0.066, n: 2.3, cz: -0.012 },
      { y: 0.976, rx: 0.09, rzF: 0.052, rzB: 0.056, cz: -0.018 },
      { y: 0.995, rx: 0.056, rzF: 0.045, rzB: 0.046, cz: -0.02 },
    ];
    const rnd = mulberry32(21);
    const folds = Array.from({ length: 6 }, () => [rnd() * 6, rnd() * 3 + 2, rnd() * 0.5 + 0.2]);
    const T = torso(secs, {
      // 衣褶：腰部与腋下的细褶
      disp: (a, t, p) => {
        let d = 0;
        for (const [ph, k, amp] of folds) d += Math.sin(a * k + ph + p.y * 30) * amp;
        return d * 0.0012 * (p.y < 0.8 ? 1 : 0.6);
      },
    });
    this.T = T;
    const tieY = 0.795;
    // 贴图：按 (u, v) 分区上色，再叠织纹
    const W = 1024;
    const H = 512;
    const tex = paintFabric({
      W, H, seed: 12, weave: 0.05, fine: 1.2,
      draw: (g) => {
        const row = (y) => (1 - T.vOf(y)) * H;
        // 裙腰（石榴红）
        g.fillStyle = '#b1212b';
        g.fillRect(0, row(tieY), W, H - row(tieY));
        for (let x = 0; x < 24; x++) {
          g.fillStyle = 'rgba(90,8,16,0.25)';
          g.fillRect((x / 24) * W, row(tieY), 3, H);
        }
        // 上襦（月白）
        g.fillStyle = '#d3dadf';
        g.fillRect(0, 0, W, row(tieY) + 1);
        for (let y = 0; y < 4; y++) for (let x = 0; x < 20; x++) cloud(g, (x + (y % 2) * 0.5) * (W / 20), (y + 0.5) * (row(tieY) / 4), W / 50, 'rgba(150,170,185,0.3)', 1.6);
        // 交领内露出的中衣（前中 V 形）
        const uF = T.uOf(Math.PI / 2);
        g.fillStyle = '#e6e0d6';
        g.beginPath();
        g.moveTo((uF - 0.075) * W, row(1.0));
        g.lineTo((uF + 0.075) * W, row(1.0));
        g.lineTo((uF + 0.012) * W, row(0.875));
        g.lineTo((uF - 0.01) * W, row(0.875));
        g.closePath();
        g.fill();
      },
    });
    const mat = fabricMaterial(tex, { silk: true, sheenColor: 0xffe0e0, bump: 0.25 });
    const body = new THREE.Mesh(T.geo, mat);
    body.castShadow = true;
    body.receiveShadow = true;
    this.chest.add(body);
    // 交领：外襟（左襟压右襟，右衽）与内襟
    const outer = [[-Math.PI / 2, 0.998], [-0.6, 0.996], [0.25, 0.99], [Math.PI / 2 - 0.55, 0.972], [Math.PI / 2 - 0.2, 0.93], [Math.PI / 2 + 0.12, 0.87], [Math.PI / 2 + 0.34, tieY + 0.004]];
    const innerC = [[-Math.PI / 2, 0.996], [-Math.PI + 0.6, 0.994], [Math.PI - 0.25, 0.988], [Math.PI / 2 + 0.55, 0.97], [Math.PI / 2 + 0.2, 0.925], [Math.PI / 2 - 0.1, 0.87], [Math.PI / 2 - 0.3, tieY + 0.004]];
    const c1 = surfaceBand(T, outer, { width: 0.03, lift: 0.0055, material: this.bandMat });
    const c2 = surfaceBand(T, innerC, { width: 0.028, lift: 0.0035, material: this.bandMat });
    this.chest.add(c1.mesh, c2.mesh);
    // 束胸带：金线织锦带环绕，前中打结，两条长带垂到膝上
    const tie = loft([
      { c: V(0, tieY - 0.022, 0.004), rx: 0.133, rzF: 0.099, rzB: 0.084 },
      { c: V(0, tieY - 0.004, 0.004), rx: 0.137, rzF: 0.105, rzB: 0.086 },
      { c: V(0, tieY + 0.014, 0.004), rx: 0.138, rzF: 0.105, rzB: 0.087 },
    ], { rings: 6, segs: 64, vByLength: false });
    const beltTex = paintFabric({
      W: 1024, H: 64, seed: 14, weave: 0.08, fine: 2,
      draw: (g, W2, H2) => {
        g.fillStyle = '#8a1a1c';
        g.fillRect(0, 0, W2, H2);
        g.fillStyle = '#d5a854';
        g.fillRect(0, 4, W2, 3);
        g.fillRect(0, H2 - 7, W2, 3);
        for (let x = 0; x < W2; x += 40) plum(g, x + 20, H2 / 2, 9, '#e0b860', '#8a1a1c');
      },
    });
    const belt = new THREE.Mesh(tie, fabricMaterial(beltTex, { silk: true, sheenColor: 0xffc080, bump: 0.5 }));
    belt.castShadow = true;
    this.chest.add(belt);
    const front = T.at(Math.PI / 2 + 0.05, tieY, 0.012).p;
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), this.bandMat);
    knot.scale.set(1.3, 0.8, 0.7);
    knot.position.copy(front);
    this.chest.add(knot);
    for (const s of [-1, 1]) {
      const loopC = new THREE.CatmullRomCurve3([
        front.clone().add(V(0.004 * s, 0, 0.004)), front.clone().add(V(0.028 * s, 0.014, 0.008)), front.clone().add(V(0.042 * s, 0.0, 0.012)),
        front.clone().add(V(0.03 * s, -0.012, 0.01)), front.clone().add(V(0.006 * s, -0.002, 0.006)),
      ]);
      const bow = new THREE.Mesh(ribbonStrip(loopC, { w: () => 0.016, normal: V(0, 0, 1), seg: 20 }), this.bandMat);
      this.chest.add(bow);
      // 飘带：沿裙前垂下，搭在腿上
      const pts = [
        front.clone().add(V(0.005 * s, -0.008, 0.006)),
        V(0.012 * s, 0.72, T.at(Math.PI / 2, 0.72).p.z + 0.012),
        V(0.02 * s, 0.63, T.at(Math.PI / 2, 0.63).p.z + 0.02),
        V(0.03 * s, 0.585, 0.16),
        V(0.036 * s, 0.57, 0.27),
        V(0.04 * s, 0.566, 0.33),
      ];
      const tail = new THREE.Mesh(ribbonStrip(pts, { w: (t) => 0.02 - 0.004 * t, normal: (t) => V(0, t > 0.5 ? 1 : 0.4, t > 0.5 ? 0.2 : 1).normalize(), seg: 30 }), this.bandMat);
      tail.castShadow = true;
      this.chest.add(tail);
    }
    // 颈
    const neck = new THREE.Mesh(loft([
      { c: V(0, 0.95, -0.018), rx: 0.05, rzF: 0.044, rzB: 0.046 },
      { c: V(0, 0.995, -0.012), rx: 0.041, rzF: 0.04, rzB: 0.042 },
      { c: V(0, 1.035, -0.004), rx: 0.037, rzF: 0.037, rzB: 0.039 },
      { c: V(0, 1.075, 0.006), rx: 0.037, rzF: 0.034, rzB: 0.04 },
    ], { rings: 10, segs: 32 }), this.handMats.skin);
    neck.castShadow = true;
    this.neckInner.add(neck);
  }

  // 下裙：自腰口以位置动力学悬垂，搭在大腿、膝头并垂到地面
  #skirt() {
    const N = 48;
    const ring = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2;
      ring.push(V(Math.cos(a) * 0.132, 0.585, Math.sin(a) * 0.094));
    }
    const hip = [0.086, 0.5, 0.03];
    const knee = [0.078, 0.488, 0.43];
    const ankle = [0.072, 0.075, 0.47];
    this.legPts = { hip, knee, ankle };
    const cols = [
      { type: 'ellipsoid', c: V(0, 0.5, -0.015), rx: 0.165, ry: 0.085, rz: 0.13 },
      { type: 'cylinder', c: V(0, 0, 0), r: 0.17, y0: 0, y1: 0.43 },
    ];
    for (const s of [-1, 1]) {
      const H = V(hip[0] * s, hip[1], hip[2]);
      const K = V(knee[0] * s, knee[1], knee[2]);
      const A = V(ankle[0] * s, ankle[1], ankle[2]);
      cols.push({ type: 'capsule', a: H, b: K, r0: 0.075, r1: 0.056 });
      cols.push({ type: 'sphere', c: K, r: 0.056 });
      cols.push({ type: 'capsule', a: K, b: A, r0: 0.046, r1: 0.034 });
      cols.push({ type: 'capsule', a: A, b: V(ankle[0] * s * 1.2, 0.035, 0.62), r0: 0.036, r1: 0.03 });
    }
    const t0 = performance.now();
    const sim = drapeCloth({ ring, rows: 28, length: 1.08, hemScale: 5, ramp: 0.12, tent: 0.62, colliders: cols, floor: 0, steps: 170, iters: 6, lift: 0.12, thickness: 0.007, friction: 0.8 });
    this.skirtMs = performance.now() - t0;
    const geo = clothGeometry(sim, { sub: 2, pleats: 36, pleatAmp: 0.0045, pleatFade: 0.45 });
    const skirt = new THREE.Mesh(geo, this.skirtMat);
    skirt.castShadow = true;
    skirt.receiveShadow = true;
    this.lower.add(skirt);
  }

  #headAndHair() {
    const pr = HEAD_PRESETS.girl;
    this.head = new Head(pr.face, pr.look);
    this.headHolder.add(this.head.group);
    const hair = girlHair(this.head);
    this.head.group.add(hair);
    this.hair = hair;
    // 耳坠：金钩与珍珠
    const ear = this.head.P.ear;
    this.earrings = [];
    for (const s of [1, -1]) {
      const sw = new THREE.Group();
      sw.position.set((ear.c[0] + 0.003) * s, ear.c[1] - ear.h * 0.95, ear.c[2] + 0.004);
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.0028, 0.0005, 6, 12, Math.PI * 1.4), this.goldMat);
      hook.rotation.y = Math.PI / 2;
      sw.add(hook);
      const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.0034, 12, 10), new THREE.MeshPhysicalMaterial({ color: 0xf8f2ea, roughness: 0.15, clearcoat: 1, iridescence: 0.6, sheen: 1 }));
      pearl.position.y = -0.011;
      sw.add(pearl);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.0016, 8, 6), this.goldMat);
      cap.position.y = -0.0075;
      sw.add(cap);
      this.head.group.add(sw);
      this.earrings.push({ g: sw, a: 0, v: 0, b: 0, vb: 0, len: 0.014 });
    }
    // 垂发：挂在胸腔上，自后脑垂到背中
    this.chest.updateMatrixWorld(true);
    const mats = { tip: hair.userData.hairTipMat };
    const headC = this.headHolder.position;
    const long = girlLongHair(mats, (t) => {
      const x = t * 0.05;
      return [
        V(x * 0.9, headC.y - 0.02, headC.z - 0.075),
        V(x * 1.05, headC.y - 0.075, headC.z - 0.092),
        V(x * 1.25, 0.975, -0.098),
        V(x * 1.45, 0.9, -0.11),
        V(x * 1.5, 0.8, -0.108),
        V(x * 1.45, 0.7, -0.1),
      ];
    });
    this.chest.add(long);
  }

  #arms() {
    const gz = this.gz;
    const common = {
      skin: this.handMats.skin, sleeve: this.sleeveMat, inner: this.innerMat,
      cuffAt: 0.8, sleeveR: [0.052, 0.048], cuffR: [0.1, 0.085], drape: 0.15, fold: 0.05, innerCuff: 0.9,
      wrist: [0.026, 0.017], fore: [0.032, 0.028],
    };
    this.addArm(-1, { hand: gz.right, shoulder: V(-0.142, 0.9, -0.008), upper: 0.27, fore: 0.232, pole: V(-0.8, -0.7, -0.35), layers: armLayers(common) });
    this.addArm(1, { hand: gz.left, shoulder: V(0.142, 0.9, -0.008), upper: 0.27, fore: 0.232, pole: V(0.8, -0.75, -0.3), layers: armLayers(common) });
  }

  #stoolAndShoes() {
    const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x5a1410, roughness: 0.35, clearcoat: 0.9, clearcoatRoughness: 0.15 });
    const cushTex = paintFabric({
      W: 256, H: 256, seed: 31, weave: 0.08,
      draw: (g, W, H) => {
        g.fillStyle = '#2e4a3a';
        g.fillRect(0, 0, W, H);
        medallion(g, W / 2, H / 2, W * 0.3, '#c9a050', '#8a2020');
      },
    });
    const stool = drumStool({ r: 0.158, h: 0.43, body: lacquer, gold: this.goldMat, cushion: fabricMaterial(cushTex, { silk: true, bump: 0.4 }) });
    this.lower.add(stool);
    // 翘头绣鞋，只露鞋尖
    const shoeTex = paintFabric({
      W: 256, H: 128, seed: 33, weave: 0.08,
      draw: (g, W, H) => {
        g.fillStyle = '#9c1e26';
        g.fillRect(0, 0, W, H);
        for (let x = 0; x < W; x += 64) plum(g, x + 32, H / 2, 12, '#e8c070', '#9c1e26');
      },
    });
    const upper = fabricMaterial(shoeTex, { silk: true, bump: 0.4 });
    const sole = new THREE.MeshStandardMaterial({ color: 0xf0e8d8, roughness: 0.8 });
    for (const s of [-1, 1]) {
      const heel = V(this.legPts.ankle[0] * s, 0, this.legPts.ankle[2] - 0.035);
      const toe = V(this.legPts.ankle[0] * s * 1.25, 0, this.legPts.ankle[2] + 0.19);
      this.lower.add(shoe(heel, toe, { width: 0.04, height: 0.055, upturn: 0.012, upper, sole, soleH: 0.012 }));
    }
  }

  update(dt, src) {
    this.t += dt;
    const t = src.clock ?? this.t;
    const notes = src.notes || [];
    // 随音头轻点头（弹簧）
    const i = lastStarted(notes, src.time);
    if (i !== this.onsetIdx) {
      if (i >= 0 && i > this.onsetIdx && src.time - notes[i].t < 0.1) this.nodV += 0.35 * (notes[i].v ?? 0.6);
      this.onsetIdx = i;
    }
    this.nodV += (-60 * this.nod - 9 * this.nodV) * dt;
    this.nod += this.nodV * dt;
    // 上身：朝两手中点微倾，左手远按时侧身
    const L = this.arms[1];
    const R = this.arms[0];
    const cx = (L.W.x + R.W.x) / 2;
    const lr = clamp((L.W.x - 0.24) * 0.5, -0.12, 0.12);
    const breath = Math.sin(t * 1.6) * 0.006;
    this.sway.roll = damp(this.sway.roll, -lr * 0.8 + Math.sin(t * 0.37) * 0.015, 3, dt);
    this.sway.yaw = damp(this.sway.yaw, clamp(cx * 0.4, -0.15, 0.15) + Math.sin(t * 0.23) * 0.02, 3, dt);
    this.spine.rotation.set(0.1 + breath + this.nod * 0.3, this.sway.yaw, this.sway.roll, 'YXZ');
    this.neck.rotation.set(this.nod + Math.sin(t * 0.5) * 0.02, this.sway.yaw * 0.6, -this.sway.roll * 0.5 + Math.sin(t * 0.31) * 0.03, 'YXZ');
    this.updateArms();
    // 注视：右手拨弦点为主，按音时偶尔看左手
    const target = new THREE.Vector3();
    const rw = this.gz.right.group.getWorldPosition(new THREE.Vector3());
    const lw = this.gz.left.group.getWorldPosition(new THREE.Vector3());
    const pressing = this.gz.left.group.position.y < this.gz.leftRest.y - 0.02;
    target.copy(rw).lerp(lw, pressing ? 0.55 : 0.2);
    target.y -= 0.03;
    this.head.lookAtWorld(target);
    this.head.update(dt);
    const w = this.motion.update(this.head.group, dt);
    const ex = { x: -w.z * dt * 2 + Math.sin(t * 1.1) * 0.0004, y: w.x * dt * 2 };
    swingDangles(this.hair.userData.dangles, dt, ex);
    swingDangles(this.earrings, dt, ex);
  }
}

// ═════════════════════════════ 二胡老琴师 ═════════════════════════════

export class ErhuOldMan extends Figure {
  constructor(erhu, handMats) {
    super('erhuOldMan');
    this.erhu = erhu;
    this.handMats = handMats;
    this.root.position.set(-0.19, 0, -0.34);
    erhu.group.add(this.root);
    this.skeleton({ waist: V(0, 0.52, -0.02), neck: V(0, 0.915, -0.035), head: V(0, 1.075, 0.02), headPitch: -0.14 });
    this.#materials();
    this.#torso();
    this.#gown();
    this.#legs();
    this.#headGear();
    this.#arms();
    const stool = squareStool({ w: 0.36, d: 0.3, h: 0.37, wood: this.woodMat });
    stool.position.set(0, 0, -0.03);
    this.lower.add(stool);
    this.sway = { roll: 0, yaw: 0, pitch: 0 };
  }

  #materials() {
    // 长衫：洗旧的灰蓝土布
    const gown = paintFabric({
      W: 1024, H: 512, seed: 41, weave: 0.1, fine: 1.1, worn: 0.8,
      draw: (g, W, H) => {
        g.fillStyle = '#4c5a66';
        g.fillRect(0, 0, W, H);
        // 补丁与磨白
        g.fillStyle = 'rgba(120,130,135,0.25)';
        g.fillRect(W * 0.62, H * 0.55, 60, 48);
        g.strokeStyle = 'rgba(30,36,40,0.5)';
        g.setLineDash([3, 3]);
        g.strokeRect(W * 0.62, H * 0.55, 60, 48);
        g.setLineDash([]);
      },
    });
    this.gownMat = fabricMaterial(gown, { bump: 0.5, rough: 0.9 });
    const sleeve = paintFabric({
      W: 512, H: 256, seed: 42, weave: 0.1, fine: 1.1, worn: 0.7,
      draw: (g, W, H) => {
        g.fillStyle = '#4c5a66';
        g.fillRect(0, 0, W, H);
        // 挽起的白色袖里（v = 1 端）
        g.fillStyle = '#d8d2c4';
        g.fillRect(0, 0, W, 30);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(0, 30, W, 3);
      },
    });
    this.sleeveMat = fabricMaterial(sleeve, { bump: 0.5, rough: 0.9 });
    const black = paintFabric({ W: 256, H: 256, seed: 43, weave: 0.12, worn: 0.5, draw: (g, W, H) => { g.fillStyle = '#1e1d1c'; g.fillRect(0, 0, W, H); } });
    this.trouserMat = fabricMaterial(black, { bump: 0.5, rough: 0.9 });
    this.shoeMat = new THREE.MeshStandardMaterial({ color: 0x151414, roughness: 0.85 });
    this.soleMat = new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.9 });
    this.woodMat = new THREE.MeshPhysicalMaterial({ color: 0x4a2c1a, roughness: 0.55, clearcoat: 0.3 });
    this.buttonMat = new THREE.MeshStandardMaterial({ color: 0x2a3036, roughness: 0.7 });
  }

  #torso() {
    const secs = [
      { y: 0.48, rx: 0.15, rzF: 0.11, rzB: 0.115 },
      { y: 0.55, rx: 0.14, rzF: 0.1, rzB: 0.1 },
      { y: 0.63, rx: 0.135, rzF: 0.098, rzB: 0.095, cz: 0.004 },
      { y: 0.72, rx: 0.145, rzF: 0.1, rzB: 0.098, cz: 0.0 },
      { y: 0.8, rx: 0.158, rzF: 0.098, rzB: 0.104, cz: -0.006 },
      { y: 0.855, rx: 0.176, rzF: 0.085, rzB: 0.1, n: 2.5, cz: -0.012 },
      { y: 0.89, rx: 0.172, rzF: 0.07, rzB: 0.088, n: 2.8, cz: -0.02 },
      { y: 0.912, rx: 0.12, rzF: 0.058, rzB: 0.07, cz: -0.028 },
      { y: 0.93, rx: 0.064, rzF: 0.052, rzB: 0.056, cz: -0.032 },
    ];
    const rnd = mulberry32(51);
    const folds = Array.from({ length: 7 }, () => [rnd() * 6, rnd() * 3 + 2, rnd() * 0.5 + 0.3]);
    const T = torso(secs, {
      disp: (a, t, p) => {
        let d = 0;
        for (const [ph, k, amp] of folds) d += Math.sin(a * k + ph + p.y * 25) * amp;
        return d * 0.0016;
      },
    });
    this.T = T;
    const body = new THREE.Mesh(T.geo, this.gownMat);
    body.castShadow = true;
    body.receiveShadow = true;
    this.chest.add(body);
    // 大襟：自领口斜向右腋再沿右侧下行，缘边与盘扣
    const path = [[Math.PI / 2, 0.925], [Math.PI / 2 + 0.35, 0.9], [Math.PI / 2 + 0.85, 0.855], [Math.PI - 0.25, 0.8], [Math.PI - 0.18, 0.66], [Math.PI - 0.16, 0.5]];
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x323c44, roughness: 0.85 });
    const edge = surfaceBand(T, path, { width: 0.012, lift: 0.0025, material: edgeMat });
    this.chest.add(edge.mesh);
    for (const u of [0.02, 0.22, 0.4, 0.6, 0.78]) {
      const p = edge.curve.getPointAt(u);
      const n = edge.nCurve.getPointAt(u).normalize();
      const tan = edge.curve.getTangentAt(u);
      const b = frogButton(this.buttonMat, 0.9);
      b.position.copy(p).addScaledVector(n, 0.003);
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(tan, n).normalize(), tan, n);
      b.quaternion.setFromRotationMatrix(m);
      this.chest.add(b);
    }
    // 立领
    const collar = new THREE.Mesh(loft([
      { c: V(0, 0.918, -0.03), rx: 0.064, rzF: 0.057, rzB: 0.058 },
      { c: V(0, 0.948, -0.026), rx: 0.058, rzF: 0.051, rzB: 0.054 },
    ], { rings: 3, segs: 40 }), this.gownMat);
    collar.castShadow = true;
    this.chest.add(collar);
    // 颈：瘦、喉结
    const neck = new THREE.Mesh(loft([
      { c: V(0, 0.9, -0.035), rx: 0.05, rzF: 0.045, rzB: 0.048 },
      { c: V(0, 0.95, -0.03), rx: 0.043, rzF: 0.044, rzB: 0.043 },
      { c: V(0, 0.99, -0.02), rx: 0.04, rzF: 0.046, rzB: 0.042 },
      { c: V(0, 1.03, -0.008), rx: 0.04, rzF: 0.038, rzB: 0.044 },
    ], { rings: 12, segs: 32, disp: (a, t, p) => 0.004 * Math.exp(-((a - Math.PI / 2) ** 2) / 0.04) * Math.exp(-((p.y - 0.985) ** 2) / 0.0002) }), this.handMats.skin);
    neck.castShadow = true;
    this.neckInner.add(neck);
  }

  #gown() {
    const N = 44;
    const ring = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2;
      ring.push(V(Math.cos(a) * 0.148, 0.52, Math.sin(a) * 0.112 + 0.0));
    }
    const hipL = V(0.09, 0.45, 0.02);
    const hipR = V(-0.09, 0.45, 0.02);
    this.knees = [V(0.21, 0.44, 0.44), V(-0.16, 0.44, 0.42)];
    this.ankles = [V(0.23, 0.08, 0.5), V(-0.2, 0.08, 0.47)];
    const cols = [
      { type: 'ellipsoid', c: V(0, 0.46, -0.02), rx: 0.17, ry: 0.09, rz: 0.14 },
      { type: 'box', min: V(-0.18, 0, -0.18), max: V(0.18, 0.37, 0.12) },
    ];
    [[hipL, 0], [hipR, 1]].forEach(([h, k]) => {
      cols.push({ type: 'capsule', a: h, b: this.knees[k], r0: 0.075, r1: 0.058 });
      cols.push({ type: 'sphere', c: this.knees[k], r: 0.058 });
      cols.push({ type: 'capsule', a: this.knees[k], b: this.ankles[k], r0: 0.05, r1: 0.04 });
    });
    const sim = drapeCloth({ ring, rows: 26, length: 0.9, hemScale: 2.6, ramp: 0.35, tent: 0.56, colliders: cols, floor: 0, steps: 170, iters: 6, lift: 0.12, thickness: 0.008, friction: 0.8 });
    const geo = clothGeometry(sim, { sub: 2 });
    const m = new THREE.Mesh(geo, this.gownMat);
    m.castShadow = true;
    m.receiveShadow = true;
    this.lower.add(m);
  }

  #legs() {
    const hips = [V(0.09, 0.45, 0.02), V(-0.09, 0.45, 0.02)];
    for (let k = 0; k < 2; k++) {
      const pts = [hips[k], hips[k].clone().lerp(this.knees[k], 0.5), this.knees[k], this.knees[k].clone().lerp(this.ankles[k], 0.5), this.ankles[k]];
      const leg = new THREE.Mesh(limb(pts, [[0.07, 0.065], [0.065, 0.06], [0.056, 0.056], [0.05, 0.048], [0.045, 0.042]], { rings: 20, segs: 20 }), this.trouserMat);
      leg.castShadow = true;
      this.lower.add(leg);
      const heel = V(this.ankles[k].x, 0, this.ankles[k].z - 0.04);
      const toe = V(this.ankles[k].x * 1.1, 0, this.ankles[k].z + 0.2);
      this.lower.add(shoe(heel, toe, { width: 0.048, height: 0.065, upper: this.shoeMat, sole: this.soleMat, soleH: 0.016 }));
    }
  }

  #headGear() {
    const pr = HEAD_PRESETS.oldman;
    this.head = new Head(pr.face, pr.look);
    this.headHolder.add(this.head.group);
    this.head.group.add(oldmanHair(this.head));
    // 毡帽：软顶压出前凹，宽檐前低后翘，帽带
    const felt = new THREE.MeshPhysicalMaterial({ color: 0x3a3430, roughness: 0.92, sheen: 1, sheenColor: new THREE.Color(0x6a605a), sheenRoughness: 0.6 });
    const hat = new THREE.Group();
    const prof = [];
    for (let k = 0; k <= 20; k++) {
      const t = k / 20;
      prof.push(new THREE.Vector2(0.086 - 0.012 * t * t + (t > 0.85 ? -(t - 0.85) * 0.35 : 0), t * 0.1));
    }
    prof.push(new THREE.Vector2(0.0, 0.098));
    const crownGeo = new THREE.LatheGeometry(prof, 48);
    // 捏出帽顶中缝与前侧两凹
    const p = crownGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const top = Math.max(0, (y - 0.06) / 0.04);
      const crease = Math.exp(-(x * x) / 0.0006) * top * 0.022;
      const pinch = Math.exp(-((Math.abs(x) - 0.04) ** 2) / 0.0004) * Math.max(0, z) / 0.09 * top * 0.012;
      p.setY(i, y - crease);
      p.setX(i, x * (1 - pinch * 8));
    }
    crownGeo.computeVertexNormals();
    crownGeo.scale(0.92, 1, 1.12);
    const crown = new THREE.Mesh(crownGeo, felt);
    hat.add(crown);
    // 帽檐：圆环，前檐下压、后檐上翘
    const brimGeo = new THREE.RingGeometry(0.07, 0.15, 56, 3);
    brimGeo.rotateX(-Math.PI / 2);
    const bp = brimGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i);
      const z = bp.getZ(i);
      const r = Math.hypot(x, z);
      const e = Math.max(0, (r - 0.085) / 0.065);
      const a = Math.atan2(x, z);
      bp.setY(i, (-0.018 * Math.cos(a) + 0.012 * Math.cos(2 * a) + 0.004) * e * e);
    }
    brimGeo.computeVertexNormals();
    brimGeo.scale(0.95, 1, 1.1);
    const brim = new THREE.Mesh(brimGeo, new THREE.MeshPhysicalMaterial({ color: 0x3a3430, roughness: 0.92, side: THREE.DoubleSide, sheen: 1, sheenColor: new THREE.Color(0x6a605a) }));
    hat.add(brim);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0865, 0.087, 0.02, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 0.6, side: THREE.DoubleSide }));
    band.scale.set(0.92, 1, 1.12);
    band.position.y = 0.012;
    hat.add(band);
    hat.position.set(0, 0.052, -0.012);
    hat.rotation.x = 0.1;
    shadowAll(hat);
    this.head.group.add(hat);
    // 圆墨镜：两片圆镜、细金属圈、鼻梁弓与镜腿
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a7a5a, metalness: 1, roughness: 0.35 });
    const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x040404, roughness: 0.04, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.8, side: THREE.DoubleSide });
    const glasses = new THREE.Group();
    const eyeC = this.head.P.eye.c;
    const LR = 0.0185;
    const lz = 0.093;
    for (const s of [1, -1]) {
      const c = V((eyeC[0] + 0.002) * s, eyeC[1] + 0.001, lz);
      // 微凸镜片
      const lensGeo = new THREE.SphereGeometry(LR * 3, 32, 8, 0, Math.PI * 2, 0, Math.asin(1 / 3));
      lensGeo.rotateX(Math.PI / 2);
      lensGeo.translate(0, 0, -LR * 3 * Math.cos(Math.asin(1 / 3)));
      const lens = new THREE.Mesh(lensGeo, lensMat);
      lens.position.copy(c);
      lens.rotation.y = s * 0.08;
      glasses.add(lens);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(LR, 0.0011, 8, 40), metal);
      rim.position.copy(c);
      rim.rotation.y = s * 0.08;
      glasses.add(rim);
      // 镜腿：自外缘向后搭到耳上
      const ear = this.head.P.ear.c;
      const armC = new THREE.CatmullRomCurve3([
        c.clone().add(V(LR * s, 0.002, -0.002)), V((eyeC[0] + LR + 0.008) * s, eyeC[1] + 0.005, lz - 0.02),
        V(0.074 * s, 0.008, 0.02), V((ear[0] + 0.004) * s, ear[1] + 0.022, ear[2] - 0.005), V((ear[0] - 0.002) * s, ear[1] + 0.004, ear[2] - 0.022),
      ]);
      glasses.add(new THREE.Mesh(new THREE.TubeGeometry(armC, 28, 0.001, 6, false), metal));
    }
    const bx = eyeC[0] + 0.002 - LR;
    const bridgeC = new THREE.CatmullRomCurve3([V(bx, eyeC[1] + 0.004, lz), V(0, eyeC[1] + 0.009, lz + 0.001), V(-bx, eyeC[1] + 0.004, lz)]);
    glasses.add(new THREE.Mesh(new THREE.TubeGeometry(bridgeC, 12, 0.001, 6, false), metal));
    this.head.group.add(glasses);
  }

  #arms() {
    const e = this.erhu;
    const common = {
      skin: this.handMats.skin, sleeve: this.sleeveMat, cuffAt: 0.9, sleeveR: [0.054, 0.05], cuffR: [0.05, 0.046],
      drape: 0.03, fold: 0.06, wrist: [0.027, 0.018], fore: [0.032, 0.029],
    };
    this.addArm(1, { hand: e.left, shoulder: V(0.152, 0.845, -0.028), upper: 0.29, fore: 0.255, pole: V(1, -0.6, -0.25), layers: armLayers(common) });
    this.addArm(-1, { hand: e.right, shoulder: V(-0.152, 0.845, -0.028), upper: 0.29, fore: 0.255, pole: V(-0.5, -1, -0.5), layers: armLayers(common) });
  }

  update(dt, src) {
    this.t += dt;
    const t = src.clock ?? this.t;
    // 运弓：身体随弓向右侧微转微倾
    const bx = this.erhu.bow.position.x;
    const p = clamp((0.035 - bx) / 0.7, 0, 1);
    const breath = Math.sin(t * 1.3) * 0.006;
    this.sway.yaw = damp(this.sway.yaw, -(p - 0.4) * 0.16 + Math.sin(t * 0.21) * 0.02, 3, dt);
    this.sway.roll = damp(this.sway.roll, -(p - 0.4) * 0.07 + Math.sin(t * 0.33) * 0.02, 3, dt);
    this.spine.rotation.set(0.12 + breath, this.sway.yaw, this.sway.roll, 'YXZ');
    // 盲人侧耳：头微仰、偏向左，随乐缓缓摇
    this.neck.rotation.set(-0.04 + Math.sin(t * 0.43) * 0.03, 0.12 - this.sway.yaw * 0.7 + Math.sin(t * 0.17) * 0.05, 0.07 - this.sway.roll * 0.6, 'YXZ');
    this.updateArms();
    this.head.update(dt);
  }
}

// ═════════════════════════════ 唢呐匠 ═════════════════════════════

export class SuonaMan extends Figure {
  constructor(suona, handMats) {
    super('suonaMan');
    this.suona = suona;
    this.handMats = handMats;
    this.root.position.set(0, 0, -0.52);
    suona.group.add(this.root);
    // 上身与唢呐同在“摆动架”上，唢呐始终衔在口中
    const rig = new THREE.Group();
    rig.position.set(0, 0.95, 0);
    const rigInner = new THREE.Group();
    rigInner.position.set(0, -0.95, 0);
    rig.add(rigInner);
    this.root.add(rig);
    this.rig = rig;
    this.root.updateMatrixWorld(true);
    rigInner.updateMatrixWorld(true);
    rigInner.attach(suona.inst);
    this.rigInner = rigInner;
    this.skeleton({ waist: V(0, 1.0, 0), neck: V(0, 1.4, -0.005), head: V(0, 1.548, 0.057), headPitch: -0.1 });
    // skeleton 默认挂在 root 上，改挂到摆动架
    rigInner.add(this.spine);
    this.#materials();
    this.#torso();
    this.#legs();
    this.#headGear();
    this.#arms();
    this.sway = { pitch: 0, roll: 0 };
    this.puff = 0;
    this.bob = 0;
    this.bobV = 0;
    this.onsetIdx = -1;
  }

  #materials() {
    const black = paintFabric({ W: 512, H: 512, seed: 61, weave: 0.12, fine: 1, worn: 0.4, draw: (g, W, H) => { g.fillStyle = '#1d1b1b'; g.fillRect(0, 0, W, H); } });
    this.jacketMat = fabricMaterial(black, { bump: 0.6, rough: 0.88, sheenColor: 0x606060 });
    const sleeve = paintFabric({
      W: 512, H: 256, seed: 62, weave: 0.12, worn: 0.4,
      draw: (g, W, H) => {
        g.fillStyle = '#1d1b1b';
        g.fillRect(0, 0, W, H);
        g.fillStyle = '#e8e2d6';
        g.fillRect(0, 0, W, 26);
      },
    });
    this.sleeveMat = fabricMaterial(sleeve, { bump: 0.6, rough: 0.88, sheenColor: 0x606060 });
    const trousers = paintFabric({ W: 256, H: 256, seed: 63, weave: 0.12, worn: 0.5, draw: (g, W, H) => { g.fillStyle = '#262a36'; g.fillRect(0, 0, W, H); } });
    this.trouserMat = fabricMaterial(trousers, { bump: 0.6, rough: 0.9 });
    const wrap = paintFabric({
      W: 256, H: 256, seed: 64, weave: 0.12,
      draw: (g, W, H) => {
        g.fillStyle = '#e6e0d2';
        g.fillRect(0, 0, W, H);
        g.strokeStyle = 'rgba(120,110,95,0.5)';
        g.lineWidth = 2;
        for (let y = -W; y < H; y += 22) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + W * 0.35); g.stroke(); }
      },
    });
    this.wrapMat = fabricMaterial(wrap, { bump: 0.7, rough: 0.9 });
    const sash = paintFabric({ W: 256, H: 128, seed: 65, weave: 0.06, draw: (g, W, H) => { g.fillStyle = '#b4161c'; g.fillRect(0, 0, W, H); } });
    this.sashMat = fabricMaterial(sash, { silk: true, sheenColor: 0xff6050, bump: 0.3 });
    this.shoeMat = new THREE.MeshStandardMaterial({ color: 0x121111, roughness: 0.85 });
    this.soleMat = new THREE.MeshStandardMaterial({ color: 0xdcd4c4, roughness: 0.9 });
    this.buttonMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.6 });
    const towel = paintFabric({
      W: 512, H: 512, seed: 66, weave: 0.14, fine: 0.8,
      draw: (g, W, H) => {
        g.fillStyle = '#eeeae0';
        g.fillRect(0, 0, W, H);
        g.fillStyle = '#3a5a8a';
        for (const y of [18, 30, H - 34, H - 22]) g.fillRect(0, y, W, 5);
      },
    });
    this.towelMat = fabricMaterial(towel, { bump: 1.2, rough: 0.95 });
  }

  #torso() {
    const secs = [
      { y: 0.8, rx: 0.17, rzF: 0.125, rzB: 0.13 },
      { y: 0.88, rx: 0.168, rzF: 0.118, rzB: 0.12 },
      { y: 0.96, rx: 0.158, rzF: 0.112, rzB: 0.108 },
      { y: 1.04, rx: 0.155, rzF: 0.11, rzB: 0.104 },
      { y: 1.14, rx: 0.165, rzF: 0.116, rzB: 0.108 },
      { y: 1.24, rx: 0.178, rzF: 0.115, rzB: 0.112, cz: -0.004 },
      { y: 1.31, rx: 0.19, rzF: 0.1, rzB: 0.108, n: 2.4, cz: -0.008 },
      { y: 1.36, rx: 0.196, rzF: 0.082, rzB: 0.095, n: 2.9, cz: -0.012 },
      { y: 1.385, rx: 0.15, rzF: 0.068, rzB: 0.078, n: 2.6, cz: -0.014 },
      { y: 1.405, rx: 0.072, rzF: 0.058, rzB: 0.062, cz: -0.012 },
    ];
    const rnd = mulberry32(71);
    const folds = Array.from({ length: 7 }, () => [rnd() * 6, rnd() * 3 + 2, rnd() * 0.5 + 0.3]);
    const T = torso(secs, {
      disp: (a, t, p) => {
        let d = 0;
        for (const [ph, k, amp] of folds) d += Math.sin(a * k + ph + p.y * 22) * amp;
        // 下摆外张
        return d * 0.0018 + (p.y < 0.86 ? (0.86 - p.y) * 0.08 : 0);
      },
    });
    this.T = T;
    const body = new THREE.Mesh(T.geo, this.jacketMat);
    body.castShadow = true;
    body.receiveShadow = true;
    this.chest.add(body);
    // 对襟：前中线白色一字盘扣七对
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x0e0d0d, roughness: 0.8 });
    const edge = surfaceBand(T, [[Math.PI / 2, 1.402], [Math.PI / 2, 1.25], [Math.PI / 2, 1.05], [Math.PI / 2, 0.82]], { width: 0.008, lift: 0.002, material: edgeMat });
    this.chest.add(edge.mesh);
    for (let k = 0; k < 7; k++) {
      const y = 1.37 - k * 0.075;
      const s = T.at(Math.PI / 2, y, 0.004);
      const b = frogButton(this.buttonMat, 1.1);
      b.position.copy(s.p);
      b.lookAt(s.p.clone().add(s.n));
      this.chest.add(b);
    }
    // 立领与白衬领
    const collar = new THREE.Mesh(loft([
      { c: V(0, 1.398, -0.012), rx: 0.072, rzF: 0.062, rzB: 0.064 },
      { c: V(0, 1.43, -0.01), rx: 0.064, rzF: 0.056, rzB: 0.06 },
    ], { rings: 3, segs: 40 }), this.jacketMat);
    this.chest.add(collar);
    const shirt = new THREE.Mesh(loft([
      { c: V(0, 1.425, -0.009), rx: 0.06, rzF: 0.052, rzB: 0.057 },
      { c: V(0, 1.44, -0.008), rx: 0.057, rzF: 0.05, rzB: 0.055 },
    ], { rings: 2, segs: 40 }), new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.8, side: THREE.DoubleSide }));
    this.chest.add(shirt);
    // 红腰带：绕腰一周，左前打结，两头垂下
    const sash = new THREE.Mesh(loft([
      { c: V(0, 0.93, 0), rx: 0.172, rzF: 0.124, rzB: 0.122 },
      { c: V(0, 0.96, 0), rx: 0.166, rzF: 0.12, rzB: 0.116 },
      { c: V(0, 0.99, 0), rx: 0.163, rzF: 0.118, rzB: 0.112 },
    ], { rings: 6, segs: 56 }), this.sashMat);
    sash.castShadow = true;
    this.chest.add(sash);
    const kp = T.at(Math.PI / 2 - 0.55, 0.96, 0.012).p;
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.02, 14, 10), this.sashMat);
    knot.scale.set(1.2, 0.9, 0.8);
    knot.position.copy(kp);
    this.chest.add(knot);
    for (const [dx, len] of [[-0.012, 0.3], [0.014, 0.25]]) {
      const pts = [kp.clone().add(V(dx, -0.01, 0.004)), kp.clone().add(V(dx * 1.6, -len * 0.35, 0.02)), kp.clone().add(V(dx * 2.2, -len * 0.7, 0.03)), kp.clone().add(V(dx * 2.4, -len, 0.03))];
      const tail = new THREE.Mesh(ribbonStrip(pts, { w: (t) => 0.05 + 0.02 * t, normal: V(0.4, 0, 1).normalize(), seg: 24, curl: () => 0.8 }), this.sashMat);
      tail.castShadow = true;
      this.chest.add(tail);
      this.tails = this.tails || [];
      this.tails.push(tail);
    }
    // 颈（粗）
    const neck = new THREE.Mesh(loft([
      { c: V(0, 1.38, -0.014), rx: 0.06, rzF: 0.054, rzB: 0.058 },
      { c: V(0, 1.43, -0.008), rx: 0.052, rzF: 0.05, rzB: 0.054 },
      { c: V(0, 1.475, 0.004), rx: 0.05, rzF: 0.046, rzB: 0.054 },
      { c: V(0, 1.51, 0.016), rx: 0.048, rzF: 0.042, rzB: 0.05 },
    ], { rings: 10, segs: 32 }), this.handMats.skin);
    neck.castShadow = true;
    this.neckInner.add(neck);
  }

  #legs() {
    // 站姿：两脚分开，左脚略前，膝微屈
    const hips = [V(0.095, 0.88, 0.0), V(-0.095, 0.88, 0.0)];
    const knees = [V(0.115, 0.48, 0.06), V(-0.12, 0.48, 0.03)];
    const ankles = [V(0.13, 0.085, 0.03), V(-0.14, 0.085, -0.02)];
    // 骨盆（裤裆）
    const pelvis = new THREE.Mesh(loft([
      { c: V(0, 0.8, 0), rx: 0.155, rzF: 0.11, rzB: 0.125 },
      { c: V(0, 0.88, 0), rx: 0.165, rzF: 0.115, rzB: 0.125 },
      { c: V(0, 0.96, 0), rx: 0.16, rzF: 0.11, rzB: 0.115 },
    ], { rings: 8, segs: 40, cap0: true }), this.trouserMat);
    this.lower.add(pelvis);
    for (let k = 0; k < 2; k++) {
      const s = k === 0 ? 1 : -1;
      const pts = [hips[k].clone().add(V(-0.01 * s, 0.03, 0)), hips[k], hips[k].clone().lerp(knees[k], 0.5), knees[k], knees[k].clone().lerp(ankles[k], 0.45), ankles[k]];
      const rnd = mulberry32(80 + k);
      const ph = rnd() * 6;
      const leg = new THREE.Mesh(limb(pts, [[0.085, 0.085], [0.08, 0.08], [0.07, 0.068], [0.058, 0.058], [0.055, 0.056], [0.05, 0.05]], {
        rings: 26, segs: 24,
        disp: (a, t) => 0.003 * Math.sin(a * 3 + ph + t * 14) * (t > 0.4 && t < 0.75 ? 1.4 : 0.6),
      }), this.trouserMat);
      leg.castShadow = true;
      this.lower.add(leg);
      // 绑腿
      const wrapPts = [knees[k].clone().lerp(ankles[k], 0.42), knees[k].clone().lerp(ankles[k], 0.7), ankles[k].clone().add(V(0, 0.005, 0))];
      const wrap = new THREE.Mesh(limb(wrapPts, [[0.052, 0.054], [0.046, 0.048], [0.043, 0.045]], { rings: 10, segs: 24 }), this.wrapMat);
      this.lower.add(wrap);
      const heel = V(ankles[k].x, 0, ankles[k].z - 0.045);
      const toe = V(ankles[k].x * 1.25 + 0.01 * s, 0, ankles[k].z + 0.21);
      this.lower.add(shoe(heel, toe, { width: 0.05, height: 0.068, upper: this.shoeMat, sole: this.soleMat, soleH: 0.018 }));
    }
  }

  #headGear() {
    const pr = HEAD_PRESETS.suona;
    this.head = new Head(pr.face, pr.look);
    this.headHolder.add(this.head.group);
    this.head.group.add(suonaHair(this.head));
    // 羊肚手巾：包住头顶，在前额偏上打结，两角上翘
    const g = new THREE.Group();
    const N = 40;
    const band = [];
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * Math.PI * 2;
      const dir = V(Math.sin(a), 0.38 + 0.12 * Math.cos(a), Math.cos(a));
      band.push(surfacePoint(this.head, dir, 0.006));
    }
    const bandCurve = new THREE.CatmullRomCurve3(band.slice(0, N), true);
    const roll = new THREE.Mesh(hairTube(bandCurve, { r: (t) => 0.0125 + 0.002 * Math.sin(t * Math.PI * 14), flat: 0.75, seg: 120, radial: 12, closed: true, twist: 3, rep: 4 }), this.towelMat);
    g.add(roll);
    // 顶部：头巾面覆盖头顶（径向外扩的球冠）
    const capGeo = new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, 1.05);
    const cp = capGeo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < cp.count; i++) {
      v.fromBufferAttribute(cp, i).normalize();
      const q = surfacePoint(this.head, v, 0.008 + 0.003 * Math.max(0, v.y));
      cp.setXYZ(i, q.x, q.y, q.z);
    }
    capGeo.computeVertexNormals();
    g.add(new THREE.Mesh(capGeo, this.towelMat));
    // 结与两角
    const front = surfacePoint(this.head, V(0, 0.55, 1), 0.018);
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.016, 14, 10), this.towelMat);
    knot.scale.set(1.3, 0.9, 0.9);
    knot.position.copy(front);
    g.add(knot);
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.05, 10, 1), this.towelMat);
      horn.scale.set(1, 1, 0.45);
      horn.position.copy(front).add(V(0.018 * s, 0.018, -0.004));
      horn.rotation.set(-0.35, 0, -s * 0.75);
      g.add(horn);
    }
    shadowAll(g);
    this.head.group.add(g);
  }

  #arms() {
    const su = this.suona;
    const common = {
      skin: this.handMats.skin, sleeve: this.sleeveMat, cuffAt: 0.88, sleeveR: [0.062, 0.058], cuffR: [0.056, 0.052],
      drape: 0.02, fold: 0.07, wrist: [0.029, 0.02], fore: [0.036, 0.033],
    };
    this.addArm(1, { hand: su.left, shoulder: V(0.168, 1.32, -0.014), upper: 0.3, fore: 0.265, pole: V(1, -0.9, -0.3), layers: armLayers(common) });
    this.addArm(-1, { hand: su.right, shoulder: V(-0.168, 1.32, -0.014), upper: 0.3, fore: 0.265, pole: V(-1, -0.9, -0.3), layers: armLayers(common) });
  }

  update(dt, src) {
    this.t += dt;
    const t = src.clock ?? this.t;
    const notes = src.notes || [];
    const i = lastStarted(notes, src.time);
    if (i !== this.onsetIdx) {
      if (i >= 0 && i > this.onsetIdx && src.time - notes[i].t < 0.1 && !notes[i].lg) this.bobV += 0.25 * (notes[i].v ?? 0.6);
      this.onsetIdx = i;
    }
    this.bobV += (-40 * this.bob - 7 * this.bobV) * dt;
    this.bob += this.bobV * dt;
    const glow = this.suona.glow;
    // 吹奏时后仰、随节拍前点；腮随气息鼓起
    this.sway.pitch = damp(this.sway.pitch, -0.05 * glow + Math.sin(t * 0.7) * 0.012, 2.5, dt);
    this.sway.roll = damp(this.sway.roll, Math.sin(t * 0.9) * 0.03 * (0.3 + glow), 2, dt);
    this.rig.rotation.set(this.sway.pitch + this.bob * 0.35, Math.sin(t * 0.4) * 0.02, this.sway.roll, 'YXZ');
    this.spine.rotation.set(Math.sin(t * 1.4) * 0.004, 0, 0);
    this.puff = damp(this.puff, clamp(glow * 1.25, 0, 1), glow > this.puff ? 14 : 5, dt);
    this.head.setPuff(this.puff);
    this.updateArms();
    this.head.setGaze(0, -0.15);
    this.head.update(dt);
  }
}
