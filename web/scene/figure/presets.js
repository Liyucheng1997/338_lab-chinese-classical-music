// 三位乐师的面部参数（覆盖 FACE_DEFAULTS）与肤色、眉眼、胡须等外观
const MALE_PROFILE = [[0.105, 0.032], [0.085, 0.06], [0.06, 0.077], [0.035, 0.084], [0.02, 0.0875], [0.006, 0.0805], [-0.015, 0.0805],
  [-0.04, 0.0835], [-0.057, 0.085], [-0.072, 0.0828], [-0.084, 0.081], [-0.096, 0.0772], [-0.108, 0.0835], [-0.118, 0.0795],
  [-0.126, 0.065], [-0.131, 0.038], [-0.133, 0.0]];

export const HEAD_PRESETS = {
  // 古典少女：鹅蛋脸、丹凤眼微垂视、樱唇、眉心花钿
  girl: {
    face: {
      eye: { c: [0.0318, 0.002, 0.0605], R: 0.0122, up: 0.28, lo: -0.34, tilt: 0.12, hw: 1.12 },
      lips: { y: -0.067, w: 0.0148, up: 0.0042, lo: 0.0048, pout: 0.0036 },
      nose: { tipR: 0.0068, alaX: 0.0088, alaR: 0.005, rootR: 0.0041, tip: [0, -0.033, 0.0975] },
      brow: { r: [0.022, 0.006, 0.009] },
      cheek: { c: [0.034, -0.047, 0.05], r: [0.024, 0.026, 0.023], k: 0.022 },
      cheekbone: { c: [0.045, -0.014, 0.045], r: [0.02, 0.012, 0.018] },
      orbit: { c: [0.031, 0.001, 0.074], r: [0.0175, 0.0125, 0.008], k: 0.006 },
    },
    look: {
      skin: '#ecc7ae', lip: '#c2303f', lipCenter: 0.3, blush: '#e57f84', brow: '#2a1b15', iris: '#2b180e', sheen: 0xffb4a4,
      browX0: 0.011, browLen: 0.043, browY: 0.0215, browArch: 0.0045, browDrop: 0.0035, browW: 0.003, browAmt: 0.92,
      blink: true, lashes: true, lashLen: 0.0066, liner: 0.08, linerAmt: 0.75, crease: 0.13, huadian: true,
      cheekBlush: 0.34, lidRed: 0.35, lipGloss: 0.42, underEye: 0.05, pores: 0.6, seed: 11,
    },
  },
  // 琵琶女：瓜子脸、柳叶眉、杏眼低垂看琴、淡色唇
  pipa: {
    face: {
      eye: { c: [0.0315, 0.002, 0.0602], R: 0.0121, up: 0.24, lo: -0.33, tilt: 0.06, hw: 1.1 },
      lips: { y: -0.068, w: 0.0158, up: 0.0038, lo: 0.0046, pout: 0.0032 },
      nose: { tipR: 0.007, alaX: 0.0092, alaR: 0.0052, rootR: 0.0043, tip: [0, -0.034, 0.0978] },
      brow: { r: [0.022, 0.006, 0.009] },
      cheek: { c: [0.034, -0.048, 0.048], r: [0.022, 0.024, 0.021], k: 0.02 },
      cheekbone: { c: [0.045, -0.013, 0.046], r: [0.021, 0.012, 0.018] },
      orbit: { c: [0.031, 0.001, 0.074], r: [0.0175, 0.0125, 0.008], k: 0.006 },
    },
    look: {
      skin: '#e8c2a6', lip: '#b8404a', lipCenter: 0.2, blush: '#dc8a86', brow: '#231712', iris: '#26160d', sheen: 0xffb09c,
      browX0: 0.01, browLen: 0.046, browY: 0.021, browArch: 0.0035, browDrop: 0.004, browW: 0.0026, browAmt: 0.9,
      blink: true, lashes: true, lashLen: 0.006, liner: 0.1, linerAmt: 0.7, crease: 0.14, huadian: false,
      cheekBlush: 0.26, lidRed: 0.22, lipGloss: 0.38, underEye: 0.06, pores: 0.7, seed: 53, blinkRest: 0.08,
    },
  },
  // 盲眼老琴师：颧骨突出、两颊凹陷、眼睑闭合、灰白胡茬与皱纹
  oldman: {
    face: {
      cranium: { c: [0, 0.02, -0.018], r: [0.072, 0.092, 0.098] },
      profile: MALE_PROFILE.map(([y, z]) => [y, y < -0.05 && y > -0.1 ? z - 0.002 : z]),
      maskBound: { c: [0, -0.018, 0], r: [0.059, 0.11, 0.108] },
      jaw: { a: [0.054, -0.07, -0.012], b: [0.026, -0.108, 0.04], r1: 0.013, r2: 0.011 },
      cheek: { c: [0.036, -0.046, 0.042], r: [0.015, 0.018, 0.015], k: 0.014 },
      hollow: 1,
      cheekbone: { c: [0.048, -0.012, 0.05], r: [0.022, 0.014, 0.02] },
      brow: { c: [0.029, 0.021, 0.07], r: [0.025, 0.009, 0.012], k: 0.013 },
      eye: { c: [0.031, 0.001, 0.0585], R: 0.0108, up: 0.3, lo: -0.3, tilt: -0.03 },
      orbit: { r: [0.018, 0.013, 0.009] },
      nose: { root: [0, 0.006, 0.081], tip: [0, -0.043, 0.103], tipR: 0.0088, alaX: 0.0118, alaR: 0.0064, rootR: 0.0052 },
      lips: { y: -0.075, z: 0.0835, w: 0.019, up: 0.0036, lo: 0.0046, pout: 0.0038 },
      ear: { c: [0.071, -0.012, -0.015], h: 0.034, w: 0.019, t: 0.006 },
    },
    look: {
      skin: '#c69d84', lip: '#9c645c', blush: '#b8645a', brow: '#8c8680', stubbleColor: '#a09a92', scalp: '#8f8a84', sheen: 0xd9a896,
      browX0: 0.01, browLen: 0.045, browY: 0.0245, browArch: 0.003, browDrop: 0.006, browW: 0.0042, browAmt: 0.8,
      closed: true, wrinkles: 1, stubble: 0.55, liner: 0.12, linerAmt: 0.55, cheekBlush: 0.2, underEye: 0.2, lidRed: 0.2,
      pores: 1.3, lipGloss: 0.5, lipAmt: 0.7, seed: 23,
    },
  },
  // 陕北唢呐匠：方脸、浓眉、络腮胡茬、鼓腮
  suona: {
    face: {
      cranium: { c: [0, 0.02, -0.018], r: [0.075, 0.093, 0.1] },
      profile: MALE_PROFILE,
      maskBound: { c: [0, -0.018, 0], r: [0.063, 0.11, 0.108] },
      curve: [[0.1, 8], [0.06, 7], [0.02, 6.5], [0.0, 7.2], [-0.025, 10], [-0.05, 14], [-0.07, 17], [-0.09, 19], [-0.11, 22], [-0.13, 30]],
      jaw: { a: [0.058, -0.07, -0.012], b: [0.03, -0.11, 0.04], r1: 0.016, r2: 0.013 },
      cheekbone: { c: [0.05, -0.013, 0.049], r: [0.024, 0.015, 0.021] },
      cheek: { c: [0.037, -0.045, 0.046], r: [0.02, 0.022, 0.019], k: 0.016 },
      brow: { c: [0.03, 0.021, 0.07], r: [0.027, 0.0105, 0.012], k: 0.013 },
      eye: { up: 0.24, lo: -0.28, tilt: 0.02 },
      nose: { root: [0, 0.006, 0.081], tip: [0, -0.042, 0.104], tipR: 0.0094, alaX: 0.0125, alaR: 0.0068, rootR: 0.0056, bridgeW: 1.15 },
      lips: { y: -0.074, z: 0.0842, w: 0.0192, up: 0.0046, lo: 0.0058, pout: 0.0046, open: 0.0012 },
      ear: { c: [0.073, -0.012, -0.015], h: 0.032, w: 0.018 },
      puff: { c: [0.042, -0.06, 0.047], r: [0.027, 0.027, 0.027] },
    },
    look: {
      skin: '#bb8a6a', lip: '#8e4c42', blush: '#b85a48', brow: '#17100b', stubbleColor: '#1c1510', scalp: '#16100c', sheen: 0xd9a080,
      browX0: 0.009, browLen: 0.047, browY: 0.0255, browArch: 0.0022, browDrop: 0.002, browW: 0.0052, browAmt: 1,
      blink: true, iris: '#24150c', liner: 0.1, linerAmt: 0.7, stubble: 0.75, wrinkles: 0.45, cheekBlush: 0.4, underEye: 0.12,
      pores: 1.2, lipGloss: 0.5, lipAmt: 0.75, seed: 37,
    },
  },
};
