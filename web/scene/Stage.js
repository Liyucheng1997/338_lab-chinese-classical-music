// 舞台：渲染器、相机、控制器、环境光照、后期处理（沿用编钟项目的殿堂布光，按乐器尺度缩放）
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// 暗角 + 胶片颗粒 + 轻微色散，营造博物馆夜场的氛围
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 1.05 },
    uGrain: { value: 0.035 },
    uAberration: { value: 0.0012 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uAberration;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * uAberration * (1.0 + r2 * 4.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float vig = smoothstep(0.95, 0.18, r2 * uVignette * 1.6);
      col *= mix(0.35, 1.0, vig);
      // 暗部偏暖、亮部偏金的轻度调色
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * vec3(1.05, 0.98, 0.9), smoothstep(0.0, 0.6, l) * 0.5);
      col += (hash(vUv * 1000.0 + fract(uTime * 7.13)) - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Stage {
  constructor(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060403);
    scene.fog = new THREE.FogExp2(0x080504, 0.045);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.02, 120);
    camera.position.set(0, 2.2, 5.6);
    this.camera = camera;

    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 0.8, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 0.35;
    controls.maxDistance = 12;
    controls.minPolarAngle = 0.2;
    controls.maxPolarAngle = 1.52;
    controls.screenSpacePanning = true;
    controls.rotateSpeed = 0.6;
    controls.zoomSpeed = 0.8;
    this.controls = controls;

    this.#environment();
    this.#lights();
    this.#post();
    this.quality = 'high';
    this.viewShift = 0;
    this.#applyViewOffset();

    window.addEventListener('resize', () => this.resize());
  }

  // 用于金属反射的暖色殿堂环境图
  #environment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = new THREE.Scene();
    const room = new THREE.Mesh(
      new THREE.SphereGeometry(30, 32, 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.03, 0.018, 0.012), side: THREE.BackSide }),
    );
    env.add(room);
    const panel = (w, h, color, pos, look) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      m.position.copy(pos);
      m.lookAt(look);
      env.add(m);
    };
    const O = new THREE.Vector3(0, 2, 0);
    panel(16, 6, new THREE.Color(1.3, 1.0, 0.72), new THREE.Vector3(0, 16, 6), O); // 天光
    panel(5, 3, new THREE.Color(3.2, 2.2, 1.3), new THREE.Vector3(-9, 9, -18), O); // 窗
    panel(5, 3, new THREE.Color(3.2, 2.2, 1.3), new THREE.Vector3(0, 9, -18), O);
    panel(5, 3, new THREE.Color(3.2, 2.2, 1.3), new THREE.Vector3(9, 9, -18), O);
    panel(2, 2, new THREE.Color(9, 4.5, 1.6), new THREE.Vector3(-12, 3, 10), O); // 灯火
    panel(2, 2, new THREE.Color(9, 4.5, 1.6), new THREE.Vector3(12, 3, 10), O);
    panel(30, 6, new THREE.Color(0.12, 0.08, 0.06), new THREE.Vector3(0, 2, 22), O); // 前方弱反光
    this.envMap = pmrem.fromScene(env, 0.035).texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.85;
    pmrem.dispose();
  }

  #lights() {
    const s = this.scene;
    const key = new THREE.SpotLight(0xffe2c0, 190, 0, 0.62, 0.7, 2);
    key.position.set(2.8, 6.2, 5.2);
    key.target.position.set(0, 0.7, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.025;
    key.shadow.radius = 3;
    key.shadow.camera.near = 3;
    key.shadow.camera.far = 16;
    s.add(key, key.target);
    this.key = key;

    const fill = new THREE.SpotLight(0xffb27a, 55, 0, 0.7, 0.9, 2);
    fill.position.set(-4.5, 3.2, 4.2);
    fill.target.position.set(0, 0.8, 0);
    s.add(fill, fill.target);

    const rimL = new THREE.DirectionalLight(0x9db4ff, 0.9);
    rimL.position.set(-4, 7, -10);
    // 三件乐器各一盏顶光，让琴弦与指法在暗场中清晰可见
    this.pools = [[-1.95, 0.32], [0, 0.1], [1.95, 0.32]].map(([x, z]) => {
      const l = new THREE.SpotLight(0xffd9a8, 9, 0, 0.42, 0.85, 2);
      l.position.set(x * 1.05, 3.4, z + 1.1);
      l.target.position.set(x, 0.7, z);
      s.add(l, l.target);
      return l;
    });
    s.add(rimL);
    const rimR = new THREE.SpotLight(0xffa860, 70, 0, 0.8, 0.8, 2);
    rimR.position.set(3.5, 4.2, -3.8);
    rimR.target.position.set(0, 0.9, 0);
    s.add(rimR, rimR.target);

    s.add(new THREE.HemisphereLight(0x4a3526, 0x080504, 0.55));
  }

  #post() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, rt);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    composer.setSize(w, h);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.45, 0.92);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.finalPass = new ShaderPass(FinalShader);
    composer.addPass(this.finalPass);
    this.composer = composer;
  }

  setQuality(q) {
    this.quality = q;
    const pr = q === 'high' ? Math.min(window.devicePixelRatio, 2) : Math.min(window.devicePixelRatio, 1);
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = q === 'high';
    this.key.castShadow = q === 'high';
    this.scene.traverse((o) => {
      if (o.material) o.material.needsUpdate = true;
    });
    this.resize();
  }

  // 让画面中心避开右侧曲目面板
  setViewShift(px) {
    this.viewShift = px;
    this.#applyViewOffset();
  }

  #applyViewOffset() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    if (this.viewShift) this.camera.setViewOffset(w, h, this.viewShift, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (!w || !h) return; // 页面被隐藏时尺寸为 0，跳过以免渲染目标无效
    this.#applyViewOffset();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.onResize?.(w, h);
  }

  render(t) {
    this.finalPass.uniforms.uTime.value = t;
    this.composer.render();
  }
}
