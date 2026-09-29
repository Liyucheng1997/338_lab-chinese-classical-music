// 发声特效：声波涟漪（可朝向任意法线）、金色光尘、瞬时补光
import * as THREE from 'three';

const RingShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform float uAlpha;
    uniform float uWidth;
    uniform vec3 uColor;
    varying vec2 vUv;
    void main() {
      float r = length(vUv - 0.5) * 2.0;
      float ring = smoothstep(uWidth, 0.0, abs(r - (1.0 - uWidth)));
      float inner = smoothstep(1.0, 0.0, r) * 0.08;
      float a = (ring + inner) * uAlpha;
      gl_FragColor = vec4(uColor * a, a);
    }
  `,
};

const SparkShader = {
  vertexShader: /* glsl */ `
    attribute float aLife;
    attribute float aSize;
    uniform float uScale;
    varying float vLife;
    void main() {
      vLife = aLife;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * uScale * (0.3 + aLife) / -mv.z;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    varying float vLife;
    void main() {
      if (vLife <= 0.0) discard;
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.0, d) * vLife;
      vec3 c = mix(vec3(1.0, 0.3, 0.05), vec3(1.0, 0.72, 0.32), vLife) * 1.7;
      gl_FragColor = vec4(c * a, a);
    }
  `,
};

export class Effects {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.group = new THREE.Group();
    scene.add(this.group);

    // 涟漪池
    this.rings = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 56; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uAlpha: { value: 0 },
          uWidth: { value: 0.08 },
          uColor: { value: new THREE.Color(1.0, 0.66, 0.3).multiplyScalar(2.6) },
        },
        vertexShader: RingShader.vertexShader,
        fragmentShader: RingShader.fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.renderOrder = 10;
      this.group.add(m);
      this.rings.push({ mesh: m, t0: 0, dur: 1, s0: 1, s1: 3, amp: 0, active: false, normal: null });
    }
    this.ringIdx = 0;
    this.ringColor = new THREE.Color(1.0, 0.66, 0.3).multiplyScalar(2.6);

    // 火星粒子
    this.N = 900;
    this.sp = {
      pos: new Float32Array(this.N * 3),
      vel: new Float32Array(this.N * 3),
      life: new Float32Array(this.N),
      decay: new Float32Array(this.N),
      size: new Float32Array(this.N),
    };
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sp.pos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('aLife', new THREE.BufferAttribute(this.sp.life, 1).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('aSize', new THREE.BufferAttribute(this.sp.size, 1));
    this.sparkGeo = sg;
    const sm = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 7 * Math.min(window.devicePixelRatio, 2) } },
      vertexShader: SparkShader.vertexShader,
      fragmentShader: SparkShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(sg, sm);
    pts.frustumCulled = false;
    pts.renderOrder = 11;
    this.group.add(pts);
    this.spIdx = 0;

    // 瞬时补光（轮流使用，数量固定以免着色器重编译）
    this.flashes = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xff9440, 0, 1.2, 2);
      this.group.add(l);
      this.flashes.push({ light: l, t0: -9, amp: 0 });
    }
    this.flashIdx = 0;
  }

  // normal 为空时涟漪朝向相机；否则平铺在以 normal 为法线的平面上
  ripple(center, size, vel, t, delay = 0, normal = null, color = null, dur = null) {
    const r = this.rings[this.ringIdx];
    this.ringIdx = (this.ringIdx + 1) % this.rings.length;
    r.mesh.position.copy(center);
    r.normal = normal ? normal.clone() : null;
    if (normal) r.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    r.mesh.material.uniforms.uColor.value.copy(color || this.ringColor);
    r.t0 = t + delay;
    r.dur = dur ?? 1.0 + size * 2;
    r.s0 = size * 0.9;
    r.s1 = size * (2.8 + vel * 1.2);
    r.amp = 0.5 + vel * 0.7;
    r.active = true;
    r.mesh.visible = false;
  }

  sparks(p, n, vel, count = 14, speed = 0.22) {
    const S = this.sp;
    const k = Math.round(count * (0.4 + vel));
    for (let i = 0; i < k; i++) {
      const j = this.spIdx;
      this.spIdx = (this.spIdx + 1) % this.N;
      S.pos[j * 3] = p.x;
      S.pos[j * 3 + 1] = p.y;
      S.pos[j * 3 + 2] = p.z;
      const sp = (0.6 + Math.random() * 1.6 * vel) * speed;
      S.vel[j * 3] = n.x * sp + (Math.random() - 0.5) * 1.4 * speed;
      S.vel[j * 3 + 1] = n.y * sp + Math.random() * 1.2 * speed;
      S.vel[j * 3 + 2] = n.z * sp + (Math.random() - 0.5) * 1.4 * speed;
      S.life[j] = 1;
      S.decay[j] = 0.7 + Math.random() * 1.1;
      S.size[j] = 0.6 + Math.random() * 1.2;
    }
    this.sparkGeo.attributes.aSize.needsUpdate = true;
  }

  flash(p, vel, t) {
    const f = this.flashes[this.flashIdx];
    this.flashIdx = (this.flashIdx + 1) % this.flashes.length;
    f.light.position.copy(p);
    f.t0 = t;
    f.amp = 0.3 + vel * 0.9;
  }

  update(t, dt) {
    const q = this.camera.quaternion;
    for (const r of this.rings) {
      if (!r.active) continue;
      const p = (t - r.t0) / r.dur;
      if (p < 0) continue;
      if (p >= 1) { r.active = false; r.mesh.visible = false; continue; }
      r.mesh.visible = true;
      const e = 1 - Math.pow(1 - p, 2.2);
      r.mesh.scale.setScalar(r.s0 + (r.s1 - r.s0) * e);
      if (!r.normal) r.mesh.quaternion.copy(q);
      r.mesh.material.uniforms.uAlpha.value = r.amp * Math.pow(1 - p, 2) * Math.min(1, p * 12);
      r.mesh.material.uniforms.uWidth.value = 0.05 + 0.1 * p;
    }

    const S = this.sp;
    const drag = Math.exp(-dt * 2.2);
    for (let i = 0; i < this.N; i++) {
      if (S.life[i] <= 0) continue;
      S.vel[i * 3] *= drag;
      S.vel[i * 3 + 1] = S.vel[i * 3 + 1] * drag - 0.18 * dt;
      S.vel[i * 3 + 2] *= drag;
      S.pos[i * 3] += S.vel[i * 3] * dt;
      S.pos[i * 3 + 1] += S.vel[i * 3 + 1] * dt;
      S.pos[i * 3 + 2] += S.vel[i * 3 + 2] * dt;
      S.life[i] = Math.max(0, S.life[i] - dt * S.decay[i]);
    }
    this.sparkGeo.attributes.position.needsUpdate = true;
    this.sparkGeo.attributes.aLife.needsUpdate = true;

    for (const f of this.flashes) {
      const p = t - f.t0;
      f.light.intensity = p >= 0 && p < 1.5 ? f.amp * Math.exp(-p * 3.5) : 0;
    }
  }
}
