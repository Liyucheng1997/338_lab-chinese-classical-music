// 振动弦：实体弦（顶点着色器按驻波位移，可在某点被按下）+ 加色“残影”带，显示振动包络。
import * as THREE from 'three';

const UNIT_CYL = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 6, 28, true);
  g.rotateZ(-Math.PI / 2); // 沿 +X
  g.translate(0.5, 0, 0);
  return g;
})();

const UNIT_RIBBON = (() => {
  const g = new THREE.PlaneGeometry(1, 2, 28, 1);
  g.rotateX(-Math.PI / 2); // 位于局部 XZ 平面，Z 为振动方向
  g.translate(0.5, 0, 0);
  return g;
})();

const GhostShader = {
  vertexShader: /* glsl */ `
    uniform float uAmp;
    uniform float uPress;
    uniform float uPressAt;
    varying float vEdge;
    varying float vEnv;
    void main() {
      vec3 p = position;
      float env = sin(3.14159265 * clamp(p.x, 0.0, 1.0));
      vEdge = abs(p.z);
      vEnv = env;
      p.z *= uAmp * env + 0.0004;
      float tent = uPressAt > 0.0 ? (p.x < uPressAt ? p.x / uPressAt : (1.0 - p.x) / (1.0 - uPressAt)) : 0.0;
      p.y -= uPress * tent;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uGlow;
    varying float vEdge;
    varying float vEnv;
    void main() {
      // 振动的弦在两端极值处停留最久，因此包络边缘最亮
      float a = (0.25 + 0.75 * pow(vEdge, 4.0)) * smoothstep(0.0, 0.25, vEnv) * uGlow;
      gl_FragColor = vec4(uColor * a, a);
    }
  `,
};

/** 弦材质：在标准材质上注入驻波位移与按弦位移（局部 Y 向下按、局部 Z 振动）。 */
function stringMaterial(color, metal) {
  const uniforms = {
    uAmp: { value: 0 }, uPhase: { value: 0 }, uPress: { value: 0 }, uPressAt: { value: 0 }, uMode: { value: 1 },
  };
  const m = new THREE.MeshStandardMaterial({
    color, roughness: metal ? 0.3 : 0.45, metalness: metal ? 0.9 : 0.2, emissive: new THREE.Color(0xffc070), emissiveIntensity: 0,
  });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uAmp; uniform float uPhase; uniform float uPress; uniform float uPressAt; uniform float uMode;`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        float s = clamp(position.x, 0.0, 1.0);
        transformed.z += uAmp * sin(3.14159265 * s * uMode) * sin(uPhase);
        float tent = uPressAt > 0.0 ? (s < uPressAt ? s / uPressAt : (1.0 - s) / (1.0 - uPressAt)) : 0.0;
        transformed.y -= uPress * tent;
      `);
  };
  m.userData.uniforms = uniforms;
  return m;
}

export class VibString {
  /**
   * @param {object} o { radius, color, glow(THREE.Color), metal, up(Vector3，局部 Y 方向参考) }
   */
  constructor(o = {}) {
    this.radius = o.radius ?? 0.0006;
    this.mat = stringMaterial(o.color ?? 0xe8e2d6, o.metal);
    this.mesh = new THREE.Mesh(UNIT_CYL, this.mat);
    this.mesh.castShadow = true;
    this.ghostMat = new THREE.ShaderMaterial({
      uniforms: {
        uAmp: { value: 0 }, uPress: { value: 0 }, uPressAt: { value: 0 }, uGlow: { value: 0 },
        uColor: { value: (o.glow ?? new THREE.Color(1.0, 0.72, 0.36)).clone() },
      },
      vertexShader: GhostShader.vertexShader,
      fragmentShader: GhostShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.ghost = new THREE.Mesh(UNIT_RIBBON, this.ghostMat);
    this.ghost.renderOrder = 8;
    this.ghost.visible = false;
    this.ghost.frustumCulled = false;
    this.mesh.frustumCulled = false;
    this.up = (o.up ?? new THREE.Vector3(0, 1, 0)).clone();
    this.maxAmp = o.maxAmp ?? 0.003;
    this.a = new THREE.Vector3();
    this.b = new THREE.Vector3();
    this.length = 0;
    this._x = new THREE.Vector3();
    this._y = new THREE.Vector3();
    this._z = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this.phase = Math.random() * 10;
  }

  addTo(parent) {
    parent.add(this.mesh, this.ghost);
    return this;
  }

  /** 设置两端点（父坐标系）。 */
  set(a, b) {
    this.a.copy(a);
    this.b.copy(b);
    const x = this._x.subVectors(b, a);
    const L = x.length();
    this.length = L;
    x.divideScalar(L);
    const y = this._y.copy(this.up).addScaledVector(x, -this.up.dot(x)).normalize();
    const z = this._z.crossVectors(x, y);
    this._m.makeBasis(x, y, z);
    for (const m of [this.mesh, this.ghost]) {
      m.position.copy(a);
      m.quaternion.setFromRotationMatrix(this._m);
    }
    this.mesh.scale.set(L, this.radius, this.radius);
    this.ghost.scale.set(L, 1, 1);
    return this;
  }

  /** 弦上比例 s 处的点（未计振动）。 */
  pointAt(s, out = new THREE.Vector3()) {
    return out.copy(this.a).lerp(this.b, s);
  }

  /**
   * @param {number} amp 振幅（米）
   * @param {number} dt 帧间隔
   * @param {number} press 按弦下压深度（米）
   * @param {number} pressAt 下压点在弦上的比例（0 表示无）
   */
  update(amp, dt, press = 0, pressAt = 0) {
    // 视觉频率：够快才显得模糊，不去对齐真实音高（屏幕刷新率下会混叠）
    this.phase += dt * 97;
    const u = this.mat.userData.uniforms;
    u.uPhase.value = this.phase;
    u.uPress.value = press / this.radius; // 局部 Y 已被 radius 缩放
    u.uPressAt.value = pressAt;
    this.mat.emissiveIntensity = Math.min(1.6, (amp / this.maxAmp) * 1.6);
    const g = this.ghostMat.uniforms;
    g.uAmp.value = amp;
    g.uPress.value = press;
    g.uPressAt.value = pressAt;
    g.uGlow.value = Math.min(1, amp / this.maxAmp) * 0.9;
    this.ghost.visible = amp > this.maxAmp * 0.03;
    // 实体弦的振动位移同样经过 radius 缩放，这里换算回局部单位
    u.uAmp.value = (amp * 0.6) / this.radius;
  }
}
