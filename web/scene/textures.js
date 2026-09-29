// 程序化纹理：桐木 / 红木 / 竹、古筝面板、蟒皮、黄铜、漆器、殿堂地面墙面窗棂、山水屏风、地毯
import * as THREE from 'three';
import { ValueNoise, mulberry32, smoothstep, mix, clamp01 } from './noise.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(canvas, { srgb = false, repeat = false } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function imageToCanvas(data, w, h) {
  const c = makeCanvas(w, h);
  c.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
  return c;
}

// ───────────────────────────── 纹样基元 ─────────────────────────────

function spiralPoints(cx, cy, r, turns, a0, dir) {
  const pts = [];
  const steps = Math.max(12, Math.ceil(turns * 30));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = a0 + dir * t * turns * Math.PI * 2;
    const rr = r * (0.12 + 0.88 * t);
    pts.push([cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr]);
  }
  return pts;
}

// 云纹 S 形：两个反向涡卷由弧线相连
function cloudS(ctx, x, y, w, h, flip = false) {
  const r = Math.min(w * 0.24, h * 0.46);
  const ax = x + w * 0.25;
  const bx = x + w * 0.75;
  const cy = y + h * 0.5;
  const s = flip ? -1 : 1;
  const A = spiralPoints(ax, cy, r, 1.35, Math.PI / 2 * s, s);
  const B = spiralPoints(bx, cy, r, 1.35, -Math.PI / 2 * s, s).reverse();
  const a = A[A.length - 1];
  const b = B[0];
  ctx.beginPath();
  A.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.bezierCurveTo(a[0] + w * 0.2, a[1], b[0] - w * 0.2, b[1], b[0], b[1]);
  B.forEach(([px, py]) => ctx.lineTo(px, py));
  ctx.stroke();
}

// 回纹（方形螺旋）
function huiwen(ctx, x, y, s) {
  const k = s / 5;
  ctx.beginPath();
  ctx.moveTo(x, y + s);
  ctx.lineTo(x, y);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x + s, y + s - k);
  ctx.lineTo(x + k, y + s - k);
  ctx.lineTo(x + k, y + k);
  ctx.lineTo(x + s - k * 2, y + k);
  ctx.lineTo(x + s - k * 2, y + s - k * 2);
  ctx.lineTo(x + k * 2, y + s - k * 2);
  ctx.stroke();
}

function huiwenBand(ctx, x0, y0, x1, h, color, lw) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  const s = h;
  for (let x = x0; x + s <= x1; x += s * 1.15) huiwen(ctx, x, y0, s);
}

// 纵向书法题字（系统楷体，缺字体时退回衬线体）
function brushText(ctx, text, x, y, size, color, { vertical = true, alpha = 1 } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.font = `${size}px "STXingkai", "华文行楷", "KaiTi", "楷体", "STKaiti", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  if (vertical) [...text].forEach((ch, i) => ctx.fillText(ch, x, y + i * size * 1.05));
  else ctx.fillText(text, x, y);
  ctx.restore();
}

function seal(ctx, x, y, s, text) {
  ctx.save();
  ctx.fillStyle = '#b3261c';
  ctx.globalAlpha = 0.88;
  ctx.fillRect(x, y, s, s);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#f3e3c4';
  ctx.font = `${s * 0.42}px "KaiTi", "楷体", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = [...text];
  if (chars.length === 4) {
    ctx.fillText(chars[0], x + s * 0.73, y + s * 0.28);
    ctx.fillText(chars[1], x + s * 0.73, y + s * 0.72);
    ctx.fillText(chars[2], x + s * 0.27, y + s * 0.28);
    ctx.fillText(chars[3], x + s * 0.27, y + s * 0.72);
  } else ctx.fillText(text, x + s / 2, y + s / 2);
  ctx.restore();
}

// 梅枝（水墨）
function plumBranch(ctx, x, y, scale, rnd) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  const branch = (x0, y0, ang, len, w, depth) => {
    let px = x0;
    let py = y0;
    const segs = 5;
    for (let i = 0; i < segs; i++) {
      const a = ang + (rnd() - 0.5) * 0.7;
      const nx = px + Math.cos(a) * len / segs;
      const ny = py + Math.sin(a) * len / segs;
      ctx.strokeStyle = `rgba(28,20,16,${0.75 + rnd() * 0.2})`;
      ctx.lineWidth = w * (1 - i / segs * 0.6);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      px = nx;
      py = ny;
      if (depth > 0 && rnd() < 0.45) branch(px, py, a + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5), len * 0.5, w * 0.55, depth - 1);
      if (rnd() < 0.55) {
        // 花朵：五瓣淡红
        const r = 7 + rnd() * 4;
        ctx.fillStyle = `rgba(${200 + rnd() * 30},${70 + rnd() * 30},${70 + rnd() * 20},0.75)`;
        for (let k = 0; k < 5; k++) {
          const pa = (k / 5) * Math.PI * 2 + rnd();
          ctx.beginPath();
          ctx.arc(px + Math.cos(pa) * r * 0.6, py + Math.sin(pa) * r * 0.6, r * 0.55, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(240,200,90,0.9)';
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };
  branch(0, 0, -0.35, 360, 12, 2);
  ctx.restore();
}

// ───────────────────────────── 木材 ─────────────────────────────

const WOODS = {
  // 桐木面板：浅金褐、细直纹
  paulownia: { a: [196, 150, 98], b: [150, 102, 58], ring: 26, rough: [0.42, 0.55] },
  // 红木（酸枝 / 紫檀）：深红褐、密纹、高光漆面
  rosewood: { a: [104, 40, 24], b: [54, 18, 12], ring: 60, rough: [0.26, 0.36] },
  // 乌木：近黑
  ebony: { a: [44, 26, 20], b: [20, 12, 10], ring: 70, rough: [0.22, 0.3] },
  // 竹：浅黄绿
  bamboo: { a: [206, 170, 98], b: [168, 130, 64], ring: 14, rough: [0.35, 0.45] },
};

// 木纹：纹理沿 u 方向延伸
function woodPixels(W, H, kind, seed, repeatU = 1) {
  const P = WOODS[kind];
  const noise = new ValueNoise(seed);
  const col = new Uint8ClampedArray(W * H * 4);
  const rough = new Uint8ClampedArray(W * H * 4);
  const bump = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const j = (y * W + x) * 4;
      // 年轮：沿 v 的正弦被低频噪声扭曲
      const warp = noise.fbm(u, v, 3 * repeatU, 4, 3) * 3.2;
      const r = Math.sin((v * P.ring + warp) * Math.PI * 2);
      const fine = noise.fbm(u, v, 2 * repeatU, 3, 180);
      const ring = smoothstep(0.2, 1, r) * 0.55 + (fine - 0.5) * 0.6;
      const t = clamp01(0.5 + ring * 0.5);
      const pore = noise.fbm(u, v, 160 * repeatU, 2, 40);
      const k = t * (0.92 + pore * 0.16);
      col[j] = mix(P.a[0], P.b[0], k);
      col[j + 1] = mix(P.a[1], P.b[1], k);
      col[j + 2] = mix(P.a[2], P.b[2], k);
      col[j + 3] = 255;
      rough[j] = 255;
      rough[j + 1] = mix(P.rough[0], P.rough[1], k) * 255;
      rough[j + 2] = 0;
      rough[j + 3] = 255;
      bump[j] = bump[j + 1] = bump[j + 2] = (0.5 - k * 0.25 - pore * 0.1) * 255;
      bump[j + 3] = 255;
    }
  }
  return { col, rough, bump };
}

export function createWoodTexture(kind = 'rosewood', { W = 512, H = 512, seed = 7, repeat = true } = {}) {
  const { col, rough, bump } = woodPixels(W, H, kind, seed);
  return {
    map: toTexture(imageToCanvas(col, W, H), { srgb: true, repeat }),
    roughnessMap: toTexture(imageToCanvas(rough, W, H), { repeat }),
    bumpMap: toTexture(imageToCanvas(bump, W, H), { repeat }),
  };
}

// 古筝面板：u = 琴尾 → 琴头，v = 远端（低音弦）→ 近端（高音弦）
export function createGuzhengTopTexture() {
  const W = 2048;
  const H = 512;
  const { col, rough, bump } = woodPixels(W, H, 'paulownia', 12, 1);
  const c = imageToCanvas(col, W, H);
  const x = c.getContext('2d');
  const rc = imageToCanvas(rough, W, H);
  const rx = rc.getContext('2d');
  const rosewood = woodPixels(512, 256, 'rosewood', 5, 1);
  const rw = imageToCanvas(rosewood.col, 512, 256);

  // 琴尾（左端）与琴头（右端）红木饰板
  const tailEnd = W * 0.085;
  const headStart = W * 0.905;
  x.drawImage(rw, 0, 0, tailEnd, H);
  x.drawImage(rw, headStart, 0, W - headStart, H);
  rx.fillStyle = 'rgb(255,60,0)';
  rx.fillRect(0, 0, tailEnd, H);
  rx.fillRect(headStart, 0, W - headStart, H);
  // 镶嵌金线与回纹
  const gold = 'rgba(214,170,92,0.95)';
  x.strokeStyle = gold;
  x.lineWidth = 3;
  x.strokeRect(10, 22, tailEnd - 22, H - 44);
  x.strokeRect(headStart + 12, 22, W - headStart - 24, H - 44);
  x.lineWidth = 1.5;
  x.strokeRect(18, 30, tailEnd - 38, H - 60);
  x.strokeRect(headStart + 20, 30, W - headStart - 40, H - 60);
  x.save();
  x.translate(headStart + (W - headStart) / 2, H / 2);
  x.strokeStyle = gold;
  x.lineWidth = 4;
  x.beginPath();
  x.arc(0, 0, 58, 0, Math.PI * 2);
  x.stroke();
  x.lineWidth = 3;
  for (let k = 0; k < 4; k++) {
    x.save();
    x.rotate((k / 4) * Math.PI * 2);
    cloudS(x, -34, -84 - 26, 68, 36, k % 2 === 0);
    x.restore();
  }
  x.fillStyle = gold;
  x.font = '64px "KaiTi", "楷体", serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('筝', 0, 3);
  x.restore();
  for (let k = 0; k < 2; k++) {
    x.save();
    x.translate(tailEnd / 2, k ? H - 70 : 70);
    x.rotate(Math.PI / 2);
    x.strokeStyle = gold;
    x.lineWidth = 3;
    cloudS(x, -40, -18, 80, 36, k === 1);
    x.restore();
  }
  // 面板边缘镶线
  x.fillStyle = 'rgba(60,24,14,0.9)';
  x.fillRect(tailEnd, 0, headStart - tailEnd, 9);
  x.fillRect(tailEnd, H - 9, headStart - tailEnd, 9);
  x.fillStyle = gold;
  x.fillRect(tailEnd, 9, headStart - tailEnd, 2);
  x.fillRect(tailEnd, H - 11, headStart - tailEnd, 2);

  // 面板左段的水墨梅枝与题字
  const rnd = mulberry32(19);
  plumBranch(x, W * 0.13, H * 0.86, 0.95, rnd);
  brushText(x, '渔舟唱晚', W * 0.36, H * 0.14, 50, 'rgba(24,16,12,0.86)');
  brushText(x, '高山流水觅知音', W * 0.325, H * 0.2, 30, 'rgba(24,16,12,0.72)');
  seal(x, W * 0.345, H * 0.72, 44, '丝竹雅韵');

  return {
    map: toTexture(c, { srgb: true }),
    roughnessMap: toTexture(rc),
    bumpMap: toTexture(imageToCanvas(bump, W, H)),
  };
}

// 古筝侧板：红木 + 金色回纹带 + 螺钿点饰
export function createGuzhengSideTexture() {
  const W = 2048;
  const H = 128;
  const { col } = woodPixels(W, H, 'rosewood', 33, 4);
  const c = imageToCanvas(col, W, H);
  const x = c.getContext('2d');
  huiwenBand(x, 20, H * 0.34, W - 20, H * 0.32, 'rgba(210,166,88,0.9)', 2.4);
  x.fillStyle = 'rgba(210,166,88,0.9)';
  x.fillRect(0, H * 0.22, W, 2);
  x.fillRect(0, H * 0.76, W, 2);
  return toTexture(c, { srgb: true });
}

// ───────────────────────────── 蟒皮 ─────────────────────────────

export function createPythonSkinTexture() {
  const S = 512;
  const noise = new ValueNoise(61);
  const rnd = mulberry32(61);
  // 抖动网格上的沃罗诺伊鳞片
  const G = 22;
  const pts = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) pts.push([(i + 0.15 + rnd() * 0.7) / G, (j + 0.15 + rnd() * 0.7) / G, rnd()]);
  const col = new Uint8ClampedArray(S * S * 4);
  const bump = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const gi = Math.floor(u * G);
      const gj = Math.floor(v * G);
      let d1 = 9;
      let d2 = 9;
      let tone = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = (gi + di + G) % G;
          const jj = (gj + dj + G) % G;
          const p = pts[jj * G + ii];
          let dx = p[0] - u;
          let dy = p[1] - v;
          dx -= Math.round(dx);
          dy -= Math.round(dy);
          const d = Math.hypot(dx, dy);
          if (d < d1) { d2 = d1; d1 = d; tone = p[2]; } else if (d < d2) d2 = d;
        }
      }
      const edge = smoothstep(0.0, 0.012, d2 - d1);
      // 大块深色斑纹
      const blot = smoothstep(0.52, 0.6, noise.fbm(u, v, 3, 4));
      const ring = smoothstep(0.47, 0.52, noise.fbm(u, v, 3, 4)) - blot;
      let r = mix(184, 58, blot) + tone * 14;
      let g = mix(160, 40, blot) + tone * 10;
      let b = mix(112, 26, blot) + tone * 6;
      r = mix(r, 236, ring * 0.35);
      g = mix(g, 214, ring * 0.35);
      b = mix(b, 160, ring * 0.35);
      r = mix(r * 0.45, r, edge);
      g = mix(g * 0.45, g, edge);
      b = mix(b * 0.45, b, edge);
      const j = (y * S + x) * 4;
      col[j] = r; col[j + 1] = g; col[j + 2] = b; col[j + 3] = 255;
      bump[j] = bump[j + 1] = bump[j + 2] = (0.3 + 0.6 * edge * (0.7 + 0.3 * smoothstep(0, 0.04, d1))) * 255;
      bump[j + 3] = 255;
    }
  }
  return { map: toTexture(imageToCanvas(col, S, S), { srgb: true }), bumpMap: toTexture(imageToCanvas(bump, S, S)) };
}

// 琴筒后口的音窗（镂空花格，alpha 用作透空）
export function createSoundWindowTexture() {
  const S = 256;
  const c = makeCanvas(S, S);
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, S, S);
  x.fillStyle = '#000';
  x.translate(S / 2, S / 2);
  for (let k = 0; k < 8; k++) {
    x.save();
    x.rotate((k / 8) * Math.PI * 2);
    x.beginPath();
    x.ellipse(0, -S * 0.27, S * 0.07, S * 0.13, 0, 0, Math.PI * 2);
    x.fill();
    x.restore();
  }
  x.beginPath();
  x.arc(0, 0, S * 0.08, 0, Math.PI * 2);
  x.fill();
  return toTexture(c);
}

// ───────────────────────────── 金属 ─────────────────────────────

// 黄铜：金色、轻微氧化与锤痕
export function createBrassTextures(seed = 27) {
  const S = 256;
  const noise = new ValueNoise(seed);
  const col = new Uint8ClampedArray(S * S * 4);
  const orm = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const n = noise.fbm(u, v, 6, 5);
      const ham = noise.fbm(u, v, 24, 2);
      const ox = smoothstep(0.58, 0.8, noise.fbm(u, v, 3, 4));
      const j = (y * S + x) * 4;
      col[j] = mix(222, 120, ox) * (0.9 + n * 0.2);
      col[j + 1] = mix(172, 96, ox) * (0.9 + n * 0.2);
      col[j + 2] = mix(92, 64, ox) * (0.9 + n * 0.2);
      col[j + 3] = 255;
      orm[j] = 255;
      orm[j + 1] = clamp01(0.22 + ham * 0.16 + ox * 0.35) * 255;
      orm[j + 2] = clamp01(1 - ox * 0.4) * 255;
      orm[j + 3] = 255;
    }
  }
  return {
    map: toTexture(imageToCanvas(col, S, S), { srgb: true, repeat: true }),
    ormMap: toTexture(imageToCanvas(orm, S, S), { repeat: true }),
  };
}

// ───────────────────────────── 漆器 ─────────────────────────────

export function createLacquerTexture({ base = '#140c0a', paint = '#a3281c', accent = '#c89a4a', seed = 31 } = {}) {
  const W = 1024;
  const H = 128;
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  x.fillStyle = base;
  x.fillRect(0, 0, W, H);
  x.lineCap = 'round';
  x.lineJoin = 'round';
  x.fillStyle = paint;
  x.fillRect(0, 6, W, 5);
  x.fillRect(0, H - 11, W, 5);
  x.fillStyle = accent;
  x.fillRect(0, 14, W, 2);
  x.fillRect(0, H - 16, W, 2);
  const unit = 128;
  for (let u = 0; u < W / unit; u++) {
    const cx = u * unit + unit / 2;
    const cy = H / 2;
    x.strokeStyle = paint;
    x.lineWidth = 4;
    x.beginPath();
    x.moveTo(cx - unit / 2 + 4, cy);
    x.lineTo(cx, 20);
    x.lineTo(cx + unit / 2 - 4, cy);
    x.lineTo(cx, H - 20);
    x.closePath();
    x.stroke();
    x.strokeStyle = accent;
    x.lineWidth = 3;
    x.save();
    x.translate(cx - 21, cy - 13);
    cloudS(x, 0, 0, 42, 26, u % 2 === 0);
    x.restore();
  }
  const img = x.getImageData(0, 0, W, H);
  const d = img.data;
  const noise = new ValueNoise(seed);
  const rough = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let xx = 0; xx < W; xx++) {
      const j = (y * W + xx) * 4;
      const n = noise.fbm(xx / W, y / H, 16, 4, 2);
      const wear = smoothstep(0.62, 0.8, n);
      const f = 0.86 + n * 0.28;
      d[j] *= f * (1 - wear * 0.3);
      d[j + 1] *= f * (1 - wear * 0.3);
      d[j + 2] *= f * (1 - wear * 0.3);
      rough[j] = 255;
      rough[j + 1] = (0.2 + n * 0.18 + wear * 0.25) * 255;
      rough[j + 2] = 0;
      rough[j + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return { map: toTexture(c, { srgb: true, repeat: true }), roughnessMap: toTexture(imageToCanvas(rough, W, H), { repeat: true }) };
}

// ───────────────────────────── 殿堂 ─────────────────────────────

export function createFloorTextures() {
  const S = 1024;
  const noise = new ValueNoise(77);
  const rnd = mulberry32(77);
  const col = new Uint8ClampedArray(S * S * 4);
  const orm = new Uint8ClampedArray(S * S * 4);
  const bump = new Uint8ClampedArray(S * S * 4);
  const tiles = 4;
  const tileTone = [];
  for (let i = 0; i < tiles * tiles; i++) tileTone.push(rnd());
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const j = (y * S + x) * 4;
      const tx = (x / S) * tiles;
      const ty = (y / S) * tiles;
      const fx = tx - Math.floor(tx);
      const fy = ty - Math.floor(ty);
      const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
      const grout = smoothstep(0.012, 0.004, edge);
      const tone = tileTone[Math.floor(ty) * tiles + Math.floor(tx)];
      const n = noise.fbm(x / S, y / S, 6, 5);
      const vein = Math.abs(noise.fbm(x / S, y / S, 3, 4) - 0.5);
      const veinL = smoothstep(0.03, 0.0, vein) * 0.4;
      const base = 20 + tone * 10 + n * 16 + veinL * 30;
      col[j] = mix(base * 1.08, 8, grout);
      col[j + 1] = mix(base * 0.96, 7, grout);
      col[j + 2] = mix(base * 0.86, 6, grout);
      col[j + 3] = 255;
      orm[j] = 255;
      orm[j + 1] = mix(0.18 + n * 0.3 + tone * 0.1, 0.9, grout) * 255;
      orm[j + 2] = 0;
      orm[j + 3] = 255;
      bump[j] = bump[j + 1] = bump[j + 2] = mix(0.5 + (n - 0.5) * 0.1, 0.15, grout) * 255;
      bump[j + 3] = 255;
    }
  }
  return {
    map: toTexture(imageToCanvas(col, S, S), { srgb: true, repeat: true }),
    ormMap: toTexture(imageToCanvas(orm, S, S), { repeat: true }),
    bumpMap: toTexture(imageToCanvas(bump, S, S), { repeat: true }),
  };
}

export function createWallTexture() {
  const W = 1024;
  const H = 512;
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  const noise = new ValueNoise(55);
  const img = x.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let xx = 0; xx < W; xx++) {
      const j = (y * W + xx) * 4;
      const grain = noise.fbm(xx / W, y / H, 40, 4, 2);
      const panel = (xx % 256) < 6 || (y % 256) < 5 ? 0.55 : 1;
      const v = (24 + grain * 18) * panel;
      d[j] = v * 1.25; d[j + 1] = v * 0.72; d[j + 2] = v * 0.55; d[j + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return toTexture(c, { srgb: true, repeat: true });
}

export function createLatticeTexture() {
  const S = 512;
  const c = makeCanvas(S, S);
  const x = c.getContext('2d');
  const grd = x.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S * 0.7);
  grd.addColorStop(0, '#fff3d6');
  grd.addColorStop(1, '#e8a860');
  x.fillStyle = grd;
  x.fillRect(0, 0, S, S);
  x.strokeStyle = '#000';
  x.lineCap = 'square';
  x.lineWidth = 10;
  x.strokeRect(5, 5, S - 10, S - 10);
  x.lineWidth = 7;
  const n = 6;
  const step = S / n;
  for (let i = 1; i < n; i++) {
    x.beginPath();
    x.moveTo(i * step, 0); x.lineTo(i * step, S);
    x.moveTo(0, i * step); x.lineTo(S, i * step);
    x.stroke();
  }
  x.lineWidth = 4;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cx = i * step + step / 2;
      const cy = j * step + step / 2;
      x.strokeRect(cx - step * 0.22, cy - step * 0.22, step * 0.44, step * 0.44);
      x.beginPath();
      x.moveTo(cx - step * 0.22, cy); x.lineTo(i * step, cy);
      x.moveTo(cx + step * 0.22, cy); x.lineTo((i + 1) * step, cy);
      x.stroke();
    }
  }
  return toTexture(c, { srgb: true });
}

export function createGlowTexture() {
  const S = 128;
  const c = makeCanvas(S, S);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  return toTexture(c);
}

// 前臂淡出用的纵向渐变 alpha
export function createFadeTexture() {
  const c = makeCanvas(4, 128);
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#000');
  g.addColorStop(0.55, '#777');
  g.addColorStop(1, '#fff');
  x.fillStyle = g;
  x.fillRect(0, 0, 4, 128);
  return toTexture(c);
}

// ───────────────────────────── 山水屏风 ─────────────────────────────

export function createShanshuiTexture() {
  const W = 2560;
  const H = 1024;
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  const noise = new ValueNoise(211);
  const rnd = mulberry32(211);
  // 绢本底色
  const img = x.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let xx = 0; xx < W; xx++) {
      const j = (y * W + xx) * 4;
      const n = noise.fbm(xx / W, y / H, 12, 4, 5);
      const age = noise.fbm(xx / W, y / H, 3, 3, 1);
      const v = 0.86 + n * 0.1 - age * 0.12;
      d[j] = 218 * v; d[j + 1] = 196 * v; d[j + 2] = 150 * v; d[j + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);

  // 远山 → 近山：逐层山脊线，底部渐隐为云雾
  const layers = [
    { base: 0.5, amp: 0.26, freq: 2, ink: 'rgba(70,82,88,', alpha: 0.28, mist: 0.2 },
    { base: 0.6, amp: 0.3, freq: 3, ink: 'rgba(50,60,62,', alpha: 0.42, mist: 0.18 },
    { base: 0.74, amp: 0.26, freq: 4, ink: 'rgba(32,36,34,', alpha: 0.62, mist: 0.14 },
    { base: 0.92, amp: 0.2, freq: 6, ink: 'rgba(20,20,18,', alpha: 0.8, mist: 0.1 },
  ];
  layers.forEach((L, li) => {
    const ridge = [];
    for (let xx = 0; xx <= W; xx += 4) {
      const u = xx / W;
      const n = noise.fbm(u, li * 0.23, L.freq, 5, 1);
      const peak = Math.pow(n, 1.6);
      ridge.push([xx, H * (L.base - L.amp * peak * 1.6 + 0.12)]);
    }
    const top = Math.min(...ridge.map((p) => p[1]));
    const g = x.createLinearGradient(0, top, 0, H * (L.base + L.mist + 0.12));
    g.addColorStop(0, `${L.ink}${L.alpha})`);
    g.addColorStop(0.55, `${L.ink}${L.alpha * 0.55})`);
    g.addColorStop(1, `${L.ink}0)`);
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(0, H);
    ridge.forEach(([px, py]) => x.lineTo(px, py));
    x.lineTo(W, H);
    x.closePath();
    x.fill();
    // 皴擦：沿山脊的短笔触
    x.strokeStyle = `${L.ink}${Math.min(0.9, L.alpha + 0.15)})`;
    for (let k = 0; k < ridge.length; k += 2) {
      const [px, py] = ridge[k];
      if (rnd() < 0.5) continue;
      x.lineWidth = 1 + rnd() * 2.5;
      x.beginPath();
      x.moveTo(px, py);
      x.lineTo(px + (rnd() - 0.3) * 18, py + 10 + rnd() * 40);
      x.stroke();
    }
    // 近山点苔与松
    if (li >= 2) {
      for (let k = 0; k < 90; k++) {
        const idx = Math.floor(rnd() * ridge.length);
        const [px, py] = ridge[idx];
        x.fillStyle = `rgba(16,18,14,${0.4 + rnd() * 0.4})`;
        x.beginPath();
        x.arc(px, py + rnd() * 30, 2 + rnd() * 5, 0, Math.PI * 2);
        x.fill();
      }
    }
  });
  // 月
  x.fillStyle = 'rgba(250,236,200,0.85)';
  x.beginPath();
  x.arc(W * 0.78, H * 0.16, 44, 0, Math.PI * 2);
  x.fill();
  // 江面与渔舟
  const water = x.createLinearGradient(0, H * 0.8, 0, H);
  water.addColorStop(0, 'rgba(210,190,146,0.0)');
  water.addColorStop(1, 'rgba(120,120,100,0.25)');
  x.fillStyle = water;
  x.fillRect(0, H * 0.8, W, H * 0.2);
  x.strokeStyle = 'rgba(30,30,26,0.5)';
  for (let k = 0; k < 40; k++) {
    const wx = rnd() * W;
    const wy = H * (0.84 + rnd() * 0.14);
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(wx, wy);
    x.lineTo(wx + 20 + rnd() * 50, wy);
    x.stroke();
  }
  const boat = (bx, by, s) => {
    x.fillStyle = 'rgba(20,18,14,0.85)';
    x.beginPath();
    x.moveTo(bx - 40 * s, by);
    x.quadraticCurveTo(bx, by + 14 * s, bx + 40 * s, by - 4 * s);
    x.lineTo(bx - 40 * s, by);
    x.fill();
    x.fillRect(bx - 6 * s, by - 18 * s, 22 * s, 12 * s);
    x.strokeStyle = 'rgba(20,18,14,0.85)';
    x.lineWidth = 2 * s;
    x.beginPath();
    x.moveTo(bx - 30 * s, by - 2 * s);
    x.lineTo(bx - 52 * s, by - 36 * s);
    x.stroke();
  };
  boat(W * 0.44, H * 0.89, 1.1);
  boat(W * 0.6, H * 0.93, 0.7);
  // 飞鸟
  x.strokeStyle = 'rgba(20,18,14,0.75)';
  x.lineWidth = 2;
  for (let k = 0; k < 14; k++) {
    const bx = W * (0.55 + rnd() * 0.3);
    const by = H * (0.12 + rnd() * 0.2);
    const s = 6 + rnd() * 6;
    x.beginPath();
    x.moveTo(bx - s, by - s * 0.3);
    x.quadraticCurveTo(bx - s * 0.4, by - s * 0.6, bx, by);
    x.quadraticCurveTo(bx + s * 0.4, by - s * 0.6, bx + s, by - s * 0.3);
    x.stroke();
  }
  // 题跋
  brushText(x, '渔舟唱晚', W * 0.1, H * 0.08, 76, 'rgba(24,18,14,0.88)');
  brushText(x, '二泉映月', W * 0.065, H * 0.12, 48, 'rgba(24,18,14,0.7)');
  brushText(x, '百鸟朝凤', W * 0.04, H * 0.16, 48, 'rgba(24,18,14,0.7)');
  seal(x, W * 0.088, H * 0.47, 56, '丝竹之音');
  // 面板间折缝阴影（五扇）
  for (let k = 1; k < 5; k++) {
    const g = x.createLinearGradient(W * k / 5 - 30, 0, W * k / 5 + 30, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(W * k / 5 - 30, 0, 60, H);
  }
  return toTexture(c, { srgb: true });
}

// ───────────────────────────── 地毯 ─────────────────────────────

export function createRugTexture() {
  const W = 1024;
  const H = 640;
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  x.fillStyle = '#6a1510';
  x.fillRect(0, 0, W, H);
  x.fillStyle = '#2a0c08';
  x.fillRect(0, 0, W, 50);
  x.fillRect(0, H - 50, W, 50);
  x.fillRect(0, 0, 50, H);
  x.fillRect(W - 50, 0, 50, H);
  huiwenBand(x, 60, 14, W - 60, 22, 'rgba(206,160,82,0.9)', 3);
  huiwenBand(x, 60, H - 36, W - 60, 22, 'rgba(206,160,82,0.9)', 3);
  x.strokeStyle = 'rgba(206,160,82,0.9)';
  x.lineWidth = 4;
  x.strokeRect(62, 62, W - 124, H - 124);
  x.lineWidth = 2;
  x.strokeRect(74, 74, W - 148, H - 148);
  // 团花
  const medal = (cx, cy, r) => {
    x.save();
    x.translate(cx, cy);
    x.strokeStyle = 'rgba(206,160,82,0.85)';
    x.lineWidth = 3;
    x.beginPath();
    x.arc(0, 0, r, 0, Math.PI * 2);
    x.stroke();
    for (let k = 0; k < 6; k++) {
      x.save();
      x.rotate((k / 6) * Math.PI * 2);
      cloudS(x, -r * 0.4, -r * 0.82, r * 0.8, r * 0.36, k % 2 === 0);
      x.restore();
    }
    x.fillStyle = 'rgba(206,160,82,0.85)';
    x.beginPath();
    x.arc(0, 0, r * 0.18, 0, Math.PI * 2);
    x.fill();
    x.restore();
  };
  medal(W / 2, H / 2, 150);
  [[0.2, 0.3], [0.8, 0.3], [0.2, 0.7], [0.8, 0.7]].forEach(([u, v]) => medal(W * u, H * v, 60));
  // 羊毛绒感
  const img = x.getImageData(0, 0, W, H);
  const d = img.data;
  const noise = new ValueNoise(5);
  for (let y = 0; y < H; y++) {
    for (let xx = 0; xx < W; xx++) {
      const j = (y * W + xx) * 4;
      const n = 0.82 + noise.fbm(xx / W, y / H, 128, 2, 80) * 0.3;
      d[j] *= n; d[j + 1] *= n; d[j + 2] *= n;
    }
  }
  x.putImageData(img, 0, 0);
  return toTexture(c, { srgb: true });
}
