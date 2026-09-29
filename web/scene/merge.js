// 将静态网格按材质合并，显著减少绘制调用（阴影与镜面反射各需额外一遍）
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function mergeStatic(root, filter = () => true) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  const remove = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || !filter(o)) return;
    const g = o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    }
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push({ g, cast: o.castShadow, recv: o.receiveShadow });
    remove.push(o);
  });
  remove.forEach((o) => o.parent.remove(o));
  for (const [mat, list] of byMat) {
    const indexed = list.filter((x) => x.g.index);
    const plain = list.filter((x) => !x.g.index);
    for (const part of [indexed, plain]) {
      if (!part.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(part.map((x) => x.g)), mat);
      mesh.castShadow = part.some((x) => x.cast);
      mesh.receiveShadow = part.some((x) => x.recv);
      root.add(mesh);
    }
  }
}
