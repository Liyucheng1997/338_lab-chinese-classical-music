// 丝竹三韵：Three.js 殿堂中的古筝、二胡、唢呐。
// 曲目由 Worker 用物理建模整曲合成，播放时以音频时钟驱动三维演奏动画；亲手演奏走 AudioWorklet 实时引擎。
import * as THREE from 'three';
import { PIECES } from '../src/pieces.js';
import { midiName } from '../src/dsp/tuning.js';
import { encodeWav } from '../src/wav.js';
import { GUZHENG_MIDI } from '../src/dsp/guzheng.js';
import { Stage } from './scene/Stage.js';
import { Hall, DAIS_TOP } from './scene/Hall.js';
import { Effects } from './scene/Effects.js';
import { Guzheng } from './scene/Guzheng.js';
import { Erhu } from './scene/Erhu.js';
import { Suona } from './scene/Suona.js';
import { createHandMaterials } from './scene/Hand.js';
import { GuzhengGirl, ErhuOldMan, SuonaMan } from './scene/figure/Performers.js';
import { lastStarted, mtof, clamp } from './scene/anim.js';
import {
  createWoodTexture, createGuzhengTopTexture, createGuzhengSideTexture, createPythonSkinTexture, createSoundWindowTexture,
  createBrassTextures, createLacquerTexture, createFloorTextures, createWallTexture, createLatticeTexture, createGlowTexture,
  createFadeTexture, createShanshuiTexture, createRugTexture,
} from './scene/textures.js';

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => setTimeout(r, 16));
const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const INST_NAME = { guzheng: '古筝', erhu: '二胡', suona: '唢呐' };
const GLYPH = { guzheng: '筝', erhu: '胡', suona: '呐' };
const TUNINGS = { equal: '十二平均律', pythagorean: '五度相生律', just: '纯律' };

// ───────────────────────────── 载入与建模 ─────────────────────────────
const loaderFill = $('loader-fill');
const loaderText = $('loader-text');
const progress = (p, text) => {
  loaderFill.style.width = `${Math.round(p * 100)}%`;
  if (text) loaderText.textContent = text;
};

const stage = new Stage($('stage'));
const tex = {};
const steps = [
  ['选桐木、刨面板', () => { tex.guzhengTop = createGuzhengTopTexture(); tex.guzhengSide = createGuzhengSideTexture(); }],
  ['取红木、乌木', () => {
    tex.rosewood = createWoodTexture('rosewood', { seed: 7 });
    tex.ebony = createWoodTexture('ebony', { W: 256, H: 256, seed: 9 });
  }],
  ['蒙蟒皮、镂音窗', () => { tex.python = createPythonSkinTexture(); tex.soundWindow = createSoundWindowTexture(); }],
  ['打铜碗', () => { tex.brass = createBrassTextures(); }],
  ['髹漆、铺地衣', () => {
    tex.lacquer = createLacquerTexture();
    tex.column = createLacquerTexture({ base: '#5e120d', paint: '#240805', accent: '#b8883e', seed: 41 });
    tex.rug = createRugTexture();
  }],
  ['绘山水屏风', () => { tex.shanshui = createShanshuiTexture(); }],
  ['布置殿堂', () => {
    tex.floor = createFloorTextures();
    tex.wall = createWallTexture();
    tex.lattice = createLatticeTexture();
    tex.glow = createGlowTexture();
    tex.fade = createFadeTexture();
  }],
];
for (let i = 0; i < steps.length; i++) {
  progress(0.04 + (i / steps.length) * 0.56, `${steps[i][0]}……`);
  await nextFrame();
  steps[i][1]();
}
progress(0.62, '斫琴、安弦……');
await nextFrame();
const hall = new Hall(stage, tex);
const effects = new Effects(stage.scene, stage.camera);
// 三位乐师各自的肤色（与面部贴图同色）；手臂由人物接上，手不再画渐隐前臂
const handMats = {
  guzheng: createHandMaterials(tex, { skin: '#ecc7ae', sheen: 0xffb4a4, nail: 0xf0c4ba }),
  erhu: createHandMaterials(tex, { skin: '#c69d84', sheen: 0xd9a896, nail: 0xd9bca6 }),
  suona: createHandMaterials(tex, { skin: '#bb8a6a', sheen: 0xd9a080, nail: 0xd2a88c }),
};
const guzheng = new Guzheng(stage.scene, tex, handMats.guzheng, effects, { hand: { forearm: false, scale: 0.9 } });
guzheng.group.position.set(0, DAIS_TOP, 0.12);
guzheng.group.rotation.y = Math.PI; // 演奏者坐在琴后、面向听众
progress(0.66, '少女梳妆……');
await nextFrame();
const girl = new GuzhengGirl(guzheng, handMats.guzheng);
progress(0.72, '上弦、穿弓……');
await nextFrame();
const erhu = new Erhu(stage.scene, tex, handMats.erhu, effects, { hand: { forearm: false }, seat: false });
erhu.group.position.set(-1.95, DAIS_TOP, 0.32);
erhu.group.rotation.y = 0.5;
progress(0.76, '老琴师入座……');
await nextFrame();
const oldman = new ErhuOldMan(erhu, handMats.erhu);
progress(0.8, '装哨、试音孔……');
await nextFrame();
const suona = new Suona(stage.scene, tex, handMats.suona, effects, { hand: { forearm: false }, baseY: 1.2 });
suona.group.position.set(1.95, DAIS_TOP, 0.32);
suona.group.rotation.y = -0.55;
progress(0.84, '唢呐匠登台……');
await nextFrame();
const suonaMan = new SuonaMan(suona, handMats.suona);
const INSTS = { guzheng, erhu, suona };
const PLAYERS = { guzheng: girl, erhu: oldman, suona: suonaMan };
const pickables = [...guzheng.pickables, ...erhu.pickables, ...suona.pickables];
progress(0.88, '点灯……');
await nextFrame();
stage.renderer.compile(stage.scene, stage.camera);
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') window.__sz = { stage, guzheng, erhu, suona, girl, oldman, suonaMan, THREE };

// ───────────────────────────── 相机 ─────────────────────────────
const VIEWS = {
  all: { pos: new THREE.Vector3(0, 2.45, 6.3), target: new THREE.Vector3(0, 0.85, 0) },
  guzheng: { pos: new THREE.Vector3(0.45, 1.62, 1.75), target: new THREE.Vector3(-0.1, 0.92, -0.08) },
  erhu: { pos: new THREE.Vector3(-1.45, 1.4, 1.75), target: new THREE.Vector3(-2.12, 0.95, 0.15) },
  suona: { pos: new THREE.Vector3(2.75, 1.78, 1.95), target: new THREE.Vector3(2.1, 1.3, 0.0) },
};
const cam = stage.camera;
const controls = stage.controls;
cam.position.set(0, 2.6, 7.2);
controls.target.copy(VIEWS.all.target);
let flight = null;
let lastInteract = -99;
let viewKey = 'all';
function flyTo(key, dur = 2.2) {
  viewKey = key;
  const v = VIEWS[key];
  flight = { fromPos: cam.position.clone(), fromTarget: controls.target.clone(), toPos: viewPos(key), toTarget: v.target.clone(), t0: performance.now() / 1000, dur };
}
// 竖屏 / 窄屏时拉远镜头，保证乐器完整入画
function viewPos(key) {
  const v = VIEWS[key];
  const k = clamp(1.45 / (window.innerWidth / window.innerHeight), 1, 2.4);
  return v.pos.clone().sub(v.target).multiplyScalar(k).add(v.target);
}
const compact = () => window.innerWidth <= 600;
function collapsePanel() {
  if (!compact()) return;
  $('songs').classList.add('collapsed');
  fitView();
}
const fitView = () => {
  const panel = $('songs');
  stage.setViewShift(window.innerWidth > 900 ? Math.round((panel.offsetWidth + 22) / 2) : 0);
};
fitView();
window.addEventListener('resize', fitView);
document.querySelector('#songs h2').addEventListener('click', () => {
  $('songs').classList.toggle('collapsed');
  fitView();
});

// ───────────────────────────── 音频 ─────────────────────────────
let ctx = null;
let master = null;
function ensureAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = Number($('volume').value);
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
const latency = () => (ctx ? (ctx.outputLatency || 0) + (ctx.baseLatency || 0) : 0);
const audioNow = () => (ctx ? ctx.currentTime : performance.now() / 1000);

// 实时演奏引擎
let liveNode = null;
let liveReady = null;
async function ensureLive() {
  ensureAudio();
  if (liveNode) return liveNode;
  if (!liveReady) {
    liveReady = (async () => {
      await ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url));
      liveNode = new AudioWorkletNode(ctx, 'live-instruments', { numberOfInputs: 0, outputChannelCount: [2] });
      liveNode.onprocessorerror = () => { liveNode.disconnect(); liveNode = null; liveReady = null; };
      liveNode.connect(master);
      return liveNode;
    })().catch((err) => { liveReady = null; throw err; });
  }
  return liveReady;
}
const send = async (msg) => {
  try { (await ensureLive()).port.postMessage(msg); } catch (err) { console.error('实时引擎启动失败', err); }
};

// ───────────────────────────── 曲目渲染队列 ─────────────────────────────
// 同一时刻只合成一首（整曲 PCM 较大），当前选中的曲目优先，其余在后台依次合成。
const states = PIECES.map((piece) => ({
  piece, tuning: 'equal', version: 0, ready: false, buffer: null, notes: [], sections: [], duration: 0, summary: null,
  source: null, startedAt: 0, pausedAt: 0, prio: 0, waiters: [], progress: 0,
}));
let worker = null;
let busy = null;
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onerror = (e) => {
    if (busy) finishJob(busy, null, new Error(e.message || '后台合成线程启动失败'));
    worker.terminate();
    worker = null;
  };
  worker.onmessage = (e) => {
    const m = e.data;
    if (!busy || m.requestId !== busy.requestId) return;
    if (m.type === 'progress') { busy.st.progress = m.f; updateCard(busy.st); }
    else if (m.type === 'done') finishJob(busy, m, null);
    else if (m.type === 'error') finishJob(busy, null, new Error(m.message));
  };
  return worker;
}
let reqSeq = 0;
function ensureRendered(st, prio = 1) {
  if (st.ready) return Promise.resolve();
  st.prio = Math.max(st.prio, prio);
  const p = new Promise((resolve, reject) => st.waiters.push({ resolve, reject }));
  pump();
  return p;
}
function pump() {
  if (busy) return;
  const next = states.filter((s) => !s.ready && s.waiters.length).sort((a, b) => b.prio - a.prio)[0];
  if (!next) return;
  busy = { st: next, version: next.version, requestId: ++reqSeq, t0: performance.now() };
  next.progress = 0;
  updateCard(next);
  getWorker().postMessage({ id: next.piece.id, tuning: next.tuning, requestId: busy.requestId });
}
function finishJob(job, m, err) {
  busy = null;
  const st = job.st;
  if (err) {
    st.waiters.splice(0).forEach((w) => w.reject(err));
    st.error = err.message;
    updateCard(st);
  } else if (job.version !== st.version) {
    // 合成期间换了律制：丢弃结果，按新律制重来
  } else {
    ensureAudio();
    const buf = ctx.createBuffer(2, m.L.length, m.fs);
    buf.copyToChannel(m.L, 0);
    buf.copyToChannel(m.R, 1);
    Object.assign(st, {
      buffer: buf, fs: m.fs, notes: m.notes.sort((a, b) => a.t - b.t), sections: m.sections, duration: m.duration,
      summary: m.summary, ready: true, error: null, renderSec: (performance.now() - job.t0) / 1000,
    });
    INSTS[st.piece.instrument].prepare(st.notes);
    st.waiters.splice(0).forEach((w) => w.resolve());
    updateCard(st);
    if (st === current) onCurrentReady();
  }
  pump();
}

// ───────────────────────────── 界面 ─────────────────────────────
const btnPlay = $('btn-play');
const btnStop = $('btn-stop');
const progressEl = $('progress');
const progressFill = $('progress-fill');
const progressMarks = $('progress-marks');
const timeEl = $('time');
const nowTitle = $('now-title');
const caption = $('caption');
let current = null;
let playing = null;
let playIntent = 0;
let sectionIdx = -1;
let captionTimer = 0;
let cinematic = true;
let liveInst = 'guzheng';
let started = false;

function showCaption(song, sec) {
  caption.querySelector('.cap-song').textContent = song;
  caption.querySelector('.cap-sec').textContent = sec;
  caption.classList.add('show');
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => caption.classList.remove('show'), 4200);
}

const list = $('song-list');
for (const st of states) {
  const p = st.piece;
  const card = document.createElement('div');
  card.className = 'song-card';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.innerHTML = `<div><span class="glyph">${GLYPH[p.instrument]}</span><span class="t">${p.title}</span><span class="s">${p.instrumentName}</span></div>
    <div class="d">${p.blurb}</div><div class="m">${p.composer}</div><div class="st"></div><div class="bar"><i></i></div>`;
  card.addEventListener('click', () => selectPiece(st));
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter') selectPiece(st); });
  list.appendChild(card);
  st.card = card;
  updateCard(st);
}

function updateCard(st) {
  const el = st.card.querySelector('.st');
  const bar = st.card.querySelector('.bar i');
  bar.style.width = st.ready ? '100%' : `${Math.round(st.progress * 100)}%`;
  st.card.querySelector('.bar').style.opacity = st.ready ? 0 : 1;
  if (st.error) el.textContent = `合成失败：${st.error.split('\n')[0]}`;
  else if (st.ready) {
    const sm = st.summary;
    const tune = st.tuning === 'equal' ? '' : ` · ${TUNINGS[st.tuning]}`;
    const acc = !sm ? '' : sm.kind === 'guzheng'
      ? ` · 逐弦实测平均偏差 <b>${sm.meanAbs.toFixed(2)}</b> 音分`
      : ` · 实测 ${sm.count} 音平均偏差 <b>${sm.meanAbs.toFixed(2)}</b> 音分`;
    el.innerHTML = `${fmt(st.duration)}${tune}${acc}`;
  } else if (busy && busy.st === st) el.textContent = st.progress >= 1 ? '合成完成，测量音准……' : `物理建模合成中 ${Math.round(st.progress * 100)}%`;
  else if (st.waiters.length) el.textContent = '排队等待合成……';
  else el.textContent = '';
}

async function selectPiece(st) {
  if (!started) return;
  if (current === st) { togglePlay(); return; }
  const intent = ++playIntent;
  if (playing) pausePlayback(playing);
  current = st;
  states.forEach((s) => s.card.classList.toggle('active', s === st));
  $('tuning').value = st.tuning;
  nowTitle.textContent = `${st.piece.title} · ${st.piece.instrumentName}`;
  setLiveInst(st.piece.instrument, false);
  flyTo(st.piece.instrument);
  collapsePanel();
  sectionIdx = -1;
  btnPlay.disabled = true;
  btnStop.disabled = false;
  $('btn-wav').disabled = !st.ready;
  buildMarks();
  try {
    await ensureRendered(st, 10);
  } catch (err) {
    nowTitle.textContent = `合成失败：${err.message}`;
    return;
  }
  if (intent !== playIntent || current !== st) return;
  startPlayback(st, st.pausedAt >= st.duration - 0.05 ? 0 : st.pausedAt);
}

function onCurrentReady() {
  btnPlay.disabled = false;
  $('btn-wav').disabled = false;
  buildMarks();
}

function buildMarks() {
  progressMarks.innerHTML = '';
  if (!current || !current.ready) return;
  for (const s of current.sections) {
    const m = document.createElement('span');
    m.style.left = `${(s.t / current.duration) * 100}%`;
    m.dataset.name = s.name;
    progressMarks.appendChild(m);
  }
  progressEl.setAttribute('aria-valuemax', String(Math.round(current.duration)));
}

function startPlayback(st, offset) {
  if (playing) stopPlayback(playing, true);
  ensureAudio();
  const src = ctx.createBufferSource();
  src.buffer = st.buffer;
  src.connect(master);
  src.onended = () => {
    if (st.source === src && playing === st) {
      stopPlayback(st, false);
      showCaption(st.piece.title, '曲终');
    }
  };
  src.start(0, offset);
  st.source = src;
  st.startedAt = ctx.currentTime - offset;
  playing = st;
  btnPlay.classList.add('playing');
  btnPlay.disabled = false;
}
function pausePlayback(st) {
  if (!st.source) return;
  st.pausedAt = Math.min(st.duration, ctx.currentTime - st.startedAt);
  stopPlayback(st, true);
}
function stopPlayback(st, keepPos) {
  if (st.source) {
    st.source.onended = null;
    try { st.source.stop(); } catch { /* 已停止 */ }
    st.source.disconnect();
    st.source = null;
  }
  if (playing === st) playing = null;
  btnPlay.classList.remove('playing');
  if (!keepPos) st.pausedAt = 0;
}
function pieceTime(st) {
  if (playing === st) return clamp(ctx.currentTime - st.startedAt - latency(), 0, st.duration);
  return st.pausedAt;
}
function togglePlay() {
  if (!current) return;
  if (playing === current) { playIntent++; pausePlayback(current); return; }
  if (!current.ready) return; // 仍在合成，完成后会自动开始
  playIntent++;
  startPlayback(current, current.pausedAt >= current.duration - 0.05 ? 0 : current.pausedAt);
}
function seek(t) {
  if (!current || !current.ready) return;
  t = clamp(t, 0, current.duration - 0.01);
  sectionIdx = -1;
  if (playing === current) startPlayback(current, t);
  else current.pausedAt = t;
}
function stopAll() {
  playIntent++;
  if (playing) pausePlayback(playing);
  releaseLive();
  if (liveNode) send({ type: 'guzhengOff' });
}

btnPlay.addEventListener('click', togglePlay);
btnStop.addEventListener('click', stopAll);
progressEl.addEventListener('click', (e) => {
  if (!current) return;
  const r = progressEl.getBoundingClientRect();
  seek(((e.clientX - r.left) / r.width) * current.duration);
});
progressEl.addEventListener('keydown', (e) => {
  if (!current || !current.ready) return;
  const now = pieceTime(current);
  if (e.key === 'ArrowLeft') seek(now - 5);
  else if (e.key === 'ArrowRight') seek(now + 5);
  else if (e.key === 'Home') seek(0);
  else if (e.key === 'End') seek(current.duration);
  else return;
  e.preventDefault();
});
$('volume').addEventListener('input', (e) => {
  if (master) master.gain.setTargetAtTime(Number(e.target.value), ctx.currentTime, 0.02);
});
$('tuning').addEventListener('change', (e) => {
  if (!current) return;
  const st = current;
  st.tuning = e.target.value;
  st.version++;
  playIntent++;
  if (playing === st) stopPlayback(st, true);
  const keep = st.pausedAt;
  Object.assign(st, { ready: false, buffer: null, notes: [], sections: [], summary: null, error: null });
  st.pausedAt = keep;
  btnPlay.disabled = true;
  $('btn-wav').disabled = true;
  updateCard(st);
  const s = st;
  current = null;
  selectPiece(s);
});
$('btn-wav').addEventListener('click', () => {
  const st = current;
  if (!st || !st.ready) return;
  const bytes = encodeWav([st.buffer.getChannelData(0), st.buffer.getChannelData(1)], st.fs, 16);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  a.download = `${st.piece.title}-${st.piece.instrumentName}${st.tuning === 'equal' ? '' : '-' + TUNINGS[st.tuning]}.wav`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
const toggle = (id, fn) => $(id).addEventListener('click', (e) => {
  const on = e.currentTarget.classList.toggle('on');
  fn(on, e.currentTarget);
  e.currentTarget.blur();
});
toggle('btn-cam', (on) => (cinematic = on));
toggle('btn-roll', (on) => $('hud').classList.toggle('hide-roll', !on));
toggle('btn-quality', (on, el) => {
  el.textContent = on ? '高画质' : '流畅';
  stage.setQuality(on ? 'high' : 'low');
  hall.setQuality(on ? 'high' : 'low');
});
document.querySelectorAll('#transport button, #songs button').forEach((b) => b.addEventListener('click', () => b.blur()));

// ───────────────────────────── 亲手演奏 ─────────────────────────────
const HINTS = {
  guzheng: '点击<b>雁柱与琴头之间</b>的琴弦拨奏，按住划过多根弦即<b>刮奏</b>；按住<b>雁柱与琴尾之间</b>的弦为<b>按音</b>（弦音升高）。键盘 <kbd>A</kbd>–<kbd>;</kbd> 弹中音区。',
  erhu: '在<b>千斤与琴码之间</b>按住琴弦发声，上下拖动即滑音（越往下越高，低于 A4 自动用内弦）；弓会自动推拉换弓。键盘 <kbd>A</kbd>–<kbd>;</kbd> 演奏 D 调五声。',
  suona: '按住<b>木杆上的音孔</b>吹奏，沿管身拖动换音；指法按“筒音作 5”自动开闭。键盘 <kbd>A</kbd>–<kbd>;</kbd> 演奏 A 调五声。',
  all: '选择一件乐器，镜头会移到它面前；也可以直接点击场景中的琴弦、指板与音孔。拖动旋转视角、滚轮缩放、右键平移。',
};
const lastLive = { guzheng: -99, erhu: -99, suona: -99 };
const liveHeld = { erhu: false, suona: false };
function setLiveInst(k, fly = true) {
  liveInst = k === 'all' ? liveInst : k;
  document.querySelectorAll('#inst-btns button').forEach((b) => b.classList.toggle('on', b.dataset.inst === k));
  $('play-hint').innerHTML = HINTS[k];
  if (fly) flyTo(k);
}
document.querySelectorAll('#inst-btns button').forEach((b) => b.addEventListener('click', () => { setLiveInst(b.dataset.inst); collapsePanel(); }));
setLiveInst('all', false);

const PENTA = [0, 2, 4, 7, 9];
function snapPenta(m, tonicPc) {
  let best = m;
  let bd = 99;
  for (let o = -1; o <= 1; o++) {
    for (const p of PENTA) {
      const c = Math.floor(m / 12) * 12 + o * 12 + ((tonicPc + p) % 12);
      if (Math.abs(c - m) < bd) { bd = Math.abs(c - m); best = c; }
    }
  }
  return best;
}

function livePluck(i, vel) {
  send({ type: 'pluck', string: i, vel });
  guzheng.pluckLive(i, vel, audioNow());
  lastLive.guzheng = audioNow();
}
function livePress(i, on) {
  send({ type: 'gPress', string: i, cents: on ? 200 : 0 });
  guzheng.pressLive(i, on, audioNow());
  lastLive.guzheng = audioNow();
}
function liveOn(kind, midi, vel) {
  const hz = mtof(midi);
  const inst = INSTS[kind];
  if (liveHeld[kind]) send({ type: kind === 'erhu' ? 'erhuBend' : 'suonaBend', hz });
  else send({ type: kind === 'erhu' ? 'erhuOn' : 'suonaOn', hz, vel });
  liveHeld[kind] = true;
  inst.noteOnLive(hz, vel, audioNow());
  lastLive[kind] = audioNow();
}
function liveOff(kind) {
  if (!liveHeld[kind]) return;
  liveHeld[kind] = false;
  send({ type: kind === 'erhu' ? 'erhuOff' : 'suonaOff' });
  INSTS[kind].releaseLive(audioNow());
  lastLive[kind] = audioNow();
}
function releaseLive() {
  liveOff('erhu');
  liveOff('suona');
  if (drag && drag.press !== undefined) livePress(drag.press, false);
  drag = null;
  keysHeld.clear();
  guzheng.releaseLive(audioNow());
  controls.enabled = true;
}

// 指针：拾取琴弦 / 指板 / 音孔；未命中时交给轨道控制器
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const canvas = $('stage');
const tooltip = $('tooltip');
let drag = null;
function pick(e, objs = pickables) {
  const r = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, cam);
  return raycaster.intersectObjects(objs, false)[0] || null;
}
function tooltipFor(hit) {
  const d = hit.object.userData;
  if (d.inst === 'guzheng') {
    const m = GUZHENG_MIDI[d.string];
    return `<div class="tt-name">古筝 · 第 ${d.string + 1} 弦</div>
      <div class="tt-row"><span>空弦</span><b>${midiName(m)} · ${mtof(m).toFixed(1)} Hz</b></div>
      <div class="tt-row on"><span>${d.seg === 'R' ? '雁柱—琴头' : '雁柱—琴尾'}</span><b>${d.seg === 'R' ? '拨弦 / 刮奏' : '按音（升全音）'}</b></div>`;
  }
  if (d.inst === 'erhu') {
    const m = erhu.pitchAt(hit.point);
    return `<div class="tt-name">二胡 · 无品指位</div><div class="tt-row on"><span>此处</span><b>${midiName(Math.round(m))}</b></div><div class="tt-row"><span>操作</span><b>按住发声，上下滑动</b></div>`;
  }
  const m = suona.pitchAt(hit.point);
  return `<div class="tt-name">唢呐 · 音孔</div><div class="tt-row on"><span>此处</span><b>${midiName(m)}</b></div><div class="tt-row"><span>操作</span><b>按住吹奏，沿管拖动</b></div>`;
}
canvas.addEventListener('pointerdown', (e) => {
  lastInteract = performance.now() / 1000;
  flight = null;
  if (!started || e.button !== 0) return;
  const hit = pick(e);
  if (!hit) return;
  const d = hit.object.userData;
  controls.enabled = false;
  canvas.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, inst: d.inst, x: e.clientX, t: performance.now() };
  if (d.inst === 'guzheng') {
    setLiveInst('guzheng', false);
    if (d.seg === 'R') { drag.string = d.string; livePluck(d.string, 0.75); }
    else { drag.press = d.string; livePress(d.string, true); }
  } else if (d.inst === 'erhu') {
    setLiveInst('erhu', false);
    let m = erhu.pitchAt(hit.point);
    if ($('snap').checked) m = snapPenta(Math.round(m), 2);
    drag.m = m;
    liveOn('erhu', m, 0.7);
  } else {
    setLiveInst('suona', false);
    drag.m = suona.pitchAt(hit.point);
    liveOn('suona', drag.m, 0.75);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!started) return;
  if (drag && e.pointerId === drag.id) {
    if (drag.string !== undefined) {
      const hit = pick(e, guzheng.pickables.filter((o) => o.userData.seg === 'R'));
      if (hit && hit.object.userData.string !== drag.string) {
        const to = hit.object.userData.string;
        const dt = Math.max(8, performance.now() - drag.t);
        const vel = Math.min(0.95, 0.5 + (Math.abs(e.clientX - drag.x) / dt) * 0.25);
        const step = to > drag.string ? 1 : -1;
        for (let k = drag.string + step; step > 0 ? k <= to : k >= to; k += step) livePluck(k, vel);
        drag.string = to;
        drag.x = e.clientX;
        drag.t = performance.now();
      }
    } else if (drag.inst === 'erhu' || drag.inst === 'suona') {
      const inst = INSTS[drag.inst];
      const hit = pick(e, inst.pickables);
      if (hit) {
        let m = inst.pitchAt(hit.point);
        if (drag.inst === 'erhu' && $('snap').checked) m = snapPenta(Math.round(m), 2);
        if (Math.abs(m - drag.m) > 0.05) { drag.m = m; liveOn(drag.inst, m, 0.7); }
      }
    }
    return;
  }
  const hit = pick(e);
  if (hit) {
    tooltip.innerHTML = tooltipFor(hit);
    tooltip.style.left = `${e.clientX}px`;
    tooltip.style.top = `${e.clientY}px`;
    tooltip.classList.add('show');
    canvas.style.cursor = 'pointer';
  } else {
    tooltip.classList.remove('show');
    canvas.style.cursor = '';
  }
});
const endDrag = (e) => {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  if (drag.press !== undefined) livePress(drag.press, false);
  if (drag.inst === 'erhu' || drag.inst === 'suona') {
    if (![...keysHeld.values()].some((k) => k.inst === drag.inst)) liveOff(drag.inst);
  }
  drag = null;
  controls.enabled = true;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => tooltip.classList.remove('show'));
canvas.addEventListener('wheel', () => { lastInteract = performance.now() / 1000; flight = null; }, { passive: true });

// 键盘：A S D F G H J K L ; 演奏当前乐器
const KEYS = 'asdfghjkl;'.split('');
const DEG = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const keysHeld = new Map();
const isTyping = (e) => e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, select, textarea');
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { stopAll(); return; }
  if (!started || isTyping(e)) return;
  if (e.code === 'Space' && !e.repeat && current) {
    e.preventDefault();
    togglePlay();
    return;
  }
  const key = e.key.toLowerCase();
  const k = KEYS.indexOf(key);
  if (k < 0 || e.repeat || keysHeld.has(key)) return;
  e.preventDefault();
  if (liveInst === 'guzheng') {
    keysHeld.set(key, { inst: 'guzheng' });
    livePluck(6 + k, 0.7);
  } else {
    const m = (liveInst === 'erhu' ? 62 : 69) + DEG[k];
    keysHeld.set(key, { inst: liveInst, m });
    liveOn(liveInst, m, 0.65);
  }
});
window.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  const held = keysHeld.get(key);
  if (!held) return;
  const wasLast = [...keysHeld.keys()].at(-1) === key;
  keysHeld.delete(key);
  if (held.inst === 'guzheng' || !wasLast) return;
  const rest = [...keysHeld.values()].filter((h) => h.inst === held.inst);
  if (rest.length) liveOn(held.inst, rest.at(-1).m, 0.65);
  else if (!(drag && drag.inst === held.inst)) liveOff(held.inst);
});
window.addEventListener('blur', releaseLive);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseLive(); });

// ───────────────────────────── HUD：当前音、技法与卷帘 ─────────────────────────────
const noteName = $('note-name');
const noteHz = $('note-hz');
const noteTech = $('note-tech');
const hud = $('hud');
const roll = $('roll');
const FINGER = ['托', '抹', '勾'];
function technique(kind, n) {
  if (kind === 'guzheng') {
    if (n.tr) return '摇指';
    if (n.pr) return '按音';
    if (n.k === 'sweep') return '刮奏';
    if (n.k === 'run') return '花指';
    if (n.k === 'chord') return '和音';
    if (n.vib) return '揉弦';
    return FINGER[n._f] ?? '';
  }
  if (kind === 'erhu') {
    const s = n._str === 0 ? '内弦' : '外弦';
    if (n.gl) return `${s} · 滑音`;
    if (n.vib) return `${s} · 揉弦`;
    if (n.st) return `${s} · 顿弓`;
    return `${s} · ${n.lg ? '连弓' : '分弓'}`;
  }
  if (n.fl) return '花舌';
  if (n.gl) return '滑音';
  if (n.st) return '吐音';
  if (n.vib) return '颤音';
  return n.lg ? '连音' : '单吐';
}
function drawRoll(st, now) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(50, Math.round(roll.clientWidth * dpr));
  const H = Math.max(20, Math.round(roll.clientHeight * dpr));
  if (roll.width !== w || roll.height !== H) { roll.width = w; roll.height = H; }
  const g = roll.getContext('2d');
  g.clearRect(0, 0, w, H);
  if (!st || !st.ready) return;
  const win = 9;
  const pps = w / win;
  const playX = w * 0.3;
  if (!st.range) {
    const ms = st.notes.map((n) => n.m).filter(Boolean);
    st.range = [Math.min(...ms) - 1, Math.max(...ms) + 1];
    st.maxD = Math.max(...st.notes.map((n) => n.d));
  }
  const [lo, hi] = st.range;
  const y = (m) => H - 4 - ((m - lo) / (hi - lo)) * (H - 8);
  const t0 = now - playX / pps;
  const t1 = now + (w - playX) / pps;
  const barH = Math.max(2 * dpr, ((H - 8) / (hi - lo)) * 0.9);
  let i = Math.max(0, lastStarted(st.notes, t0 - Math.min(st.maxD, 12)));
  for (; i < st.notes.length; i++) {
    const n = st.notes[i];
    if (n.t > t1) break;
    const d = st.piece.instrument === 'guzheng' ? Math.min(n.d, n.tr ? n.d : 0.4) : n.d;
    if (n.t + d < t0) continue;
    const x = playX + (n.t - now) * pps;
    const on = n.t <= now && now < n.t + d;
    g.globalAlpha = on ? 1 : n.t + d < now ? 0.25 : 0.55;
    g.fillStyle = on ? '#ffd98a' : '#c9974e';
    g.fillRect(x, y(n.m) - barH / 2, Math.max(2 * dpr, d * pps - 1), barH);
  }
  g.globalAlpha = 0.7;
  g.fillStyle = '#b8322a';
  g.fillRect(playX - dpr * 0.5, 0, dpr, H);
  g.globalAlpha = 1;
}

// ───────────────────────────── 开场 ─────────────────────────────
progress(1, '琴已调好');
$('enter-btn').hidden = false;
$('enter-btn').focus();
$('enter-btn').addEventListener('click', () => {
  ensureAudio();
  ensureLive().catch(() => {});
  $('loader').classList.add('hide');
  started = true;
  flyTo('all', 4.5);
  // 后台依次合成三首曲子，点选时即可播放
  states.forEach((st, i) => ensureRendered(st, 1 - i * 0.1).catch(() => {}));
  // 开场：古筝一串刮奏
  const now = audioNow() + 0.9;
  setTimeout(() => {
    for (let k = 0; k < 12; k++) setTimeout(() => livePluck(20 - k, 0.45 + k * 0.02), k * 55);
  }, 900);
  void now;
});

// ───────────────────────────── 主循环 ─────────────────────────────
let lastT = performance.now() / 1000;
const tmpPos = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
const focusSmooth = new THREE.Vector3(0, 0.8, 0);
function frame() {
  requestAnimationFrame(frame);
  const tNow = performance.now() / 1000;
  const dt = Math.min(0.05, tNow - lastT);
  lastT = tNow;
  const aNow = audioNow();

  // 每件乐器：最近有亲手演奏则跟随实时事件，否则跟随当前曲目
  let hudSrc = null;
  for (const [k, inst] of Object.entries(INSTS)) {
    const st = current && current.piece.instrument === k && current.ready ? current : null;
    const liveRecent = liveHeld[k] || drag?.inst === k || aNow - lastLive[k] < 2.5;
    let src;
    if (st && !liveRecent && (playing === st || st.pausedAt > 0)) src = { notes: st.notes, time: pieceTime(st), live: false, clock: tNow, st };
    else src = { notes: inst.liveNotes, time: aNow, live: true, clock: tNow };
    inst.update(dt, src);
    PLAYERS[k].update(dt, src);
    if ((src.st && k === current?.piece.instrument) || (src.live && liveRecent && k === liveInst)) hudSrc = { ...src, kind: k };
  }
  effects.update(tNow, dt);
  hall.update(tNow);

  // HUD
  if (hudSrc) {
    const i = lastStarted(hudSrc.notes, hudSrc.time);
    const n = hudSrc.notes[i];
    const d = n ? (hudSrc.kind === 'guzheng' ? Math.max(0.35, n.tr ? n.d : 0) : n.d) : 0;
    if (n && hudSrc.time < n.t + d + 0.05) {
      const m = n.m ?? GUZHENG_MIDI[n.s];
      noteName.textContent = midiName(Math.round(m));
      noteHz.textContent = `${(n.hz || mtof(m)).toFixed(1)} Hz`;
      noteTech.textContent = technique(hudSrc.kind, n);
    }
  }
  hud.classList.toggle('idle', !hudSrc);
  drawRoll(hudSrc?.st, hudSrc?.time ?? 0);

  // 相机
  if (flight) {
    const k = Math.min(1, (tNow - flight.t0) / flight.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    cam.position.lerpVectors(flight.fromPos, flight.toPos, e);
    controls.target.lerpVectors(flight.fromTarget, flight.toTarget, e);
    lastInteract = tNow - 2;
    if (k >= 1) flight = null;
  } else if (started && cinematic && playing && tNow - lastInteract > 5 && viewKey !== 'all') {
    const v = { pos: viewPos(viewKey), target: VIEWS[viewKey].target };
    const inst = INSTS[viewKey];
    focusSmooth.lerp(inst.focus, dt * 0.8);
    tmpTarget.copy(v.target).lerp(focusSmooth, 0.35);
    const off = tmpPos.subVectors(v.pos, v.target);
    const ang = Math.sin(tNow * 0.045) * 0.32;
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
    off.multiplyScalar(1 + 0.12 * Math.sin(tNow * 0.031));
    off.y += 0.12 * Math.sin(tNow * 0.057 + 1);
    tmpPos.copy(tmpTarget).add(off);
    cam.position.lerp(tmpPos, dt * 0.35);
    controls.target.lerp(tmpTarget, dt * 0.5);
  }
  controls.update();

  // 进度与段落字幕
  if (current && current.ready) {
    const time = pieceTime(current);
    progressFill.style.width = `${Math.min(100, (time / current.duration) * 100)}%`;
    timeEl.textContent = `${fmt(time)} / ${fmt(current.duration)}`;
    progressEl.setAttribute('aria-valuenow', String(Math.round(time)));
    if (playing === current) {
      let si = -1;
      current.sections.forEach((s, i) => { if (time >= s.t - 0.05) si = i; });
      if (si >= 0 && si !== sectionIdx) {
        sectionIdx = si;
        showCaption(current.piece.title, current.sections[si].name);
      }
    }
  } else if (current) {
    timeEl.textContent = `0:00 / --:--`;
  }
  stage.render(tNow);
}
frame();
if (window.__sz) window.__sz.step = frame; // 调试：浏览器面板隐藏时手动推进一帧
