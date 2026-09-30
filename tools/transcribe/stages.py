"""扒谱流水线的各个阶段。每个函数读写工作目录 work/ 下的中间文件（JSON / NPZ），可单独重跑。

琵琶（复音）：basic-pitch 后验 → 拨弦事件 → 轮指 / 扫弦 / 绞弦归并 → 节拍 → 简谱
唢呐（单音）：basic-pitch 音高轮廓 → “天际线”主旋律 → 音符（滑音、打音、倚音）→ 节拍 → 简谱
"""
import json
import os
import numpy as np
from scipy.signal import find_peaks
from scipy.ndimage import gaussian_filter1d, median_filter, uniform_filter1d

from common import frame_time, jianpu


def _p(work, name):
    return os.path.join(work, name)


def _load_audio(work, sr):
    import librosa
    y, _ = librosa.load(_p(work, 'audio.wav'), sr=sr)
    return y


# ───────────────────────────── 0. basic-pitch ─────────────────────────────

def run_basic_pitch(work):
    from basic_pitch.inference import run_inference, Model
    from basic_pitch import ICASSP_2022_MODEL_PATH
    model = Model(os.path.join(os.path.dirname(ICASSP_2022_MODEL_PATH), 'nmp.onnx'))
    out = run_inference(_p(work, 'audio.wav'), model)
    np.savez_compressed(_p(work, 'bp.npz'), note=out['note'], onset=out['onset'], contour=out['contour'])
    print('basic-pitch 帧数', out['note'].shape[0])


# ───────────────────────────── 琵琶 ─────────────────────────────

def pipa_events(work, shift, lo, hi):
    """起音后验的峰 → 拨弦事件（同一次拨弦 / 扫弦的多个音高归为一组）。shift：录音半音 → 标准音高。"""
    d = np.load(_p(work, 'bp.npz'))
    note, onset = d['note'], d['onset']
    nF = note.shape[0]
    peaks = []
    for k in range(88):
        p = 21 + k
        if not (lo <= p + shift <= hi):
            continue
        idx, _ = find_peaks(onset[:, k], height=0.22, distance=3)
        for i in idx:
            sus = note[i:i + 6, k].mean()
            if sus < 0.18:
                continue
            # 泛音：下方八度 / 十二度 / 双八度…正在发声、且本音不比它明显更强
            if any(k - h >= 0 and note[max(0, i - 2):i + 6, k - h].mean() > 0.3 and sus < 1.35 * note[max(0, i - 2):i + 6, k - h].mean()
                   for h in (12, 19, 24, 28, 31)):
                continue
            peaks.append((i, p, float(onset[i, k]), float(sus)))
    peaks.sort()

    def sustain_len(i, k):
        j = i
        while j < nF and note[j, k] > 0.25:
            j += 1
        return (j - i) / 86.13

    groups, cur = [], []
    for pk in peaks:
        if cur and pk[0] - cur[0][0] > 2:
            groups.append(cur); cur = []
        cur.append(pk)
    if cur:
        groups.append(cur)
    out = []
    for g in groups:
        f = int(round(np.mean([x[0] for x in g])))
        ps = {}
        for i, p, s, sus in g:
            ps[p] = max(ps.get(p, 0), s * (0.5 + sus))
        for p in sorted(ps, reverse=True):
            for h in (12, 19, 24, 28):
                if p - h in ps and ps[p] < ps[p - h] * 1.1:
                    ps.pop(p, None)
                    break
        if not ps:
            continue
        mx = max(ps.values())
        items = sorted(((p, v) for p, v in ps.items() if v >= 0.3 * mx), key=lambda x: -x[1])[:4]
        # 次要音须在音符后验里持续 ≥ 50 ms，否则多为泛音或起音瞬态
        items = [x for j, x in enumerate(items) if j == 0 or sustain_len(f, x[0] - 21) >= 0.05]
        out.append({'t': float(frame_time(f)), 'pitches': [[p + shift, round(v, 3)] for p, v in items]})
    json.dump(out, open(_p(work, 'events.json'), 'w'))
    print('拨弦事件', len(out))


def noise_profile(work):
    """频谱平坦度与响度（用于找出绞弦 / 密集扫拂的“噪声段”）。"""
    import librosa
    y = _load_audio(work, 22050)
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=512))
    fr = librosa.fft_frequencies(sr=22050, n_fft=2048)
    band = (fr > 1200) & (fr < 6000)
    flat = librosa.feature.spectral_flatness(S=S[band])[0]
    rms = librosa.feature.rms(S=S)[0]
    t = librosa.times_like(flat, sr=22050, hop_length=512)
    json.dump({'t': t[::4].tolist(), 'flat': flat[::4].tolist(), 'rms': rms[::4].tolist()}, open(_p(work, 'noise.json'), 'w'))


def pipa_condense(work, jiao_from):
    """轮指（同音高 ≥ 9 下/秒）→ 一个带 ~ 的长音；期间的拨弦成为 [拨弦音 + 轮指音]；
    jiao_from 秒之后的噪声段 → 绞弦（x）。"""
    ev = json.load(open(_p(work, 'events.json')))
    TREM_GAP, TREM_MIN = 0.115, 4
    by_p = {}
    for i, e in enumerate(ev):
        for (p, s) in e['pitches']:
            by_p.setdefault(p, []).append((e['t'], i, s))
    trem, consumed = [], set()
    for p, lst in by_p.items():
        run = [lst[0]]

        def flush(run):
            if len(run) >= TREM_MIN:
                gaps = np.diff([x[0] for x in run])
                trem.append((run[0][0], run[-1][0] + float(np.median(gaps)), p, float(np.max([x[2] for x in run]))))
                for x in run:
                    consumed.add((x[1], p))
        for x in lst[1:]:
            if x[0] - run[-1][0] <= TREM_GAP:
                run.append(x)
            else:
                flush(run); run = [x]
        flush(run)
    # 同一时刻只保留最强的一段轮指（一只右手只能轮一根弦）
    kept = []
    for (t0, t1, p, s) in sorted(trem, key=lambda x: -x[3] * (x[1] - x[0]) ** 0.5):
        segs = [(t0, t1)]
        for (a, b, _, _) in kept:
            nxt = []
            for (x, y) in segs:
                if b <= x or a >= y:
                    nxt.append((x, y))
                else:
                    if a > x: nxt.append((x, a))
                    if b < y: nxt.append((b, y))
            segs = nxt
        kept += [(x, y, p, s) for (x, y) in segs if y - x >= 0.2]
    kept.sort()
    items = [{'t': t0, 'end': t1, 'pitches': [p], 'trem': True, 'tremP': p, 'vel': s} for (t0, t1, p, s) in kept]
    for i, e in enumerate(ev):
        ps = [(p, s) for (p, s) in e['pitches'] if (i, p) not in consumed]
        if not ps:
            continue
        mx = max(s for _, s in ps)
        if mx >= 0.3:
            items.append({'t': e['t'], 'end': None, 'pitches': sorted(p for p, s in ps if s >= 0.45 * mx), 'trem': False, 'vel': mx})
    items.sort(key=lambda x: x['t'])
    out = []
    for it in items:
        if out and abs(it['t'] - out[-1]['t']) < 0.035:   # 扫轮：与轮指开头同时的拨弦并入
            prev = out[-1]
            prev['pitches'] = sorted(set(prev['pitches']) | set(it['pitches']))
            prev['vel'] = max(prev['vel'], it['vel'])
            if it['trem']:
                prev.update(trem=True, tremP=it['tremP'], end=it['end'])
            continue
        out.append(dict(it))
    active = None
    for it in out:
        if it['trem']:
            active = {'p': it['tremP'], 'end': it['end']}
        elif active and it['t'] < active['end'] - 0.05:
            if active['p'] not in it['pitches']:
                it['pitches'] = sorted(it['pitches'] + [active['p']])
            it['trem'] = True
            it['tremP'] = active['p']
        elif active:
            active = None
    for k, it in enumerate(out):
        it['end'] = out[k + 1]['t'] if k + 1 < len(out) else it['t'] + 1.0
    # 绞弦段
    nz = json.load(open(_p(work, 'noise.json')))
    nt, nf, nr = np.array(nz['t']), np.array(nz['flat']), np.array(nz['rms'])
    loud = nr > 0.035
    nfs = uniform_filter1d(np.where(loud, nf, 0.0), 25) / np.maximum(uniform_filter1d(loud.astype(float), 25), 0.3)
    nrs = uniform_filter1d(nr, 25)

    def noisy(t):
        k = min(len(nfs) - 1, np.searchsorted(nt, t))
        return t >= jiao_from and nfs[k] > 0.12 and nrs[k] > 0.045
    final = []
    for it in out:
        if noisy(it['t']):
            it['jiao'] = True
            if final and final[-1].get('jiao') and it['t'] - final[-1]['t'] < 0.25:
                m = final[-1]
                m['end'] = it['end']; m['vel'] = max(m['vel'], it['vel']); m['_ps'] += it['pitches']
                continue
            it['_ps'] = list(it['pitches'])
        final.append(it)
    for m in final:
        if m.get('jiao'):
            vals, cnt = np.unique(m.pop('_ps'), return_counts=True)
            m['pitches'] = [int(vals[np.argmax(cnt)])]
            m['trem'] = m['end'] - m['t'] > 0.2
    json.dump(final, open(_p(work, 'notes.json'), 'w'))
    print('归并后', len(final), '个音，其中轮指', sum(1 for x in final if x['trem']), '，绞弦', sum(1 for x in final if x.get('jiao')))


# ───────────────────────────── 唢呐 ─────────────────────────────

def suona_skyline(work, lo, hi, thr=0.22):
    """唢呐几乎总在伴奏之上：在音高轮廓后验中取唢呐音域内最高的可信峰，Viterbi 平滑。"""
    C = np.load(_p(work, 'bp.npz'))['contour']
    T = C.shape[0]
    mid = 21 + np.arange(264) / 3.0
    K = 6
    cm = np.full((T, K), np.nan); cs = np.zeros((T, K))
    for t in range(T):
        x = C[t]
        pk, _ = find_peaks(x, height=thr, distance=2)
        pk = [p for p in pk if lo <= mid[p] <= hi]
        keep = [p for p in pk if not any(q < p and any(abs(mid[p] - mid[q] - h) < 0.4 for h in (12, 19.02, 24)) and x[p] < 1.1 * x[q] for q in pk)]
        for j, p in enumerate(sorted(keep, key=lambda p: -mid[p])[:K]):
            cm[t, j] = mid[p]; cs[t, j] = x[p]
    NEG = -1e9
    nS = K + 1
    dp = np.full(nS, NEG); dp[K] = 0
    bp = np.zeros((T, nS), dtype=np.int8)
    for t in range(1, T):
        e = np.full(nS, NEG)
        ok = ~np.isnan(cm[t])
        e[:K][ok] = np.log(cs[t][ok]) + 0.08 * (cm[t][ok] - 70) - 0.25 * np.arange(K)[ok]
        e[K] = np.log(thr * 0.9)
        nd = np.full(nS, NEG); nb = np.zeros(nS, dtype=np.int8)
        for j in range(nS):
            if e[j] <= NEG / 2:
                continue
            best, bi = NEG, 0
            for i in range(nS):
                if dp[i] <= NEG / 2:
                    continue
                if j == K or i == K:
                    c = dp[i] - (1.2 if (j == K) != (i == K) else 0)
                else:
                    dd = abs(cm[t, j] - cm[t - 1, i])
                    c = dp[i] - 0.5 * dd - 0.03 * dd * dd
                if c > best:
                    best, bi = c, i
            nd[j] = best + e[j]; nb[j] = bi
        dp = nd; bp[t] = nb
    path = np.zeros(T, dtype=int); path[-1] = int(np.argmax(dp))
    for t in range(T - 1, 0, -1):
        path[t - 1] = bp[t, path[t]]
    f0 = [None if path[t] == K else float(cm[t, path[t]]) for t in range(T)]
    json.dump({'t': frame_time(np.arange(T)).tolist(), 'midi': f0}, open(_p(work, 'f0.json'), 'w'))
    print('唢呐有声帧', sum(1 for x in f0 if x is not None), '/', T)


def suona_notes(work, off, tonic):
    """连续基频 → 音符：音阶吸附（含局部音准漂移）、滑音、打音交替（颤音）、倚音；删去掉到伴奏的片段。"""
    import librosa
    f = json.load(open(_p(work, 'f0.json')))
    t = np.array(f['t'])
    raw = np.array([np.nan if x is None else x for x in f['midi']])
    dt = np.median(np.diff(t))
    dev = raw - off
    frac = dev - np.round(dev)
    loc = np.zeros(len(raw))
    W = int(20 / dt)
    for c in range(0, len(raw), W // 4):
        seg = frac[max(0, c - W // 2):c + W // 2]
        seg = seg[~np.isnan(seg)]
        if len(seg) > 50:
            loc[c:c + W // 4] = np.median(seg)
    m = raw - off - loc
    MAJOR = np.array([0, 2, 4, 5, 7, 9, 11])

    def snap(x):
        base = np.floor((x - tonic) / 12) * 12 + tonic
        c = np.concatenate([base - 12 + MAJOR, base + MAJOR, base + 12 + MAJOR])
        k = np.argmin(np.abs(c - x))
        return int(c[k]) if abs(c[k] - x) <= 0.7 else int(np.round(x))

    y = _load_audio(work, 22050)
    rms = librosa.feature.rms(y=y, hop_length=128, frame_length=512)[0]
    rt = np.arange(len(rms)) * 128 / 22050

    def level(a, b):
        k = (rt >= a) & (rt < b)
        return float(np.sqrt(np.mean(rms[k] ** 2))) if k.any() else 0.0

    voiced = ~np.isnan(m)
    N = len(m)
    segs, i = [], 0
    while i < N:
        if not voiced[i]:
            i += 1; continue
        j, gap = i, 0
        while j < N and (voiced[j] or gap < int(0.04 / dt)):
            gap = 0 if voiced[j] else gap + 1
            j += 1
        segs.append((i, j - gap)); i = j
    notes = []
    for (a, b) in segs:
        x = m[a:b].copy()
        idx = np.where(~np.isnan(x))[0]
        xs = median_filter(np.interp(np.arange(len(x)), idx, x[idx]), size=5)
        cur, start, parts = np.round(xs[0]), 0, []
        for k in range(1, len(xs)):
            if abs(xs[k] - cur) > 0.62 and k + 3 <= len(xs) and np.all(np.abs(xs[k:k + 3] - np.round(xs[k])) < 0.5):
                parts.append((start, k)); cur = np.round(xs[k]); start = k
        parts.append((start, len(xs)))
        out = []
        for (s0, s1) in parts:
            if out and (s1 - s0) * dt < 0.045:     # 滑音经过的音
                out[-1]['pass'] = True; out[-1]['s1'] = s1
                continue
            out.append({'s0': s0, 's1': s1, 'p': snap(float(np.median(xs[s0:s1])))})
        for k, o in enumerate(out):
            t0, t1 = t[a + o['s0']], t[min(N - 1, a + o['s1'])]
            head = xs[o['s0']:min(len(xs), o['s0'] + int(0.08 / dt))]
            g = 0
            if k > 0 and (out[k - 1].get('pass') or (len(head) > 3 and abs(head[-1] - head[0]) > 1.2)):
                g = 1 if o['p'] > out[k - 1]['p'] else -1
            notes.append({'t': float(t0), 'end': float(t1), 'pitches': [o['p']], 'glide': g, 'vel': level(t0, t1), 'trem': False})
    # 打音交替（颤音）：两音交替、每音 < 110 ms、至少 4 个
    merged, i = [], 0
    while i < len(notes):
        n = notes[i]
        if n['end'] - n['t'] < 0.11:
            seq, j = [n['pitches'][0]], i + 1
            while j < len(notes) and notes[j]['end'] - notes[j]['t'] < 0.13 and notes[j]['t'] - notes[j - 1]['end'] < 0.03:
                pj = notes[j]['pitches'][0]
                if len(set(seq + [pj])) > 2 or abs(pj - seq[0]) > 4:
                    break
                seq.append(pj); j += 1
            if j - i >= 4 and len(set(seq)) == 2:
                merged.append({'t': n['t'], 'end': notes[j - 1]['end'], 'pitches': [seq[-1]], 'run': seq, 'glide': 0,
                               'vel': max(x['vel'] for x in notes[i:j]), 'trem': False})
                i = j
                continue
        merged.append(n); i += 1
    # 掉到伴奏：夹在两个高得多的音之间的短音
    clean = []
    for k, n in enumerate(merged):
        p = n['pitches'][0]
        prv = clean[-1] if clean else None
        nxt = merged[k + 1] if k + 1 < len(merged) else None
        if prv and nxt and 'run' not in n and n['end'] - n['t'] < 0.3 and prv['pitches'][0] - p >= 9 and nxt['pitches'][0] - p >= 9 \
                and n['t'] - prv['end'] < 0.1 and nxt['t'] - n['end'] < 0.1:
            prv['end'] = n['end']
            continue
        clean.append(n)
    # 倚音：极短、紧贴下一音、音高不同（≤ 5 半音）
    final = []
    for k, n in enumerate(clean):
        nxt = clean[k + 1] if k + 1 < len(clean) else None
        if final and final[-1].get('_gr') is not None:
            n['grace'] = [final.pop()['_gr']]
        if n['end'] - n['t'] < 0.07 and 'run' not in n and nxt and nxt['t'] - n['end'] < 0.03 and 0 < abs(nxt['pitches'][0] - n['pitches'][0]) <= 5:
            n['_gr'] = n['pitches'][0]
        final.append(n)
    final = [n for n in final if n.get('_gr') is None]
    vmax = np.percentile([n['vel'] for n in final], 90)
    for n in final:
        n['vel'] = float(min(1.3, n['vel'] / vmax))
    # 唢呐停顿时追踪到的乐队（音量低）
    final = [n for n in final if n['vel'] >= 0.28 or (n['end'] - n['t'] > 0.6 and n['vel'] >= 0.2)]
    json.dump(final, open(_p(work, 'notes.json'), 'w'))
    print('唢呐音符', len(final), '，滑音', sum(1 for n in final if n['glide']), '，倚音', sum(1 for n in final if n.get('grace')),
          '，打音交替', sum(1 for n in final if 'run' in n))


# ───────────────────────────── 节拍 ─────────────────────────────

def track_beats(work):
    """拍点：音频起音强度 + 音头脉冲，逐帧速度（♩ 55–160，Viterbi 平滑）驱动 librosa 动态规划。"""
    import librosa
    items = json.load(open(_p(work, 'notes.json')))
    sr, hop = 22050, 256
    y = _load_audio(work, sr)
    FR = sr / hop
    nF = int(len(y) / hop) + 1
    env_a = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop, aggregate=np.median)
    env_a = env_a / (np.percentile(env_a, 99) + 1e-9)
    env_n = np.zeros(nF)
    for it in items:
        i = int(round(it['t'] * FR))
        if i < nF:
            env_n[i] += min(1.5, it['vel'])
    env_n = gaussian_filter1d(env_n, 1.2)
    env_n /= env_n.max() + 1e-9
    L = min(len(env_a), nF)
    env = 0.5 * env_a[:L] + env_n[:L]
    tg = librosa.feature.tempogram(onset_envelope=env, sr=sr, hop_length=hop, win_length=512)
    bpms = librosa.tempo_frequencies(tg.shape[0], sr=sr, hop_length=hop)
    cand = bpms[(bpms >= 55) & (bpms <= 160)]
    score = np.stack([sum(w * tg[np.argmin(np.abs(bpms - b * mult))] for mult, w in ((1, 1.0), (2, 0.6), (4, 0.35))) for b in cand])
    logb = np.log2(cand)
    nC, T = len(cand), score.shape[1]
    D = (logb[:, None] - logb[None, :]) ** 2 / (2 * 0.48 ** 2)
    idx = list(range(0, T, 8))
    dp = np.log(score[:, 0] + 1e-6)
    bp = np.zeros((len(idx), nC), dtype=int)
    for n in range(1, len(idx)):
        prev = dp[None, :] - D
        bp[n] = np.argmax(prev, axis=1)
        dp = prev[np.arange(nC), bp[n]] + np.log(score[:, idx[n]] + 1e-6)
    path = np.zeros(len(idx), dtype=int); path[-1] = int(np.argmax(dp))
    for n in range(len(idx) - 1, 0, -1):
        path[n - 1] = bp[n, path[n]]
    curve = median_filter(np.interp(np.arange(T), idx, cand[path]), size=int(FR * 2) | 1)
    _, beats = librosa.beat.beat_track(onset_envelope=env, sr=sr, hop_length=hop, bpm=curve, tightness=60, trim=False, units='time')
    json.dump({'beats': np.asarray(beats, dtype=float).tolist()}, open(_p(work, 'beats.json'), 'w'))
    print('拍点', len(beats), '，中位速度 ♩ =', round(60 / np.median(np.diff(beats)), 1))


# ───────────────────────────── 写谱 ─────────────────────────────

SUF32 = {1: '___', 2: '__', 3: '__.', 4: '_', 6: '_.', 8: '', 12: '.', 16: ' -'}
EXT32 = {1: '-___', 2: '-__', 3: '-__.', 4: '-_', 6: '-_.', 8: '-', 12: '-.', 16: '- -'}


def emit_score(work, tonic, sections, start=0.0, real_end=False):
    """归并后的音 + 拍点 → 文字简谱：2/4 拍，每小节写实测速度 !t=，力度按小节响度分五档，
    十六分音符为基本网格（同一格挤两个音的拍改用三十二分）。返回 (简谱文字, 开头偏移秒)。"""
    import librosa
    items = json.load(open(_p(work, 'notes.json')))
    y = _load_audio(work, 22050)
    rms = librosa.feature.rms(y=y, hop_length=512)[0]
    rt = librosa.times_like(rms, sr=22050, hop_length=512)

    def rms_at(a, b=None):
        if b is None:
            return float(rms[min(len(rms) - 1, np.searchsorted(rt, a) + 2)])
        k = (rt >= a) & (rt < b)
        return float(np.sqrt(np.mean(rms[k] ** 2))) if k.any() else 0.0
    items = [it for it in items if it['t'] > start and rms_at(it['t']) > 0.004]
    beats = np.array(json.load(open(_p(work, 'beats.json')))['beats'])
    ibi0, ibi1 = np.median(np.diff(beats[:8])), np.median(np.diff(beats[-8:]))
    while beats[0] > items[0]['t'] - 0.05:
        beats = np.insert(beats, 0, beats[0] - ibi0)
    while beats[-1] < items[-1]['end'] + 0.5:
        beats = np.append(beats, beats[-1] + ibi1)
    beats = beats[max(0, np.searchsorted(beats, items[0]['t'] + 1e-6) - 1):]
    if (len(beats) - 1) % 2:
        beats = np.append(beats, beats[-1] + ibi1)
    NB = len(beats) - 1

    def pos_of(t):
        k = int(np.clip(np.searchsorted(beats, t) - 1, 0, NB - 1))
        return k + (t - beats[k]) / (beats[k + 1] - beats[k])

    def time_of(p):
        k = int(np.clip(np.floor(p), 0, NB - 1))
        return beats[k] + (p - k) * (beats[k + 1] - beats[k])

    q = np.array([pos_of(it['t']) for it in items])
    res = np.full(len(items), 4)
    slots = {}
    for i, p in enumerate(q):
        slots.setdefault(int(np.floor(p)), []).append(i)
    for idx in slots.values():
        g = [int(round(q[i] * 4)) for i in idx]
        if len(set(g)) < len(g):
            res[idx] = 8
    qpos = np.round(q * res) / res
    merged = []
    for i, it in enumerate(items):
        if merged and abs(qpos[i] - merged[-1]['qp']) < 1e-6:
            m = merged[-1]
            m['pitches'] = sorted(set(m['pitches']) | set(it['pitches']))[-4:]
            m['vel'] = max(m['vel'], it['vel'])
            m['trem'] = m['trem'] or it['trem']
            m['jiao'] = m.get('jiao') or it.get('jiao')
            continue
        merged.append({**it, 'qp': float(qpos[i])})
    err = [abs(time_of(m['qp']) - m['t']) for m in merged]
    print('量化误差 ms：平均 %.1f，90%% %.1f' % (1000 * np.mean(err), 1000 * np.percentile(err, 90)))
    for k, m in enumerate(merged):
        nxt = merged[k + 1]['qp'] if k + 1 < len(merged) else (np.floor(m['qp'] / 2) + 2) * 2
        m['dur'], m['rest'] = nxt - m['qp'], 0.0
        if real_end:
            # 吹管乐：按实际收音写时值，空隙写休止
            gap = nxt - max(np.round(pos_of(m['end']) * 4) / 4, m['qp'] + 0.25)
            if gap >= 0.25:
                m['dur'], m['rest'] = nxt - m['qp'] - gap, gap
        if m['dur'] > 3:
            m['rest'] += m['dur'] - 1.5
            m['dur'] = 1.5
    ref = np.percentile([m['vel'] for m in merged], 85)

    def body_of(m):
        ps = m['pitches']
        if m.get('run'):
            return '<' + ' '.join(jianpu(x, tonic) for x in m['run']) + '>', 'run'
        grace = ''
        if m.get('grace'):
            grace = '{' + ' '.join(jianpu(g, tonic) for g in m['grace']) + '}'
        elif len(ps) == 2 and 1 <= ps[1] - ps[0] <= 2 and not m['trem']:
            grace, ps = '{' + jianpu(ps[0], tonic) + '}', [ps[1]]    # 推弦 / 打音装饰
        gl = '/' if m.get('glide', 0) > 0 else ('\\' if m.get('glide', 0) < 0 else '')
        if len(ps) == 1:
            return grace + gl + jianpu(ps[0], tonic), 'note'
        return '[' + ' '.join(jianpu(p, tonic) for p in ps) + ']', 'chord'

    events = []
    if merged[0]['qp'] > 1e-6:
        events.append((0.0, merged[0]['qp'], None))
    for m in merged:
        events.append((m['qp'], m['dur'], m))
        if m['rest'] > 0:
            events.append((m['qp'] + m['dur'], m['rest'], None))
    bars = {}
    for (st, d, m) in events:
        pos, remain, first = st, d, True
        while remain > 1e-6:
            bi = int(np.floor(pos / 2 + 1e-9))
            in_bar = min(remain, (bi + 1) * 2 - pos)
            u = int(round(in_bar * 8))
            blocks = []
            for b in (16, 12, 8, 6, 4, 3, 2, 1):
                while u >= b:
                    blocks.append(b); u -= b
            for j, b in enumerate(blocks):
                if first and j == 0 and m is not None:
                    body, kind = body_of(m)
                    flag = ('x' if m.get('jiao') else '') + ('~' if m['trem'] else '') + ('>' if m['vel'] > 1.25 * ref and not m['trem'] else '')
                    suf = SUF32[b]
                    if kind == 'run' and suf.startswith(' '):
                        bars.setdefault(bi, []).extend([body + flag, '-'])
                    elif suf.startswith(' '):
                        bars.setdefault(bi, []).append(body + flag + suf)
                    else:
                        bars.setdefault(bi, []).append(body + suf + flag)
                elif m is None:
                    bars.setdefault(bi, []).append('0' + SUF32[b])
                else:
                    bars.setdefault(bi, []).append(EXT32[b])
            first = False
            pos += in_bar; remain -= in_bar
    nbars = max(bars) + 1
    bar_db = [20 * np.log10(rms_at(time_of(2 * b), time_of(2 * b + 2)) + 1e-6) for b in range(nbars)]
    DB = np.percentile([d for d in bar_db if d > -40], [15, 40, 65, 88])
    secs = sorted(sections, key=lambda s: s['t'])
    lines, si, last = [], 0, None
    for bi in range(nbars):
        t0, t1 = time_of(2 * bi), time_of(2 * bi + 2)
        while si < len(secs) and secs[si]['t'] <= (t0 + t1) / 2:
            lines += ['', f"!sec={secs[si]['name']}"]
            si += 1
        db = bar_db[bi]
        dyn = 'ff' if db > DB[3] else 'f' if db > DB[2] else 'mf' if db > DB[1] else 'mp' if db > DB[0] else 'p'
        head = f'!t={120 / (t1 - t0):.1f} ' + (f'!{dyn} ' if dyn != last else '')
        last = dyn
        lines.append(head + ' '.join(bars.get(bi, ['0 0'])) + ' |')
    json.dump({'lead': float(beats[0]), 'bars': [float(time_of(2 * b)) for b in range(nbars + 1)]}, open(_p(work, 'score_timing.json'), 'w'))
    print(nbars, '小节；乐谱第 0 拍 = 录音', round(float(beats[0]), 3), '秒')
    return '\n'.join(lines).strip('\n') + '\n', float(beats[0])
