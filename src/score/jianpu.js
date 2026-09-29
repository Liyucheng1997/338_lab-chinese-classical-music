// 简谱文本 DSL 解析器：把文字简谱编译成带时间的音符事件。
//
// 【指令】（行首 @）  @title  @tonic D4  @tempo 58  @meter 4/4  @instrument guzheng
// 【音符】 [#|b]数字[,|']*[时值][记号]     数字 1-7，0 为休止
//          , 低八度  ' 高八度   _ 时值减半（八分、十六分…）   . 附点（×1.5）   独立的 - 延长一拍
//          记号：~ 摇指/颤音   ^ 按音上滑   * 断奏   > 重音   ; 延长记号
//          前缀：/ 从上一音滑入（上滑）  \ 从上一音滑入（下滑）
// 【和弦】 [3 3,]_        同时发声的多个音，时值写在 ] 后
// 【连音】 <1' 6 5 3 2>_  括号内的音在给定总时值内等分（五连音、装饰性快速走句）；
//          <5,..1''>_     从 5, 到 1'' 逐音刮奏（花指/刮奏），逐级经过乐器的音阶音
// 【倚音】 {2 3}5         前倚音，占用主音开头一点点时间
// 【连线】 ( … )          同一弓/同一口气；圆括号可单独成词，也可黏在音符两侧：(5 6) 或 (5  6)
// 【行内】 !t=72 速度  !tr=50:4 在 4 拍内渐变到 50  !m=2/4 拍号  !pp/p/mp/mf/f/ff 力度
//          !cresc=f:4 在 4 拍内渐变力度  !sec=名称 段落标记  !br 换气停顿  !freeze=0.5 后续音符拉伸
// 【小节线】 |  用于校验每小节拍数
//
// 输出事件的时间单位是“拍”（四分音符=1）；用 tempoMap 转成秒。

const MAJOR = [0, 2, 4, 5, 7, 9, 11];

const DYN = { ppp: 0.18, pp: 0.28, p: 0.4, mp: 0.5, mf: 0.62, f: 0.76, ff: 0.9, fff: 1.0 };

export function noteToMidi(tonic, degree, octave, acc) {
  return tonic + MAJOR[degree - 1] + acc + 12 * octave;
}

export function parseTonic(s) {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(s.trim());
  if (!m) throw new Error('bad tonic ' + s);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (parseInt(m[3], 10) + 1) + base + acc;
}

/** 解析单个音符词，返回 { rest, midi, deg, oct, acc, dur, flags, glide }。 */
function parseNoteToken(tok, tonic, warn) {
  let s = tok;
  let glide = 0;
  if (s[0] === '/') { glide = +1; s = s.slice(1); }
  else if (s[0] === '\\') { glide = -1; s = s.slice(1); }
  let acc = 0;
  if (s[0] === '#') { acc = 1; s = s.slice(1); }
  else if (s[0] === 'b') { acc = -1; s = s.slice(1); }
  const m = /^([0-7])([',]*)(.*)$/.exec(s);
  if (!m) { warn('无法解析音符: ' + tok); return null; }
  const deg = +m[1];
  let oct = 0;
  for (const ch of m[2]) oct += ch === "'" ? 1 : -1;
  let rest = m[3];
  let dur = 1;
  const flags = {};
  let i = 0;
  let unders = 0, dots = 0;
  for (; i < rest.length; i++) {
    const c = rest[i];
    if (c === '_') unders++;
    else if (c === '.') dots++;
    else break;
  }
  dur = Math.pow(0.5, unders);
  if (dots === 1) dur *= 1.5; else if (dots === 2) dur *= 1.75;
  for (; i < rest.length; i++) {
    const c = rest[i];
    if (c === '~') flags.trem = true;
    else if (c === '^') flags.press = true;
    else if (c === '*') flags.stac = true;
    else if (c === '>') flags.accent = true;
    else if (c === ';') flags.fermata = true;
    else if (c === '_' || c === '.') { /* 允许标记后再写时值 */ }
    else { warn('未知记号 ' + c + ' 于 ' + tok); }
  }
  if (deg === 0) return { rest: true, dur, flags };
  return { rest: false, midi: noteToMidi(tonic, deg, oct, acc), deg, oct, acc, dur, flags, glide };
}

/** 词法：按空白切分，但保持 [..] <..> {..} 内部的空格；( ) 单独切分。 */
function tokenize(body) {
  const out = [];
  let i = 0;
  const n = body.length;
  while (i < n) {
    const c = body[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && body[i + 1] === '/') { while (i < n && body[i] !== '\n') i++; continue; }
    if (c === '|') { out.push('|'); i++; continue; }
    if (c === '(' || c === ')') { out.push(c); i++; continue; }
    if (c === '[' || c === '<' || c === '{') {
      const close = c === '[' ? ']' : c === '<' ? '>' : '}';
      let j = i + 1;
      while (j < n && body[j] !== close) j++;
      j++; // 含闭合符
      // 后缀（时值/记号）直到空白
      while (j < n && !/[\s|()]/.test(body[j])) j++;
      out.push(body.slice(i, j));
      i = j;
      continue;
    }
    let j = i;
    while (j < n && !/[\s|()]/.test(body[j])) j++;
    out.push(body.slice(i, j));
    i = j;
  }
  return out;
}

/**
 * 编译简谱文本。
 * @returns {{meta, events, tempoMap, warnings, totalBeats, beatToSec}}
 */
export function compileJianpu(text, opts = {}) {
  const warnings = [];
  const meta = { title: '', tonic: parseTonic(opts.tonic || 'D4'), tempo: 60, meter: [4, 4], instrument: '' };
  const lines = text.split(/\r?\n/);
  const bodyLines = [];
  for (const ln of lines) {
    const t = ln.trim();
    if (t.startsWith('@')) {
      const sp = t.indexOf(' ');
      const key = (sp < 0 ? t.slice(1) : t.slice(1, sp)).trim();
      const val = sp < 0 ? '' : t.slice(sp + 1).trim();
      if (key === 'title') meta.title = val;
      else if (key === 'tonic') meta.tonic = parseTonic(val);
      else if (key === 'tempo') meta.tempo = parseFloat(val);
      else if (key === 'meter') { const [a, b] = val.split('/').map(Number); meta.meter = [a, b]; }
      else if (key === 'instrument') meta.instrument = val;
      else meta[key] = val;
    } else bodyLines.push(ln);
  }
  const tokens = tokenize(bodyLines.join('\n'));

  const events = [];
  const tempoSegs = []; // {beat, bpm, rampTo, rampBeats}
  tempoSegs.push({ beat: 0, bpm: meta.tempo, rampTo: null, rampBeats: 0 });

  let beat = 0;
  let barStart = 0;
  let meterBeats = meta.meter[0] * 4 / meta.meter[1];
  let barIdx = 1;
  let vel = DYN.mf;
  let velRamp = null; // {from,to,beats,start}
  let slurOpen = false, slurId = 0;
  let section = '';
  let prev = null; // 上一个有音高事件（用于 / \ 滑入）
  let pendingBreath = 0;
  let barBreath = 0;

  const warn = (m) => warnings.push(`[小节 ${barIdx}] ${m}`);
  const curVel = () => {
    if (!velRamp) return vel;
    const f = Math.min(1, (beat - velRamp.start) / Math.max(1e-6, velRamp.beats));
    return velRamp.from + (velRamp.to - velRamp.from) * f;
  };

  const push = (e) => {
    e.t = beat; e.bar = barIdx; e.vel = curVel(); e.section = section;
    e.slur = slurOpen ? slurId : 0;
    events.push(e);
  };

  let lastEvent = null;
  for (let ti = 0; ti < tokens.length; ti++) {
    const tok = tokens[ti];
    if (tok === '|') {
      const got = beat - barStart - barBreath;
      if (Math.abs(got - meterBeats) > 0.02 && got > 1e-6) {
        warn(`拍数 ${got.toFixed(3)} ≠ 拍号 ${meterBeats}`);
      }
      barStart = beat; barBreath = 0; barIdx++;
      continue;
    }
    if (tok === '(') { slurOpen = true; slurId++; continue; }
    if (tok === ')') { slurOpen = false; continue; }
    if (tok[0] === '!') {
      const m = /^!([a-z]+)(?:=(.+))?$/.exec(tok);
      if (!m) { warn('未知指令 ' + tok); continue; }
      const k = m[1], v = m[2];
      if (DYN[k] !== undefined && v === undefined) { vel = DYN[k]; velRamp = null; }
      else if (k === 't') tempoSegs.push({ beat, bpm: parseFloat(v), rampTo: null, rampBeats: 0 });
      else if (k === 'tr') {
        const [to, bs] = v.split(':').map(Number);
        const last = tempoSegs[tempoSegs.length - 1];
        // 当前速度（若上一段仍在渐变，取其终点）
        const cur = last.rampTo !== null ? last.rampTo : last.bpm;
        tempoSegs.push({ beat, bpm: cur, rampTo: to, rampBeats: bs });
      }
      else if (k === 'm') { const [a, b] = v.split('/').map(Number); meterBeats = a * 4 / b; }
      else if (k === 'cresc') {
        const [d, bs] = v.split(':');
        velRamp = { from: curVel(), to: DYN[d] ?? parseFloat(d), beats: parseFloat(bs), start: beat };
        vel = velRamp.to;
      }
      else if (k === 'vel') { vel = parseFloat(v); velRamp = null; }
      else if (k === 'sec') { section = v; events.push({ type: 'section', t: beat, name: v, bar: barIdx }); }
      else if (k === 'br') pendingBreath = 0.18;
      else if (k === 'label') { events.push({ type: 'label', t: beat, text: v, bar: barIdx }); }
      else warn('未知指令 ' + tok);
      continue;
    }
    if (tok === '-') {
      if (lastEvent) { lastEvent.dur += 1; beat += 1; }
      else warn('孤立的 -');
      continue;
    }

    // 倚音前缀 {..}主音
    let graces = [];
    let core = tok;
    if (core[0] === '{') {
      const cl = core.indexOf('}');
      const inner = core.slice(1, cl).trim().split(/\s+/);
      for (const g of inner) {
        const p = parseNoteToken(g, meta.tonic, warn);
        if (p && !p.rest) graces.push(p.midi);
      }
      core = core.slice(cl + 1);
      if (!core) { // 倚音与主音之间有空格
        const nxt = tokens[++ti];
        core = nxt;
      }
    }

    if (pendingBreath) { beat += pendingBreath; barBreath += pendingBreath; pendingBreath = 0; }

    if (core[0] === '[') { // 和弦
      const cl = core.indexOf(']');
      const inner = core.slice(1, cl).trim().split(/\s+/);
      const suffix = core.slice(cl + 1);
      const timing = parseNoteToken('1' + suffix, meta.tonic, warn); // 借用解析时值/记号
      const pitches = [];
      for (const p of inner) {
        const q = parseNoteToken(p, meta.tonic, warn);
        if (q && !q.rest) pitches.push(q.midi);
      }
      const ev = { type: 'chord', pitches, dur: timing.dur, flags: timing.flags, graces };
      push(ev); beat += ev.dur; lastEvent = ev; prev = ev; continue;
    }
    if (core[0] === '<') { // 连音/走句/刮奏
      const cl = core.indexOf('>');
      const inner = core.slice(1, cl).trim();
      const suffix = core.slice(cl + 1);
      const timing = parseNoteToken('1' + suffix, meta.tonic, warn);
      const ev = { type: 'run', dur: timing.dur, flags: timing.flags, graces };
      if (inner.includes('..')) {
        const [a, b] = inner.split('..').map(s => s.trim());
        const pa = parseNoteToken(a, meta.tonic, warn);
        const pb = parseNoteToken(b, meta.tonic, warn);
        ev.sweep = { from: pa.midi, to: pb.midi };
      } else {
        ev.notes = inner.split(/\s+/).map(x => parseNoteToken(x, meta.tonic, warn)).filter(x => x && !x.rest).map(x => x.midi);
      }
      push(ev); beat += ev.dur; lastEvent = ev; prev = ev; continue;
    }

    const p = parseNoteToken(core, meta.tonic, warn);
    if (!p) continue;
    if (p.rest) {
      const ev = { type: 'rest', dur: p.dur };
      push(ev); beat += ev.dur; lastEvent = ev; continue;
    }
    const ev = { type: 'note', midi: p.midi, dur: p.dur, flags: p.flags, graces };
    if (p.glide && prev && prev.type === 'note') { ev.glideFrom = prev.midi; ev.glideDir = p.glide; }
    push(ev); beat += ev.dur; lastEvent = ev; prev = ev;
  }
  // 末尾小节
  const got = beat - barStart;
  if (got > 1e-6 && Math.abs(got - meterBeats) > 0.02 && got < meterBeats - 0.02) {
    // 最后一小节不足视为收束，不告警
  }

  // ---- 速度表 ----
  const segs = tempoSegs;
  function bpmAt(b) {
    let s = segs[0];
    for (const x of segs) { if (x.beat <= b) s = x; else break; }
    if (s.rampTo === null) return s.bpm;
    const f = Math.min(1, (b - s.beat) / Math.max(1e-6, s.rampBeats));
    return s.bpm + (s.rampTo - s.bpm) * f;
  }
  // 预积分：每 1/16 拍一个采样，累积秒数
  const totalBeats = beat;
  const step = 1 / 64;
  const nS = Math.ceil(totalBeats / step) + 2;
  const cum = new Float64Array(nS + 1);
  for (let i = 0; i < nS; i++) {
    const b0 = i * step, b1 = (i + 1) * step;
    const bm = (bpmAt(b0) + bpmAt(b1)) / 2;
    cum[i + 1] = cum[i] + 60 / bm * step;
  }
  const beatToSec = (b) => {
    const x = b / step, i = Math.min(nS - 1, Math.max(0, Math.floor(x)));
    return cum[i] + (cum[i + 1] - cum[i]) * (x - i);
  };
  return { meta, events, tempoSegs: segs, warnings, totalBeats, beatToSec, bpmAt };
}
