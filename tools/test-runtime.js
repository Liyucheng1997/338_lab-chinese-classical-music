// 回归验证：真实 DSP 的实时事件生命周期 + 本地 HTTP 服务。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from './serve.js';
import { rms, peak } from '../src/analysis/analysis.js';
import { encodeWav, decodeWav } from '../src/wav.js';

let Live;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
globalThis.registerProcessor = (name, ctor) => { Live = ctor; };
globalThis.sampleRate = 48000;
await import('../web/worklet.js');

function render(live, seconds, block = 128) {
  const length = Math.ceil(seconds * live.fs / block) * block;
  const result = new Float32Array(length);
  const l = new Float32Array(block), r = new Float32Array(block);
  for (let offset = 0; offset < length; offset += block) {
    live.process([], [[l, r]]);
    assert.ok(l.every(Number.isFinite) && r.every(Number.isFinite), '输出必须为有限值');
    result.set(l, offset);
  }
  return result;
}

for (const fs of [44100, 48000]) {
  test(`${fs} Hz：三种乐器实时发声，松开后衰减`, () => {
    globalThis.sampleRate = fs;
    for (const [on, off, args] of [
      ['pluck', 'guzhengOff', { string: 10 }],
      ['erhuOn', 'erhuOff', { hz: 440 }],
      ['suonaOn', 'suonaOff', { hz: 880 }],
    ]) {
      const live = new Live();
      live.onMsg({ type: on, vel: 0.75, ...args });
      const sound = render(live, 0.5);
      assert.ok(peak(sound) > 0.01, `${on} 必须有声音`);
      live.onMsg({ type: off });
      const tail = render(live, 4);
      const end = rms(tail, tail.length - Math.round(fs * 0.2), Math.round(fs * 0.2));
      assert.ok(end < 0.002, `${off} 应可靠止音，尾音 RMS=${end}`);
    }
  });
}

test('极短按键不能让延迟的起音事件在松开后重新发声', () => {
  const live = new Live();
  live.onMsg({ type: 'suonaOn', hz: 880, vel: 0.8 });
  render(live, 0.01);
  live.onMsg({ type: 'suonaOff' });
  const after = render(live, 2);
  assert.ok(rms(after, after.length - 4800, 4800) < 0.001);
  assert.equal(live.s.pm.target, 0);
  // 同一音频块前收到按下、松开时也不能遗留弓速或口压。
  for (const kind of ['erhu', 'suona']) {
    live.onMsg({ type: kind + 'On', hz: 440, vel: 0.8 });
    live.onMsg({ type: kind + 'Off' });
  }
  const silent = render(live, 1);
  assert.ok(rms(silent, silent.length - 4800, 4800) < 0.001);
});

test('二胡换弦后松开：两根弦和待执行揉弦都停止', () => {
  const live = new Live();
  live.onMsg({ type: 'erhuOn', hz: 330, vel: 0.8 });
  render(live, 0.1);
  live.onMsg({ type: 'erhuBend', hz: 660 });
  render(live, 0.01);
  live.onMsg({ type: 'erhuOff' });
  render(live, 0.5);
  assert.ok(live.e.ctl.every(c => c.vb.target === 0 && c.vib === null));
});

test('拖动力度更新二胡弓速与唢呐口压，支持不同音频块长度', () => {
  const live = new Live();
  live.onMsg({ type: 'erhuOn', hz: 440, vel: 0.8 });
  live.onMsg({ type: 'suonaOn', hz: 880, vel: 0.8 });
  render(live, 0.1);
  const bow = live.e.ctl[live.eStr].vb.target, breath = live.s.pm.target;
  live.onMsg({ type: 'erhuExpression', vel: 0.25 });
  live.onMsg({ type: 'suonaExpression', vel: 0.25 });
  render(live, 0.1, 256);
  assert.ok(live.e.ctl[live.eStr].vb.target < bow);
  assert.ok(live.s.pm.target < breath);
});

test('WAV 下载格式：16/24 位 PCM 和 32 位浮点均可往返', () => {
  const original = [Float32Array.from([0, 0.25, -0.5, 0.9]), Float32Array.from([0.1, -0.2, 0.3, -0.4])];
  for (const bits of [16, 24, 32]) {
    const decoded = decodeWav(encodeWav(original, 44100, bits));
    assert.equal(decoded.sampleRate, 44100);
    assert.equal(decoded.channels.length, 2);
    decoded.channels.forEach((channel, c) => channel.forEach((v, i) => assert.ok(Math.abs(v - original[c][i]) < 0.0001)));
  }
});

test('静态服务：入口、模块、HEAD、错误 URL 和越界路径', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const request = (path, method = 'GET') => new Promise((resolve, reject) => {
    http.request({ hostname: '127.0.0.1', port, path, method }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject).end();
  });
  try {
    const root = await request('/');
    assert.equal(root.status, 302); assert.equal(root.headers.location, '/web/index.html');
    assert.equal((await request('/web/index.html')).status, 200);
    assert.match((await request('/web/worklet.js')).headers['content-type'], /javascript/);
    assert.equal((await request('/web/style.css', 'HEAD')).body, '');
    assert.equal((await request('/missing')).status, 404);
    assert.equal((await request('/%zz')).status, 400);
    assert.equal((await request('/%00')).status, 400);
    assert.equal((await request('/%2e%2e/package.json')).status, 403);
    assert.equal((await request('/%2e%2e%5cpackage.json')).status, 403);
    assert.equal((await request('/', 'POST')).status, 405);
    assert.equal((await request('/src/pieces.js')).status, 200, '错误请求后仍然可用');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
