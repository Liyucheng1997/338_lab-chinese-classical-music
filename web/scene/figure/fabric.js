// 织物纹理：底色 / 渐变、暗花（团花、梅、云纹）、刺绣缘边（回纹、卷草）、织纹与褪色磨损。
// paintFabric 先用 2D 画布绘制图案，再逐像素叠加织纹，同时输出凹凸贴图。
import * as THREE from 'three';
import { mulberry32 } from '../noise.js';

export function canvas(W, H) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
}

// ───────────────────────────── 图案基元 ─────────────────────────────

export function plum(g, x, y, r, color, center = '#e8c060') {
  g.fillStyle = color;
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
    g.beginPath();
    g.arc(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = center;
  g.beginPath();
  g.arc(x, y, r * 0.22, 0, Math.PI * 2);
  g.fill();
}

export function cloud(g, x, y, s, color, lw = 1.5) {
  g.strokeStyle = color;
  g.lineWidth = lw;
  g.lineCap = 'round';
  const spiral = (cx, cy, r, dir) => {
    g.beginPath();
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const a = dir * t * Math.PI * 2.4;
      const rr = r * (1 - 0.8 * t);
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    }
    g.stroke();
  };
  spiral(x - s * 0.3, y, s * 0.28, 1);
  spiral(x + s * 0.3, y, s * 0.28, -1);
  g.beginPath();
  g.moveTo(x - s * 0.3, y - s * 0.28);
  g.bezierCurveTo(x - s * 0.1, y - s * 0.55, x + s * 0.1, y - s * 0.55, x + s * 0.3, y - s * 0.28);
  g.stroke();
}

/** 团花：同心花瓣环 */
export function medallion(g, x, y, r, c1, c2) {
  for (let ring = 0; ring < 2; ring++) {
    const n = ring ? 8 : 6;
    const rr = r * (ring ? 0.95 : 0.55);
    g.fillStyle = ring ? c1 : c2;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + ring * 0.2;
      g.beginPath();
      g.ellipse(x + Math.cos(a) * rr * 0.6, y + Math.sin(a) * rr * 0.6, rr * 0.42, rr * 0.22, a, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.fillStyle = c1;
  g.beginPath();
  g.arc(x, y, r * 0.18, 0, Math.PI * 2);
  g.fill();
}

// 回纹带
export function huiwenBand(g, x0, y0, x1, h, color, lw) {
  g.strokeStyle = color;
  g.lineWidth = lw;
  g.lineJoin = 'miter';
  const s = h * 0.8;
  for (let x = x0; x < x1; x += s * 1.1) {
    const cx = x;
    const cy = y0 + (h - s) / 2;
    g.beginPath();
    g.moveTo(cx, cy + s);
    g.lineTo(cx, cy);
    g.lineTo(cx + s, cy);
    g.lineTo(cx + s, cy + s * 0.8);
    g.lineTo(cx + s * 0.25, cy + s * 0.8);
    g.lineTo(cx + s * 0.25, cy + s * 0.25);
    g.lineTo(cx + s * 0.7, cy + s * 0.25);
    g.lineTo(cx + s * 0.7, cy + s * 0.55);
    g.stroke();
  }
}

// 卷草纹带
export function vineBand(g, x0, y0, x1, h, color, lw) {
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = lw;
  const step = h * 1.6;
  const mid = y0 + h / 2;
  g.beginPath();
  for (let x = x0; x <= x1; x += 2) {
    const y = mid + Math.sin(((x - x0) / step) * Math.PI) * h * 0.28;
    if (x === x0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  let k = 0;
  for (let x = x0 + step / 2; x < x1; x += step, k++) {
    const up = k % 2 ? 1 : -1;
    const y = mid + up * h * 0.28;
    g.beginPath();
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const a = up * t * Math.PI * 1.6;
      const r = h * 0.3 * (1 - 0.7 * t);
      const px = x + Math.cos(a) * r;
      const py = y - up * h * 0.05 + Math.sin(a) * r;
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    }
    g.stroke();
    g.beginPath();
    g.ellipse(x + step * 0.25, y + up * h * 0.1, h * 0.12, h * 0.05, up * 0.6, 0, Math.PI * 2);
    g.fill();
  }
}

// ───────────────────────────── 织纹与输出 ─────────────────────────────

/**
 * @param {object} o
 *   W, H, draw(g, W, H)：图案；weave：织纹强度；fine：织纹频率；worn：褪色程度；seed；
 *   repeat：纹理平铺 [u, v]；silk：丝绸光泽（织纹更细、凹凸更弱）
 */
export function paintFabric(o) {
  const W = o.W ?? 512;
  const H = o.H ?? 512;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  o.draw(g, W, H);
  const img = g.getImageData(0, 0, W, H);
  const bump = canvas(W, H);
  const bg = bump.getContext('2d');
  const bi = bg.createImageData(W, H);
  const rnd = mulberry32(o.seed ?? 5);
  const wv = o.weave ?? 0.06;
  const fine = o.fine ?? 1;
  // 低频褪色斑：粗网格随机值双线性插值
  const G = 9;
  const blot = new Float32Array((G + 1) * (G + 1)).map(() => rnd());
  const blotAt = (u, v) => {
    const x = u * G;
    const y = v * G;
    const i = Math.min(G - 1, Math.floor(x));
    const j = Math.min(G - 1, Math.floor(y));
    const fx = x - i;
    const fy = y - j;
    const a = blot[j * (G + 1) + i];
    const b = blot[j * (G + 1) + i + 1];
    const cc = blot[(j + 1) * (G + 1) + i];
    const d = blot[(j + 1) * (G + 1) + i + 1];
    return a + (b - a) * fx + (cc - a) * fy + (a - b - cc + d) * fx * fy;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4;
      // 平纹：经纬交错
      const wu = Math.sin((x * Math.PI * fine) / 1.5);
      const wvv = Math.sin((y * Math.PI * fine) / 1.5);
      const cross = (wu * wvv) * 0.5 + 0.5;
      const n = (rnd() - 0.5) * 0.5 + (cross - 0.5);
      let m = 1 + n * wv;
      if (o.worn) m *= 1 - o.worn * (blotAt(x / W, y / H) - 0.5) * 0.5;
      img.data[k] = Math.min(255, img.data[k] * m);
      img.data[k + 1] = Math.min(255, img.data[k + 1] * m);
      img.data[k + 2] = Math.min(255, img.data[k + 2] * m);
      const b = 128 + (cross - 0.5) * 120 + (rnd() - 0.5) * 30;
      bi.data[k] = bi.data[k + 1] = bi.data[k + 2] = b;
      bi.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  bg.putImageData(bi, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const bumpMap = new THREE.CanvasTexture(bump);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  if (o.repeat) {
    map.repeat.set(...o.repeat);
    bumpMap.repeat.set(...o.repeat);
  }
  return { map, bumpMap, canvas: c };
}

/** 织物材质：丝（有光泽、sheen 强）或棉（粗糙）。 */
export function fabricMaterial(tex, { silk = false, color = 0xffffff, side = THREE.DoubleSide, bump = 0.4, rough, sheenColor, transparent = false, opacity = 1 } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color, map: tex.map, bumpMap: tex.bumpMap, bumpScale: bump, side,
    roughness: rough ?? (silk ? 0.5 : 0.85), metalness: 0,
    sheen: silk ? 0.5 : 0.4, sheenRoughness: silk ? 0.35 : 0.6, sheenColor: new THREE.Color(sheenColor ?? (silk ? 0xb0b0b0 : 0x606060)).multiplyScalar(silk ? 0.55 : 0.5),
    envMapIntensity: silk ? 0.7 : 0.45, transparent, opacity,
  });
}
