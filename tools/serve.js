// 零依赖静态服务器：node tools/serve.js [端口]  →  http://localhost:8080
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = +(process.argv[2] || process.env.PORT || 8080);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.wav': 'audio/wav', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};
export function createServer() {
return http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end('method not allowed'); }
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); }
  catch { res.writeHead(400); return res.end('bad URL'); }
  if (p.includes('\0')) { res.writeHead(400); return res.end('bad URL'); }
  if (p === '/' || p === '/web') { res.writeHead(302, { Location: '/web/index.html' }); return res.end(); }
  const file = path.normalize(path.join(root, p));
  const relative = path.relative(root, file);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().on('error', err => {
    console.error(err.code === 'EADDRINUSE' ? `端口 ${port} 已占用，请运行 npm start -- ${port + 1}` : err.message);
    process.exitCode = 1;
  }).listen(port, '127.0.0.1', () => console.log(`中国古典音乐 · 物理建模  http://localhost:${port}`));
}
