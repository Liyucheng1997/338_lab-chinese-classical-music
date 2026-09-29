// 殿堂：镜面石地、窗棂天光、朱漆立柱、演奏台与地毯、山水屏风、青铜灯台、浮尘
// 光束 / 浮尘 / 模糊镜面着色器沿用编钟项目，尺度改为以米计的乐器近景。
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeStatic } from './merge.js';

const BlurReflectorShader = {
  name: 'BlurReflector',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null } },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    varying vec4 vUv;
    void main() {
      vec2 uv = vUv.xy / vUv.w;
      vec3 c = texture2D(tDiffuse, uv).rgb * 0.24;
      float b = 0.0035;
      c += texture2D(tDiffuse, uv + vec2(b, 0.0)).rgb * 0.13;
      c += texture2D(tDiffuse, uv - vec2(b, 0.0)).rgb * 0.13;
      c += texture2D(tDiffuse, uv + vec2(0.0, b * 1.6)).rgb * 0.13;
      c += texture2D(tDiffuse, uv - vec2(0.0, b * 1.6)).rgb * 0.13;
      c += texture2D(tDiffuse, uv + vec2(b, b) * 1.8).rgb * 0.06;
      c += texture2D(tDiffuse, uv - vec2(b, b) * 1.8).rgb * 0.06;
      c += texture2D(tDiffuse, uv + vec2(b, -b) * 1.8).rgb * 0.06;
      c += texture2D(tDiffuse, uv - vec2(b, -b) * 1.8).rgb * 0.06;
      gl_FragColor = vec4(c * color, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

const ShaftShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vN = normalize(mat3(modelMatrix) * normal);
      vV = normalize(cameraPosition - wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uOpacity;
    uniform vec3 uColor;
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      float along = vUv.y;
      float fade = smoothstep(0.0, 0.55, along) * smoothstep(1.0, 0.9, along);
      float facing = pow(abs(dot(vN, vV)), 2.2);
      float streak = 0.62 + 0.38 * sin(vUv.x * 43.0 + uTime * 0.25) * sin(vUv.x * 17.0 - uTime * 0.17 + along * 3.0);
      float a = fade * facing * streak * uOpacity;
      gl_FragColor = vec4(uColor * a, a);
    }
  `,
};

const DustShader = {
  vertexShader: /* glsl */ `
    attribute float aSeed;
    uniform float uTime;
    uniform float uSize;
    varying float vAlpha;
    void main() {
      vec3 p = position;
      p.x += sin(uTime * 0.05 + aSeed * 40.0) * 0.35;
      p.y += sin(uTime * 0.037 + aSeed * 23.0) * 0.25;
      p.z += cos(uTime * 0.043 + aSeed * 31.0) * 0.3;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = min(uSize * (0.4 + aSeed) / -mv.z, 6.0);
      float lit = smoothstep(2.6, 0.0, length(p.xz - vec2(0.4, 0.6))) * 0.8 + 0.2;
      vAlpha = lit * (0.35 + 0.65 * abs(sin(uTime * 0.4 + aSeed * 60.0))) * smoothstep(0.6, 2.2, -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    varying float vAlpha;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.0, d) * vAlpha;
      gl_FragColor = vec4(uColor * a, a);
    }
  `,
};

export const DAIS_TOP = 0.16;

export class Hall {
  constructor(stage, tex) {
    this.stage = stage;
    const scene = stage.scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    const w = window.innerWidth;
    const h = window.innerHeight;
    this.reflector = new Reflector(new THREE.PlaneGeometry(60, 60), {
      clipBias: 0.003,
      textureWidth: w * 0.5,
      textureHeight: h * 0.5,
      color: new THREE.Color(0.62, 0.58, 0.54),
      shader: BlurReflectorShader,
      multisample: 0,
    });
    this.reflector.rotation.x = -Math.PI / 2;
    this.reflector.position.y = -0.002;
    this.group.add(this.reflector);
    stage.onResize = (W, H) => this.reflector.getRenderTarget().setSize(Math.max(1, Math.round(W * 0.5)), Math.max(1, Math.round(H * 0.5)));

    ['map', 'ormMap', 'bumpMap'].forEach((k) => tex.floor[k].repeat.set(22, 22));
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({
        map: tex.floor.map, roughnessMap: tex.floor.ormMap, bumpMap: tex.floor.bumpMap, bumpScale: 1.5,
        roughness: 1, metalness: 0, transparent: true, opacity: 0.8, envMapIntensity: 0.4,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.renderOrder = -1;
    this.floor = floor;
    this.group.add(floor);

    this.#walls(tex);
    this.#dais(tex);
    this.#screen(tex);
    this.#shafts();
    this.#lamps(tex);
    this.#dust();
  }

  #walls(tex) {
    tex.wall.repeat.set(8, 3);
    const wallMat = new THREE.MeshStandardMaterial({ map: tex.wall, roughness: 0.85, metalness: 0 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), wallMat);
    wall.position.set(0, 6, -5.5);
    wall.receiveShadow = true;
    this.group.add(wall);

    const winMat = new THREE.MeshBasicMaterial({ map: tex.lattice, color: new THREE.Color(1.35, 1.1, 0.85), fog: false });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a120c, roughness: 0.5 });
    this.windowXs = [-4.4, 0, 4.4];
    this.windowXs.forEach((x) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.1), winMat);
      m.position.set(x, 4.7, -5.46);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 0.08), frameMat);
      frame.position.set(x, 4.7, -5.52);
      this.group.add(m, frame);
    });

    const colMat = new THREE.MeshPhysicalMaterial({
      map: tex.column.map, roughnessMap: tex.column.roughnessMap, roughness: 1, clearcoat: 0.6, clearcoatRoughness: 0.25,
    });
    tex.column.map.repeat.set(1, 1);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x3a3430, roughness: 0.7 });
    [[-6.4, -3.6], [6.4, -3.6], [-8.6, 1.4], [8.6, 1.4]].forEach(([x, z]) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.33, 12, 32), colMat);
      c.position.set(x, 6, z);
      c.castShadow = true;
      c.receiveShadow = true;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.52, 0.3, 32), baseMat);
      b.position.set(x, 0.15, z);
      b.receiveShadow = true;
      this.group.add(c, b);
    });
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(24, 0.5, 0.4), colMat);
    lintel.position.set(0, 7.6, -3.6);
    this.group.add(lintel);
  }

  // 演奏台：黑漆台身 + 朱漆描金边，上铺地毯
  #dais(tex) {
    const g = new THREE.Group();
    const W = 7.6;
    const D = 4.2;
    const H = DAIS_TOP;
    const side = new THREE.MeshPhysicalMaterial({
      map: tex.lacquer.map, roughnessMap: tex.lacquer.roughnessMap, roughness: 1, clearcoat: 0.8, clearcoatRoughness: 0.2,
    });
    const top = new THREE.MeshPhysicalMaterial({
      map: tex.rosewood.map, roughnessMap: tex.rosewood.roughnessMap, bumpMap: tex.rosewood.bumpMap, bumpScale: 0.4,
      roughness: 1, clearcoat: 0.7, clearcoatRoughness: 0.18, color: 0x8a6a5a,
    });
    const box = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), [side, side, top, top, side, side]);
    box.position.set(0, H / 2, -0.3);
    box.castShadow = false;
    box.receiveShadow = true;
    g.add(box);
    // 台沿金线
    const gold = new THREE.MeshStandardMaterial({ color: 0xc89a4a, roughness: 0.3, metalness: 1 });
    [[W + 0.02, 0.012, 0.012, 0, H, D / 2 - 0.3], [W + 0.02, 0.012, 0.012, 0, H, -D / 2 - 0.3],
      [0.012, 0.012, D, W / 2, H, -0.3], [0.012, 0.012, D, -W / 2, H, -0.3]].forEach(([a, b, c, x, y, z]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(a, b, c), gold);
      m.position.set(x, y, z);
      g.add(m);
    });
    const rug = new THREE.Mesh(
      new THREE.PlaneGeometry(6.6, 3.3),
      new THREE.MeshStandardMaterial({ map: tex.rug, color: 0x8a7a72, roughness: 0.95, metalness: 0, envMapIntensity: 0.3 }),
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, H + 0.004, 0);
    rug.receiveShadow = true;
    g.add(rug);
    mergeStatic(g, (o) => o !== rug);
    this.group.add(g);
  }

  // 五扇山水屏风
  #screen(tex) {
    const g = new THREE.Group();
    const N = 5;
    const PW = 1.12;
    const PH = 2.25;
    const frameMat = new THREE.MeshPhysicalMaterial({
      map: tex.rosewood.map, roughnessMap: tex.rosewood.roughnessMap, roughness: 1, clearcoat: 0.8, clearcoatRoughness: 0.2, color: 0x6e4a3e,
    });
    const gold = new THREE.MeshStandardMaterial({ color: 0xc89a4a, roughness: 0.35, metalness: 1 });
    const paint = new THREE.MeshStandardMaterial({ map: tex.shanshui, color: 0xa89e8e, roughness: 0.9, metalness: 0, envMapIntensity: 0.25 });
    for (let k = 0; k < N; k++) {
      const p = new THREE.Group();
      const geo = new THREE.PlaneGeometry(PW - 0.12, PH - 0.5);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, (k + uv.getX(i)) / N);
      const canvas = new THREE.Mesh(geo, paint);
      canvas.position.set(0, PH / 2 + 0.12, 0.016);
      canvas.receiveShadow = true;
      p.add(canvas);
      // 框与裙板
      const bar = (w, h, x, y) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), frameMat);
        m.position.set(x, y, 0);
        m.castShadow = true;
        p.add(m);
      };
      bar(PW, 0.06, 0, PH + 0.13);
      bar(PW, 0.06, 0, 0.38);
      bar(PW, 0.2, 0, 0.22);
      bar(0.06, PH + 0.1, -PW / 2 + 0.03, PH / 2 + 0.1);
      bar(0.06, PH + 0.1, PW / 2 - 0.03, PH / 2 + 0.1);
      const line = new THREE.Mesh(new THREE.BoxGeometry(PW - 0.1, 0.012, 0.056), gold);
      line.position.set(0, 0.3, 0);
      p.add(line);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.36), frameMat);
      foot.position.set(0, 0.05, 0);
      if (k === 0 || k === N - 1) p.add(foot);
      // 折扇：交替微转成锯齿形
      const ang = (k % 2 ? -1 : 1) * 0.16;
      const x = (k - (N - 1) / 2) * PW * Math.cos(0.16);
      p.position.set(x, DAIS_TOP, -1.95 + (k % 2 ? 0.08 : 0));
      p.rotation.y = ang;
      g.add(p);
    }
    mergeStatic(g);
    this.group.add(g);
  }

  #shafts() {
    this.shaftMats = [];
    this.windowXs.forEach((x, i) => {
      const top = new THREE.Vector3(x, 4.7, -5.4);
      const bottom = new THREE.Vector3(x * 0.45 + 0.3, 0, 1.4 + (i === 1 ? 0.3 : 0));
      const dir = new THREE.Vector3().subVectors(top, bottom);
      const len = dir.length();
      const geo = new THREE.CylinderGeometry(0.8, 1.7, len, 40, 1, true);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: i === 1 ? 0.03 : 0.022 },
          uColor: { value: new THREE.Color(1.0, 0.78, 0.5) },
        },
        vertexShader: ShaftShader.vertexShader,
        fragmentShader: ShaftShader.fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(bottom).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      m.renderOrder = 5;
      this.group.add(m);
      this.shaftMats.push(mat);
    });
  }

  #lamps(tex) {
    const bronze = new THREE.MeshStandardMaterial({
      map: tex.brass.map, roughnessMap: tex.brass.ormMap, metalnessMap: tex.brass.ormMap,
      metalness: 1, roughness: 1, color: 0x9a7a5a, envMapIntensity: 1.1,
    });
    this.flames = [];
    [[-3.45, -1.25], [3.45, -1.25]].forEach(([x, z], i) => {
      const g = new THREE.Group();
      const s = 0.82;
      const prof = [
        [0, 0], [0.42, 0], [0.44, 0.05], [0.3, 0.1], [0.2, 0.16], [0.08, 0.3], [0.06, 0.5], [0.07, 0.55],
        [0.05, 0.6], [0.05, 1.3], [0.08, 1.34], [0.05, 1.38], [0.05, 1.62], [0.1, 1.64], [0.28, 1.7],
        [0.34, 1.76], [0.32, 1.78], [0.24, 1.72], [0.0, 1.72],
      ].map(([r, y]) => new THREE.Vector2(r * s * 0.7, y * s));
      const stand = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), bronze);
      stand.castShadow = true;
      g.add(stand);
      for (let k = 0; k < 6; k++) {
        const kn = new THREE.Mesh(new THREE.TorusKnotGeometry(0.028, 0.009, 32, 5, 2, 3), bronze);
        const a = (k / 6) * Math.PI * 2;
        kn.position.set(Math.cos(a) * 0.2 * s, 1.73 * s, Math.sin(a) * 0.2 * s);
        g.add(kn);
      }
      g.position.set(x, DAIS_TOP, z);
      mergeStatic(g);
      this.group.add(g);
      const fy = DAIS_TOP + 1.58;
      const flameCore = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex.glow, color: new THREE.Color(3.2, 2.4, 1.3), blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      flameCore.scale.set(0.09, 0.2, 1);
      flameCore.position.set(x, fy, z);
      const flameHalo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex.glow, color: new THREE.Color(1.8, 0.75, 0.25), blending: THREE.AdditiveBlending, depthWrite: false,
        opacity: 0.7, fog: false,
      }));
      flameHalo.scale.set(0.5, 0.62, 1);
      flameHalo.position.set(x, fy + 0.02, z);
      const light = new THREE.PointLight(0xff9a48, 3.2, 0, 2);
      light.position.set(x, fy + 0.1, z);
      this.group.add(flameCore, flameHalo, light);
      this.flames.push({ core: flameCore, halo: flameHalo, light, seed: i * 7.3 });
    });
  }

  #dust() {
    const N = 1400;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 11;
      pos[i * 3 + 1] = Math.random() * 4.2;
      pos[i * 3 + 2] = -3.5 + Math.random() * 7;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 9 * Math.min(window.devicePixelRatio, 2) },
        uColor: { value: new THREE.Color(1.0, 0.8, 0.55).multiplyScalar(0.85) },
      },
      vertexShader: DustShader.vertexShader,
      fragmentShader: DustShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, this.dustMat);
    pts.renderOrder = 6;
    pts.frustumCulled = false;
    this.group.add(pts);
  }

  setQuality(q) {
    this.reflector.visible = q === 'high';
    this.floor.material.opacity = q === 'high' ? 0.8 : 1;
    this.floor.material.transparent = q === 'high';
  }

  update(t) {
    this.shaftMats.forEach((m) => (m.uniforms.uTime.value = t));
    this.dustMat.uniforms.uTime.value = t;
    for (const f of this.flames) {
      const n = Math.sin(t * 13 + f.seed) * 0.5 + Math.sin(t * 7.3 + f.seed * 2) * 0.3 + Math.sin(t * 23 + f.seed) * 0.2;
      const k = 1 + n * 0.12;
      f.core.scale.set(0.09 * (2 - k), 0.2 * k, 1);
      f.halo.material.opacity = 0.62 + n * 0.12;
      f.light.intensity = 3.2 * (0.88 + n * 0.14);
    }
  }
}
