// 生成可静态部署的站点到 dist/：保持 web/ 与 src/ 的相对路径，并附带页面用到的 three.js 文件。
// node tools/build-pages.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });

const copy = (rel, filter) => fs.cpSync(path.join(root, rel), path.join(dist, rel), { recursive: true, filter });
copy('web');
copy('src');
const three = 'node_modules/three';
copy(`${three}/build`, (f) => !f.endsWith('.cjs') && !f.endsWith('.min.js'));
copy(`${three}/examples/jsm`);
copy(`${three}/LICENSE`);

// 站点根目录跳转到页面；.nojekyll 让 node_modules 等目录原样发布
fs.writeFileSync(path.join(dist, 'index.html'), `<!doctype html>
<meta charset="utf-8"><title>丝竹三韵</title>
<meta http-equiv="refresh" content="0; url=web/index.html">
<a href="web/index.html">丝竹三韵 · 古筝 二胡 唢呐</a>
`);
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

let files = 0;
let bytes = 0;
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else { files++; bytes += fs.statSync(p).size; }
  }
})(dist);
console.log(`dist/：${files} 个文件，${(bytes / 1048576).toFixed(1)} MB`);
